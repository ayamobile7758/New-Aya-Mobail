// src/lib/clockGuard.ts
// =============================================================================
// BUNDLE 4 — Clock Tampering Guard (C-9)
// HEAD: b6c491e
//
// PURPOSE:
//   Persist a monotonic "last_known_date" (highest YYYY-MM-DD the system has
//   ever seen) in app_settings, with an idb-keyval cache fallback for offline
//   reads. If the device clock reads EARLIER than last_known_date, refuse to
//   operate — the user has either turned back the clock or the RTC battery
//   died. Either way, allowing the mutation would risk corrupting a closed
//   day (a sale on a rolled-back date would land on a date that may already
//   be closed, bypassing the day-closure lock).
//
// SAFETY GUARANTEES (per the owner's hard rules):
//   1. NEVER locks the owner out on first run. If last_known_date is null
//      (first run after install), the guard does NOT throw — it writes today
//      as the seed and returns today.
//   2. NEVER locks the owner out on a legitimate forward clock change. If
//      today > last_known_date (e.g. the next day, or a timezone change that
//      moves the date forward), the guard writes the new date and returns it.
//   3. ONLY throws when today < last_known_date (clock was moved backward).
//      The Arabic error message instructs the user to correct the device date.
//
// CALL SITES:
//   Every mutation function that uses new Date() to determine the business
//   date should call `await assertClockNotTampered()` at the top, replacing
//   the `const today = format(new Date(), 'yyyy-MM-dd')` line. See
//   call_site_edits.md for the exact edits in each file.
//
// BOOT SEED:
//   App.tsx calls assertClockNotTampered() once during setup() so the first
//   last_known_date is written even if the user opens the app but doesn't
//   make a sale. This prevents an attacker from setting the clock back BEFORE
//   the first sale.
// =============================================================================

import { format } from 'date-fns';
import { readSetting, writeSetting } from '@/lib/auth';

const SETTING_KEY = 'last_known_date';

/**
 * Read the stored last_known_date.
 * Uses readSetting() which already has a Supabase + idb-keyval cache fallback.
 * Returns null if never set (first run).
 *
 * The value is validated as a YYYY-MM-DD string before use — if the stored
 * value is corrupt or in an unexpected format, we treat it as null (first run)
 * rather than throwing.
 */
async function getLastKnownDate(): Promise<string | null> {
  try {
    const val = await readSetting(SETTING_KEY);
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val;
    }
    return null;
  } catch {
    // Non-fatal — if we can't read the setting (e.g. Supabase unreachable on
    // first boot), the guard still works against the cached value (which is
    // null on first run, so the guard allows the operation).
    return null;
  }
}

/**
 * Persist the new last_known_date.
 * Non-fatal on failure — the guard still works against the cached value
 * for the rest of this session. A failure here means the next boot may not
 * have the updated value, but that's a degraded mode, not a lockout.
 */
async function setLastKnownDate(today: string): Promise<void> {
  try {
    await writeSetting(SETTING_KEY, today);
  } catch (err) {
    console.warn('clockGuard: failed to persist last_known_date', err);
  }
}

/**
 * Call at the top of every mutation function that uses new Date() to determine
 * the business date. Throws an Arabic error if the device clock has been moved
 * backward past the last known date.
 *
 * @returns the validated "today" string (YYYY-MM-DD)
 *
 * BEHAVIOR:
 *   - First run (last_known_date is null): writes today as seed, returns today.
 *   - today > last_known_date (forward change): writes new date, returns today.
 *   - today === last_known_date (same day): no write, returns today.
 *   - today < last_known_date (backward change): THROWS Arabic error.
 */
export async function assertClockNotTampered(): Promise<string> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const last = await getLastKnownDate();

  if (last && today < last) {
    // C-9: clock was moved backward. Refuse to operate.
    throw new Error(
      `تم إرجاع ساعة الجهاز إلى ${today} بينما آخر تاريخ مسجّل هو ${last}. ` +
      `لا يمكن إجراء عمليات لتاريخ سابق لمنع فساد الإقفالات اليومية. ` +
      `صحّح تاريخ الجهاز ثم أعد المحاولة.`
    );
  }

  // Write today as the new last_known_date if it's later than the stored value
  // (or if there is no stored value yet — first run seed).
  if (!last || today > last) {
    await setLastKnownDate(today);
  }

  return today;
}
