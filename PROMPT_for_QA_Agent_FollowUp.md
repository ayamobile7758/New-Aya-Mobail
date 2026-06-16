# Follow-Up Task — Verify & Resolve the Findings From Your Aya Mobile POS Test Report

You previously produced a document titled **"Comprehensive Test Report — Aya Mobile POS System"** (dated 2026-06-17), tested against commit `59b1dad`. This is a follow-up task on the **same repository**.

A second independent reviewer (with direct read access to the working tree) has re-verified your findings against a **newer commit**. Some of your findings are **fully confirmed**, one of your findings turns out to be a **real and severe regression introduced by a prior fix**, and a small number of findings were **already fixed** before your report and should not be re-reported as bugs.

Your job now is to (1) re-anchor yourself to the exact current code, (2) for each item below either **agree and implement the correct fix**, or — if you disagree — **prove your position with code citations and propose your own fix instead**, and (3) deliver everything in a single Markdown report.

---

## 0. MANDATORY FIRST STEP — State Exactly Which Version You Are Reading

Before analyzing anything, fetch and **explicitly report** the following from the GitHub repository (`https://github.com/ayamobile7758/New-Aya-Mobail.git`, branch `main`):

1. The **HEAD commit SHA** you are now reading (full 40-char hash).
2. The commit **subject line** and **author date** of that HEAD.
3. The output of `git log -5 --oneline` (or the GitHub equivalent) so we can confirm alignment.

> **Context you must account for:** Your original report tested `59b1dad`. The current `main` HEAD is expected to be **`b897648`** ("feat(ui): animated gliding admin-mode top line"), which is 2 commits ahead of what you tested. **More importantly, a prior fix plan (`AYA_POS_Fix_Plan_20260615.md`, present in the repo root) was already executed.** That plan introduced code tagged with comments like `CR-A`, `CR-B`, `CR-C`, `HI-A`, `HI-E`, `ME-A`. This means part of the codebase has changed since your report — you MUST read the current code, not rely on your previous file:line numbers.

**Do not proceed to Section 1 until you have printed the HEAD SHA and date.** Every code citation you make afterward must reference line numbers as they exist in that HEAD.

---

## 1. How To Respond To Each Item

For **every** numbered item in Sections 2 and 3, respond using this exact structure:

```
### <ITEM ID> — <short title>
- **Current code (HEAD <sha-short>):** <file:line> + a short quoted snippet of the CURRENT code (not your old report's code).
- **My verdict:** AGREE (confirmed bug) | DISAGREE (not a bug / already fixed) | PARTIALLY AGREE
- **Reasoning:** <why, with reference to actual current code>
- **Proposed fix:** <concrete code, full function or exact diff. If DISAGREE, explain what the correct current behavior is and why no change is needed.>
- **Risk / side-effects:** <what else this fix touches; any migration needed; any report that must stay consistent>
- **Verification steps:** <how the owner can manually confirm the fix works>
```

If you **disagree** with the reviewer on any item, that is allowed and encouraged — but you must back it with a direct quote of the **current** code and a clear argument. Do not defer to the reviewer; defer to the code.

---

## 2. CONFIRMED ISSUES — Independently re-verified against current code. Implement the fix (or disprove with evidence).

These were checked line-by-line in the current tree and are believed to still be present. For each, propose and write the correct fix.

### C-1 — `getProfitAndLoss` DOUBLE-COUNTS FULL RETURNS (highest priority — this is a regression)
- File: `src/db/queries/reports.ts`, function `getProfitAndLoss` (~lines 231–305).
- Current logic:
  - `sales_gross` selects invoices `WHERE status IN ('active','partially_returned')` — this **already excludes** `'returned'`.
  - `returns_total` selects `WHERE status = 'returned'`.
  - `sales_net = sales_gross - returns_total - partial_returns_total`.
- The bug: for a fully returned invoice, its `total_amount` is **already absent** from `sales_gross` (because `returned` is filtered out), but then `returns_total` is subtracted **again**. For a day with a single 1000-fils sale that was fully refunded, `sales_net = 0 - 1000 - 0 = -1000`, which is wrong; the correct value is `0`.
- **Important:** This was introduced by the prior fix plan's change `CR-C`. The `partial_returns_total` part of that change is correct; the `- returns_total` part is the double-count.
- Required outcome: full returns must net to zero, partial returns must still deduct only the refunded portion. Decide and justify ONE of:
  - (a) Include `'returned'` in `sales_gross` and keep subtracting `returns_total`, OR
  - (b) Keep `sales_gross` excluding `'returned'` and **stop** subtracting `returns_total` (subtract only `partial_returns_total`).
  State which you choose and why, then write the corrected function.

