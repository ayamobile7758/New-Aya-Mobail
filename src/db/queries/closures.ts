// src/db/queries/closures.ts
// =============================================================================
// BUNDLE 1 — Accounting Core (C-3, C-5)
// HEAD: b6c491e
//
// AGREED NET-PROFIT FORMULA (must match getReport and getProfitAndLoss in reports.ts):
// ─────────────────────────────────────────────────────────────────────────────
//   sales_total   = SUM(invoices.total_amount) WHERE status IN ('active','partially_returned')
//   cogs_total    = SUM(invoice_items.unit_cost * invoice_items.quantity)
//                   WHERE invoice.status IN ('active','partially_returned') AND is_gift = 0
//   gifts_value   = SUM(invoice_items.unit_cost * invoice_items.quantity)  [C-3: was unit_price]
//                   WHERE invoice.status IN ('active','partially_returned') AND is_gift = 1
//   returns_total = SUM(invoices.total_amount - invoices.paid_amount)
//                   WHERE invoice.status IN ('returned','partially_returned')
//   expenses_total = SUM(expenses.amount) WHERE expense_date = targetDate
//   topup_profit  = SUM(topups.profit) WHERE topup_date = targetDate
//   maintenance_revenue = SUM(maintenance_jobs.final_amount)
//                         WHERE status='delivered' AND substr(delivered_at,1,10) = targetDate
//   net_profit = sales_total - cogs_total - returns_total
//                + topup_profit + maintenance_revenue - expenses_total
//
// Note: returns_total IS subtracted (unlike the old code). This is correct because
// sales_total now includes 'partially_returned' invoices whose paid_amount < total_amount,
// so we must subtract the refunded portion. For full returns, paid_amount=0 so the entire
// total_amount is subtracted — net contribution to net_profit is 0, matching economic reality.
//
// [C-2 decision] No payment-fee term — fees are not tracked.
// ─────────────────────────────────────────────────────────────────────────────

import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';
import { assertClockNotTampered } from '@/lib/clockGuard';


export interface DayClosureSnapshot {
  closure_date: string;
  closed_at?: string;
  closed_by?: string | null;
  sales_total: number;
  cogs_total: number;
  discounts_total: number;
  gifts_value: number;
  returns_total: number;
  expenses_total: number;
  topup_profit: number;
  maintenance_revenue: number;
  inventory_adjustments_total: number;
  net_profit: number;
  notes?: string | null;
}

// ── D2.3 ────────────────────────────────────────────────────────────────────
export async function isDayClosed(date: string): Promise<boolean> {
  const rows = await dbClient.query(
    `SELECT 1 FROM day_closures WHERE closure_date = ? LIMIT 1`,
    [date]
  );
  return rows.length > 0;
}

