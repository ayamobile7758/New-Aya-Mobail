// src/components/pwa/PwaManager.tsx
// =============================================================================
// One component that owns the two PWA-lifecycle surfaces the owner sees:
//
//   1) INSTALL PROMPT — a small Arabic banner offering "تثبيت التطبيق".
//      - Only ever shown to devices that are NOT already installed.
//      - Shown at most ONCE PER DAY (dismiss or install both silence it for
//        the rest of the day), so it is not nagging.
//      - Uses the browser's real `beforeinstallprompt` event, so tapping the
//        button triggers the native install dialog. (On iOS Safari, which has
//        no such event, we show short "add to home screen" instructions
//        instead, also once per day.)
//
//   2) UPDATE PROMPT — when a new version has been deployed (Vercel) and the
//      service worker has fetched it, we surface a clear "يوجد تحديث جديد"
//      banner with a button that activates the new version and reloads. This
//      fixes the "the system never updates after a deploy" feeling: instead of
//      silently waiting for some future cold start, the owner gets a one-tap
//      update the moment a new build is live.
// =============================================================================

import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X } from 'lucide-react';

const INSTALL_DISMISS_KEY = 'pwa_install_prompt_last_shown';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Captured `beforeinstallprompt` event type (not in lib.dom yet in all TS libs).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isRunningStandalone(): boolean {
  // Installed PWAs run in standalone/fullscreen display mode. iOS exposes a
  // non-standard navigator.standalone flag.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // @ts-expect-error iOS-only
    window.navigator.standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** True if we have not shown the install prompt within the last 24h. */
function canShowInstallToday(): boolean {
  try {
    const last = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
    return Date.now() - last > ONE_DAY_MS;
  } catch {
    return true;
  }
}

function markInstallShownToday() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode — ignore */
  }
}

export function PwaManager() {
  // ---- Update flow ----------------------------------------------------------
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Poll for a new deployment every 60 min while the app stays open, so a
      // long-running tablet session still notices a fresh Vercel deploy.
      if (registration) {
        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      }
    },
  });

  // ---- Install flow ---------------------------------------------------------
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isRunningStandalone()) return; // already installed — never prompt

    // Chrome/Edge/Android: real installability signal.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the event so we can trigger it from our button
      setInstallEvent(e as BeforeInstallPromptEvent);
      if (canShowInstallToday()) {
        setShowInstall(true);
        markInstallShownToday();
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Once installed, hide everything for good.
    const onInstalled = () => {
      setShowInstall(false);
      setShowIosHint(false);
      setInstallEvent(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari has no beforeinstallprompt — fall back to a once-a-day hint.
    if (isIos() && canShowInstallToday()) {
      setShowIosHint(true);
      markInstallShownToday();
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setShowInstall(false);
    setInstallEvent(null);
  };

  // ---------------------------------------------------------------------------
  return (
    <div
      dir="rtl"
      className="fixed inset-x-0 bottom-0 z-[10000] flex flex-col items-center gap-2 p-3 pointer-events-none"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      {/* UPDATE BANNER — highest priority */}
      {needRefresh && (
        <div className="pointer-events-auto w-full max-w-sm bg-surface border border-accent/30 shadow-md rounded-2xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-4">
          <div className="w-10 h-10 shrink-0 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-text-primary">يوجد تحديث جديد للنظام</p>
            <p className="text-xs text-text-secondary">اضغط للتحديث إلى أحدث نسخة</p>
          </div>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="shrink-0 h-9 px-4 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl text-sm transition-colors"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="shrink-0 p-1.5 text-text-secondary hover:bg-muted rounded-full transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* INSTALL BANNER — Chrome/Android */}
      {showInstall && installEvent && (
        <div className="pointer-events-auto w-full max-w-sm bg-surface border border-border shadow-md rounded-2xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-4">
          <div className="w-10 h-10 shrink-0 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-text-primary">تثبيت التطبيق</p>
            <p className="text-xs text-text-secondary">أضف النظام إلى شاشتك الرئيسية لفتحٍ أسرع</p>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="shrink-0 h-9 px-4 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl text-sm transition-colors"
          >
            تثبيت
          </button>
          <button
            type="button"
            onClick={() => setShowInstall(false)}
            className="shrink-0 p-1.5 text-text-secondary hover:bg-muted rounded-full transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* INSTALL HINT — iOS Safari (no native prompt available) */}
      {showIosHint && (
        <div className="pointer-events-auto w-full max-w-sm bg-surface border border-border shadow-md rounded-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4">
          <div className="w-10 h-10 shrink-0 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-text-primary">تثبيت التطبيق على آيفون/آيباد</p>
            <p className="text-xs text-text-secondary leading-relaxed">
              اضغط زر المشاركة في المتصفح، ثم اختر «إضافة إلى الشاشة الرئيسية».
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowIosHint(false)}
            className="shrink-0 p-1.5 text-text-secondary hover:bg-muted rounded-full transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
