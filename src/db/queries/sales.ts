import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { useCartStore, calculateItemLineTotal } from '@/stores/cart.store';
import { logAudit } from './audit';
import { applyPercent } from '@/lib/money';

export async function completeSale(data: {
  cartItems: ReturnType<typeof useCartStore.getState>['items'];
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  payments: { accountId: string; amount: number }[];
}) {
  const { cartItems, subtotal, totalDiscount, totalAmount, payments } = data;

  // ── P1: التحقق من المنتجات (نشاط + مخزون) ──────────────────────
  const allIds = cartItems.map(item => item.product.id);
  const allProducts = await dbClient.query(
    `SELECT id, name, stock_qty, track_stock, is_active FROM products WHERE id IN (${allIds.map(() => '?').join(',')})`,
    allIds
  );
  const productMap = new Map<string, { name: string; stock_qty: number; track_stock: number; is_active: number }>(
    allProducts.map((p: any) => [p.id, p])
  );
  for (const item of cartItems) {
    const p = productMap.get(item.product.id);
    if (!p) throw new Error(`المنتج غير موجود: ${item.product.name}`);
    if (p.is_active !== 1) {
      throw new Error(`المنتج لم يعد متوفراً: ${p.name}`);
    }
    if (p.track_stock && item.quantity > p.stock_qty) {
      throw new Error(
        `الكمية غير متوفرة للمنتج ${p.name} (المتاح: ${p.stock_qty})`
      );
    }
  }
  // ───────────────────────────────────────────────────────────────

  const invoiceId = nanoid();
  const today = format(new Date(), 'yyyy-MM-dd');
  const now = new Date().toISOString();

  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  // Pre-fetch all accounts for names and fee_percent
  const accountIds = payments.map(p => p.accountId);
  const accountMap = new Map<string, { name: string; feePercent: number }>();
  if (accountIds.length > 0) {
    const accounts = await dbClient.query(
      `SELECT id, name, fee_percent FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
      accountIds
    );
    accounts.forEach(a => accountMap.set(a.id, { name: a.name, feePercent: a.fee_percent }));
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
    const acct = accountMap.get(payment.accountId);
    // fee_percent is stored per-mille (بالألف) in schema: e.g. 100 = 10%
    // Divide by 10 to convert to standard percent before applyPercent
    const feeAmount = applyPercent(payment.amount, (acct?.feePercent ?? 0) / 10);
    const netAmount = payment.amount - feeAmount;
    stmts.push({
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount) VALUES (?, ?, ?, ?, ?)`,
      params: [paymentId, invoiceId, payment.accountId, payment.amount, feeAmount],
    });
    stmts.push({
      sql: `UPDATE accounts SET balance = balance + ? WHERE id = ?`,
      params: [netAmount, payment.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, payment.accountId,
        acct?.name ?? null,
        'credit', netAmount, 'invoice', invoiceId,
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
  if (invoice.paid_amount <= 0) throw new Error('لا يوجد مبلغ متبقٍّ للاسترجاع');

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

  // تحقق من كميات البنود: الكمية المُسترجعة لا تتجاوز الكمية الأصلية
  for (const item of items) {
    const refundQty = item.quantity;
    if (refundQty > item.quantity) {
      throw new Error(`الكمية المُسترجعة تتجاوز الكمية الأصلية للمنتج: ${item.product_name}`);
    }
  }

  // Pre-fetch fee_percent for refund accounts
  const refundAccountIds = refunds.map(r => r.accountId);
  const refundAccountMap = new Map<string, { name: string; feePercent: number }>();
  if (refundAccountIds.length > 0) {
    const accts = await dbClient.query(
      `SELECT id, name, fee_percent FROM accounts WHERE id IN (${refundAccountIds.map(() => '?').join(',')})`,
      refundAccountIds
    );
    accts.forEach((a: any) => refundAccountMap.set(a.id, { name: a.name, feePercent: a.fee_percent }));
  }

  const newPaidAmount = invoice.paid_amount - totalRefund;
  const newStatus = newPaidAmount === 0 ? 'returned' : 'partially_returned';
  const returnNote = newStatus === 'returned' ? 'تم الاسترجاع الكامل' : 'تم استرجاع جزئي';

  stmts.push({
    sql: `UPDATE invoices SET status = ?, paid_amount = paid_amount - ?, notes = COALESCE(notes, '') || ? WHERE id = ?`,
    params: [newStatus, totalRefund, ` | ${returnNote}`, invoiceId],
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
    const racct = refundAccountMap.get(refund.accountId);
    // fee_percent is stored per-mille (بالألف): divide by 10 to get standard percent
    const refundFee = applyPercent(refund.amount, (racct?.feePercent ?? 0) / 10);
    const netRefund = refund.amount - refundFee;
    stmts.push({
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount) VALUES (?, ?, ?, ?, ?)`,
      params: [nanoid(), invoiceId, refund.accountId, -refund.amount, refundFee],
    });
    stmts.push({
      sql: `UPDATE accounts SET balance = balance - ? WHERE id = ?`,
      params: [netRefund, refund.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, refund.accountId,
        'debit', netRefund, 'invoice', invoiceId,
        `استرجاع مبيعات فاتورة رقم ${invoice.invoice_number}`, now,
      ],
    });
  }

  await dbClient.batchRun(stmts);

  // P4: تسجيل سجل التدقيق
  const auditDetail = newStatus === 'returned'
    ? `فاتورة رقم ${invoice.invoice_number} — استرجاع كامل: ${totalRefund}`
    : `فاتورة رقم ${invoice.invoice_number} — استرجاع جزئي: ${totalRefund} (المتبقي: ${newPaidAmount})`;
  await logAudit('استرجاع_فاتورة', auditDetail, 'invoice', invoiceId);
}
