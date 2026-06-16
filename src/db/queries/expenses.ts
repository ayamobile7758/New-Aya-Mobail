import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { generateSequenceNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { logAudit } from './audit';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { formatMoney } from '@/lib/money';

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
  deleted_at?: string | null;
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

// ── Soft-delete an expense with full financial reversal ─────────────────────
// ME-D: gated by admin PIN at the UI layer. Credits the account back, writes
// a reversing ledger entry, and marks the row as deleted_at.
export async function deleteExpense(id: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) throw new Error('المصروف غير موجود أو محذوف مسبقاً');
  const exp = rows[0];

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Mark expense as deleted
  tx.push({
    sql: `UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    params: [now, now, id],
  });

  if (exp.account_id) {
    // 2. Credit the account back by the expense amount
    tx.push({
      sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      params: [exp.amount, now, exp.account_id],
    });

    // 3. Reverse ledger entry
    tx.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount,
               ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, exp.account_id, exp.account_name,
        'credit', exp.amount, 'expense', id,
        `حذف مصروف: ${exp.expense_number} — ${exp.description}`,
        now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(tx);
  await logAudit(
    'حذف_مصروف',
    `${exp.expense_number} — ${formatMoney(exp.amount)} — ${exp.description}`,
    'expense', id
  );
}

// ── Restore a soft-deleted expense — re-applies financial impact ────────────
// ME-D: includes a balance check before debiting the account so we never
// create a negative balance via restore.
export async function restoreExpense(id: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT * FROM expenses WHERE id = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  if (!rows.length) throw new Error('المصروف غير موجود أو غير محذوف');
  const exp = rows[0];

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // ME-D safety check: verify the account still has
  // enough balance before debiting. Otherwise restore creates a negative balance.
  if (exp.account_id) {
    const acctRows = await dbClient.query(
      `SELECT balance, name FROM accounts WHERE id = ?`,
      [exp.account_id]
    );
    if (!acctRows.length) {
      throw new Error('الحساب المرتبط بالمصروف لم يعد موجوداً');
    }
    if (acctRows[0].balance < exp.amount) {
      throw new Error(
        `الرصيد غير كافٍ في ${acctRows[0].name} لإعادة هذا المصروف ` +
        `(المطلوب: ${formatMoney(exp.amount)}, المتاح: ${formatMoney(acctRows[0].balance)})`
      );
    }
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Clear deleted_at
  tx.push({
    sql: `UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    params: [now, id],
  });

  if (exp.account_id) {
    // 2. Re-debit the account
    tx.push({
      sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
      params: [exp.amount, now, exp.account_id],
    });

    // 3. Re-apply ledger entry
    tx.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount,
               ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, exp.account_id, exp.account_name,
        'debit', exp.amount, 'expense', id,
        `استعادة مصروف: ${exp.expense_number} — ${exp.description}`,
        now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(tx);
  await logAudit(
    'استعادة_مصروف',
    `${exp.expense_number} — ${formatMoney(exp.amount)}`,
    'expense', id
  );
}

// ── Trash listing for the Settings → Trash tab ─────────────────────────────
export async function getDeletedExpenses(): Promise<Expense[]> {
  const results = await dbClient.query(
    `SELECT * FROM expenses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return results as Expense[];
}

export async function updateExpense(id: string, data: {
  amount: number;
  category_id: string;
  category_name: string;
  description: string;
  accountId: string;
  account_name: string;
}): Promise<void> {
  const { amount, category_id, category_name, description, accountId, account_name } = data;

  const rows = await dbClient.query(
    `SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) throw new Error('المصروف غير موجود أو محذوف مسبقاً');
  const exp = rows[0];

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const stmts: { sql: string; params: any[] }[] = [];

  // 1. Update expense record
  stmts.push({
    sql: `UPDATE expenses SET amount=?, category_id=?, category_name=?, description=?, account_id=?, account_name=?, updated_at=? WHERE id=?`,
    params: [amount, category_id, category_name, description, accountId, account_name, now, id]
  });

  const oldAccountId = exp.account_id;
  const newAccountId = accountId;

  if (oldAccountId === newAccountId) {
    if (newAccountId) {
      // CASE A - Same account
      const accResult = await dbClient.query('SELECT balance, name FROM accounts WHERE id = ?', [newAccountId]);
      if (!accResult.length) throw new Error('الحساب غير موجود');

      const diff = amount - exp.amount;
      if (diff > 0 && accResult[0].balance < diff) {
        throw new Error(`الرصيد غير كافٍ في ${accResult[0].name} (المتاح: ${accResult[0].balance / 100} د.أ)`);
      }

      // Update account balance
      stmts.push({
        sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        params: [diff, now, newAccountId]
      });

      // Write reversing credit for old
      stmts.push({
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), today, oldAccountId, exp.account_name, 'credit', exp.amount, 'expense', id,
          `تعديل مصروف (إلغاء): ${exp.expense_number}`, now, now, deviceId
        ]
      });

      // Write new debit for new
      stmts.push({
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), today, newAccountId, account_name, 'debit', amount, 'expense', id,
          `تعديل مصروف: ${exp.expense_number} — ${description}`, now, now, deviceId
        ]
      });
    }
  } else {
    // CASE B - Different account
    // Refund the OLD account
    if (oldAccountId) {
      stmts.push({
        sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
        params: [exp.amount, now, oldAccountId]
      });

      // Write reversing credit for old
      stmts.push({
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), today, oldAccountId, exp.account_name, 'credit', exp.amount, 'expense', id,
          `تعديل مصروف (إلغاء): ${exp.expense_number}`, now, now, deviceId
        ]
      });
    }

    // Charge the NEW account
    if (newAccountId) {
      const accResult = await dbClient.query('SELECT balance, name FROM accounts WHERE id = ?', [newAccountId]);
      if (!accResult.length) throw new Error('الحساب غير موجود');
      if (accResult[0].balance < amount) {
        throw new Error(`الرصيد غير كافٍ في ${accResult[0].name} (المتاح: ${accResult[0].balance / 100} د.أ)`);
      }

      stmts.push({
        sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        params: [amount, now, newAccountId]
      });

      // Write new debit for new
      stmts.push({
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), today, newAccountId, account_name, 'debit', amount, 'expense', id,
          `تعديل مصروف: ${exp.expense_number} — ${description}`, now, now, deviceId
        ]
      });
    }
  }

  await dbClient.batchRun(stmts);
  await logAudit('تعديل_مصروف', `${exp.expense_number} — ${exp.amount / 100} → ${amount / 100} د.أ`, 'expense', id);
}
