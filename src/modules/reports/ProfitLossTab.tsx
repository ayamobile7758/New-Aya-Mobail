import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProfitAndLoss } from '@/db/queries/reports';
import { formatMoney } from '@/lib/money';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { Printer, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Period = 'today' | 'week' | 'month' | 'custom';

function todayStr() { return format(new Date(), 'yyyy-MM-dd'); }

function periodDates(period: Period, cf: string, ct: string): { from: string; to: string } {
  const now = new Date();
  if (period === 'today') return { from: todayStr(), to: todayStr() };
  if (period === 'week') return {
    from: format(startOfWeek(now, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    to: format(endOfWeek(now, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
  };
  if (period === 'month') return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd'),
  };
  return { from: cf || todayStr(), to: ct || todayStr() };
}

function dinars(fils: number): string {
  return (fils / 100).toFixed(2);
}

function pct(value: number, base: number): string {
  if (base === 0) return '—';
  return ((value / base) * 100).toFixed(1) + '%';
}

function SectionHeader({ children }: { children: string }) {
  return (
    <tr>
      <td colSpan={3}
        className="py-2 ps-3 font-bold text-accent text-sm bg-accent/5"
        style={{ fontFamily: 'Tajawal, sans-serif' }}
      >
        {children}
      </td>
    </tr>
  );
}

function Row({
  label, value, percent, bold, indent, negative, divider,
}: {
  label: string;
  value: number | null;
  percent?: string;
  bold?: boolean;
  indent?: boolean;
  negative?: boolean;
  divider?: boolean;
}) {
  const absDisp = value !== null ? formatMoney(Math.abs(value)) : '';
  const displayed = value !== null
    ? negative && value > 0
      ? `(${absDisp})`
      : absDisp
    : '';

  return (
    <tr className={cn(divider && 'border-t-2 border-border')}>
      <td
        className={cn(
          'py-2 text-sm',
          indent ? 'ps-8 text-text-secondary' : 'ps-3',
          bold && 'font-bold',
        )}
        style={{ fontFamily: 'Tajawal, sans-serif' }}
      >
        {label}
      </td>
      <td
        className={cn(
          'py-2 text-end pe-4 numeric text-sm',
          bold && 'font-bold',
          negative && value !== null && value > 0 ? 'text-danger' : '',
          !negative && bold && value !== null && value >= 0 ? 'text-success' : '',
          !negative && bold && value !== null && value < 0 ? 'text-danger' : '',
        )}
      >
        {displayed}
      </td>
      <td className="py-2 text-end pe-3 text-text-secondary text-xs numeric">
        {percent ?? ''}
      </td>
    </tr>
  );
}

export function ProfitLossTab() {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(todayStr());

  const { from, to } = periodDates(period, customFrom, customTo);

  const { data: pl, isLoading } = useQuery({
    queryKey: ['pnl', from, to],
    queryFn: () => getProfitAndLoss(from, to),
  });

  const handlePrint = () => window.print();

  const handleExcel = async () => {
    if (!pl) return;
    try {
      const XLSX = (await import('xlsx')).default;
      const rows = [
        { 'البند': 'إجمالي المبيعات',           'المبلغ (د.أ)': dinars(pl.sales_gross) },
        { 'البند': 'المرتجعات',                 'المبلغ (د.أ)': `(${dinars(pl.returns_total)})` },
        { 'البند': 'صافي المبيعات',             'المبلغ (د.أ)': dinars(pl.sales_net) },
        { 'البند': 'تكلفة المبيعات (COGS)',     'المبلغ (د.أ)': `(${dinars(pl.cogs)})` },
        { 'البند': 'مجمل الربح',                'المبلغ (د.أ)': dinars(pl.gross_profit) },
        ...pl.expenses_by_category.map(e => ({
          'البند': `    ${e.category_name}`,
          'المبلغ (د.أ)': `(${dinars(e.total)})`,
        })),
        { 'البند': 'إجمالي المصاريف',           'المبلغ (د.أ)': `(${dinars(pl.expenses_total)})` },
        { 'البند': 'ربح الشحن',                 'المبلغ (د.أ)': dinars(pl.topup_profit) },
        { 'البند': 'إيرادات الصيانة',           'المبلغ (د.أ)': dinars(pl.maintenance_revenue) },
        { 'البند': 'إجمالي الإيرادات الأخرى',  'المبلغ (د.أ)': dinars(pl.other_income) },
        { 'البند': 'صافي الربح',                'المبلغ (د.أ)': dinars(pl.net_profit) },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(rows),
        'بيان الأرباح والخسائر',
      );
      XLSX.writeFile(wb, `pnl_${from}_to_${to}.xlsx`);
    } catch {
      toast.error('فشل تصدير Excel');
    }
  };

  return (
    <div className="space-y-5">

      {/* ── Period + action controls ── */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        {([
          { id: 'today',  label: 'اليوم' },
          { id: 'week',   label: 'هذا الأسبوع' },
          { id: 'month',  label: 'هذا الشهر' },
          { id: 'custom', label: 'مخصص' },
        ] as const).map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}
            className={cn(
              'px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors',
              period === p.id
                ? 'bg-accent text-white border-accent'
                : 'border-border text-text-secondary hover:border-accent hover:text-accent',
            )}
          >
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date" value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 px-2 text-sm rounded-lg border border-border bg-background focus:border-accent outline-none"
              dir="ltr"
            />
            <span className="text-text-secondary">←</span>
            <input
              type="date" value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 px-2 text-sm rounded-lg border border-border bg-background focus:border-accent outline-none"
              dir="ltr"
            />
          </div>
        )}

        <div className="flex gap-2 ms-auto">
          <button
            onClick={handleExcel}
            disabled={!pl || isLoading}
            className="h-9 px-3 bg-success text-white font-bold text-sm rounded-xl hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
            style={{ fontFamily: 'Tajawal, sans-serif' }}
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={handlePrint}
            className="h-9 px-3 border border-border text-sm font-bold rounded-xl hover:bg-muted transition-colors flex items-center gap-1.5"
            style={{ fontFamily: 'Tajawal, sans-serif' }}
          >
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        </div>
      </div>

      {/* ── P&L Document ── */}
      {isLoading ? (
        <div className="p-16 flex justify-center">
          <div className="animate-spin w-10 h-10 border-4 border-accent/30 border-t-accent rounded-full" />
        </div>
      ) : pl ? (
        <div id="pnl-print-zone" className="bg-surface border border-border rounded-2xl overflow-hidden">

          {/* Document heading */}
          <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-xl" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                بيان الأرباح والخسائر
              </h2>
              <p className="text-sm text-text-secondary numeric mt-0.5">
                {from === to ? from : `${from}  —  ${to}`}
              </p>
            </div>
            <div className={cn(
              'flex items-center gap-2 font-bold text-2xl numeric px-4 py-2 rounded-xl shrink-0',
              pl.net_profit >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
            )}>
              {pl.net_profit >= 0
                ? <TrendingUp className="w-6 h-6" />
                : <TrendingDown className="w-6 h-6" />}
              {formatMoney(pl.net_profit)}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full" dir="rtl">
              <thead>
                <tr className="bg-muted text-text-secondary text-xs border-b border-border">
                  <th className="py-2.5 ps-3 text-start w-1/2" style={{ fontFamily: 'Tajawal, sans-serif' }}>البند</th>
                  <th className="py-2.5 text-end pe-4"         style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ (د.أ)</th>
                  <th className="py-2.5 text-end pe-3 w-24"    style={{ fontFamily: 'Tajawal, sans-serif' }}>% من المبيعات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">

                {/* ── المبيعات ── */}
                <SectionHeader>المبيعات</SectionHeader>
                <Row label="إجمالي المبيعات" value={pl.sales_gross} indent />
                <Row label="المرتجعات"       value={pl.returns_total} indent negative />
                <Row label="صافي المبيعات"   value={pl.sales_net}    bold divider percent="100%" />

                {/* ── COGS ── */}
                <SectionHeader>تكلفة البضاعة المباعة (COGS)</SectionHeader>
                <Row label="تكلفة المبيعات" value={pl.cogs} indent negative />

                {/* ── مجمل الربح ── */}
                <Row
                  label="مجمل الربح"
                  value={pl.gross_profit}
                  bold divider
                  percent={pct(pl.gross_profit, pl.sales_net)}
                />

                {/* ── المصاريف ── */}
                <SectionHeader>المصاريف</SectionHeader>
                {pl.expenses_by_category.length > 0
                  ? pl.expenses_by_category.map(e => (
                    <Row key={e.category_name} label={e.category_name} value={e.total} indent negative />
                  ))
                  : <Row label="لا توجد مصاريف" value={null} indent />
                }
                <Row
                  label="إجمالي المصاريف"
                  value={pl.expenses_total}
                  bold negative divider
                  percent={pct(pl.expenses_total, pl.sales_net)}
                />

                {/* ── إيرادات أخرى ── */}
                <SectionHeader>إيرادات أخرى</SectionHeader>
                <Row label="ربح الشحن"              value={pl.topup_profit}         indent />
                <Row label="إيرادات الصيانة"        value={pl.maintenance_revenue}  indent />
                <Row
                  label="إجمالي الإيرادات الأخرى"
                  value={pl.other_income}
                  bold divider
                  percent={pct(pl.other_income, pl.sales_net)}
                />

                {/* ── صافي الربح ── */}
                <tr className="border-t-2 border-accent/40 bg-accent/5">
                  <td className="py-3.5 ps-3 font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    صافي الربح
                  </td>
                  <td className={cn(
                    'py-3.5 text-end pe-4 font-bold text-xl numeric',
                    pl.net_profit >= 0 ? 'text-success' : 'text-danger',
                  )}>
                    {formatMoney(pl.net_profit)}
                  </td>
                  <td className="py-3.5 text-end pe-3 text-text-secondary text-sm numeric">
                    {pct(pl.net_profit, pl.sales_net)}
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── Print stylesheet ── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pnl-print-zone,
          #pnl-print-zone * { visibility: visible; }
          #pnl-print-zone {
            position: fixed;
            inset: 0;
            background: white;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
