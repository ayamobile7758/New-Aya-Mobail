# AYA POS — Master Fix Plan (Phased Execution)

**Date:** 2026-06-15
**Repository:** https://github.com/ayamobile7758/New-Aya-Mobail
**Base Commit:** `5383b2e3dad4322111c84f7611121908a3d4210f`
**Target Branch:** `claude/review-pos-system-AbUPJ`
**Total Issues:** 21 (4 Critical, 6 High, 5 Medium, 6 Low)
**Total Phases:** 6 implementation + 1 reporting protocol

---

## How to Use This Document

This plan is **phased by file scope** — each phase groups all changes that touch the same file(s) so the implementer never edits a file twice. Execute phases **in order**. After each phase:

1. Implementer runs the phase's manual verification.
2. Implementer fills the **Phase Completion Report** (template at §7).
3. Owner shows the report to the reviewer (Claude).
4. Reviewer approves or requests changes.
5. Only after approval → move to next phase.

**Critical rule:** Do NOT skip phases. Do NOT batch multiple phases in one commit. Each phase = one commit on the target branch.

---

## Business Context (constraints on every fix)

- **Single-shop, single-owner** trust model — owner uses the system; customer never touches it
- **Android-only** deployment — drop all iOS-specific concerns
- **1–5 tablets**, same WiFi, single Supabase project
- **No tax, no customer accounts, no credit sales**
- **Money:** integer fils, 100 fils = 1 JOD (NOT ISO-4217 1000)
- **Returns:** amount-based only (full or partial)
- **PIN:** PBKDF2, 15-min admin session
- **Realtime sync** via Supabase channels

---

## Severity Matrix (all 21 issues)

| ID | File:Line | Phase | Severity | Description |
|----|-----------|-------|----------|-------------|
| CR-A | closures.ts:184-187 | 1 | 🔴 Critical | reopenDay doesn't reverse reconciliation |
| CR-B | closures.ts:75 | 1 | 🔴 Critical | net_profit omits topups/maintenance |
| CR-C | reports.ts:292 | 1 | 🔴 Critical | P&L sales_net ignores returns |
| CR-D | sales.ts:343-351 | 2 | 🔴 Critical | Partial-return COGS leak (DOCUMENTED — design intent) |
| HI-A | sales.ts:51 | 2 | 🟠 High | paidAmount not validated server-side |
| HI-B | CartSidebar.tsx:522 | 3 | 🟠 High | Gift toggle bypasses PIN |
| HI-C | operations.ts:138 | 3 | 🟠 High | Topup profit accepted from client |
| HI-D | sales.ts:168-177 | 2 | 🟠 High | Silent oversell — detection layer |
| HI-E | maintenance.ts:136-142 | 3 | 🟠 High | Non-delivered status: no day-closed guard |
| HI-F | supabaseAdapter.ts:67-73 | 5 | 🟠 High | Backup/Restore broken → hide + CSV export |
| ME-A | closures.ts:58 | 1 | 🟡 Medium | returnsRow variable name misleading |
| ME-B | cart.store.ts:225-232 | 6 | 🟡 Medium | Discount distribution comment |
| ME-C | sales.ts:218 | 2 | 🟡 Medium | enrichedDetail uses /100 instead of formatMoney |
| ME-D | expenses.ts | 4 | 🟡 Medium | deleteExpense/restoreExpense missing |
| ME-E | closures.ts:127,140,171-174 | 1 | 🟡 Medium | /100 instead of formatMoney in reconciliation |
| LO-A | POSPage.tsx:31 | 6 | 🟢 Low | Hard-coded w-[360px] |
| LO-B | Shell.tsx:79-103 | 6 | 🟢 Low | Admin badge inline styles |
| LO-C | ReceiptOverlay.tsx:58 | 6 | 🟢 Low | Orphan transform class |
| LO-D | money.ts:43 | 6 | 🟢 Low | parseMoney doesn't normalize ٠-٩ |
| LO-E | cart.store.ts persistence | 6 | 🟢 Low | localStorage quota risk (accept) |
| LO-F | audit.ts | 6 | 🟢 Low | Case-sensitive LIKE → ILIKE |

---

## Phase 0 — Pre-flight Setup (mandatory before any code change)

### 0.1 Branch & baseline
```bash
# Ensure clean working tree
git status                      # must show clean
git checkout claude/review-pos-system-AbUPJ
git pull origin claude/review-pos-system-AbUPJ
git fetch origin main
git merge origin/main            # bring in 5383b2e (Supabase routing)

# Sanity: confirm commit
git log -1 --oneline             # expected: 5383b2e or descendant
```

### 0.2 Baseline checks
```bash
npm install
npm run typecheck                # must pass before any edit
npm run lint || true             # record any existing warnings
```

### 0.3 Document baseline
Implementer records in Phase 0 report:
- Current commit SHA at start
- `npm run typecheck` output (pass/fail)
- Number of existing test files (`find . -name "*.test.ts" -o -name "*.spec.ts" | wc -l`)
- Any pre-existing failures

### 0.4 No code change in Phase 0
This phase is purely environmental.

---

## Phase 1 — Financial Core (`closures.ts` + `reports.ts`)

**Scope:** All Critical financial corrections + medium tidy-ups in same files.
**Files touched:** `src/db/queries/closures.ts`, `src/db/queries/reports.ts`, **new migration**
**Issues fixed:** CR-A, CR-B, CR-C, ME-A, ME-E (5 issues)
**Estimated effort:** 4–6 hours

### 1.1 SQL Migration — `013_add_topup_maintenance_to_closures.sql`

Create file: `src/db/migrations/013_add_topup_maintenance_to_closures.sql`

```sql
-- Phase 1 migration: extend day_closures with topup/maintenance and fix net_profit formula

ALTER TABLE day_closures ADD COLUMN topup_profit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE day_closures ADD COLUMN maintenance_revenue INTEGER NOT NULL DEFAULT 0;

-- Backfill existing closures with correct values
UPDATE day_closures SET
  topup_profit = COALESCE((
    SELECT SUM(profit) FROM topups WHERE topup_date = day_closures.closure_date
  ), 0),
  maintenance_revenue = COALESCE((
    SELECT SUM(final_amount) FROM maintenance_jobs
    WHERE status = 'delivered' AND DATE(delivered_at) = day_closures.closure_date
  ), 0),
  net_profit = sales_total - cogs_total
             + COALESCE((SELECT SUM(profit) FROM topups WHERE topup_date = day_closures.closure_date), 0)
             + COALESCE((SELECT SUM(final_amount) FROM maintenance_jobs
                         WHERE status = 'delivered' AND DATE(delivered_at) = day_closures.closure_date), 0)
             - expenses_total;
```

**For Supabase**, also paste this in SQL Editor (same SQL works for PostgreSQL — only syntax difference is the `ALTER TABLE` which is identical).

### 1.2 Code changes — `src/db/queries/closures.ts`

**Step A — Update interface (CR-B, top of file):**

