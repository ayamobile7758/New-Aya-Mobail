import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { logAudit } from './audit';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';

export interface ExpenseCategory {
  id: string;
  name: string;
  type: 'fixed' | 'variable';
  is_active: boolean;
  sort_order: number;
}

export interface Expense {
  id: string;
  expense_number: string;
  amount: number;
  category_id: string;
  category_name: string;
  description: string;
  account_id: string;
  account_name: string;
  expense_date: string;
  notes: string | null;
  created_at: string;
}

export async function getExpenseCategories(includeInactive = false): Promise<ExpenseCategory[]> {
  const query = includeInactive 
    ? 'SELECT * FROM expense_categories ORDER BY sort_order, name'
    : 'SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY sort_order, name';
  const results = await dbClient.query(query);
  return results as ExpenseCategory[];
}

export async function addExpenseCategory(data: Omit<ExpenseCategory, 'id' | 'is_active'>) {
  const id = nanoid();
  await dbClient.query(
    `INSERT INTO expense_categories (id, name, type, sort_order) VALUES (?, ?, ?, ?)`,
    [id, data.name, data.type, data.sort_order]
  );
}

export async function updateExpenseCategory(id: string, data: Partial<ExpenseCategory>) {
  const updates: string[] = [];
  const params: any[] = [];
  
  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.type !== undefined) { updates.push('type = ?'); params.push(data.type); }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active ? 1 : 0); }
  if (data.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(data.sort_order); }
  
  if (updates.length === 0) return;
  
  params.push(id);
  await dbClient.query(`UPDATE expense_categories SET ${updates.join(', ')} WHERE id = ?`, params);
}


export async function addExpense(data: {
  amount: number;
  category_id: string;
  category_name: string;
  description: string;
  accountId: string;
  account_name: string;
}) {
  const { amount, category_id, category_name, description, accountId, account_name } = data;

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // التحقق من كفاية الرصيد قبل الخصم
  const accResult = await dbClient.query('SELECT balance, name FROM accounts WHERE id = ?', [accountId]);
  if (!accResult.length) throw new Error('الحساب غير موجود');
  if (accResult[0].balance < amount) {
    throw new Error(
      `الرصيد غير كافٍ في ${accResult[0].name} (المتاح: ${accResult[0].balance / 100} د.أ)`
    );
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  
  // Get sequence — atomic: ON CONFLICT increments and returns new value
  const seqRow = await dbClient.query(
    `INSERT INTO sequences (name, last_val) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET last_val = last_val + 1
     RETURNING last_val`,
    ['expense']
  );
  const nextVal = seqRow[0].last_val;

  const expenseNumber = generateSequenceNumber('EXP', nextVal - 1, 5);

  const stmts: {sql: string, params: any[]}[] = [];

  // 1. Create expense record
  stmts.push({
    sql: `INSERT INTO expenses (id, expense_number, amount, category_id, category_name, description, account_id, account_name, expense_date, created_at, updated_at, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, expenseNumber, amount, category_id, category_name, description, accountId, account_name, today, now, now, deviceId]
  });
  
  // 2. Remove from account — Atomic: single-statement UPDATE inside SQLite transaction.
  stmts.push({
    sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
    params: [amount, now, accountId]
  });
  
  // 3. Ledger entry
  stmts.push({
    sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      nanoid(), today, accountId, account_name, 'debit', amount, 'expense', id, 
      `مصروف: ${description}`, now, now, deviceId
    ]
  });
  
  await dbClient.batchRun(stmts);
  await logAudit(
    'مصروف_جديد',
    `${expenseNumber} — ${amount / 100} د.أ — ${description}`,
    'expense',
    id
  );
  return id;
}

export async function getFilteredExpenses(startDate?: string, endDate?: string, limit: number | null = 100): Promise<Expense[]> {
  let query = `SELECT * FROM expenses WHERE deleted_at IS NULL`;
  const params: any[] = [];
  
  if (startDate && endDate) {
    query += ` AND expense_date BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  } else if (startDate) {
    query += ` AND expense_date >= ?`;
    params.push(startDate);
  } else if (endDate) {
    query += ` AND expense_date <= ?`;
    params.push(endDate);
  }
  
  query += ` ORDER BY created_at DESC`;
  
  if (limit !== null) {
    query += ` LIMIT ?`;
    params.push(limit);
  }
  
  const results = await dbClient.query(query, params);
  return results as Expense[];
}
