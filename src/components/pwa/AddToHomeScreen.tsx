import { useState, useEffect } from 'react';
import { X, Download, ChevronDown, ChevronUp } from 'lucide-react';

export function AddToHomeScreen() {
  const [isStandalone, setIsStandalone] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const checkStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as any).standalone === true);
    setIsStandalone(checkStandalone());

    if (localStorage.getItem('AddToHomeScreenDismissed')) {
      setDismissed(true);
    }
  }, []);

  if (isStandalone || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem('AddToHomeScreenDismissed', 'true');
    setDismissed(true);
  };

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[100] px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pointer-events-none"
    >
      <div
        className="max-w-md mx-auto rounded-2xl shadow-lg border overflow-hidden pointer-events-auto"
        style={{
          background: '#1a1a1a',
          borderColor: 'rgba(207,105,74,0.3)',
          fontFamily: 'Tajawal, sans-serif',
        }}
      >
        {/* Main banner row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(207,105,74,0.15)' }}
          >
            <Download className="w-5 h-5" style={{ color: '#CF694A' }} />
          </div>

          <p className="flex-1 text-sm font-medium text-white/90 leading-snug">
            للحصول على أفضل تجربة، ثبّت التطبيق على شاشتك الرئيسية
          </p>

          <button
            onClick={() => setShowSteps(!showSteps)}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'rgba(255,255,255,0.5)' }}
            aria-label={showSteps ? 'إخفاء الخطوات' : 'عرض الخطوات'}
          >
            {showSteps ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={handleDismiss}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)' }}
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Expandable install steps */}
        {showSteps && (
          <div
            className="px-4 pb-3 pt-0 text-xs leading-relaxed space-y-1.5"
            style={{
              color: 'rgba(255,255,255,0.6)',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              paddingTop: '0.75rem',
            }}
          >
            <p>① اضغط قائمة المتصفح (⋮) أعلى الشاشة</p>
            <p>② اختر "إضافة إلى الشاشة الرئيسية"</p>
            <p>③ افتح التطبيق من أيقونته الجديدة</p>
          </div>
        )}
      </div>
    </div>
  );
}
