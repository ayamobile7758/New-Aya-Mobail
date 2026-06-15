import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { RouteErrorFallback } from './RouteErrorFallback';
import { TopBar } from './TopBar';
import { SideRail } from './SideRail';
import { BottomNav } from './BottomNav';
import { AlertTriangle, X, Shield } from 'lucide-react';

import { PWABadge } from '../pwa/PWABadge';
import { PersistenceBanner } from './PersistenceBanner';
import { useAuth } from '@/contexts/AuthContext';

export function Shell() {
  const location = useLocation();
  const isPOS = location.pathname === '/pos';

  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('opfs_warning_dismissed');
    if (!dismissed) {
      setShowWarning(true);
    }
  }, []);

  const dismissWarning = () => {
    localStorage.setItem('opfs_warning_dismissed', '1');
    setShowWarning(false);
  };

  // ── Admin session badge ──────────────────────────────────────────────────────
  const { isAdminPinValidUntil } = useAuth();
  const [adminMinsLeft, setAdminMinsLeft] = useState(0);

  useEffect(() => {
    const update = () => {
      if (!isAdminPinValidUntil) { setAdminMinsLeft(0); return; }
      const diff = isAdminPinValidUntil - Date.now();
      setAdminMinsLeft(diff > 0 ? Math.ceil(diff / 60000) : 0);
    };
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, [isAdminPinValidUntil]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background w-full max-w-[100vw] text-text-primary">
      {!isPOS && <TopBar />}
      {!isPOS && <PersistenceBanner />}

      {!isPOS && showWarning && (
        <div className="bg-warning-bg/90 border-b border-warning/30 px-4 py-2 flex items-start sm:items-center justify-between gap-3 text-sm z-20 shrink-0">
          <div className="flex items-start sm:items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5 sm:mt-0" />
            <p className="font-medium text-text-primary">
              <strong className="text-warning">تنبيه هام:</strong> يتم حفظ بيانات نقطة البيع في هذا المتصفح فقط. يرجى أخذ نسخ احتياطية منتظمة من الإعدادات لمنع فقدان البيانات.
            </p>
          </div>
          <button onClick={dismissWarning} className="p-1 hover:bg-black/5 rounded-full shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {!isPOS && <SideRail className="hidden md:flex" />}
        <main className="flex-1 overflow-hidden relative bg-background">
          <ErrorBoundary FallbackComponent={RouteErrorFallback}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav className="md:hidden" />
      <PWABadge />

      {/* ── Admin session indicator badge — visible on every route ── */}
      {adminMinsLeft > 0 && (
        <div
          dir="rtl"
          className="fixed top-2 end-2 z-30 bg-[#CF694A] text-white rounded-full px-3 py-1 text-xs font-bold shadow-md flex items-center gap-1.5 pointer-events-none"
          style={{ fontFamily: 'Tajawal, sans-serif' }}
        >
          <Shield className="w-3 h-3" />
          وضع المشرف نشط · {adminMinsLeft} د
        </div>
      )}
    </div>
  );
}
