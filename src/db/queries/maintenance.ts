import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { logAudit } from './audit';
import { formatMoney } from '@/lib/money';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';

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
     ON CONFLICT(name) DO UPDATE SET last_val = last_val + 1
     RETURNING last_val`,
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

export async function updateJobStatus(id: string, status: MaintenanceJob['status'], final_amount?: number, payment_account_id?: string) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
  const onlyDateStr = format(now, 'yyyy-MM-dd');
  const deviceId = getDeviceId();

  // HI-E: any status mutation that touches a closed day's row corrupts the snapshot.
  // Apply the guard universally — not only on delivery.
  if (await isDayClosed(onlyDateStr)) {
    throw new Error(`يوم ${onlyDateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  
  if (status === 'delivered') {
    if (final_amount === undefined || !payment_account_id) {
        throw new Error('Final amount and account are required for delivery');
    }

    // منع التسليم المزدوج
    const current = await dbClient.query('SELECT status, job_number FROM maintenance_jobs WHERE id = ?', [id]);
    if (!current.length) throw new Error('المهمة غير موجودة');
    if (current[0].status === 'delivered') {
      throw new Error('تم تسليم هذه المهمة مسبقاً');
    }

    const job_number = current[0].job_number || '';
    
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
  } else {
    // Other statuses don't need financial transactions
    await dbClient.run(
      `UPDATE maintenance_jobs SET status = ?, updated_at = ? WHERE id = ?`,
      [status, dateStr, id]
    );
  }
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
