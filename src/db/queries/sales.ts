import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { useCartStore, calculateItemLineTotal } from '@/stores/cart.store';
import { logAudit } from './audit';

export async function completeSale(data: {
  cartItems: ReturnType<typeof useCartStore.getState>['items'];
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  payments: { accountId: string; amount: number }[];
}) {
  const { cartItems, subtotal, totalDiscount, totalAmount, payments } = data;

  // ── P1: منع المخزون السالب ──────────────────────────────────────
  const trackedItems = cartItems.filter(item => item.product.track_stock);
  if (trackedItems.length > 0) {
    const ids = trackedItems.map(item => item.product.id);
    const stocks = await dbClient.query(
      `SELECT id, name, stock_qty FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const stockMap = new Map<string, { name: string; stock_qty: number }>(
      stocks.map((s: any) => [s.id, { name: s.name, stock_qty: s.stock_qty }])
    );
    for (const item of trackedItems) {
      const stock = stockMap.get(item.product.id);
      const available = stock?.stock_qty ?? 0;
      if (item.quantity > available) {
        throw new Error(
          `الكمية غير متوفرة للمنتج ${item.product.name} (المتاح: ${available})`
        );
      }
    }
  }
  // ───────────────────────────────────────────────────────────────

  const invoiceId = nanoid();
  const today = format(new Date(), 'yyyy-MM-dd');
  const now = new Date().toISOString();

  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  // Pre-fetch all accounts for names
  const accountIds = payments.map(p => p.accountId);
  const accountMap = new Map<string, string>();
  if (accountIds.length > 0) {
    const accounts = await dbClient.query(
      `SELECT id, name FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
      accountIds
    );
    accounts.forEach(a => accountMap.set(a.id, a.name));
  }

  const stmts: { sql: string; params: any[] }[] = [];

  // 1. Get next invoice number
  const seqResult = await dbClient.query("SELECT last_val FROM sequences WHERE name = 'invoice'");
  let nextVal = 1;
  if (seqResult.length > 0) nextVal = seqResult[0].last_val + 1;

  const invoiceNumber = generateSequenceNumber('INV', nextVal - 1, 6);

  stmts.push({
    sql: "UPDATE sequences SET last_val = ? WHERE name = 'invoice'",
    params: [nextVal],
  });

  // 2. Create invoice
  stmts.push({
    sql: `INSERT INTO invoices (id, invoice_number, invoice_date, customer_id, customer_name, customer_phone,
            subtotal, discount_amount, total_amount, paid_amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [invoiceId, invoiceNumber, today, null, null, null,
      subtotal, totalDiscount, totalAmount, paidAmount, now],
  });

  // 3. Compute per-item line data using shared helper
  const itemLineData = cartItems.map(item => {
    const unitPrice = item.overridePrice !== undefined ? item.overridePrice : item.product.sale_price;
    const { subtotal: itemSub, discountAmt: perItemDiscount, total: afterPerItem } = calculateItemLineTotal(item);
    return { item, unitPrice, itemSub, perItemDiscount, afterPerItem };
  });

  // For gift items: perItemDiscount === itemSub (full subtotal), afterPerItem === 0
  // So totalPerItemDiscount includes gift subtotals, and globalDiscountAmt = pure global discount
  const totalPerItemDiscount = itemLineData.reduce((s, d) => s + d.perItemDiscount, 0);
  const globalDiscountAmt = Math.max(0, totalDiscount - totalPerItemDiscount);

  // Distribute global discount proportionally among NON-GIFT items only.
  // Last non-gift item absorbs the rounding remainder.
  const nonGiftTotal = itemLineData.reduce((s, d) => s + (d.item.isGift ? 0 : d.afterPerItem), 0);
  const nonGiftIndices = itemLineData
    .map((_, i) => i)
    .filter(i => !itemLineData[i].item.isGift);

  const globalShares: number[] = new Array(itemLineData.length).fill(0);
  let assignedGlobal = 0;
  nonGiftIndices.forEach((idx, k) => {
    if (k === nonGiftIndices.length - 1) {
      globalShares[idx] = globalDiscountAmt - assignedGlobal;
    } else {
      const share = nonGiftTotal > 0
        ? Math.round(globalDiscountAmt * itemLineData[idx].afterPerItem / nonGiftTotal)
        : 0;
      globalShares[idx] = share;
      assignedGlobal += share;
    }
  });

  // 4. Insert items and update stock
  for (let i = 0; i < cartItems.length; i++) {
    const { item, unitPrice, itemSub, perItemDiscount } = itemLineData[i];
    const itemId = nanoid();

    if (item.isGift) {
      // Gift line: line_total = 0, is_gift = 1, discount_amount = full subtotal,
      // unit_cost recorded for correct profit calculation
      stmts.push({
        sql: `INSERT INTO invoice_items
                (id, invoice_id, product_id, product_name, quantity,
                 unit_price, unit_cost, product_category, discount_amount, line_total, is_gift)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          itemId, invoiceId,
          item.product.id, item.product.name, item.quantity,
          unitPrice,
          item.product.cost_price ?? 0,
          item.product.category,
          itemSub,
          0,
          1,
        ],
      });
    } else {
      const discountAmount = perItemDiscount + globalShares[i];
      const lineTotal = Math.max(0, itemSub - discountAmount);
      stmts.push({
        sql: `INSERT INTO invoice_items
                (id, invoice_id, product_id, product_name, quantity,
                 unit_price, unit_cost, product_category, discount_amount, line_total, is_gift)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          itemId, invoiceId,
          item.product.id, item.product.name, item.quantity,
          unitPrice,
          item.product.cost_price ?? 0,
          item.product.category,
          discountAmount,
          lineTotal,
          0,
        ],
      });
    }

    if (item.product.track_stock) {
      stmts.push({
        sql: `UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?`,
        params: [item.quantity, now, item.product.id],
      });
    }
  }

  // 5. Create payments and update account ledger
  for (const payment of payments) {
    if (payment.amount <= 0) continue;
    const paymentId = nanoid();
    stmts.push({
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount) VALUES (?, ?, ?, ?)`,
      params: [paymentId, invoiceId, payment.accountId, payment.amount],
    });
    stmts.push({
      sql: `UPDATE accounts SET balance = balance + ? WHERE id = ?`,
      params: [payment.amount, payment.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, payment.accountId,
        accountMap.get(payment.accountId) ?? null,
        'credit', payment.amount, 'invoice', invoiceId,
        `مبيعات فاتورة رقم ${invoiceNumber}`, now,
      ],
    });
  }

  await dbClient.batchRun(stmts);

  // P4: تسجيل سجل التدقيق
  await logAudit('إتمام_بيع', `فاتورة رقم ${invoiceNumber} — المبلغ: ${totalAmount}`, 'invoice', invoiceId);

  return { invoiceId, invoiceNumber };
}

