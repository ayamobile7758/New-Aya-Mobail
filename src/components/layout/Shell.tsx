import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { RouteErrorFallback } from './RouteErrorFallback';
import { TopBar } from './TopBar';
import { SideRail } from './SideRail';
import { BottomNav } from './BottomNav';
import { AlertTriangle, X, LogOut } from 'lucide-react';

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

  const { accessLevel, exitAdmin } = useAuth();

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

      {/* ── Admin session indicator — thin top line + small floating exit button ── */}
      {accessLevel === 'admin' && (
        <>
          {/* Thin visual-only indicator line across the very top of every screen */}
          <div
            aria-hidden="true"
            className="admin-mode-line fixed top-0 inset-x-0 z-[60] h-[3px] shadow-[0_0_6px_rgba(207,105,74,0.5)] pointer-events-none"
          />
          {/* Small floating exit button — bottom-start (left in RTL), above any bottom nav */}
          <button
            onClick={exitAdmin}
            aria-label="خروج من وضع المدير"
            title="خروج من وضع المدير"
            className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] start-3 z-[60] w-10 h-10 rounded-full bg-accent hover:bg-accent-hover text-white shadow-lg flex items-center justify-center transition-colors border-0 outline-none"
          >
            <LogOut className="w-5 h-5 shrink-0" />
          </button>
        </>
      )}
    </div>
  );
}
