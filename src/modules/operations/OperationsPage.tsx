import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDailySummary, getLedgerForPeriod, type LedgerRow } from '@/db/queries/operations';
import { isDayClosed, getDayClosures, reopenDay, type DayClosureSnapshot } from '@/db/queries/closures';
import { formatMoney } from '@/lib/money';
import {
  ArrowDownRight, ArrowUpRight, ArrowRightLeft, PlusCircle,
  Lock, LockOpen, CheckCircle2, History, TrendingUp, TrendingDown,
  Receipt, Package, Tag, Gift, DollarSign, Download, FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfMonth } from 'date-fns';
import { TopupDialog } from './components/TopupDialog';
import { TransferDialog } from './components/TransferDialog';
import { EODCloseDialog } from './components/EODCloseDialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type Tab = 'ledger' | 'eod';

const today = format(new Date(), 'yyyy-MM-dd');

export default function OperationsPage() {
  const { requireAdminAction } = useAuth();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>('ledger');
  const [date, setDate] = useState(today);
  const [ledgerFrom, setLedgerFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [ledgerTo, setLedgerTo] = useState(today);
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isEODOpen, setIsEODOpen] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ['daily-summary', date],
    queryFn: () => getDailySummary(date),
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['ledger-period', ledgerFrom, ledgerTo],
    queryFn: () => getLedgerForPeriod(ledgerFrom, ledgerTo),
    enabled: activeTab === 'ledger',
  });

  const exportCSV = useCallback(() => {
    if (!entries.length) { toast.error('لا توجد بيانات للتصدير'); return; }
    const BOM = '\uFEFF';
    const header = ['التاريخ', 'تاريخ القيد', 'الحساب', 'نوع الحساب', 'الاتجاه', 'المبلغ (بالدينار)', 'المرجع', 'الوصف'];
    const dirLabel = (d: string) => d === 'credit' ? 'دائن' : 'مدين';
    const rows = (entries as LedgerRow[]).map(r => [
      r.entry_date,
      r.created_at,
      r.account_name ?? '',
      r.account_type ?? '',
      dirLabel(r.direction),
      (r.amount / 100).toFixed(2),
      r.ref_type ? `${r.ref_type}/${r.ref_id ?? ''}` : '',
      r.description,
    ]);
    const csv = BOM + [header, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger_${ledgerFrom}_to_${ledgerTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [entries, ledgerFrom, ledgerTo]);

  const exportXLSX = useCallback(async () => {
    if (!entries.length) { toast.error('لا توجد بيانات للتصدير'); return; }
    try {
      const XLSX = (await import('xlsx')).default;
      const dirLabel = (d: string) => d === 'credit' ? 'دائن' : 'مدين';
      const rows = (entries as LedgerRow[]).map(r => ({
        'التاريخ':          r.entry_date,
        'تاريخ القيد':      r.created_at,
        'الحساب':           r.account_name ?? '',
        'نوع الحساب':       r.account_type ?? '',
        'الاتجاه':          dirLabel(r.direction),
        'المبلغ (بالدينار)': parseFloat((r.amount / 100).toFixed(2)),
        'المرجع':           r.ref_type ? `${r.ref_type}/${r.ref_id ?? ''}` : '',
        'الوصف':            r.description,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'سجل القيود');
      XLSX.writeFile(wb, `ledger_${ledgerFrom}_to_${ledgerTo}.xlsx`);
    } catch {
      toast.error('فشل تصدير Excel');
    }
  }, [entries, ledgerFrom, ledgerTo]);

  const { data: todayClosed = false, refetch: refetchTodayStatus } = useQuery({
    queryKey: ['day-status', today],
    queryFn: () => isDayClosed(today),
    refetchInterval: 30000,
  });

  const { data: closureRow } = useQuery({
    queryKey: ['day-status-row', today],
    queryFn: async () => {
      const rows = await getDayClosures();
      return rows.find(r => r.closure_date === today) ?? null;
    },
    enabled: todayClosed,
  });

  const { data: closureHistory = [] } = useQuery({
    queryKey: ['day-closures-history'],
    queryFn: getDayClosures,
    enabled: activeTab === 'eod',
  });

  const reopenMutation = useMutation({
    mutationFn: (date: string) => reopenDay(date),
    onSuccess: (_d, date) => {
      toast.success(`تم فتح يوم ${date}`);
      qc.invalidateQueries({ queryKey: ['day-status'] });
      qc.invalidateQueries({ queryKey: ['day-status-row'] });
      qc.invalidateQueries({ queryKey: ['day-closures-history'] });
      qc.invalidateQueries({ queryKey: ['daily-summary'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'فشل فتح اليوم'),
  });

  const handleReopen = (date: string) => {
    requireAdminAction(() => reopenMutation.mutate(date));
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'ledger', label: 'الحركة المالية', icon: ArrowRightLeft },
    { id: 'eod', label: 'الإقفال اليومي', icon: Lock },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Header ── */}
      <header className="bg-surface border-b border-border px-4 pt-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>الحركة المالية والسجل</h1>
              <p className="text-sm text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>متابعة كافة حركات الصناديق والمصروفات والمبيعات</p>
            </div>
            {activeTab === 'ledger' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsTopupOpen(true)}
                  className="h-[var(--btn-height)] px-4 bg-surface border border-border flex items-center gap-2 rounded-lg hover:border-accent font-medium text-sm transition-colors"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  <PlusCircle className="w-4 h-4 text-accent" />
                  شحن رصيد
                </button>
                <button
                  onClick={() => setIsTransferOpen(true)}
                  className="h-[var(--btn-height)] px-4 bg-surface border border-border flex items-center gap-2 rounded-lg hover:border-accent font-medium text-sm transition-colors"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  <ArrowRightLeft className="w-4 h-4 text-accent" />
                  تحويل
                </button>
                <div className="flex items-center gap-2 bg-muted p-1 rounded-xl">
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="bg-transparent border-none outline-none font-medium px-2 py-1 text-sm cursor-pointer"
                    dir="ltr"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border -mx-4 px-4">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 border-b-2 font-medium whitespace-nowrap transition-colors',
                    activeTab === tab.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.id === 'eod' && todayClosed && (
                    <span className="ms-1 inline-flex w-2 h-2 rounded-full bg-success" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* ══ LEDGER TAB ══════════════════════════════════════════════════ */}
          {activeTab === 'ledger' && (
            <>
              {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-surface border border-border p-4 rounded-2xl flex flex-col justify-center">
                    <span className="text-text-secondary text-sm mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبيعات (الكل)</span>
                    <span className="font-bold text-xl md:text-2xl numeric text-accent">{formatMoney(summary.sales)}</span>
                  </div>
                  <div className="bg-surface border border-border p-4 rounded-2xl flex flex-col justify-center">
                    <span className="text-text-secondary text-sm mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>المصاريف</span>
                    <span className="font-bold text-xl md:text-2xl numeric text-danger">{formatMoney(summary.expenses)}</span>
                  </div>
                  <div className="bg-success-bg/50 border border-success/20 p-4 rounded-2xl flex flex-col justify-center">
                    <span className="text-success text-sm font-medium mb-1 flex items-center gap-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                      <ArrowDownRight className="w-4 h-4" />مقبوضات (داخل)
                    </span>
                    <span className="font-bold text-xl md:text-2xl numeric text-success">{formatMoney(summary.totalIn)}</span>
                  </div>
                  <div className="bg-danger-bg/50 border border-danger/20 p-4 rounded-2xl flex flex-col justify-center">
                    <span className="text-danger text-sm font-medium mb-1 flex items-center gap-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                      <ArrowUpRight className="w-4 h-4" />مدفوعات (خارج)
                    </span>
                    <span className="font-bold text-xl md:text-2xl numeric text-danger">{formatMoney(summary.totalOut)}</span>
                  </div>
                </div>
              )}

              {/* ── Ledger filter + export row ── */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 bg-muted p-1 rounded-xl">
                  <input type="date" value={ledgerFrom} dir="ltr"
                    onChange={e => setLedgerFrom(e.target.value)}
                    className="bg-transparent border-none outline-none font-medium px-2 py-1 text-sm cursor-pointer" />
                  <span className="text-text-secondary text-xs">←</span>
                  <input type="date" value={ledgerTo} dir="ltr"
                    onChange={e => setLedgerTo(e.target.value)}
                    className="bg-transparent border-none outline-none font-medium px-2 py-1 text-sm cursor-pointer" />
                </div>
                <button
                  onClick={exportCSV}
                  disabled={isLoading}
                  className="h-9 px-3 bg-surface border border-border text-sm font-medium rounded-xl hover:border-accent transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  <Download className="w-4 h-4 text-accent" />
                  تصدير CSV
                </button>
                <button
                  onClick={exportXLSX}
                  disabled={isLoading}
                  className="h-9 px-3 bg-success text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  تصدير Excel
                </button>
                <span className="text-xs text-text-secondary ms-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  {isLoading ? '...' : `${entries.length} قيد`}
                </span>
              </div>

              <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-accent" />
                  <h2 className="font-bold text-lg" style={{ fontFamily: 'Tajawal, sans-serif' }}>سجل القيود المالية</h2>
                </div>

                {isLoading ? (
                  <div className="p-12 text-center">
                    <div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full" />
                  </div>
                ) : entries.length === 0 ? (
                  <div className="p-12 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    لا توجد حركات مالية في هذه الفترة.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {(entries as LedgerRow[]).map(entry => {
                      const isCredit = entry.direction === 'credit';
                      return (
                        <div key={entry.id} className="p-4 hover:bg-muted/30 transition-colors flex justify-between items-center gap-4">
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              'w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-1',
                              isCredit ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                            )}>
                              {isCredit ? <ArrowDownRight className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                            </div>
                            <div>
                              <p className="font-bold mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>{entry.description}</p>
                              <div className="flex items-center gap-2 text-xs text-text-secondary">
                                <span className="bg-muted px-1.5 py-0.5 rounded" style={{ fontFamily: 'Tajawal, sans-serif' }}>{entry.account_name}</span>
                                <span>•</span>
                                <span>{format(new Date(entry.created_at), 'HH:mm')}</span>
                                <span>•</span>
                                <span>{entry.entry_date}</span>
                              </div>
                            </div>
                          </div>
                          <div className={cn(
                            'font-bold text-lg numeric whitespace-nowrap px-3 py-1 rounded-lg',
                            isCredit ? 'text-success bg-success-bg/50' : 'text-danger bg-danger-bg/50'
                          )}>
                            {isCredit ? '+' : '-'} {formatMoney(entry.amount)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══ EOD TAB ═════════════════════════════════════════════════════ */}
          {activeTab === 'eod' && (
            <div className="space-y-6 animate-in fade-in">

              {/* Today's Status */}
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-accent" />
                  <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    حالة اليوم — {today}
                  </h3>
                </div>

                <div className="p-5">
                  {todayClosed ? (
                    /* ── Closed banner ── */
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-success/10 rounded-2xl flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-7 h-7 text-success" />
                        </div>
                        <div>
                          <p className="font-bold text-success text-lg" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            اليوم مُقفَل بنجاح
                          </p>
                          {closureRow?.closed_at && (
                            <p className="text-sm text-text-secondary numeric">
                              وقت الإقفال: {format(new Date(closureRow.closed_at), 'HH:mm — yyyy/MM/dd')}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleReopen(today)}
                        disabled={reopenMutation.isPending}
                        className="h-9 px-4 bg-warning/10 text-warning border border-warning/30 text-sm font-bold rounded-xl hover:bg-warning/20 transition-colors flex items-center gap-2 disabled:opacity-50 shrink-0"
                        style={{ fontFamily: 'Tajawal, sans-serif' }}
                      >
                        <LockOpen className="w-4 h-4" />
                        فتح اليوم
                      </button>
                    </div>
                  ) : (
                    /* ── Open state ── */
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0">
                          <LockOpen className="w-7 h-7 text-accent" />
                        </div>
                        <div>
                          <p className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            اليوم مفتوح
                          </p>
                          <p className="text-sm text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            يمكنك إجراء المبيعات والعمليات المالية
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setIsEODOpen(true)}
                        className="h-9 px-5 bg-accent text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 shrink-0"
                        style={{ fontFamily: 'Tajawal, sans-serif' }}
                      >
                        <Lock className="w-4 h-4" />
                        إقفال اليوم
                      </button>
                    </div>
                  )}
                </div>

                {/* Today's closure snapshot */}
                {todayClosed && closureRow && (
                  <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { icon: Receipt,      label: 'المبيعات',    value: closureRow.sales_total,    color: 'text-success' },
                      { icon: Package,      label: 'التكلفة',     value: closureRow.cogs_total,     color: 'text-warning' },
                      { icon: DollarSign,   label: 'المصاريف',    value: closureRow.expenses_total, color: 'text-danger' },
                      { icon: TrendingUp,   label: 'صافي الربح',  value: closureRow.net_profit,
                        color: closureRow.net_profit >= 0 ? 'text-success' : 'text-danger' },
                      { icon: Tag,          label: 'الخصومات',    value: closureRow.discounts_total, color: 'text-danger' },
                      { icon: Gift,         label: 'قيمة الهدايا', value: closureRow.gifts_value,    color: 'text-accent' },
                      { icon: TrendingDown, label: 'المردودات',   value: closureRow.returns_total,  color: 'text-danger' },
                    ].map(({ icon: Icon, label, value, color }) => (
                      <div key={label} className="bg-muted/40 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-1">
                          <Icon className="w-3.5 h-3.5" />
                          <span style={{ fontFamily: 'Tajawal, sans-serif' }}>{label}</span>
                        </div>
                        <p className={cn('font-bold numeric text-sm', color)}>{formatMoney(value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History Table */}
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                  <History className="w-4 h-4 text-accent" />
                  <h3 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    سجل الإقفالات السابقة
                  </h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-text-secondary">
                      <tr>
                        <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>التاريخ</th>
                        <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبيعات</th>
                        <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>التكلفة</th>
                        <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>المصاريف</th>
                        <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>صافي الربح</th>
                        <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>وقت الإقفال</th>
                        <th className="px-4 py-3 text-center" style={{ fontFamily: 'Tajawal, sans-serif' }}>إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {closureHistory.map((row: DayClosureSnapshot & { closed_at: string }) => (
                        <tr key={row.closure_date} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium numeric">{row.closure_date}</td>
                          <td className="px-4 py-3 text-end numeric font-bold text-success">{formatMoney(row.sales_total)}</td>
                          <td className="px-4 py-3 text-end numeric text-warning">{formatMoney(row.cogs_total)}</td>
                          <td className="px-4 py-3 text-end numeric text-danger">{formatMoney(row.expenses_total)}</td>
                          <td className={cn(
                            'px-4 py-3 text-end numeric font-bold',
                            row.net_profit >= 0 ? 'text-success' : 'text-danger'
                          )}>
                            {formatMoney(row.net_profit)}
                          </td>
                          <td className="px-4 py-3 text-end text-xs text-text-secondary numeric">
                            {format(new Date(row.closed_at), 'HH:mm')}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleReopen(row.closure_date)}
                              disabled={reopenMutation.isPending}
                              className="h-7 px-3 text-xs rounded-lg bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors font-medium disabled:opacity-40"
                              style={{ fontFamily: 'Tajawal, sans-serif' }}
                            >
                              فتح هذا اليوم
                            </button>
                          </td>
                        </tr>
                      ))}
                      {closureHistory.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            لا توجد إقفالات سابقة
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Dialogs ── */}
      <TopupDialog isOpen={isTopupOpen} onClose={() => setIsTopupOpen(false)} />
      <TransferDialog isOpen={isTransferOpen} onClose={() => setIsTransferOpen(false)} />
      <EODCloseDialog
        isOpen={isEODOpen}
        onClose={() => { setIsEODOpen(false); refetchTodayStatus(); }}
        targetDate={today}
      />
    </div>
  );
}