```typescript
export interface DayClosureSnapshot {
  closure_date: string;
  closed_at?: string;
  closed_by?: string | null;
  sales_total: number;
  cogs_total: number;
  discounts_total: number;
  gifts_value: number;
  returns_total: number;
  expenses_total: number;
  topup_profit: number;          // NEW
  maintenance_revenue: number;    // NEW
  net_profit: number;
  notes?: string | null;
}
```

**Step B — Add imports (top of file):**

```typescript
import { formatMoney } from '@/lib/money';   // ME-E
```

**Step C — Rewrite `getOpenDayPreview` (CR-B, ME-A):**

Replace the entire function body (currently ~lines 31-87) with:

```typescript
export async function getOpenDayPreview(targetDate: string): Promise<DayClosureSnapshot> {
  const [salesRow] = await dbClient.query(
    `SELECT
       COALESCE(SUM(total_amount), 0)    AS total,
       COALESCE(SUM(discount_amount), 0) AS discounts
     FROM invoices
     WHERE invoice_date = ? AND status = 'active'`,
    [targetDate]
  );

  const [cogsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 0`,
    [targetDate]
  );

  const [giftsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_price * ii.quantity), 0) AS gifts
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 1`,
    [targetDate]
  );

  // ME-A: returns_adjustment = net revenue reduction from returned/partially_returned invoices.
  // For fully returned: paid_amount=0, so this reads total_amount (matches full refund).
  // For partially returned: paid_amount = remaining after refund, so this reads refund amount.
  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS returns_adjustment
     FROM invoices
     WHERE invoice_date = ? AND status IN ('returned', 'partially_returned')`,
    [targetDate]
  );

  const [expRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date = ?`,
    [targetDate]
  );

  // CR-B: include topup profit and maintenance revenue
  const [topupRow] = await dbClient.query(
    `SELECT COALESCE(SUM(profit), 0) AS topup_profit FROM topups WHERE topup_date = ?`,
    [targetDate]
  );

  const [mainRow] = await dbClient.query(
    `SELECT COALESCE(SUM(final_amount), 0) AS maintenance_revenue
     FROM maintenance_jobs
     WHERE status = 'delivered' AND DATE(delivered_at) = ?`,
    [targetDate]
  );

  const sales_total          = Number(salesRow?.total              ?? 0);
  const discounts_total      = Number(salesRow?.discounts          ?? 0);
  const cogs_total           = Number(cogsRow?.cogs                ?? 0);
  const gifts_value          = Number(giftsRow?.gifts              ?? 0);
  const returns_total        = Number(returnsRow?.returns_adjustment ?? 0);
  const expenses_total       = Number(expRow?.expenses             ?? 0);
  const topup_profit         = Number(topupRow?.topup_profit       ?? 0);
  const maintenance_revenue  = Number(mainRow?.maintenance_revenue ?? 0);

  // CR-B: corrected formula
  // sales_total already excludes returned invoices (status='active' filter)
  // cogs_total already excludes gift items (is_gift=0 filter)
  // Therefore: net = (active sales - active COGS) + other income - expenses
  // Do NOT subtract returns_total or gifts_value again — already excluded upstream.
  const net_profit = sales_total - cogs_total + topup_profit + maintenance_revenue - expenses_total;

  return {
    closure_date: targetDate,
    sales_total,
    cogs_total,
    discounts_total,
    gifts_value,
    returns_total,
    expenses_total,
    topup_profit,
    maintenance_revenue,
    net_profit,
  };
}
```

**Step D — Update `closeDay` to persist new columns (CR-B continuation):**

Find the INSERT statement (~line 154) and replace it with:

```typescript
  tx.push({
    sql: `INSERT INTO day_closures
            (closure_date, closed_at, closed_by, sales_total, cogs_total,
             discounts_total, gifts_value, returns_total, expenses_total,
             topup_profit, maintenance_revenue,
             net_profit, notes, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      targetDate, closedAt, null,
      snapshot.sales_total, snapshot.cogs_total, snapshot.discounts_total,
      snapshot.gifts_value, snapshot.returns_total, snapshot.expenses_total,
      snapshot.topup_profit, snapshot.maintenance_revenue,
      snapshot.net_profit, notes || null, deviceId,
    ],
  });
```

**Step E — Update audit detail formatting (ME-E):**

Find the reconciliation description (~line 127) and replace:

```typescript
        const description = `تسوية إقفال يومي: ${acct.name} — الفرق ${diff > 0 ? '+' : ''}${formatMoney(Math.abs(diff))}`;
```

Find the reconciliationDetails push (~line 140) and replace:

```typescript
        reconciliationDetails.push(
          `${acct.name}: ${diff > 0 ? '+' : ''}${formatMoney(Math.abs(diff))}`
        );
```

Find the auditDetail array (~lines 169-178) and replace:

```typescript
  const auditDetail = [
    `تاريخ: ${targetDate}`,
    `مبيعات: ${formatMoney(snapshot.sales_total)}`,
    `تكلفة: ${formatMoney(snapshot.cogs_total)}`,
    `مصاريف: ${formatMoney(snapshot.expenses_total)}`,
    `شحن: ${formatMoney(snapshot.topup_profit)}`,
    `صيانة: ${formatMoney(snapshot.maintenance_revenue)}`,
    `صافي ربح: ${formatMoney(snapshot.net_profit)}`,
    ...(reconciliationDetails.length
      ? [`تسويات نقدية: ${reconciliationDetails.join(', ')}`]
      : []),
  ].join(' — ');
