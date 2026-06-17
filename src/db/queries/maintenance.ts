// src/db/queries/maintenance.ts
// =============================================================================
// BUNDLE 4 — Maintenance reversal + day-closed guard (C-7)
// HEAD: b6c491e
//
// FIX SUMMARY (C-7):
//   - When a job transitions FROM 'delivered' TO any non-delivered status
//     (e.g. 'cancelled', 'ready', 'in_progress', 'new'), reverse the financial
//     impact of the original delivery:
//       * Debit the account by the original final_amount (reverse the credit).
//       * Write a reversing ledger entry (debit) with ref_type='maintenance'.
//       * Clear delivered_at, final_amount, payment_account_id.
//   - Keep the existing double-delivery guard (prev.status === 'delivered'
//     throws on re-delivery attempt). After a cancel-reversal, prev.status is
//     no longer 'delivered', so the job CAN be re-delivered later.
//   - The HI-E day-closed guard at the top is preserved (applies to all
//     branches, including the new reversal branch).
// =============================================================================

import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { logAudit } from './audit';
import { formatMoney } from '@/lib/money';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { assertClockNotTampered } from '@/lib/clockGuard';

export interface MaintenanceJob {
  id: string;
  job_number: string;
  job_date: string;
  customer_name: string;
  customer_phone: string | null;
  device_type: string;
  issue_description: string;
  status: 'new' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  estimated_cost: number | null;
  final_amount: number | null;
  payment_account_id: string | null;
  notes: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getJobs(status?: string, keyword?: string): Promise<MaintenanceJob[]> {
  let query = 'SELECT * FROM maintenance_jobs WHERE deleted_at IS NULL';
  const params: any[] = [];

  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  if (keyword) {
    query += ' AND (job_number LIKE ? OR customer_name LIKE ? OR device_type LIKE ?)';
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
  }

  query += ' ORDER BY created_at DESC';

  const results = await dbClient.query(query, params);
  return results as MaintenanceJob[];
}

export async function addJob(data: {
  job_date: string;
  customer_name: string;
  customer_phone: string;
  device_type: string;
  issue_description: string;
  estimated_cost: number;
  notes: string;
}) {
  const id = nanoid();
  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  // Get sequence — atomic: ON CONFLICT increments and returns new value
  const seqRow = await dbClient.query(
    `INSERT INTO sequences (name, last_val) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET last_val = sequences.last_val + 1
     RETURNING sequences.last_val`,
    ['maintenance']
  );
  const nextVal = seqRow[0].last_val;

  const jobNumber = generateSequenceNumber('REP', nextVal - 1, 5);

  const stmts: {sql: string, params: any[]}[] = [];

  stmts.push({
    sql: `INSERT INTO maintenance_jobs
      (id, job_number, job_date, customer_name, customer_phone, device_type, issue_description, estimated_cost, status, notes, created_at, updated_at, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
    params: [
      id, jobNumber, data.job_date, data.customer_name, data.customer_phone || null,
      data.device_type, data.issue_description, data.estimated_cost,
      data.notes || null, now, now, deviceId
    ]
  });

  await dbClient.batchRun(stmts);
  return id;
}

export async function updateJobStatus(
  id: string,
  status: MaintenanceJob['status'],
  final_amount?: number,
  payment_account_id?: string
) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
  // C-9: clock-tampering guard — replaces bare `format(new Date(), 'yyyy-MM-dd')`.
  const onlyDateStr = await assertClockNotTampered();
  const deviceId = getDeviceId();

  // HI-E: any status mutation that touches a closed day's row corrupts the snapshot.
  // Apply the guard universally — not only on delivery, but also on reversal.
  if (await isDayClosed(onlyDateStr)) {
    throw new Error(`يوم ${onlyDateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // C-7: fetch current state ONCE to detect transitions FROM 'delivered'.
  // (Previously this query was only inside the delivery branch — now we need
  // it for the reversal branch too, so we hoist it to the top.)
  const current = await dbClient.query(
    'SELECT status, job_number, final_amount, payment_account_id, delivered_at FROM maintenance_jobs WHERE id = ?',
    [id]
  );
  if (!current.length) throw new Error('المهمة غير موجودة');
  const prev = current[0];
  const job_number = prev.job_number || '';

  // ── Branch 1: deliver (status === 'delivered') ─────────────────────────────
  if (status === 'delivered') {
    if (final_amount === undefined || !payment_account_id) {
      throw new Error('المبلغ النهائي والحساب مطلوبان للتسليم');
    }

    // منع التسليم المزدوج — keep the existing guard intact.
    if (prev.status === 'delivered') {
      throw new Error('تم تسليم هذه المهمة مسبقاً');
    }

    const accountResult = await dbClient.query("SELECT name FROM accounts WHERE id = ?", [payment_account_id]);
    const account_name = accountResult[0]?.name || null;

    const tx = [
      {
        sql: `UPDATE maintenance_jobs SET status = ?, updated_at = ?, delivered_at = ?, final_amount = ?, payment_account_id = ? WHERE id = ?`,
        params: [status, dateStr, dateStr, final_amount, payment_account_id, id]
      },
      // Atomic: single-statement UPDATE inside SQLite transaction.
      {
        sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
        params: [final_amount, dateStr, payment_account_id]
      },
      {
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [nanoid(), onlyDateStr, payment_account_id, account_name, 'credit', final_amount, 'maintenance', id, `إيراد صيانة: ${job_number}`, dateStr, dateStr, deviceId]
      }
    ];
    await dbClient.batchRun(tx);

    await logAudit('تسليم_صيانة', `تسليم مهمة ${job_number} بمبلغ ${formatMoney(final_amount)}`, 'maintenance', id);
    return;
  }

  // ── Branch 2: C-7 NEW — reverse a prior delivery when transitioning
  // FROM 'delivered' TO any non-delivered status ('cancelled', 'ready',
  // 'in_progress', 'new'). At this point TypeScript has narrowed `status`
  // to exclude 'delivered' (Branch 1 returned early on that case), so we
  // only need to check prev.status. ────────────────────────────────────────
  if (prev.status === 'delivered') {
    const prevAccountId = prev.payment_account_id;
    const prevAmount = prev.final_amount ?? 0;

    const tx: { sql: string; params: any[] }[] = [
      {
        // C-7: clear delivered_at, final_amount, payment_account_id so the job
        // returns to a "not yet delivered" state. The new status is applied.
        sql: `UPDATE maintenance_jobs
              SET status = ?, updated_at = ?, delivered_at = NULL, final_amount = NULL, payment_account_id = NULL
              WHERE id = ?`,
        params: [status, dateStr, id]
      },
    ];

    if (prevAccountId && prevAmount > 0) {
      // Reverse the account credit (debit it back by the original amount).
      tx.push({
        sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        params: [prevAmount, dateStr, prevAccountId]
      });

      // Fetch the account name for the reversing ledger entry.
      const acctRows = await dbClient.query('SELECT name FROM accounts WHERE id = ?', [prevAccountId]);
      const account_name = acctRows[0]?.name || null;

      // Write a reversing ledger entry (debit) with ref_type='maintenance'.
      tx.push({
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), onlyDateStr, prevAccountId, account_name,
          'debit', prevAmount, 'maintenance', id,
          `إلغاء تسليم مهمة صيانة: ${job_number}`,
          dateStr, dateStr, deviceId
        ]
      });
    }

    await dbClient.batchRun(tx);
    await logAudit(
      'إلغاء_تسليم_صيانة',
      `إلغاء تسليم مهمة ${job_number} — عكس المبلغ ${formatMoney(prevAmount)}`,
      'maintenance',
      id
    );
    return;
  }

  // ── Branch 3: ordinary status change (no financial impact) ─────────────────
  // Both prev.status and status are non-delivered (e.g. new→in_progress,
  // in_progress→ready, ready→cancelled, new→cancelled). No ledger or account
  // changes needed — this is the original "else" branch.
  await dbClient.run(
    `UPDATE maintenance_jobs SET status = ?, updated_at = ? WHERE id = ?`,
    [status, dateStr, id]
  );
}

export async function getDeletedJobs(): Promise<MaintenanceJob[]> {
  const results = await dbClient.query(
    `SELECT * FROM maintenance_jobs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return results as MaintenanceJob[];
}

export async function restoreJob(id: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await dbClient.query(
    `SELECT job_number, customer_name FROM maintenance_jobs WHERE id = ?`,
    [id]
  );
  const label = rows[0] ? `${rows[0].job_number} — ${rows[0].customer_name}` : id;
  await dbClient.run(
    `UPDATE maintenance_jobs SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
  await logAudit('استعادة_عنصر', label, 'maintenance', id);
}
