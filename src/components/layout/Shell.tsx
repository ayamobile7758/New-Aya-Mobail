import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { RouteErrorFallback } from './RouteErrorFallback';
import { TopBar } from './TopBar';
import { SideRail } from './SideRail';
import { BottomNav } from './BottomNav';
import { AlertTriangle, X, LogOut, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { PWABadge } from '../pwa/PWABadge';
import { PersistenceBanner } from './PersistenceBanner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

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

  // Periodic admin-mode reminder: every 15 minutes while in admin mode, briefly
  // emphasize the top line and show a toast so the manager doesn't forget the
  // device is unlocked with full privileges. The interval is cleaned up on exit.
  const [adminPulse, setAdminPulse] = useState(false);
  useEffect(() => {
    if (accessLevel !== 'admin') {
      setAdminPulse(false);
      return;
    }
    const interval = setInterval(() => {
      setAdminPulse(true);
      toast('وضع المدير لا يزال مفعّلاً', {
        icon: <Shield className="w-4 h-4" />,
        description: 'اضغط زر الخروج إذا انتهيت من إجراءات الإدارة.',
        duration: 5000,
      });
      setTimeout(() => setAdminPulse(false), 4000);
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [accessLevel]);

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
            className={cn(
              'admin-mode-line fixed top-0 inset-x-0 z-[60] pointer-events-none transition-all duration-500',
              adminPulse
                ? 'h-[6px] shadow-[0_0_14px_rgba(207,105,74,0.9)]'
                : 'h-[3px] shadow-[0_0_6px_rgba(207,105,74,0.5)]'
            )}
          />
          {/* Small floating exit button — always bottom-start (left in RTL) on every
              device, opposite the POS cart button at bottom-end, so they never overlap.
              Raised above the mobile bottom nav (60px) on phones; on md+ there is no
              bottom nav so it sits at the normal bottom inset. */}
          <button
            onClick={exitAdmin}
            aria-label="خروج من وضع المدير"
            title="خروج من وضع المدير"
            className="fixed start-3 bottom-[calc(env(safe-area-inset-bottom,0px)+60px+0.75rem)] md:bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-[60] w-10 h-10 rounded-full bg-accent hover:bg-accent-hover text-white shadow-lg flex items-center justify-center transition-colors border-0 outline-none"
          >
            <LogOut className="w-5 h-5 shrink-0" />
          </button>
        </>
      )}
    </div>
  );
}