### C-2 — Payment processing fee is never recorded in the ledger (accounting leak)
- Files: `supabase/functions.sql` (`complete_sale`, ~lines 277–317) and `src/db/queries/sales.ts` (~lines 150–170).
- Current behavior: the account is credited `v_net_amount` (amount − fee) and exactly **one** ledger entry for `v_net_amount` is written. `fee_amount` is stored on `invoice_payments` but **never** debited to any expense/fee account and never appears in any ledger entry.
- Confirmed side-effect in reporting: `getReport` "Sales by Account" (`src/db/queries/reports.ts` ~lines 117–129) sums `ip.amount` (gross), while `accounts.balance` only ever increased by the net. The two will not reconcile whenever a fee account is used.
- Note: the `invoice_payments` table has **no** `net_amount` column (verified in `supabase/schema.sql` ~line 247). The app computes `net_amount` in TS but does not persist it.
- Required outcome: fees must be visible in the books. Propose the cleanest approach for a single-shop system. Two candidate designs — pick and justify:
  - (a) In `complete_sale`, after crediting net to the payment account, also write a second ledger entry `ref_type = 'invoice_fee'` recording the fee (and decide whether it debits a dedicated "merchant fees" account or is recorded account-less like inventory adjustments).
  - (b) Change "Sales by Account" reporting to sum net (`ip.amount - ip.fee_amount`) AND surface total fees as a separate expense line in P&L, without a ledger row.
  Whichever you choose, the P&L and the account balances must reconcile afterward, and you must state where fees now show up.

### C-3 — Day-Closure `gifts_value` uses `unit_price` instead of `unit_cost`
- File: `src/db/queries/closures.ts`, `getOpenDayPreview` (~line 54): `SUM(ii.unit_price * ii.quantity) ... WHERE is_gift = 1`.
- This reports the **retail value** of gifts, not their **cost** to the business. Your own report (AC-04) flagged this; it is still present. Note `getReport` in `reports.ts` correctly uses `unit_cost` for `gift_cost`, so the two surfaces disagree.
- Required outcome: decide whether `gifts_value` is meant to communicate cost or retail value to the owner, and make it consistent with how gifts are treated in net-profit math. State your decision and fix.

### C-4 — Reports "Overview" net profit omits topup profit and maintenance revenue
- File: `src/db/queries/reports.ts`, `getReport` (~line 64): `netProfit = grossProfit - totalExpenses`.
- `getProfitAndLoss` (same file) correctly adds `topup_profit + maintenance_revenue`. `getOpenDayPreview` (closures.ts) also adds them. So the Overview KPI is the lone surface that under-reports net profit on any day with a topup or a delivered maintenance job.
- Required outcome: make the three net-profit computations agree for the same date range. Either fix `getReport` to add the two income streams, or consolidate on `getProfitAndLoss`. State the trade-off.

### C-5 — Day-Closure vs P&L diverge for partially-returned invoices
- File: `src/db/queries/closures.ts`, `getOpenDayPreview`.
- `sales_total` and `cogs_total` filter `status = 'active'` only, so a `partially_returned` invoice contributes **0** sales and **0** COGS to the closure snapshot. Meanwhile `getProfitAndLoss` includes `partially_returned` in both sales and COGS and then deducts the refunded portion. For any day containing a partial return, the closure `net_profit` and the P&L `gross_profit` will differ.
- Required outcome: align the closure preview with the (corrected, per C-1) P&L definition so the same day yields the same profit on both surfaces. Provide the corrected `getOpenDayPreview` and confirm it is internally consistent with your C-1 decision.

### C-6 — `PaymentDialog` wipes manually-entered split payments on cart change
- File: `src/modules/pos/components/PaymentDialog.tsx` (~lines 49–63). The `useEffect` depends on `[isOpen, total, accounts]` and unconditionally calls `setPayments([{ default }])`. If the cashier opens Advanced, enters split amounts, then the cart `total` changes (e.g. one more product added), their entered rows are silently overwritten.
- Required outcome: re-initialize payment rows only on dialog open (`isOpen` false→true). When `total` changes while open, update the auto-default first row only if it has not been manually edited; never clobber user-entered rows. Provide the corrected effect/handler logic.

