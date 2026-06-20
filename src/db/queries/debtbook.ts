// src/db/queries/debtbook.ts
// =============================================================================
// DEBT BOOK QUERY LAYER
// ⛔ 100% SEPARATE FROM ALL FINANCIAL/ACCOUNTING LOGIC.
// =============================================================================

import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { assertClockNotTampered } from '@/lib/clockGuard';

export interface Debtor {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtItem {
  id: string;
  debtor_id: string;
  category: string;
  amount: number; // fils
  note: string | null;
  created_at: string;
}

export interface DebtPayment {
  id: string;
  debtor_id: string;
  amount: number; // fils
  paid_at: string;
  note: string | null;
}

export interface DebtorSummary extends Debtor {
  totalDebt: number;
  totalPaid: number;
  remaining: number;
  oldestUnpaidAt: string | null;
  itemCount: number;
}

export interface BookSummary {
  totalOutstanding: number;
  debtorCount: number;
  largestRemaining: { name: string; remaining: number } | null;
  oldestUnpaid: { name: string; date: string } | null;
  paidThisMonth: number;
  paidAllTime: number;
  avgPerDebtor: number;
  overdueCount: number;
}

/**
 * Lists all debtors and computes their debt summary details using JS.
 * Orders by remaining balance DESC (highest outstanding first).
 */
export async function listDebtors(): Promise<DebtorSummary[]> {
  const debtors = (await dbClient.query('SELECT * FROM debtbook_debtors')) as Debtor[];
  const items = (await dbClient.query('SELECT debtor_id, amount, created_at FROM debtbook_items ORDER BY created_at ASC')) as { debtor_id: string; amount: number; created_at: string }[];
  const payments = (await dbClient.query('SELECT debtor_id, amount FROM debtbook_payments')) as { debtor_id: string; amount: number }[];

  const itemsByDebtor: Record<string, typeof items> = {};
  const paymentsSumByDebtor: Record<string, number> = {};

  for (const item of items) {
    if (!itemsByDebtor[item.debtor_id]) {
      itemsByDebtor[item.debtor_id] = [];
    }
    itemsByDebtor[item.debtor_id].push(item);
  }

  for (const p of payments) {
    paymentsSumByDebtor[p.debtor_id] = (paymentsSumByDebtor[p.debtor_id] || 0) + p.amount;
  }

  const summaries: DebtorSummary[] = debtors.map(d => {
    const dItems = itemsByDebtor[d.id] || [];
    const totalPaid = paymentsSumByDebtor[d.id] || 0;
    const totalDebt = dItems.reduce((sum, item) => sum + item.amount, 0);
    const remaining = Math.max(0, totalDebt - totalPaid);

    // Compute oldestUnpaidAt using FIFO
    let oldestUnpaidAt: string | null = null;
    if (remaining > 0) {
      let paidLeft = totalPaid;
      for (const item of dItems) {
        const consumed = Math.min(paidLeft, item.amount);
        paidLeft -= consumed;
        const itemRemaining = item.amount - consumed;
        if (itemRemaining > 0) {
          oldestUnpaidAt = item.created_at;
          break;
        }
      }
    }

    return {
      ...d,
      totalDebt,
      totalPaid,
      remaining,
      oldestUnpaidAt,
      itemCount: dItems.length
    };
  });

  // Sort by remaining DESC (highest outstanding first), then by name
  return summaries.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
}

/**
 * Fetches debtor detail and computes per-item remaining balance using the FIFO algorithm.
 * 
 * FIFO Algorithm Worked Example:
 * - Items oldest->newest: تليفون 50, بطاقة 10, كفر 2 -> totalDebt = 62.
 * - Payments: 45 -> totalPaid = 45 -> remaining = 17.
 * - Per item: تليفون 50−45=5, بطاقة 10−0=10, كفر 2−0=2. Sum 5+10+2 = 17 ✓.
 * - Edge: pay 45 then pay 10 -> totalPaid 55 -> remaining 7 -> تليفون 0, بطاقة 5, كفر 2 ✓.
 * - Edge: overpay (pay 70) -> remaining clamps to 0, all items 0.
 */
export async function getDebtorDetail(id: string): Promise<{
  debtor: Debtor;
  items: (DebtItem & { remaining: number })[];
  payments: DebtPayment[];
  totalDebt: number;
  totalPaid: number;
  remaining: number;
}> {
  const debtorRows = (await dbClient.query('SELECT * FROM debtbook_debtors WHERE id = ?', [id])) as Debtor[];
  if (!debtorRows.length) {
    throw new Error('العميل غير موجود');
  }
  const debtor = debtorRows[0];

  const items = (await dbClient.query('SELECT * FROM debtbook_items WHERE debtor_id = ? ORDER BY created_at ASC', [id])) as DebtItem[];
  const payments = (await dbClient.query('SELECT * FROM debtbook_payments WHERE debtor_id = ? ORDER BY paid_at DESC', [id])) as DebtPayment[];

  const totalDebt = items.reduce((sum, item) => sum + item.amount, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, totalDebt - totalPaid);

  // Apply FIFO algorithm
  let paidLeft = totalPaid;
  const itemsWithRemaining = items.map(item => {
    const consumed = Math.min(paidLeft, item.amount);
    paidLeft -= consumed;
    return {
      ...item,
      remaining: Math.max(0, item.amount - consumed)
    };
  });

  return {
    debtor,
    items: itemsWithRemaining,
    payments,
    totalDebt,
    totalPaid,
    remaining
  };
}

export async function createDebtor(data: { name: string; phone?: string; notes?: string }): Promise<string> {
  await assertClockNotTampered();
  const id = nanoid();
  const now = new Date().toISOString();

  await dbClient.run(
    `INSERT INTO debtbook_debtors (id, name, phone, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.name, data.phone || null, data.notes || null, now, now]
  );

  return id;
}

export async function updateDebtor(id: string, data: { name: string; phone?: string; notes?: string }): Promise<void> {
  await assertClockNotTampered();
  const now = new Date().toISOString();

  await dbClient.run(
    `UPDATE debtbook_debtors
     SET name = ?, phone = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [data.name, data.phone || null, data.notes || null, now, id]
  );
}

export async function deleteDebtor(id: string): Promise<void> {
  await assertClockNotTampered();
  await dbClient.batchRun([
    { sql: 'DELETE FROM debtbook_payments WHERE debtor_id = ?', params: [id] },
    { sql: 'DELETE FROM debtbook_items WHERE debtor_id = ?', params: [id] },
    { sql: 'DELETE FROM debtbook_debtors WHERE id = ?', params: [id] }
  ]);
}

export async function addDebtItem(data: { debtor_id: string; category: string; amount: number; note?: string }): Promise<string> {
  if (data.amount <= 0) {
    throw new Error('يجب أن يكون مبلغ الدين أكبر من صفر');
  }
  await assertClockNotTampered();
  const id = nanoid();
  const now = new Date().toISOString();

  await dbClient.run(
    `INSERT INTO debtbook_items (id, debtor_id, category, amount, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.debtor_id, data.category, data.amount, data.note || null, now]
  );

  return id;
}

export async function deleteDebtItem(id: string): Promise<void> {
  await assertClockNotTampered();
  await dbClient.run('DELETE FROM debtbook_items WHERE id = ?', [id]);
}

export async function recordPayment(data: { debtor_id: string; amount: number; note?: string }): Promise<string> {
  if (data.amount <= 0) {
    throw new Error('يجب أن يكون مبلغ السداد أكبر من صفر');
  }
  await assertClockNotTampered();
  const id = nanoid();
  const now = new Date().toISOString();

  await dbClient.run(
    `INSERT INTO debtbook_payments (id, debtor_id, amount, paid_at, note)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.debtor_id, data.amount, now, data.note || null]
  );

