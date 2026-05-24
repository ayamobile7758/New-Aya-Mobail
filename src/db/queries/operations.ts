import { dbClient } from '../client';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { isDayClosed } from './closures';

export interface LedgerEntry {
  id: string;
  entry_date: string;
  account_id: string;
  account_name: string;
  type: 'debit' | 'credit';
  amount: number;
  ref_type: 'invoice' | 'expense' | 'topup' | 'transfer' | 'manual' | 'reconciliation' | 'maintenance' | 'eod_reconciliation' | 'inventory_adjustment';
  ref_id: string | null;
  description: string;
  created_at: string;
}

export async function getRecentLedgerEntries(limit = 100): Promise<LedgerEntry[]> {
  const query = `
    SELECT l.*, a.name as account_name 
    FROM ledger_entries l
    JOIN accounts a ON l.account_id = a.id
    ORDER BY l.created_at DESC
    LIMIT ?
  `;
  const results = await dbClient.query(query, [limit]);
  return results as LedgerEntry[];
}

export interface LedgerRow {
  id: string;
  entry_date: string;
  created_at: string;
  account_name: string | null;
  account_type: string | null;
  direction: 'credit' | 'debit';
  amount: number;
  ref_type: string | null;
  ref_id: string | null;
  description: string;
}

export async function getLedgerForPeriod(fromDate: string, toDate: string): Promise<LedgerRow[]> {
  return dbClient.query(
    `SELECT
       le.id,
       le.entry_date,
       le.created_at,
       a.name  AS account_name,
       a.type  AS account_type,
       le.type AS direction,
       le.amount,
       le.ref_type,
       le.ref_id,
       le.description
     FROM ledger_entries le
     LEFT JOIN accounts a ON le.account_id = a.id
     WHERE le.entry_date BETWEEN ? AND ?
     ORDER BY le.entry_date ASC, le.created_at ASC`,
    [fromDate, toDate]
  );
}

export async function getDailySummary(dateString?: string) {
  const targetDate = dateString || format(new Date(), 'yyyy-MM-dd');

  // Total Sales (active invoices only — exclude returned/cancelled)
  const salesResult = await dbClient.query(`
    SELECT SUM(total_amount) as total_sales, SUM(paid_amount) as paid_sales
    FROM invoices 
    WHERE invoice_date = ? AND status = 'active'
  `, [targetDate]);

  // Total Expenses
  const expResult = await dbClient.query(`
    SELECT SUM(amount) as total_expenses
    FROM expenses 
    WHERE expense_date = ?
  `, [targetDate]);

  // COGS: sum of (unit_cost * quantity) for active invoice items today
  const cogsResult = await dbClient.query(`
    SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.invoice_date = ? AND i.status = 'active'
  `, [targetDate]);

  // Cash Movement (Credit vs Debit in ledger) for the day
  // To get actual "Cash in Hand" change today
  const ledgerResult = await dbClient.query(`
    SELECT type, SUM(amount) as total
    FROM ledger_entries
    WHERE entry_date = ?
    GROUP BY type
  `, [targetDate]);

  const sales = salesResult[0]?.total_sales || 0;
  const paidSales = salesResult[0]?.paid_sales || 0;
  const expenses = expResult[0]?.total_expenses || 0;
  const cogs = cogsResult[0]?.cogs || 0;
  
  let totalIn = 0;
  let totalOut = 0;
  
  for (const row of ledgerResult) {
    if (row.type === 'credit') totalIn += row.total;
    if (row.type === 'debit') totalOut += row.total;
  }

  return {
    date: targetDate,
    sales,
    paidSales,
    expenses,
    cogs,
    totalIn,
    totalOut,
    netProfit: sales - cogs - expenses
  };
}

