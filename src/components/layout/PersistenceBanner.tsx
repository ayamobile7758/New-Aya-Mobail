import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { isStoragePersisted, ensurePersistence } from '@/lib/storage';

export function PersistenceBanner() {
  const [persisted, setPersisted] = useState(true);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Check if dismissed in localStorage
    const dismissedUntil = localStorage.getItem('persistence_banner_dismissed_until');
    const now = Date.now();
    const isDismissed = dismissedUntil ? parseInt(dismissedUntil, 10) > now : false;
    setDismissed(isDismissed);

    const checkPersistence = async () => {
      let isPersisted = await isStoragePersisted();
      if (!isPersisted) {
        isPersisted = await ensurePersistence();
      }
      setPersisted(isPersisted);
    };
    checkPersistence();
  }, []);

  if (persisted || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem('persistence_banner_dismissed_until', String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setDismissed(true);
  };

  return (
    <div className="bg-[#FEF1F1] border-b border-red-200 text-red-800 text-sm px-4 py-2 flex items-center gap-3 shrink-0 relative z-30">
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <p className="flex-1">
        التخزين غير مضمون — قد تُحذف بياناتك. ثبّت التطبيق على الشاشة الرئيسية لضمان الحفظ.
      </p>
      <button
        onClick={handleDismiss}
        className="ms-auto p-1.5 -m-1 hover:bg-black/5 rounded-full shrink-0"
        title="إغلاق"
        aria-label="إغلاق"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
