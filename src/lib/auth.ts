import { get, set } from 'idb-keyval';
import { logAudit } from '@/db/queries/audit';
import { dbClient, isSupabaseMode } from '@/db/client';
import { getDeviceId } from '@/lib/device';

// Uses PBKDF2 with SHA-256, 200,000 iterations, 16-byte salt
async function deriveKey(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const saltArray = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltArray,
      iterations: 200000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 32 bytes
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashCode(code: string): Promise<{ hash: string, salt: string }> {
  const saltArray = new Uint8Array(16);
  crypto.getRandomValues(saltArray);
  const saltHex = Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const hash = await deriveKey(code, saltHex);
  return { hash, salt: saltHex };
}

export async function verifyCode(code: string, stored: { hash: string, salt: string }): Promise<boolean> {
  const hashToVerify = await deriveKey(code, stored.salt);
  return hashToVerify === stored.hash;
}

// Internal helpers for reading and writing app_settings
export async function readSetting(key: string): Promise<any | null> {
  if (isSupabaseMode()) {
    try {
      const rows = await dbClient.query('SELECT value FROM app_settings WHERE key = ?', [key]);
      if (rows && rows.length > 0) {
        const val = JSON.parse(rows[0].value);
        await set('cache_' + key, val);
        return val;
      }
      return null;
    } catch (err) {
      console.warn(`Failed to read central setting ${key}, falling back to cache:`, err);
      const cached = await get('cache_' + key);
      return cached !== undefined ? cached : null;
    }
  } else {
    const localVal = await get(key);
    return localVal !== undefined ? localVal : null;
  }
}

export async function writeSetting(key: string, value: any): Promise<void> {
  if (isSupabaseMode()) {
    const valueStr = JSON.stringify(value);
    const nowStr = new Date().toISOString();
    const deviceId = getDeviceId();
    
    await dbClient.query(
      `INSERT INTO app_settings (key, value, updated_at, device_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at,
         device_id = EXCLUDED.device_id`,
      [key, valueStr, nowStr, deviceId]
    );
    await set('cache_' + key, value);
  } else {
    await set(key, value);
  }
}

export async function ensureDefaults() {
  // Check if already seeded to prevent redundant setting reads/writes
  const seeded = await get('defaults_seeded');
  if (seeded === true) {
    return;
  }

  const daily = await readSetting('daily_lock');
  if (!daily) {
    const code = await hashCode("1234");
    await writeSetting('daily_lock', { enabled: true, ...code });
  }

  const admin = await readSetting('admin_pin');
  if (!admin) {
    const code = await hashCode("0000");
    await writeSetting('admin_pin', code);
  }

  const maint = await readSetting('maintenance_pin');
  if (!maint) {
    const code = await hashCode("0000");
    await writeSetting('maintenance_pin', { enabled: false, ...code });
  }

  // Once all three are validated as existing/created, mark defaults_seeded
  const checkDaily = daily || (await readSetting('daily_lock'));
  const checkAdmin = admin || (await readSetting('admin_pin'));
  const checkMaint = maint || (await readSetting('maintenance_pin'));
  if (checkDaily && checkAdmin && checkMaint) {
    await set('defaults_seeded', true);
  }
}

export async function isDefaultDailyLock(): Promise<boolean> {
  const stored = await readSetting('daily_lock');
  if (!stored) return true;
  return verifyCode("1234", stored);
}

export async function isDefaultAdminPin(): Promise<boolean> {
  const stored = await readSetting('admin_pin');
  if (!stored) return true;
  return verifyCode("0000", stored);
}

export async function isDailyLockEnabled(): Promise<boolean> {
  const daily = await readSetting('daily_lock');
  if (!daily) return true;
  return daily.enabled !== false;
}

export async function setDailyLockEnabled(enabled: boolean, currentAdminPin: string): Promise<void> {
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentAdminPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const daily = await readSetting('daily_lock');
  if (!daily) {
    const code = await hashCode("1234");
    await writeSetting('daily_lock', { enabled, ...code });
  } else {
    await writeSetting('daily_lock', { ...daily, enabled });
  }
  await logAudit('تعديل_تفعيل_قفل_يومي', enabled ? 'تم تفعيل قفل اليومية' : 'تم تعطيل قفل اليومية');
}

export async function isDailyLockRequired(): Promise<boolean> {
  const enabled = await isDailyLockEnabled();
  if (!enabled) return false;

  const lastUnlockAt = await get('lastUnlockAt');
  if (!lastUnlockAt) return true;

  const lastUnlockDate = new Date(lastUnlockAt);
  const now = new Date();

  // 12 hours rolling from last successful unlock
  const timeDiff = now.getTime() - lastUnlockDate.getTime();
  if (timeDiff >= 12 * 60 * 60 * 1000) return true;

  return false;
}

export async function markUnlocked() {
  await set('lastUnlockAt', new Date().toISOString());
  await set('pin_lockout_daily', null);
  if (isSupabaseMode()) {
    try {
      await writeSetting('pin_lockout_daily', null);
    } catch (err) {
      console.warn('Failed to clear daily lockout setting:', err);
    }
  }
}

export async function changeDailyLock(newCode: string, currentAdminPin: string) {
  // First verify admin pin
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentAdminPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const currentDaily = await readSetting('daily_lock');
  const enabled = currentDaily ? (currentDaily.enabled !== false) : true;

  const codeData = await hashCode(newCode);
  await writeSetting('daily_lock', { enabled, ...codeData });
  await logAudit('تغيير_قفل_يومي', 'تم تغيير رمز قفل اليومية');
}

export async function changeAdminPin(currentPin: string, newPin: string) {
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const codeData = await hashCode(newPin);
  await writeSetting('admin_pin', codeData);
  await logAudit('تغيير_رمز_مشرف', 'تم تغيير رمز المشرف');
}

export async function isMaintenanceEnabled(): Promise<boolean> {
  const maint = await readSetting('maintenance_pin');
  if (!maint) return false;
  return maint.enabled === true;
}

export async function setMaintenanceEnabled(enabled: boolean, currentAdminPin: string): Promise<void> {
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentAdminPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const maint = await readSetting('maintenance_pin');
  if (!maint) {
    const code = await hashCode("0000");
    await writeSetting('maintenance_pin', { enabled, ...code });
  } else {
    await writeSetting('maintenance_pin', { ...maint, enabled });
  }
  await logAudit('تعديل_تفعيل_رمز_صيانة', enabled ? 'تم تفعيل رمز الصيانة' : 'تم تعطيل رمز الصيانة');
}

export async function changeMaintenancePin(newCode: string, currentAdminPin: string) {
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentAdminPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const currentMaint = await readSetting('maintenance_pin');
  const enabled = currentMaint ? (currentMaint.enabled === true) : true;

  const codeData = await hashCode(newCode);
  await writeSetting('maintenance_pin', { enabled, ...codeData });
  await logAudit('تغيير_رمز_صيانة', 'تم تغيير رمز الصيانة');
}

function lockoutKey(level: 'daily' | 'admin'): string {
  return level === 'daily' ? 'pin_lockout_daily' : 'pin_lockout_admin';
}

export async function getCombinedLockout(level: 'daily' | 'admin'): Promise<{ attempts: number; lockedUntil: number } | null> {
  const key = lockoutKey(level);
  const localData = await get(key);
  let cloudData = null;
  if (isSupabaseMode()) {
    try {
      cloudData = await readSetting(key);
    } catch (err) {
      console.warn(`Failed to read central lockout ${key} on query, using cache:`, err);
    }
  }

  if (!localData && !cloudData) return null;
  const localAttempts = localData?.attempts ?? 0;
  const localLockedUntil = localData?.lockedUntil ?? 0;
  const cloudAttempts = cloudData?.attempts ?? 0;
  const cloudLockedUntil = cloudData?.lockedUntil ?? 0;

  const attempts = Math.max(localAttempts, cloudAttempts);
  const lockedUntil = Math.max(localLockedUntil, cloudLockedUntil);

  return { attempts, lockedUntil };
}

export async function recordFailedAttempt(level: 'daily' | 'admin') {
  const key = lockoutKey(level);
  
  // Read both local and cloud
  const localData = await get(key);
  let cloudData = null;
  if (isSupabaseMode()) {
    try {
      cloudData = await readSetting(key);
    } catch (err) {
      console.warn(`Failed to read central lockout ${key}:`, err);
    }
  }

  const lockData = { attempts: 0, lockedUntil: 0 };
  const localAttempts = localData?.attempts ?? 0;
  const localLockedUntil = localData?.lockedUntil ?? 0;
  const cloudAttempts = cloudData?.attempts ?? 0;
  const cloudLockedUntil = cloudData?.lockedUntil ?? 0;

  lockData.attempts = Math.max(localAttempts, cloudAttempts);
  lockData.lockedUntil = Math.max(localLockedUntil, cloudLockedUntil);

  if (Date.now() < lockData.lockedUntil) return; // already locked

  lockData.attempts += 1;
  if (lockData.attempts >= 5) {
    lockData.lockedUntil = Date.now() + 2 * 60 * 1000; // 2 mins lock
    lockData.attempts = 0;
  }

  await set(key, lockData);
  if (isSupabaseMode()) {
    try {
      await writeSetting(key, lockData);
    } catch (err) {
      console.warn(`Failed to write central lockout ${key}:`, err);
    }
  }
}

export async function isLocked(level: 'daily' | 'admin'): Promise<boolean> {
  const lockData = await getCombinedLockout(level);
  if (!lockData) return false;
  return Date.now() < lockData.lockedUntil;
}

export async function getLockoutSecondsRemaining(level: 'daily' | 'admin'): Promise<number> {
  const lockData = await getCombinedLockout(level);
  if (!lockData) return 0;
  return Math.max(0, Math.ceil((lockData.lockedUntil - Date.now()) / 1000));
}

export async function setAdminRecovery(question: string, answer: string, currentAdminPin: string): Promise<void> {
  const storedAdmin = await readSetting('admin_pin');
  if (!storedAdmin || !(await verifyCode(currentAdminPin, storedAdmin))) {
    throw new Error('Admin PIN incorrect');
  }

  const normalized = answer.trim().toLowerCase();
  const code = await hashCode(normalized);
  await writeSetting('admin_recovery', { question, ...code });
  await logAudit('تعيين_سؤال_استرجاع', 'تم تعيين سؤال استرجاع رمز المشرف');
}

export async function getAdminRecoveryQuestion(): Promise<string | null> {
  const stored = await readSetting('admin_recovery');
  return stored ? stored.question : null;
}

export async function hasAdminRecovery(): Promise<boolean> {
  const stored = await readSetting('admin_recovery');
  return !!stored;
}

export async function resetAdminPinViaRecovery(answer: string, newPin: string): Promise<void> {
  if (await isLocked('admin')) {
    const remaining = await getLockoutSecondsRemaining('admin');
    throw new Error(`تم قفل إدخال الرمز مؤقتاً. حاول مجدداً بعد ${remaining} ثانية.`);
  }

  const stored = await readSetting('admin_recovery');
  if (!stored) {
    throw new Error('لم يتم تعيين سؤال الاسترجاع مسبقاً.');
  }

  const normalized = answer.trim().toLowerCase();
  const isCorrect = await verifyCode(normalized, stored);
  if (!isCorrect) {
    await recordFailedAttempt('admin');
    throw new Error('الإجابة غير صحيحة');
  }

  // On SUCCESS:
  const codeData = await hashCode(newPin);
  await writeSetting('admin_pin', codeData);
  
  // Clear the admin lockout
  const key = lockoutKey('admin');
  await set(key, null);
  if (isSupabaseMode()) {
    try {
      await writeSetting(key, null);
    } catch (err) {
      console.warn('Failed to clear admin lockout setting:', err);
    }
  }
  
  await logAudit('استرجاع_رمز_مشرف', 'تم استرجاع رمز المشرف عن طريق سؤال الأمان');
}
