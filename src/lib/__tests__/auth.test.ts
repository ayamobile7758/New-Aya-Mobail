import { describe, it, expect, vi, beforeEach } from 'vitest';

const idbStore = vi.hoisted(() => new Map<string, unknown>());
const cloudStore = vi.hoisted(() => new Map<string, string>());

vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(idbStore.get(key) ?? null),
  set: (key: string, val: unknown) => {
    idbStore.set(key, val);
    return Promise.resolve();
  },
  del: (key: string) => {
    idbStore.delete(key);
    return Promise.resolve();
  },
}));

vi.mock('@/db/client', () => ({
  isSupabaseMode: () => true,
  dbClient: {
    query: (sql: string, params: any[]) => {
      if (sql.includes('SELECT value FROM app_settings')) {
        const key = params[0];
        const val = cloudStore.get(key);
        if (val !== undefined) {
          return Promise.resolve([{ value: val }]);
        }
        return Promise.resolve([]);
      }
      if (sql.includes('INSERT INTO app_settings')) {
        const key = params[0];
        const val = params[1];
        cloudStore.set(key, val);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    },
  },
}));

vi.mock('@/db/queries/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  hashCode,
  verifyCode,
  recordFailedAttempt,
  isLocked,
  getLockoutSecondsRemaining,
} from '@/lib/auth';

describe('hashCode / verifyCode', () => {
  it('generates unique hashes for the same PIN (different salts)', async () => {
    const h1 = await hashCode('1234');
    const h2 = await hashCode('1234');
    expect(h1.hash).not.toBe(h2.hash);
    expect(h1.salt).not.toBe(h2.salt);
  });

  it('verifies correct PIN', async () => {
    const stored = await hashCode('5678');
    expect(await verifyCode('5678', stored)).toBe(true);
  });

  it('rejects wrong PIN', async () => {
    const stored = await hashCode('5678');
    expect(await verifyCode('9999', stored)).toBe(false);
  });

  it('rejects empty string against real hash', async () => {
    const stored = await hashCode('1234');
    expect(await verifyCode('', stored)).toBe(false);
  });
});

describe('lockout logic', () => {
  beforeEach(() => {
    idbStore.clear();
    cloudStore.clear();
  });

  it('is not locked initially', async () => {
    expect(await isLocked('daily')).toBe(false);
  });

  it('getLockoutSecondsRemaining returns 0 when not locked', async () => {
    expect(await getLockoutSecondsRemaining('daily')).toBe(0);
  });

  it('first 4 failed attempts do not trigger lockout', async () => {
    for (let i = 0; i < 4; i++) {
      await recordFailedAttempt('daily');
    }
    expect(await isLocked('daily')).toBe(false);
  });

  it('5th failed attempt triggers 2-minute lockout', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('daily');
    }
    expect(await isLocked('daily')).toBe(true);
    const remaining = await getLockoutSecondsRemaining('daily');
    expect(remaining).toBeGreaterThan(100);
    expect(remaining).toBeLessThanOrEqual(120);
  });

  it('admin and daily lockouts are independent', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('admin');
    }
    expect(await isLocked('admin')).toBe(true);
    expect(await isLocked('daily')).toBe(false);
  });

  it('attempts reset to 0 after lockout triggers', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('admin');
    }
    await recordFailedAttempt('admin');
    const data = idbStore.get('pin_lockout_admin') as { attempts: number; lockedUntil: number };
    expect(data.attempts).toBe(0);
  });
});
