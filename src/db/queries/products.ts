import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: 'device' | 'sim' | 'service_general' | 'service_repair' | 'accessory' | 'package';
  sale_price: number;
  cost_price: number;
  stock_qty: number;
  min_stock: number;
  track_stock: boolean;
  is_quick_add: boolean;
  is_active: boolean;
  notes: string | null;
  image_path?: string | null;
  icon?: string;
  deleted_at?: string | null;
}

export async function getActiveProducts(search?: string, category?: string): Promise<Product[]> {
  let query = `SELECT * FROM products WHERE is_active = 1 AND deleted_at IS NULL`;
  const params: any[] = [];
  
  if (category && category !== 'all') {
    query += ` AND category = ?`;
    params.push(category);
  }
  
  if (search) {
    query += ` AND (name LIKE ? OR sku LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` ORDER BY is_quick_add DESC, name ASC;`;
  
  const results = await dbClient.query(query, params);
  
  return results.map(row => ({
    ...row,
    cost_price: row.cost_price ?? 0,
    track_stock: Boolean(row.track_stock),
    is_quick_add: Boolean(row.is_quick_add),
    is_active: Boolean(row.is_active)
  }));
}

export async function getAllProducts(search?: string, category?: string, showInactive = false): Promise<Product[]> {
  let query = `SELECT * FROM products WHERE deleted_at IS NULL`;
  const params: any[] = [];
  
  if (!showInactive) {
    query += ` AND is_active = 1`;
  }
  
  if (category && category !== 'all') {
    query += ` AND category = ?`;
    params.push(category);
  }
  
  if (search) {
    query += ` AND (name LIKE ? OR sku LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` ORDER BY name ASC;`;
  
  const results = await dbClient.query(query, params);
  
  return results.map(row => ({
    ...row,
    cost_price: row.cost_price ?? 0,
    track_stock: Boolean(row.track_stock),
    is_quick_add: Boolean(row.is_quick_add),
    is_active: Boolean(row.is_active)
  }));
}

export async function getLowStockProducts(): Promise<Product[]> {
  const results = await dbClient.query(
    `SELECT * FROM products
     WHERE is_active = 1 AND deleted_at IS NULL AND track_stock = 1 AND stock_qty <= min_stock
     ORDER BY stock_qty ASC`,
    []
  );
  return results.map(row => ({
    ...row,
    cost_price: row.cost_price ?? 0,
    track_stock: Boolean(row.track_stock),
    is_quick_add: Boolean(row.is_quick_add),
    is_active: Boolean(row.is_active),
  }));
}

export async function addProduct(data: Omit<Product, 'id' | 'is_active'>) {
  const id = nanoid();
  const now = new Date().toISOString();
  
  try {
    await dbClient.run(
      `INSERT INTO products (id, name, sku, category, sale_price, cost_price, stock_qty, min_stock, track_stock, is_quick_add, is_active, notes, image_path, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [
        id, data.name, data.sku || null, data.category, data.sale_price,
        data.cost_price ?? 0,
        data.stock_qty, data.min_stock, data.track_stock ? 1 : 0,
        data.is_quick_add ? 1 : 0, data.notes || null, data.image_path || null, data.icon || 'Box', now, now
      ]
    );
    await logAudit(
      'إضافة_منتج',
      `${data.name} — السعر ${data.sale_price / 100} د.أ — التكلفة ${(data.cost_price ?? 0) / 100} د.أ`,
      'product',
      id
    );
    return id;
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint failed: products.sku')) {
      throw new Error('رمز الباركود (SKU) مستخدم مسبقاً لصنف آخر');
    }
    throw err;
  }
}

export async function updateProduct(id: string, data: Partial<Omit<Product, 'id'>>) {
  const now = new Date().toISOString();
  const updates: string[] = [];
  const params: any[] = [];

  // Capture old price for audit log
  let oldSalePrice: number | undefined;
  if (data.sale_price !== undefined) {
    const rows = await dbClient.query(`SELECT name, sale_price FROM products WHERE id = ?`, [id]);
    if (rows.length > 0) oldSalePrice = rows[0].sale_price;
  }

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updates.push(`${key} = ?`);
      if (typeof value === 'boolean') {
        params.push(value ? 1 : 0);
      } else {
        params.push(value);
      }
    }
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = ?`);
  params.push(now);
  params.push(id);

  try {
    await dbClient.run(
      `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (data.sale_price !== undefined && oldSalePrice !== undefined && data.sale_price !== oldSalePrice) {
      const rows = await dbClient.query(`SELECT name FROM products WHERE id = ?`, [id]);
      const productName = rows[0]?.name ?? id;
      await logAudit(
        'تعديل_سعر_منتج',
        `${productName}: ${oldSalePrice / 100} → ${data.sale_price / 100} د.أ`,
        'product', id
      );
    }
    const nonPriceKeys = Object.keys(data).filter(k => k !== 'sale_price' && k !== 'cost_price');
    if (nonPriceKeys.length > 0) {
      const pRows = await dbClient.query(`SELECT name FROM products WHERE id = ?`, [id]);
      await logAudit(
        'تعديل_منتج',
        `${pRows[0]?.name ?? id}: تعديل الحقول — ${nonPriceKeys.join('، ')}`,
        'product', id
      );
    }
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint failed: products.sku')) {
      throw new Error('رمز الباركود (SKU) مستخدم مسبقاً لصنف آخر');
    }
    throw err;
  }
}

export async function getDeletedProducts(): Promise<Product[]> {
  const results = await dbClient.query(
    `SELECT * FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return results.map(row => ({
    ...row,
    cost_price: row.cost_price ?? 0,
    track_stock: Boolean(row.track_stock),
    is_quick_add: Boolean(row.is_quick_add),
    is_active: Boolean(row.is_active),
  }));
}

export async function restoreProduct(id: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await dbClient.query(`SELECT name FROM products WHERE id = ?`, [id]);
  const name = rows[0]?.name ?? id;
  await dbClient.run(
    `UPDATE products SET is_active = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
  await logAudit('استعادة_عنصر', name, 'product', id);
}

export async function toggleProductActive(id: string, isActive: boolean) {
  const now = new Date().toISOString();
  await dbClient.run(
    `UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?`,
    [isActive ? 1 : 0, now, id]
  );
  await logAudit(
    isActive ? 'تفعيل_منتج' : 'تعطيل_منتج',
    `المنتج ${id}`,
    'product',
    id
  );
}

export async function deleteProduct(id: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await dbClient.query(`SELECT name FROM products WHERE id = ?`, [id]);
  const name = rows[0]?.name ?? id;
  await dbClient.run(
    `UPDATE products SET is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
  await logAudit('حذف_منتج', name, 'product', id);
}
