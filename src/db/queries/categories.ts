import { dbClient } from '../client';
import { logAudit } from './audit';

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export async function getCategories(activeOnly = false): Promise<Category[]> {
  const sql = activeOnly
    ? `SELECT * FROM categories WHERE is_active = 1 AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`
    : `SELECT * FROM categories ORDER BY sort_order ASC, name ASC`;
  const rows = await dbClient.query(sql);
  return rows.map((r: any) => ({ ...r, is_active: r.is_active === 1 }));
}

export async function getDeletedCategories(): Promise<Category[]> {
  const rows = await dbClient.query(
    `SELECT * FROM categories WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return rows.map((r: any) => ({ ...r, is_active: r.is_active === 1 }));
}

export async function restoreCategory(id: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await dbClient.query(`SELECT name FROM categories WHERE id = ?`, [id]);
  const name = rows[0]?.name ?? id;
  await dbClient.run(
    `UPDATE categories SET is_active = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
  await logAudit('استعادة_عنصر', name, 'category', id);
}

export async function addCategory(data: {
  name: string;
  color: string;
  icon: string;
  sort_order: number;
}): Promise<string> {
  const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await dbClient.run(
    `INSERT INTO categories (id, name, color, icon, sort_order, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
    [id, data.name.trim(), data.color, data.icon, data.sort_order]
  );
  await logAudit('إضافة_فئة', `${data.name.trim()} — اللون: ${data.color}`, 'category', id);
  return id;
}

export async function updateCategory(
  id: string,
  data: Partial<{ name: string; color: string; icon: string; sort_order: number; is_active: boolean }>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined)       { fields.push('name = ?');       values.push(data.name.trim()); }
  if (data.color !== undefined)      { fields.push('color = ?');      values.push(data.color); }
  if (data.icon !== undefined)       { fields.push('icon = ?');       values.push(data.icon); }
  if (data.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(data.sort_order); }
  if (data.is_active !== undefined)  { fields.push('is_active = ?');  values.push(data.is_active ? 1 : 0); }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  await dbClient.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
  await logAudit('تعديل_فئة', `الفئة ${id} — الحقول: ${fields.map(f => f.split(' =')[0]).join('، ')}`, 'category', id);
}

export async function deleteCategory(id: string): Promise<void> {
  const linked = await dbClient.query(
    `SELECT COUNT(*) as count FROM products WHERE category = ? AND is_active = 1`,
    [id]
  );
  if (linked[0].count > 0) {
    throw new Error(
      `لا يمكن حذف هذه الفئة لأنها مرتبطة بـ ${linked[0].count} منتج نشط. انقلها إلى فئة أخرى أولاً أو أوقف الفئة.`
    );
  }
  const catRows = await dbClient.query(`SELECT name FROM categories WHERE id = ?`, [id]);
  const catName = catRows[0]?.name ?? id;
  const now = new Date().toISOString();
  await dbClient.run(
    `UPDATE categories SET is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
  await logAudit('حذف_فئة', catName, 'category', id);
}