  return id;
}

export async function deletePayment(id: string): Promise<void> {
  await assertClockNotTampered();
  await dbClient.run('DELETE FROM debtbook_payments WHERE id = ?', [id]);
}

/**
 * Computes global statistics for the Debt Book dashboard header.
 */
export async function getBookSummary(): Promise<BookSummary> {
  const summaries = await listDebtors();
  const outstandingDebtors = summaries.filter(d => d.remaining > 0);

  const totalOutstanding = outstandingDebtors.reduce((sum, d) => sum + d.remaining, 0);
  const debtorCount = outstandingDebtors.length;

  let largestRemaining: BookSummary['largestRemaining'] = null;
  if (debtorCount > 0) {
    const largest = outstandingDebtors[0]; // already sorted remaining DESC
    largestRemaining = {
      name: largest.name,
      remaining: largest.remaining
    };
  }

  let oldestUnpaid: BookSummary['oldestUnpaid'] = null;
  let oldestDate: string | null = null;

  for (const d of outstandingDebtors) {
    if (d.oldestUnpaidAt) {
      if (!oldestDate || d.oldestUnpaidAt < oldestDate) {
        oldestDate = d.oldestUnpaidAt;
        oldestUnpaid = {
          name: d.name,
          date: d.oldestUnpaidAt
        };
      }
    }
  }

  // Calculate payments stats
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const startOfMonthStr = startOfMonth.toISOString();

  const paidAllTimeRow = (await dbClient.query('SELECT SUM(amount) as total FROM debtbook_payments')) as { total: number | null }[];
  const paidThisMonthRow = (await dbClient.query('SELECT SUM(amount) as total FROM debtbook_payments WHERE paid_at >= ?', [startOfMonthStr])) as { total: number | null }[];

  const paidAllTime = paidAllTimeRow[0]?.total || 0;
  const paidThisMonth = paidThisMonthRow[0]?.total || 0;

  const avgPerDebtor = debtorCount > 0 ? Math.round(totalOutstanding / debtorCount) : 0;

  // Overdue count: debtor whose oldest unpaid item is older than 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const overdueCount = outstandingDebtors.filter(d => {
    if (!d.oldestUnpaidAt) return false;
    return new Date(d.oldestUnpaidAt).getTime() < thirtyDaysAgo;
  }).length;

  return {
    totalOutstanding,
    debtorCount,
    largestRemaining,
    oldestUnpaid,
    paidThisMonth,
    paidAllTime,
    avgPerDebtor,
    overdueCount
  };
}
