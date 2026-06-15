import { dbClient } from '../client';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';


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
  topup_profit: number;          // NEW
  maintenance_revenue: number;    // NEW
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
  const [salesRow] = await dbClient.query(
    `SELECT
       COALESCE(SUM(total_amount), 0)    AS total,
       COALESCE(SUM(discount_amount), 0) AS discounts
     FROM invoices
     WHERE invoice_date = ? AND status = 'active'`,
    [targetDate]
  );

  const [cogsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 0`,
    [targetDate]
  );

  const [giftsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_price * ii.quantity), 0) AS gifts
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 1`,
    [targetDate]
  );

  // ME-A: returns_adjustment = net revenue reduction from returned/partially_returned invoices.
  // For fully returned: paid_amount=0, so this reads total_amount (matches full refund).
  // For partially returned: paid_amount = remaining after refund, so this reads refund amount.
  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS returns_adjustment
     FROM invoices
     WHERE invoice_date = ? AND status IN ('returned', 'partially_returned')`,
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

  const sales_total          = Number(salesRow?.total              ?? 0);
  const discounts_total      = Number(salesRow?.discounts          ?? 0);
  const cogs_total           = Number(cogsRow?.cogs                ?? 0);
  const gifts_value          = Number(giftsRow?.gifts              ?? 0);
  const returns_total        = Number(returnsRow?.returns_adjustment ?? 0);
  const expenses_total       = Number(expRow?.expenses             ?? 0);
  const topup_profit         = Number(topupRow?.topup_profit       ?? 0);
  const maintenance_revenue  = Number(mainRow?.maintenance_revenue ?? 0);

  // CR-B: corrected formula
  // sales_total already excludes returned invoices (status='active' filter)
  // cogs_total already excludes gift items (is_gift=0 filter)
  // Therefore: net = (active sales - active COGS) + other income - expenses
  // Do NOT subtract returns_total or gifts_value again — already excluded upstream.
  const net_profit = sales_total - cogs_total + topup_profit + maintenance_revenue - expenses_total;

  return {
    closure_date: targetDate,
    sales_total,
    cogs_total,
    discounts_total,
    gifts_value,
    returns_total,
    expenses_total,
    topup_profit,
    maintenance_revenue,
    net_profit,
  };
}

// ── D2.2 ────────────────────────────────────────────────────────────────────
export async function closeDay(
  targetDate: string,
  cashCounts: { accountId: string; actualCash: number }[],
  notes?: string
): Promise<void> {
  const today = format(new Date(), 'yyyy-MM-dd');
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
