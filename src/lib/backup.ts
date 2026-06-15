import { set } from 'idb-keyval';
import { dbClient, isSupabaseMode } from '@/db/client';
import { logAudit } from '@/db/queries/audit';

const LAST_BACKUP_KEY = 'pos_last_backup_time';

export const getBackupInfo = () => {
  if (isSupabaseMode()) return { lastBackupTime: null, isOverdue: false };

  const lastBackupStr = localStorage.getItem(LAST_BACKUP_KEY);
  if (!lastBackupStr) return { lastBackupTime: null, isOverdue: true };

  const lastBackupTime = parseInt(lastBackupStr, 10);
  const now = Date.now();
  const hoursSinceLastBackup = (now - lastBackupTime) / (1000 * 60 * 60);

  return {
    lastBackupTime,
    isOverdue: hoursSinceLastBackup >= 24
  };
};

export const exportDb = async (): Promise<void> => {
  if (isSupabaseMode()) {
    throw new Error('النسخ الاحتياطي المحلي غير مدعوم في الوضع السحابي. بياناتك محفوظة تلقائياً.');
  }
  const dbData = await dbClient.exportDatabase();
  const blob = new Blob([dbData], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  a.download = `backup-${datePart}-${timePart}.db`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const ts = Date.now();
  localStorage.setItem(LAST_BACKUP_KEY, ts.toString());
  await set(LAST_BACKUP_KEY, ts);
};

export const performBackup = exportDb;

export const importDb = async (file: File): Promise<void> => {
  if (isSupabaseMode()) {
    throw new Error('استعادة النسخ الاحتياطي المحلي غير مدعومة في الوضع السحابي.');
  }
  // أ) تحقّق من header SQLite
  const headerBuffer = await file.slice(0, 16).arrayBuffer();
  const header = new TextDecoder('utf-8').decode(headerBuffer);
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('الملف ليس قاعدة بيانات صحيحة');
  }

  // ب) أخذ نسخة احتياطية تلقائية من القاعدة الحالية
  await exportDb();

  // احتفظ بالبيانات القديمة في الذاكرة للطوارئ
  const oldData = await dbClient.exportDatabase();

  // ج) استبدل القاعدة الحالية بالملف الجديد
  const newBuffer = await file.arrayBuffer();
  await dbClient.importDatabase(new Uint8Array(newBuffer));

  // د) تحقق من سلامة القاعدة الجديدة
  try {
    const rows = await dbClient.query('PRAGMA integrity_check');
    const isOk = rows.length === 1 && (rows[0] as any).integrity_check === 'ok';
    if (!isOk) {
      await dbClient.importDatabase(oldData);
      throw new Error('فشل فحص سلامة قاعدة البيانات — تمت استعادة القاعدة الأصلية');
    }
  } catch (e: any) {
    if (e.message.includes('فشل فحص سلامة')) throw e;
    await dbClient.importDatabase(oldData);
    throw new Error('فشل فحص سلامة قاعدة البيانات: ' + e.message);
  }

  // هـ) سجّل التدقيق ثم أعد تحميل التطبيق
  await logAudit('استعادة_نسخة_احتياطية', `تم استعادة قاعدة البيانات من ملف: ${file.name}`);
  window.location.reload();
};
