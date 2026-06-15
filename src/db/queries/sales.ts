import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { useCartStore, calculateItemLineTotal } from '@/stores/cart.store';
import { logAudit } from './audit';
import { applyPercent, formatMoney } from '@/lib/money';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';

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
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  const now = new Date().toISOString();
  const deviceId = getDeviceId();

  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  // HI-A: server-side guard against credit sales. Per owner policy: no debt allowed.
  if (paidAmount < totalAmount) {
    throw new Error(
      `المبلغ المدفوع (${formatMoney(paidAmount)}) أقل من إجمالي الفاتورة (${formatMoney(totalAmount)}). البيع الآجل غير مسموح.`
    );
  }

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

  // 1. Get next invoice number — atomic: ON CONFLICT increments and returns new value
  const seqRow = await dbClient.query(
    `INSERT INTO sequences (name, last_val) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET last_val = last_val + 1
     RETURNING last_val`,
    ['invoice']
  );
  const nextVal = seqRow[0].last_val;

  const invoiceNumber = generateSequenceNumber('INV', nextVal - 1, 6);

  // 2. Create invoice
  stmts.push({
    sql: `INSERT INTO invoices (id, invoice_number, invoice_date, customer_id, customer_name, customer_phone,
            subtotal, discount_amount, total_amount, paid_amount, created_at, updated_at, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [invoiceId, invoiceNumber, today, null, null, null,
      subtotal, totalDiscount, totalAmount, paidAmount, now, now, deviceId],
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

  // HI-D: snapshot expected post-sale stock for tracked items, used for post-batch verification.
  const expectedStockAfter = new Map<string, number>();
  for (const item of cartItems) {
    if (item.product.track_stock) {
      const p = productMap.get(item.product.id);
      if (p) {
        const prev = expectedStockAfter.get(item.product.id) ?? p.stock_qty;
        expectedStockAfter.set(item.product.id, prev - item.quantity);
      }
    }
  }

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
                 unit_price, unit_cost, product_category, discount_amount, line_total, is_gift,
                 updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          itemId, invoiceId,
          item.product.id, item.product.name, item.quantity,
          unitPrice,
          item.product.cost_price ?? 0,
          item.product.category,
          itemSub,
          0,
          1,
          now, deviceId,
        ],
      });
    } else {
      const discountAmount = perItemDiscount + globalShares[i];
      const lineTotal = Math.max(0, itemSub - discountAmount);
      stmts.push({
        sql: `INSERT INTO invoice_items
                (id, invoice_id, product_id, product_name, quantity,
                 unit_price, unit_cost, product_category, discount_amount, line_total, is_gift,
                 updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          itemId, invoiceId,
          item.product.id, item.product.name, item.quantity,
          unitPrice,
          item.product.cost_price ?? 0,
          item.product.category,
          discountAmount,
          lineTotal,
          0,
          now, deviceId,
        ],
      });
    }

    if (item.product.track_stock) {
      // batchRun does not raise on zero-row UPDATEs; the P1 pre-fetch guard above
      // is the effective safety net on a single tablet. The WHERE stock_qty >= ?
      // condition is harmless and forward-compatible for multi-tablet use.
      // Strict atomic enforcement comes with Supabase RPC in Phase 7.
      stmts.push({
        sql: `UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND track_stock = 1 AND stock_qty >= ?`,
        params: [item.quantity, now, item.product.id, item.quantity],
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
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [paymentId, invoiceId, payment.accountId, payment.amount, feeAmount, now, deviceId],
    });
    // Atomic: single-statement UPDATE inside SQLite transaction.
    stmts.push({
      sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      params: [netAmount, now, payment.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, payment.accountId,
        acct?.name ?? null,
        'credit', netAmount, 'invoice', invoiceId,
        `مبيعات فاتورة رقم ${invoiceNumber}`, now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(stmts);

  // HI-D: post-batch oversell detection. Single-shop trust model: invoice is
  // already recorded (cannot be rolled back without RPC support in Phase 7).
  // Surface a flagged audit entry so the owner can reconcile inventory manually.
  if (expectedStockAfter.size > 0) {
    const ids = Array.from(expectedStockAfter.keys());
    const placeholders = ids.map(() => '?').join(',');
    const actualRows = await dbClient.query(
      `SELECT id, stock_qty FROM products WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of actualRows) {
      const expected = expectedStockAfter.get(row.id);
      if (expected !== undefined && row.stock_qty !== expected) {
        // Stock did not decrement as expected — concurrent sale on another tablet.
        // The current invoice is intact; flag the inventory drift for manual review.
        await logAudit(
          'تنبيه_تجاوز_مخزون',
          `فاتورة ${invoiceNumber} — منتج ${row.id} — متوقع ${expected}, فعلي ${row.stock_qty} — راجع المخزون يدوياً`,
          'invoice',
          invoiceId
        );
      }
    }
  }

  // P4: تسجيل سجل التدقيق — يشمل ملخص الهدايا والخصومات والأسعار المعدَّلة
  const giftCount = cartItems.filter(i => i.isGift).length;
  const discountedCount = cartItems.filter(i => !i.isGift && i.discountValue > 0).length;
  const overrideCount = cartItems.filter(i => i.overridePrice !== undefined).length;
  const enrichedDetail =
    `فاتورة ${invoiceNumber} — الإجمالي ${formatMoney(totalAmount)}` +
    (giftCount       ? ` — هدايا: ${giftCount}` : '') +
    (discountedCount ? ` — أسطر بخصم: ${discountedCount}` : '') +
    (overrideCount   ? ` — أسعار معدَّلة: ${overrideCount}` : '');
  await logAudit('إتمام_بيع', enrichedDetail, 'invoice', invoiceId);

  return { invoiceId, invoiceNumber };
}

export async function getInvoiceWithItems(invoiceId: string) {
  const invoices = await dbClient.query(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
  if (!invoices.length) return null;
  const invoice = invoices[0];
  const items = await dbClient.query(
    `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY rowid`,
    [invoiceId]
  );
  const payments = await dbClient.query(
    `SELECT ip.*, a.name as account_name
     FROM invoice_payments ip
     LEFT JOIN accounts a ON a.id = ip.account_id
     WHERE ip.invoice_id = ?
     ORDER BY ip.rowid`,
    [invoiceId]
  );
  return { ...invoice, items, payments };
}

export async function getRecentInvoices(limit = 100) {
  return dbClient.query(
    `SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function searchInvoices(filters: {
  invoiceNumber?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  accountId?: string;
  limit?: number;
}) {
  const { invoiceNumber, from, to, minAmount, maxAmount, accountId, limit = 100 } = filters;

  const conds: string[] = [];
  const cParams: any[] = [];

  if (from)                    { conds.push('i.invoice_date >= ?');    cParams.push(from); }
  if (to)                      { conds.push('i.invoice_date <= ?');    cParams.push(to); }
  if (minAmount !== undefined)  { conds.push('i.total_amount >= ?');   cParams.push(minAmount); }
  if (maxAmount !== undefined)  { conds.push('i.total_amount <= ?');   cParams.push(maxAmount); }
  if (invoiceNumber)            { conds.push('i.invoice_number LIKE ?'); cParams.push(`%${invoiceNumber}%`); }

  const params: any[] = [];
  let sql: string;

  if (accountId) {
    sql = `SELECT DISTINCT i.* FROM invoices i
           INNER JOIN invoice_payments ip ON ip.invoice_id = i.id
           WHERE ip.account_id = ?`;
    params.push(accountId);
    if (conds.length) sql += ' AND ' + conds.join(' AND ');
  } else {
    sql = `SELECT i.* FROM invoices i`;
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  }

  params.push(...cParams);
  sql += ' ORDER BY i.created_at DESC LIMIT ?';
  params.push(limit);

  return dbClient.query(sql, params);
}

export async function returnInvoice(invoiceId: string, refunds: { accountId: string; amount: number }[]) {
  const invoiceResult = await dbClient.query(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
  if (invoiceResult.length === 0) throw new Error("Invoice not found");
  const invoice = invoiceResult[0];
  if (await isDayClosed(invoice.invoice_date)) {
    throw new Error(`يوم ${invoice.invoice_date} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
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
  const deviceId = getDeviceId();

  // ملاحظة: واجهة الاسترجاع الحالية تعمل بالمبالغ فقط (accountId, amount)
  // ولا تتتبع كميات البنود لكل استرجاع — استرجاع المخزون يُطبَّق فقط عند الاسترجاع الكامل (FIX 2)

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
    sql: `UPDATE invoices SET status = ?, paid_amount = paid_amount - ?, notes = COALESCE(notes, '') || ?, updated_at = ? WHERE id = ?`,
    params: [newStatus, totalRefund, ` | ${returnNote}`, now, invoiceId],
  });

  // ── DESIGN INTENT (2026-06-15) ──────────────────────────────────────────
  // Partial returns are amount-based only. The customer keeps the goods.
  // Stock restoration and COGS reversal happen ONLY on full returns
  // (status='returned'). This is intentional for mobile retail where
  // partial-unit returns do not occur; partial refunds act as
  // "retroactive discount" semantics. See Owner Decision §5.
  // ────────────────────────────────────────────────────────────────────────
  if (newStatus === 'returned') {
    for (const item of items) {
      if (!item.product_id) continue;
      stmts.push({
        sql: `UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ? AND track_stock = 1`,
        params: [item.quantity, now, item.product_id],
      });
    }
  }

  for (const refund of refunds) {
    if (refund.amount <= 0) continue;
    const racct = refundAccountMap.get(refund.accountId);
    // fee_percent is stored per-mille (بالألف): divide by 10 to get standard percent
    const refundFee = applyPercent(refund.amount, (racct?.feePercent ?? 0) / 10);
    const netRefund = refund.amount - refundFee;
    stmts.push({
      sql: `INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), invoiceId, refund.accountId, -refund.amount, refundFee, now, deviceId],
    });
    // Atomic: single-statement UPDATE inside SQLite transaction.
    stmts.push({
      sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
      params: [netRefund, now, refund.accountId],
    });
    stmts.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, refund.accountId,
        'debit', netRefund, 'invoice', invoiceId,
        `استرجاع مبيعات فاتورة رقم ${invoice.invoice_number}`, now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(stmts);

  // P4: تسجيل سجل التدقيق — يميّز بين الاسترجاع الكامل والجزئي
  const auditAction = newStatus === 'returned'
    ? 'استرجاع_فاتورة_كامل'
    : 'استرجاع_فاتورة_جزئي';
  await logAudit(
    auditAction,
    `فاتورة رقم ${invoice.invoice_number} — المسترجع: ${formatMoney(totalRefund)} — المتبقي: ${formatMoney(newPaidAmount)}`,
    'invoice',
    invoiceId
  );
}
