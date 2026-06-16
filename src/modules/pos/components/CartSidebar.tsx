import { useState } from 'react';
import { useCartStore, CartItem, calculateItemLineTotal } from '@/stores/cart.store';
import { useSavedCartsStore } from '@/stores/savedCarts.store';
import { formatMoney, parseMoney } from '@/lib/money';
import { Plus, Minus, Trash2, ShoppingCart as ShoppingCartIcon, X, Hash, Tag, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PaymentDialog, SuccessDialog } from './PaymentDialog';
import { toast } from 'sonner';
import { NumPad } from '@/components/ui/NumPad';
import { useEffect } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useEscKey } from '@/hooks/useEscKey';
import { useAuth } from '@/contexts/AuthContext';
import { SavedCartsTabs } from './SavedCartsTabs';

// ─── ActionType ────────────────────────────────────────────────────────────────
type ActionType = 'qty' | 'price';

// ─── NumPad action dialog (qty / price) ───────────────────────────────────────
function ActionDialog({
  action,
  item,
  onClose,
  onApply,
}: {
  action: ActionType;
  item: CartItem;
  onClose: () => void;
  onApply: (action: ActionType, raw: string) => void;
}) {
  const initDigits = (): string => {
    if (action === 'qty') return String(item.quantity);
    if (action === 'price') {
      const unitPrice = item.overridePrice !== undefined ? item.overridePrice : item.product.sale_price;
      if (unitPrice <= 0) return '';
      const dinars = unitPrice / 100;
      return Number.isInteger(dinars)
        ? String(dinars)
        : dinars.toFixed(2).replace(/\.?0+$/, '');
    }
    return '';
  };

  const [digits, setDigits] = useState<string>(initDigits);
  const dialogRef = useFocusTrap(true);
  useEscKey(onClose);

  const titles: Record<ActionType, string> = {
    qty: 'الكمية',
    price: 'السعر',
  };

  const displayValue = (): string => {
    if (!digits) return '—';
    if (action === 'qty') return digits;
    return `${digits} د.أ`;
  };

  const handleDigit = (d: string) => {
    if (action === 'price') {
      if (d === '.') {
        if (digits.includes('.')) return;
        setDigits(prev => (prev === '' ? '0.' : prev + '.'));
        return;
      }
      const next = digits + d;
      const dotIdx = next.indexOf('.');
      if (dotIdx >= 0 && next.length - dotIdx - 1 > 2) return;
      setDigits(next);
      return;
    }
    setDigits(prev => prev + d);
  };

  const handleClear = () => setDigits(prev => prev.slice(0, -1));

  const handleSubmit = () => {
    if (!digits) { onClose(); return; }
    onApply(action, digits);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-t-2xl lg:rounded-2xl w-full max-w-sm p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="تعديل قيمة"
      >
        <div className="flex items-center justify-between mb-1">
          <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '16px', fontWeight: 700 }}>
            {titles[action]}
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-full">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <p className="text-text-secondary mb-3 truncate" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}>
          {item.product.name}
        </p>

        <div
          className="w-full text-center mb-4 py-3 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px' }}
        >
          {displayValue()}
        </div>

        <NumPad
          onDigit={handleDigit}
          onClear={handleClear}
          onSubmit={handleSubmit}
          allowDecimal={action === 'price'}
        />
      </div>
    </div>
  );
}

// ─── Per-line discount dialog ─────────────────────────────────────────────────
function LineDiscountDialog({
  item,
  onClose,
  onApply,
}: {
  item: CartItem;
  onClose: () => void;
  onApply: (fils: number) => void;
}) {
  const initDigits = (): string => {
    if (item.discountValue <= 0) return '';
    const dinars = item.discountValue / 100;
    return Number.isInteger(dinars) ? String(dinars) : dinars.toFixed(2).replace(/\.?0+$/, '');
  };

  const [digits, setDigits] = useState<string>(initDigits);
  const dialogRef = useFocusTrap(true);
  useEscKey(onClose);

  const handleDigit = (d: string) => {
    if (d === '.') {
      if (digits.includes('.')) return;
      setDigits(prev => (prev === '' ? '0.' : prev + '.'));
      return;
    }
    const next = digits + d;
    const dotIdx = next.indexOf('.');
    if (dotIdx >= 0 && next.length - dotIdx - 1 > 2) return;
    setDigits(next);
  };

  const handleSubmit = () => {
    const fils = parseMoney(digits || '0');
    onApply(Math.max(0, fils));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-t-2xl lg:rounded-2xl w-full max-w-sm p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="خصم المنتج"
      >
        <div className="flex items-center justify-between mb-1">
          <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '16px', fontWeight: 700 }}>خصم</span>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-full">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <p className="text-text-secondary mb-3 truncate" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '13px' }}>
          {item.product.name}
        </p>

        <div
          className="w-full text-center mb-4 py-3 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px' }}
        >
          {digits ? `${digits} د.أ` : '—'}
        </div>

        <NumPad
          allowDecimal
          onDigit={handleDigit}
          onClear={() => setDigits(prev => prev.slice(0, -1))}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// ─── Invoice-wide discount dialog (fixed amount in dinars) ────────────────────
