import { useState } from 'react';
import { useCartStore, CartItem, calculateItemLineTotal } from '@/stores/cart.store';
import { useSavedCartsStore } from '@/stores/savedCarts.store';
import { formatMoney, parseMoney, applyPercent } from '@/lib/money';
import { Plus, Minus, Trash2, ShoppingCart as ShoppingCartIcon, X, Hash, Tag, Gift, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PaymentDialog, SuccessDialog } from './PaymentDialog';
import { toast } from 'sonner';
import { NumPad } from '@/components/ui/NumPad';
import { useEffect } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useEscKey } from '@/hooks/useEscKey';
import { useAuth } from '@/contexts/AuthContext';
import { getDiscountPolicy, type DiscountPolicy } from '@/lib/auth';
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
  onApply: (value: number, kind: 'amount' | 'percent') => void;
}) {
  const [discountKind, setDiscountKind] = useState<'amount' | 'percent'>(item.discountType || 'amount');

  const initDigits = (): string => {
    if (item.discountValue <= 0) return '';
    if (item.discountType === 'percent') {
      return String(item.discountValue);
    }
    const dinars = item.discountValue / 100;
    return Number.isInteger(dinars) ? String(dinars) : dinars.toFixed(2).replace(/\.?0+$/, '');
  };

  const [digits, setDigits] = useState<string>(initDigits);
  const dialogRef = useFocusTrap(true);
  useEscKey(onClose);

  const handleToggleKind = (kind: 'amount' | 'percent') => {
    setDiscountKind(kind);
    setDigits('');
  };

  const handleDigit = (d: string) => {
    if (discountKind === 'percent') {
      if (d === '.') return;
      const next = digits + d;
      const val = parseInt(next, 10);
      if (isNaN(val) || val < 0 || val > 100) return;
      setDigits(next);
      return;
    }
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
    if (discountKind === 'percent') {
      const pct = parseInt(digits || '0', 10);
      onApply(isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)), 'percent');
    } else {
      const fils = parseMoney(digits || '0');
      onApply(Math.max(0, fils), 'amount');
    }
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

        {/* Toggle option */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => handleToggleKind('percent')}
            className={cn(
              "h-9 rounded-lg text-sm font-medium transition-colors border",
              discountKind === 'percent'
                ? "bg-text-primary text-white border-transparent"
                : "bg-surface border-border text-text-secondary hover:border-accent"
            )}
          >
            نسبة %
          </button>
          <button
            type="button"
            onClick={() => handleToggleKind('amount')}
            className={cn(
              "h-9 rounded-lg text-sm font-medium transition-colors border",
              discountKind === 'amount'
                ? "bg-text-primary text-white border-transparent"
                : "bg-surface border-border text-text-secondary hover:border-accent"
            )}
          >
            مبلغ
          </button>
        </div>

        <div
          className="w-full text-center mb-4 py-3 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px' }}
        >
          {digits ? (discountKind === 'percent' ? `${digits}%` : `${digits} د.أ`) : '—'}
        </div>

        <NumPad
          allowDecimal={discountKind === 'amount'}
          onDigit={handleDigit}
          onClear={() => setDigits(prev => prev.slice(0, -1))}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// ─── Invoice-wide discount dialog ─────────────────────────────────────────────
