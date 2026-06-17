// src/modules/pos/components/PaymentDialog.tsx
// =============================================================================
// BUNDLE 3 — POS & Cart UX (C-6: preserve manual payment rows on cart change)
// HEAD: b6c491e
//
// FIX SUMMARY:
//   - Split the original single useEffect into three:
//     * Effect A: full reset ONLY when isOpen transitions false→true (uses a ref).
//     * Effect B: when `total` changes while open, update ONLY the auto-default
//                first row (if it has not been manually edited). Never clobber
//                user-entered rows.
//     * Effect C: if `accounts` arrives AFTER the dialog opened (slow network),
//                initialize the first row's accountId. Do not clobber existing rows.
//   - Track "manual edit" state per row via PaymentRow.isManualEdit.
//   - handleUpdatePayment and handleAddPayment mark rows as manual.
//
// BEHAVIORAL CHANGE THE OWNER WILL SEE:
//   - Before: opening Advanced, entering a split, then having the cart total
//     change would silently wipe the split.
//   - After: the split is preserved. Only the first row's amount auto-updates
//     to the new total IF the user has not typed into it.
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useEscKey } from '@/hooks/useEscKey';
import { useCartStore } from '@/stores/cart.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getActiveAccounts } from '@/db/queries/accounts';
import { completeSale, getInvoiceWithItems } from '@/db/queries/sales';
import { formatMoney, parseMoney } from '@/lib/money';
import { X, CheckCircle, FileText, Plus, Trash2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { NumPad } from '@/components/ui/NumPad';

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (invoiceId: string, invoiceNumber: string, change: number) => void;
}

interface PaymentRow {
  id: string;
  accountId: string;
  amountInput: string;
  // C-6: tracks whether the user typed in this row. Auto-default rows (the
  // first row created when the dialog opens) start as false. Once the user
  // edits any field, the row becomes true and Effect B will no longer
  // auto-update its amountInput when `total` changes.
  isManualEdit?: boolean;
}

type CheckoutVars = {
  payments: { accountId: string; amount: number }[];
  change: number;
};