```

**Step F — Rewrite `reopenDay` (CR-A):**

Replace the entire function (currently lines 184-187) with:

```typescript
// ── D2.4 ────────────────────────────────────────────────────────────────────
export async function reopenDay(date: string): Promise<void> {
  // CR-A: must reverse reconciliation entries and restore pre-closure balances
  const reconEntries = await dbClient.query(
    `SELECT id, account_id, type, amount FROM ledger_entries
     WHERE entry_date = ? AND ref_type = 'eod_reconciliation'`,
    [date]
  );

  const tx: { sql: string; params: any[] }[] = [];
  const now = new Date().toISOString();

  // For each reconciliation entry, reverse its balance effect
  for (const entry of reconEntries) {
    // Original credit → add to balance → reverse = subtract
    // Original debit → subtract from balance → reverse = add
    const op = entry.type === 'credit' ? '-' : '+';
    tx.push({
      sql: `UPDATE accounts SET balance = balance ${op} ?, updated_at = ? WHERE id = ?`,
      params: [entry.amount, now, entry.account_id],
    });
  }

  // Delete the reconciliation ledger rows
  if (reconEntries.length > 0) {
    const ids = reconEntries.map((e: any) => e.id);
    const placeholders = ids.map(() => '?').join(',');
    tx.push({
      sql: `DELETE FROM ledger_entries WHERE id IN (${placeholders})`,
      params: ids,
    });
  }

  // Delete the day_closures row
  tx.push({
    sql: `DELETE FROM day_closures WHERE closure_date = ?`,
    params: [date],
  });

  await dbClient.batchRun(tx);
  await logAudit('فتح_يوم_مقفل', date, 'day_closure', date);
}
```

### 1.3 Code changes — `src/db/queries/reports.ts`

**CR-C only.** Find `getProfitAndLoss` function (~line 231) and modify ONLY these areas:

**Step A — Add partial-refund query after the existing `expRow` query (~line 257):**

After the `expRow` query and BEFORE `expByCatRaw`, insert:

```typescript
  // CR-C: partial refunds (paid_amount reduced via returnInvoice for partials)
  const [partialReturnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'partially_returned'`,
    [fromDate, toDate]
  );
```

**Step B — Fix the `sales_net` calculation (~line 292):**

Replace the line:
```typescript
  const sales_net          = sales_gross;
```

with:
```typescript
  const partial_returns_total = Number(partialReturnsRow?.total ?? 0);
  // CR-C: sales_net deducts both full returns and partial refunds
  const sales_net          = sales_gross - returns_total - partial_returns_total;
```

**Step C — Verify the existing `salesRow` query** at lines 232-238 keeps `status IN ('active', 'partially_returned')` — this is correct because partial returns are still partially completed sales; their `total_amount` represents the original sale value.

**Important note for the implementer about the prior Z.ai "syntax error" claim:**
Z.ai claimed line ~285 has `const ainRow] = await dbClient.query(...)`. This is **FALSE**. The actual code reads `const [mainRow] = await dbClient.query(...)` and is syntactically correct. **Do not "fix" this — there is nothing to fix here.**

### 1.4 Phase 1 Manual Verification

1. **Migration runs cleanly**
   - Run migration 013 on a fresh dev Supabase project: no errors
   - Existing `day_closures` rows get backfilled with `topup_profit`, `maintenance_revenue`, and corrected `net_profit`

2. **CR-A — Reopen reverses reconciliation**
   - Set a cash account balance to 1000 fils
   - Close today's day with `actualCash = 1050` → verify balance becomes 1050 + a credit `eod_reconciliation` row for 50 exists
   - Reopen the day → verify balance is restored to 1000, the reconciliation row is gone, the `day_closures` row is gone

3. **CR-B — net_profit includes topups/maintenance**
   - Create a topup with profit=500, a maintenance delivery with final_amount=3000, a sale (sales=10000, cogs=6000), an expense=2000 on the same day
   - Open the closure preview → verify `net_profit = 10000 - 6000 + 500 + 3000 - 2000 = 5500`

4. **CR-C — P&L deducts returns**
   - Active invoice 10000 + Returned invoice 5000 + Partially returned (total=8000, paid=5000)
   - Run P&L for the date range
   - Expected: `sales_gross = 18000`, `returns_total = 5000`, `partial_returns_total = 3000`, `sales_net = 18000 - 5000 - 3000 = 10000`

5. **ME-A, ME-E — Formatting**
   - Close a day with a reconciliation surplus of 1234500 fils
   - Audit log should show `12,345.00 د.أ` (not `12345`)

6. **No regressions**
   - `npm run typecheck` passes
   - Existing reports still render without crash

### 1.5 Files modified in Phase 1

- `src/db/migrations/013_add_topup_maintenance_to_closures.sql` (NEW)
- `src/db/queries/closures.ts` (modified)
- `src/db/queries/reports.ts` (modified)
- `supabase/schema.sql` — append the same ALTER TABLE statements at the bottom

### 1.6 Commit message
```
fix(financial): correct day-closure profit formula, P&L returns, and reopen reversal

- CR-A: reopenDay now reverses reconciliation ledger entries and restores balances
- CR-B: net_profit includes topup profit and maintenance revenue (migration 013)
- CR-C: P&L sales_net subtracts both full returns and partial refunds
- ME-A: rename returnsRow alias to returns_adjustment with documenting comment
- ME-E: reconciliation audit log uses formatMoney for consistent display
```

---

## Phase 2 — Sales Hardening (`sales.ts`)

**Scope:** All sales.ts changes in one pass.
**Files touched:** `src/db/queries/sales.ts`
**Issues fixed:** CR-D, HI-A, HI-D, ME-C (4 issues)
**Estimated effort:** 2–3 hours

### 2.1 CR-D — Document partial-return design intent

Find the `if (newStatus === 'returned')` block (~line 343) and add a comment block immediately before it:

```typescript
  // ── DESIGN INTENT (2026-06-15) ──────────────────────────────────────────
  // Partial returns are amount-based only. The customer keeps the goods.
  // Stock restoration and COGS reversal happen ONLY on full returns
  // (status='returned'). This is intentional for mobile retail where
  // partial-unit returns do not occur; partial refunds act as
  // "retroactive discount" semantics. See Owner Decision §5.
  // ────────────────────────────────────────────────────────────────────────
  if (newStatus === 'returned') {
    // ... existing stock restoration code unchanged
```

**No functional change.** This is documentation only.

### 2.2 HI-A — Server-side paidAmount validation

Find line 51 (the `paidAmount` reduce):
```typescript
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
```

Immediately after it, insert:
```typescript

  // HI-A: server-side guard against credit sales. Per owner policy: no debt allowed.
  if (paidAmount < totalAmount) {
    throw new Error(
      `المبلغ المدفوع (${formatMoney(paidAmount)}) أقل من إجمالي الفاتورة (${formatMoney(totalAmount)}). البيع الآجل غير مسموح.`
    );
  }
```

### 2.3 HI-D — Oversell detection layer

**Important design decision:** We are **NOT** moving the stock UPDATE outside `batchRun`. Doing so would break atomicity. Instead, we add a **post-batch verification + alert** layer.

**Rationale:** For 1-5 tablets in single trusted shop, true simultaneous oversells are rare. The current code already prevents NEGATIVE stock (via `WHERE stock_qty >= ?` guard). The remaining risk is that an invoice gets created without decrementing stock. Our fix: detect this case and create a flagged audit entry so the owner can reconcile manually.

**Step A — Snapshot expected stock BEFORE batch (around line 162, just before the items loop):**

```typescript
  // HI-D: snapshot expected post-sale stock for tracked items, used for post-batch verification.
  const expectedStockAfter = new Map<string, number>();
  for (const item of cartItems) {
    if (item.product.track_stock) {
      const p = productMap.get(item.product.id);
      if (p) {
        const prev = expectedStockAfter.get(item.product.id) ?? p.stock_qty;
        expectedStockAfter.set(item.product.id, prev - item.quantity);
      }
    }
  }
```

**Step B — Add post-batch verification AFTER `await dbClient.batchRun(stmts);` (~line 211):**

```typescript
  await dbClient.batchRun(stmts);

  // HI-D: post-batch oversell detection. Single-shop trust model: invoice is
  // already recorded (cannot be rolled back without RPC support in Phase 7).
  // Surface a flagged audit entry so the owner can reconcile inventory manually.
  if (expectedStockAfter.size > 0) {
    const ids = Array.from(expectedStockAfter.keys());
    const placeholders = ids.map(() => '?').join(',');
    const actualRows = await dbClient.query(
      `SELECT id, stock_qty FROM products WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of actualRows) {
      const expected = expectedStockAfter.get(row.id);
      if (expected !== undefined && row.stock_qty !== expected) {
        // Stock did not decrement as expected — concurrent sale on another tablet.
        // The current invoice is intact; flag the inventory drift for manual review.
        await logAudit(
          'تنبيه_تجاوز_مخزون',
          `فاتورة ${invoiceNumber} — منتج ${row.id} — متوقع ${expected}, فعلي ${row.stock_qty} — راجع المخزون يدوياً`,
          'invoice',
          invoiceId
        );
      }
    }
  }
