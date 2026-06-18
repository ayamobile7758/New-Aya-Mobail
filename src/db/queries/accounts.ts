import { dbClient } from '../client';
import { logAudit } from './audit';
import { nanoid } from 'nanoid';

export interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  fee_percent: number;
  module_scope: string | null;
  is_active: boolean;
}

export async function getActiveAccounts(): Promise<Account[]> {
  const query = `SELECT * FROM accounts WHERE is_active = 1 AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`;
  const results = await dbClient.query(query);
  return results.map(row => ({
    ...row,
    is_active: Boolean(row.is_active)
  }));
}

export async function getDeletedAccounts(): Promise<Account[]> {
  const results = await dbClient.query(
    `SELECT * FROM accounts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return results.map(row => ({ ...row, is_active: Boolean(row.is_active) }));
}

export async function restoreAccount(id: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await dbClient.query(`SELECT name FROM accounts WHERE id = ?`, [id]);
  const name = rows[0]?.name ?? id;
  await dbClient.run(
    `UPDATE accounts SET is_active = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
  await logAudit('استعادة_عنصر', name, 'account', id);
}

export async function createAccount(data: {
  name: string;
  type: 'cash' | 'card' | 'bank' | 'wallet';
  sort_order?: number;
}): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  const sortOrder = data.sort_order ?? 0;
  await dbClient.run(
    `INSERT INTO accounts (id, name, type, balance, fee_percent, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 1, ?, ?, ?)`,
    [id, data.name.trim(), data.type, sortOrder, now, now]
  );
  await logAudit('إضافة_حساب', data.name.trim(), 'account', id);
  return id;
}

export async function updateAccount(
  id: string,
  data: Partial<{
    name: string;
    type: 'cash' | 'card' | 'bank' | 'wallet';
    sort_order: number;
    is_active: boolean;
  }>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined)       { fields.push('name = ?');       values.push(data.name.trim()); }
  if (data.type !== undefined)       { fields.push('type = ?');       values.push(data.type); }
  if (data.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(data.sort_order); }
  if (data.is_active !== undefined)  { fields.push('is_active = ?');  values.push(data.is_active ? 1 : 0); }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  await dbClient.run(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, values);
  await logAudit('تعديل_حساب', `الحساب ${id} — الحقول: ${fields.map(f => f.split(' =')[0]).join('، ')}`, 'account', id);
}

export async function deactivateAccount(id: string): Promise<void> {
  const accountRows = await dbClient.query(`SELECT name, balance FROM accounts WHERE id = ?`, [id]);
  if (accountRows.length === 0) {
    throw new Error('الحساب غير موجود');
  }
  const account = accountRows[0];
  if (Number(account.balance) !== 0) {
    throw new Error('لا يمكن تعطيل حساب رصيده غير صفر. سوِّ الرصيد أولاً (حوّله إلى حساب آخر).');
  }

  const activeCountRows = await dbClient.query(
    `SELECT COUNT(*) as count FROM accounts WHERE is_active = 1 AND deleted_at IS NULL`
  );
  if (activeCountRows[0].count <= 1) {
    throw new Error('لا يمكن تعطيل آخر حساب نشط.');
  }

  const now = new Date().toISOString();
  await dbClient.run(
    `UPDATE accounts SET is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
  await logAudit('تعطيل_حساب', account.name, 'account', id);
}
