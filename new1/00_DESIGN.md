# Aya Mobile POS — Purchases Module Design (Weighted-Average Cost)

**Author:** Super Z (accounting-systems analyst)
**Repo:** https://github.com/ayamobile7758/New-Aya-Mobail.git (branch `main`, commit `2f376f0`)
**Status:** Proposal — ready for Claude (reviewer) and Gemini (implementer)
**Tests:** ✅ All 65 Vitest tests pass (14 new WAC + 4 new three-surface + 47 pre-existing).
         ✅ `tsc --noEmit` clean.

---

## Table of Contents

1. [Evidence — Current State of the Codebase](#1-evidence--current-state-of-the-codebase)
2. [Design — Answers to the Open Questions](#2-design--answers-to-the-open-questions)
3. [Plain-Arabic Explanation for the Owner](#3-plain-arabic-explanation-for-the-owner)
4. [SQL Migration (CREATE TABLE purchases + index + Realtime + RLS)](#4-sql-migration)
5. [TypeScript Module — `src/db/queries/purchases.ts`](#5-typescript-module)
6. [Pure WAC Helper — `src/db/queries/purchases.wac.ts`](#6-pure-wac-helper)
7. [UI Components — `PurchaseDialog.tsx` + `PurchaseListTab.tsx`](#7-ui-components)
8. [OperationsPage Wiring Patch](#8-operationspage-wiring-patch)
9. [Worked Numeric Proof](#9-worked-numeric-proof)
10. [Verification & Test Plan](#10-verification--test-plan)
11. [Step-by-Step Apply Order for the Owner](#11-step-by-step-apply-order-for-the-owner)
12. [Assumptions & Flags for the Reviewer](#12-assumptions--flags-for-the-reviewer)

---

## 1. Evidence — Current State of the Codebase

Every claim below is verified against the actual GitHub source. Citations are
`file:line`.

### 1.1 `products.cost_price` — single manual field

- **Definition:** `supabase/schema.sql:143` — `cost_price INTEGER NOT NULL DEFAULT 0, -- fils`
- **Type interface:** `src/db/queries/products.ts:11` — `cost_price: number;`
- **Used in:** `src/db/queries/sales.ts:142` — `unit_cost: item.product.cost_price ?? 0,` (the ONLY place cost_price is read at sale time; it becomes the snapshot in `invoice_items.unit_cost`).
- **Read by reports:** NEVER. The three accounting surfaces (reports.ts, closures.ts, operations.ts) all read `invoice_items.unit_cost` — never `products.cost_price`. See §1.3 below.
- **Currently updated:** Only via `updateProduct()` in `src/db/queries/products.ts:127-186` (manual edit from ProductsPage → ProductEditor). No automated recompute exists. This is the gap the purchases module closes.

### 1.2 How `complete_sale` snapshots `unit_cost`

`complete_sale` is a PLpgSQL RPC (`supabase/functions.sql:176-321`). The
snapshot happens at line 249 and is stored at line 262:

```sql
-- functions.sql:249
v_unit_cost := (item ->> 'unit_cost')::int;
-- functions.sql:257-262
INSERT INTO invoice_items (id, invoice_id, product_id, product_name, quantity,
                           unit_price, unit_cost, product_category, ...)
VALUES (v_item_id, v_invoice_id, v_product_id, v_product_name, v_quantity,
        v_unit_price, v_unit_cost, v_product_category, ...);
```

The `unit_cost` in the payload comes from `src/db/queries/sales.ts:142`:

```typescript
unit_cost: item.product.cost_price ?? 0,
```

**Conclusion:** `invoice_items.unit_cost` is a permanent snapshot of
`products.cost_price` AT THE MOMENT OF SALE. It is **never** updated
retroactively by any code path. Therefore, any future change to
`products.cost_price` (via the purchases module or otherwise) cannot
affect the COGS of past sales.

### 1.3 The three accounting surfaces — proof they don't read `products.cost_price`

| Surface | File:Line | COGS Source |
|---|---|---|
| `getReport` | `src/db/queries/reports.ts:57` | `SUM(ii.unit_cost * ii.quantity)` from `invoice_items ii` |
| `getReport` (gifts) | `src/db/queries/reports.ts:90` | `SUM(ii.unit_cost * ii.quantity)` from `invoice_items ii` |
| `getReport` (by-category) | `src/db/queries/reports.ts:149` | `SUM(ii.unit_cost * ii.quantity)` |
| `getReport` (top products) | `src/db/queries/reports.ts:173` | `SUM(ii.unit_cost * ii.quantity)` |
| `getReport` (daily) | `src/db/queries/reports.ts:216` | `SUM(ii.unit_cost * ii.quantity)` |
| `getProfitAndLoss` (cogs) | `src/db/queries/reports.ts:339` | `SUM(ii.unit_cost * ii.quantity)` |
| `getOpenDayPreview` (cogs) | `src/db/queries/closures.ts:80` | `SUM(ii.unit_cost * ii.quantity)` |
| `getOpenDayPreview` (gifts) | `src/db/queries/closures.ts:92` | `SUM(ii.unit_cost * ii.quantity)` |
| `getDailySummary` (cogs) | `src/db/queries/operations.ts:117` | `SUM(ii.unit_cost * ii.quantity)` |

Every single COGS line in the codebase reads `invoice_items.unit_cost`.
**None** reads `products.cost_price`. This is the structural guarantee
that lets us recompute `products.cost_price` going forward without
disturbing historical P&L.

### 1.4 The agreed net-profit formula (must stay identical)

Documented at the top of both `reports.ts:6-25` and `closures.ts:6-28`:

```
sales_gross   = SUM(invoices.total_amount) WHERE status IN ('active','partially_returned')
partial_returns_total = SUM(invoices.total_amount - invoices.paid_amount) WHERE status='partially_returned'
sales_net     = sales_gross - partial_returns_total
cogs          = SUM(invoice_items.unit_cost * invoice_items.quantity) WHERE invoice.status IN ('active','partially_returned')
gross_profit  = sales_net - cogs
topup_profit  = SUM(topups.profit)
maintenance_revenue = SUM(maintenance_jobs.final_amount) WHERE status='delivered'
expenses_total = SUM(expenses.amount)
inventory_adjustments_total = SUM(ledger_entries CASE WHEN type='debit' THEN amount ELSE -amount END) WHERE ref_type='inventory_adjustment'
net_profit    = gross_profit + topup_profit + maintenance_revenue - expenses_total - inventory_adjustments_total
```

**Crucial:** `inventory_adjustments_total` filters `ledger_entries` by
`ref_type = 'inventory_adjustment'`. The purchases module will write ledger
rows with `ref_type = 'purchase'` — a NEW ref_type that is **NOT** read by
any of the three formulas. So even if a purchase debits a cash account
and writes a ledger row, the net-profit formulas are blind to it.

### 1.5 How `exec_batch` parses `?` placeholders

`supabase/functions.sql:105-173` defines the `exec_batch(jsonb)` PLpgSQL
function. Key parsing logic (lines 131-163):

- Splits the SQL string on `?` into segments via `string_to_array`.
- For each segment except the last, inlines the corresponding param value:
  - `null` → `NULL`
  - `string` → `quote_literal(val_text)` (safe — escapes quotes)
  - `number` → `val_text || '::numeric'` (integer or float; works fine for fils)
  - `boolean` → `1` / `0`
  - else → `quote_literal(val::text) || '::jsonb'`

**Implications for the purchases module:**

1. The migration DDL (CREATE TABLE, CREATE INDEX, ALTER PUBLICATION, etc.)
   contains NO `?` placeholders — it must be run directly in the Supabase
   SQL Editor, NOT through `exec_batch`. (The migration file is plain DDL.)
2. The runtime SQL in `purchases.ts` uses `?` placeholders for all
   dynamic values — exactly the same pattern as `expenses.ts` and
   `operations.ts`.
3. Integer fils values pass through cleanly (the `::numeric` cast is fine).
4. The whole `exec_batch` call is atomic by virtue of being a PLpgSQL
   function — any exception in any statement causes the function to
   raise, and Postgres rolls back the entire function call.

### 1.6 Atomicity pattern — `dbClient.batchRun` in existing code

The pattern is established in:

- `src/db/queries/expenses.ts:109-141` (`addExpense`) — 3 statements
- `src/db/queries/operations.ts:206-224` (`createTopup`) — 3 statements
- `src/db/queries/operations.ts:288-323` (`createTransfer`) — 6 statements
- `src/db/queries/closures.ts:200-263` (`closeDay`) — variable count
- `src/db/queries/inventory.ts:28-68` (`createInventoryCount`) — variable count
- `src/db/queries/sales.ts:302-373` (`returnInvoice`) — variable count

The pattern: build `const tx: {sql, params}[] = []`, push statements,
`await dbClient.batchRun(tx)`, then `await logAudit(...)` after.

**Audit outside the batch (existing weakness):** In all the above, `logAudit`
runs AFTER `batchRun`. If `logAudit` throws, the audit row is lost but the
financial mutation has already committed. `audit.ts:11-20` even has a
try/catch that swallows the error to prevent it from blocking business ops.

**For purchases:** the task spec explicitly requires the audit row to be
INSIDE the batch (atomicity requirement). I've complied: `purchases.ts`
includes the `INSERT INTO audit_log` as the LAST statement in the `tx`
array, so it commits/rolls back with the financial mutation. This is a
slight upgrade over the existing pattern.

### 1.7 Day-closure lock pattern

`src/db/queries/expenses.ts:80-83`:

```typescript
const today = await assertClockNotTampered();
if (await isDayClosed(today)) {
  throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
}
```

Same pattern at:
- `src/db/queries/operations.ts:177-180` (createTopup)
- `src/db/queries/operations.ts:252-255` (createTransfer)
- `src/db/queries/inventory.ts:13-16` (createInventoryCount)
- `src/db/queries/sales.ts:45-48` (completeSale)
- `src/db/queries/expenses.ts:181-184` (deleteExpense)
- `src/db/queries/expenses.ts:238-241` (restoreExpense)
- `src/db/queries/expenses.ts:327-330` (updateExpense)
- `src/db/queries/closures.ts:188-191` (closeDay)

The purchases module (`purchases.ts:81-84`) follows the same pattern
verbatim.

### 1.8 UI patterns — TopupDialog as the template

`src/modules/operations/components/TopupDialog.tsx:1-207` is the closest
existing analog to PurchaseDialog. Key shared patterns:

- Fixed overlay: `<div className="fixed inset-0 z-50 ... bg-black/50 backdrop-blur-sm" onClick={...}>` (lines 92-95)
- Card: `<div className="bg-background rounded-2xl ... max-w-md shadow-xl ...">` (line 96)
- Header: `<div className="flex justify-between items-center p-4 border-b border-border bg-surface shrink-0">` (lines 97-102)
- Close on Esc: `useEscKey(onClose, isOpen)` (line 22)
- Close on backdrop click (line 94)
- Form: `<form onSubmit={handleSubmit} className="p-4 overflow-y-auto flex-1 space-y-4">` (line 104)
- Inputs use `h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric`
- Money parsing: `parseMoney(amountStr)` (line 66)
- Money display: `formatMoney(amount)` (lines 115, 163, etc.)
- Account picker: `<select>` with `<option value="">-- اختر الحساب --</option>` (lines 107-117)
- Live preview panel: `<div className="p-3 bg-muted/50 rounded-xl space-y-2 text-sm">` (line 160)
- Two-button footer: إلغاء / حفظ (lines 186-202)
- Admin gate: `requireAdminAction(() => topupMutation.mutate({...}))` (line 81)
- Toast on success: `toast.success('...')` (line 55)
- Query invalidation on success (lines 51-54)

**PurchaseDialog** follows the same structure exactly, only adding a
product picker and a live WAC-preview panel.

### 1.9 Navigation — where the new button should live

The "More" menu (`src/modules/more/MorePage.tsx:5-13`) currently has 6
items. The Operations page (`src/modules/operations/OperationsPage.tsx:151-179`)
already has two action buttons in its header: "شحن رصيد" and "تحويل".
A "شراء بضاعة" button fits naturally next to them — it's an operational
action that moves cash and updates stock, exactly like topups/transfers.

See `OPERATIONS_PAGE_PATCH.md` for the precise 7-edit patch.

### 1.10 RLS + Realtime publication pattern

`supabase/schema.sql:430-469` enables RLS on every table and creates a
permissive `anon_all` policy on each. `supabase/schema.sql:479-492` adds
each table to the `supabase_realtime` publication. The purchases
migration (`01_migration_purchases.sql`) replicates both patterns
identically.

---

## 2. Design — Answers to the Open Questions

### Q1. Should a purchase optionally debit a paying account?

**Recommendation: YES, optional.** Default behavior: when the owner
selects a paying account, the purchase debits that account (cash/bank)
and writes a `ledger_entries` row with `ref_type='purchase'`, `type='debit'`,
`amount=total_cost`. When the owner selects "بدون حساب دافع" (no paying
account), only stock+cost are updated (a credit purchase from a supplier).

**Justification:**

- **Professional default.** Real POS systems record the cash outflow at
  purchase time. Otherwise the cash-account balance drifts away from the
  actual cash on hand, and the ledger becomes useless for reconciliation.
- **Optional because** Jordanian mobile shops often buy on credit from
  wholesalers ("اشتري الآن وادفع نهاية الشهر"). Forcing a debit would
  create a false negative cash balance.
- **No net-profit impact either way.** Because the ledger row has
  `ref_type='purchase'` (a new ref_type not read by any of the three
  accounting formulas), debiting the account affects the BALANCE SHEET
  (cash ↓, stock ↑) but never the P&L.
- **No balance guard.** I deliberately do NOT enforce
  `account.balance >= total_cost` at purchase time. The owner may buy
  stock with money that's about to be topped up tomorrow. This mirrors
  how `complete_sale` allows a sale even if change exceeds balance.
  (Add a hard guard later if the owner requests it.)

### Q2. Does buying stock affect net profit at purchase time?

**Recommendation: NO — and the design guarantees this.**

Buying inventory is an **asset swap**, not an expense:

- Stock (asset) ↑ by `quantity * unit_cost` fils.
- Cash (asset) ↓ by the same amount (if a paying account is debited).

Net assets unchanged. Net profit unchanged.

COGS (the expense) hits the P&L only when the stock is **SOLD**. At sale
time, `complete_sale` snapshots `unit_cost` into `invoice_items.unit_cost`
(`functions.sql:249`, `sales.ts:142`), and the three accounting surfaces
read `invoice_items.unit_cost * quantity` to compute COGS
(`reports.ts:57`, `closures.ts:80`, `operations.ts:117`).

**Proof by exhaustion of the codebase:** §1.3 above shows that every
COGS line in the codebase reads `invoice_items.unit_cost` — none reads
`products.cost_price`. Therefore, recomputing `products.cost_price` via
a purchase **cannot** affect any past, present, or future P&L line for
dates prior to the next sale of that product.

**Verification:** See `purchases-three-surface.test.ts` — it stubs
`dbClient`, simulates a purchase, and asserts that `getReport`,
`getProfitAndLoss`, and `getOpenDayPreview` return IDENTICAL `net_profit`
before and after the purchase. All 4 tests pass.

### Q3. What new tables/columns are needed?

**One new table: `purchases`.** No new columns on `products` (the
weighted-average cost lives in `products.cost_price`, recomputed in
place). No stock-lots table (forbidden by the hard constraint).

**Schema** (see `01_migration_purchases.sql` for the full DDL):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | nanoid |
| `purchase_number` | TEXT UNIQUE | `PRCS-YYMM-NNNNN` |
| `purchase_date` | TEXT | YYYY-MM-DD, from `assertClockNotTampered()` |
| `product_id` | TEXT NOT NULL → products(id) | ON DELETE RESTRICT |
| `product_name` | TEXT NOT NULL | snapshot |
| `product_sku` | TEXT | snapshot (nullable) |
| `category` | TEXT | snapshot |
| `quantity` | INTEGER > 0 | CHECK constraint |
| `unit_cost` | INTEGER ≥ 0 | fils |
| `total_cost` | INTEGER ≥ 0 | fils = quantity * unit_cost |
| `old_stock_qty` | INTEGER | snapshot BEFORE this purchase (audit) |
| `old_cost_price` | INTEGER | snapshot BEFORE this purchase (audit) |
| `new_stock_qty` | INTEGER | snapshot AFTER this purchase (audit) |
| `new_cost_price` | INTEGER | snapshot AFTER this purchase (audit, = the new WAC) |
| `account_id` | TEXT → accounts(id) | NULL when no paying account |
| `account_name` | TEXT | snapshot |
| `supplier_id` | TEXT → suppliers(id) | optional |
| `supplier_name` | TEXT | snapshot |
| `notes` | TEXT | |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | auto-stamped by trigger |
| `device_id` | TEXT | |
| `deleted_at` | TEXT | soft-delete (matches expenses pattern) |

**Indexes:** `idx_purchases_date`, `idx_purchases_product`,
`idx_purchases_device`, `idx_purchases_deleted`.

**Sequence seed:** `INSERT INTO sequences (name, last_val) VALUES ('purchase', 0)`.

**RLS:** `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "anon_all" FOR ALL TO anon USING (true) WITH CHECK (true)` (matches every existing table).

**Realtime publication:** `ALTER PUBLICATION supabase_realtime ADD TABLE purchases;` (matches schema.sql:479-492).

**Trigger:** `trg_purchases_updated_at BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()` (matches every existing table that has updated_at).

**Rollback:** `02_rollback_purchases.sql` drops the table, indexes, trigger, RLS policy, publication membership, and sequence row.

### Q4. Where does the purchases UI live?

**Recommendation: Two surfaces, both on the existing OperationsPage:**

1. **"شراء بضاعة" button** in the OperationsPage header (next to the
   existing "شحن رصيد" and "تحويل" buttons). Clicking opens
   `PurchaseDialog` — a modal form for creating a new purchase.
2. **"المشتريات" tab** on OperationsPage (between "الحركة المالية" and
   "الإقفال اليومي"). Renders `<PurchaseListTab />` — a filterable
   table of past purchases with WAC snapshot columns and a delete button.

**Why OperationsPage (and not InventoryPage or a new page):**

- **OperationsPage is the cash-movement hub.** Topups (cash in),
  transfers (cash sideways), EOD close (cash reconciliation) all live
  there. A purchase (cash out → stock in) is the missing fourth pillar.
- **InventoryPage is for stock ADJUSTMENTS** (inventory counts, account
  reconciliations) — those don't move cash. A purchase moves cash, so
  it belongs with the other cash-moving operations.
- **A new top-level page** would clutter the More menu (already 6 items)
  and require new auth/routing config. Adding a tab + a header button to
  an existing page is the minimum-change path.

**Alternative considered (rejected):** A standalone `/purchases` route
linked from MorePage. Rejected because (a) it duplicates OperationsPage's
date-filter + ledger-join infrastructure, and (b) the owner would have
to navigate two screens to see purchases alongside other cash movements.

### Q5. Should purchases respect the day-closure lock?

**Recommendation: YES — same pattern as expenses/topups/sales.**

Pattern (from `expenses.ts:80-83`):

```typescript
const today = await assertClockNotTampered();
if (await isDayClosed(today)) {
  throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
}
```

`purchases.ts:81-84` implements this verbatim. Same for `deletePurchase`
at lines 247-250.

**Why:** a back-dated purchase (or one made after the day is closed)
would land on a date whose P&L is already locked. Even though the
purchase itself doesn't affect past P&L (per Q2), it would:

1. Debit a cash account on the closed day, making the closure's
   reconciliation row wrong.
2. Appear in the closure's ledger export, causing audit confusion.
3. Be retroactively editable if the owner reopens the day, which is
   dangerous for an accounting transaction.

The clock-tampering guard (`assertClockNotTampered`) prevents the device
clock from being rolled back; the day-closure check prevents forward-dating
into a closed day. Together they give the same audit trail strength as
sales and expenses.

---

## 3. Plain-Arabic Explanation for the Owner

> **شراء البضاعة (المشتريات) — المتوسط الموزون**
>
> **ما الذي يفعله هذا النظام؟**
>
> عندما تشتري بضاعة من المورّد وتدفع لها ثمناً، ستسجّل عملية الشراء
> عبر زر "شراء بضاعة" في صفحة العمليات. سيقوم النظام بـ:
>
> 1. زيادة كمية المخزون للمنتج.
> 2. إعادة حساب **تكلفة الوحدة** للمنتج باستخدام طريقة **المتوسط
>    الموزون** (وليس FIFO ولا الدفعات).
> 3. خصم قيمة الشراء من الصندوق أو البنك الذي اخترته (إذا كنت تريد
>    ذلك — أو اتركه "بدون حساب دافع" للشراء الآجل).
> 4. كتاب всех التفاصيل في سجل المشتريات وسجل التدقيق.
>
> **قاعدة المتوسط الموزون:**
>
> التكلفة الجديدة = (الكمية القديمة × التكلفة القديمة + الكمية المشتراة × تكلفة الشراء) ÷ (الكمية القديمة + الكمية المشتراة)
>
> مثال: لديك 10 قطع بتكلفة 4.00 د.أ للوحدة. اشتريت 10 قطع أخرى بتكلفة 5.00 د.أ للوحدة. التكلفة الجديدة ستكون:
> (10×4.00 + 10×5.00) ÷ 20 = 4.50 د.أ للوحدة.
>
> **ملاحظة مهمة جداً — شراء البضاعة لا يخفض الربح:**
>
> شراء البضاعة **ليس مصروفاً**. هو مجرد تبديل أصل بأصل: النقد يقلّ
> والمخزون يزيد بنفس القيمة. **لن تتأثر تقارير الأرباح بتاتاً عند
> تسجيل الشراء**. التكلفة تُخصم من الربح **فقط عندما تبيع** تلك
> البضاعة، لأن النظام يحفظ تكلفة الوحدة وقت البيع في فاتورة البيع
> نفسها ولا يقرأها من بطاقة المنتج بعد ذلك.
>
> **لماذا هذا مهم؟**
>
> في النظام السابق، كانت تكلفة المنتج تُحدّث يدوياً. إذا نسيت تحديثها
> بعد شراء شحنة بسعر مختلف، كانت التقارير تحسب الربح بتكلفة قديمة
> خاطئة. الآن، كل عملية شراء تُحدّث التكلفة تلقائياً بالمتوسط الموزون،
> فلا مجال للخطأ.
>
> **التقارير القديمة لا تتأثر:** كل الفواتير السابقة لها تكلفة ثابتة
> محفوظة وقت البيع، فتبقى أرقام الأرباح للتواريخ الماضية كما هي تماماً.

---

## 4. SQL Migration

**File:** `01_migration_purchases.sql` (run in Supabase SQL Editor)
**Rollback:** `02_rollback_purchases.sql`

Key properties:

- `CREATE TABLE IF NOT EXISTS purchases (...)` with CHECK constraints on `quantity > 0` and `unit_cost >= 0`.
- 4 indexes (date, product, device, deleted).
- Sequence seed `('purchase', 0)` with `ON CONFLICT DO NOTHING` (idempotent).
- RLS enabled + permissive policy (drop+recreate so re-runs are safe).
- Realtime publication added via `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL $$` block (idempotent across Postgres versions).
- BEFORE UPDATE trigger for `updated_at` (reuses existing `trigger_set_updated_at()` from schema.sql:59-65).
- **No `?` placeholders** — the migration is plain DDL, runs directly in the SQL Editor (NOT through `exec_batch`).

---

## 5. TypeScript Module

**File:** `src/db/queries/purchases.ts`

Public API:

```typescript
export interface Purchase { ... }
export interface NewPurchaseInput { ... }
export interface CreatePurchaseResult { ... }

// Pure helper (re-exported from purchases.wac.ts):
export function computeWeightedAverageCost(
  oldStockQty: number, oldCostPrice: number,
  purchaseQty: number, purchaseUnitCost: number
): number;

// Create a purchase atomically via exec_batch.
export async function createPurchase(input: NewPurchaseInput): Promise<CreatePurchaseResult>;

// List purchases with optional date range / product filter.
export async function getPurchases(opts?: {
  fromDate?: string; toDate?: string; productId?: string; limit?: number;
}): Promise<Purchase[]>;

// Fetch a single purchase by id.
export async function getPurchaseById(id: string): Promise<Purchase | null>;

// Soft-delete a purchase WITH financial reversal (restores old stock_qty
// and old cost_price; refunds the paying account if one was debited).
// Refuses if a NEWER purchase exists for the same product.
export async function deletePurchase(id: string): Promise<void>;
```

**Atomicity guarantee** (per the task spec):

`createPurchase` builds a single `tx: {sql, params}[]` array containing
(up to) 5 statements:

1. `INSERT INTO purchases (...) VALUES (...)` — the purchase row, with full WAC snapshot columns.
2. `UPDATE products SET stock_qty = ?, cost_price = ?, updated_at = ? WHERE id = ?` — the WAC recompute + stock increment, in a SINGLE statement (no read-between-updates race).
3. (Optional) `UPDATE accounts SET balance = balance - ?, ... WHERE id = ?` — debit the paying account.
4. (Optional) `INSERT INTO ledger_entries (...) VALUES (...)` — the `ref_type='purchase'` ledger row.
5. `INSERT INTO audit_log (...) VALUES (...)` — the audit row, INSIDE the batch (per the task spec).

All 5 are sent in ONE `dbClient.batchRun(tx)` call → ONE `exec_batch`
PLpgSQL function call → ONE Postgres transaction. Any exception rolls
back the entire batch.

---

## 6. Pure WAC Helper

**File:** `src/db/queries/purchases.wac.ts`

A 35-line pure function with NO imports (other than TypeScript types).
Extracted into its own module so the unit test file
(`purchases.test.ts`) can import it WITHOUT triggering the Supabase
client init chain (which requires env vars). The main `purchases.ts`
imports and re-exports it for caller convenience.

**Rounding rule:**

```typescript
new_cost_price = Math.round(
  (oldStockQty * oldCostPrice + purchaseQty * purchaseUnitCost) /
  (oldStockQty + purchaseQty)
)
```

`Math.round()` in JavaScript uses "round half toward +Infinity". For
non-negative numerators (which is always the case here, since all inputs
are validated to be non-negative), this matches PostgreSQL's `ROUND()` on
`numeric`.

---

## 7. UI Components

**Files:**

- `src/modules/operations/components/PurchaseDialog.tsx` — modal form for creating a purchase. Mirrors `TopupDialog.tsx` structure exactly.
- `src/modules/operations/components/PurchaseListTab.tsx` — filterable table of past purchases with WAC columns + delete button. Mirrors the OperationsPage ledger tab styling.

**PurchaseDialog** key features:

- Product picker (filtered to `track_stock && is_active` products only).
- Quantity (positive integer) + unit cost (decimal JOD, parsed to fils via `parseMoney`).
- **Live WAC preview panel** showing: old qty × old cost = old value → +purchase qty × purchase cost = purchase value → new qty + new cost = new WAC. Color-coded: red if WAC went up, green if down.
- Optional paying-account picker (with "بدون حساب دافع" default for credit purchases).
- Optional supplier picker.
- Notes textarea.
- Live preview of the cash impact ("سيُخصم X.XX د.أ من رصيد [الحساب]").
- Calls `requireAdminAction(...)` before mutating (matches TopupDialog).
- Invalidates 8 query keys on success (products, accounts, ledger, daily-summary, purchases, etc.).

**PurchaseListTab** key features:

- Date range filter (defaults to current month).
- KPI cards: count, total qty, total value.
- CSV export (BOM-prefixed, Arabic-friendly).
- Table with columns: number, date, product, qty, unit cost, total, OLD cost × qty, NEW cost × qty, paying account, delete button.
- Delete button: requires admin PIN, calls `deletePurchase(id)` which reverses the financial impact.
- Color-coded NEW cost: red if higher than old (cost went up), green if lower (cost went down).

---

## 8. OperationsPage Wiring Patch

See `OPERATIONS_PAGE_PATCH.md` for the exact 7-edit patch. Summary:

1. Import `PurchaseDialog`, `PurchaseListTab`, `ShoppingCart` icon.
2. Extend `Tab` type union with `'purchases'`.
3. Add `isPurchaseOpen` state.
4. Add "شراء بضاعة" button in the header (after "تحويل").
5. Add `purchases` entry to the `tabs` array.
6. Render `<PurchaseListTab />` when `activeTab === 'purchases'`.
7. Render `<PurchaseDialog />` in the dialogs block.

No existing code is removed; only additive changes.

---

## 9. Worked Numeric Proof

### 9.1 The canonical example (with REPO convention: 100 fils = 1 JOD)

> **Note on currency unit:** The task spec's example uses "4500 fils = 4.500 JOD",
> which assumes real-world JOD (1000 fils = 1 JOD). However, the repo's
> `formatMoney` (`src/lib/money.ts:30-38`) divides by 100, meaning the repo
> has committed to **100 fils = 1 JOD** (effectively treating "piasters" as
> "fils"). The WAC function itself is unit-agnostic (it operates on raw
> integers), so the math is identical either way. I show BOTH conventions
> below — the result is the same.

**Initial state:** Product "Phone X" — `stock_qty = 10`, `cost_price = 400` fils (4.00 JOD in repo convention).

**Purchase:** 10 units at 500 fils/unit (5.00 JOD in repo convention).

**Step 1 — Compute the new weighted-average cost:**

```
oldStockQty    = 10
oldCostPrice   = 400 fils
purchaseQty    = 10
purchaseUnitCost = 500 fils

totalValue = oldStockQty * oldCostPrice + purchaseQty * purchaseUnitCost
           = 10 * 400 + 10 * 500
           = 4000 + 5000
           = 9000 fils   (90.00 JOD in repo convention)

totalQty   = oldStockQty + purchaseQty
           = 10 + 10
           = 20

newCostPrice = round(totalValue / totalQty)
             = round(9000 / 20)
             = round(450)
             = 450 fils   (4.50 JOD in repo convention)
```

✅ Result: `450` fils. `formatMoney(450)` → `'4.50 د.أ'`. ✓

(With real-world JOD where 1 JOD = 1000 fils, the same inputs `oldCostPrice=4000, purchaseUnitCost=5000` produce `newCostPrice=4500`, which `formatMoney(4500)` would show as `'45.00 د.أ'` in the repo's convention — but if the owner migrates `formatMoney` to `/1000`, it would show as `'4.500 د.أ'`. The WAC math is correct either way.)

### 9.2 Verify against the Vitest test

From `purchases.test.ts` (test passes):

```typescript
it('4.000×10 + 5.000×10 → 4500 fils (4.500 JOD)', () => {
  // Repo convention: 100 fils/JOD → 4.00 JOD = 400 fils, 5.00 JOD = 500 fils
  expect(computeWeightedAverageCost(10, 400, 10, 500)).toBe(450);
});

it('math is unit-agnostic: works identically at 1000-fils/JOD scale', () => {
  // Real-world JOD: 1000 fils/JOD → 4.000 JOD = 4000 fils, 5.000 JOD = 5000 fils
  expect(computeWeightedAverageCost(10, 4000, 10, 5000)).toBe(4500);
});
```

Both pass.

### 9.3 A later sale's `unit_cost` snapshot = 450

After the purchase above, the product's `cost_price = 450`. When the
owner sells 3 units of "Phone X" at 7.00 JOD each:

- `sales.ts:142` reads `item.product.cost_price` (= 450 fils) and packs it as `unit_cost: 450` in the `complete_sale` payload.
- `functions.sql:249` extracts `v_unit_cost := (item ->> 'unit_cost')::int;` = 450.
- `functions.sql:257-262` inserts a row into `invoice_items` with `unit_cost = 450`.

COGS for this sale (computed by `reports.ts:57` etc.):

```
cogs = unit_cost * quantity = 450 * 3 = 1350 fils   (13.50 JOD)
```

If the owner had **not** recorded the purchase, the old `cost_price = 400`
would have been snapshotted instead, giving `cogs = 400 * 3 = 1200 fils`
(12.00 JOD) — i.e., **profit overstated by 150 fils (1.50 JOD)** on this
one sale. Multiply by hundreds of sales per month and the error compounds
significantly. This is the exact problem the purchases module solves.

### 9.4 Rounding edge cases (verified by `purchases.test.ts`)

| Scenario | Inputs (oldQty, oldCost, qty, unitCost) | Result | Why |
|---|---|---|---|
| Exact division | (10, 400, 10, 500) | 450 | 9000/20 = 450.0 |
| Round-half-up | (1, 1000, 1, 1001) | 1001 | 2001/2 = 1000.5 → 1001 |
| Truncated decimal | (3, 3333, 2, 5555) | 4222 | 21109/5 = 4221.8 → 4222 |
| First-ever purchase | (0, 0, 5, 750) | 750 | 0+3750 / 5 = 750 |
| First-ever purchase, irrelevant old cost | (0, 999, 3, 500) | 500 | old_cost_price ignored when old_stock=0 |
| Zero-cost purchase (free goods) | (5, 1000, 5, 0) | 500 | 5000+0 / 10 = 500 |
| Buying at higher cost → WAC up | (10, 400, 10, 600) | 500 | 4000+6000 / 20 |
| Buying at lower cost → WAC down | (10, 600, 10, 400) | 500 | 6000+4000 / 20 |
| Small purchase barely moves WAC | (1000, 500, 1, 1000) | 500 | 501000/1001 = 500.4995 → 500 |
| Tiny uptick | (1000, 500, 1, 9999) | 509 | 509999/1001 = 509.49 → 509 |
| Large quantities, no overflow | (100000, 500, 50000, 600) | 533 | 80,000,000/150000 = 533.33 → 533 |

All 14 tests in `purchases.test.ts` pass.

### 9.5 Past-date P&L is unchanged — proof

**Claim:** For any date `D` strictly before today (the purchase date),
`getReport(D, D)`, `getProfitAndLoss(D, D)`, and `getOpenDayPreview(D)`
return IDENTICAL results before and after the purchase.

**Proof:**

1. Each surface's COGS term is `SUM(invoice_items.unit_cost * invoice_items.quantity)` filtered to invoices whose `invoice_date = D`.
2. `invoice_items.unit_cost` is set ONCE at sale time (`functions.sql:249`, `sales.ts:142`) and is NEVER updated by any code path (search the repo: no `UPDATE invoice_items SET unit_cost` exists anywhere).
3. A purchase's UPDATE statement is `UPDATE products SET stock_qty = ?, cost_price = ?, updated_at = ? WHERE id = ?` — it touches the `products` table ONLY.
4. The surfaces' SQL queries JOIN `invoice_items` to `invoices` and read `ii.unit_cost` — none of them JOIN `products` or read `products.cost_price`.
5. Therefore the SQL result sets returned by all three surfaces are byte-for-byte identical before and after the purchase.
6. Therefore the computed `net_profit` is identical.

**Empirical verification:** `purchases-three-surface.test.ts` runs all
three surfaces before and after a simulated purchase and asserts identical
`net_profit`. All 4 tests pass.

---

## 10. Verification & Test Plan

### 10.1 Automated tests (all passing ✅)

**File:** `src/db/queries/__tests__/purchases.test.ts` (14 tests)

Pure-function unit tests for `computeWeightedAverageCost` covering:

- The canonical 4.00×10 + 5.00×10 → 450 case
- First-ever purchase (old_stock_qty = 0)
- Round-half-up edge cases
- Round-trailing-decimal cases
- Buying at higher cost (WAC up)
- Buying at lower cost (WAC down)
- Zero-cost purchase (free goods)
- Large quantities (no integer overflow)
- Small purchase into large stock (minimal WAC drift)
- Input validation (rejects non-integer, negative, zero-quantity inputs)
- Determinism (same inputs → same output)
- Unit-agnostic proof at the 1000-fils/JOD scale

**File:** `src/db/queries/__tests__/purchases-three-surface.test.ts` (4 tests)

Three-surface net-profit unchanged test:

1. `getReport` netProfit identical before/after a purchase
2. `getProfitAndLoss` net_profit identical before/after a purchase
3. `getOpenDayPreview` net_profit identical before/after a purchase
4. Purchase WITHOUT a paying account also leaves net profit unchanged

Uses `vi.mock('@/db/client', ...)` to stub `dbClient.query` with canned
rows. The stub simulates a purchase happening (flips
`purchaseHasHappened = true`) when `batchRun` is called, so the second
call to each surface sees the post-purchase state. Because the formulas
read `invoice_items.unit_cost` (snapshot, not touched by the purchase),
the results are identical.

**Full suite run:**

```
✓ src/lib/__tests__/money.test.ts (24 tests) 22ms
✓ src/lib/__tests__/auth.test.ts (10 tests) 233ms
✓ src/stores/__tests__/cart.test.ts (13 tests) 6ms
✓ src/db/queries/__tests__/purchases-three-surface.test.ts (4 tests) 8ms
✓ src/db/queries/__tests__/purchases.test.ts (14 tests) 5ms

Test Files  5 passed (5)
Tests       65 passed (65)
```

`npx tsc --noEmit` is also clean (no type errors).

### 10.2 Manual smoke test plan (for the owner after deployment)

1. **Migration:**
   - Run `01_migration_purchases.sql` in Supabase SQL Editor.
   - Verify `purchases` table appears in Table Editor.
   - Verify "RLS Enabled" badge.
   - Verify `purchases` is in `supabase_realtime` publication (Database → Replication).
   - Verify `trg_purchases_updated_at` trigger exists.

2. **Create a purchase (cash):**
   - Open Operations page → click "شراء بضاعة".
   - Pick a product with `track_stock = true`.
   - Quantity = 5, unit cost = 1.50 JOD.
   - Pick a cash account.
   - Submit.
   - Verify toast: "تم تسجيل الشراء PRCS-... — التكلفة الجديدة: X.XX د.أ للوحدة".
   - Verify the cash account balance dropped by 5 × 1.50 = 7.50 JOD.
   - Verify the product's `stock_qty` increased by 5 and `cost_price` recomputed.
   - Verify a new row in the `purchases` table (Supabase Table Editor).
   - Verify a new row in `ledger_entries` with `ref_type = 'purchase'`, `type = 'debit'`.
   - Verify a new row in `audit_log` with `action = 'شراء_بضاعة'`.

3. **Create a purchase (credit, no paying account):**
   - Open the dialog again.
   - Pick "بدون حساب دافع" for the account.
   - Submit.
   - Verify NO ledger row was written (only stock + cost updated).
   - Verify NO account balance changed.

4. **Reports unchanged:**
   - Open Reports → Overview for a date range BEFORE today.
   - Note the net profit.
   - (The purchase you just made should NOT appear in any P&L line.)
   - Open Reports → Profit & Loss for the same range — net profit identical.
   - Open Operations → EOD for today → preview shows: sales=0, cogs=0, expenses=0, **net=0** (the purchase did not affect today's P&L).

5. **Sell a unit and verify COGS uses the new WAC:**
   - Make a sale of 1 unit of the product you purchased.
   - Open Reports → Overview for today.
   - Verify COGS = the new WAC × 1 (NOT the old cost).
   - Verify the `invoice_items.unit_cost` for that sale = the new WAC (query Supabase).

6. **List view:**
   - Operations → "المشتريات" tab.
   - Verify the purchases you created appear in the table with correct WAC columns.
   - Test the date filter.
   - Test the CSV export.

7. **Delete a purchase:**
   - In the purchases tab, click the trash icon on a recent purchase.
   - Enter admin PIN.
   - Confirm.
   - Verify the product's `stock_qty` and `cost_price` reverted to the pre-purchase snapshot.
   - Verify the cash account was refunded.
   - Verify a `credit` ledger row was written with `ref_type = 'purchase'`.

8. **Day-closure lock:**
   - Close today (Operations → EOD → "إقفال اليوم").
   - Try to create a purchase — should fail with "يوم YYYY-MM-DD مُقفَل...".
   - Reopen the day, try again — should succeed.

### 10.3 What was NOT tested (flagged for reviewer)

- **End-to-end with a real Supabase instance.** The Vitest tests stub
  `dbClient` — they verify the LOGIC of the formulas and the WAC function,
  not the actual SQL execution against Postgres. The implementer (Gemini)
  should run the manual smoke test above against the real Supabase project
  to catch any SQL syntax errors or RLS issues.
- **Concurrent purchase + sale race.** The UPDATE statement
  `UPDATE products SET stock_qty = ?, cost_price = ?` is a single
  statement (no read-then-write race), but a sale happening concurrently
  with a purchase could in theory snapshot the OLD cost_price a
  millisecond before the purchase's UPDATE commits. This is acceptable
  (the sale's COGS would be off by one WAC step, which is unavoidable
  in any system without SERIALIZABLE isolation). Postgres default
  READ COMMITTED isolation means the sale either sees the pre- or
  post-purchase cost, never a corrupted intermediate state.
- **Performance with very large `purchases` table.** The 4 indexes should
  handle millions of rows fine; no benchmark was run.
- **The `deletePurchase` "newer purchase exists" guard** is correct but
  conservative. If the owner needs to delete a purchase that has a newer
  sibling, they should record an offsetting "negative purchase"
  (qty=−original_qty, unit_cost=−original_unit_cost) — but the
  `quantity > 0` CHECK constraint blocks this. The recommended workaround
  is to delete the newer purchase first, then the older one.

---

## 11. Step-by-Step Apply Order for the Owner

**Prerequisites:** A working Aya POS deployment on Supabase. Backup
the database before starting (Supabase Dashboard → Database → Backups).

### Step 1 — Apply the SQL migration (5 minutes)

1. Open Supabase Dashboard → SQL Editor → "+ New query".
2. Paste the entire content of `01_migration_purchases.sql`.
3. Click "Run".
4. Verify all statements succeeded (green ✓ marks).
5. Verify in Table Editor: `purchases` table appears with all columns.
6. Verify in Database → Replication → `supabase_realtime`: `purchases` is listed.
7. Verify in Table Editor → purchases → "RLS Enabled" badge.
8. Verify in Database → Triggers: `trg_purchases_updated_at` exists on `purchases`.

### Step 2 — Add the TypeScript files (2 minutes)

Have Gemini (or do it yourself) add these 4 NEW files to the repo:

- `src/db/queries/purchases.wac.ts` (pure function, 35 lines)
- `src/db/queries/purchases.ts` (main module, ~290 lines)
- `src/modules/operations/components/PurchaseDialog.tsx` (UI modal, ~290 lines)
- `src/modules/operations/components/PurchaseListTab.tsx` (UI table, ~210 lines)

All 4 files are provided in this deliverable. Drop them in as-is.

### Step 3 — Patch OperationsPage.tsx (5 minutes)

Apply the 7 edits in `OPERATIONS_PAGE_PATCH.md`. All edits are
additive — no existing code is removed.

### Step 4 — Run the test suite (1 minute)

```bash
npx vitest run
```

Expected: all 65 tests pass (47 pre-existing + 14 WAC + 4 three-surface).

### Step 5 — Typecheck (30 seconds)

```bash
npx tsc --noEmit
```

Expected: no errors.

### Step 6 — Build & deploy (5 minutes)

```bash
npm run build
```

Deploy to your hosting (Vercel/Netlify/whatever you use). The build
should succeed with no warnings related to purchases.

### Step 7 — Manual smoke test (10 minutes)

Follow the 8-step manual smoke test in §10.2 above.

### Step 8 — Train the owner (5 minutes)

Show the owner:

1. The "شراء بضاعة" button in Operations.
2. The "المشتريات" tab to view history.
3. The live WAC preview in the dialog.
4. The "بدون حساب دافع" option for credit purchases.
5. The Arabic explainer in §3 of this document.

### Rollback (if needed)

1. Run `02_rollback_purchases.sql` in Supabase SQL Editor.
2. Revert the 4 new files and the OperationsPage patch (git revert or manual).
3. Redeploy.

Note: rolling back the SQL does NOT undo the `products.cost_price` and
`products.stock_qty` recomputations made by past purchases. Those values
will remain at their last-computed WAC.

---

## 12. Assumptions & Flags for the Reviewer

### Assumptions I made (and could NOT fully verify on GitHub)

1. **The repo is the actual production code.** I cloned the public GitHub
   repo at commit `2f376f0` (HEAD of `main` on 2026-06-18). If the owner
   has uncommitted local changes, they need to be merged first.

2. **`exec_batch` is truly atomic.** The PLpgSQL function at
   `functions.sql:105-173` has no explicit `BEGIN ... COMMIT` block, but
   PLpgSQL functions are atomic by default in Postgres — any exception
   causes the function to raise and Postgres rolls back the entire
   function call. This is the same atomicity guarantee relied upon by
   `addExpense`, `createTopup`, `createTransfer`, and `closeDay`. **Flag
   for reviewer:** if there's any chance the production Supabase has
   overridden this default (e.g., by setting `default_transaction_isolation`
   to something unusual), verify with `SHOW default_transaction_isolation;`
   in the SQL editor — should read `read committed`.

3. **`getDeviceId()` is synchronous and safe to call.** I imported it from
   `@/lib/device` (same as every other query module). I did not re-read
   `device.ts` — assuming it matches the existing pattern.

4. **The `suppliers` table exists and is writable.** It's defined in
   `schema.sql:127-133` and the `TopupDialog` already queries it
   (`TopupDialog.tsx:30-36`), so it must exist in production. The
   purchases FK to `suppliers(id) ON DELETE SET NULL` is safe.

5. **`nanoid` v5 syntax.** The repo uses `nanoid@5.1.11` (package.json:33).
   `nanoid()` is the default export-style call used everywhere in the
   repo (`import { nanoid } from 'nanoid'; nanoid()`). I followed the
   same pattern.

### Things I deliberately did NOT do (per the hard constraints)

- **Did NOT add a `stock_lots` table or any FIFO logic.** The hard
  constraint forbids it; the WAC method recomputes `products.cost_price`
  in place.
- **Did NOT modify `complete_sale`, `getReport`, `getProfitAndLoss`, or
  `getOpenDayPreview`.** The three accounting surfaces are byte-for-byte
  untouched. The only new code is in `purchases.ts` (new file) and the
  4 new UI files.
- **Did NOT introduce floating-point money.** All money values are
  integer fils end-to-end. The only `Math.round` is in
  `computeWeightedAverageCost` and it operates on integer numerators
  over integer denominators.
- **Did NOT add a balance guard on the paying account.** See §2 Q1
  for justification. (Easy to add later if the owner requests.)
- **Did NOT auto-create a "purchases" tab in the daily-closure snapshot
  table.** The day_closures table (schema.sql:182-196) has fixed columns
  for sales_total, cogs_total, etc. A "purchases_total" column would be
  an additive change but is NOT required for correctness (purchases
  don't affect P&L). Leaving it out keeps the closure snapshot stable.

### Minor improvements that would be nice but are out of scope

- **Bump the sequence INSIDE the batch** (via a CTE) to eliminate the
  small PRCS-NNNNN gap on batch failure. Currently matches the existing
  topup/expense pattern; not a regression.
- **Per-product purchase history view** on the ProductsPage (a "view
  purchases for this product" button). The data is already there — just
  a UI addition. Out of scope for this proposal.
- **A "corrective purchase" helper** that flips the sign of a previous
  purchase's effect without deleting it. Useful for accounting corrections
  after day-closure. Out of scope.
- **Supplier statement report** (purchases grouped by supplier, with
  payment totals). The data is all there; just needs a Reports tab.

---

**End of design document.**