export async function getInvoiceWithItems(invoiceId: string) {
  const invoices = await dbClient.query(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
  if (!invoices.length) return null;
  const invoice = invoices[0];
  const items = await dbClient.query(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId]);
  return { ...invoice, items };
}

export async function getRecentInvoices(limit = 100) {
  return dbClient.query(
    `SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function returnInvoice(invoiceId: string, refunds: { accountId: string; amount: number }[]) {
  const invoiceResult = await dbClient.query(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
  if (invoiceResult.length === 0) throw new Error("Invoice not found");
  const invoice = invoiceResult[0];
  if (invoice.status === 'returned') throw new Error("Invoice already returned");

  // ── P2: التحقق من مبلغ الاسترجاع ──────────────────────────────
  if (refunds.some(r => r.amount < 0)) {
    throw new Error('مبلغ الاسترجاع يتجاوز المبلغ المدفوع');
  }
  const totalRefund = refunds.reduce((sum, r) => sum + r.amount, 0);
  if (totalRefund <= 0 || totalRefund > invoice.paid_amount) {
    throw new Error('مبلغ الاسترجاع يتجاوز المبلغ المدفوع');
  }
  // ───────────────────────────────────────────────────────────────

  const items = await dbClient.query(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId]);
  const stmts: { sql: string; params: any[] }[] = [];
  const now = new Date().toISOString();
  const today = format(new Date(), 'yyyy-MM-dd');

  stmts.push({
    sql: `UPDATE invoices SET status = 'returned', notes = 'تم الاسترجاع', paid_amount = paid_amount - ? WHERE id = ?`,
    params: [totalRefund, invoiceId],
  });

  for (const item of items) {
    if (!item.product_id) continue;
    stmts.push({
      sql: `UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ? AND track_stock = 1`,
      params: [item.quantity, now, item.product_id],
    });
  }

  for (const refund of refunds) {
    if (refund.amount <= 0) continue;
    stmts.push({
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount) VALUES (?, ?, ?, ?)`,
      params: [nanoid(), invoiceId, refund.accountId, -refund.amount],
    });
    stmts.push({
      sql: `UPDATE accounts SET balance = balance - ? WHERE id = ?`,
      params: [refund.amount, refund.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, refund.accountId,
        'debit', refund.amount, 'invoice', invoiceId,
        `استرجاع مبيعات فاتورة رقم ${invoice.invoice_number}`, now,
      ],
    });
  }

  await dbClient.batchRun(stmts);

  // P4: تسجيل سجل التدقيق
  await logAudit('استرجاع_فاتورة', `فاتورة رقم ${invoice.invoice_number} — المسترجع: ${totalRefund}`, 'invoice', invoiceId);
}