### C-7 — Delivered maintenance job reverted to another status does NOT reverse the ledger/account
- File: `src/db/queries/maintenance.ts`, `updateJobStatus` (~lines 138–144). The `else` branch (any non-`delivered` status) only does `UPDATE maintenance_jobs SET status = ?`. If a job was previously `delivered` (account credited + ledger entry written) and is then set to `cancelled`/`ready`/etc., the credit and ledger entry remain — the books overstate income.
- Required outcome: when transitioning **from** `delivered` to any non-delivered status, reverse the financial effect (debit the account by `final_amount`, write a reversing ledger entry, clear `delivered_at`/`final_amount` as appropriate), guarded by `isDayClosed`. Provide the corrected function. Watch for the double-delivery guard and keep it intact.

### C-8 — `getRecentLedgerEntries` hides account-less ledger rows (inventory adjustments)
- File: `src/db/queries/operations.ts` (~lines 21–31). Uses `JOIN accounts a ON l.account_id = a.id` (INNER JOIN). Inventory-adjustment ledger entries have `account_id = NULL`, so they never appear in the "recent ledger" view, while `getLedgerForPeriod` (LEFT JOIN, ~line 60) does show them. Inconsistent.
- Required outcome: switch to `LEFT JOIN` and render a sensible label (e.g. "تعديل جرد") when `account_name` is NULL, matching `getLedgerForPeriod`.

### C-9 — Clock-tampering bypasses the day-closure lock
- File: `src/db/queries/sales.ts` (~line 44). `today = format(new Date(), 'yyyy-MM-dd')` and the `isDayClosed(today)` guard both trust the device clock. Setting the device date forward/backward lets a sale land on a date that is not closed, bypassing the lock. (Same class of issue applies anywhere `new Date()` drives the closure check.)
- Required outcome: propose a guard that persists a monotonic `last_known_date` in `app_settings` and refuses to operate when the device clock reads earlier than the stored value. Consider all mutation entry points, not just sales. Provide the helper + where to call it. Keep it pragmatic for a single-shop, 1–5 tablet deployment.

---

## 3. CRITICAL / ARCHITECTURAL ITEMS — Confirmed present. These need a decision + plan, not just a code patch.

### A-1 — SQLite-WASM mode is dead code; app cannot boot without Supabase env
- Files: `src/db/client.ts` (lines 1–14: the SQLite/Comlink worker is fully commented out; `dbClient = supabaseAdapter`), `src/db/supabase.ts` (lines 6–10: throws unconditionally if env vars are missing). The worker at `src/db/worker.ts` is unreferenced.
- The system is now **cloud-only** despite documentation describing a dual-mode adapter. Decide WITH the owner's constraints in mind (single shop, 1–5 Android tablets, same WiFi, single Supabase project): either (a) formally commit to Supabase-only — delete/quarantine the dead worker, update README, and show a clear "requires internet" message on the lock screen when Supabase is unreachable; or (b) restore SQLite-WASM as an offline-first primary with Supabase sync. Recommend ONE with justification and an outline of the work.

### A-2 — `exec_sql` / `exec_batch` allow arbitrary SQL from the anon key (data-loss / tamper risk)
- File: `supabase/functions.sql` (lines 34–173). Both are `SECURITY DEFINER` and `GRANT EXECUTE ... TO anon`. The anon key ships in the client bundle, so anyone who extracts it can run arbitrary SQL (e.g. `DROP TABLE invoices`, `UPDATE accounts SET balance = ...`). There are no RLS policies constraining this.
- This is the single highest-severity item in the whole audit. Even for a trusted single owner, the anon key is publicly retrievable from any installed tablet. Propose a concrete hardening path and rank by effort/impact: e.g. (a) replace the generic `exec_sql`/`exec_batch` pass-throughs with a set of typed, named RPCs (`create_expense`, `create_transfer`, `return_invoice`, …) mirroring what `complete_sale` already does, plus RLS; or (b) move privileged operations behind an authenticated role and add table RLS. Give a migration outline and call out which app query modules would have to change.