function GlobalDiscountAmountDialog({
  currentValue,
  currentType,
  onClose,
  onApply,
}: {
  currentValue: number;
  currentType: 'amount' | 'percent';
  onClose: () => void;
  onApply: (value: number, kind: 'amount' | 'percent') => void;
}) {
  const [discountKind, setDiscountKind] = useState<'amount' | 'percent'>(currentType);

  const initDigits = (): string => {
    if (currentValue <= 0) return '';
    if (currentType === 'percent') {
      return String(currentValue);
    }
    const dinars = currentValue / 100;
    return Number.isInteger(dinars) ? String(dinars) : dinars.toFixed(2).replace(/\.?0+$/, '');
  };

  const [digits, setDigits] = useState<string>(initDigits);
  useEscKey(onClose);

  const handleToggleKind = (kind: 'amount' | 'percent') => {
    setDiscountKind(kind);
    setDigits('');
  };

  const handleDigit = (d: string) => {
    if (discountKind === 'percent') {
      if (d === '.') return;
      const next = digits + d;
      const val = parseInt(next, 10);
      if (isNaN(val) || val < 0 || val > 100) return;
      setDigits(next);
      return;
    }
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
    if (discountKind === 'percent') {
      const pct = parseInt(digits || '0', 10);
      onApply(isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)), 'percent');
    } else {
      const fils = parseMoney(digits || '0');
      onApply(Math.max(0, fils), 'amount');
    }
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

        {/* Toggle option */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => handleToggleKind('percent')}
            className={cn(
              "h-9 rounded-lg text-sm font-medium transition-colors border",
              discountKind === 'percent'
                ? "bg-text-primary text-white border-transparent"
                : "bg-surface border-border text-text-secondary hover:border-accent"
            )}
          >
            نسبة %
          </button>
          <button
            type="button"
            onClick={() => handleToggleKind('amount')}
            className={cn(
              "h-9 rounded-lg text-sm font-medium transition-colors border",
              discountKind === 'amount'
                ? "bg-text-primary text-white border-transparent"
                : "bg-surface border-border text-text-secondary hover:border-accent"
            )}
          >
            مبلغ ثابت
          </button>
        </div>

        <div
          className="w-full text-center mb-4 py-3 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px' }}
        >
          {digits ? (discountKind === 'percent' ? `${digits}%` : `${digits} د.أ`) : '—'}
        </div>

        <NumPad
          allowDecimal={discountKind === 'amount'}
          onDigit={handleDigit}
          onClear={() => setDigits(prev => prev.slice(0, -1))}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// ─── Calculator dialog ────────────────────────────────────────────────────────
