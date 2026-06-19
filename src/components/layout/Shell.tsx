import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { RouteErrorFallback } from './RouteErrorFallback';
import { TopBar } from './TopBar';
import { SideRail } from './SideRail';
import { BottomNav } from './BottomNav';
import { LogOut, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { PWABadge } from '../pwa/PWABadge';
import { PersistenceBanner } from './PersistenceBanner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export function Shell() {
  const location = useLocation();
  const isPOS = location.pathname === '/pos';



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
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background w-full max-w-[100vw] text-text-primary">
      {!isPOS && <TopBar />}
      {!isPOS && <PersistenceBanner />}



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
                ? 'admin-mode-line-pulse h-[6px] shadow-[0_0_14px_rgba(207,105,74,0.9)]'
                : 'h-[3px] shadow-[0_0_6px_rgba(207,105,74,0.5)]'
            )}
          />
          {/* Small floating exit button — bottom-end on every device. In an RTL layout
              `end` is the LEFT side, so this sits at bottom-left, opposite the POS cart
              button (which uses `start` = right). Raised above the mobile bottom nav
              (60px) on phones; on md+ there is no bottom nav so it sits at the normal inset. */}
          <button
            onClick={exitAdmin}
            aria-label="خروج من وضع المدير"
            title="خروج من وضع المدير"
            className="fixed end-3 bottom-[calc(env(safe-area-inset-bottom,0px)+60px+0.75rem)] md:bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-[60] w-10 h-10 rounded-full bg-danger hover:opacity-90 text-white shadow-lg flex items-center justify-center transition-colors border-0 outline-none"
          >
            <LogOut className="w-5 h-5 shrink-0" />
          </button>
        </>
      )}
    </div>
  );
}
