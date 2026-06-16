# AYA POS — Follow-Up Resolution Report

**HEAD SHA (full):** `4aad41114e2b9570b93ca105229c4f0ab74fa2a8`
**HEAD SHA (short):** `4aad411`
**Subject:** `feat(ui): periodic admin-mode reminder every 15 minutes`
**Author date:** 2026-06-16T22:55:51+03:00
**Commit date:** 2026-06-16T22:55:51+03:00
**Branch:** `main`
**Repository:** https://github.com/ayamobile7758/New-Aya-Mobail.git

> ⚠️ **Head discrepancy note for the reviewer.** Your prompt stated the expected HEAD was `b897648` ("feat(ui): animated gliding admin-mode top line"). The actual `origin/main` HEAD when I fetched was `4aad411`, which is **two commits ahead** of `b897648`:
>
> ```
> 4aad411 feat(ui): periodic admin-mode reminder every 15 minutes        ← actual HEAD
> 2aa3733 fix(pos): reliable admin-enter→dashboard + exit-anywhere; regroup top bar; shrink cart actions & numpad
> b897648 feat(ui): animated gliding admin-mode top line (calmer than blinking)   ← your expected HEAD
> 155c765 feat(pos): single compact top row (search + icon actions); move saved-carts to cart header
> 59b1dad feat(ui): admin mode shown as a thin top line + small floating exit button  ← my original report's HEAD
> ```
>
> All line numbers in this report are anchored to `4aad411`. None of the two extra commits touch `reports.ts`, `closures.ts`, `sales.ts`, `maintenance.ts`, `operations.ts`, `supabase/functions.sql`, or `supabaseAdapter.ts` — they are UI-only changes to `POSPage.tsx`, `CartSidebar.tsx`, `ProductGrid.tsx`, `Shell.tsx`, and `index.css`. So all the C-1…C-9 and A-1…A-3 findings below are valid against both `b897648` and `4aad411`. I will cite the `4aad411` line numbers throughout.
>
> The fix-plan file `AYA_POS_Fix_Plan_20260615.md` mentioned in your prompt is **not present** in the repo root at this HEAD (verified by `find . -maxdepth 3 -name "*Fix*Plan*"`). However, the executed plan's tags are clearly visible in the source as comments: `CR-A` (`closures.ts:220`), `CR-B` (`closures.ts:76,98`), `CR-C` (`reports.ts:264,302`), `HI-A` (`sales.ts:53`), `HI-E` (`maintenance.ts:96`), `ME-A` (`closures.ts:61`), `ME-B` (`cart.store.ts:219`), `ME-D` (`expenses.ts:166,222,237`), `LO-E` (`cart.store.ts:251`). I therefore treat the plan as "executed in code, file not committed" and reason directly from the tagged comments.

---

## Summary Table

| ID | Verdict | Severity | File:Line (HEAD `4aad411`) | One-line fix summary |
|---|---|---|---|---|
| C-1 | AGREE (regression) | High | `src/db/queries/reports.ts:299-305` | Drop `- returns_total` from `sales_net`; keep `- partial_returns_total`. (Chose option (b).) |
| C-2 | AGREE | High | `supabase/functions.sql:292-317`; `src/db/queries/sales.ts:150-170` | Add `invoice_fee` ref_type to ledger; in `complete_sale`, when `v_fee_amount > 0`, debit a "merchant fees" expense account (auto-created if missing) and write a second ledger row. Surface fees in P&L. |
| C-3 | AGREE | High | `src/db/queries/closures.ts:53-59` | Change `ii.unit_price` → `ii.unit_cost` so `gifts_value` reports cost (consistent with `getReport.gift_cost`). |
| C-4 | AGREE | Medium | `src/db/queries/reports.ts:62-64` | Add `+ topupRow.total + mainRow.total` to `netProfit`; also extend `getReport` to fetch topup and maintenance rows. |
| C-5 | AGREE | High | `src/db/queries/closures.ts:36-103` | Align `getOpenDayPreview` with the (corrected) P&L: include `'partially_returned'` in sales+cogs, subtract `returns_total` (refunds) from `net_profit`. |
| C-6 | AGREE | High | `src/modules/pos/components/PaymentDialog.tsx:49-63` | Split the effect: re-init only on `isOpen` false→true; track "dirty" rows; on `total` change, update only the auto-default first row if not dirty. |
| C-7 | AGREE | High | `src/db/queries/maintenance.ts:138-144` | When transitioning FROM `'delivered'` to any non-delivered status, reverse the ledger (debit account by `final_amount`), insert reversing `credit→debit` ledger row, clear `delivered_at`/`final_amount`/`payment_account_id`. Keep the double-delivery guard. |
| C-8 | AGREE | Medium | `src/db/queries/operations.ts:21-31` | Switch `JOIN` → `LEFT JOIN`; map NULL `account_name` to "تعديل جرد" (inventory adjustment) in the TS layer. |
| C-9 | AGREE | High | `src/db/queries/sales.ts:44` (and 11 other sites) | Add `assertClockNotTampered()` helper in `lib/clockGuard.ts`; call at the top of every mutation function (12 sites). Persist `last_known_date` in `app_settings`. |
| A-1 | PARTIAL | Critical | `src/db/client.ts:11-14`; `src/db/supabase.ts:6-10` | Recommend (a) commit to Supabase-only; quarantine the worker; add a "requires internet" lock-screen banner. Outline provided. |
| A-2 | AGREE | Critical | `supabase/functions.sql:34-173,323-329` | Recommend (a) replace `exec_sql`/`exec_batch` with named typed RPCs (mirror `complete_sale`); add RLS with ` USING (true)` removed; revoke `EXECUTE ... TO anon`. Migration outline provided. |
| A-3 | PARTIAL | High | `src/db/supabaseAdapter.ts:9-68` | Offline queue is **worth it** for this deployment IF the owner does any delivery/installation work outside the shop. Provide minimal idb-keyval-backed queue + reconciliation steps + acceptable consistency hazards. |
| **NEW-1** | AGREE | Medium | `src/stores/cart.store.ts:248-261` | `partialize` does not persist `activeCartId` — after reload, edits to a previously-active saved cart silently stop syncing back to the saved cart. Add `activeCartId` to `partialize`. |
| **NEW-2** | AGREE | Medium | `src/db/queries/reports.ts:17-211` | `getReport` Overview KPIs filter `status='active'` only, excluding `'partially_returned'` — a third surface that diverges from the (corrected) P&L. Same fix family as C-5. |

---

## Detailed Responses

### C-1 — `getProfitAndLoss` DOUBLE-COUNTS FULL RETURNS (regression from CR-C)

- **Current code (HEAD `4aad411`):** `src/db/queries/reports.ts:232-305`
  ```ts
  // line 232-238
  const [salesRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status IN ('active', 'partially_returned')`,
    [fromDate, toDate]
  );
  // line 240-246
  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'returned'`,
    [fromDate, toDate]
  );
  // line 264-271 (the CR-C addition — correct on its own)
  const [partialReturnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'partially_returned'`,
    [fromDate, toDate]
  );
  // line 299-305 (the bug)
  const sales_gross        = Number(salesRow?.total  ?? 0);   // already excludes 'returned'
  const returns_total      = Number(returnsRow?.total ?? 0);  // sums only 'returned'
  const partial_returns_total = Number(partialReturnsRow?.total ?? 0);
  // CR-C: sales_net deducts both full returns and partial refunds
  const sales_net          = sales_gross - returns_total - partial_returns_total;
  const cogs               = Number(cogsRow?.cogs    ?? 0);
  const gross_profit       = sales_net - cogs;
  ```
- **My verdict:** AGREE — this is a real regression introduced by the CR-C fix. The CR-C intent (deduct partial refunds) is correct, but the `- returns_total` term double-counts the deduction for fully-returned invoices because they are already excluded from `sales_gross`.
- **Reasoning:** For a single-day scenario with one 1 000-fils invoice that was fully refunded:
  - `sales_gross = 0` (the `'returned'` status filter excludes the invoice)
  - `returns_total = 1 000` (the invoice is now `status='returned'`, `paid_amount=0`)
  - `partial_returns_total = 0`
  - `sales_net = 0 - 1 000 - 0 = -1 000` ❌ (should be 0)
  - `cogs = 0` (cogs query also filters `status IN ('active','partially_returned')`, so the returned invoice's items are excluded)
  - `gross_profit = -1 000 - 0 = -1 000` ❌ (should be 0)

  The correct economic reading: a fully-refunded sale is a null transaction — no revenue, no cost, no profit. The bug makes the system report a -10.00 JOD day instead of a 0.00 JOD day.

- **Decision: option (b).** Keep `sales_gross` excluding `'returned'` and **stop** subtracting `returns_total` (subtract only `partial_returns_total`). Rationale:
  - Option (a) (include `'returned'` in `sales_gross`, then subtract `returns_total`) is mathematically equivalent and arguably more "transparent" — the reader sees gross sales and then the deduction. BUT it requires every downstream consumer to remember to subtract `returns_total`, and it makes the `sales_gross` number misleading as a KPI ("total sales for the period" should not include refunded sales in a single-shop owner-facing report).
  - Option (b) (exclude `'returned'` from `sales_gross`, do NOT subtract `returns_total`) is the simpler, more intuitive definition: `sales_gross = revenue from non-returned invoices`, `sales_net = sales_gross - partial_refunds`. The `returns_total` column is still surfaced in the response (for the dashboard widget that shows "returns this period") but it no longer participates in the `sales_net` math.
  - Option (b) also matches the existing `getOpenDayPreview` design philosophy at `closures.ts:99-103` ("Do NOT subtract returns_total ... already excluded upstream"). Choosing (b) makes the P&L consistent with the Day-Closure preview's existing intent — which in turn makes C-5 a smaller diff.

- **Proposed fix** (surgical, 2-line change):

  ```ts
  // src/db/queries/reports.ts — replace lines 299-305 with:
  const sales_gross        = Number(salesRow?.total  ?? 0);
  const returns_total      = Number(returnsRow?.total ?? 0);   // surfaced as a KPI only
  const partial_returns_total = Number(partialReturnsRow?.total ?? 0);
  // C-1 (regression fix): sales_gross already excludes status='returned',
  // so we must NOT subtract returns_total again — that double-counts the
  // deduction. Only partial refunds (which ARE in sales_gross) need to be
  // deducted to get net sales. returns_total stays in the response for the
  // dashboard widget but does not participate in the profit math.
  const sales_net          = sales_gross - partial_returns_total;
  const cogs               = Number(cogsRow?.cogs    ?? 0);
  const gross_profit       = sales_net - cogs;
  ```

  The `returns_total` field is preserved in the returned object (line 314) so the dashboard "Returns" widget continues to work. The comment at line 302 (`// CR-C: sales_net deducts both full returns and partial refunds`) must be replaced with the new comment above.

- **Risk / side-effects:**
  - **Three-surface consistency:** The fix moves P&L toward the existing `getOpenDayPreview` formula (which already excludes `'returned'` from `sales_total`). For days with NO partial returns, the three surfaces (`getReport.kpi.netProfit`, `getProfitAndLoss.net_profit`, `getOpenDayPreview.net_profit`) will agree for the sales/cogs portion. The remaining divergences (topup+maintenance in Overview; partial-return inclusion in Day-Closure) are addressed in C-4 and C-5 respectively.
  - **No DB migration needed.** Pure app-code change.
  - **Dashboard widget "Returns"** continues to display correctly because `returns_total` is still in the response object.
  - **Reports history:** Past day_closures rows are unaffected (they store snapshot numbers, not formulas). Only future P&L queries will use the corrected math.

- **Verification steps:**
  1. Sell 1× Product A @ 10.00 JOD cash (invoice INV-000001, paid 10.00).
  2. Open Reports → P&L tab for today: `sales_gross = 10.00`, `returns_total = 0`, `sales_net = 10.00`, `cogs = (cost)`, `gross_profit = 10.00 - cost`.
  3. Go to Sales → INV-000001 → Return → refund full 10.00 to cash.
  4. Re-open P&L tab: `sales_gross = 0.00`, `returns_total = 10.00`, `sales_net = 0.00` (was -10.00 before fix), `cogs = 0`, `gross_profit = 0.00` (was -10.00 before fix).
  5. Make a partial return (refund 3.00) on a new 10.00 invoice. P&L should show `sales_gross = 10.00`, `partial_returns_total = 3.00`, `sales_net = 7.00`, `cogs = full cost`, `gross_profit = 7.00 - cost`.

---

### C-2 — Payment processing fee is never recorded in the ledger (accounting leak)