// ── D2.1 ────────────────────────────────────────────────────────────────────
export async function getOpenDayPreview(targetDate: string): Promise<DayClosureSnapshot> {
  // C-5: include 'partially_returned' so partial-return invoices contribute their
  // gross sale to sales_total (previously filtered to status='active' only, hiding them).
  const [salesRow] = await dbClient.query(
    `SELECT
       COALESCE(SUM(total_amount), 0)    AS total,
       COALESCE(SUM(discount_amount), 0) AS discounts
     FROM invoices
     WHERE invoice_date = ? AND status IN ('active', 'partially_returned')`,
    [targetDate]
  );

  // C-5: cogs also includes 'partially_returned' (mirrors sales_total).
  // is_gift=0 filter excludes gifts (their cost is reported separately as gifts_value).
  const [cogsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status IN ('active', 'partially_returned')`,
    [targetDate]
  );

  // C-3 FIX: gifts_value uses unit_cost (not unit_price) so it reports the COST
  // of goods given as gifts, matching getReport.gift_cost in reports.ts.
  // Previously used unit_price which reported retail value, inconsistent with P&L.
  // C-5: include 'partially_returned' for consistency with sales_total.
  const [giftsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gifts
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status IN ('active', 'partially_returned') AND ii.is_gift = 1`,
    [targetDate]
  );

  // ME-A: partial_returns_total = total_amount - paid_amount for
  // partially_returned invoices.
  // C-5: this value IS now subtracted from net_profit (see formula below).
  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS returns_adjustment
     FROM invoices
     WHERE invoice_date = ? AND status = 'partially_returned'`,
    [targetDate]
  );

  const [expRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date = ?`,
    [targetDate]
  );

  // CR-B: include topup profit and maintenance revenue
  const [topupRow] = await dbClient.query(
    `SELECT COALESCE(SUM(profit), 0) AS topup_profit FROM topups WHERE topup_date = ?`,
    [targetDate]
  );

  const [mainRow] = await dbClient.query(
    `SELECT COALESCE(SUM(final_amount), 0) AS maintenance_revenue
     FROM maintenance_jobs
     WHERE status = 'delivered' AND substr(delivered_at, 1, 10) = ?`,
    [targetDate]
  );

  const [adjRow] = await dbClient.query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END), 0) AS total
     FROM ledger_entries
     WHERE ref_type = 'inventory_adjustment' AND entry_date = ?`,
    [targetDate]
  );

  const sales_total          = Number(salesRow?.total              ?? 0);
  const discounts_total      = Number(salesRow?.discounts          ?? 0);
  const cogs_total           = Number(cogsRow?.cogs                ?? 0);
  const gifts_value          = Number(giftsRow?.gifts              ?? 0);
  const partial_returns_total = Number(returnsRow?.returns_adjustment ?? 0);
  const expenses_total       = Number(expRow?.expenses             ?? 0);
  const topup_profit         = Number(topupRow?.topup_profit       ?? 0);
  const maintenance_revenue  = Number(mainRow?.maintenance_revenue ?? 0);
  const inventory_adjustments_total = Number(adjRow?.total            ?? 0);

  // C-5 CORRECTED FORMULA — aligned with getProfitAndLoss in reports.ts.
  // Old code: net = sales - cogs + topup + maintenance - expenses
  //           (with sales and cogs filtering status='active' only, and returns_total
  //            NOT subtracted — comment claimed "already excluded upstream").
  // Old formula was correct for full returns (excluded from sales/cogs, returns_total=0
  // for those invoices because they're already in 'returned' status, but the OLD
  // returns_total query DID include 'returned' status → so it was actually subtracting
  // returns_total in the query but not in the formula. The old comment was misleading.)
  //
  // New formula: sales_total includes 'partially_returned', so we MUST subtract
  // partial_returns_total (which captures partial refunds) to get net.
  // Full returns are already excluded from sales_total by status filter.
  // No payment-fee term (C-2 decision).
  const net_profit =
      sales_total
    - cogs_total
    - partial_returns_total
    + topup_profit
    + maintenance_revenue
    - expenses_total
    - inventory_adjustments_total;

  return {
    closure_date: targetDate,
    sales_total,
    cogs_total,
    discounts_total,
    gifts_value,
    returns_total: partial_returns_total,
    expenses_total,
    topup_profit,
    maintenance_revenue,
    inventory_adjustments_total,
    net_profit,
  };
}

// ── D2.2 ────────────────────────────────────────────────────────────────────
export async function closeDay(
  targetDate: string,
  cashCounts: { accountId: string; actualCash: number }[],
  notes?: string
): Promise<void> {
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const today = await assertClockNotTampered();
  if (targetDate > today) {
    throw new Error('لا يمكن إقفال يوم مستقبلي');
  }

  const alreadyClosed = await isDayClosed(targetDate);
  if (alreadyClosed) {
    throw new Error(`اليوم ${targetDate} مُقفَل مسبقاً`);
  }

  const closedAt = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];
  const reconciliationDetails: string[] = [];

  if (cashCounts.length > 0) {
    const accountIds = cashCounts.map(c => c.accountId);
    const accountRows = await dbClient.query(
      `SELECT id, name, balance FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
      accountIds
    );
    const acctMap = new Map<string, { name: string; balance: number }>(
      accountRows.map((a: any) => [a.id, { name: a.name, balance: a.balance }])
    );

    for (const cc of cashCounts) {
      const acct = acctMap.get(cc.accountId);
      if (!acct) continue;
      const diff = cc.actualCash - acct.balance;

      if (diff !== 0) {
        const entryType = diff > 0 ? 'credit' : 'debit';
        const description = `تسوية إقفال يومي: ${acct.name} — الفرق ${diff > 0 ? '+' : ''}${formatMoney(diff)}`;
        tx.push({
          sql: `INSERT INTO ledger_entries
                  (id, entry_date, account_id, account_name, type, amount,
                   ref_type, ref_id, description, created_at, updated_at, device_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            nanoid(), targetDate, cc.accountId, acct.name,
            entryType, Math.abs(diff), 'eod_reconciliation', null,
            description, closedAt, closedAt, deviceId,
          ],
        });
        reconciliationDetails.push(
          `${acct.name}: ${diff > 0 ? '+' : ''}${formatMoney(diff)}`
        );
      }

      // Atomic: single-statement UPDATE inside SQLite transaction.
      tx.push({
        sql: `UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`,
        params: [cc.actualCash, closedAt, cc.accountId],
      });
    }
  }

  const snapshot = await getOpenDayPreview(targetDate);

  tx.push({
    sql: `INSERT INTO day_closures
            (closure_date, closed_at, closed_by, sales_total, cogs_total,
             discounts_total, gifts_value, returns_total, expenses_total,
             topup_profit, maintenance_revenue,
             net_profit, notes, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      targetDate, closedAt, null,
      snapshot.sales_total, snapshot.cogs_total, snapshot.discounts_total,
      snapshot.gifts_value, snapshot.returns_total, snapshot.expenses_total,
      snapshot.topup_profit, snapshot.maintenance_revenue,
      snapshot.net_profit, notes || null, deviceId,
    ],
  });

  await dbClient.batchRun(tx);

  const auditDetail = [
    `تاريخ: ${targetDate}`,
    `مبيعات: ${formatMoney(snapshot.sales_total)}`,
    `تكلفة: ${formatMoney(snapshot.cogs_total)}`,
    `مصاريف: ${formatMoney(snapshot.expenses_total)}`,
    `شحن: ${formatMoney(snapshot.topup_profit)}`,
    `صيانة: ${formatMoney(snapshot.maintenance_revenue)}`,
    `صافي ربح: ${formatMoney(snapshot.net_profit)}`,
    ...(reconciliationDetails.length
      ? [`تسويات نقدية: ${reconciliationDetails.join(', ')}`]
      : []),
  ].join(' — ');

  await logAudit('إقفال_يومي', auditDetail, 'day_closure', targetDate);
}

// ── D2.4 ────────────────────────────────────────────────────────────────────
export async function reopenDay(date: string): Promise<void> {
  // CR-A: must reverse reconciliation entries and restore pre-closure balances
  const reconEntries = await dbClient.query(
    `SELECT id, account_id, type, amount FROM ledger_entries
     WHERE entry_date = ? AND ref_type = 'eod_reconciliation'`,
    [date]
  );

  const tx: { sql: string; params: any[] }[] = [];
  const now = new Date().toISOString();

  // For each reconciliation entry, reverse its balance effect
  for (const entry of reconEntries) {
    // Original credit → add to balance → reverse = subtract
    // Original debit → subtract from balance → reverse = add
    const op = entry.type === 'credit' ? '-' : '+';
    tx.push({
      sql: `UPDATE accounts SET balance = balance ${op} ?, updated_at = ? WHERE id = ?`,
      params: [entry.amount, now, entry.account_id],
    });
  }

  // Delete the reconciliation ledger rows
  if (reconEntries.length > 0) {
    const ids = reconEntries.map((e: any) => e.id);
    const placeholders = ids.map(() => '?').join(',');
    tx.push({
      sql: `DELETE FROM ledger_entries WHERE id IN (${placeholders})`,
      params: ids,
    });
  }

  // Delete the day_closures row
  tx.push({
    sql: `DELETE FROM day_closures WHERE closure_date = ?`,
    params: [date],
  });

  await dbClient.batchRun(tx);
  await logAudit('فتح_يوم_مقفل', date, 'day_closure', date);
}

// ── History ──────────────────────────────────────────────────────────────────
export async function getDayClosures(): Promise<(DayClosureSnapshot & { closed_at: string })[]> {
  return dbClient.query(`SELECT * FROM day_closures ORDER BY closure_date DESC`);
}
