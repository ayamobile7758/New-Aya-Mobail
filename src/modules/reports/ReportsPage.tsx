import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReport } from '@/db/queries/reports';
import { formatMoney } from '@/lib/money';
import {
  BarChart3, TrendingUp, TrendingDown, Receipt, Calendar,
  Download, Package, Target, RefreshCw, DollarSign,
  ShoppingBag, Percent, PieChart as PieChartIcon, Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { DiscountsGiftsTab } from './DiscountsGiftsTab';
import { ProfitLossTab } from './ProfitLossTab';
import { exportInvoicesCSV, exportExpensesCSV, exportTopupsCSV, exportMaintenanceCSV } from '@/lib/csv-export';

const ReactECharts = lazy(() => import('echarts-for-react'));

const COLORS = ['#CF694A', '#D4AF37', '#2A3F54', '#5CB85C', '#5BC0DE', '#F0AD4E', '#D9534F', '#9B59B6'];

type Period = 'today' | 'week' | 'month' | 'custom';

function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }

function periodDates(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (period === 'today') return { from: todayStr(), to: todayStr() };
  if (period === 'week') {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
      to: format(endOfWeek(now, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    };
  }
  if (period === 'month') {
    return {
      from: format(startOfMonth(now), 'yyyy-MM-dd'),
      to: format(endOfMonth(now), 'yyyy-MM-dd'),
    };
  }
  return { from: customFrom || todayStr(), to: customTo || todayStr() };
}

const ChartLoader = () => (
  <div className="h-full flex items-center justify-center">
    <div className="animate-spin w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full" />
  </div>
);

function KpiCard({
  icon: Icon, label, value, sub, color = 'text-text-primary',
}: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-text-secondary text-sm mb-1">
        <Icon className="w-4 h-4 shrink-0" />
        <span style={{ fontFamily: 'Tajawal, sans-serif' }}>{label}</span>
      </div>
      <div className={cn('text-2xl font-bold numeric', color)} style={{ fontFamily: 'Inter, sans-serif' }}>{value}</div>
      {sub && <div className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>{sub}</div>}
    </div>
  );
}

