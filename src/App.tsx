import { useEffect, useState, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ErrorBoundary } from 'react-error-boundary';
import { initDatabase, isSupabaseMode } from './db/client';
import { runMigrations } from './db/migrations';
import { setupRealtimeSync } from './db/realtime';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ensurePersistence } from './lib/storage';
import { AddToHomeScreen } from './components/pwa/AddToHomeScreen';
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

import { AuthProvider } from './contexts/AuthContext';
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
            <AddToHomeScreen />
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
                </Route>

                {/* Default redirect to POS */}
                <Route path="/" element={<Navigate to="/pos" replace />} />
                <Route path="*" element={<Navigate to="/pos" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="top-center" dir="rtl" />
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  );
}