export function PaymentDialog({ isOpen, onClose, onSuccess }: PaymentDialogProps) {
  const { items, getSubtotal, getTotalDiscount, getTotal } = useCartStore();
  const total = getTotal();
  const dialogRef = useFocusTrap(isOpen);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen,
  });

  // Preferred quick account: first cash-type, fallback to first account
  const quickAccount = accounts.find(a => a.type === 'cash') ?? accounts[0] ?? null;

  // C-6: ref to track the previous isOpen state, so Effect A fires only on
  // the false→true transition (dialog opening), not on every render.
  const wasOpenRef = useRef(false);

  // ── C-6 Effect A: full reset ONLY when the dialog transitions closed→open ──
  // Do NOT include `total` or `accounts` in the dependency array — those are
  // handled by Effects B and C respectively.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setShowAdvanced(false);
      setCashReceivedInput('');
      if (accounts.length > 0) {
        setPayments([{
          id: nanoid(),
          accountId: accounts[0].id,
          amountInput: (total / 100).toString(),
          isManualEdit: false,
        }]);
      } else {
        setPayments([]);
      }
    }
    wasOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── C-6 Effect B: when `total` changes while open, update ONLY the first row
  // if it has not been manually edited. Never clobber user-entered rows. ──
  useEffect(() => {
    if (!isOpen) return;
    setPayments(prev => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      // If the user has typed into the first row, leave it alone.
      if (first.isManualEdit) return prev;
      // Otherwise, auto-update the first row's amount to the new total.
      const updated: PaymentRow = {
        ...first,
        amountInput: (total / 100).toString(),
        isManualEdit: false,
      };
      return [updated, ...prev.slice(1)];
    });
  }, [total, isOpen]);

  // ── C-6 Effect C: if `accounts` arrives AFTER the dialog opened (slow network
  // or a Realtime refetch), initialize the first row's accountId. Do not
  // clobber existing rows beyond ensuring every row has a valid accountId. ──
  useEffect(() => {
    if (!isOpen || accounts.length === 0) return;
    setPayments(prev => {
      if (prev.length > 0) {
        // Ensure every row has a valid accountId (default to first account if missing)
        return prev.map(p => (!p.accountId ? { ...p, accountId: accounts[0].id } : p));
      }
      // No rows yet — create the default row
      return [{
        id: nanoid(),
        accountId: accounts[0].id,
        amountInput: (total / 100).toString(),
        isManualEdit: false,
      }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const handleClose = () => {
    if (checkoutMutation.isPending) return;
    onClose();
  };

  useEscKey(handleClose, isOpen);

  // ── Advanced section derived state ───────────────────────────────────────────
  const parsedPayments = payments.map(p => ({
    accountId: p.accountId,
    amount: parseMoney(p.amountInput || '0')
  }));

  const totalApplied = parsedPayments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - totalApplied;
  const isOverpaid = totalApplied > total;
  const isPaid = totalApplied >= total;

  const cashAccountIds = new Set(accounts.filter(a => a.type === 'cash').map(a => a.id));
  const cashIncluded = parsedPayments.some(p => cashAccountIds.has(p.accountId));

  let advancedChange = 0;
  if (cashIncluded) {
    const received = parseMoney(cashReceivedInput || '0');
    const totalCashNeeded = parsedPayments
      .filter(p => cashAccountIds.has(p.accountId))
      .reduce((s, p) => s + p.amount, 0);
    if (received >= totalCashNeeded) advancedChange = received - totalCashNeeded;
  } else if (isOverpaid) {
    advancedChange = totalApplied - total;
  }

  const queryClient = useQueryClient();

  const checkoutMutation = useMutation({
    mutationFn: ({ payments: paymentsToUse }: CheckoutVars) =>
      completeSale({
        cartItems: items,
        subtotal: getSubtotal(),
        totalDiscount: getTotalDiscount(),
        totalAmount: total,
        payments: paymentsToUse.filter(p => p.amount > 0),
      }),
    onSuccess: (data, { change }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      onSuccess(data.invoiceId, data.invoiceNumber, change);
    },
    onError: (err: any) => {
      toast.error('حدث خطأ أثناء حفظ الفاتورة: ' + err.message);
    }
  });

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleQuickCheckout = () => {
    if (checkoutMutation.isPending) return;
    const paymentsToUse = (total > 0 && quickAccount)
      ? [{ accountId: quickAccount.id, amount: total }]
      : [];
    checkoutMutation.mutate({ payments: paymentsToUse, change: 0 });
  };

  const handleAdvancedCheckout = () => {
    if (!isPaid || checkoutMutation.isPending) return;
    checkoutMutation.mutate({ payments: parsedPayments, change: advancedChange });
  };

  const handleAddPayment = () => {
    if (accounts.length === 0) return;
    // C-6: user-added rows are always manually edited.
    setPayments([...payments, {
      id: nanoid(),
      accountId: accounts[0].id,
      amountInput: remaining > 0 ? (remaining / 100).toString() : '0',
      isManualEdit: true,
    }]);
  };

  const handleRemovePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id));
  };

  // C-6: any user edit (accountId or amountInput) marks the row as manual.
  const handleUpdatePayment = (id: string, field: keyof PaymentRow, value: string) => {
    setPayments(payments.map(p => p.id === id
      ? { ...p, [field]: value, isManualEdit: true }
      : p
    ));
  };

  const handleNumDigit = (d: string) => {
    setCashReceivedInput(prev => {
      if (d === '.' && prev.includes('.')) return prev;
      if (prev === '' || prev === '0') return d === '.' ? '0.' : d;
      return prev + d;
    });
  };

  const handleNumClear = () => {
    setCashReceivedInput(prev => (prev.length <= 1 ? '' : prev.slice(0, -1)));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="تسجيل البيع"
        className="bg-surface w-full max-w-md rounded-[24px] md:rounded-2xl shadow-md animate-in slide-in-from-bottom-4 md:zoom-in-95 flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-5 pb-3 shrink-0">
          <h2 className="text-xl font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>تسجيل البيع</h2>
          <button onClick={onClose} disabled={checkoutMutation.isPending} className="p-2 hover:bg-muted rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-4 hide-scrollbar">

          {/* Amount due */}
          <div className="bg-muted/50 rounded-xl p-4 flex flex-col items-center justify-center mb-5">
            <span className="text-text-secondary text-sm mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ المطلوب</span>
            <span className="text-4xl font-bold numeric text-accent">{formatMoney(total)}</span>
          </div>

          {/* ── ONE-TAP quick checkout (default view) ── */}
          {!showAdvanced && (
            <div className="mb-4">
              <button
                onClick={handleQuickCheckout}
                disabled={checkoutMutation.isPending || (!quickAccount && total > 0)}
                className="w-full h-16 bg-accent text-white font-bold rounded-2xl disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-3 text-lg"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                {checkoutMutation.isPending ? (
                  <span className="animate-spin w-6 h-6 border-2 border-white/30 border-t-white rounded-full" />
                ) : (
                  <>
                    <CheckCircle className="w-6 h-6" />
                    تسجيل البيع
                    {quickAccount && (
                      <span className="text-white/70 text-sm font-medium">— {quickAccount.name}</span>
                    )}
                  </>
                )}
              </button>
              <button
                onClick={() => setShowAdvanced(true)}
                className="w-full mt-3 flex items-center justify-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors py-2"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                <ChevronDown className="w-4 h-4" />
                خيارات متقدمة (تقسيم — باقٍ — حساب آخر)
              </button>
            </div>
          )}

          {/* ── Advanced payment options ── */}
          {showAdvanced && (
            <>
              {/* Payment rows */}
              <div className="space-y-3 mb-5">
                <div className="flex justify-between items-center mb-2">
                  <label className="font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>طريقة الدفع</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowAdvanced(false)}
                      className="text-text-secondary text-xs hover:text-accent transition-colors"
                      style={{ fontFamily: 'Tajawal, sans-serif' }}
                    >
                      ↑ الدفع السريع
                    </button>
                    <button
                      onClick={handleAddPayment}
                      className="text-accent text-sm font-bold flex items-center gap-1 hover:bg-accent/10 px-2 py-1 rounded-lg"
                    >
                      <Plus className="w-4 h-4" /> تقسيم
                    </button>
                  </div>
                </div>

                {payments.map((p) => (
                  <div key={p.id} className="flex gap-2 items-center bg-background rounded-xl border border-border p-2">
                    <select
                      value={p.accountId}
                      onChange={(e) => handleUpdatePayment(p.id, 'accountId', e.target.value)}
                      className="h-11 px-2 rounded-lg bg-muted text-sm font-medium border-none outline-none focus:ring-1 focus:ring-accent w-1/2"
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={p.amountInput}
                        onChange={(e) => handleUpdatePayment(p.id, 'amountInput', e.target.value)}
                        className="w-full h-11 pe-8 ps-2 rounded-lg border-none bg-muted focus:ring-1 focus:ring-accent outline-none font-bold numeric text-end"
                        style={{ direction: 'ltr' }}
                      />
                      <span className="absolute end-2 top-1/2 -translate-y-1/2 text-text-secondary text-xs">د.أ</span>
                    </div>
                    {payments.length > 1 && (
                      <button
                        onClick={() => handleRemovePayment(p.id)}
                        className="p-2 text-danger hover:bg-danger/10 rounded-lg shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}

                {remaining > 0 && (
                  <div className="p-3 rounded-xl border text-center text-sm font-bold bg-warning-bg text-warning border-warning" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    المبلغ غير كافٍ — المتبقي: {formatMoney(remaining)}
                  </div>
                )}
                {isOverpaid && !cashIncluded && (
                  <div className="p-3 rounded-xl border text-center text-sm font-bold bg-success-bg text-success border-success" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    زيادة {formatMoney(Math.abs(remaining))} — الباقي للعميل نقداً
                  </div>
                )}
              </div>

              {/* Cash received + NumPad */}
              {cashIncluded && (
                <div className="mb-4 bg-background border border-border rounded-xl p-4">
                  <label className="block font-medium mb-2 text-sm" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                    المبلغ المستلم نقداً
                  </label>
                  <div className="bg-muted rounded-xl py-3 px-4 mb-3 flex items-center justify-between">
                    <span className="text-text-secondary text-sm">د.أ</span>
                    <span className="text-2xl font-bold numeric tracking-wide">
                      {cashReceivedInput || '0'}
                    </span>
                  </div>
                  {advancedChange > 0 && (
                    <div className="mb-3 flex justify-between items-center bg-warning-bg text-warning px-3 py-2 rounded-lg">
                      <span className="font-medium text-sm" style={{ fontFamily: 'Tajawal, sans-serif' }}>الباقي للعميل:</span>
                      <span className="numeric font-bold text-lg">{formatMoney(advancedChange)}</span>
                    </div>
                  )}
                  <div className="flex justify-center pt-1">
                    <NumPad
                      allowDecimal
                      onDigit={handleNumDigit}
                      onClear={handleNumClear}
                      onSubmit={handleAdvancedCheckout}
                      submitDisabled={checkoutMutation.isPending || !isPaid}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer checkout button for advanced non-cash path */}
        {showAdvanced && !cashIncluded && (
          <div className="px-5 pb-5 pt-3 border-t border-border shrink-0">
            <button
              onClick={handleAdvancedCheckout}
              disabled={checkoutMutation.isPending || !isPaid}
              className="w-full h-[var(--btn-height)] bg-accent text-white font-bold rounded-xl disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-2"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              {checkoutMutation.isPending ? (
                <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
              ) : (
                <CheckCircle className="w-5 h-5" />
              )}
              تسجيل البيع
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { ReceiptOverlay } from '@/components/receipt/ReceiptOverlay';

export function SuccessDialog({
  isOpen,
  invoiceId,
  invoiceNumber,
  change,
  onClose,
  onNewSale
}: {
  isOpen: boolean;
  invoiceId: string;
  invoiceNumber: string;
  change: number;
  onClose: () => void;
  onNewSale: () => void;
}) {
  const [showReceipt, setShowReceipt] = useState(false);
  const [invoiceData, setInvoiceData] = useState<any>(null);

  useEscKey(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) {
      setShowReceipt(false);
      setInvoiceData(null);
    }
  }, [isOpen]);

  const handleShowReceipt = async () => {
    if (!invoiceId) return;
    try {
      const data = await getInvoiceWithItems(invoiceId);
      if (data) {
        setInvoiceData(data);
        setShowReceipt(true);
      }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء تحميل الإيصال');
      console.error(err);
    }
  };

  if (!isOpen) return null;

  if (showReceipt && invoiceData) {
    return (
      <ReceiptOverlay
        isOpen={true}
        onClose={onNewSale}
        invoice={invoiceData}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-full max-w-sm rounded-[24px] md:rounded-2xl p-8 shadow-md text-center flex flex-col items-center relative">
        <button
          onClick={onClose}
          className="absolute top-4 end-4 p-1.5 hover:bg-muted rounded-full transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>

        <div className="w-16 h-16 bg-success-bg text-success rounded-full flex items-center justify-center mb-4">
          <CheckCircle className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-bold text-success mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>تمت العملية بنجاح</h2>
        <p className="text-text-secondary mb-6 flex items-center gap-2 justify-center">
          <FileText className="w-4 h-4" /> فاتورة {invoiceNumber}
        </p>

        {change > 0 && (
          <div className="w-full p-4 bg-warning-bg rounded-xl text-warning mb-6">
            <span className="block text-sm mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>الباقي للعميل</span>
            <span className="block text-2xl font-bold numeric">{formatMoney(change)}</span>
          </div>
        )}

        <div className="flex gap-3 w-full">
          <button
            onClick={handleShowReceipt}
            className="flex-1 h-[var(--btn-height)] bg-surface border border-border text-text-primary font-bold rounded-lg hover:border-accent transition-colors"
            style={{ fontFamily: 'Tajawal, sans-serif' }}
          >
            عرض الإيصال
          </button>
          <button
            onClick={onNewSale}
            className="flex-1 h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
            style={{ fontFamily: 'Tajawal, sans-serif' }}
          >
            بيع جديد
          </button>
        </div>
      </div>
    </div>
  );
}
