# OperationsPage.tsx — Patch to wire in the Purchases module

This file shows the EXACT edits Gemini needs to make to
`src/modules/operations/OperationsPage.tsx` to surface the new purchases
module. There are **4 small edits** — no existing code is removed, only
added.

> All line numbers below refer to the CURRENT state of `OperationsPage.tsx`
> on the `main` branch (commit `2f376f0`).

---

## Edit 1 — Add imports (after line 17, inside the existing import block)

Insert these lines right after the existing `import { toast } from 'sonner';`
on line 17:

```tsx
import { PurchaseDialog } from './components/PurchaseDialog';
import { PurchaseListTab } from './components/PurchaseListTab';
import { ShoppingCart } from 'lucide-react';
```

## Edit 2 — Extend the `Tab` type (line 19)

Change:

```tsx
type Tab = 'ledger' | 'eod';
```

to:

```tsx
type Tab = 'ledger' | 'eod' | 'purchases';
```

## Edit 3 — Add state for the purchase dialog (after line 32)

After the existing `const [isEODOpen, setIsEODOpen] = useState(false);`
add:

```tsx
const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
```

## Edit 4 — Add a "Purchases" button next to the "Topup" and "Transfer" buttons

In the existing header button cluster (lines 152–169), insert a new button
right after the "تحويل" button. Find this block:

```tsx
<button
  onClick={() => setIsTransferOpen(true)}
  className="h-[var(--btn-height)] px-4 bg-surface border border-border flex items-center gap-2 rounded-lg hover:border-accent font-medium text-sm transition-colors"
  style={{ fontFamily: 'Tajawal, sans-serif' }}
>
  <ArrowRightLeft className="w-4 h-4 text-accent" />
  تحويل
</button>
```

Immediately AFTER it, add:

```tsx
<button
  onClick={() => setIsPurchaseOpen(true)}
  className="h-[var(--btn-height)] px-4 bg-surface border border-border flex items-center gap-2 rounded-lg hover:border-accent font-medium text-sm transition-colors"
  style={{ fontFamily: 'Tajawal, sans-serif' }}
>
  <ShoppingCart className="w-4 h-4 text-accent" />
  شراء بضاعة
</button>
```

## Edit 5 — Add the "purchases" tab to the tabs array (line 131-134)

Change:

```tsx
const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'ledger', label: 'الحركة المالية', icon: ArrowRightLeft },
  { id: 'eod', label: 'الإقفال اليومي', icon: Lock },
];
```

to:

```tsx
const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'ledger', label: 'الحركة المالية', icon: ArrowRightLeft },
  { id: 'purchases', label: 'المشتريات', icon: ShoppingCart },
  { id: 'eod', label: 'الإقفال اليومي', icon: Lock },
];
```

## Edit 6 — Render the PurchaseListTab when the tab is active

Find the block at line 329 that renders the EOD tab:

```tsx
{/* ══ EOD TAB ═════════════════════════════════════════════════════ */}
{activeTab === 'eod' && (
```

Immediately BEFORE that block, insert:

```tsx
{/* ══ PURCHASES TAB ═══════════════════════════════════════════════ */}
{activeTab === 'purchases' && <PurchaseListTab />}

```

## Edit 7 — Render the PurchaseDialog at the bottom of the component

Find the existing dialog block at lines 490–497:

```tsx
{/* ── Dialogs ── */}
<TopupDialog isOpen={isTopupOpen} onClose={() => setIsTopupOpen(false)} />
<TransferDialog isOpen={isTransferOpen} onClose={() => setIsTransferOpen(false)} />
<EODCloseDialog
  isOpen={isEODOpen}
  onClose={() => { setIsEODOpen(false); refetchTodayStatus(); }}
  targetDate={today}
/>
```

Add a new line for the PurchaseDialog:

```tsx
{/* ── Dialogs ── */}
<TopupDialog isOpen={isTopupOpen} onClose={() => setIsTopupOpen(false)} />
<TransferDialog isOpen={isTransferOpen} onClose={() => setIsTransferOpen(false)} />
<PurchaseDialog isOpen={isPurchaseOpen} onClose={() => setIsPurchaseOpen(false)} />
<EODCloseDialog
  isOpen={isEODOpen}
  onClose={() => { setIsEODOpen(false); refetchTodayStatus(); }}
  targetDate={today}
/>
```

---

## Summary of changes

- **No existing code removed or changed** (except the `Tab` type union and
  the `tabs` array, both of which are extended, not replaced).
- 2 new imports (PurchaseDialog + PurchaseListTab) + 1 lucide icon.
- 1 new state hook (`isPurchaseOpen`).
- 1 new header button ("شراء بضاعة").
- 1 new tab entry ("المشتريات").
- 1 new conditional render for `<PurchaseListTab />`.
- 1 new `<PurchaseDialog />` render.

After these edits, the Operations page will have three tabs:
1. **الحركة المالية** (existing) — ledger
2. **المشتريات** (new) — purchase history table
3. **الإقفال اليومي** (existing) — EOD close

And the header will have three action buttons: شحن رصيد، تحويل، شراء بضاعة.
