import { dbClient } from '../client';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { getDeviceId } from '@/lib/device';

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

  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS returns
     FROM invoices
     WHERE invoice_date = ? AND status IN ('returned', 'partially_returned')`,
    [targetDate]
  );

  const [expRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date = ?`,
    [targetDate]
  );

  const sales_total    = Number(salesRow?.total    ?? 0);
  const discounts_total = Number(salesRow?.discounts ?? 0);
  const cogs_total     = Number(cogsRow?.cogs       ?? 0);
  const gifts_value    = Number(giftsRow?.gifts      ?? 0);
  const returns_total  = Number(returnsRow?.returns  ?? 0);
  const expenses_total = Number(expRow?.expenses     ?? 0);
  const net_profit     = sales_total - cogs_total - expenses_total;

  return {
    closure_date: targetDate,
    sales_total,
    cogs_total,
    discounts_total,
    gifts_value,
    returns_total,
    expenses_total,
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
        const description = `تسوية إقفال يومي: ${acct.name} — الفرق ${diff > 0 ? '+' : ''}${diff / 100} د.أ`;
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
          `${acct.name}: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(3)} د.أ`
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
             discounts_total, gifts_value, returns_total, expenses_total, net_profit, notes, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      targetDate, closedAt, null,
      snapshot.sales_total, snapshot.cogs_total, snapshot.discounts_total,
      snapshot.gifts_value, snapshot.returns_total, snapshot.expenses_total,
      snapshot.net_profit, notes || null, deviceId,
    ],
  });

  await dbClient.batchRun(tx);

  const auditDetail = [
    `تاريخ: ${targetDate}`,
    `مبيعات: ${(snapshot.sales_total / 100).toFixed(3)} د.أ`,
    `تكلفة: ${(snapshot.cogs_total / 100).toFixed(3)} د.أ`,
    `مصاريف: ${(snapshot.expenses_total / 100).toFixed(3)} د.أ`,
    `صافي ربح: ${(snapshot.net_profit / 100).toFixed(3)} د.أ`,
    ...(reconciliationDetails.length
      ? [`تسويات نقدية: ${reconciliationDetails.join(', ')}`]
      : []),
  ].join(' — ');

  await logAudit('إقفال_يومي', auditDetail, 'day_closure', targetDate);
}

// ── D2.4 ────────────────────────────────────────────────────────────────────
export async function reopenDay(date: string): Promise<void> {
  await dbClient.run(`DELETE FROM day_closures WHERE closure_date = ?`, [date]);
  await logAudit('فتح_يوم_مقفل', date, 'day_closure', date);
}

// ── History ──────────────────────────────────────────────────────────────────
export async function getDayClosures(): Promise<(DayClosureSnapshot & { closed_at: string })[]> {
  return dbClient.query(`SELECT * FROM day_closures ORDER BY closure_date DESC`);
}