type Tab = 'overview' | 'categories' | 'products' | 'daily' | 'expenses' | 'discounts' | 'pnl';

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(todayStr());
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { from, to } = periodDates(period, customFrom, customTo);

  const { data: report, isLoading, refetch } = useQuery({
    queryKey: ['report', from, to],
    queryFn: () => getReport(from, to),
  });

  const handleExportExcel = () => {
    if (!report) return;
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'إجمالي المبيعات': report.kpi.totalSales,
      'إجمالي الخصومات': report.kpi.totalDiscounts,
      'عدد الفواتير': report.kpi.invoiceCount,
      'إجمالي التكلفة': report.kpi.totalCost,
      'مجمل الربح': report.kpi.grossProfit,
      'إجمالي المصاريف': report.kpi.totalExpenses,
      'صافي الربح': report.kpi.netProfit,
    }]), 'ملخص');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.daily.map(d => ({
      'التاريخ': d.date, 'المبيعات': d.sales, 'الخصومات': d.discounts,
      'التكلفة': d.cost, 'المصاريف': d.expenses, 'صافي الربح': d.netProfit,
    }))), 'يومي');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.salesByCategory.map(c => ({
      'الفئة': c.category, 'الإيراد': c.revenue, 'التكلفة': c.cost, 'الربح': c.profit,
    }))), 'فئات');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.topProducts.map(p => ({
      'المنتج': p.name, 'الكمية': p.qty, 'الإيراد': p.revenue, 'الربح': p.profit,
    }))), 'منتجات');

    XLSX.writeFile(wb, `تقرير_${from}_${to}.xlsx`);
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview',   label: 'نظرة عامة',         icon: Target },
    { id: 'categories', label: 'الفئات',             icon: PieChartIcon },
    { id: 'products',   label: 'المنتجات',           icon: Package },
    { id: 'daily',      label: 'يومي',               icon: Calendar },
    { id: 'expenses',   label: 'المصاريف',           icon: TrendingDown },
    { id: 'discounts',  label: 'الخصومات والهدايا', icon: Tag },
    { id: 'pnl',        label: 'الأرباح والخسائر',  icon: TrendingUp },
  ];

  const kpi = report?.kpi;

  const overviewBarOption = report ? {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => params.map(p => `${p.marker}${p.seriesName}: ${formatMoney(p.value)}`).join('<br/>'),
      textStyle: { fontFamily: 'Tajawal, sans-serif' },
    },
    legend: { data: ['المبيعات', 'التكلفة', 'المصاريف'], bottom: 0 },
    grid: { top: 10, right: 10, left: 10, bottom: 44, containLabel: true },
    xAxis: {
      type: 'category',
      data: report.daily.map(d => format(parseISO(d.date), 'dd/MM')),
      axisLabel: { fontSize: 11, rotate: report.daily.length > 14 ? 45 : 0 },
    },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 1000).toFixed(0)}k`, fontSize: 11 } },
    series: [
      { name: 'المبيعات', type: 'bar', data: report.daily.map(d => d.sales), itemStyle: { color: '#5CB85C', borderRadius: [3, 3, 0, 0] } },
      { name: 'التكلفة', type: 'bar', data: report.daily.map(d => d.cost), itemStyle: { color: '#F0AD4E', borderRadius: [3, 3, 0, 0] } },
      { name: 'المصاريف', type: 'bar', data: report.daily.map(d => d.expenses), itemStyle: { color: '#D9534F', borderRadius: [3, 3, 0, 0] } },
    ],
  } : {};

  const catPieOption = report ? {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}<br/>${formatMoney(p.value)} (${p.percent}%)`,
      textStyle: { fontFamily: 'Tajawal, sans-serif' },
    },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'], padAngle: 4,
      data: report.salesByCategory.map((s, i) => ({
        name: s.category, value: s.revenue,
        itemStyle: { color: COLORS[i % COLORS.length] },
      })),
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
    }],
  } : {};

  const topProductsBarOption = report ? {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => params.map(p => `${p.marker}${p.seriesName}: ${formatMoney(p.value)}`).join('<br/>'),
      textStyle: { fontFamily: 'Tajawal, sans-serif' },
    },
    grid: { top: 10, right: 20, left: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)}k` } },
    yAxis: {
      type: 'category',
      data: report.topProducts.map(p => p.name),
      axisLabel: { fontSize: 11, width: 110, overflow: 'truncate' },
    },
    series: [
      {
        name: 'الإيراد', type: 'bar',
        data: report.topProducts.map((p, i) => ({ value: p.revenue, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] } })),
      },
    ],
  } : {};

  const expPieOption = report ? {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
      textStyle: { fontFamily: 'Tajawal, sans-serif' },
    },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'], padAngle: 4,
      data: report.expensesByCategory.map((e, i) => ({
        name: e.category, value: e.total,
        itemStyle: { color: COLORS[(i + 3) % COLORS.length] },
      })),
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
    }],
  } : {};

  const periodLabel = period === 'today' ? 'اليوم'
    : period === 'week' ? 'هذا الأسبوع'
    : period === 'month' ? 'هذا الشهر'
    : `${from} → ${to}`;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Header ── */}
      <header className="bg-surface border-b border-border px-4 pt-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>التقارير التحليلية</h1>
                <p className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>{periodLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetch()}
                className="p-2 text-text-secondary hover:bg-muted rounded-lg transition-colors"
                title="تحديث"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleExportExcel}
                disabled={!report || isLoading}
                className="h-9 px-3 bg-success text-white font-bold text-sm rounded-xl hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Excel</span>
              </button>
            </div>
          </div>

          {/* Period picker — hidden for P&L tab (it manages its own period) */}
          <div className={cn('flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 flex-wrap', activeTab === 'pnl' && 'hidden')}>
            {([
              { id: 'today', label: 'اليوم' },
              { id: 'week', label: 'هذا الأسبوع' },
              { id: 'month', label: 'هذا الشهر' },
              { id: 'custom', label: 'فترة مخصصة' },
            ] as const).map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}
                className={cn(
                  'px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors',
                  period === p.id
                    ? 'bg-accent text-white border-accent'
                    : 'border-border text-text-secondary hover:border-accent hover:text-accent'
                )}
              >
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-8 px-2 text-sm rounded-lg border border-border bg-background focus:border-accent outline-none"
                  dir="ltr"
                />
                <span className="text-text-secondary text-sm">←</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-8 px-2 text-sm rounded-lg border border-border bg-background focus:border-accent outline-none"
                  dir="ltr"
                />
              </div>
            )}
          </div>

          {/* CSV Exports */}
          <div className={cn('flex flex-wrap gap-2 my-2 pb-3 border-b border-dashed border-border', activeTab === 'pnl' && 'hidden')}>
            <button
              onClick={() => exportInvoicesCSV(from, to)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg hover:border-accent text-xs font-medium text-text-primary"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <Download className="w-3.5 h-3.5" />
              تصدير المبيعات (CSV)
            </button>
            <button
              onClick={() => exportExpensesCSV(from, to)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg hover:border-accent text-xs font-medium text-text-primary"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <Download className="w-3.5 h-3.5" />
              تصدير المصروفات (CSV)
            </button>
            <button
              onClick={() => exportTopupsCSV(from, to)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg hover:border-accent text-xs font-medium text-text-primary"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <Download className="w-3.5 h-3.5" />
              تصدير الشحن (CSV)
            </button>
            <button
              onClick={() => exportMaintenanceCSV(from, to)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg hover:border-accent text-xs font-medium text-text-primary"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <Download className="w-3.5 h-3.5" />
              تصدير الصيانة (CSV)
            </button>
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto no-scrollbar gap-1 border-b border-border -mx-4 px-4">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 border-b-2 font-medium whitespace-nowrap transition-colors shrink-0',
                    isActive ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-5">
          {isLoading ? (
            <div className="p-16 flex justify-center">
              <div className="animate-spin w-10 h-10 border-4 border-accent/30 border-t-accent rounded-full" />
            </div>
          ) : report ? (
            <>
              {/* ── KPI Cards (always visible) ── */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard icon={Receipt} label="إجمالي المبيعات" value={formatMoney(kpi!.totalSales)}
                  sub={`${kpi!.invoiceCount} فاتورة`} color="text-text-primary" />
                <KpiCard icon={Percent} label="إجمالي الخصومات" value={formatMoney(kpi!.totalDiscounts)} color="text-danger" />
                <KpiCard icon={DollarSign} label="إجمالي التكلفة" value={formatMoney(kpi!.totalCost)} color="text-warning" />
                <KpiCard icon={TrendingUp} label="مجمل الربح" value={formatMoney(kpi!.grossProfit)}
                  color={kpi!.grossProfit >= 0 ? 'text-success' : 'text-danger'} />
                <KpiCard icon={TrendingDown} label="إجمالي المصاريف" value={formatMoney(kpi!.totalExpenses)} color="text-danger" />
                <KpiCard icon={Target} label="صافي الربح" value={formatMoney(kpi!.netProfit)}
                  sub="الربح − المصاريف" color={kpi!.netProfit >= 0 ? 'text-success' : 'text-danger'} />
                <KpiCard icon={ShoppingBag} label="القطع المباعة" value={kpi!.totalQty.toString()} color="text-accent" />
                <KpiCard icon={BarChart3} label="متوسط الفاتورة" value={formatMoney(Math.round(kpi!.avgInvoice))} />
                {kpi!.returnCount > 0 && (
                  <KpiCard icon={RefreshCw} label="المرتجعات" value={formatMoney(kpi!.returnValue)}
                    sub={`${kpi!.returnCount} فاتورة`} color="text-danger" />
                )}
              </div>

              {/* ── Tab content ── */}
              {activeTab === 'overview' && (
                <div className="space-y-5 animate-in fade-in">
                  {kpi!.invoiceCount === 0 ? (
                    <div className="text-center py-16 flex flex-col items-center gap-4 text-text-secondary bg-surface border border-border rounded-2xl">
                      <BarChart3 className="w-14 h-14 opacity-20" />
                      <div>
                        <p className="font-semibold text-text-primary text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات لهذه الفترة</p>
                        <p className="text-sm mt-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>لم يتم تسجيل أي مبيعات خلال هذه الفترة الزمنية</p>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="bg-surface border border-border rounded-2xl p-5">
                    <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                      مبيعات، تكلفة ومصاريف يومية
                    </h3>
                    <div className="h-[280px]" dir="ltr">
                      <Suspense fallback={<ChartLoader />}>
                        <ReactECharts option={overviewBarOption} style={{ height: '100%', width: '100%' }} />
                      </Suspense>
                    </div>
                  </div>

                  {/* By-account summary */}
                  {report.byAccount.length > 0 && (
                    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30">
                        <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبيعات حسب وسيلة الدفع</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-text-secondary">
                            <tr>
                              <th className="px-5 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الحساب</th>
                              <th className="px-5 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.byAccount.map((a: any, i: number) => (
                              <tr key={i} className="hover:bg-muted/30">
                                <td className="px-5 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{a.account_name}</td>
                                <td className="px-5 py-3 text-end font-bold numeric text-success">{formatMoney(a.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>
              )}

              {activeTab === 'categories' && (
                <div className="space-y-5 animate-in fade-in">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="bg-surface border border-border rounded-2xl p-5">
                      <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>الإيراد حسب الفئة</h3>
                      <div className="h-[280px]" dir="ltr">
                        {report.salesByCategory.length > 0 ? (
                          <Suspense fallback={<ChartLoader />}>
                            <ReactECharts option={catPieOption} style={{ height: '100%', width: '100%' }} />
                          </Suspense>
                        ) : (
                          <div className="h-full flex items-center justify-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30">
                        <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>تفصيل الفئات</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-text-secondary sticky top-0">
                            <tr>
                              <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الفئة</th>
                              <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الإيراد</th>
                              <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>التكلفة</th>
                              <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الربح</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.salesByCategory.map((c, i) => (
                              <tr key={i} className="hover:bg-muted/30">
                                <td className="px-4 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{c.category}</td>
                                <td className="px-4 py-3 text-end numeric font-bold">{formatMoney(c.revenue)}</td>
                                <td className="px-4 py-3 text-end numeric text-warning">{formatMoney(c.cost)}</td>
                                <td className={cn('px-4 py-3 text-end numeric font-bold', c.profit >= 0 ? 'text-success' : 'text-danger')}>
                                  {formatMoney(c.profit)}
                                </td>
                              </tr>
                            ))}
                            {report.salesByCategory.length === 0 && (
                              <tr><td colSpan={4} className="px-5 py-8 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'products' && (
                <div className="space-y-5 animate-in fade-in">
                  <div className="bg-surface border border-border rounded-2xl p-5">
                    <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>إيراد أفضل 10 منتجات</h3>
                    <div className="h-[300px]" dir="ltr">
                      {report.topProducts.length > 0 ? (
                        <Suspense fallback={<ChartLoader />}>
                          <ReactECharts option={topProductsBarOption} style={{ height: '100%', width: '100%' }} />
                        </Suspense>
                      ) : (
                        <div className="h-full flex items-center justify-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-border bg-muted/30">
                      <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>أفضل 10 منتجات مبيعاً</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-center w-12">#</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>المنتج</th>
                            <th className="px-4 py-3 text-center" style={{ fontFamily: 'Tajawal, sans-serif' }}>الكمية</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الإيراد</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الربح</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.topProducts.map((p, i) => (
                            <tr key={i} className="hover:bg-muted/30">
                              <td className="px-4 py-3 text-center text-text-secondary font-medium">{i + 1}</td>
                              <td className="px-4 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{p.name}</td>
                              <td className="px-4 py-3 text-center numeric font-bold">{p.qty}</td>
                              <td className="px-4 py-3 text-end numeric font-bold text-success">{formatMoney(p.revenue)}</td>
                              <td className={cn('px-4 py-3 text-end numeric font-bold', p.profit >= 0 ? 'text-success' : 'text-danger')}>
                                {formatMoney(p.profit)}
                              </td>
                            </tr>
                          ))}
                          {report.topProducts.length === 0 && (
                            <tr><td colSpan={5} className="px-5 py-8 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'daily' && (
                <div className="space-y-5 animate-in fade-in">
                  <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-border bg-muted/30">
                      <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                        التفصيل اليومي ({from} → {to})
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>التاريخ</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبيعات</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الخصومات</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>التكلفة</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المصاريف</th>
                            <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>صافي الربح</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.daily.map((d, i) => (
                            <tr key={i} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-medium numeric" style={{ fontFamily: 'Inter, sans-serif' }}>{d.date}</td>
                              <td className="px-4 py-3 text-end numeric font-bold">{formatMoney(d.sales)}</td>
                              <td className="px-4 py-3 text-end numeric text-danger">{d.discounts > 0 ? `− ${formatMoney(d.discounts)}` : '—'}</td>
                              <td className="px-4 py-3 text-end numeric text-warning">{formatMoney(d.cost)}</td>
                              <td className="px-4 py-3 text-end numeric text-danger">{d.expenses > 0 ? formatMoney(d.expenses) : '—'}</td>
                              <td className={cn('px-4 py-3 text-end numeric font-bold', d.netProfit >= 0 ? 'text-success' : 'text-danger')}>
                                {formatMoney(d.netProfit)}
                              </td>
                            </tr>
                          ))}
                          {report.daily.length === 0 && (
                            <tr><td colSpan={6} className="px-5 py-8 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات للفترة المختارة</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'discounts' && (
                <DiscountsGiftsTab from={from} to={to} />
              )}

              {activeTab === 'expenses' && (
                <div className="space-y-5 animate-in fade-in">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="bg-surface border border-border rounded-2xl p-5">
                      <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>المصاريف حسب الفئة</h3>
                      <div className="h-[280px]" dir="ltr">
                        {report.expensesByCategory.length > 0 ? (
                          <Suspense fallback={<ChartLoader />}>
                            <ReactECharts option={expPieOption} style={{ height: '100%', width: '100%' }} />
                          </Suspense>
                        ) : (
                          <div className="h-full flex items-center justify-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد مصاريف</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-border bg-muted/30">
                        <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>تفصيل المصاريف</h3>
                      </div>
                      <div className="overflow-y-auto max-h-[320px]">
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-text-secondary sticky top-0">
                            <tr>
                              <th className="px-5 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الفئة</th>
                              <th className="px-5 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.expensesByCategory.map((e, i) => (
                              <tr key={i} className="hover:bg-muted/30">
                                <td className="px-5 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{e.category}</td>
                                <td className="px-5 py-3 text-end numeric font-bold text-danger">{formatMoney(e.total)}</td>
                              </tr>
                            ))}
                            {report.expensesByCategory.length === 0 && (
                              <tr><td colSpan={2} className="px-5 py-8 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد بيانات</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* ══ P&L TAB ════════════════════════════════════════════════════ */}
          {activeTab === 'pnl' && (
            <div className="animate-in fade-in">
              <ProfitLossTab />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
