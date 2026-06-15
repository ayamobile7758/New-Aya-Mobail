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
async function readSetting(key: string): Promise<any | null> {
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

async function writeSetting(key: string, value: any): Promise<void> {
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

function lockoutKey(level: 'daily' | 'admin'): string {
  return level === 'daily' ? 'pin_lockout_daily' : 'pin_lockout_admin';
}

export async function recordFailedAttempt(level: 'daily' | 'admin') {
  const key = lockoutKey(level);
  const lockData = await get(key) || { attempts: 0, lockedUntil: 0 };

  if (Date.now() < lockData.lockedUntil) return; // already locked

  lockData.attempts += 1;
  if (lockData.attempts >= 5) {
    lockData.lockedUntil = Date.now() + 2 * 60 * 1000; // 2 mins lock
    lockData.attempts = 0;
  }

  await set(key, lockData);
}

export async function isLocked(level: 'daily' | 'admin'): Promise<boolean> {
  const lockData = await get(lockoutKey(level));
  if (!lockData) return false;
  return Date.now() < lockData.lockedUntil;
}

export async function getLockoutSecondsRemaining(level: 'daily' | 'admin'): Promise<number> {
  const lockData = await get(lockoutKey(level));
  if (!lockData) return 0;
  return Math.max(0, Math.ceil((lockData.lockedUntil - Date.now()) / 1000));
}