### A-3 — No offline queue; any network blip fails the sale
- File: `src/db/supabaseAdapter.ts` (all of `query`/`run`/`batchRun`/`completeSaleRpc` are direct `supabase.rpc` calls). On network failure they throw `TypeError: Failed to fetch`; the cart is preserved in memory but the sale cannot be recorded and there is no retry/queue.
- Decide whether this matters given A-1's resolution. If the system stays cloud-only, propose a minimal offline-resilience design (e.g. an idb-keyval-backed queue of pending `complete_sale` payloads drained on reconnect, with a "pending sync" badge) — but be explicit about the consistency hazards (stock checks, sequence numbers, day-closure date) of deferring a sale, and whether they are acceptable for this business. If you think an offline queue is NOT worth it for this deployment, say so and justify.

---

## 4. ITEMS THAT WERE ALREADY FIXED — Do NOT re-report these as open bugs

Your original report listed these; they have since been addressed in the current tree. Briefly **confirm** each is now handled (one line + file:line) so we know we are reading the same code. If you find any of them is in fact NOT handled in the current HEAD, flag it.

- **Server-side underpayment guard (your HI-A / AC-15):** now present in `src/db/queries/sales.ts` (~lines 54–58) — `completeSale` throws if `paidAmount < totalAmount`. Confirm.
- **Universal day-closed guard for maintenance status changes (your HI-E):** now present in `src/db/queries/maintenance.ts` (~lines 98–100) — `isDayClosed` is checked at the top of `updateJobStatus`, applying to all branches. Confirm.
- **`reopenDay` reverses reconciliation (your earlier CR-A concern):** now present in `src/db/queries/closures.ts` (~lines 219–259). Confirm.
- **localStorage quota silent-fail (your FM-02 / HI-10):** note the comment `LO-E` in `src/stores/cart.store.ts` (~lines 251–254) documents this as an **accepted** trade-off for single-shop use. Treat as a product decision; only re-open if you have a strong argument the silent failure causes real data loss in practice.

---

## 5. ITEMS TO RE-CONFIRM (your report flagged them but they need a second look at current code)

- **Partial return does not reverse COGS (your FM-04 / AC-07 design note):** confirm this is still the **intended** behavior per the `DESIGN INTENT (2026-06-15)` comment in `src/db/queries/sales.ts` (~lines 329–335). Do not "fix" it; just confirm it is documented and consistent with the corrected reports (C-1, C-5).
- **No VAT, no purchases/FIFO, no customer/supplier UI (your FM-05/FM-07/FM-20):** these are scope decisions, not bugs. List them once as "deferred by design" and move on unless the owner asks.

---

## 6. Deliverable

Produce **one Markdown file** named `AYA_POS_FollowUp_Resolution_<HEAD-sha-short>.md` containing, in order:

1. **Version header** — the HEAD SHA, subject, and date you read (from Section 0).
2. **Summary table** — one row per item (C-1…C-9, A-1…A-3), columns: ID, your verdict (AGREE / DISAGREE / PARTIAL), severity, file:line, one-line fix summary.
3. **Detailed responses** — every item in the Section 1 structure, with full corrected code for the ones you implement.
4. **Items already fixed (Section 4)** — confirmation lines.
5. **Deferred-by-design (Section 5)** — short list.
6. **Any new findings** — if, while reading the current code, you discover a genuinely new issue not in the original report, add it here as `NEW-1`, `NEW-2`, … with the same response structure. Do not pad; only real findings.
7. **Suggested commit/PR grouping** — how you would split these fixes into logical commits (mirror the phased style of `AYA_POS_Fix_Plan_20260615.md` if helpful), and which fixes require a Supabase SQL migration vs. pure app code.

## 7. Rules

- Cite the **current** code at the HEAD you reported in Section 0. If a line number from the original report no longer matches, use the new one and note the shift.
- Every accounting fix must keep the **three net-profit surfaces consistent**: `getReport` (Overview), `getProfitAndLoss` (P&L tab), `getOpenDayPreview` (day closure). State, for each accounting fix, how all three stay in agreement.
- Money is integer **fils**, 100 fils = 1 JOD. Do not introduce `/1000` logic.
- `fee_percent` is stored **per-mille** (e.g. 100 = 10%); code divides by 10 before `applyPercent`. Keep that convention.
- Prefer minimal, surgical diffs over rewrites. Do not "fix" things listed in Section 4/5 or in the prior plan's "Appendix A — Code That Does NOT Need Changes."
- If a fix needs a DB migration, provide both the migration SQL (for `src/db/migrations/`) and the equivalent statement to paste into the Supabase SQL editor.
- Where you DISAGREE, the burden is on you to disprove with a current-code citation — and if you disprove, still propose what (if anything) should change.