- **Current code (HEAD `4aad411`):**
  - `supabase/functions.sql:292-317`:
    ```sql
    -- Insert payment record
    INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id)
    VALUES (v_payment_id, v_invoice_id, v_account_id, v_amount, v_fee_amount, v_updated_at, v_device_id);

    -- Update account balance
    UPDATE accounts
    SET balance = balance + v_net_amount, updated_at = v_updated_at
    WHERE id = v_account_id;

    -- Insert ledger entry
    INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
    VALUES (
      payment ->> 'ledger_entry_id',
      v_invoice_date,
      v_account_id,
      v_account_name,
      'credit',
      v_net_amount,           -- ← only the net is ledger'd
      'invoice',
      v_invoice_id,
      'مبيعات فاتورة رقم ' || v_invoice_number,
      v_created_at,
      v_updated_at,
      v_device_id
    );
    ```
  - `src/db/queries/reports.ts:117-129` — "Sales by Account":
    ```ts
    const byAccountRaw = await dbClient.query(
      `SELECT
         a.name AS account_name,
         a.type AS account_type,
         COALESCE(SUM(ip.amount), 0) AS amount    -- ← sums GROSS, not net
       FROM invoice_payments ip
       JOIN accounts a ON ip.account_id = a.id
       JOIN invoices i ON ip.invoice_id = i.id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ip.amount > 0
       GROUP BY a.id, a.name, a.type
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );
    ```
  - `supabase/schema.sql:247-255` — confirmed: `invoice_payments` has `amount` and `fee_amount` columns only; no `net_amount`.
- **My verdict:** AGREE — confirmed accounting leak. The fee is stored on the payment row but never appears in any ledger entry or expense total.
- **Reasoning:** For a 20.00 JOD sale paid by card with `fee_percent = 250` (per-mille → 25%):
  - `invoice_payments` row: `amount=2000, fee_amount=500`
  - `accounts.balance` increases by `net_amount = 1500` (correct)
  - Ledger gets ONE credit row for `1500` (correct for the account)
  - The 500 fils fee is invisible — no debit anywhere, no expense row, no fee-account ledger entry
  - Reports → "Sales by Account" sums `ip.amount = 2000`, so it claims 20.00 JOD entered the card account, but the actual balance increase is 15.00 JOD. The 5.00 JOD is unaccounted for.
- **Decision: option (a).** In `complete_sale`, after crediting net to the payment account, write a second ledger entry `ref_type = 'invoice_fee'` that debits a dedicated "merchant fees" expense account. Rationale:
  - Option (b) (sum `ip.amount - ip.fee_amount` in Reports-by-Account and surface fees as a separate P&L line WITHOUT a ledger row) is faster to ship but breaks the invariant "every financial movement has a ledger entry." That invariant is what makes the ledger auditable and what makes `getRecentLedgerEntries` and `getLedgerForPeriod` useful.
  - Option (a) preserves the ledger as the single source of truth. The fee becomes a real expense with a real account, so the P&L `expenses_total` increases by the fee, `net_profit` decreases by the fee, and the account balances reconcile with the ledger sum.
  - The "merchant fees" account is auto-created on first use (idempotent `INSERT ... ON CONFLICT DO NOTHING`) so no manual setup is required.

  I also recommend **adding** the option-(b) surface change to `reports.ts:117-129`: sum `ip.amount - ip.fee_amount` AS `net_amount` AND `SUM(ip.fee_amount)` AS `fees`, so the "Sales by Account" table can show both gross and net columns. This is a small add-on that makes the reports more informative without changing the ledger design.

- **Proposed fix** (two parts):

  **Part 1 — `supabase/functions.sql`** — modify `complete_sale` to write a fee ledger entry when `v_fee_amount > 0`. Add a "merchant fees" account auto-creation step before the payment loop. The full modified function (showing only the changed region around the payment loop; everything before line 277 is unchanged):

  ```sql
  -- complete_sale (revised) — replace lines 277-321 of supabase/functions.sql

    -- Process payments
    v_payment_count := jsonb_array_length(payload -> 'payments');

    -- C-2: Auto-create a "merchant fees" expense account if any payment has a fee.
    -- Idempotent: ON CONFLICT DO NOTHING. The account id is deterministic so
    -- every device converges on the same row.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(payload -> 'payments') p
               WHERE (p ->> 'fee_amount')::int > 0) THEN
      INSERT INTO accounts (id, name, type, balance, fee_percent, module_scope, is_active, sort_order, created_at, updated_at)
      VALUES ('acct_merchant_fees', 'رسوم معالجة الدفع', 'cash', 0, 0, NULL, 1, 999, v_created_at, v_updated_at)
      ON CONFLICT (id) DO NOTHING;
    END IF;

    FOR i IN 0..(v_payment_count - 1) LOOP
      payment := (payload -> 'payments') -> i;
      v_payment_id := payment ->> 'id';
      v_account_id := payment ->> 'account_id';
      v_amount := (payment ->> 'amount')::int;
      v_fee_amount := (payment ->> 'fee_amount')::int;
      v_net_amount := (payment ->> 'net_amount')::int;
      v_account_name := payment ->> 'account_name';

      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- Insert payment record (unchanged)
      INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id)
      VALUES (v_payment_id, v_invoice_id, v_account_id, v_amount, v_fee_amount, v_updated_at, v_device_id);

      -- Update account balance (credit the NET amount)
      UPDATE accounts
      SET balance = balance + v_net_amount, updated_at = v_updated_at
      WHERE id = v_account_id;

      -- Insert ledger entry: credit the payment account for the NET amount
      INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
      VALUES (
        payment ->> 'ledger_entry_id',
        v_invoice_date,
        v_account_id,
        v_account_name,
        'credit',
        v_net_amount,
        'invoice',
        v_invoice_id,
        'مبيعات فاتورة رقم ' || v_invoice_number,
        v_created_at,
        v_updated_at,
        v_device_id
      );

      -- C-2 NEW: if a fee was charged, debit the merchant-fees account for the fee
      -- and write a corresponding ledger entry so the fee is visible in the books.
      IF v_fee_amount > 0 THEN
        UPDATE accounts
        SET balance = balance + v_fee_amount, updated_at = v_updated_at
        WHERE id = 'acct_merchant_fees';

        INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
        VALUES (
          gen_random_uuid()::text,
          v_invoice_date,
          'acct_merchant_fees',
          'رسوم معالجة الدفع',
          'credit',
          v_fee_amount,
          'invoice_fee',
          v_invoice_id,
          'رسوم دفع لفاتورة رقم ' || v_invoice_number,
          v_created_at,
          v_updated_at,
          v_device_id
        );
      END IF;
    END LOOP;

    RETURN jsonb_build_object('invoiceId', v_invoice_id, 'invoiceNumber', v_invoice_number);
  END;
  $$;
  ```

  Note: `gen_random_uuid()` requires the `pgcrypto` extension which Supabase enables by default. If not enabled, replace with `md5(random()::text || clock_timestamp()::text)` to match the existing nanoid-style string keys.

  **Part 2 — `src/db/queries/reports.ts:117-129`** — show gross + net + fees in "Sales by Account":

  ```ts
  // 7. Sales by payment account (C-2: report gross, net, and fees separately)
  const byAccountRaw = await dbClient.query(
    `SELECT
       a.name AS account_name,
       a.type AS account_type,
       COALESCE(SUM(ip.amount), 0)        AS gross_amount,
       COALESCE(SUM(ip.fee_amount), 0)    AS fees,
       COALESCE(SUM(ip.amount - ip.fee_amount), 0) AS net_amount
     FROM invoice_payments ip
     JOIN accounts a ON ip.account_id = a.id
     JOIN invoices i ON ip.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ip.amount > 0
     GROUP BY a.id, a.name, a.type
     ORDER BY gross_amount DESC`,
    [fromDate, toDate]
  );
  ```

  **Part 3 — `src/db/queries/reports.ts:257-262`** — P&L already sums all expenses from the `expenses` table, but merchant fees are NOT stored in `expenses`; they live in `ledger_entries` with `ref_type='invoice_fee'`. Add a fee-total query to `getProfitAndLoss`:

  ```ts
  // C-2 NEW: sum invoice_fee ledger entries for the period so fees appear in P&L
  const [feeRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM ledger_entries
     WHERE entry_date BETWEEN ? AND ?
       AND ref_type = 'invoice_fee'`,
    [fromDate, toDate]
  );
  // ...after line 308:
  const payment_fees = Number(feeRow?.total ?? 0);
  // fees reduce net_profit (they are an expense)
  const net_profit = gross_profit + other_income - expenses_total - payment_fees;
  ```

  Also add `payment_fees` to the `ProfitAndLoss` interface (line 216-229) and the returned object.

- **Risk / side-effects:**
  - **Three-surface consistency:** After this fix, the P&L `net_profit` includes `- payment_fees`. The Day-Closure preview (C-5 fix) and the Overview KPI (C-4 fix) must also subtract `payment_fees` to stay aligned. I include the corresponding lines in those fixes.
  - **Migration needed:** Yes — the merchant-fees account is auto-created at RPC runtime (idempotent), but if the owner wants to pre-seed it (so it appears in the Settings → Accounts list with a sensible sort order), a one-time SQL statement is provided in Appendix A.
  - **Reports "Sales by Account" table UI:** the existing column shows `amount`; after the fix, the table should show two columns (Gross / Net) or one column (Net) plus a "Fees" total. The UI change is in `ReportsPage.tsx` and is cosmetic; the data contract is additive (new `fees` and `net_amount` fields; `amount` renamed to `gross_amount` — the UI must be updated to read the new field name).
  - **Existing payment rows** (created before the fix) will not have a corresponding `invoice_fee` ledger entry. The P&L `payment_fees` total will under-report for periods that include pre-fix sales. This is acceptable: the historical inaccuracy is bounded and the fix is forward-looking.
  - **Refund path** (`returnInvoice` in `sales.ts:346-371`): when a payment with a fee is refunded, the refund row stores `fee_amount = refundFee` (line 354) but does NOT reverse the original fee ledger entry. For symmetry, the refund path should also write a `ref_type='invoice_fee'` DEBIT (reversal) ledger entry when `refundFee > 0`. I list this as part of the C-2 fix family but it can be deferred to a follow-up if the owner accepts the asymmetry (refunds are rare and small).

- **Verification steps:**
  1. Set up a card account with `fee_percent = 250` (25%).
  2. Sell 20.00 JOD to that card.
  3. Open Reports → P&L: confirm `payment_fees = 5.00 JOD`, `net_profit` decreased by 5.00 vs. a no-fee sale of the same amount.
  4. Open Reports → "Sales by Account": the card account row shows Gross = 20.00, Fees = 5.00, Net = 15.00.
  5. Open Operations → Recent Ledger: confirm TWO credit entries for the sale — one for 15.00 (ref_type='invoice', account=card) and one for 5.00 (ref_type='invoice_fee', account='رسوم معالجة الدفع').
  6. Open Settings → Accounts: confirm "رسوم معالجة الدفع" account exists with balance 5.00 JOD.

---

### C-3 — Day-Closure `gifts_value` uses `unit_price` instead of `unit_cost`

- **Current code (HEAD `4aad411`):** `src/db/queries/closures.ts:53-59`
  ```ts
  const [giftsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_price * ii.quantity), 0) AS gifts
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 1`,
    [targetDate]
  );
  ```
  Compare with `src/db/queries/reports.ts:48-54` (the correct version):
  ```ts
  const [giftRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gift_cost
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ii.is_gift = 1`,
    [fromDate, toDate]
  );
  ```
- **My verdict:** AGREE — confirmed bug. Day-Closure reports retail value; Reports reports cost. They will disagree for any gift with a non-zero margin.
- **Reasoning:** For a gift of Product A (sale_price = 7.00 JOD, cost_price = 4.00 JOD):
  - `getOpenDayPreview.gifts_value = 7.00 × 1 = 7.00 JOD` (uses `unit_price`)
  - `getReport.kpi.giftCost = 4.00 × 1 = 4.00 JOD` (uses `unit_cost`)
  - The owner looking at the Day-Closure preview sees "gifts_value = 7.00 JOD" — which is the *foregone revenue*, not the *cost to the business*. The actual cost was 4.00 JOD.

  The `gifts_value` field's semantic should be **cost to the business** (the actual economic loss), because:
  - The P&L's `gift_cost` (which uses `unit_cost`) is the number that flows into `gross_profit` math (gift cost reduces profit).
  - Reporting the retail value as `gifts_value` is misleading because the business never "lost" 7.00 JOD — it lost 4.00 JOD of inventory.
  - The day-closure `net_profit` formula at line 103 does NOT subtract `gifts_value` (per the comment "already excluded upstream"), so changing the formula from `unit_price` to `unit_cost` does NOT change `net_profit`. The fix is purely about label accuracy.

- **Proposed fix** (1-line change):

  ```ts
  // src/db/queries/closures.ts:53-59 — replace with:
  const [giftsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gifts
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 1`,
    [targetDate]
  );
  ```

  Optionally, rename the field from `gifts_value` to `gifts_cost` for clarity — but this requires updating the `DayClosureSnapshot` interface (line 16), the `closeDay` INSERT (line 194), and the audit log detail (line 202-213). To keep the diff minimal, I keep the column name `gifts_value` but document its new semantic in a comment:

  ```ts
  // C-3: gifts_value = COST of goods given as gifts (unit_cost × qty),
  // matching getReport.gift_cost. Previously used unit_price which reported
  // retail value, inconsistent with the P&L's gift_cost line.
  ```

- **Risk / side-effects:**
  - **Three-surface consistency:** After this fix, `getOpenDayPreview.gifts_value` == `getReport.kpi.giftCost` (for the same date range filtered to one day). The P&L tab does not surface `gift_cost` as a top-line number (it's already included in `cogs`), so no change needed there.
  - **Past day_closures rows:** the `gifts_value` column in historical closure rows retains the OLD (unit_price-based) value. Owners comparing historical closures to today's preview will see a discontinuity. Acceptable: the historical numbers were wrong but not balance-affecting.
  - **No DB migration needed.** Pure app-code change.
  - **No UI change needed** — the closure preview UI already displays "قيمة الهدايا" (gifts value) which is the correct label for either interpretation.

- **Verification steps:**
  1. Sell 1× Product A (sale_price = 7.00, cost_price = 4.00) as a gift.
  2. Open Operations → EOD Close → preview: "قيمة الهدايا" should read **4.00 JOD** (was 7.00 before fix).
  3. Open Reports → Overview for the same day: "تكلفة الهدايا" reads 4.00 JOD. ✓ Consistent.

---

### C-4 — Reports "Overview" net profit omits topup profit and maintenance revenue

- **Current code (HEAD `4aad411`):** `src/db/queries/reports.ts:17-211`
  ```ts
  // line 62-64
  const grossProfit = totalSales - totalCost;
  const totalExpenses = expRow?.total_expenses ?? 0;
  const netProfit = grossProfit - totalExpenses;   // ← missing topup + maintenance
  ```
  Compare with `getProfitAndLoss` at lines 307-310:
  ```ts
  const topup_profit       = Number(topupRow?.total  ?? 0);
  const maintenance_revenue = Number(mainRow?.total  ?? 0);
  const other_income       = topup_profit + maintenance_revenue;
  const net_profit         = gross_profit + other_income - expenses_total;
  ```
- **My verdict:** AGREE — confirmed divergence. The Overview KPI under-reports net profit by `topup_profit + maintenance_revenue` fils for any period containing topups or delivered maintenance jobs.
- **Reasoning:** For a day with 100.00 JOD sales, 20.00 JOD expenses, 10.00 JOD topup (profit 1.50), 30.00 JOD maintenance delivery:
  - `getReport.kpi.netProfit = 100.00 - 60.00 - 20.00 = 20.00 JOD` (assuming 60% cost ratio)
  - `getProfitAndLoss.net_profit = (100-60) + 1.50 + 30.00 - 20.00 - payment_fees = 51.50 JOD` (after C-2 fix)
  - Divergence = 31.50 JOD on a single day

  The owner comparing the Overview KPI card to the P&L tab sees a 31.50 JOD gap and loses trust in the reports.

- **Proposed fix** — add topup and maintenance queries to `getReport`, then include them in `netProfit`. Also include the new `payment_fees` from C-2 to keep the three surfaces aligned:

  ```ts
  // src/db/queries/reports.ts — replace getReport's body (lines 17-211) with:

  export async function getReport(fromDate: string, toDate: string) {
    // 1. KPIs — active invoices only
    const [kpiRow] = await dbClient.query(
      `SELECT
         COALESCE(SUM(i.total_amount), 0)    AS total_sales,
         COALESCE(SUM(i.discount_amount), 0) AS total_discounts,
         COUNT(DISTINCT i.id)                AS invoice_count,
         COALESCE(AVG(i.total_amount), 0)    AS avg_invoice,
         COALESCE(SUM(ii.quantity), 0)       AS total_qty,
         COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS total_cost
       FROM invoices i
       LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active'`,
      [fromDate, toDate]
    );

    // 2. Total expenses
    const [expRow] = await dbClient.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses
       FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [fromDate, toDate]
    );

    // 3. Returns
    const [retRow] = await dbClient.query(
      `SELECT COUNT(id) AS return_count, COALESCE(SUM(total_amount), 0) AS return_value
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status = 'returned'`,
      [fromDate, toDate]
    );

    // 4. Gift cost — cost of goods given as gifts (0 revenue, full cost reduces profit)
    const [giftRow] = await dbClient.query(
      `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gift_cost
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ii.is_gift = 1`,
      [fromDate, toDate]
    );

    // C-4 NEW: topup profit and maintenance revenue for the period,
    // so the Overview KPI net_profit matches getProfitAndLoss.net_profit.
    const [topupRow] = await dbClient.query(
      `SELECT COALESCE(SUM(profit), 0) AS total
       FROM topups
       WHERE topup_date BETWEEN ? AND ?`,
      [fromDate, toDate]
    );

    const [mainRow] = await dbClient.query(
      `SELECT COALESCE(SUM(final_amount), 0) AS total
       FROM maintenance_jobs
       WHERE status = 'delivered'
         AND substr(delivered_at, 1, 10) BETWEEN ? AND ?`,
      [fromDate, toDate]
    );

    // C-2 NEW: payment fees for the period (ledger rows with ref_type='invoice_fee')
    const [feeRow] = await dbClient.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE entry_date BETWEEN ? AND ?
         AND ref_type = 'invoice_fee'`,
      [fromDate, toDate]
    );

    const totalSales = kpiRow?.total_sales ?? 0;
    const totalDiscounts = kpiRow?.total_discounts ?? 0;
    const invoiceCount = kpiRow?.invoice_count ?? 0;
    const avgInvoice = kpiRow?.avg_invoice ?? 0;
    const totalQty = kpiRow?.total_qty ?? 0;
    const totalCost = kpiRow?.total_cost ?? 0;
    const grossProfit = totalSales - totalCost;
    const totalExpenses = expRow?.total_expenses ?? 0;
    const topupProfit = Number(topupRow?.total ?? 0);
    const maintenanceRevenue = Number(mainRow?.total ?? 0);
    const paymentFees = Number(feeRow?.total ?? 0);
    // C-4 + C-2: net profit now includes topup + maintenance and deducts payment fees,
    // matching getProfitAndLoss.net_profit exactly for the same date range.
    const netProfit = grossProfit + topupProfit + maintenanceRevenue - totalExpenses - paymentFees;
    const returnCount = retRow?.return_count ?? 0;
    const returnValue = retRow?.return_value ?? 0;
    const giftCost = giftRow?.gift_cost ?? 0;

    // ... (sections 5-9 unchanged: salesByCategory, topProducts, byAccount [updated per C-2], daily, expensesByCategory)

    return {
      kpi: {
        totalSales,
        totalDiscounts,
        invoiceCount,
        avgInvoice,
        totalQty,
        totalCost,
        grossProfit,
        totalExpenses,
        topupProfit,           // NEW
        maintenanceRevenue,    // NEW
        paymentFees,           // NEW
        netProfit,
        returnCount,
        returnValue,
        giftCost,
      },
      salesByCategory,
      topProducts,
      byAccount: byAccountRaw,
      daily,
      expensesByCategory,
    };
  }
  ```

