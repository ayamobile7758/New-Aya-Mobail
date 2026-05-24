import { dbClient } from '../client';
import { logAudit } from './audit';

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
