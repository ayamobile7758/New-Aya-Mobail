import { useQuery } from '@tanstack/react-query';
import { getDailySummary } from '@/db/queries/operations';
import { getActiveAccounts } from '@/db/queries/accounts';
import { getLowStockProducts } from '@/db/queries/products';
import { getJobs } from '@/db/queries/maintenance';
import { getRecentInvoices } from '@/db/queries/sales';
import { getReport } from '@/db/queries/reports';
import { formatMoney } from '@/lib/money';
import { Wallet, TrendingUp, HandCoins, Package, Wrench, Receipt, AlertTriangle, CheckCircle, Banknote, CreditCard, Building2, Smartphone, LayoutDashboard } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { format, parseISO, startOfWeek, startOfMonth } from 'date-fns';

const TYPE_LABELS: Record<string, string> = {
  cash: 'نقداً',
  bank: 'بنوك',
  wallet: 'محافظ',
  card: 'بطاقات',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-4 h-4" />,
  bank: <Building2 className="w-4 h-4" />,
  wallet: <Smartphone className="w-4 h-4" />,
  card: <CreditCard className="w-4 h-4" />,
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const weekStartStr = format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
  const monthStartStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const { data: summary } = useQuery({
    queryKey: ['daily-summary', ''],
    queryFn: () => getDailySummary()
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts
  });

  const { data: lowStockProducts = [] } = useQuery({
    queryKey: ['low-stock-products'],
    queryFn: getLowStockProducts,
    staleTime: 60_000,
  });

  const { data: maintenanceJobs = [] } = useQuery({
    queryKey: ['maintenance-jobs-active'],
    queryFn: () => getJobs('all')
  });

  const { data: recentInvoices = [] } = useQuery({
    queryKey: ['recent-invoices-dashboard'],
    queryFn: () => getRecentInvoices(5)
  });

  const { data: reportToday } = useQuery({
    queryKey: ['report', todayStr, todayStr],
    queryFn: () => getReport(todayStr, todayStr),
  });

  const { data: reportWeek } = useQuery({
    queryKey: ['report', weekStartStr, todayStr],
    queryFn: () => getReport(weekStartStr, todayStr),
  });

  const { data: reportMonth } = useQuery({
    queryKey: ['report', monthStartStr, todayStr],
    queryFn: () => getReport(monthStartStr, todayStr),
  });

  const liquidityAccounts = accounts.filter(a =>
    a.type === 'cash' || a.type === 'card' || a.type === 'bank' || a.type === 'wallet'
  );

  const totalLiquidity = liquidityAccounts.reduce((sum, acc) => sum + acc.balance, 0);

  const liquidityByType = (['cash', 'bank', 'wallet', 'card'] as const).map(type => ({
    type,
    label: TYPE_LABELS[type],
    icon: TYPE_ICONS[type],
    total: liquidityAccounts.filter(a => a.type === type).reduce((sum, a) => sum + a.balance, 0),
  }));

  const pendingJobs = maintenanceJobs.filter(j => j.status === 'new' || j.status === 'in_progress');

  const QUICK_LINKS = [
    { icon: <Package className="w-5 h-5" />, label: 'المستودع', path: '/products', color: 'bg-purple-500 text-white' },
    { icon: <Wrench className="w-5 h-5" />, label: 'الصيانة', path: '/maintenance', color: 'bg-orange-500 text-white' },
    { icon: <Receipt className="w-5 h-5" />, label: 'المصروفات', path: '/expenses', color: 'bg-rose-500 text-white' },
    { icon: <Wallet className="w-5 h-5" />, label: 'الحركة المالية', path: '/operations', color: 'bg-emerald-500 text-white' },
  ];

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold">مرحباً بك في لوحة القيادة</h1>
                <p className="text-sm text-text-secondary">نظرة عامة على نشاط متجرك اليوم</p>
              </div>
            </div>
            
            <div className="bg-surface border border-border p-4 rounded-2xl flex items-center gap-4 w-full sm:w-auto sm:min-w-[250px] shrink-0">
              <div className="w-11 h-11 rounded-full bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm text-text-secondary">إجمالي الأرصدة</div>
                <div className="text-2xl font-bold numeric">{formatMoney(totalLiquidity)}</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto space-y-6 w-full">

        {/* Start POS Big Action */}
        <section className="bg-gradient-to-r from-accent to-accent/80 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden shadow-lg flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="absolute top-0 end-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -me-20 -mt-20 pointer-events-none" />
          <div className="z-10 text-center md:text-start flex-1">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">هل أنت مستعد لاستقبال عميل جديد؟</h2>
            <p className="text-white/80 max-w-md">انتقل إلى شاشة نقطة البيع لإنشاء فواتير المبيعات بسرعة وسهولة.</p>
          </div>
          <button 
            onClick={() => navigate('/pos')}
            className="z-10 bg-white text-accent hover:bg-white/90 font-bold text-lg px-8 py-4 rounded-2xl shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center gap-3 whitespace-nowrap"
          >
            <HandCoins className="w-6 h-6" />
            <span>نقطة البيع (POS)</span>
          </button>
        </section>

        {/* السيولة المتاحة */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-accent" /> السيولة المتاحة
          </h2>
          <div className="bg-surface border border-border rounded-2xl p-6">
            <div className="text-4xl font-bold numeric text-accent mb-6">{formatMoney(totalLiquidity)}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {liquidityByType.map(({ type, label, icon, total }) => (
                <div key={type} className="bg-background border border-border rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-text-secondary text-sm">
                    {icon}
                    <span>{label}</span>
                  </div>
                  <div className="text-lg font-bold numeric">{formatMoney(total)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Profit Cards */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-accent" /> صافي الأرباح
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-surface border border-border p-5 rounded-2xl">
              <div className="text-text-secondary text-sm mb-2">ربح اليوم</div>
              <div className={cn(
                "text-2xl font-bold numeric",
                (reportToday?.kpi.netProfit ?? 0) >= 0 ? "text-success" : "text-danger"
              )}>
                {formatMoney(reportToday?.kpi.netProfit ?? 0)}
              </div>
            </div>
            <div className="bg-surface border border-border p-5 rounded-2xl">
              <div className="text-text-secondary text-sm mb-2">ربح هذا الأسبوع</div>
              <div className={cn(
                "text-2xl font-bold numeric",
                (reportWeek?.kpi.netProfit ?? 0) >= 0 ? "text-success" : "text-danger"
              )}>
                {formatMoney(reportWeek?.kpi.netProfit ?? 0)}
              </div>
            </div>
            <div className="bg-surface border border-border p-5 rounded-2xl">
              <div className="text-text-secondary text-sm mb-2">ربح هذا الشهر</div>
              <div className={cn(
                "text-2xl font-bold numeric",
                (reportMonth?.kpi.netProfit ?? 0) >= 0 ? "text-success" : "text-danger"
              )}>
                {formatMoney(reportMonth?.kpi.netProfit ?? 0)}
              </div>
            </div>
          </div>
        </section>

        {summary && (
          <section>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-accent" /> ملخص اليوم
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface border border-border p-5 rounded-2xl">
                <div className="text-text-secondary text-sm mb-2">المبيعات</div>
                <div className="text-2xl font-bold numeric text-accent">{formatMoney(summary.sales)}</div>
              </div>
              <div className="bg-surface border border-border p-5 rounded-2xl">
                <div className="text-text-secondary text-sm mb-2">المصروفات</div>
                <div className="text-2xl font-bold numeric text-danger">{formatMoney(summary.expenses)}</div>
              </div>
              <div className="bg-success-bg/50 border border-success/20 p-5 rounded-2xl">
                <div className="text-success font-medium text-sm mb-2">مقبوضات (صناديق)</div>
                <div className="text-2xl font-bold numeric text-success">{formatMoney(summary.totalIn)}</div>
              </div>
              <div className="bg-danger-bg/50 border border-danger/20 p-5 rounded-2xl">
                <div className="text-danger font-medium text-sm mb-2">مدفوعات (صناديق)</div>
                <div className="text-2xl font-bold numeric text-danger">{formatMoney(summary.totalOut)}</div>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col">
              <div className="p-4 border-b border-border bg-muted/30 flex justify-between items-center">
                <h2 className="text-lg font-bold">آخر 5 فواتير مبيعات</h2>
                <Link to="/sales" className="text-accent text-sm font-medium hover:underline">عرض الكل</Link>
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-start min-w-[640px]">
                  <thead className="bg-muted text-text-secondary font-medium">
                    <tr>
                      <th className="px-4 py-3">رقم الفاتورة</th>
                      <th className="px-4 py-3">الوقت</th>
                      <th className="px-4 py-3">العميل</th>
                      <th className="px-4 py-3 text-end">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentInvoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-accent">#{inv.invoice_number}</td>
                        <td className="px-4 py-3" dir="ltr">{format(parseISO(inv.created_at), 'hh:mm a')}</td>
                        <td className="px-4 py-3">{inv.customer_name || 'عميل نقدي'}</td>
                        <td className="px-4 py-3 text-end font-bold numeric">{formatMoney(inv.total_amount)}</td>
                      </tr>
                    ))}
                    {recentInvoices.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">لا توجد فواتير اليوم</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden p-4 space-y-3">
                {recentInvoices.map(inv => (
                  <div key={inv.id} className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-accent">#{inv.invoice_number}</span>
                      <span className="text-text-secondary text-xs" dir="ltr">{format(parseISO(inv.created_at), 'hh:mm a')}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-text-secondary font-medium">{inv.customer_name || 'عميل نقدي'}</span>
                      <span className="font-bold numeric text-text-primary">{formatMoney(inv.total_amount)}</span>
                    </div>
                  </div>
                ))}
                {recentInvoices.length === 0 && (
                  <div className="text-center py-8 text-text-secondary">لا توجد فواتير اليوم</div>
                )}
              </div>
            </section>
            
            <section>
              <h2 className="text-lg font-bold mb-4">روابط سريعة</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {QUICK_LINKS.map(link => (
                  <Link 
                    key={link.path} 
                    to={link.path}
                    className="bg-surface border border-border p-5 rounded-2xl flex flex-col items-center justify-center gap-3 hover:border-accent hover:shadow-md transition-all group"
                  >
                    <div className={cn("w-12 h-12 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm", link.color)}>
                      {link.icon}
                    </div>
                    <span className="font-medium text-sm text-center">{link.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="bg-surface border border-border rounded-2xl flex flex-col overflow-hidden h-fit">
              <div className="p-4 border-b border-border bg-danger/5 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-danger" />
                <h2 className="text-lg font-bold text-danger">تنبيهات المخزون</h2>
              </div>
              <div className="p-4 space-y-3">
                {lowStockProducts.length === 0 ? (
                  <div className="text-center py-6 text-text-secondary flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-success opacity-50" />
                    <span>المخزون بحالة جيدة</span>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[250px] overflow-y-auto no-scrollbar">
                    {lowStockProducts.slice(0, 10).map(product => (
                      <div key={product.id} className="flex justify-between items-center bg-muted/50 p-3 rounded-xl border border-border">
                        <div className="font-medium line-clamp-1 flex-1">{product.name}</div>
                        <div className="flex flex-col items-end shrink-0 ms-2">
                          <span className="text-xs text-text-secondary">الكمية</span>
                          <span className="font-bold numeric text-danger">{product.stock_qty}</span>
                        </div>
                      </div>
                    ))}
                    {lowStockProducts.length > 10 && (
                      <div className="text-center text-sm text-text-secondary pt-2">
                        + {lowStockProducts.length - 10} منتجات أخرى...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-surface border border-border rounded-2xl flex flex-col overflow-hidden h-fit">
              <div className="p-4 border-b border-border bg-warning/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-warning" />
                  <h2 className="text-lg font-bold text-warning">صيانة قيد التنفيذ</h2>
                </div>
                <div className="bg-warning text-white text-xs font-bold px-2 py-1 rounded-full">{pendingJobs.length}</div>
              </div>
              <div className="p-4 space-y-3">
                {pendingJobs.length === 0 ? (
                  <div className="text-center py-6 text-text-secondary flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-success opacity-50" />
                    <span>لا توجد أجهزة قيد الصيانة</span>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[250px] overflow-y-auto no-scrollbar">
                    {pendingJobs.slice(0, 5).map(job => (
                      <div key={job.id} className="bg-muted/50 p-3 rounded-xl border border-border">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-sm">{job.customer_name}</span>
                          <span className="text-xs font-bold text-accent">#{job.job_number}</span>
                        </div>
                        <div className="text-xs text-text-secondary">{job.device_type}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        </div>
      </main>
    </div>
  );
}
