import { useEffect, useState, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ErrorBoundary } from 'react-error-boundary';
import { initDatabase, isSupabaseMode } from './db/client';
import { runMigrations } from './db/migrations';
import { setupRealtimeSync } from './db/realtime';
import { assertClockNotTampered } from './lib/clockGuard';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ensurePersistence } from './lib/storage';
import { PwaManager } from './components/pwa/PwaManager';
import { ModuleError } from './components/layout/ModuleError';

// Pages
import DashboardPage from './modules/dashboard/DashboardPage';
import POSPage from './modules/pos/POSPage';
import ProductsPage from './modules/products/ProductsPage';
import InventoryPage from './modules/inventory/InventoryPage';
import ExpensesPage from './modules/expenses/ExpensesPage';
import SalesPage from './modules/sales/SalesPage';
import OperationsPage from './modules/operations/OperationsPage';
import MaintenancePage from './modules/maintenance/MaintenancePage';
import DebtBookPage from './modules/debtbook/DebtBookPage';
import ReportsPage from './modules/reports/ReportsPage';
import MorePage from './modules/more/MorePage';
import SettingsPage from './modules/settings/SettingsPage';

// Create a client ensuring networkMode: 'always' for offline support
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: false,
    },
    mutations: {
      networkMode: 'always',
    },
  },
});

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthGuard } from './components/auth/AuthGuard';
import { BackupReminderBanner } from './components/BackupReminderBanner';
import { MigrationErrorScreen } from './components/db/MigrationErrorScreen';

function ModuleWrapper({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ModuleError}>
      {children}
    </ErrorBoundary>
  );
}

export default function App() {
  const [dbState, setDbState] = useState<'loading' | 'ready' | 'error' | 'migration-error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function setup() {
      try {
        await ensurePersistence();
        await initDatabase();
        // C-9: seed last_known_date on boot so the guard works even if the
        // user opens the app but doesn't make a sale. Non-fatal on failure
        // (the guard will still work against the cached value).
        try {
          await assertClockNotTampered();
        } catch (err: any) {
          // If the clock was already rolled back before this boot, surface
          // the error to the user instead of letting the app appear to load.
          setDbState('error');
          setErrorMsg(err.message || 'Clock tampering detected');
          return;
        }
      } catch (err: any) {
        setDbState('error');
        setErrorMsg(err.message || 'Unknown database error');
        return;
      }

      try {
        await runMigrations();
        // Removed old checkPin call here since AuthProvider handles it
        setDbState('ready');
      } catch (err: any) {
        setDbState('migration-error');
        setErrorMsg(err.message || 'Unknown migration error');
      }
    }
    setup();
  }, []);

  useEffect(() => {
    if (dbState !== 'ready') return;

    const unsubscribe = setupRealtimeSync(queryClient);
    return () => {
      unsubscribe();
    };
  }, [dbState]);


  if (dbState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-text-primary">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p className="text-text-secondary text-lg">جاري تجهيز قاعدة البيانات...</p>
        </div>
      </div>
    );
  }

  if (dbState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background text-text-primary">
        <div className="bg-danger-bg border border-danger text-danger p-6 rounded-lg max-w-md text-center">
          <h2 className="text-xl font-bold mb-2">خطأ في قاعدة البيانات</h2>
          <p className="mb-4">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-danger text-white px-6 py-2 rounded-md hover:bg-danger/90"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (dbState === 'migration-error') {
    return <MigrationErrorScreen error={errorMsg} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGuard>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
          <Toaster position="top-center" dir="rtl" />
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppRoutes() {
  const { accessLevel, lockNow } = useAuth();

  // Hard-isolate maintenance level: only /maintenance, no nav chrome
  if (accessLevel === 'maintenance') {
    return (
      <>
        <PwaManager />
        <Routes>
          <Route path="/maintenance" element={
            <div className="flex flex-col h-[100dvh] overflow-hidden bg-background text-text-primary">
              <ModuleWrapper><MaintenancePage /></ModuleWrapper>
            </div>
          } />
          <Route path="*" element={<Navigate to="/maintenance" replace />} />
        </Routes>
        {/* Maintenance session badge — lock out */}
        <button
          dir="rtl"
          onClick={lockNow}
          className="fixed top-2 end-2 z-30 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-3 py-1.5 text-xs font-bold shadow-md flex items-center gap-1.5 transition-colors cursor-pointer border-0 outline-none"
          style={{ fontFamily: 'Tajawal, sans-serif' }}
        >
          <span>وضع الصيانة · خروج</span>
        </button>
      </>
    );
  }

  return (
    <>
      <PwaManager />
      {!isSupabaseMode() && <BackupReminderBanner />}
      <Routes>
        <Route element={<Shell />}>
          {/* Public/Employee Routes */}
          <Route path="/pos" element={<ModuleWrapper><POSPage /></ModuleWrapper>} />
          <Route path="/products" element={<ModuleWrapper><ProductsPage /></ModuleWrapper>} />
          <Route path="/maintenance" element={<ModuleWrapper><MaintenancePage /></ModuleWrapper>} />
          <Route path="/more" element={<ModuleWrapper><MorePage /></ModuleWrapper>} />
          
          {/* Protected/Admin Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<ModuleWrapper><DashboardPage /></ModuleWrapper>} />
            <Route path="/inventory" element={<ModuleWrapper><InventoryPage /></ModuleWrapper>} />
            <Route path="/sales" element={<ModuleWrapper><SalesPage /></ModuleWrapper>} />
            <Route path="/expenses" element={<ModuleWrapper><ExpensesPage /></ModuleWrapper>} />
            <Route path="/operations" element={<ModuleWrapper><OperationsPage /></ModuleWrapper>} />
            <Route path="/reports" element={<ModuleWrapper><ReportsPage /></ModuleWrapper>} />
            <Route path="/settings" element={<ModuleWrapper><SettingsPage /></ModuleWrapper>} />
            <Route path="/debtbook" element={<ModuleWrapper><DebtBookPage /></ModuleWrapper>} />
          </Route>

          {/* Default redirect to POS */}
          <Route path="/" element={<Navigate to="/pos" replace />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Route>
      </Routes>
    </>
  );
}