function GlobalDiscountAmountDialog({
  currentValueFils,
  onClose,
  onApply,
}: {
  currentValueFils: number;
  onClose: () => void;
  onApply: (fils: number) => void;
}) {
  const initDigits = (): string => {
    if (currentValueFils <= 0) return '';
    const dinars = currentValueFils / 100;
    return Number.isInteger(dinars) ? String(dinars) : dinars.toFixed(2).replace(/\.?0+$/, '');
  };

  const [digits, setDigits] = useState<string>(initDigits);
  useEscKey(onClose);

  const handleDigit = (d: string) => {
    if (d === '.') {
      if (digits.includes('.')) return;
      setDigits(prev => (prev === '' ? '0.' : prev + '.'));
      return;
    }
    const next = digits + d;
    const dotIdx = next.indexOf('.');
    if (dotIdx >= 0 && next.length - dotIdx - 1 > 2) return;
    setDigits(next);
  };

  const handleSubmit = () => {
    const fils = parseMoney(digits || '0');
    onApply(Math.max(0, fils));
    onClose();
  };

  const trapRef = useFocusTrap(true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gd-dialog-title"
        className="bg-surface rounded-t-2xl lg:rounded-2xl w-full max-w-sm p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between mb-3">
          <span id="gd-dialog-title" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '16px', fontWeight: 700 }}>
            خصم على الفاتورة كاملة
          </span>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-full" aria-label="إغلاق">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div
          className="w-full text-center mb-4 py-3 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px' }}
        >
          {digits ? `${digits} د.أ` : '—'}
        </div>

        <NumPad
          allowDecimal
          onDigit={handleDigit}
          onClear={() => setDigits(prev => prev.slice(0, -1))}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// ─── Main CartSidebar ──────────────────────────────────────────────────────────
