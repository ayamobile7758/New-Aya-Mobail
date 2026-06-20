import { NavLink } from 'react-router-dom';
import { Package, DollarSign, ArrowRightLeft, FileText, Settings, Archive, Lock, Menu } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';

const PROTECTED = new Set(['/sales', '/inventory', '/expenses', '/operations', '/settings']);

const menus = [
  { path: '/sales', icon: FileText, label: 'فواتير المبيعات' },
  { path: '/products', icon: Package, label: 'المنتجات' },
  { path: '/inventory', icon: Archive, label: 'المخزون' },
  { path: '/expenses', icon: DollarSign, label: 'المصروفات' },
  { path: '/operations', icon: ArrowRightLeft, label: 'العمليات' },
  { path: '/settings', icon: Settings, label: 'الإعدادات' },
];

export default function MorePage() {
  const { accessLevel } = useAuth();

  return (
    <div className="flex flex-col h-full bg-background relative isolate" dir="rtl">
      {/* Header */}
      <PageHeader
        icon={Menu}
        title="المزيد"
        subtitle="الوصول السريع إلى أقسام النظام"
      />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {menus.map((m) => (
              <NavLink
                key={m.path}
                to={m.path}
                className="flex flex-col items-center gap-2 p-4 bg-surface border border-border rounded-xl shadow-sm hover:border-accent transition-colors relative"
              >
                {PROTECTED.has(m.path) && accessLevel !== 'admin' && (
                  <div className="absolute top-2 end-2">
                    <Lock className="w-3.5 h-3.5 text-accent opacity-70" />
                  </div>
                )}
                <m.icon className="w-8 h-8 text-accent" />
                <span className="font-medium text-sm text-center" style={{ fontFamily: 'Tajawal, sans-serif' }}>{m.label}</span>
              </NavLink>
            ))}
          </div>

          {/* About App / Version */}
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center justify-center text-center gap-1 shadow-sm">
            <h4 className="font-bold text-sm text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>حول التطبيق</h4>
            <p className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>نظام آية للمبيعات ونقاط البيع (Aya POS)</p>
            <span className="text-xs font-semibold bg-muted text-text-secondary px-2.5 py-1 rounded-full numeric mt-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>الإصدار 1.0</span>
          </div>
        </div>
      </main>
    </div>
  );
}
