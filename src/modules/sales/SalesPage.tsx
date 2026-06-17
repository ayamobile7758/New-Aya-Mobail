import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchInvoices, returnInvoice, getInvoiceWithItems } from '@/db/queries/sales';
import { getActiveAccounts } from '@/db/queries/accounts';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, parseMoney } from '@/lib/money';
import { format } from 'date-fns';
import {
  FileText, ArrowRightLeft, Search, XCircle, X,
  Printer, RotateCcw, Package, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { ReceiptOverlay } from '@/components/receipt/ReceiptOverlay';
import { useEscKey } from '@/hooks/useEscKey';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

export default function SalesPage() {
  const queryClient = useQueryClient();

  // ── Filter state ──
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmountStr, setMinAmountStr] = useState('');
  const [maxAmountStr, setMaxAmountStr] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const debouncedInvoiceNumber = useDebounce(invoiceNumber, 300);

  // ── Detail panel state ──
  const [detailId, setDetailId] = useState<string | null>(null);

  // ── Return dialog state ──
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [refunds, setRefunds] = useState<{ accountId: string; amountInput: string }[]>([]);
  const returnTrapRef = useFocusTrap(returnDialogOpen);

  // ── Receipt overlay state ──
  const [receiptOverlayOpen, setReceiptOverlayOpen] = useState(false);
  const [receiptInvoiceData, setReceiptInvoiceData] = useState<any>(null);

  const { requireAdminAction } = useAuth();

  useEscKey(() => {
    if (receiptOverlayOpen) setReceiptOverlayOpen(false);
    else if (returnDialogOpen) setReturnDialogOpen(false);
    else if (detailId) setDetailId(null);
  }, !!(receiptOverlayOpen || returnDialogOpen || detailId));

  // ── Computed filters ──
  const hasFilters = !!(debouncedInvoiceNumber || dateFrom || dateTo || minAmountStr || maxAmountStr || filterAccountId);

  const filterArgs = {
    invoiceNumber: debouncedInvoiceNumber || undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
    minAmount: minAmountStr ? parseMoney(minAmountStr) : undefined,
    maxAmount: maxAmountStr ? parseMoney(maxAmountStr) : undefined,
    accountId: filterAccountId || undefined,
    limit: 100,
  };

  // ── Queries ──
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', filterArgs],
    queryFn: () => searchInvoices(filterArgs),
    staleTime: 0,
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['invoice-detail', detailId],
    queryFn: () => getInvoiceWithItems(detailId!),
    enabled: !!detailId,
    staleTime: 0,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
  });

  // ── Return mutation ──
  const returnMutation = useMutation({
    mutationFn: () => {
      const parsedRefunds = refunds
        .map(r => ({ accountId: r.accountId, amount: parseMoney(r.amountInput || '0') }))
        .filter(r => r.amount > 0);
      return returnInvoice(selectedInvoice.id, parsedRefunds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      toast.success('تم استرجاع الفاتورة بنجاح');
      setReturnDialogOpen(false);
      setDetailId(null);
    },
    onError: (err: any) => {
      toast.error('حدث خطأ: ' + err.message);
    },
  });

  // ── Helpers ──
  const resetFilters = () => {
    setInvoiceNumber('');
    setDateFrom('');
    setDateTo('');
    setMinAmountStr('');
    setMaxAmountStr('');
    setFilterAccountId('');
  };

  const openReturnDialog = (invoice: any) => {
    setSelectedInvoice(invoice);
    const defaultAccountId = invoice.payments?.[0]?.account_id || accounts[0]?.id || '';
    setRefunds([{ accountId: defaultAccountId, amountInput: (invoice.paid_amount / 100).toString() }]);
    setReturnDialogOpen(true);
  };

  const handleUpdateRefund = (index: number, field: string, value: string) => {
    const updated = [...refunds];
    updated[index] = { ...updated[index], [field]: value };
    setRefunds(updated);
  };

  const statusBadge = (status: string) => {
    if (status === 'returned')           return { label: 'مسترجع',          cls: 'bg-danger-bg text-danger' };
    if (status === 'partially_returned') return { label: 'استرجاع جزئي',    cls: 'bg-warning/10 text-warning' };
    if (status === 'cancelled')          return { label: 'ملغي',             cls: 'bg-muted text-text-secondary' };
    return                                      { label: 'مكتمل',            cls: 'bg-success-bg text-success' };
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">

      {/* ── Header + Filter bar ── */}
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-3">

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">فواتير المبيعات</h1>
              <p className="text-sm text-text-secondary">إدارة المبيعات السابقة واسترجاع الفواتير</p>
            </div>
          </div>

          {/* Invoice number search */}
          <div className="relative">
            <input
              type="text"
              placeholder="البحث برقم الفاتورة..."
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              className="w-full h-11 pe-10 ps-4 rounded-xl border border-border bg-background focus:border-accent outline-none text-sm"
            />
            {invoiceNumber ? (
              <button
                onClick={() => setInvoiceNumber('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <Search className="w-4 h-4 text-text-secondary absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
          </div>

          {/* Date + amount filters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-11 px-3 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none w-full"
              title="من تاريخ"
              dir="ltr"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-11 px-3 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none w-full"
              title="إلى تاريخ"
              dir="ltr"
            />
            <div className="relative">
              <input
                type="number"
                placeholder="الحد الأدنى..."
                value={minAmountStr}
                onChange={e => setMinAmountStr(e.target.value)}
                className="w-full h-11 ps-3 pe-8 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none numeric"
                min="0"
              />
              <span className="absolute end-2 top-1/2 -translate-y-1/2 text-text-secondary text-xs pointer-events-none">د.أ</span>
            </div>
            <div className="relative">
              <input
                type="number"
                placeholder="الحد الأعلى..."
                value={maxAmountStr}
                onChange={e => setMaxAmountStr(e.target.value)}
                className="w-full h-11 ps-3 pe-8 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none numeric"
                min="0"
              />
              <span className="absolute end-2 top-1/2 -translate-y-1/2 text-text-secondary text-xs pointer-events-none">د.أ</span>
            </div>
          </div>

          {/* Account filter + reset */}
          <div className="flex items-center gap-2">
            <select
              value={filterAccountId}
              onChange={e => setFilterAccountId(e.target.value)}
              className="flex-1 h-11 px-3 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none"
            >
              <option value="">جميع وسائل الدفع</option>
              {accounts.map((acc: any) => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="h-11 px-3 text-sm bg-muted hover:bg-muted/80 rounded-xl font-medium flex items-center gap-1.5 text-text-secondary whitespace-nowrap border border-border transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة ضبط
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Invoice list ── */}
      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto space-y-3">
          {isLoading ? (
            <div className="flex justify-center p-12">
              <div className="animate-spin w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center p-12 flex flex-col items-center gap-3 text-text-secondary bg-surface rounded-2xl border border-border">
              <Package className="w-12 h-12 opacity-20" />
              <div>
                <p className="font-semibold text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  {hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد فواتير بعد'}
                </p>
                <p className="text-sm mt-1">
                  {hasFilters
                    ? 'جرّب تعديل الفلاتر أو إعادة الضبط'
                    : 'ستظهر مبيعاتك هنا بعد أول عملية بيع'}
                </p>
              </div>
              {hasFilters && (
                <button
                  onClick={resetFilters}
                  className="mt-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors"
                >
                  إعادة ضبط الفلاتر
                </button>
              )}
            </div>
          ) : (
            invoices.map((inv: any) => {
              const { label, cls } = statusBadge(inv.status);
              return (
                <button
                  key={inv.id}
                  onClick={() => setDetailId(inv.id)}
                  className="w-full bg-surface border border-border p-4 rounded-2xl flex flex-col sm:flex-row justify-between sm:items-center gap-3 shadow-sm hover:border-accent/50 hover:shadow-md transition-all text-start active:scale-[0.99] cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-bold text-lg numeric">{inv.invoice_number}</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', cls)}>{label}</span>
                    </div>
                    <div className="text-sm text-text-secondary flex gap-3 flex-wrap">
                      <span>{inv.invoice_date}</span>
                      <span dir="ltr">{format(new Date(inv.created_at), 'HH:mm')}</span>
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="block text-xs text-text-secondary mb-0.5">الإجمالي</span>
                    <span className="font-bold text-lg numeric text-accent">{formatMoney(inv.total_amount)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </main>

      {/* ── Invoice detail panel (slides in from right/start in RTL) ── */}
      {detailId && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailId(null)} />
          <div className="absolute inset-y-0 start-0 w-[calc(100%-2rem)] max-w-md bg-surface shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">

            {/* Panel header */}
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">تفاصيل الفاتورة</h2>
              <button
                onClick={() => setDetailId(null)}
                className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Panel body */}
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full" />
              </div>
            ) : detailData ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* Invoice meta */}
                <div className="bg-muted/40 rounded-xl p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-xl numeric">{detailData.invoice_number}</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(detailData.status).cls)}>
                      {statusBadge(detailData.status).label}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary flex gap-3 flex-wrap">
                    <span>{detailData.invoice_date}</span>
                    <span dir="ltr">{format(new Date(detailData.created_at), 'HH:mm')}</span>
                  </div>
                </div>

                {/* Items */}
                {detailData.items?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-text-secondary mb-2">المنتجات</h3>
                    <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
                      {detailData.items.map((item: any) => (
                        <div key={item.id} className="flex justify-between items-start p-3 gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                              {item.is_gift ? (
                                <span className="text-xs bg-success-bg text-success px-1.5 py-0.5 rounded-full font-bold">هدية</span>
                              ) : null}
                              <span className="truncate">{item.product_name}</span>
                            </div>
                            <div className="text-xs text-text-secondary mt-0.5 numeric" dir="ltr">
                              {item.quantity} × {formatMoney(item.unit_price)}
                              {item.discount_amount > 0 && !item.is_gift && ` − ${formatMoney(item.discount_amount)}`}
                            </div>
                          </div>
                          <span className={cn('font-bold text-sm numeric shrink-0', item.is_gift && 'text-success')}>
                            {item.is_gift ? 'مجاناً' : formatMoney(item.line_total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {detailData.payments?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-text-secondary mb-2">المدفوعات</h3>
                    <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
                      {detailData.payments.map((p: any, i: number) => (
                        <div key={i} className="flex justify-between items-center p-3 gap-2">
                          <span className="font-medium text-sm">{p.account_name || 'حساب'}</span>
                          <div className="text-end">
                            <div className={cn('font-bold text-sm numeric', p.amount < 0 && 'text-danger')}>
                              {p.amount < 0
                                ? `− ${formatMoney(Math.abs(p.amount))}`
                                : formatMoney(p.amount)}
                            </div>
                            {p.fee_amount > 0 && (
                              <div className="text-xs text-text-secondary numeric">
                                رسوم: {formatMoney(p.fee_amount)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Totals */}
                <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                  {detailData.discount_amount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">قبل الخصم</span>
                        <span className="numeric">{formatMoney(detailData.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-danger">
                        <span>الخصم</span>
                        <span className="numeric">− {formatMoney(detailData.discount_amount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold text-base border-t border-border pt-2">
                    <span>الإجمالي</span>
                    <span className="numeric text-accent">{formatMoney(detailData.total_amount)}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Panel footer actions */}
            {detailData && (
              <div className="p-4 border-t border-border shrink-0 grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setReceiptInvoiceData(detailData);
                    setReceiptOverlayOpen(true);
                  }}
                  className="h-11 bg-muted border border-border text-text-primary font-bold rounded-xl hover:bg-muted/80 flex items-center justify-center gap-2 text-sm transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  إعادة طباعة
                </button>
                {detailData.status === 'active' ? (
                  <button
                    onClick={() => { setDetailId(null); openReturnDialog(detailData); }}
                    className="h-11 bg-danger-bg text-danger font-bold rounded-xl hover:bg-danger/20 flex items-center justify-center gap-2 text-sm border border-danger/20 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    استرجاع
                  </button>
                ) : (
                  <div />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Return dialog (preserved) ── */}
      {returnDialogOpen && selectedInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in"
          onClick={e => { if (e.target === e.currentTarget) setReturnDialogOpen(false); }}
        >
          <div
            ref={returnTrapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-dialog-title"
            className="bg-surface rounded-2xl w-[calc(100%-2rem)] max-w-md overflow-hidden flex flex-col max-h-[90vh] shadow-xl"
          >
            <div className="flex justify-between items-center p-4 border-b border-border">
              <h2 id="return-dialog-title" className="text-xl font-bold">استرجاع فاتورة</h2>
              <button
                onClick={() => setReturnDialogOpen(false)}
                className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-full"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="p-3 bg-danger-bg/50 border border-danger/20 rounded-xl mb-4">
                <p className="text-danger font-medium text-sm flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  هل أنت متأكد من استرجاع الفاتورة {selectedInvoice.invoice_number}؟
                </p>
                <p className="text-xs text-danger/80 mt-1">سيتم إرجاع البضاعة للمخزن ويجب تحديد طريقة رد المبلغ للعميل.</p>
              </div>

              <div className="space-y-3">
                <label className="font-bold flex justify-between items-center text-sm">
                  <span>رد المبلغ (الإجمالي: {formatMoney(selectedInvoice.paid_amount)})</span>
                  <button
                    onClick={() => setRefunds([...refunds, { accountId: accounts[0]?.id || '', amountInput: '0' }])}
                    className="text-accent text-xs hover:underline"
                  >
                    + صندوق آخر
                  </button>
                </label>

                {refunds.map((r, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-background rounded-xl border border-border p-2">
                    <select
                      value={r.accountId}
                      onChange={e => handleUpdateRefund(idx, 'accountId', e.target.value)}
                      className="h-10 px-2 rounded-lg bg-muted text-sm font-medium border-none outline-none w-1/2"
                    >
                      {accounts.map((acc: any) => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={r.amountInput}
                        onChange={e => handleUpdateRefund(idx, 'amountInput', e.target.value)}
                        className="w-full h-10 pe-8 ps-2 rounded-lg border-none bg-muted font-bold numeric text-start outline-none focus:ring-1 focus:ring-accent"
                        style={{ direction: 'ltr' }}
                      />
                      <span className="absolute end-2 top-1/2 -translate-y-1/2 text-text-secondary text-xs">د.أ</span>
                    </div>
                    {refunds.length > 1 && (
                      <button
                        onClick={() => setRefunds(refunds.filter((_, i) => i !== idx))}
                        className="p-2 text-danger hover:bg-danger/10 rounded-lg shrink-0"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-border flex gap-3 mt-6">
                <button
                  onClick={() => { requireAdminAction(() => returnMutation.mutate()); }}
                  disabled={returnMutation.isPending}
                  className="flex-1 h-11 bg-danger text-white font-bold rounded-lg hover:bg-danger/90 flex justify-center items-center gap-2"
                >
                  تأكيد الاسترجاع
                </button>
                <button
                  onClick={() => setReturnDialogOpen(false)}
                  className="flex-1 h-11 bg-surface border border-border font-medium rounded-lg hover:bg-muted"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Receipt overlay ── */}
      {receiptOverlayOpen && receiptInvoiceData && (
        <ReceiptOverlay
          isOpen
          onClose={() => setReceiptOverlayOpen(false)}
          invoice={receiptInvoiceData}
        />
      )}
    </div>
  );
}