export function CartSidebar() {
  const {
    items, removeItem, updateQuantity, clearCart,
    getSubtotal, getTotalDiscount, getTotal,
    pulseTrigger,
    setItemDiscount, setItemPrice, setItemGift,
    globalDiscountType, globalDiscountValue, setGlobalDiscount,
  } = useCartStore();
  useSavedCartsStore();
  const cartStore = useCartStore();
  const { requireAdminAction } = useAuth();

  const [pulse, setPulse] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [discountEditId, setDiscountEditId] = useState<string | null>(null);
  const [showGlobalDiscountDialog, setShowGlobalDiscountDialog] = useState(false);
  const [pendingGlobalAmt, setPendingGlobalAmt] = useState<number | null>(null);
  const [showConflictConfirm, setShowConflictConfirm] = useState(false);

  useEffect(() => {
    if (pulseTrigger > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(t);
    }
  }, [pulseTrigger]);

  useEffect(() => {
    if (selectedItemId && !items.find(i => i.cartItemId === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [items, selectedItemId]);

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [successData, setSuccessData] = useState<{ isOpen: boolean; invoiceId: string; invoiceNumber: string; change: number }>({
    isOpen: false, invoiceId: '', invoiceNumber: '', change: 0,
  });
  const [confirmClear, setConfirmClear] = useState(false);

  const selectedItem = selectedItemId ? items.find(i => i.cartItemId === selectedItemId) ?? null : null;
  const discountEditItem = discountEditId ? items.find(i => i.cartItemId === discountEditId) ?? null : null;

  const handleDelete = (item: CartItem) => {
    const itemCopy = { ...item };
    removeItem(item.cartItemId);
    toast('تم حذف العنصر', {
      action: { label: 'تراجع', onClick: () => cartStore.restoreItem(itemCopy) },
      duration: 5000,
    });
  };

  const handleApplyAction = (action: ActionType, raw: string) => {
    if (!selectedItemId) return;
    if (action === 'qty') {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) updateQuantity(selectedItemId, Math.max(1, val));
    } else if (action === 'price') {
      const fils = parseMoney(raw);
      requireAdminAction(() => setItemPrice(selectedItemId, Math.max(0, fils)));
    }
  };

  const handleGlobalDiscountApply = (fils: number) => {
    const hasLineDiscounts = items.some(i => !i.isGift && i.discountValue > 0);
    if (fils > 0 && hasLineDiscounts) {
      setPendingGlobalAmt(fils);
      setShowConflictConfirm(true);
    } else {
      setGlobalDiscount('amount', fils);
    }
  };

  const currentGlobalDiscountFils = globalDiscountType === 'amount' ? globalDiscountValue : 0;

  return (
    <>
      <div className="w-full h-full bg-surface border-s border-border flex flex-col overflow-hidden">

        {/* ── Cart header ── */}
        <div className="shrink-0 flex flex-col bg-background">
          <div className={cn('px-3 py-2 border-b border-border flex items-center justify-between transition-all', pulse && 'bg-accent/10')}>
            <h2 className="font-bold flex items-center gap-1.5" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '14px' }}>
              السلة <span className="bg-accent text-white text-xs px-1.5 py-0.5 rounded-full">{items.length}</span>
            </h2>
            {items.length > 0 && (
              <button
                onClick={() => setConfirmClear(true)}
                className="p-1.5 text-danger hover:bg-danger/10 rounded-full transition-colors"
                style={{ touchAction: 'manipulation' }}
                title="مسح السلة"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <SavedCartsTabs />
        </div>

        {/* ── Items list ── */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-2">
          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-secondary py-10 text-center px-4">
              <ShoppingCartIcon className="w-12 h-12 mb-3 opacity-25" />
              <p className="font-semibold text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '15px' }}>السلة فارغة</p>
              <p className="text-xs mt-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>اضغط على أي منتج لإضافته إلى السلة</p>
            </div>
          ) : (
            items.map(item => {
              const { total } = calculateItemLineTotal(item);
              const isSelected = selectedItemId === item.cartItemId;
              const unitPrice = item.overridePrice !== undefined ? item.overridePrice : item.product.sale_price;

              return (
                <div
                  key={item.cartItemId}
                  onClick={() => setSelectedItemId(isSelected ? null : item.cartItemId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedItemId(isSelected ? null : item.cartItemId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${item.product.name}، الكمية ${item.quantity}`}
                  style={{
                    minHeight: '108px',
                    touchAction: 'manipulation',
                    userSelect: 'none',
                    border: isSelected ? '1.5px solid #CF694A' : '1.5px solid transparent',
                    backgroundColor: item.isGift
                      ? '#F0FDF4'
                      : isSelected
                        ? '#FCF4F1'
                        : 'var(--color-muted, #F5F4F0)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    padding: '8px',
                    position: 'relative',
                  }}
                  className="flex flex-col shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {/* Delete button — top-end */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(item); }}
                    style={{ position: 'absolute', top: '0', insetInlineEnd: '0', width: '44px', height: '44px', touchAction: 'manipulation' }}
                    className="rounded-full flex items-center justify-center text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label="حذف"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  {/* ── Row 1: Name · Qty controls · Line total ── */}
                  <div className="flex items-center gap-1.5 pe-6">
                    <span className="flex-1 truncate" style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '14px', fontWeight: 600, textDecoration: item.isGift ? 'line-through' : 'none', opacity: item.isGift ? 0.6 : 1 }}>
                      {item.product.name}
                    </span>

                    {/* Qty controls */}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => { if (item.quantity <= 1) handleDelete(item); else updateQuantity(item.cartItemId, item.quantity - 1); }}
                        style={{ width: '44px', height: '44px', touchAction: 'manipulation' }}
                        className="rounded-full flex items-center justify-center bg-surface border border-border text-text-secondary hover:bg-muted"
                        aria-label="تقليل الكمية"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span style={{ minWidth: '20px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 700, color: '#CF694A' }}>
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                        style={{ width: '44px', height: '44px', touchAction: 'manipulation' }}
                        className="rounded-full flex items-center justify-center bg-surface border border-border text-text-secondary hover:bg-muted"
                        aria-label="زيادة الكمية"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Line total */}
                    <span className="shrink-0" style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 700, color: item.isGift ? '#16A34A' : 'var(--color-text-primary)', minWidth: '64px', textAlign: 'end' }}>
                      {formatMoney(total)}
                    </span>
                  </div>

                  {/* ── Row 2: Price box · Discount box · Gift toggle ── */}
                  <div className="flex items-center gap-1.5 mt-2" onClick={e => e.stopPropagation()}>

                    {/* Price display box */}
                    <div style={{
                      flex: '1', minWidth: 0,
                      background: 'var(--color-surface, white)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '7px',
                      padding: '3px 6px',
                      display: 'flex', flexDirection: 'column',
                    }}>
                      <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '9px', color: 'var(--color-text-secondary)' }}>سعر الوحدة</span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, textDecoration: item.isGift ? 'line-through' : 'none', opacity: item.isGift ? 0.5 : 1 }}>
                        {formatMoney(unitPrice)}
                      </span>
                    </div>

                    {/* Discount box — tappable */}
                    <button
                      disabled={item.isGift}
                      onClick={() => setDiscountEditId(item.cartItemId)}
                      style={{
                        flex: '1', minWidth: 0,
                        background: item.discountValue > 0 ? '#FEF2F2' : 'var(--color-surface, white)',
                        border: `1px solid ${item.discountValue > 0 ? '#FECACA' : 'var(--color-border)'}`,
                        borderRadius: '7px',
                        padding: '3px 6px',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'flex-start',
                        cursor: item.isGift ? 'not-allowed' : 'pointer',
                        opacity: item.isGift ? 0.4 : 1,
                        touchAction: 'manipulation',
                      }}
                      aria-label="تعديل الخصم"
                    >
                      <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '9px', color: item.discountValue > 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>خصم</span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, color: item.discountValue > 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>
                        {item.discountValue > 0 ? `− ${formatMoney(item.discountValue)}` : '—'}
                      </span>
                    </button>

                    {/* Gift toggle */}
                    <button
                      onClick={() => requireAdminAction(() => setItemGift(item.cartItemId, !item.isGift))}
                      style={{
                        flexShrink: 0,
                        background: item.isGift ? '#DCFCE7' : 'var(--color-surface, white)',
                        border: `1px solid ${item.isGift ? '#86EFAC' : 'var(--color-border)'}`,
                        borderRadius: '7px',
                        padding: '3px 8px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        cursor: 'pointer',
                        touchAction: 'manipulation',
                      }}
                      aria-label="تبديل هدية"
                      aria-pressed={item.isGift}
                    >
                      <Gift className="w-3.5 h-3.5" style={{ color: item.isGift ? '#16A34A' : 'var(--color-text-secondary)' }} />
                      <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '9px', color: item.isGift ? '#16A34A' : 'var(--color-text-secondary)', fontWeight: item.isGift ? 700 : 400 }}>
                        هدية
                      </span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Bottom fixed zone ── */}
        <div className="shrink-0 border-t border-border bg-background flex flex-col gap-1.5 p-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">

          {/* Totals */}
          <div className="space-y-0.5 text-sm">
            <div className="flex justify-between text-text-secondary">
              <span style={{ fontFamily: 'Tajawal, sans-serif' }}>المجموع الفرعي</span>
              <span className="numeric">{formatMoney(getSubtotal())}</span>
            </div>

            {/* Invoice-wide discount row */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <span style={{ fontFamily: 'Tajawal, sans-serif', color: getTotalDiscount() > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                  الخصم
                </span>
                <button
                  onClick={() => setShowGlobalDiscountDialog(true)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border text-text-secondary hover:border-accent hover:text-accent transition-colors"
                  style={{ fontSize: '11px', fontFamily: 'Tajawal, sans-serif', touchAction: 'manipulation' }}
                  title="خصم على الفاتورة كاملة"
                >
                  <Tag className="w-3 h-3" />
                  <span>فاتورة</span>
                </button>
                {currentGlobalDiscountFils > 0 && (
                  <span
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-danger/10 text-danger"
                    style={{ fontSize: '11px', fontFamily: 'Inter, sans-serif' }}
                  >
                    {formatMoney(currentGlobalDiscountFils)}
                    <button
                      onClick={() => setGlobalDiscount('amount', 0)}
                      className="w-9 h-9 flex items-center justify-center hover:opacity-70 transition-opacity"
                      style={{ touchAction: 'manipulation' }}
                      title="إلغاء خصم الفاتورة"
                      aria-label="إلغاء خصم الفاتورة"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
              </div>
              {getTotalDiscount() > 0 ? (
                <span className="numeric text-danger">− {formatMoney(getTotalDiscount())}</span>
              ) : (
                <span className="text-text-secondary">—</span>
              )}
            </div>

            <div className="flex justify-between items-center pt-1 border-t border-dashed border-border">
              <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '15px', fontWeight: 700 }}>الإجمالي</span>
              <span className="numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '19px', fontWeight: 700, color: '#CF694A' }}>
                {formatMoney(getTotal())}
              </span>
            </div>
          </div>

          {/* Action bar — qty and price only */}
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { action: 'qty' as ActionType, label: 'الكمية', Icon: Hash },
                { action: 'price' as ActionType, label: 'السعر', Icon: Tag },
              ] as const
            ).map(({ action, label, Icon }) => (
              <button
                key={action}
                disabled={!selectedItemId}
                onClick={() => setActiveAction(action)}
                style={{ height: '38px', touchAction: 'manipulation', fontFamily: 'Tajawal, sans-serif', fontSize: '13px', fontWeight: 600 }}
                className={cn(
                  'rounded-lg border flex items-center justify-center gap-1 transition-colors',
                  selectedItemId
                    ? 'border-border bg-surface text-text-primary hover:bg-muted hover:border-accent'
                    : 'border-border bg-surface text-text-secondary opacity-50 cursor-not-allowed'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Pay button */}
          <button
            onClick={() => { if (items.length > 0) setIsPaymentOpen(true); }}
            disabled={items.length === 0}
            style={{ height: '56px', fontFamily: 'Tajawal, sans-serif', fontSize: '18px', fontWeight: 'bold', touchAction: 'manipulation' }}
            className="w-full bg-[#CF694A] text-white rounded-lg disabled:opacity-50 disabled:bg-muted disabled:text-text-secondary hover:opacity-90 transition-opacity shadow-sm"
          >
            إتمام البيع
          </button>
        </div>
      </div>

      {/* NumPad action dialog (qty / price) */}
      {activeAction && selectedItem && (
        <ActionDialog
          action={activeAction}
          item={selectedItem}
          onClose={() => setActiveAction(null)}
          onApply={handleApplyAction}
        />
      )}

      {/* Per-line discount dialog */}
      {discountEditItem && (
        <LineDiscountDialog
          item={discountEditItem}
          onClose={() => setDiscountEditId(null)}
          onApply={fils => {
            setItemDiscount(discountEditItem.cartItemId, 'amount', fils);
            setDiscountEditId(null);
          }}
        />
      )}

      {/* Invoice-wide discount dialog */}
      {showGlobalDiscountDialog && (
        <GlobalDiscountAmountDialog
          currentValueFils={currentGlobalDiscountFils}
          onClose={() => setShowGlobalDiscountDialog(false)}
          onApply={fils => {
            handleGlobalDiscountApply(fils);
            setShowGlobalDiscountDialog(false);
          }}
        />
      )}

      {/* Conflict confirmation dialog */}
      <ConfirmDialog
        open={showConflictConfirm}
        title="تأكيد الخصم"
        message="بعض المنتجات عليها خصم. الخصم الكلي سيُضاف فوقها. متابعة؟"
        confirmLabel="متابعة"
        cancelLabel="إلغاء"
        onConfirm={() => {
          if (pendingGlobalAmt !== null) setGlobalDiscount('amount', pendingGlobalAmt);
          setPendingGlobalAmt(null);
          setShowConflictConfirm(false);
        }}
        onCancel={() => {
          setPendingGlobalAmt(null);
          setShowConflictConfirm(false);
        }}
      />

      <PaymentDialog
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onSuccess={(id, number, change) => {
          setIsPaymentOpen(false);
          setSuccessData({ isOpen: true, invoiceId: id, invoiceNumber: number, change });
        }}
      />

      <SuccessDialog
        isOpen={successData.isOpen}
        invoiceId={successData.invoiceId}
        invoiceNumber={successData.invoiceNumber}
        change={successData.change}
        onClose={() => setSuccessData({ ...successData, isOpen: false })}
        onNewSale={() => { setSuccessData({ ...successData, isOpen: false }); clearCart(); }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="مسح السلة"
        message="هل أنت متأكد من حذف جميع العناصر من السلة؟ لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="مسح السلة"
        cancelLabel="إلغاء"
        danger
        onConfirm={() => { clearCart(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