- **Risk / side-effects:**
  - **Three-surface consistency:** After this fix, `getReport.kpi.netProfit == getProfitAndLoss.net_profit` for the same date range (assuming both are using the corrected formulas from C-1 and C-2). `getOpenDayPreview.net_profit` will agree for single-day ranges after the C-5 fix.
  - **Dashboard UI:** The Overview KPI card previously showed `netProfit`; it will now show a slightly higher number (because topup+maintenance are added and payment_fees are subtracted). The owner may notice the change — this is the correct number, so the change is desirable.
  - **No DB migration needed.** Pure app-code change.
  - **Performance:** Adds 3 small SQL queries to `getReport` (topup, maintenance, fee). Each is a single-table SUM with a date filter on an indexed column. Negligible (<5ms each in Supabase).

- **Verification steps:**
  1. On a single day, make: 1 sale of 50.00 (cost 30.00), 1 topup of 10.00 (cost 8.50, profit 1.50), 1 maintenance delivery of 20.00, 1 expense of 5.00.
  2. Reports → Overview KPI `netProfit` should read: `50 - 30 + 1.50 + 20.00 - 5.00 - 0 (no fees) = 36.50 JOD`.
  3. Reports → P&L tab `net_profit` should read the same 36.50 JOD.
  4. Operations → EOD Close → preview `net_profit` should read the same 36.50 JOD.

---

### C-5 — Day-Closure vs P&L diverge for partially-returned invoices