function CalculatorDialog({
  onClose,
  onTransferToCash,
}: {
  onClose: () => void;
  onTransferToCash?: (value: string) => void;
}) {
  const [display, setDisplay] = useState<string>('');
  // operator state: left operand (in fils), pending operator, right being typed
  const [leftFils, setLeftFils] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);

  const dialogRef = useFocusTrap(true);
  useEscKey(onClose);

  const displayDinars = display === '' ? '0' : display;

  const handleDigit = (d: string) => {
    if (justEvaluated) {
      // Start fresh after =
      setDisplay(d === '.' ? '0.' : d);
      setJustEvaluated(false);
      return;
    }
    if (d === '.') {
      if (display.includes('.')) return;
      setDisplay(prev => (prev === '' ? '0.' : prev + '.'));
      return;
    }
    // limit 3 decimal places
    const dotIdx = display.indexOf('.');
    if (dotIdx >= 0 && display.length - dotIdx - 1 >= 3) return;
    setDisplay(prev => (prev === '' || prev === '0') && d !== '.' ? d : prev + d);
  };

  const handleClear = () => {
    if (display.length > 0) {
      setDisplay(prev => prev.slice(0, -1));
    } else {
      // clear whole expression
      setLeftFils(null);
      setOperator(null);
      setJustEvaluated(false);
    }
  };

  const handleAllClear = () => {
    setDisplay('');
    setLeftFils(null);
    setOperator(null);
    setJustEvaluated(false);
  };

  // ─── Unified compute: same semantics for chained ops AND equals ───────────────
  // × and ÷ treat right as a PLAIN NUMBER FACTOR (parseFloat of displayStr),
  //   not as a money amount. e.g. 5.000 JOD × 3 = 15.000 JOD.
  // + and − treat right as MONEY (parseMoney → fils).
  const compute = (leftFils_: number, displayStr: string, op: string): number => {
    switch (op) {
      case '+': return leftFils_ + parseMoney(displayStr || '0');
      case '−': return Math.max(0, leftFils_ - parseMoney(displayStr || '0'));
      case '×': {
        const factor = parseFloat(displayStr || '1');
        return isNaN(factor) ? leftFils_ : Math.round(leftFils_ * factor);
      }
      case '÷': {
        const divisor = parseFloat(displayStr || '1');
        return (isNaN(divisor) || divisor === 0) ? leftFils_ : Math.round(leftFils_ / divisor);
      }
      default: return leftFils_;
    }
  };

  const handleOperator = (op: string) => {
    if (operator !== null && leftFils !== null && !justEvaluated) {
      // Chain: evaluate pending expression first, then start new op
      const result = compute(leftFils, display, operator);
      setLeftFils(result);
      setDisplay('');
      setOperator(op);
      setJustEvaluated(false);
    } else {
      // First operator: latch current display as left operand (in fils for +/−,
      // but store as fils anyway; compute() handles scaling for × ÷)
      setLeftFils(parseMoney(display || '0'));
      setDisplay('');
      setOperator(op);
      setJustEvaluated(false);
    }
  };

  const handleEquals = () => {
    if (operator === null || leftFils === null) return;
    const result = compute(leftFils, display, operator);
    const dinars = result / 100;
    const str = Number.isInteger(dinars) ? String(dinars) : dinars.toFixed(3).replace(/\.?0+$/, '');
    setDisplay(str);
    setLeftFils(null);
    setOperator(null);
    setJustEvaluated(true);
  };

  const opLabel: Record<string, string> = { '+': 'جمع', '−': 'طرح', '×': 'ضرب', '÷': 'قسمة' };

  const opBtnClass = (op: string) => cn(
    'h-11 rounded-lg border text-base font-bold transition-colors',
    operator === op && !justEvaluated
      ? 'bg-text-primary text-white border-transparent'
      : 'bg-surface border-border text-text-secondary hover:border-accent'
  );

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
        aria-label="آلة حاسبة"
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '16px', fontWeight: 700 }}>آلة حاسبة</span>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-full">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Display */}
        <div
          className="w-full text-end mb-3 py-3 px-4 rounded-xl bg-muted"
          style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#CF694A', minHeight: '64px', direction: 'ltr' }}
        >
          <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'Inter, sans-serif', fontWeight: 400 }}>
            {leftFils !== null && operator ? `${(leftFils / 100).toFixed(2)} ${operator} ` : ''}
          </span>
          {displayDinars}
        </div>

        {/* Operators row */}
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {(['+', '−', '×', '÷'] as const).map(op => (
            <button
              key={op}
              type="button"
              onClick={() => handleOperator(op)}
              aria-label={opLabel[op]}
              className={opBtnClass(op)}
            >
              {op}
            </button>
          ))}
        </div>

        {/* NumPad */}
        <NumPad
          allowDecimal
          onDigit={handleDigit}
          onClear={handleClear}
          onSubmit={handleEquals}
        />

        {/* AC and Transfer row */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            type="button"
            onClick={handleAllClear}
            className="h-10 rounded-lg border border-danger text-danger text-sm font-bold hover:bg-danger/10 transition-colors"
            style={{ fontFamily: 'Tajawal, sans-serif' }}
          >
            مسح كل
          </button>
          {onTransferToCash ? (
            <button
              type="button"
              onClick={() => {
                const val = display || '0';
                onTransferToCash(val);
                onClose();
              }}
              className="h-10 rounded-lg bg-accent text-white text-sm font-bold hover:opacity-90 transition-opacity"
              style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '12px' }}
            >
              نقل إلى المبلغ المستلم
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="h-10 rounded-lg border border-border text-text-secondary text-sm font-bold opacity-40 cursor-not-allowed"
              style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '12px' }}
              title="افتح خيارات متقدمة لنقل المبلغ"
            >
              نقل إلى المبلغ المستلم
            </button>
          )}
        </div>
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
  const { accessLevel, requireAdminActionOnce } = useAuth();
  const [policy, setPolicy] = useState<DiscountPolicy | null>(null);

  useEffect(() => {
    getDiscountPolicy().then(setPolicy);
  }, []);

  const [pulse, setPulse] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [discountEditId, setDiscountEditId] = useState<string | null>(null);
  const [showGlobalDiscountDialog, setShowGlobalDiscountDialog] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [pendingGlobalDiscount, setPendingGlobalDiscount] = useState<{ value: number; kind: 'amount' | 'percent' } | null>(null);
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
      requireAdminActionOnce(() => setItemPrice(selectedItemId, Math.max(0, fils)));
    }
  };

  const executeGlobalDiscountApply = (value: number, kind: 'amount' | 'percent') => {
    const applyAction = () => {
      setGlobalDiscount(kind, value);
    };

    if (value === 0) {
      applyAction();
      return;
    }

    if (!policy || !policy.enabled) {
      requireAdminActionOnce(applyAction);
      return;
    }

    const subtotalFils = getSubtotal();
    const requestedFils = kind === 'amount' ? value : applyPercent(subtotalFils, value);
    const capFils = policy.capType === 'amount' ? policy.capValue : applyPercent(subtotalFils, policy.capValue);

    if (requestedFils > capFils) {
      requireAdminActionOnce(applyAction);
    } else {
      applyAction();
    }
  };

  const handleGlobalDiscountApply = (value: number, kind: 'amount' | 'percent') => {
    if (value === 0) {
      setGlobalDiscount(kind, 0);
      return;
    }

    const hasLineDiscounts = items.some(i => !i.isGift && i.discountValue > 0);
    if (hasLineDiscounts) {
      setPendingGlobalDiscount({ value, kind });
      setShowConflictConfirm(true);
    } else {
      executeGlobalDiscountApply(value, kind);
    }
  };

  const handleLineDiscountApply = (itemId: string, value: number, kind: 'amount' | 'percent') => {
    const applyAction = () => {
      setItemDiscount(itemId, kind, value);
    };

    if (value === 0) {
      applyAction();
      return;
    }

    if (!policy || !policy.enabled) {
      requireAdminActionOnce(applyAction);
      return;
    }

    const item = items.find(i => i.cartItemId === itemId);
    if (!item) return;

    const { subtotal: subtotalFils } = calculateItemLineTotal(item);
    const requestedFils = kind === 'amount' ? value : applyPercent(subtotalFils, value);
    const capFils = policy.capType === 'amount' ? policy.capValue : applyPercent(subtotalFils, policy.capValue);

    if (requestedFils > capFils) {
      requireAdminActionOnce(applyAction);
    } else {
      applyAction();
    }
  };

  const hasGlobalDiscount = globalDiscountValue > 0;

  return (
    <>
      <div className="w-full h-full bg-surface border-s border-border flex flex-col overflow-hidden">

        {/* ── Cart header ── */}
        <div className="shrink-0 flex flex-col bg-background">
          <SavedCartsTabs itemCount={items.length} onClearCart={() => setConfirmClear(true)} pulse={pulse} />
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

                    {item.isGift ? (
                      <div
                        style={{
                          flex: '1', minWidth: 0,
                          background: '#DCFCE7',
                          border: '1px solid #86EFAC',
                          borderRadius: '7px',
                          padding: '3px 6px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                        }}
                      >
                        <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '9px', color: '#16A34A' }}>خصم</span>
                        <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '12px', fontWeight: 700, color: '#16A34A' }}>
                          هدية
                        </span>
                      </div>
                    ) : (
                      /* Discount box — tappable */
                      <button
                        onClick={() => setDiscountEditId(item.cartItemId)}
                        disabled={policy?.enabled === false && accessLevel !== 'admin'}
                        style={{
                          flex: '1', minWidth: 0,
                          background: item.discountValue > 0 ? '#FEF2F2' : 'var(--color-surface, white)',
                          border: `1px solid ${item.discountValue > 0 ? '#FECACA' : 'var(--color-border)'}`,
                          borderRadius: '7px',
                          padding: '3px 6px',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'flex-start',
                          cursor: (policy?.enabled === false && accessLevel !== 'admin') ? 'not-allowed' : 'pointer',
                          opacity: (policy?.enabled === false && accessLevel !== 'admin') ? 0.5 : 1,
                          touchAction: 'manipulation',
                        }}
                        aria-label="تعديل الخصم"
                      >
                        <span style={{ fontFamily: 'Tajawal, sans-serif', fontSize: '9px', color: item.discountValue > 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>خصم</span>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, color: item.discountValue > 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>
                          {item.discountValue > 0
                            ? (item.discountType === 'percent' ? `− ${item.discountValue}%` : `− ${formatMoney(item.discountValue)}`)
                            : '—'}
                        </span>
                      </button>
                    )}

                    {/* Gift toggle */}
                    <button
                      onClick={() => requireAdminActionOnce(() => setItemGift(item.cartItemId, !item.isGift))}
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

          {/* Totals & Actions Row */}
          <div className="space-y-1.5">
            
            {/* Subtotal & Discount compact row */}
            <div className="flex justify-between items-center text-xs text-text-secondary px-0.5">
              <div className="flex items-center gap-1.5">
                <span style={{ fontFamily: 'Tajawal, sans-serif' }}>المجموع الفرعي:</span>
                <span className="numeric font-semibold">{formatMoney(getSubtotal())}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowGlobalDiscountDialog(true)}
                  disabled={policy?.enabled === false && accessLevel !== 'admin'}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border text-text-secondary hover:border-accent hover:text-accent bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '11px', fontFamily: 'Tajawal, sans-serif', touchAction: 'manipulation' }}
                  title="خصم على الفاتورة كاملة"
                >
                  <Tag className="w-2.5 h-2.5" />
                  <span>خصم</span>
                </button>
                
                {getTotalDiscount() > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="numeric text-danger font-bold">− {formatMoney(getTotalDiscount())}</span>
                    {hasGlobalDiscount && (
                      <button
                        onClick={() => setGlobalDiscount('amount', 0)}
                        className="text-danger hover:bg-danger/10 p-0.5 rounded-full transition-colors flex items-center justify-center"
                        style={{ touchAction: 'manipulation' }}
                        title="إلغاء خصم الفاتورة"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action bar — qty, price, and calculator */}
            {!selectedItemId && (
              <p className="text-[11px] text-text-secondary text-center mb-1.5" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                اختر منتجاً من السلة لتعديل الكمية أو السعر
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
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
                    'rounded-lg border flex items-center justify-center gap-1 transition-colors bg-surface shadow-sm',
                    selectedItemId
                      ? 'border-border text-text-primary hover:bg-muted hover:border-accent'
                      : 'border-border text-text-secondary opacity-50 cursor-not-allowed'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
              {/* Calculator button — always enabled */}
              <button
                onClick={() => setShowCalculator(true)}
                style={{ height: '38px', touchAction: 'manipulation', fontFamily: 'Tajawal, sans-serif', fontSize: '13px', fontWeight: 600 }}
                className="rounded-lg border border-border flex items-center justify-center gap-1 transition-colors bg-surface shadow-sm text-text-primary hover:bg-muted hover:border-accent"
                aria-label="آلة حاسبة"
              >
                <Calculator className="w-3.5 h-3.5" />
                آلة حاسبة
              </button>
            </div>

            {/* Pay button with total embedded */}
            <button
              onClick={() => { if (items.length > 0) setIsPaymentOpen(true); }}
              disabled={items.length === 0}
              style={{ height: '52px', fontFamily: 'Tajawal, sans-serif', fontSize: '16px', fontWeight: 'bold', touchAction: 'manipulation' }}
              className="w-full bg-accent text-white rounded-lg disabled:opacity-50 disabled:bg-muted disabled:text-text-secondary hover:opacity-90 transition-opacity shadow-md flex items-center justify-center gap-2"
            >
              <span>إتمام البيع</span>
              {items.length > 0 && (
                <span className="numeric bg-white/20 px-2.5 py-0.5 rounded-full text-sm font-bold">
                  {formatMoney(getTotal())}
                </span>
              )}
            </button>
          </div>
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
          onApply={(value, kind) => {
            handleLineDiscountApply(discountEditItem.cartItemId, value, kind);
            setDiscountEditId(null);
          }}
        />
      )}

      {/* Invoice-wide discount dialog */}
      {showGlobalDiscountDialog && (
        <GlobalDiscountAmountDialog
          currentValue={globalDiscountValue}
          currentType={globalDiscountType}
          onClose={() => setShowGlobalDiscountDialog(false)}
          onApply={(value, kind) => {
            handleGlobalDiscountApply(value, kind);
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
          const pending = pendingGlobalDiscount;
          setPendingGlobalDiscount(null);
          setShowConflictConfirm(false);
          if (pending !== null) {
            executeGlobalDiscountApply(pending.value, pending.kind);
          }
        }}
        onCancel={() => {
          setPendingGlobalDiscount(null);
          setShowConflictConfirm(false);
        }}
      />

      <PaymentDialog
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onSuccess={(id, number, change) => {
          setIsPaymentOpen(false);
          if (change === 0) {
            // Part 4a: zero change → skip SuccessDialog, clear immediately
            // (Receipt remains accessible from the sales/history list)
            clearCart();
            toast.success(`تمت العملية — فاتورة ${number}`);
          } else {
            // change > 0 → show SuccessDialog so cashier sees the change amount
            setSuccessData({ isOpen: true, invoiceId: id, invoiceNumber: number, change });
          }
        }}
      />

      <SuccessDialog
        isOpen={successData.isOpen}
        invoiceId={successData.invoiceId}
        invoiceNumber={successData.invoiceNumber}
        change={successData.change}
        onClose={() => { clearCart(); setSuccessData({ ...successData, isOpen: false }); }}
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

      {/* Calculator dialog */}
      {showCalculator && (
        <CalculatorDialog
          onClose={() => setShowCalculator(false)}
        />
      )}
    </>
  );
}
