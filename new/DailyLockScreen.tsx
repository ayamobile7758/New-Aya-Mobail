// src/components/auth/DailyLockScreen.tsx
// =============================================================================
// BUNDLE 5 — Cloud-Only Cleanup (A-1): "requires internet" banner
// HEAD: b6c491e
//
// WHAT CHANGED:
//   - Added an online/offline state tracker using `navigator.onLine` plus
//     window 'online'/'offline' event listeners.
//   - When offline, a red banner is rendered above the PIN dots instructing
//     the user that the app cannot record sales until the connection returns.
//   - The PIN entry UI is still shown (so the user can unlock the app to view
//     cached data), but the banner makes it clear that mutations will fail.
//
// BEHAVIOR THE OWNER WILL SEE:
//   - On a normal online boot: no banner, normal login flow.
//   - On an offline boot (or if WiFi drops while on the lock screen): red
//     banner appears at the top: "التطبيق غير متصل بالإنترنت — لا يمكن تسجيل
//     المبيعات حتى يستعيد الاتصال."
//   - When the connection returns: the banner disappears within ~1 second.
// =============================================================================

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { verifyCode, getLockoutSecondsRemaining, recordFailedAttempt, markUnlocked, readSetting, isMaintenanceEnabled } from '@/lib/auth';
import { Lock, Clock, WifiOff } from 'lucide-react';
import { toastError, toastSuccess } from '@/components/ui/toast';
import { NumPad } from '@/components/ui/NumPad';

export function DailyLockScreen() {
  const { grantPosAccess, grantAdminAccess, grantMaintenanceAccess } = useAuth();
  const [pin, setPin] = useState('');
  const [lockoutSecs, setLockoutSecs] = useState(0);
  // A-1: track online/offline status so we can show a clear banner when the
  // app cannot reach Supabase. The lock screen is the first screen the user
  // sees, so this is the right place to surface connectivity issues.
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const checkLockout = async () => {
      const remaining = await getLockoutSecondsRemaining('daily');
      setLockoutSecs(remaining);
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, []);

  const navigateTo = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleKeypadSubmit = async (newPin: string) => {
    if (lockoutSecs > 0) return;

    if (newPin.length === 4) {
      // 1. Check admin pin first
      const storedAdmin = await readSetting('admin_pin');
      if (storedAdmin && await verifyCode(newPin, storedAdmin)) {
        await markUnlocked();
        grantAdminAccess();
        navigateTo('/dashboard');
        toastSuccess("تم الدخول بصلاحيات المدير");
        return;
      }

      // 2. Check daily lock PIN (always allow unlock to POS if the code matches storedDaily)
      const storedDaily = await readSetting('daily_lock');
      if (storedDaily && await verifyCode(newPin, storedDaily)) {
        await markUnlocked();
        grantPosAccess();
        navigateTo('/pos');
        toastSuccess("تم الدخول بصلاحيات نقطة البيع");
        return;
      }

      // 3. Check maintenance pin if enabled
      const maintEnabled = await isMaintenanceEnabled();
      if (maintEnabled) {
        const storedMaint = await readSetting('maintenance_pin');
        if (storedMaint && await verifyCode(newPin, storedMaint)) {
          await markUnlocked();
          grantMaintenanceAccess();
          navigateTo('/maintenance');
          toastSuccess("تم الدخول لوضع الصيانة");
          return;
        }
      }

      // 4. Fallback: failed attempt
      await recordFailedAttempt('daily');
      setPin('');
      toastError("الرمز غير صحيح");
      const remaining = await getLockoutSecondsRemaining('daily');
      setLockoutSecs(remaining);
    }
  };

  const handleKeyPress = (num: number) => {
    if (pin.length < 4 && lockoutSecs === 0) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 4) {
        handleKeypadSubmit(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6 animate-in fade-in" dir="rtl">
      <div className="mb-12 flex flex-col items-center">
        <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center mb-6">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold mb-2">تسجيل الدخول لليوم</h1>
        <p className="text-text-secondary text-center max-w-sm">
          يرجى إدخال الركن الموحد (Daily Lock) لفتح نظام المبيعات
        </p>
      </div>

      {/* A-1: "requires internet" banner — shown when navigator.onLine is false */}
      {!isOnline && (
        <div className="mb-8 w-full max-w-sm bg-danger-bg border border-danger text-danger px-4 py-3 rounded-xl flex items-center gap-3 text-center font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>
          <WifiOff className="w-6 h-6 shrink-0" />
          <span className="text-sm">
            التطبيق غير متصل بالإنترنت — لا يمكن تسجيل المبيعات حتى يستعيد الاتصال.
          </span>
        </div>
      )}

      {lockoutSecs > 0 ? (
        <div className="flex flex-col items-center text-danger bg-danger/10 p-6 rounded-2xl mb-8">
          <Clock className="w-10 h-10 mb-4 animate-pulse" />
          <p className="font-bold text-xl mb-1">تم قفل النظام مؤقتاً</p>
          <p>الرجاء المحاولة بعد {lockoutSecs} ثانية</p>
        </div>
      ) : (
        <>
          <div className="flex gap-4 mb-12" dir="ltr">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                  pin.length > i
                    ? 'border-accent bg-accent text-white scale-110'
                    : 'border-border bg-surface'
                }`}
              >
                {pin.length > i ? '•' : ''}
              </div>
            ))}
          </div>

          <NumPad
            onDigit={(num) => handleKeyPress(Number(num))}
            onClear={handleBackspace}
            onSubmit={() => handleKeypadSubmit(pin)}
            submitDisabled={pin.length < 4}
          />
        </>
      )}
    </div>
  );
}