```

**Note for implementer:** Do NOT throw — that would crash the cashier after a successful sale. Logging is sufficient for the trust model. A future Phase 7 will replace this with an atomic RPC.

### 2.4 ME-C — Use formatMoney in audit detail

Find line 218:
```typescript
    `فاتورة ${invoiceNumber} — الإجمالي ${totalAmount / 100} د.أ` +
```

Replace with:
```typescript
    `فاتورة ${invoiceNumber} — الإجمالي ${formatMoney(totalAmount)}` +
```

### 2.5 Phase 2 Manual Verification

1. **HI-A**
   - In dev tools, mock a call: `completeSale({ payments: [{ amount: 500 }], totalAmount: 1000, ... })`
   - Expect: Arabic error "المبلغ المدفوع (5.00 د.أ) أقل من إجمالي الفاتورة (10.00 د.أ). البيع الآجل غير مسموح."
   - Normal sale where `paidAmount === totalAmount` still succeeds
   - Overpayment (e.g. paid 12.00 for a 10.00 total) also succeeds — only underpayment is blocked

2. **HI-D**
   - Single-tablet sanity: complete a normal sale; stock decrements; no audit alert
   - To force the alert (manually): in Supabase SQL Editor, just BEFORE pressing "Complete Sale", reduce a tracked product's stock_qty so the WHERE guard fails. Complete the sale. Expect: invoice is created, the audit log shows a `تنبيه_تجاوز_مخزون` entry for that product

3. **ME-C**
   - Complete a sale with total = 123450 fils (1,234.50 د.أ)
   - Audit log entry shows `الإجمالي 1,234.50 د.أ` (not `1234.5` or `12345`)

4. **CR-D**
   - No runtime behavior change. Just confirm the comment block is present.

### 2.6 Commit message
```
fix(sales): paidAmount validation, oversell detection, ME-C formatting, CR-D documentation

- HI-A: reject sales where paid amount is less than invoice total
- HI-D: post-batch verification flags inventory drift via audit alert
- ME-C: enrichedDetail uses formatMoney for consistent display
- CR-D: document partial-return design intent (amount-based, no stock restore)
```

---

## Phase 3 — Authorization & Validation Layer

**Scope:** Admin gates and server-side validation across three files.
**Files touched:** `src/modules/pos/components/CartSidebar.tsx`, `src/db/queries/operations.ts`, `src/db/queries/maintenance.ts`
**Issues fixed:** HI-B, HI-C, HI-E (3 issues)
**Estimated effort:** 1–2 hours

### 3.1 HI-B — Gift toggle behind admin PIN (CartSidebar.tsx)

Find line 522:
```typescript
                      onClick={() => setItemGift(item.cartItemId, !item.isGift)}
```

Replace with:
```typescript
                      onClick={() => requireAdminAction(() => setItemGift(item.cartItemId, !item.isGift))}