export async function createTopup({
  account_id,
  supplier_id,
  amount,
  cost,
  profit,
  notes
}: {
  account_id: string;
  supplier_id?: string;
  amount: number;
  cost: number;
  profit: number;
  notes?: string;
}) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  if (await isDayClosed(dateStr)) {
    throw new Error(`يوم ${dateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  const timestamp = now.toISOString();

  let supplier_name: string | null = null;
  if (supplier_id) {
    const sResult = await dbClient.query("SELECT name FROM suppliers WHERE id = ?", [supplier_id]);
    if (sResult.length > 0) supplier_name = sResult[0].name;
  }

  let account_name: string | null = null;
  const aResult = await dbClient.query("SELECT name FROM accounts WHERE id = ?", [account_id]);
  if (aResult.length > 0) account_name = aResult[0].name;
  
  let nextVal = 1;
  const seqResult = await dbClient.query("SELECT last_val FROM sequences WHERE name = 'topup'");
  if (seqResult.length > 0) nextVal = seqResult[0].last_val + 1;
  
  const topupNumber = `TOP-${format(now, 'yyMM')}-${nextVal.toString().padStart(4, '0')}`;
  const topupId = nanoid();

  const tx = [
    {
      sql: "UPDATE sequences SET last_val = ? WHERE name = 'topup'",
      params: [nextVal]
    },
    {
      sql: `INSERT INTO topups (id, topup_number, topup_date, account_id, account_name, supplier_id, supplier_name, amount, cost, profit, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [topupId, topupNumber, dateStr, account_id, account_name, supplier_id || null, supplier_name, amount, cost, profit, notes || null, timestamp]
    },
    {
      sql: `UPDATE accounts SET balance = balance + ? WHERE id = ?`,
      params: [amount, account_id]
    },
    {
      sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), dateStr, account_id, account_name, 'credit', amount, 'topup', topupId, `شحن رصيد: ${topupNumber}`, timestamp]
    }
  ];

  await dbClient.batchRun(tx);
  await logAudit(
    'شحن_جديد',
    `${topupNumber} — مبلغ ${amount / 100} د.أ — تكلفة ${cost / 100} د.أ — ربح ${profit / 100} د.أ`,
    'topup',
    topupId
  );
  return { id: topupId, topupNumber };
}

export async function createTransfer({
  from_account_id,
  to_account_id,
  amount,
  notes
}: {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  notes?: string;
}) {
  // منع التحويل من حساب لنفسه
  if (from_account_id === to_account_id) {
    throw new Error('لا يمكن التحويل من حساب لنفسه');
  }

  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  if (await isDayClosed(dateStr)) {
    throw new Error(`يوم ${dateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  const timestamp = now.toISOString();

  let from_account_name: string | null = null;
  let to_account_name: string | null = null;
  const accountsResult = await dbClient.query("SELECT id, name, balance FROM accounts WHERE id IN (?, ?)", [from_account_id, to_account_id]);
  accountsResult.forEach((a: any) => {
    if (a.id === from_account_id) from_account_name = a.name;
    if (a.id === to_account_id) to_account_name = a.name;
  });

  // التحقق من كفاية رصيد الحساب المحوَّل منه
  const fromAccount = accountsResult.find((a: any) => a.id === from_account_id);
  if (!fromAccount) throw new Error('حساب المصدر غير موجود');
  if (fromAccount.balance < amount) {
    throw new Error(
      `الرصيد غير كافٍ في ${from_account_name} (المتاح: ${fromAccount.balance / 100} د.أ)`
    );
  }

  let nextVal = 1;
  const seqResult = await dbClient.query("SELECT last_val FROM sequences WHERE name = 'transfer'");
  if (seqResult.length > 0) nextVal = seqResult[0].last_val + 1;
  
  const transferNumber = `TRF-${format(now, 'yyMM')}-${nextVal.toString().padStart(4, '0')}`;
  const transferId = nanoid();

  const tx = [
    {
      sql: "UPDATE sequences SET last_val = ? WHERE name = 'transfer'",
      params: [nextVal]
    },
    {
      sql: `INSERT INTO transfers (id, transfer_number, transfer_date, from_account_id, from_account_name, to_account_id, to_account_name, amount, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [transferId, transferNumber, dateStr, from_account_id, from_account_name, to_account_id, to_account_name, amount, notes || null, timestamp]
    },
    {
      sql: `UPDATE accounts SET balance = balance - ? WHERE id = ?`,
      params: [amount, from_account_id]
    },
    {
      sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), dateStr, from_account_id, from_account_name, 'debit', amount, 'transfer', transferId, `تحويل صادر: ${transferNumber}`, timestamp]
    },
    {
      sql: `UPDATE accounts SET balance = balance + ? WHERE id = ?`,
      params: [amount, to_account_id]
    },
    {
      sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), dateStr, to_account_id, to_account_name, 'credit', amount, 'transfer', transferId, `تحويل وارد: ${transferNumber}`, timestamp]
    }
  ];

  await dbClient.batchRun(tx);
  await logAudit(
    'تحويل_جديد',
    `${transferNumber} — من ${from_account_name} إلى ${to_account_name} — ${amount / 100} د.أ`,
    'transfer',
    transferId
  );
  return { id: transferId, transferNumber };
}