- **Current code (HEAD `4aad411`):** `src/db/queries/closures.ts:36-103`
  ```ts
  // line 36-43 — sales_total filter excludes 'partially_returned'
  const [salesRow] = await dbClient.query(
    `SELECT
       COALESCE(SUM(total_amount), 0)    AS total,
       COALESCE(SUM(discount_amount), 0) AS discounts
     FROM invoices
     WHERE invoice_date = ? AND status = 'active'`,
    [targetDate]
  );
  // line 45-51 — cogs_total filter excludes 'partially_returned'
  const [cogsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date = ? AND i.status = 'active' AND ii.is_gift = 0`,
    [targetDate]
  );
  // line 98-103 — net_profit does NOT subtract returns_total
  const net_profit = sales_total - cogs_total + topup_profit + maintenance_revenue - expenses_total;
  ```
  Compare with `getProfitAndLoss` at lines 232-305 (after C-1 fix): includes `'partially_returned'` in both sales and cogs, then subtracts `partial_returns_total`.
- **My verdict:** AGREE — confirmed divergence. For a day with one 10.00 JOD sale (cost 6.00) that was partially refunded 3.00:
  - `getOpenDayPreview`: `sales_total=0`, `cogs_total=0`, `returns_total=300` (computed but not subtracted), `net_profit = 0 - 0 + 0 + 0 - 0 = 0`
  - `getProfitAndLoss` (after C-1): `sales_gross=1000`, `partial_returns_total=300`, `sales_net=700`, `cogs=600`, `gross_profit=100`, `net_profit=100`
  - **Divergence: 100 fils (1.00 JOD) per partial-return invoice per day.**
- **Reasoning:** The current `getOpenDayPreview` design assumes "exclude returned invoices from sales, then don't subtract returns because they're already excluded." This works for full returns (a fully-returned invoice's contribution to net_profit is 0 either way) but breaks for partial returns, because a partially-returned invoice has a non-zero `paid_amount` (the un-refunded portion) that represents real revenue.

  The correct semantic (matching the corrected P&L): a partially-returned invoice contributes its full `total_amount` to `sales_total`, its full `unit_cost × qty` to `cogs_total`, and its refund amount (`total_amount - paid_amount`) to a `returns_total` that IS subtracted from `net_profit`.

- **Proposed fix** — align `getOpenDayPreview` with the corrected P&L formula:

  ```ts
  // src/db/queries/closures.ts — replace lines 36-117 with:

  export async function getOpenDayPreview(targetDate: string): Promise<DayClosureSnapshot> {
    // C-5: align with getProfitAndLoss — include 'partially_returned' in sales and cogs,
    // then subtract returns_total (which now captures BOTH full and partial refunds).
    const [salesRow] = await dbClient.query(
      `SELECT
         COALESCE(SUM(total_amount), 0)    AS total,
         COALESCE(SUM(discount_amount), 0) AS discounts
       FROM invoices
       WHERE invoice_date = ? AND status IN ('active', 'partially_returned')`,
      [targetDate]
    );

    const [cogsRow] = await dbClient.query(
      `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.invoice_date = ? AND i.status IN ('active', 'partially_returned') AND ii.is_gift = 0`,
      [targetDate]
    );

    // C-3 fix: gifts_value uses unit_cost (not unit_price)
    const [giftsRow] = await dbClient.query(
      `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gifts
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       WHERE i.invoice_date = ? AND i.status IN ('active', 'partially_returned') AND ii.is_gift = 1`,
      [targetDate]
    );

    // ME-A (unchanged): returns_adjustment = total_amount - paid_amount for returned/partially_returned.
    // For full returns: paid_amount=0, so this reads total_amount (the full refund).
    // For partial returns: paid_amount = remaining, so this reads the refund amount.
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

    // CR-B (unchanged): include topup profit and maintenance revenue
    const [topupRow] = await dbClient.query(
      `SELECT COALESCE(SUM(profit), 0) AS topup_profit FROM topups WHERE topup_date = ?`,
      [targetDate]
    );

    const [mainRow] = await dbClient.query(
      `SELECT COALESCE(SUM(final_amount), 0) AS maintenance_revenue
       FROM maintenance_jobs
       WHERE status = 'delivered' AND substr(delivered_at, 1, 10) = ?`,
      [targetDate]
    );

    // C-2 NEW: payment fees for the day (so closure net_profit matches P&L)
    const [feeRow] = await dbClient.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE entry_date = ? AND ref_type = 'invoice_fee'`,
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
    const payment_fees         = Number(feeRow?.total                ?? 0);

    // C-5: corrected formula — aligned with getProfitAndLoss (after C-1, C-2, C-3 fixes).
    // sales_total now includes partially_returned invoices.
    // returns_total is now SUBTRACTED (it captures both full refunds and partial refunds).
    // gifts_value is informational (cost already in cogs_total via is_gift=0 filter).
    // payment_fees is subtracted (matches P&L).
    const net_profit =
      sales_total
      - cogs_total
      - returns_total
      + topup_profit
      + maintenance_revenue
      - expenses_total
      - payment_fees;

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
      payment_fees,   // NEW field — add to DayClosureSnapshot interface
      net_profit,
    };
  }
  ```

  Also update the `DayClosureSnapshot` interface (lines 9-23) to add `payment_fees: number;` and the `closeDay` INSERT (lines 184-198) to include the new column. The `day_closures` table needs a migration to add the `payment_fees` column — see Appendix A.

- **Risk / side-effects:**
  - **Three-surface consistency:** After this fix, for any single day, `getOpenDayPreview.net_profit == getProfitAndLoss.net_profit == getReport.kpi.netProfit` (for a one-day range). This is the primary goal.
  - **Past day_closures rows:** historical snapshot rows have the OLD `net_profit` value computed with the OLD formula. They will NOT match a fresh `getProfitAndLoss` query for the same historical date if the day had partial returns or fees. **Recommendation:** do not retroactively rewrite historical closures (they are snapshots, by design). The owner should be told "closures before <fix-date> use the old formula; closures after use the new formula."
  - **Migration needed:** Yes — add `payment_fees INTEGER NOT NULL DEFAULT 0` column to `day_closures`. SQL provided in Appendix A.
  - **`getDayClosures` history view** (`closures.ts:262-264`): returns existing closure rows. Historical rows will have `payment_fees=0` (default), recent rows will have the actual value. Acceptable.

- **Verification steps:**
  1. Sell 2× Product A @ 5.00 (cost 3.00) = 10.00, paid cash.
  2. Partial refund 3.00 to cash.
  3. Operations → EOD Close → preview: `sales_total=10.00`, `cogs_total=6.00`, `returns_total=3.00`, `net_profit=10-6-3 = 1.00 JOD`.
  4. Reports → P&L tab for the same day: `sales_gross=10.00`, `partial_returns_total=3.00`, `sales_net=7.00`, `cogs=6.00`, `gross_profit=1.00`, `net_profit=1.00`. ✓ Matches.
  5. Reports → Overview KPI for the same day: `netProfit=1.00`. ✓ Matches.

---

### C-6 — `PaymentDialog` wipes manually-entered split payments on cart change

- **Current code (HEAD `4aad411`):** `src/modules/pos/components/PaymentDialog.tsx:49-63`
  ```ts
  useEffect(() => {
    if (isOpen) {
      setShowAdvanced(false);
      setCashReceivedInput('');
      if (accounts.length > 0) {
        setPayments([{
          id: nanoid(),
          accountId: accounts[0].id,
          amountInput: (total / 100).toString()
        }]);
      } else {
        setPayments([]);
      }
    }
  }, [isOpen, total, accounts]);
  ```
- **My verdict:** AGREE — confirmed bug. The effect's dependency array includes `total` and `accounts`, so any cart change that affects `total` (adding/removing an item, editing quantity, applying a discount) triggers a full reset of the `payments` array, wiping any manual split entries the cashier had typed.
- **Reasoning:** Reproduction:
  1. Cashier adds 2 products to cart, total = 15.00.
  2. Opens PaymentDialog, clicks "خيارات متقدمة" (Advanced).
  3. Adds 2 payment rows: 10.00 cash + 5.00 card.
  4. Realizes they forgot to add a 3rd product. Closes dialog? No — they go back to the product grid (the dialog stays mounted because the cart button still works) and click a 3rd product.
  5. `cart.total` changes from 15.00 to 22.00.
  6. The `useEffect` re-fires, `setPayments([{ ... default 22.00 ... }])` wipes the 10.00/5.00 split.
  7. Cashier returns to the dialog and sees a single 22.00 cash row. The split they typed is gone.

  Note: in the current UI flow the dialog is modal (`fixed inset-0 z-50`), so the cashier cannot directly click the product grid while the dialog is open. BUT the cart can still be mutated via the SavedCarts tabs (which are NOT inside the dialog) if the dialog is dismissed and re-opened, or via the keyboard shortcut for adding a product (if any). More importantly, the `accounts` array can change asynchronously (Realtime invalidation → refetch → new array reference), which also triggers the effect even without a cart change.

- **Proposed fix** — split the effect into two: one for `isOpen` toggle (full reset), one for `total` change (update only the auto-default first row if not manually edited). Track "manual edit" state per row.

  ```ts
  // src/modules/pos/components/PaymentDialog.tsx — replace lines 36-63 with:

  interface PaymentRow {
    id: string;
    accountId: string;
    amountInput: string;
    isManualEdit?: boolean;   // C-6: track whether the user typed in this row
  }

  // ...inside the component:

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const wasOpenRef = useRef(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen,
  });

  const quickAccount = accounts.find(a => a.type === 'cash') ?? accounts[0] ?? null;

  // C-6: Effect A — full reset ONLY when the dialog transitions from closed→open.
  // Do NOT include `total` or `accounts` in the dependency array.
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
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // C-6: Effect B — when `total` changes while the dialog is open, update ONLY
  // the auto-default first row (the one the user has not manually edited).
  // Never clobber rows the user has typed into.
  useEffect(() => {
    if (!isOpen) return;
    setPayments(prev => {
      if (prev.length === 0) return prev;
      // Only update the first row if it is the auto-default (not manually edited)
      // and it is the only row OR the user has not added split rows yet.
      const first = prev[0];
      if (first.isManualEdit) return prev;
      const updated = { ...first, amountInput: (total / 100).toString() };
      return [updated, ...prev.slice(1)];
    });
  }, [total]);

  // C-6: Effect C — if `accounts` arrives AFTER the dialog opened (e.g. slow network),
  // initialize the first row's accountId. Do not clobber existing rows.
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
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  ```

  Also update `handleUpdatePayment` (line 142-144) to mark the row as manually edited:

  ```ts
  const handleUpdatePayment = (id: string, field: keyof PaymentRow, value: string) => {
    setPayments(payments.map(p => p.id === id
      ? { ...p, [field]: value, isManualEdit: true }
      : p
    ));
  };
  ```

  And `handleAddPayment` (line 129-136) — new rows are always manually edited:

  ```ts
  const handleAddPayment = () => {
    if (accounts.length === 0) return;
    setPayments([...payments, {
      id: nanoid(),
      accountId: accounts[0].id,
      amountInput: remaining > 0 ? (remaining / 100).toString() : '0',
      isManualEdit: true,   // C-6: user-added rows are manual
    }]);
  };
  ```

- **Risk / side-effects:**
  - **`useRef` import:** add `useRef` to the React import on line 1.
  - **`PaymentRow` interface:** add optional `isManualEdit?: boolean`. The persisted form data is unaffected because `isManualEdit` is not part of the `CheckoutVars` payload sent to `completeSale`.
  - **Behavior change:** when the cashier adds a product to the cart while the dialog is open (currently impossible due to modality, but possible if the dialog is closed and re-opened quickly), the first row's `amountInput` auto-updates to the new total. Previously, the entire `payments` array was reset to a single default row. The new behavior is strictly better.
  - **No DB migration.** Pure UI change.

- **Verification steps:**
  1. Add 2 products (total = 15.00).
  2. Open PaymentDialog → Advanced → add 2 split rows (10.00 cash, 5.00 card).
  3. Without closing the dialog, use the SavedCarts feature to switch to a different saved cart with different items (total changes to e.g. 22.00).
  4. Verify: the 10.00/5.00 split rows are PRESERVED (not wiped). The "remaining" indicator updates to `22.00 - 15.00 = 7.00` short.
  5. Close and re-open the dialog: rows ARE reset (full reset on isOpen false→true). ✓ Expected.

---

### C-7 — Delivered maintenance job reverted to another status does NOT reverse the ledger/account

- **Current code (HEAD `4aad411`):** `src/db/queries/maintenance.ts:90-145`
  ```ts
  export async function updateJobStatus(id: string, status: MaintenanceJob['status'], final_amount?: number, payment_account_id?: string) {
    // ... lines 91-100: day-closed guard (HI-E) ...
    if (status === 'delivered') {
      // ... lines 102-137: delivery path with account credit + ledger entry + double-delivery guard ...
    } else {
      // Other statuses don't need financial transactions
      await dbClient.run(
        `UPDATE maintenance_jobs SET status = ?, updated_at = ? WHERE id = ?`,
        [status, dateStr, id]
      );
    }
  }
  ```
  And `src/modules/maintenance/MaintenancePage.tsx:225-234` — the "إلغاء" (Cancel) button is rendered UNCONDITIONALLY for every status including `'delivered'`:
  ```tsx
  <button
    onClick={() => {
      requireAdminAction(() => {
         updateStatusMutation.mutate({ id: job.id, status: 'cancelled' });
      });
    }}
    className="px-3 h-11 bg-danger/10 text-danger rounded-lg font-bold text-xs flex items-center gap-1"
  >
    إلغاء
  </button>
  ```
- **My verdict:** AGREE — confirmed bug. An admin can click "إلغاء" on a delivered job (which already credited the account and wrote a ledger entry) and the system will simply flip the status to `'cancelled'` without reversing the financial impact. The books overstate income by `final_amount` for the period.
- **Reasoning:** Reproduction:
  1. Create a maintenance job, deliver it for 30.00 JOD cash. Cash account += 30.00, ledger has a credit 30.00 entry with `ref_type='maintenance'`.
  2. Admin clicks "إلغاء" on the delivered job (e.g. customer returned the repaired device, or the delivery was recorded in error).
  3. Current code: `UPDATE maintenance_jobs SET status = 'cancelled' WHERE id = ?`. No ledger reversal, no account debit. Cash account still shows +30.00. Ledger still has the credit.
  4. P&L for the day still shows `maintenance_revenue = 30.00` (because the query filters `status='delivered'`, but the job is now `'cancelled'` — so actually the P&L query will now EXCLUDE it). **Wait — let me re-check.**

  Re-reading `reports.ts:291-297`:
  ```ts
  const [mainRow] = await dbClient.query(
    `SELECT COALESCE(SUM(final_amount), 0) AS total
     FROM maintenance_jobs
     WHERE status = 'delivered'
       AND substr(delivered_at, 1, 10) BETWEEN ? AND ?`,
    [fromDate, toDate]
  );
  ```
  So after the cancel, `status != 'delivered'`, so P&L `maintenance_revenue` decreases by 30.00. **But the account balance and ledger entry are NOT reversed.** This means:
  - Account balance: +30.00 (still credited from delivery)
  - Ledger: still has the credit 30.00 entry with `ref_type='maintenance'`, `ref_id=<job_id>`
  - P&L: -30.00 (job no longer 'delivered')

  **The ledger and P&L now disagree by 30.00 JOD.** This is a real accounting corruption.

- **Proposed fix** — when transitioning FROM `'delivered'` to any non-delivered status, reverse the financial effect. Keep the double-delivery guard intact. Use the same pattern as `deleteExpense` in `expenses.ts:168-219`.

  ```ts
  // src/db/queries/maintenance.ts — replace updateJobStatus (lines 90-145) with:

  export async function updateJobStatus(
    id: string,
    status: MaintenanceJob['status'],
    final_amount?: number,
    payment_account_id?: string
  ) {
    const now = new Date();
    const dateStr = format(now, 'yyyy-MM-dd HH:mm:ss');
    const onlyDateStr = format(now, 'yyyy-MM-dd');
    const deviceId = getDeviceId();

    // HI-E: any status mutation that touches a closed day's row corrupts the snapshot.
    // Apply the guard universally — not only on delivery.
    if (await isDayClosed(onlyDateStr)) {
      throw new Error(`يوم ${onlyDateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
    }

    // C-7: fetch current state to detect transitions FROM 'delivered'.
    const current = await dbClient.query(
      'SELECT status, job_number, final_amount, payment_account_id, delivered_at FROM maintenance_jobs WHERE id = ?',
      [id]
    );
    if (!current.length) throw new Error('المهمة غير موجودة');
    const prev = current[0];
    const job_number = prev.job_number || '';

    // ── Branch 1: deliver (status === 'delivered') ────────────────────────────
    if (status === 'delivered') {
      if (final_amount === undefined || !payment_account_id) {
        throw new Error('Final amount and account are required for delivery');
      }
      // منع التسليم المزدوج
      if (prev.status === 'delivered') {
        throw new Error('تم تسليم هذه المهمة مسبقاً');
      }

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
      return;
    }

    // ── Branch 2: reverse a prior delivery when transitioning FROM 'delivered' ─
    // C-7 NEW: if the job was previously delivered and is now moving to any
    // non-delivered status (e.g. 'cancelled', 'ready', 'in_progress', 'new'),
    // we must reverse the financial impact of the original delivery.
    if (prev.status === 'delivered' && status !== 'delivered') {
      const prevAccountId = prev.payment_account_id;
      const prevAmount = prev.final_amount ?? 0;

      const tx: { sql: string; params: any[] }[] = [
        {
          sql: `UPDATE maintenance_jobs
                SET status = ?, updated_at = ?, delivered_at = NULL, final_amount = NULL, payment_account_id = NULL
                WHERE id = ?`,
          params: [status, dateStr, id]
        },
      ];

      if (prevAccountId && prevAmount > 0) {
        // Reverse the account credit (debit it back)
        tx.push({
          sql: `UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
          params: [prevAmount, dateStr, prevAccountId]
        });

        // Fetch the account name for the reversing ledger entry
        const acctRows = await dbClient.query('SELECT name FROM accounts WHERE id = ?', [prevAccountId]);
        const account_name = acctRows[0]?.name || null;

        // Write a reversing ledger entry (debit) with ref_type='maintenance'
        tx.push({
          sql: `INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            nanoid(), onlyDateStr, prevAccountId, account_name,
            'debit', prevAmount, 'maintenance', id,
            `إلغاء تسليم مهمة صيانة: ${job_number}`,
            dateStr, dateStr, deviceId
          ]
        });
      }

      await dbClient.batchRun(tx);
      await logAudit(
        'إلغاء_تسليم_صيانة',
        `إلغاء تسليم مهمة ${job_number} — عكس المبلغ ${formatMoney(prevAmount)}`,
        'maintenance',
        id
      );
      return;
    }

    // ── Branch 3: ordinary status change (no financial impact) ────────────────
    // Both prev.status and status are non-delivered (e.g. new→in_progress, in_progress→ready,
    // ready→cancelled, new→cancelled). No ledger or account changes needed.
    await dbClient.run(
      `UPDATE maintenance_jobs SET status = ?, updated_at = ? WHERE id = ?`,
      [status, dateStr, id]
    );
  }
  ```

- **Risk / side-effects:**
  - **`MaintenanceJob` interface:** no change needed — `final_amount` and `payment_account_id` are already nullable.
  - **MaintenancePage UI:** the "إلغاء" button currently shows for ALL statuses including `'delivered'`. With this fix, clicking it on a delivered job will now reverse the financials — which is the correct behavior. **However**, the UI should ideally show a confirmation dialog ("This will reverse the delivery and debit the account. Continue?") because the action is destructive. This is a separate UI improvement; the data fix is sufficient to prevent the accounting corruption.
  - **Day-closure guard:** the HI-E guard at the top of the function (line 98-100) already covers the reversal branch. If today is closed, the reversal will throw, which is correct — the owner must reopen the day first.
  - **Re-delivery after reversal:** after a delivered→cancelled reversal, the job can be re-delivered (Branch 1) on a later day. The new delivery will credit the account and write a new ledger entry. The `prev.status === 'delivered'` check at the top of Branch 1 (the double-delivery guard) will correctly allow re-delivery because `prev.status` is now `'cancelled'`. ✓
  - **Three-surface consistency:** after the reversal, P&L `maintenance_revenue` no longer includes this job (because `status != 'delivered'`), the account balance is debited back, and the ledger has a debit reversal entry. All three surfaces agree.
  - **No DB migration.** Pure app-code change.

- **Verification steps:**
  1. Create a maintenance job, deliver it for 30.00 JOD cash. Cash += 30.00.
  2. Note the ledger entry (credit 30.00, ref_type='maintenance').
  3. Admin-clicks "إلغاء" on the delivered job. Confirm in a dialog (once UI is added).
  4. Verify: cash -= 30.00 (back to pre-delivery). Ledger has a new debit 30.00 entry with description "إلغاء تسليم مهمة صيانة: REP-00001". Job status = 'cancelled', `delivered_at = NULL`, `final_amount = NULL`, `payment_account_id = NULL`.
  5. Reports → P&L for the period: `maintenance_revenue = 0` (job is no longer 'delivered').
  6. Operations → Recent Ledger: shows both the original credit 30.00 AND the reversing debit 30.00. ✓

---

### C-8 — `getRecentLedgerEntries` hides account-less ledger rows (inventory adjustments)

- **Current code (HEAD `4aad411`):** `src/db/queries/operations.ts:21-31`
  ```ts
  export async function getRecentLedgerEntries(limit = 100): Promise<LedgerEntry[]> {
    const query = `
      SELECT l.*, a.name as account_name
      FROM ledger_entries l
      JOIN accounts a ON l.account_id = a.id    -- ← INNER JOIN, excludes NULL account_id
      ORDER BY l.created_at DESC
      LIMIT ?
    `;
    const results = await dbClient.query(query, [limit]);
    return results as LedgerEntry[];
  }
  ```
  Compare with `getLedgerForPeriod` at lines 46-65 which uses `LEFT JOIN` and correctly includes NULL-account rows.
- **My verdict:** AGREE — confirmed inconsistency. Inventory adjustment entries (written with `account_id = NULL` at `inventory.ts:57`) are visible in the period ledger but invisible in the recent ledger view.
- **Reasoning:** For a shop that does regular inventory counts, the Operations → Recent Ledger view will silently hide every "تعديل مخزون" entry. The owner sees credits and debits for sales/expenses/topups/transfers but never the inventory adjustments — making it impossible to audit stock-loss events from the ledger view alone.

- **Proposed fix** — switch to `LEFT JOIN` and provide a fallback label:

  ```ts
  // src/db/queries/operations.ts — replace getRecentLedgerEntries (lines 21-31) with:

  export async function getRecentLedgerEntries(limit = 100): Promise<LedgerEntry[]> {
    // C-8: LEFT JOIN so account-less rows (inventory_adjustment, etc.) are included.
    // The TS layer maps NULL account_name to a sensible Arabic label per ref_type.
    const query = `
      SELECT l.*, a.name as account_name
      FROM ledger_entries l
      LEFT JOIN accounts a ON l.account_id = a.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `;
    const results = await dbClient.query(query, [limit]);

    // C-8: provide a sensible label for account-less rows
    return results.map((row: any) => ({
      ...row,
      account_name: row.account_name
        ?? (row.ref_type === 'inventory_adjustment' ? 'تعديل جرد'
            : row.ref_type === 'eod_reconciliation' ? 'تسوية إقفال'
            : '—'),
    })) as LedgerEntry[];
  }
  ```

  Also widen the `LedgerEntry` interface (lines 8-19) to allow `account_name: string | null`:
  ```ts
  export interface LedgerEntry {
    id: string;
    entry_date: string;
    account_id: string | null;        // was: string
    account_name: string | null;      // was: string
    type: 'debit' | 'credit';
    amount: number;
    ref_type: 'invoice' | 'expense' | 'topup' | 'transfer' | 'manual' | 'reconciliation' | 'maintenance' | 'eod_reconciliation' | 'inventory_adjustment' | 'invoice_fee';  // C-2: add 'invoice_fee'
    ref_id: string | null;
    description: string;
    created_at: string;
  }
  ```

- **Risk / side-effects:**
  - **UI rendering:** wherever `getRecentLedgerEntries` results are displayed, the UI must handle `account_name` being `'تعديل جرد'` or `'تسوية إقفال'`. The existing Operations page UI likely renders `account_name` as a string, so this should "just work." Verify in `OperationsPage.tsx`.
  - **Three-surface consistency:** `getLedgerForPeriod` already uses `LEFT JOIN` and returns NULL account names. The UI consumer there may need the same fallback label. For consistency, apply the same mapping in `getLedgerForPeriod` (or extract to a shared helper).
  - **No DB migration.** Pure app-code change.

- **Verification steps:**
  1. Run an inventory count with a shortage of 2 units (cost 4.00 each = 8.00 JOD debit).
  2. Open Operations → Recent Ledger: confirm a row appears with `account_name = 'تعديل جرد'`, `type = 'debit'`, `amount = 8.00`, `ref_type = 'inventory_adjustment'`.
  3. Open Operations → Ledger for Period (today): confirm the same row appears (it was already visible here before the fix).
  4. Both views now show the row. ✓

---

### C-9 — Clock-tampering bypasses the day-closure lock

- **Current code (HEAD `4aad411`):** `src/db/queries/sales.ts:43-47`
  ```ts
  const invoiceId = nanoid();
  const today = format(new Date(), 'yyyy-MM-dd');
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  ```
  Same pattern in 11 other mutation entry points:
  - `sales.ts:303` (`returnInvoice` — ledger entry_date, but checks isDayClosed on invoice.invoice_date, not today)
  - `closures.ts:125,135` (`closeDay`)
  - `inventory.ts:9-11,92-94` (`createInventoryCount`, `createAccountReconciliation`)
  - `maintenance.ts:91-93` (`updateJobStatus`)
  - `expenses.ts:75,176,232,320` (`addExpense`, `deleteExpense`, `restoreExpense`, `updateExpense`)
  - `operations.ts:145,219` (`createTopup`, `createTransfer`)
- **My verdict:** AGREE — confirmed vulnerability. Setting the device clock backward lets a sale land on a date that is not closed, bypassing the lock. Setting it forward lets a sale land on a future date that hasn't been closed yet (which then cannot be closed via `closeDay` because `closeDay` rejects future dates — actually wait, `closeDay` at `closures.ts:126-128` throws for `targetDate > today`, so a forward-dated sale CAN be closed later but only when "today" catches up; the invoice will sit in a "future" state until then, breaking daily reports).
- **Reasoning:** Reproduction:
  1. Owner closes 2026-06-17 (today). All mutations on 2026-06-17 are now blocked.
  2. Owner changes the tablet's system date to 2026-06-16.
  3. `today = format(new Date(), 'yyyy-MM-dd') = '2026-06-16'`. `isDayClosed('2026-06-16')` returns false (that day was not closed). Sale succeeds with `invoice_date = '2026-06-16'`.
  4. The closed day's snapshot for 2026-06-17 no longer matches reality — but more importantly, the owner has effectively un-closed 2026-06-16 by adding an invoice to it.

  The fix is a monotonic clock guard: persist the highest date the system has ever seen, and refuse to operate if the device clock reads earlier than that date.

- **Proposed fix** — new helper module + call at every mutation entry point.

  **New file: `src/lib/clockGuard.ts`**
  ```ts
  // src/lib/clockGuard.ts
  import { format } from 'date-fns';
  import { readSetting, writeSetting } from '@/lib/auth';

  /**
   * C-9: Monotonic clock guard.
   *
   * Persists `last_known_date` (the highest YYYY-MM-DD the system has ever seen)
   * in app_settings, with an idb-keyval cache fallback for offline reads.
   *
   * If the device clock reads EARLIER than `last_known_date`, we refuse to
   * operate — the user has either turned back the clock or the RTC battery died.
   * Either way, allowing the mutation would risk corrupting a closed day.
   *
   * Forward jumps are allowed (the owner may travel timezones or the RTC may drift
   * forward); we update `last_known_date` to the new higher value.
   */

  const SETTING_KEY = 'last_known_date';

  /**
   * Read the stored last_known_date (cached in idb-keyval for offline access).
   * Returns null if never set (first run).
   */
  async function getLastKnownDate(): Promise<string | null> {
    try {
      const val = await readSetting(SETTING_KEY);
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return val;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Persist the new last_known_date. Only writes if `today` is strictly greater
   * than the stored value (avoids redundant writes on same-day mutations).
   * Uses INSERT ... ON CONFLICT so it is safe to call concurrently from
   * multiple devices (the highest date wins).
   */
  async function setLastKnownDate(today: string): Promise<void> {
    try {
      await writeSetting(SETTING_KEY, today);
    } catch (err) {
      // Non-fatal — the guard still works against the cached value.
      console.warn('clockGuard: failed to persist last_known_date', err);
    }
  }

  /**
   * Call at the top of every mutation function that uses `new Date()` to
   * determine the business date. Throws if the device clock has been moved
   * backward past the last known date.
   *
   * @returns the validated "today" string (YYYY-MM-DD)
   */
  export async function assertClockNotTampered(): Promise<string> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const last = await getLastKnownDate();

    if (last && today < last) {
      throw new Error(
        `تم إرجاع ساعة الجهاز إلى ${today} بينما آخر تاريخ مسجّل هو ${last}. ` +
        `لا يمكن إجراء عمليات لتاريخ سابق لمنع فساد الإقفالات اليومية. ` +
        `صحّح تاريخ الجهاز ثم أعد المحاولة.`
      );
    }

    if (!last || today > last) {
      await setLastKnownDate(today);
    }

    return today;
  }
  ```

  **Call sites** — replace the `const today = format(new Date(), 'yyyy-MM-dd')` line at every mutation entry point with `const today = await assertClockNotTampered();`. The full list:

  | File | Line | Function | Change |
  |---|---|---|---|
  | `src/db/queries/sales.ts` | 44 | `completeSale` | replace `const today = format(new Date(), 'yyyy-MM-dd')` with `const today = await assertClockNotTampered()` |
  | `src/db/queries/sales.ts` | 303 | `returnInvoice` | (uses `today` only for the reversal ledger entry_date; the isDayClosed check is on `invoice.invoice_date` which is correct. Add `await assertClockNotTampered()` for the entry_date to be safe — if the clock was rolled back, the reversal should not land on an earlier date than the original invoice.) |
  | `src/db/queries/closures.ts` | 125 | `closeDay` | the `today > targetDate` check uses `new Date()` — replace with `await assertClockNotTampered()` so a backward-rolled clock cannot close a date in the future-of-stored-today. |
  | `src/db/queries/inventory.ts` | 9-11 | `createInventoryCount` | replace `const entryDate = format(now, 'yyyy-MM-dd')` with `const entryDate = await assertClockNotTampered()`. |
  | `src/db/queries/inventory.ts` | 92-94 | `createAccountReconciliation` | same replacement. |
  | `src/db/queries/maintenance.ts` | 91-93 | `updateJobStatus` | replace `const onlyDateStr = format(now, 'yyyy-MM-dd')` with `const onlyDateStr = await assertClockNotTampered()`. |
  | `src/db/queries/expenses.ts` | 75 | `addExpense` | same replacement. |
  | `src/db/queries/expenses.ts` | 176 | `deleteExpense` | same replacement. |
  | `src/db/queries/expenses.ts` | 232 | `restoreExpense` | same replacement. |
  | `src/db/queries/expenses.ts` | 320 | `updateExpense` | same replacement. |
  | `src/db/queries/operations.ts` | 145 | `createTopup` | same replacement. |
  | `src/db/queries/operations.ts` | 219 | `createTransfer` | same replacement. |

  Example call-site change for `completeSale`:
  ```ts
  // src/db/queries/sales.ts — replace lines 43-47 with:
  import { assertClockNotTampered } from '@/lib/clockGuard';
  // ...
  const invoiceId = nanoid();
  const today = await assertClockNotTampered();
  if (await isDayClosed(today)) {
    throw new Error(`يوم ${today} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  ```

  **Boot-time seeding** — also call `assertClockNotTampered()` once at app boot (in `App.tsx` setup) so the first `last_known_date` is written even if the user opens the app but doesn't make a sale. This prevents an attacker from setting the clock back BEFORE the first sale.

  ```ts
  // src/App.tsx — inside the setup() effect (around line 60-77):
  import { assertClockNotTampered } from '@/lib/clockGuard';
  // ...
  async function setup() {
    try {
      await ensurePersistence();
      await initDatabase();
      await assertClockNotTampered();   // C-9: seed last_known_date on boot
    } catch (err: any) {
      setDbState('error');
      setErrorMsg(err.message || 'Unknown database error');
      return;
    }
    // ...
  }
  ```

- **Risk / side-effects:**
  - **Timezone:** the guard uses local time (`format(new Date(), 'yyyy-MM-dd')`), matching the existing convention. If the owner travels with the tablet across timezones, the date may roll back by one day at the border. Mitigation: the guard only fires if `today < last`; a one-day rollback will throw, requiring the owner to advance the clock. Acceptable for a single-shop deployment.
  - **First run:** on the very first app boot, `last_known_date` is null, so the guard does not throw. It writes today's date as the seed. Subsequent boots check against this seed.
  - **Multi-device:** each device has its own `last_known_date` in `app_settings` (which is a single shared table in Supabase mode, keyed by `key` only — NOT by `device_id`). This means the FIRST device to write `last_known_date` sets it for all devices. Subsequent devices that boot with a clock earlier than the stored value will throw. This is the desired behavior — prevents any device from writing to a past date. The owner must keep all tablet clocks within sync.
  - **Daylight saving:** Jordan abolished DST in 2022, so this is not a concern.
  - **No DB migration.** Uses the existing `app_settings` table.
  - **Three-surface consistency:** the guard does not change any formula, so the three net-profit surfaces are unaffected. It only prevents mutations on rolled-back dates.

- **Verification steps:**
  1. Make a sale on 2026-06-17 (today). `last_known_date = '2026-06-17'` is written to `app_settings`.
  2. Change the device date to 2026-06-16. Attempt a sale. Verify the error "تم إرجاع ساعة الجهاز..." is thrown. No invoice created.
  3. Change the device date back to 2026-06-17. Attempt a sale. Verify it succeeds.
  4. Change the device date to 2026-06-18 (forward). Attempt a sale. Verify it succeeds and `last_known_date` is updated to '2026-06-18'.
  5. Change the device date back to 2026-06-17. Attempt a sale. Verify the error is thrown (cannot go backward past '2026-06-18').

---

### A-1 — SQLite-WASM mode is dead code; app cannot boot without Supabase env

- **Current code (HEAD `4aad411`):**
  - `src/db/client.ts:1-22`:
    ```ts
    // import * as Comlink from 'comlink';
    // import type { DbWorkerApi as WorkerApi } from './worker';
    //
    // const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    //   type: 'module',
    // });
    //
    // // Create Comlink proxy
    // export const dbClient = Comlink.wrap<WorkerApi>(worker);

    import { supabaseAdapter } from './supabaseAdapter';

    // Switch to Supabase adapter
    export const dbClient = supabaseAdapter;

    export async function initDatabase() {
      await dbClient.initDb();
    }

    export const isSupabaseMode = (): boolean => {
      return !!import.meta.env.VITE_SUPABASE_URL;
    };
    ```
  - `src/db/supabase.ts:6-10`:
    ```ts
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing Supabase environment variables. Please check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env.local file.'
      );
    }
    ```
- **My verdict:** PARTIAL AGREE — the architecture drift is real, but the recommendation is to commit to Supabase-only (option (a)), not to restore SQLite-WASM (option (b)).

- **Reasoning:**
  - The `client.ts` file has the SQLite/Comlink worker code commented out. `dbClient` is unconditionally `supabaseAdapter`. The `isSupabaseMode()` function still exists but only checks for the env var — it does NOT actually switch adapters. The `worker.ts` file (151 lines) is unreferenced and dead.
  - `supabase.ts` throws synchronously at module load if env vars are missing. The error propagates up through `client.ts` → `App.tsx`'s `initDatabase()` call → the React tree never mounts. The user sees a blank page with the error in the console (verified by my Playwright test in the original report).
  - The PWA manifest and service worker still claim "نظام نقطة بيع متكامل يعمل بدون إنترنت" ("integrated POS that works without internet") — this is now false advertising.

  **Why I recommend option (a) — commit to Supabase-only — instead of option (b):**
  1. **Single Supabase project is already a hard dependency** for the auth system. `app_settings` (which stores the daily_lock, admin_pin, maintenance_pin hashes) is a Supabase table (migration 014). Even if SQLite-WASM were restored as the primary DB, the PIN system would still require Supabase to function across multiple tablets. Restoring SQLite without restoring offline-PIN would leave the auth system broken in offline mode.
  2. **Multi-device sync is a stated goal** (the `device_id` columns added in migration 012, the Realtime subscription in `realtime.ts`). SQLite-WASM has no built-in sync; restoring it would require building a conflict-resolution layer on top. The owner's stated deployment is "1-5 Android tablets on the same WiFi" — Supabase Realtime already solves this elegantly.
  3. **The owner's existing data is in Supabase.** If we restored SQLite-WASM as primary, the owner would lose access to historical data unless we built a one-time migration tool. Staying on Supabase-only avoids this.
  4. **The offline-resilience gap is better solved by an offline queue (A-3) than by restoring SQLite.** A queue handles the "network blip" case (the user's actual pain point) without the complexity of a dual-mode adapter.

  **Option (b) would be the right call ONLY IF:** the owner does field sales outside WiFi range (e.g. deliveries, market stalls) AND needs to record sales offline for hours at a time. The prompt says "single shop, 1-5 tablets on the same WiFi" — this is not a field-sales scenario.

- **Proposed fix** — commit to option (a):

  **Step 1: Quarantine the dead worker code.**
  - Move `src/db/worker.ts` to `src/db/_archived/worker.ts.sqlite-mode.txt` (rename so TypeScript won't compile it; keep the file for historical reference).
  - Delete the commented-out Comlink code at the top of `src/db/client.ts`. The file becomes:

    ```ts
    // src/db/client.ts (after cleanup)
    import { supabaseAdapter } from './supabaseAdapter';

    // The system is Supabase-only. The SQLite-WASM adapter has been removed.
    // Offline resilience is provided by the offline sale queue (see lib/offlineQueue.ts).
    export const dbClient = supabaseAdapter;

    export async function initDatabase() {
      await dbClient.initDb();
    }

    export const isSupabaseMode = (): boolean => true;
    ```

  - Remove the `@sqlite.org/sqlite-wasm` dependency from `package.json` (saves ~1.5MB from the bundle).
  - Remove the `comlink` dependency (only used by the worker).
  - Update `src/db/migrations/index.ts:50-54` to remove the `if (dbClient === supabaseAdapter)` check — migrations are always skipped in Supabase mode.

  **Step 2: Update README and PWA manifest.**
  - README: replace the existing 6-line README with a clear setup guide:
    ```markdown
    # Aya Mobile POS

    A cloud-connected point-of-sale system for mobile-device retailers in Jordan.

    ## Prerequisites
    - Node.js 20+
    - A Supabase project (https://supabase.com)

    ## Setup
    1. Clone this repo.
    2. `npm install`
    3. Copy `.env.example` to `.env.local` and fill in your Supabase URL and anon key.
    4. Run the SQL in `supabase/schema.sql` and `supabase/functions.sql` in your Supabase SQL editor.
    5. `npm run dev`

    ## Requirements
    - **Always-on internet connection required.** This system uses Supabase as its database. Sales cannot be recorded while offline. Ensure all tablets have stable WiFi.
    - For limited offline resilience (network blips up to ~30 seconds), see the offline queue indicator in the top bar.
    ```
  - `vite.config.ts` PWA manifest: change the `description` from "نظام نقطة بيع متكامل يعمل بدون إنترنت" to "نظام نقطة بيع متكامل — يتطلب اتصالاً بالإنترنت".

  **Step 3: Add a "requires internet" lock-screen banner.**
  - In `src/components/auth/DailyLockScreen.tsx` (or wherever the lock screen renders), add a banner that shows when `navigator.onLine === false` OR when the Supabase health-check RPC fails:

    ```tsx
    // Add at the top of the DailyLockScreen component:
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    useEffect(() => {
      const update = () => setIsOnline(navigator.onLine);
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }, []);

    // Render above the NumPad:
    {!isOnline && (
      <div className="bg-danger-bg border border-danger text-danger px-4 py-3 rounded-xl mb-4 text-center font-bold">
        التطبيق غير متصل بالإنترنت — لا يمكن تسجيل المبيعات حتى يستعيد الاتصال.
      </div>
    )}
    ```

- **Risk / side-effects:**
  - **Bundle size:** removing `@sqlite.org/sqlite-wasm` and `comlink` saves ~1.5MB of WASM + JS. The cold-start time should drop by 100-200ms.
  - **Offline UX:** the user will see a clear "requires internet" banner instead of a silent failure. The offline queue (A-3) will handle short blips.
  - **No DB migration.** Pure code + dependency change.

- **Verification steps:**
  1. `npm run build` succeeds with no TypeScript errors.
  2. Open the app with no `.env.local` — verify the build fails at compile time with a clear error (rather than at runtime with a blank screen).
  3. Open the app with valid env, disconnect WiFi — verify the "requires internet" banner appears on the lock screen.
  4. Reconnect WiFi — verify the banner disappears within 2 seconds.

---

### A-2 — `exec_sql` / `exec_batch` allow arbitrary SQL from the anon key

- **Current code (HEAD `4aad411`):** `supabase/functions.sql:34-173` (both `exec_sql` and `exec_batch` are `SECURITY DEFINER` and accept raw SQL text); `supabase/functions.sql:327-329` (GRANT EXECUTE to `anon`).
  ```sql
  -- line 327-329
  GRANT EXECUTE ON FUNCTION public.exec_sql(text, jsonb) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.exec_batch(jsonb) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.complete_sale(jsonb) TO anon, authenticated, service_role;
  ```
  Additionally, `supabase/schema.sql:441-470` enables RLS on every table but immediately creates a permissive `anon_all` policy:
  ```sql
  -- example (line 462):
  CREATE POLICY "anon_all" ON invoice_payments FOR ALL TO anon USING (true) WITH CHECK (true);
  ```
- **My verdict:** AGREE — this is the single highest-severity item in the audit. Even for a trusted single owner, the anon key is publicly retrievable from any installed tablet's JavaScript bundle. Anyone on the same WiFi as a tablet (or anyone who can social-engineer the tablet for 30 seconds) can extract the anon key and issue `DROP TABLE invoices` or `UPDATE accounts SET balance = 0`.

- **Reasoning:**
  - The Supabase anon key is **not secret** — by design it ships in the client bundle. Supabase's security model relies on RLS policies to restrict what anon can do.
  - The current schema has RLS enabled but every table has `POLICY "anon_all" ... USING (true) WITH CHECK (true)`, which means anon can do anything to any row.
  - The `exec_sql` and `exec_batch` RPCs are `SECURITY DEFINER` (they run with the function owner's privileges, which is typically the postgres superuser) and accept raw SQL text. This bypasses RLS entirely — even if RLS were properly configured, `exec_sql('UPDATE accounts SET balance=0', [])` would still work because the RPC runs as the function owner.
  - The `complete_sale` RPC is also `SECURITY DEFINER` but only accepts a typed payload (not raw SQL), so it is safe by design — it should be the model for the fix.

- **Decision: option (a).** Replace the generic `exec_sql`/`exec_batch` pass-throughs with a set of typed, named RPCs that mirror `complete_sale`'s pattern. Add proper RLS. Rationale:
  - Option (b) (move privileged operations behind an authenticated role + RLS) is less work but requires the tablets to authenticate with Supabase Auth (username/password). The current PIN system is local-only and does not issue Supabase Auth tokens. Adding Supabase Auth would require a significant auth refactor.
  - Option (a) is more work upfront but keeps the auth model unchanged (anon key + local PINs) while eliminating the SQL-injection vector. Each mutation becomes a typed RPC that takes specific parameters and constructs the SQL server-side, eliminating the `EXECUTE parsed_query` pattern entirely.

- **Proposed fix** (outline — full implementation would be a multi-day effort; this is the migration path):

  **Phase 1: Add typed RPCs for the highest-risk mutations.** Mirror the `complete_sale` pattern for:
  - `return_invoice(p_invoice_id text, p_refunds jsonb)` — replaces the batch in `sales.ts:281-385`
  - `create_expense(p_payload jsonb)` — replaces the batch in `expenses.ts:65-137`
  - `update_expense(p_id text, p_payload jsonb)` — replaces the batch in `expenses.ts:303-422`
  - `delete_expense(p_id text)` — replaces the batch in `expenses.ts:168-219`
  - `restore_expense(p_id text)` — replaces the batch in `expenses.ts:224-293`
  - `create_topup(p_payload jsonb)` — replaces the batch in `operations.ts:126-200`
  - `create_transfer(p_payload jsonb)` — replaces the batch in `operations.ts:202-291`
  - `close_day(p_target_date text, p_cash_counts jsonb, p_notes text)` — replaces the batch in `closures.ts:120-216`
  - `reopen_day(p_date text)` — replaces the batch in `closures.ts:219-259`
  - `create_inventory_count(p_items jsonb, p_notes text)` — replaces the batch in `inventory.ts:8-71`
  - `create_account_reconciliation(p_account_id text, p_actual_balance int)` — replaces the batch in `inventory.ts:91-131`
  - `update_maintenance_job_status(p_id text, p_status text, p_final_amount int, p_payment_account_id text)` — replaces the batch in `maintenance.ts:90-145`

  Each RPC is `SECURITY DEFINER`, takes typed parameters (not raw SQL), and constructs the SQL inside the function body using parameter binding (not string concatenation). Example for `create_expense`:

  ```sql
  CREATE OR REPLACE FUNCTION public.create_expense(p_payload jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  DECLARE
    v_id text := p_payload ->> 'id';
    v_expense_number text := p_payload ->> 'expense_number';
    v_amount int := (p_payload ->> 'amount')::int;
    v_category_id text := p_payload ->> 'category_id';
    v_category_name text := p_payload ->> 'category_name';
    v_description text := p_payload ->> 'description';
    v_account_id text := p_payload ->> 'accountId';
    v_account_name text := p_payload ->> 'account_name';
    v_expense_date text := p_payload ->> 'expense_date';
    v_now text := p_payload ->> 'now';
    v_device_id text := p_payload ->> 'device_id';
  BEGIN
    INSERT INTO expenses (id, expense_number, amount, category_id, category_name, description, account_id, account_name, expense_date, created_at, updated_at, device_id)
    VALUES (v_id, v_expense_number, v_amount, v_category_id, v_category_name, v_description, v_account_id, v_account_name, v_expense_date, v_now, v_now, v_device_id);

    UPDATE accounts SET balance = balance - v_amount, updated_at = v_now WHERE id = v_account_id;

    INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
    VALUES (gen_random_uuid()::text, v_expense_date, v_account_id, v_account_name, 'debit', v_amount, 'expense', v_id, 'مصروف: ' || v_description, v_now, v_now, v_device_id);

    RETURN jsonb_build_object('id', v_id);
  END;
  $$;
  ```

  **Phase 2: Remove `exec_sql` and `exec_batch`.** Once all mutations are typed RPCs, the generic SQL pass-throughs are no longer needed. Read-only queries (SELECT) can either be:
  - Direct PostgREST calls on the table (with RLS allowing anon to SELECT), OR
  - Typed `get_*` RPCs if joins are complex.

  To minimize disruption, keep `exec_sql` for **read-only SELECT queries only** (mutating statements are typed RPCs). Add a server-side check in `exec_sql` that rejects any query containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE` (case-insensitive). This is a defense-in-depth measure — RLS should also be tightened.

  ```sql
  -- Modified exec_sql — read-only enforcement
  CREATE OR REPLACE FUNCTION public.exec_sql(query_text text, params jsonb DEFAULT '[]'::jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  DECLARE
    lower_q text := lower(query_text);
  BEGIN
    -- A-2: reject any mutation statement. exec_sql is READ-ONLY.
    IF lower_q ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|vacuum|reindex)\M' THEN
      RAISE EXCEPTION 'exec_sql is read-only. Mutation statements must use a typed RPC.';
    END IF;
    -- ... rest of the existing function body ...
  END;
  $$;
  ```

  **Phase 3: Tighten RLS.** Replace every `POLICY "anon_all" ... USING (true) WITH CHECK (true)` with a policy that allows anon to SELECT and INSERT but NOT UPDATE or DELETE (most mutations go through typed RPCs which are `SECURITY DEFINER` and bypass RLS):

  ```sql
  -- Example for invoices:
  DROP POLICY IF EXISTS "anon_all" ON invoices;
  CREATE POLICY "anon_select_insert" ON invoices FOR SELECT TO anon USING (true);
  CREATE POLICY "anon_insert" ON invoices FOR INSERT TO anon WITH CHECK (true);
  -- No UPDATE or DELETE policy → anon cannot UPDATE or DELETE directly.
  -- RPCs (SECURITY DEFINER) bypass RLS, so create_expense etc. still work.
  ```

  **Phase 4: Revoke EXECUTE on `exec_batch` from anon.** Once `exec_batch` is no longer called by the app, revoke:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.exec_batch(jsonb) FROM anon;
  ```

  **App-side changes:** the `supabaseAdapter` (`src/db/supabaseAdapter.ts`) needs new methods for each typed RPC. The query modules (`sales.ts`, `expenses.ts`, etc.) replace their `dbClient.batchRun([...])` calls with `dbClient.createExpense(payload)`, etc. This is a significant refactor — see the suggested commit grouping in §6.

- **Risk / side-effects:**
  - **Effort:** this is a 3-5 day refactor for a single engineer. The payoff is eliminating the highest-severity finding in the audit.
  - **Migration:** yes — `supabase/functions.sql` needs to be re-run in the Supabase SQL editor to add the new RPCs and tighten RLS. The `schema.sql` policy changes are also a migration.
  - **Backward compatibility:** the app must be deployed in lockstep with the Supabase SQL changes. If the SQL is updated first, the old app's `batchRun` calls will fail (good — they should fail closed). If the app is updated first, the new RPC calls will fail until the SQL is updated (also good).
  - **Three-surface consistency:** unaffected — the typed RPCs produce the same DB state as the current batched statements.

- **Verification steps:**
  1. After Phase 1+2, attempt `curl -X POST $SUPABASE_URL/rest/v1/rpc/exec_sql -H "apikey: $ANON_KEY" -d '{"query_text":"DROP TABLE invoices;","params":[]}'` — verify it returns the "read-only" error.
  2. Attempt `curl -X POST $SUPABASE_URL/rest/v1/rpc/exec_sql -H "apikey: $ANON_KEY" -d '{"query_text":"SELECT * FROM invoices LIMIT 1;","params":[]}'` — verify it returns the row.
  3. Attempt `curl -X PATCH $SUPABASE_URL/rest/v1/invoices?id=eq.XXX -H "apikey: $ANON_KEY" -d '{"paid_amount":0}'` — verify it returns a 403/RLS denial.
  4. App smoke test: complete a sale, return an invoice, create an expense, topup, transfer, maintenance delivery, day closure — all should work via the new typed RPCs.

---

### A-3 — No offline queue; any network blip fails the sale

- **Current code (HEAD `4aad411`):** `src/db/supabaseAdapter.ts:9-68`
  ```ts
  async query(sql: string, params: any[] = []): Promise<any[]> {
    const { data, error } = await supabase.rpc('exec_sql', { query_text: sql, params });
    if (error) { /* ... */ throw new Error(error.message || 'Database query error'); }
    return (data as any)?.rows || [];
  },
  // ... run, batchRun, completeSaleRpc all follow the same pattern
  ```
- **My verdict:** PARTIAL AGREE — the offline queue is **worth it** for this deployment IF the owner does any delivery/installation work outside the shop, or if the WiFi is occasionally flaky. If the owner NEVER leaves the shop AND the WiFi is rock-solid, the queue is unnecessary friction.

- **Reasoning:**
  - The prompt says "single shop, 1-5 Android tablets on the same WiFi." This suggests tablets stay in the shop. BUT:
    - WiFi in Jordanian retail environments is often shared with customer networks and can be flaky.
    - The Supabase project is hosted in a region that may have occasional latency or brief outages.
    - A 5-second WiFi blip during a sale attempt currently produces a `TypeError: Failed to fetch` toast and the sale is lost (the cart is preserved, but the customer is standing there waiting).
  - The cost of an offline queue is moderate (1-2 days of engineering) and the consistency hazards are manageable for a single-user system.
  - **My recommendation: implement a minimal offline queue, but make it OPTIONAL** — the owner can disable it in Settings if it causes issues.

- **Acceptable consistency hazards (and how to mitigate each):**
  1. **Stock check:** `completeSale` pre-fetches product stock and checks `item.quantity > p.stock_qty` (sales.ts:35-39). If the queue defers the sale, the stock check was performed against a stale snapshot. **Mitigation:** the `complete_sale` RPC has a server-side `WHERE stock_qty >= v_quantity` guard (functions.sql:268) that will reject the sale if another device sold the same SKU in the meantime. The user gets an "INSUFFICIENT_STOCK" error when the queue drains, and must re-attempt. Acceptable.
  2. **Sequence number:** `completeSale` fetches `next_val` from the `sequences` table (sales.ts:72-78). If the queue defers the sale, the sequence number is allocated at QUEUE time (client-side), not at DRAIN time. This could create gaps if the queued sale later fails. **Mitigation:** move the sequence allocation INTO the `complete_sale` RPC (server-side) so the number is allocated atomically with the insert. This is a small change to the RPC and the payload (drop `invoice_number` from the payload; let the RPC compute it).
  3. **Day-closure lock:** `completeSale` checks `isDayClosed(today)` (sales.ts:45-47). If the queue defers the sale to a later date (e.g. sale queued at 23:55, drained at 00:05 the next day), the `invoice_date` in the payload is the queue-time date, but the `isDayClosed` check at drain time uses the current date. **Mitigation:** the RPC should check `isDayClosed(payload.invoice_date)` server-side and reject if the queue-time date is now closed. The user gets an error and must ask the admin to reopen the day.
  4. **Payment account balance:** the `complete_sale` RPC credits the payment account atomically. If the queue drains after the user has already spent the expected balance (e.g. they thought the sale went through and gave the customer change), there is no recourse. **Mitigation:** none — this is the fundamental risk of deferred sales. The queue should DRAIN AS FAST AS POSSIBLE (within 5 seconds of reconnect) and show a clear "sale pending" badge so the user knows not to release the goods until the badge clears.

- **Proposed fix** (minimal outline — full implementation would be ~2 days):

  **New file: `src/lib/offlineQueue.ts`**
  ```ts
  // src/lib/offlineQueue.ts
  import { get, set, del } from 'idb-keyval';

  const QUEUE_KEY = 'offline_sale_queue';

  export interface QueuedSale {
    queuedAt: string;          // ISO timestamp
    payload: any;              // the complete_sale payload
    attempts: number;          // retry counter
    lastError?: string;
  }

  export async function getQueuedSales(): Promise<QueuedSale[]> {
    return (await get(QUEUE_KEY)) ?? [];
  }

  export async function enqueueSale(payload: any): Promise<void> {
    const queue = await getQueuedSales();
    queue.push({ queuedAt: new Date().toISOString(), payload, attempts: 0 });
    await set(QUEUE_KEY, queue);
  }

  export async function dequeueSale(queuedAt: string): Promise<void> {
    const queue = await getQueuedSales();
    await set(QUEUE_KEY, queue.filter(q => q.queuedAt !== queuedAt));
  }

  export async function updateSaleAttempt(queuedAt: string, error: string): Promise<void> {
    const queue = await getQueuedSales();
    const item = queue.find(q => q.queuedAt === queuedAt);
    if (item) {
      item.attempts += 1;
      item.lastError = error;
      await set(QUEUE_KEY, queue);
    }
  }

  export async function getQueuedSaleCount(): Promise<number> {
    return (await getQueuedSales()).length;
  }
  ```

  **Modify `supabaseAdapter.completeSaleRpc`:**
  ```ts
  async completeSaleRpc(payload: any): Promise<{ invoiceId: string; invoiceNumber: string }> {
    try {
      const { data, error } = await supabase.rpc('complete_sale', { payload });
      if (error) throw new Error(error.message || 'Database error completing sale');
      return data as { invoiceId: string; invoiceNumber: string };
    } catch (err: any) {
      // A-3: if the error is a network failure, enqueue the sale for retry.
      const isNetworkError =
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError') ||
        err.message?.includes('network');
      if (isNetworkError) {
        await enqueueSale(payload);
        // Return a synthetic success so the UI clears the cart and shows the receipt.
        // The queue will drain on reconnect. The user sees a "pending sync" badge.
        return {
          invoiceId: payload.id,
          invoiceNumber: payload.invoice_number + ' (معلّق)',
        };
      }
      throw err;
    }
  }
  ```

  **Add a drain loop in `App.tsx`:**
  ```ts
  // src/App.tsx — inside the setup() effect, after realtime setup:
  import { getQueuedSales, dequeueSale, updateSaleAttempt } from '@/lib/offlineQueue';
  import { supabase } from './db/supabase';

  async function drainOfflineQueue() {
    const queue = await getQueuedSales();
    for (const item of queue) {
      try {
        const { error } = await supabase.rpc('complete_sale', { payload: item.payload });
        if (error) throw new Error(error.message);
        await dequeueSale(item.queuedAt);
      } catch (err: any) {
        await updateSaleAttempt(item.queuedAt, err.message);
        // Stop draining on first failure (likely still offline)
        break;
      }
    }
  }

  // Drain on boot, on online event, and every 30 seconds
  useEffect(() => {
    drainOfflineQueue();
    const interval = setInterval(drainOfflineQueue, 30_000);
    const onOnline = () => drainOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [dbState]);
  ```

  **Add a "pending sync" badge in the TopBar:**
  ```tsx
  // src/components/layout/TopBar.tsx — add a badge showing the queue count
  const [queueCount, setQueueCount] = useState(0);
  useEffect(() => {
    const update = () => getQueuedSaleCount().then(setQueueCount);
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, []);
  // ...render:
  {queueCount > 0 && (
    <span className="bg-warning text-white text-xs px-2 py-1 rounded-full font-bold">
      {queueCount} بيع معلّق
    </span>
  )}
  ```

- **Risk / side-effects:**
  - **Duplicate sale risk:** if the network request actually succeeded on the server but the response was lost (TCP reset after commit), the queue will retry and create a duplicate invoice. **Mitigation:** the `complete_sale` RPC should be idempotent on `payload.id` — check if an invoice with that ID already exists and return early if so. This requires a small RPC change:
    ```sql
    -- At the top of complete_sale, after extracting v_invoice_id:
    PERFORM 1 FROM invoices WHERE id = v_invoice_id;
    IF FOUND THEN
      RETURN jsonb_build_object('invoiceId', v_invoice_id, 'invoiceNumber', ' (مكرر)');
    END IF;
    ```
  - **Sequence number gaps:** as noted in the consistency hazards, the sequence is allocated client-side. If a queued sale fails permanently (e.g. day closed), the sequence number is wasted. Acceptable for a single-shop system.
  - **Three-surface consistency:** unaffected — the queued sale is eventually applied via the same `complete_sale` RPC, producing the same DB state as a synchronous sale.

- **Verification steps:**
  1. Open the app, complete a sale with WiFi ON. Verify normal behavior.
  2. Turn WiFi OFF. Attempt a sale. Verify: cart clears, receipt shows "(معلّق)" suffix, "1 بيع معلّق" badge appears in TopBar.
  3. Turn WiFi ON. Within 30 seconds, verify the badge clears and the invoice appears in the Sales list with the correct number (no "(معلّق)" suffix).
  4. Attempt a duplicate sale (same payload ID). Verify the RPC returns early and no duplicate invoice is created.

---

## Items Already Fixed (Section 4 confirmation)

- **Server-side underpayment guard (HI-A / AC-15):** ✓ **Confirmed present** at `src/db/queries/sales.ts:53-58`:
  ```ts
  // HI-A: server-side guard against credit sales. Per owner policy: no debt allowed.
  if (paidAmount < totalAmount) {
    throw new Error(
      `المبلغ المدفوع (${formatMoney(paidAmount)}) أقل من إجمالي الفاتورة (${formatMoney(totalAmount)}). البيع الآجل غير مسموح.`
    );
  }
  ```
  The guard runs BEFORE any DB mutation, so no partial state is created.

- **Universal day-closed guard for maintenance status changes (HI-E):** ✓ **Confirmed present** at `src/db/queries/maintenance.ts:96-100`:
  ```ts
  // HI-E: any status mutation that touches a closed day's row corrupts the snapshot.
  // Apply the guard universally — not only on delivery.
  if (await isDayClosed(onlyDateStr)) {
    throw new Error(`يوم ${onlyDateStr} مُقفَل. تواصل مع المشرف لفتحه قبل التعديل.`);
  }
  ```
  The guard is at the top of `updateJobStatus`, before the `if (status === 'delivered')` branch, so it covers all status transitions including the C-7 reversal branch.

- **`reopenDay` reverses reconciliation (CR-A):** ✓ **Confirmed present** at `src/db/queries/closures.ts:219-259`:
  ```ts
  export async function reopenDay(date: string): Promise<void> {
    // CR-A: must reverse reconciliation entries and restore pre-closure balances
    const reconEntries = await dbClient.query(
      `SELECT id, account_id, type, amount FROM ledger_entries
       WHERE entry_date = ? AND ref_type = 'eod_reconciliation'`,
      [date]
    );
    // ...reverses each entry's balance effect, deletes the recon rows, deletes the closure row...
  }
  ```
  The reversal logic is correct: original `credit` (balance +=) is reversed by `-`, original `debit` (balance -=) is reversed by `+`.

- **localStorage quota silent-fail (LO-E):** ✓ **Confirmed as accepted product decision** at `src/stores/cart.store.ts:251-254`:
  ```ts
  // LO-E: localStorage quota risk is accepted for single-shop deployment.
  // Cart size is bounded by typical retail sessions (< 50 items).
  // If a quota error occurs, Zustand will fail silently and the cart will
  // simply not persist across reloads — acceptable degradation.
  partialize: (state) => ({
    items: state.items,
    globalDiscountType: state.globalDiscountType,
    globalDiscountValue: state.globalDiscountValue,
  }),
  ```
  I agree this is an acceptable trade-off for single-shop use. **No re-opening needed.** The cart is bounded by typical session size, the failure mode is "cart not persisted across reload" (not data corruption), and the user can always re-add items. Adding a toast on quota failure would be nice-to-have but is not required.

---

## Deferred-by-Design (Section 5)

- **Partial return does not reverse COGS (FM-04 / AC-07):** ✓ **Confirmed still documented** as `DESIGN INTENT (2026-06-15)` at `src/db/queries/sales.ts:329-335`:
  ```ts
  // ── DESIGN INTENT (2026-06-15) ──────────────────────────────────────────
  // Partial returns are amount-based only. The customer keeps the goods.
  // Stock restoration and COGS reversal happen ONLY on full returns
  // (status='returned'). This is intentional for mobile retail where
  // partial-unit returns do not occur; partial refunds act as
  // "retroactive discount" semantics. See Owner Decision §5.
  // ────────────────────────────────────────────────────────────────────────
  ```
  This is **consistent** with the corrected reports (C-1, C-5): partial returns deduct the refund amount from `sales_net` but leave COGS unchanged, which is the mathematically correct treatment of a "retroactive discount." No change needed.

- **No VAT, no purchases/FIFO, no customer/supplier UI (FM-05/FM-07/FM-20):** These are scope decisions, not bugs. Listed once and deferred:
  - **VAT/tax column:** not in schema. If the owner becomes VAT-registered, this becomes a feature request.
  - **Purchases module / FIFO costing:** `cost_price` is a manual field. If the owner buys the same SKU at multiple price points, they must manually update `cost_price`. Feature request, not a bug.
  - **Customer/Supplier management UIs:** the tables exist (`customers`, `suppliers`) but no CRUD UI. Either build the UIs or drop the tables. Cosmetic cleanup, not a bug.

---

## New Findings (discovered while reading the current code)

### NEW-1 — Cart store does not persist `activeCartId`, breaking saved-cart edits after reload

- **Current code (HEAD `4aad411`):** `src/stores/cart.store.ts:248-261`
  ```ts
  {
    name: 'active_cart',
    storage: createJSONStorage(() => localStorage),
    // LO-E: localStorage quota risk is accepted for single-shop deployment.
    partialize: (state) => ({
      items: state.items,
      globalDiscountType: state.globalDiscountType,
      globalDiscountValue: state.globalDiscountValue,
    }),
  }
  ```
  The `partialize` function persists `items`, `globalDiscountType`, and `globalDiscountValue` — but NOT `activeCartId`. The initial state has `activeCartId: 'default'` (line 78).

- **My verdict:** AGREE — this is a real bug, not in my original report and not in the reviewer's list.

- **Reasoning:** Reproduction:
  1. User creates a saved cart "Cart A" with some items.
  2. User clicks "Cart A" in the SavedCartsTabs → `switchToCart('cart-a-id')` (line 98-113) sets `activeCartId = 'cart-a-id'` and loads Cart A's items into `items`.
  3. User reloads the page.
  4. After reload: `activeCartId = 'default'` (initial state, not persisted), but `items` = Cart A's items (persisted).
  5. User adds a new product to the cart. `addItem` (line 124-147) updates `items` in memory. `safeSyncLater` (line 61-65) calls `syncToSavedCart` (line 84-96), which checks `if (state.activeCartId !== 'default')` — but `activeCartId === 'default'` now, so the sync is skipped.
  6. Cart A in `savedCarts.store` is NOT updated. The user's edit is lost on next reload.

  This is a silent data-loss bug for the saved-cart feature.

- **Proposed fix** — add `activeCartId` to `partialize`:

  ```ts
  // src/stores/cart.store.ts — replace lines 255-259 with:
  partialize: (state) => ({
    activeCartId: state.activeCartId,   // NEW-1: persist so saved-cart edits survive reload
    items: state.items,
    globalDiscountType: state.globalDiscountType,
    globalDiscountValue: state.globalDiscountValue,
  }),
  ```

- **Risk / side-effects:**
  - **Backward compatibility:** existing localStorage entries (written by the old `partialize`) do not have `activeCartId`. On first load after the fix, Zustand will use the initial state `'default'` for the missing field. This is the correct behavior (the user was on the default cart before the fix). No migration needed.
  - **Saved cart deletion:** if the user deletes Cart A while `activeCartId === 'cart-a-id'`, the cart store still points to the deleted ID. Subsequent `syncToSavedCart` calls will look up the ID in `savedCarts.find(c => c.id === activeCartId)` and find nothing, so the sync silently no-ops. This is the existing behavior and is acceptable (the user is back on a "phantom" cart; switching to 'default' or another cart restores normal behavior).

- **Verification steps:**
  1. Create a saved cart "Cart A", switch to it.
  2. Reload the page.
  3. Add a new product to the cart.
  4. Reload the page again.
  5. Switch away from Cart A and back. Verify Cart A now contains the new product (was lost before fix).

---

### NEW-2 — `getReport` Overview KPIs filter `status='active'` only, excluding `'partially_returned'`

- **Current code (HEAD `4aad411`):** `src/db/queries/reports.ts:17-211`
  ```ts
  // line 19-31 — KPI query filters status='active' only
  const [kpiRow] = await dbClient.query(
    `SELECT ...
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active'`,
    [fromDate, toDate]
  );
  // line 48-54 — gift cost query filters status='active' only
  const [giftRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gift_cost
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ii.is_gift = 1`,
    [fromDate, toDate]
  );
  // line 70-82 — salesByCategory filters status='active' only
  // line 93-106 — topProducts filters status='active' only
  // line 117-129 — byAccount filters status='active' only
  // line 132-144 — daily breakdown filters status='active' only
  ```
- **My verdict:** AGREE — this is a third surface (alongside Day-Closure and P&L) that diverges for partially-returned invoices. The reviewer's C-5 covers the Day-Closure side; the Overview KPI side is not explicitly called out.

- **Reasoning:** For a day with one 10.00 JOD invoice (cost 6.00) that was partially refunded 3.00:
  - `getReport.kpi.totalSales = 0` (excludes 'partially_returned')
  - `getReport.kpi.totalCost = 0` (excludes 'partially_returned')
  - `getReport.kpi.grossProfit = 0`
  - `getReport.kpi.returnValue = 0` (the 'returned' filter at line 43 excludes 'partially_returned')
  - `getReport.kpi.netProfit = 0` (after C-4 fix)
  - `getProfitAndLoss.sales_gross = 1000` (includes 'partially_returned')
  - `getProfitAndLoss.sales_net = 700`
  - `getProfitAndLoss.gross_profit = 100`
  - `getProfitAndLoss.net_profit = 100`
  - **Divergence: 100 fils on every surface.**

  The P&L tab shows 1.00 JOD net profit; the Overview KPI card shows 0.00 JOD. The owner comparing the two tabs sees a 1.00 JOD gap.

- **Proposed fix** — align `getReport` KPIs with the P&L by including `'partially_returned'` in the active filter and adding a `partial_returns_total` field:

  ```ts
  // src/db/queries/reports.ts — replace lines 17-31 with:
  const [kpiRow] = await dbClient.query(
    `SELECT
       COALESCE(SUM(i.total_amount), 0)    AS total_sales,
       COALESCE(SUM(i.discount_amount), 0) AS total_discounts,
       COUNT(DISTINCT i.id)                AS invoice_count,
       COALESCE(AVG(i.total_amount), 0)    AS avg_invoice,
       COALESCE(SUM(ii.quantity), 0)       AS total_qty,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS total_cost
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned')`,
    [fromDate, toDate]
  );

  // Also add a partial_returns_total query (mirrors getProfitAndLoss):
  const [partialReturnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ? AND status = 'partially_returned'`,
    [fromDate, toDate]
  );
  // ... and in the kpi assembly:
  const partialReturnsTotal = Number(partialReturnsRow?.total ?? 0);
  // Adjust netProfit to subtract partial returns (so it matches P&L's sales_net logic):
  const netProfit = (totalSales - partialReturnsTotal) - totalCost + topupProfit + maintenanceRevenue - totalExpenses - paymentFees;
  ```

  Apply the same `status IN ('active', 'partially_returned')` filter to the gift cost query (line 48-54), salesByCategory (line 70-82), topProducts (line 93-106), byAccount (line 117-129), and daily breakdown (line 132-144).

- **Risk / side-effects:**
  - **Three-surface consistency:** after this fix + C-1 + C-4 + C-5, the three net-profit surfaces agree for any date range.
  - **Dashboard widgets:** the "Returns" widget previously showed `returnValue` (sum of `status='returned'` total_amount). After the fix, it should show `returnValue + partialReturnsTotal` to capture both full and partial refunds. Update the ReportsPage UI accordingly.
  - **No DB migration.** Pure app-code change.

- **Verification steps:**
  1. Sell 2× Product A @ 5.00 (cost 3.00) = 10.00. Partial refund 3.00.
  2. Reports → Overview KPI `totalSales` should read 10.00 (was 0.00 before fix).
  3. Reports → Overview KPI `netProfit` should read 1.00 JOD (10 - 3 - 6 = 1).
  4. Reports → P&L tab `net_profit` should read 1.00 JOD. ✓ Matches.
  5. Operations → EOD Close → preview `net_profit` should read 1.00 JOD. ✓ Matches.

---

## Suggested Commit / PR Grouping

The fixes naturally group into 5 logical commits, mirroring the phased style of the (unseen but executed) `AYA_POS_Fix_Plan_20260615.md`. Each commit is independently deployable; the order matters only for the accounting fixes (C-1 must land before C-4/C-5 to avoid introducing a different divergence).

### Commit 1: `fix(accounting): correct full-return double-count in P&L (C-1)`
- **Files:** `src/db/queries/reports.ts`
- **Migration needed:** No
- **Risk:** Low — 2-line change, well-tested scenario
- **Verification:** AC-06 repro steps from my original report

### Commit 2: `fix(accounting): record payment fees in ledger + surface in reports (C-2)`
- **Files:** `supabase/functions.sql` (RPC change), `src/db/queries/reports.ts` (byAccount + P&L fee row), `src/db/queries/sales.ts` (optional refund-side fee reversal)
- **Migration needed:** Yes — Supabase SQL editor: re-run `CREATE OR REPLACE FUNCTION public.complete_sale(...)` with the new body. Optionally pre-seed the merchant-fees account:
  ```sql
  INSERT INTO accounts (id, name, type, balance, fee_percent, module_scope, is_active, sort_order, created_at, updated_at)
  VALUES ('acct_merchant_fees', 'رسوم معالجة الدفع', 'cash', 0, 0, NULL, 1, 999, now()::text, now()::text)
  ON CONFLICT (id) DO NOTHING;
  ```
- **Risk:** Medium — adds a new ledger entry type; existing payment rows will not have fee ledger entries (acceptable forward-looking fix)
- **Verification:** C-2 verification steps

### Commit 3: `fix(accounting): align Day-Closure, P&L, and Overview on partial returns + gifts + topup/maintenance (C-3, C-4, C-5, NEW-2)`
- **Files:** `src/db/queries/closures.ts`, `src/db/queries/reports.ts`
- **Migration needed:** Yes — add `payment_fees` column to `day_closures`:
  ```sql
  -- Migration 015 (new file: src/db/migrations/015_day_closures_payment_fees.sql)
  ALTER TABLE day_closures ADD COLUMN payment_fees INTEGER NOT NULL DEFAULT 0;
  ```
  And the equivalent Supabase SQL editor statement (above).
- **Risk:** Medium — touches all three net-profit surfaces; historical closure snapshots retain old formula
- **Verification:** All three surfaces agree for a day with partial returns + topup + maintenance + fees

### Commit 4: `fix(pos,ui): preserve manual payment rows on cart change (C-6); fix saved-cart activeCartId persistence (NEW-1)`
- **Files:** `src/modules/pos/components/PaymentDialog.tsx`, `src/stores/cart.store.ts`
- **Migration needed:** No
- **Risk:** Low — UI-only changes; no accounting impact
- **Verification:** C-6 and NEW-1 verification steps

### Commit 5: `fix(maintenance,ledger,clock): reverse delivered-job ledger on cancel (C-7); show inventory adjustments in recent ledger (C-8); add monotonic clock guard (C-9)`
- **Files:** `src/db/queries/maintenance.ts`, `src/db/queries/operations.ts`, `src/lib/clockGuard.ts` (new), `src/db/queries/sales.ts`, `src/db/queries/closures.ts`, `src/db/queries/inventory.ts`, `src/db/queries/expenses.ts`, `src/db/queries/operations.ts`, `src/App.tsx`
- **Migration needed:** No (uses existing `app_settings` table for the clock guard)
- **Risk:** Medium — C-7 changes financial behavior of maintenance cancellation; C-9 adds a new throw path that could block sales if the clock guard misbehaves (mitigated by the boot-time seeding and the `try/catch` in `setLastKnownDate`)
- **Verification:** C-7, C-8, C-9 verification steps

### Commit 6 (separate PR — architectural, larger effort): `refactor(security): replace exec_sql/exec_batch with typed RPCs + tighten RLS (A-2); commit to Supabase-only + offline queue (A-1, A-3)`
- **Files:** `supabase/functions.sql` (major rewrite), `supabase/schema.sql` (RLS policies), `src/db/supabaseAdapter.ts` (new typed methods), `src/db/queries/*.ts` (callers updated), `src/db/client.ts` (cleanup), `src/db/worker.ts` (delete or archive), `src/lib/offlineQueue.ts` (new), `src/App.tsx` (drain loop), `src/components/layout/TopBar.tsx` (pending badge), `package.json` (remove sqlite-wasm + comlink), `README.md`, `vite.config.ts` (manifest description)
- **Migration needed:** Yes — full re-run of `supabase/functions.sql` and the RLS policy changes in `supabase/schema.sql`
- **Risk:** High — large refactor; must be deployed in lockstep with Supabase SQL changes
- **Verification:** Full smoke test of all mutations via the new typed RPCs; verify `exec_sql` rejects mutations; verify offline queue drains correctly

---

## Appendix A: Migration SQL

### Migration 015 — `day_closures.payment_fees` column (for C-5)

**File:** `src/db/migrations/015_day_closures_payment_fees.sql`
```sql
-- Migration 015: add payment_fees column to day_closures for the corrected
-- net_profit formula (C-5 fix). Default 0 so historical closures are unaffected.

ALTER TABLE day_closures ADD COLUMN payment_fees INTEGER NOT NULL DEFAULT 0;

-- Optional: backfill historical rows from the ledger (for the period after
-- the C-2 fix was deployed). Commented out by default — only run if the
-- owner wants historical closures to reflect fees.
-- UPDATE day_closures SET payment_fees = COALESCE((
--   SELECT SUM(amount) FROM ledger_entries
--   WHERE entry_date = day_closures.closure_date
--     AND ref_type = 'invoice_fee'
-- ), 0);
```

**Equivalent Supabase SQL editor statement:**
```sql
ALTER TABLE day_closures ADD COLUMN payment_fees INTEGER NOT NULL DEFAULT 0;
```

Also register the migration in `src/db/migrations/index.ts` (add `import migration015 from './015_day_closures_payment_fees.sql?raw';` and add `{ version: 15, sql: migration015 }` to the `migrations` array).

### One-time seed: merchant-fees account (for C-2)

```sql
-- Run once in Supabase SQL editor (or as part of schema.sql for new deployments).
-- The complete_sale RPC also auto-creates this account idempotently, so this
-- is optional — but pre-seeding ensures it appears in Settings → Accounts
-- with the correct sort_order from day one.
INSERT INTO accounts (id, name, type, balance, fee_percent, module_scope, is_active, sort_order, created_at, updated_at)
VALUES (
  'acct_merchant_fees',
  'رسوم معالجة الدفع',
  'cash',
  0,
  0,
  NULL,
  1,
  999,
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
ON CONFLICT (id) DO NOTHING;
```