```

No other changes in this file. `requireAdminAction` and `setItemGift` are already imported and available in this component.

### 3.2 HI-C — Topup profit computed server-side (operations.ts)

Find the `createTopup` signature (~line 126):

```typescript
export async function createTopup({
  account_id,
  supplier_id,
  amount,
  cost,
  profit,
  notes
}: {
  account_id: string;
  supplier_id?: string;
  amount: number;
  cost: number;
  profit: number;
  notes?: string;
}) {
```

Replace it with:
```typescript
export async function createTopup({
  account_id,
  supplier_id,
  amount,
  cost,
  notes
}: {
  account_id: string;
  supplier_id?: string;
  amount: number;
  cost: number;
  notes?: string;
}) {
  // HI-C: compute profit server-side; never trust client value
  const profit = amount - cost;
```

The `const profit` declaration above replaces the destructured `profit` from the parameter list. All downstream uses of `profit` work unchanged. The rest of the function remains identical.

**Note:** Calling code in the UI should also be updated to **stop passing** the `profit` field. Check for usages:
```bash
grep -rn "createTopup\s*(" src/
```
For each call site, remove the `profit:` field from the object (it's now ignored, but leaving it is type-safe; removing it is cleaner). If TypeScript complains because callers still send `profit`, leave the optional parameter:

```typescript
}: {
  account_id: string;
  supplier_id?: string;
  amount: number;
  cost: number;
  profit?: number;   // ignored, kept for backwards compatibility with callers
  notes?: string;
}) {
  const profit = amount - cost;
```

### 3.3 HI-E — Day-closed guard for all maintenance status changes (maintenance.ts)

Find `updateJobStatus` (~line 90). The current structure is:
```typescript
export async function updateJobStatus(id: string, status: ..., final_amount?, payment_account_id?) {
  const now = ...
  const dateStr = ...
  const onlyDateStr = format(now, 'yyyy-MM-dd');
  const deviceId = ...

  if (status === 'delivered') {
    // ... validations including isDayClosed
    // ... financial batch
  } else {
    // No isDayClosed check ← BUG
    await dbClient.run(...)
  }
}
```

Replace the body **after the variable declarations** with:

```typescript
  // HI-E: any status mutation that touches a closed day's row corrupts the snapshot.
  // Apply the guard universally — not only on delivery.
  if (await isDayClosed(onlyDateStr)) {
    throw new Error(`يوم ${onlyDateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  if (status === 'delivered') {
    if (final_amount === undefined || !payment_account_id) {
        throw new Error('Final amount and account are required for delivery');
    }

    // منع التسليم المزدوج
    const current = await dbClient.query('SELECT status, job_number FROM maintenance_jobs WHERE id = ?', [id]);
    if (!current.length) throw new Error('المهمة غير موجودة');
    if (current[0].status === 'delivered') {
      throw new Error('تم تسليم هذه المهمة مسبقاً');
    }

    const job_number = current[0].job_number || '';

    const accountResult = await dbClient.query("SELECT name FROM accounts WHERE id = ?", [payment_account_id]);
    const account_name = accountResult[0]?.name || null;

    const tx = [
      {
        sql: `UPDATE maintenance_jobs SET status = ?, updated_at = ?, delivered_at = ?, final_amount = ?, payment_account_id = ? WHERE id = ?`,
        params: [status, dateStr, dateStr, final_amount, payment_account_id, id]
      },
      {
        sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
        params: [final_amount, dateStr, payment_account_id]
      },
      {
        sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [nanoid(), onlyDateStr, payment_account_id, account_name, 'credit', final_amount, 'maintenance', id, `إيراد صيانة: ${job_number}`, dateStr, dateStr, deviceId]
      }
    ];
    await dbClient.batchRun(tx);

    await logAudit('تسليم_صيانة', `تسليم مهمة ${job_number} بمبلغ ${formatMoney(final_amount)}`, 'maintenance', id);
  } else {
    // Non-delivered status change — guard above already ran
    await dbClient.run(
      `UPDATE maintenance_jobs SET status = ?, updated_at = ? WHERE id = ?`,
      [status, dateStr, id]
    );
  }
```

The key change is that `isDayClosed` is now checked **once at the top**, applying to BOTH branches.

### 3.4 Phase 3 Manual Verification

1. **HI-B**
   - Open POS, add a product. Tap the gift toggle button → admin PIN dialog appears
   - Cancel → item remains non-gift
   - Re-tap, enter correct PIN → item flips to gift; admin badge appears in TopBar
   - Within 15-min admin session → toggling other items' gift state should NOT re-prompt

2. **HI-C**
   - Call `createTopup({ amount: 1000, cost: 800, profit: 99999 })` from a test
   - Verify: the inserted `topups` row has `profit = 200` (= 1000 - 800), NOT 99999
   - P&L `topup_profit` matches the correct amount

3. **HI-E**
   - Create a maintenance job on yesterday's date
   - Close yesterday's day
   - Try to change the job status to `cancelled` (or any non-delivered status)
   - Expect: Arabic error "يوم YYYY-MM-DD مُقفَل..."
   - Reopen yesterday → status change now succeeds

### 3.5 Commit message
```
fix(auth/validation): gift PIN gate, server-side topup profit, universal day-closed guard

- HI-B: gift toggle now requires admin PIN (matches price-override pattern)
- HI-C: createTopup computes profit server-side; client profit value ignored
- HI-E: maintenance status changes (all branches) now check isDayClosed
```

---

## Phase 4 — Expense Lifecycle (`expenses.ts` + UI integration)

**Scope:** Implement soft-delete + restore for expenses with full financial reversal.
**Files touched:** `src/db/queries/expenses.ts`, expense settings page, trash tab
**Issues fixed:** ME-D (1 issue, but multi-step)
**Estimated effort:** 2–3 hours

### 4.1 Add imports to `expenses.ts`

At the top of the file, after existing imports, add:

```typescript
import { formatMoney } from '@/lib/money';
```

### 4.2 Add `deleteExpense` function

Append to `expenses.ts` (after `getFilteredExpenses`):

```typescript
// ── Soft-delete an expense with full financial reversal ─────────────────────
// ME-D: gated by admin PIN at the UI layer. Credits the account back, writes
// a reversing ledger entry, and marks the row as deleted_at.
export async function deleteExpense(id: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) throw new Error('المصروف غير موجود أو محذوف مسبقاً');
  const exp = rows[0];

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Mark expense as deleted
  tx.push({
    sql: `UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    params: [now, now, id],
  });

  if (exp.account_id) {
    // 2. Credit the account back by the expense amount
    tx.push({
      sql: `UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      params: [exp.amount, now, exp.account_id],
    });

    // 3. Reverse ledger entry
    tx.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount,
               ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, exp.account_id, exp.account_name,
        'credit', exp.amount, 'expense', id,
        `حذف مصروف: ${exp.expense_number} — ${exp.description}`,
        now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(tx);
  await logAudit(
    'حذف_مصروف',
    `${exp.expense_number} — ${formatMoney(exp.amount)} — ${exp.description}`,
    'expense', id
  );
}
```

### 4.3 Add `restoreExpense` function

Append after `deleteExpense`:

```typescript
// ── Restore a soft-deleted expense — re-applies financial impact ────────────
// ME-D: includes a balance check before debiting the account so we never
// create a negative balance via restore.
export async function restoreExpense(id: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT * FROM expenses WHERE id = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  if (!rows.length) throw new Error('المصروف غير موجود أو غير محذوف');
  const exp = rows[0];

  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }

  // ME-D safety check (our addition over Z.ai): verify the account still has
  // enough balance before debiting. Otherwise restore creates a negative balance.
  if (exp.account_id) {
    const acctRows = await dbClient.query(
      `SELECT balance, name FROM accounts WHERE id = ?`,
      [exp.account_id]
    );
    if (!acctRows.length) {
      throw new Error('الحساب المرتبط بالمصروف لم يعد موجوداً');
    }
    if (acctRows[0].balance < exp.amount) {
      throw new Error(
        `الرصيد غير كافٍ في ${acctRows[0].name} لإعادة هذا المصروف ` +
        `(المطلوب: ${formatMoney(exp.amount)}, المتاح: ${formatMoney(acctRows[0].balance)})`
      );
    }
  }

  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const tx: { sql: string; params: any[] }[] = [];

  // 1. Clear deleted_at
  tx.push({
    sql: `UPDATE expenses SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    params: [now, id],
  });

  if (exp.account_id) {
    // 2. Re-debit the account
    tx.push({
      sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
      params: [exp.amount, now, exp.account_id],
    });

    // 3. Re-apply ledger entry
    tx.push({
      sql: `INSERT INTO ledger_entries
              (id, entry_date, account_id, account_name, type, amount,
               ref_type, ref_id, description, created_at, updated_at, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nanoid(), today, exp.account_id, exp.account_name,
        'debit', exp.amount, 'expense', id,
        `استعادة مصروف: ${exp.expense_number} — ${exp.description}`,
        now, now, deviceId,
      ],
    });
  }

  await dbClient.batchRun(tx);
  await logAudit(
    'استعادة_مصروف',
    `${exp.expense_number} — ${formatMoney(exp.amount)}`,
    'expense', id
  );
}
```

### 4.4 Add `getDeletedExpenses` helper

Append:

```typescript
// ── Trash listing for the Settings → Trash tab ─────────────────────────────
export async function getDeletedExpenses(): Promise<Expense[]> {
  const results = await dbClient.query(
    `SELECT * FROM expenses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return results as Expense[];
}
```

### 4.5 UI integration — Expense list page

Find the expenses list component (likely in `src/modules/expenses/`). For each expense row, add a delete button:

```typescript
import { deleteExpense } from '@/db/queries/expenses';
import { useAuth } from '@/contexts/AuthContext';

// inside component:
const { requireAdminAction } = useAuth();

// inside row render:
<button
  onClick={() => requireAdminAction(async () => {
    if (!confirm('هل أنت متأكد من حذف هذا المصروف؟ سيتم إرجاع المبلغ للحساب.')) return;
    try {
      await deleteExpense(expense.id);
      // refetch or invalidate query
    } catch (e: any) {
      alert(e.message);
    }
  })}
  className="..."
  aria-label="حذف"
>
  <Trash2 className="w-4 h-4" />
</button>
```

The exact JSX depends on existing styling — implementer follows the existing pattern for the products delete button as a reference.

### 4.6 UI integration — Trash tab (Settings)

Find the existing Trash tab in Settings (added in commit `42311ad`). Add a section for deleted expenses:

```typescript
import { getDeletedExpenses, restoreExpense } from '@/db/queries/expenses';

// add a section similar to existing deleted products section
// list items from getDeletedExpenses() with a "Restore" button per row
// on restore: requireAdminAction(() => restoreExpense(id))
```

### 4.7 Phase 4 Manual Verification

1. **Delete flow**
   - Create an expense of 100 د.أ from cash account (balance was 500)
   - Verify account balance now 400
   - Delete the expense → admin PIN dialog → enter PIN
   - Verify account balance restored to 500
   - Verify a `credit` ledger entry with description "حذف مصروف: ..." exists
   - Verify expense is hidden from the regular list but appears in Trash tab

2. **Restore flow — sufficient balance**
   - Spend cash so balance is 500 (e.g. no further activity)
   - Open Trash → restore the expense → admin PIN dialog → enter PIN
   - Verify balance is 400 again
   - Verify a `debit` ledger entry with description "استعادة مصروف: ..." exists

3. **Restore flow — insufficient balance (the safety check)**
   - Spend cash so balance is 50
   - Try restoring the 100 د.أ expense
   - Expect Arabic error: "الرصيد غير كافٍ في ... لإعادة هذا المصروف (المطلوب: 100.00 د.أ, المتاح: 0.50 د.أ)"
   - Expense remains deleted, no balance change

4. **Day-closed guard**
   - Close today's day
   - Try to delete an expense → error about closed day
   - Try to restore a deleted expense → error about closed day

5. **Reports consistency**
   - Deleted expenses are excluded from `getFilteredExpenses` (already filtered by `WHERE deleted_at IS NULL`)
   - P&L `expenses_total` reflects only non-deleted expenses

### 4.8 Commit message
```
feat(expenses): soft-delete + restore with full financial reversal

- ME-D: implement deleteExpense / restoreExpense / getDeletedExpenses
- Both functions reverse the account balance and write reversing ledger entries
- restoreExpense includes balance check to prevent negative balances
- Both gated by isDayClosed guard
- UI: delete button on expense rows + restore button in Trash tab
- All admin actions go through requireAdminAction
```

---

## Phase 5 — Backup → CSV Export (`supabaseAdapter.ts` + new module + Reports page)

**Scope:** Hide non-functional backup UI; add proper CSV export.
**Files touched:** `src/db/supabaseAdapter.ts`, NEW `src/lib/csv-export.ts`, settings page, reports page
**Issues fixed:** HI-F (1 issue, multi-part)
**Estimated effort:** 2–3 hours

### 5.1 Detect Supabase mode

Add a runtime flag (if not already present):

```typescript
// src/db/adapter.ts (or wherever the adapter is selected)
export const isSupabaseMode = (): boolean => {
  return !!import.meta.env.VITE_SUPABASE_URL;
};
```

### 5.2 Hide backup UI in Supabase mode

In the Settings page where backup/restore buttons live, wrap them:

```typescript
import { isSupabaseMode } from '@/db/adapter';

// in render:
{!isSupabaseMode() && (
  <section>
    {/* existing backup/restore buttons */}
  </section>
)}

{isSupabaseMode() && (
  <section className="p-4 bg-muted rounded-lg">
    <p className="text-sm text-text-secondary">
      بياناتك محفوظة تلقائياً على خوادم Supabase. للحصول على نسخة من بياناتك،
      استخدم أزرار "تصدير CSV" في صفحة التقارير.
    </p>
  </section>
)}
```

### 5.3 Create CSV export module

Create new file: `src/lib/csv-export.ts`

```typescript
import { dbClient } from '@/db/client';

function toCSVRow(fields: (string | number | null)[]): string {
  return fields.map(f => {
    if (f === null || f === undefined) return '';
    const s = String(f);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }).join(',');
}

function downloadCSV(filename: string, content: string): void {
  const bom = '﻿';  // BOM for Excel UTF-8 detection
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatFils(fils: number | null | undefined): string {
  if (fils === null || fils === undefined) return '';
  return (fils / 100).toFixed(2);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export async function exportInvoicesCSV(fromDate: string, toDate: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT invoice_number, invoice_date, subtotal, discount_amount,
            total_amount, paid_amount, status, created_at
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
     ORDER BY invoice_date ASC, created_at ASC`,
    [fromDate, toDate]
  );
  const header = 'رقم الفاتورة,التاريخ,المجموع الفرعي,الخصم,الإجمالي,المدفوع,الحالة,تاريخ الإنشاء';
  const csv = rows.map((r: any) => toCSVRow([
    r.invoice_number, r.invoice_date,
    formatFils(r.subtotal), formatFils(r.discount_amount),
    formatFils(r.total_amount), formatFils(r.paid_amount),
    r.status, r.created_at,
  ]));
  downloadCSV(`AYA_invoices_${fromDate}_${toDate}_${timestamp()}.csv`, [header, ...csv].join('\r\n'));
}

export async function exportExpensesCSV(fromDate: string, toDate: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT expense_number, expense_date, category_name, account_name, amount, description
     FROM expenses
     WHERE expense_date BETWEEN ? AND ? AND deleted_at IS NULL
     ORDER BY expense_date ASC`,
    [fromDate, toDate]
  );
  const header = 'رقم المصروف,التاريخ,الفئة,الحساب,المبلغ,الوصف';
  const csv = rows.map((r: any) => toCSVRow([
    r.expense_number, r.expense_date, r.category_name, r.account_name,
    formatFils(r.amount), r.description,
  ]));
  downloadCSV(`AYA_expenses_${fromDate}_${toDate}_${timestamp()}.csv`, [header, ...csv].join('\r\n'));
}

export async function exportTopupsCSV(fromDate: string, toDate: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT topup_number, topup_date, account_name, supplier_name, amount, cost, profit
     FROM topups
     WHERE topup_date BETWEEN ? AND ?
     ORDER BY topup_date ASC`,
    [fromDate, toDate]
  );
  const header = 'رقم الشحن,التاريخ,الحساب,المورّد,المبلغ,التكلفة,الربح';
  const csv = rows.map((r: any) => toCSVRow([
    r.topup_number, r.topup_date, r.account_name, r.supplier_name,
    formatFils(r.amount), formatFils(r.cost), formatFils(r.profit),
  ]));
  downloadCSV(`AYA_topups_${fromDate}_${toDate}_${timestamp()}.csv`, [header, ...csv].join('\r\n'));
}

export async function exportMaintenanceCSV(fromDate: string, toDate: string): Promise<void> {
  const rows = await dbClient.query(
    `SELECT job_number, job_date, customer_name, device_type, issue_description,
            status, estimated_cost, final_amount, delivered_at
     FROM maintenance_jobs
     WHERE job_date BETWEEN ? AND ? AND deleted_at IS NULL
     ORDER BY job_date ASC`,
    [fromDate, toDate]
  );
  const header = 'رقم المهمة,التاريخ,العميل,الجهاز,المشكلة,الحالة,التكلفة المقدرة,المبلغ النهائي,تاريخ التسليم';
  const csv = rows.map((r: any) => toCSVRow([
    r.job_number, r.job_date, r.customer_name, r.device_type, r.issue_description,
    r.status, formatFils(r.estimated_cost), formatFils(r.final_amount), r.delivered_at,
  ]));
  downloadCSV(`AYA_maintenance_${fromDate}_${toDate}_${timestamp()}.csv`, [header, ...csv].join('\r\n'));
}
```

### 5.4 Add export buttons to Reports page

In the Reports page (`src/modules/reports/ReportsPage.tsx` or similar), near the date range picker:

```typescript
import { exportInvoicesCSV, exportExpensesCSV, exportTopupsCSV, exportMaintenanceCSV } from '@/lib/csv-export';
import { Download } from 'lucide-react';

// in render, somewhere in the header section:
<div className="flex flex-wrap gap-2 my-3">
  <button
    onClick={() => exportInvoicesCSV(fromDate, toDate)}
    className="flex items-center gap-1 px-3 py-2 bg-surface border border-border rounded-lg hover:border-accent text-sm font-medium"
    style={{ fontFamily: 'Tajawal, sans-serif' }}
  >
    <Download className="w-4 h-4" />
    تصدير المبيعات
  </button>
  <button
    onClick={() => exportExpensesCSV(fromDate, toDate)}
    className="flex items-center gap-1 px-3 py-2 bg-surface border border-border rounded-lg hover:border-accent text-sm font-medium"
    style={{ fontFamily: 'Tajawal, sans-serif' }}
  >
    <Download className="w-4 h-4" />
    تصدير المصروفات
  </button>
  <button
    onClick={() => exportTopupsCSV(fromDate, toDate)}
    className="flex items-center gap-1 px-3 py-2 bg-surface border border-border rounded-lg hover:border-accent text-sm font-medium"
    style={{ fontFamily: 'Tajawal, sans-serif' }}
  >
    <Download className="w-4 h-4" />
    تصدير الشحن
  </button>
  <button
    onClick={() => exportMaintenanceCSV(fromDate, toDate)}
    className="flex items-center gap-1 px-3 py-2 bg-surface border border-border rounded-lg hover:border-accent text-sm font-medium"
    style={{ fontFamily: 'Tajawal, sans-serif' }}
  >
    <Download className="w-4 h-4" />
    تصدير الصيانة
  </button>
</div>
```

### 5.5 Phase 5 Manual Verification

1. **Backup UI hidden**
   - In Supabase mode (`.env.local` has `VITE_SUPABASE_URL`): backup/restore buttons are not visible
   - The reassurance message about cloud backup is visible

2. **CSV downloads work**
   - Pick a date range with sales, expenses, topups, maintenance
   - Click each export button → file downloads with correct name pattern `AYA_<table>_<from>_<to>_<timestamp>.csv`
   - Open file in Excel — Arabic text displays correctly (no mojibake), columns aligned

3. **CSV content correctness**
   - Money columns show `12.34` format (2 decimal places)
   - Arabic descriptions render correctly
   - Empty fields are empty (not "null" string)
   - Special characters in descriptions (commas, quotes) are properly escaped

4. **Deleted records excluded**
   - Delete an expense (Phase 4 flow) → export expenses → deleted expense is NOT in the CSV

### 5.6 Commit message
```
feat(export): hide backup UI in Supabase mode; add CSV export for sales/expenses/topups/maintenance

- HI-F: backup/restore buttons hidden when running on Supabase
- New module src/lib/csv-export.ts with 4 exporters
- UTF-8 BOM for Excel compatibility, RTL Arabic safe
- Reports page gains an "Export" toolbar
- Reassurance message replaces backup section
```

---

## Phase 6 — Documentation & Cosmetic Sweep

**Scope:** All remaining low-risk fixes in one sweep.
**Files touched:** `cart.store.ts`, `POSPage.tsx`, `Shell.tsx`, `ReceiptOverlay.tsx`, `money.ts`, `audit.ts`
**Issues fixed:** ME-B, LO-A, LO-B, LO-C, LO-D, LO-E, LO-F (7 issues)
**Estimated effort:** 1–2 hours

### 6.1 ME-B — Document discount distribution equivalence (cart.store.ts)

In `getTotalDiscount`, just inside the function body (after `const state = get();`):

```typescript
      getTotalDiscount: () => {
        const state = get();
        // ME-B: client vs server discount distribution
        // Client (this file) computes: sum(per-item discounts) + lump global discount.
        // Server (sales.ts) redistributes the global portion proportionally
        // across non-gift items with last-item-absorbs-rounding. The SUMS are
        // mathematically equal; only the per-item allocation differs. The
        // client formula is sufficient for the displayed cart total.
        const itemsDiscount = state.items.reduce(
          (sum, item) => addMoney(sum, calculateItemLineTotal(item).discountAmt), 0
        );
        // ... rest unchanged
```

### 6.2 LO-A — Responsive cart sidebar width (POSPage.tsx)

Line 31:
```typescript
      <div className="hidden md:flex w-[360px] shrink-0 h-full border-e border-border bg-surface shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)] z-10 flex-col">
```

Replace `w-[360px]` with `md:w-[320px] lg:w-[360px]`:
```typescript
      <div className="hidden md:flex md:w-[320px] lg:w-[360px] shrink-0 h-full border-e border-border bg-surface shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)] z-10 flex-col">
```

### 6.3 LO-B — Admin badge via Tailwind (Shell.tsx)

Lines 79-103 currently use inline `style={{...}}`. Replace the entire block:

```typescript
      {/* ── Admin session indicator badge — visible on every route ── */}
      {adminMinsLeft > 0 && (
        <div
          dir="rtl"
          className="fixed top-2 end-2 z-30 bg-accent text-white rounded-full px-3 py-1 text-xs font-bold shadow-md flex items-center gap-1.5 pointer-events-none"
          style={{ fontFamily: 'Tajawal, sans-serif' }}
        >
          <Shield className="w-3 h-3" />
          وضع المشرف نشط · {adminMinsLeft} د
        </div>
      )}
```

Make sure `--color-accent` (or whatever Tailwind token maps to `#CF694A`) is defined in `index.css`. If not, use:
```typescript
          className="fixed top-2 end-2 z-30 bg-[#CF694A] text-white rounded-full px-3 py-1 text-xs font-bold shadow-md flex items-center gap-1.5 pointer-events-none"
```

### 6.4 LO-C — Remove orphan `transform` class (ReceiptOverlay.tsx)

Line 58 currently:
```html
<th className="py-2 transform font-bold text-center">الكمية</th>
```

Remove `transform`:
```html
<th className="py-2 font-bold text-center">الكمية</th>
```

### 6.5 LO-D — Normalize Arabic-Indic digits in parseMoney (money.ts)

Replace `parseMoney` (lines 41-50):

```typescript
// 6. Parse user input string to fils
export function parseMoney(input: string): number {
  // LO-D: normalize Arabic-Indic digits (٠-٩) to Western digits before parsing
  const normalized = input.replace(/[٠-٩]/g, d =>
    String.fromCharCode(d.charCodeAt(0) - 1632 + 48)
  );
  // Remove anything that is not a digit or a dot or minus sign
  const cleaned = normalized.replace(/[^0-9.-]+/g, '');
  if (!cleaned) return 0;

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;

  return Math.max(0, Math.round(parsed * 100));
}
```

### 6.6 LO-E — Document localStorage acceptance (cart.store.ts)

At the bottom of `useCartStore` definition, add a comment near the `persist` block:

```typescript
    {
      name: 'active_cart',
      storage: createJSONStorage(() => localStorage),
      // LO-E: localStorage quota risk is accepted for single-shop deployment.
      // Cart size is bounded by typical retail sessions (< 50 items).
      // If a quota error occurs, Zustand will fail silently and the cart will
      // simply not persist across reloads — acceptable degradation.
      partialize: (state) => ({
        items: state.items,
        globalDiscountType: state.globalDiscountType,
        globalDiscountValue: state.globalDiscountValue,
      }),
    }
```

### 6.7 LO-F — Case-insensitive audit search (audit.ts)

Find `getFilteredAuditLog` (or similar) and change every `LIKE ?` on text columns to `ILIKE ?`:

```bash
grep -n "LIKE \?" src/db/queries/audit.ts
```

For each match on text columns (`action`, `detail`, `ref_type`), replace `LIKE` with `ILIKE`. Example:
```typescript
// Before
conds.push("detail LIKE ?");
// After
conds.push("detail ILIKE ?");
```

**Note:** `ILIKE` is PostgreSQL-only. Since the app runs on Supabase (PG), this is safe. If a SQLite fallback path ever re-emerges, the migration runner skips on Supabase so the code path is fine.

### 6.8 Phase 6 Manual Verification

1. **LO-A** — Resize browser between 768px and 1280px; cart sidebar should be 320px on tablet portrait and 360px on landscape/desktop
2. **LO-B** — Trigger admin session; verify badge styling looks identical to before (visual regression test)
3. **LO-C** — Open a receipt; visually no change but DevTools confirms `transform` class is gone
4. **LO-D** — In a price input, type `١٢٣٤٥` → parses as 12345 fils (= 123.45 د.أ)
5. **LO-F** — Search audit log with mixed-case keyword → returns matches regardless of casing

### 6.9 Commit message
```
chore(polish): documentation, responsive cart, Tailwind admin badge, ٠-٩ normalization, ILIKE search

- ME-B: document client/server discount distribution equivalence
- LO-A: cart sidebar uses responsive widths (md:320, lg:360)
- LO-B: admin badge converted from inline styles to Tailwind utility classes
- LO-C: remove orphan transform class on receipt table header
- LO-D: parseMoney normalizes Arabic-Indic digits ٠-٩
- LO-E: document localStorage quota acceptance
- LO-F: audit search uses ILIKE for case-insensitive matching
```

---

## Phase 7 — Per-Phase Reporting Protocol

After each phase, the implementer must produce a **Phase Completion Report** using this exact template. Submit the report to the owner who will forward it to the reviewer.

### Phase Completion Report — Template

```markdown
# Phase <N> Completion Report — <Phase Name>
Date: <YYYY-MM-DD HH:MM UTC>
Implementer: <name>
Base commit: <SHA at start of phase>
Final commit: <SHA after phase commit>

## 1. Issues addressed
- [x] <ID> — <one-line description>
- [x] ...

## 2. Files modified
- <path>
- ...

## 3. Files created
- <path>
- ...

## 4. Verification checklist (from §X.Y of plan)
- [x] Verification step 1
- [x] Verification step 2
- [ ] Verification step 3 (FAILED — see §5)
- ...

## 5. Failures or deviations
<None / list anything that didn't go as the plan describes>

## 6. Open questions for reviewer
<None / questions>

## 7. Type checking
$ npm run typecheck
<paste full output>

## 8. Diff statistics
$ git diff <base>..<final> --stat
<paste full output>

## 9. Sample git log
$ git log <base>..<final> --oneline
<paste full output>
```

### How the review cycle works

1. Implementer completes a phase and fills the report
2. Owner receives the report and forwards to reviewer (Claude)
3. Reviewer responds with one of:
   - **APPROVED** → owner instructs implementer to proceed to next phase
   - **APPROVED WITH NOTES** → minor follow-ups for next phase
   - **CHANGES REQUESTED** → specific fixes required before next phase. Implementer addresses, re-tests, and re-submits the report
4. Repeat for each phase

### Reviewer focus per phase

| Phase | Reviewer primarily checks |
|-------|---------------------------|
| 0 | baseline captured; no code changes |
| 1 | financial formulas correct; migration backfills properly; no double-counting |
| 2 | HI-A error message correct; HI-D detection works without false positives; no regression in normal sale flow |
| 3 | admin gate triggers; HI-C ignores client profit; HI-E guard runs on all branches |
| 4 | balance reversal on delete; balance check on restore; day-closed enforced; UI integration matches existing trash pattern |
| 5 | backup UI hidden; CSV files open cleanly in Excel; Arabic renders correctly; deleted records excluded |
| 6 | no visual regressions; ٠-٩ input works; ILIKE doesn't break SQLite path (if any) |

---

## Appendix A — Code That Does NOT Need Changes (anti-temptations)

The implementer may notice these in passing. **Do not "fix" them — they are correct as-is:**

1. **`supabase/functions.sql` exec_batch** — plpgsql function runs in a single PG transaction; an unhandled exception rolls back the entire function. The previous Z.ai audit claim that this is "not atomic" is FALSE. Leave it alone.

2. **`formatMoney` in `money.ts`** — divides by 100 because 100 fils = 1 JOD per business spec. Do not change to /1000.

3. **`fee_percent` schema comment** "per-mille (0.1% = 100)" — mathematically correct: 100 parts per 1000 = 10%. The code at `sales.ts:187` divides feePercent by 10 to get standard percent, which is consistent. Leave alone.

4. **Transfer same-account guard** — `operations.ts:211` already rejects same-account transfers server-side. No DB-level CHECK needed.

5. **`const [mainRow] = await dbClient.query(...)` at reports.ts:282** — this is syntactically correct. The previous "syntax error" claim was a hallucination.

6. **`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`** — atomic in PostgreSQL. Sequence numbers cannot duplicate. Do not "fix" this.

7. **Single-statement `UPDATE ... WHERE stock_qty >= ?`** — atomic in PG. Cannot produce negative stock. The remaining concurrency risk is addressed by HI-D (detection layer), not by changing this statement.

---

## Appendix B — Total Effort Estimate

| Phase | Hours (low) | Hours (high) |
|-------|-------------|--------------|
| 0 — Setup | 0.5 | 1 |
| 1 — Financial core | 4 | 6 |
| 2 — Sales hardening | 2 | 3 |
| 3 — Authorization | 1 | 2 |
| 4 — Expense lifecycle | 2 | 3 |
| 5 — Backup → CSV | 2 | 3 |
| 6 — Cosmetic sweep | 1 | 2 |
| **Total** | **12.5** | **20** |

Roughly **2–3 working days** of focused implementation.

---

## Appendix C — Out of Scope (deferred to a future phase)

The following are intentionally NOT in this plan because they require deeper architectural changes:

- **Atomic stored procedures** for `completeSale`, `closeDay`, etc. — would replace `batchRun` calls with single PG RPCs. Defer to "Phase 7" (multi-tablet concurrency). HI-D's detection layer in this plan is a pragmatic interim.
- **Item-level partial returns** — CR-D was documented per owner decision; if business needs change, this becomes a real feature: `invoice_items.returned_qty` column + revised return UI.
- **Cart compression to IndexedDB** — LO-E accepted; if real localStorage failures occur, migrate to `idb-keyval`.

---

**End of Plan.**

Owner: when ready, hand this document to the implementer and start with Phase 0. Send each Phase Completion Report to the reviewer before authorizing the next phase.
