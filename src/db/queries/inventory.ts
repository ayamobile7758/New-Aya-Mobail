import { dbClient } from '../client';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { isDayClosed } from './closures';
import { getDeviceId } from '@/lib/device';
import { assertClockNotTampered } from '@/lib/clockGuard';

export async function createInventoryCount(items: { product_id: string; system_qty: number; actual_qty: number; reason: string }[], notes?: string) {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
  // C-9: clock-tampering guard — replaces bare `format(now, 'yyyy-MM-dd')`.
  const entryDate = await assertClockNotTampered();
  if (await isDayClosed(entryDate)) {
    throw new Error(`يوم ${entryDate} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  const countId = nanoid();
  const deviceId = getDeviceId();

  // Pre-fetch cost_price for all products in this count
  const productIds = items.map(i => i.product_id);
  const products = await dbClient.query(
    `SELECT id, cost_price FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
    productIds
  );
  const costMap = new Map<string, number>(products.map((p: any) => [p.id, p.cost_price ?? 0]));

  const tx: {sql: string, params: any[]}[] = [
    {
      sql: `INSERT INTO inventory_counts (id, count_date, status, notes, created_at, device_id) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [countId, dateStr, 'completed', notes || null, dateStr, deviceId]
    }
  ];

  for (const item of items) {
    tx.push({
      sql: `INSERT INTO inventory_count_items (id, inventory_count_id, product_id, system_qty, actual_qty, reason)
            VALUES (?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), countId, item.product_id, item.system_qty, item.actual_qty, item.reason || null]
    });

    // Update actual stock (integer — no toString)
    tx.push({
      sql: `UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?`,
      params: [item.actual_qty, new Date().toISOString(), item.product_id]
    });

    // Ledger entry for any discrepancy
    const diff = item.actual_qty - item.system_qty;
    const value = Math.abs(diff) * (costMap.get(item.product_id) || 0);
    if (diff !== 0 && value > 0) {
      const entryType = diff < 0 ? 'debit' : 'credit';
      tx.push({
        sql: `INSERT INTO ledger_entries
               (id, entry_date, account_id, account_name, type, amount,
                ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          nanoid(), entryDate, null, null,
          entryType, value, 'inventory_adjustment', countId,
          `تعديل مخزون: ${item.product_id} (${diff > 0 ? '+' : ''}${diff} وحدة)`,
          dateStr, dateStr, deviceId
        ]
      });
    }
  }

  await dbClient.batchRun(tx);

  await logAudit('جرد_مخزون', `جرد بتاريخ ${dateStr} — ${items.length} بند`, 'inventory_count', countId);

  return countId;
}

export async function getInventoryCounts() {
  const counts = await dbClient.query(`
    SELECT * FROM inventory_counts ORDER BY created_at DESC
  `);
  
  const result = [];
  for (const c of counts) {
    const items = await dbClient.query(`
      SELECT i.*, p.name as product_name 
      FROM inventory_count_items i
      JOIN products p ON i.product_id = p.id
      WHERE i.inventory_count_id = ?
    `, [c.id]);
    result.push({ ...c, items });
  }
  return result;
}

export async function createAccountReconciliation(account_id: string, actual_balance: number) {
  const now = new Date();
  // C-9: clock-tampering guard — replaces bare `format(now, 'yyyy-MM-dd')`.
  const dateStr = await assertClockNotTampered();
  if (await isDayClosed(dateStr)) {
    throw new Error(`يوم ${dateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  const timestamp = now.toISOString();
  const deviceId = getDeviceId();

  // Get current balance
  const accountResult = await dbClient.query(`SELECT balance FROM accounts WHERE id = ?`, [account_id]);
  if (!accountResult.length) throw new Error('Account not found');
  const system_balance = accountResult[0].balance;
  
  const diff = actual_balance - system_balance;

  if (diff === 0) return;

  const type = diff > 0 ? 'credit' : 'debit';
  const amount = Math.abs(diff);

  const tx = [
    {
      sql: `UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`,
      params: [actual_balance, timestamp, account_id]
    },
    {
      sql: `INSERT INTO ledger_entries (id, entry_date, account_id, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [nanoid(), dateStr, account_id, type, amount, 'reconciliation', null, 'تسوية حساب: تعديل الرصيد الفعلي', timestamp, timestamp, deviceId]
    }
  ];

  await dbClient.batchRun(tx);
  await logAudit(
    'تسوية_حساب',
    `الحساب ${account_id} — الرصيد النظامي ${system_balance / 100} د.أ — الفعلي ${actual_balance / 100} د.أ — الفرق ${diff / 100} د.أ`,
    'account',
    account_id
  );
}
