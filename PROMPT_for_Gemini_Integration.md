# Integration Task — Apply the Aya POS Fix Bundles into the Codebase

You are the **implementer**. A reviewer (Claude) has already (1) verified the fix files produced by a prior QA agent against the live code, (2) found two real defects that must be corrected during integration, and (3) written this prompt. Your job is to integrate the fix files into the working tree, apply the two corrections below, and leave the project in a state that **type-checks, passes tests, and builds**. Then report back so the reviewer can re-check.

Work carefully and surgically. Do **not** invent new behavior or "improve" things beyond what is specified.

---

## 0. Context & ground truth

- Repo root: the current project. Branch: `main`. Expected HEAD: `b6c491e` (or later — if later, run `git log -5 --oneline` and confirm none of the new commits touched the files listed in §3; if any did, stop and report).
- The fix files the prior agent produced are already in the repo under the **`new/`** folder (untracked). You will copy the full-replacement files from `new/` into their real locations, apply the find/replace edits from `new/call_site_edits.md`, then apply the two corrections in §2.
- **Money is integer fils** (100 fils = 1 JOD). Never introduce `/1000`.
- The owner's product decisions are FINAL (do not re-litigate): fees are NOT tracked (credit gross); gifts valued at cost; maintenance "cancel" reverses the delivery; cloud-only (no offline mode/queue); clock-tamper guard active.

### First step (mandatory)
Run `git status` and confirm the working tree has **no modified tracked files under `src/`** (only untracked files like `new/`, the `PROMPT_*.md` files, and `dev-dist/` are expected). If any tracked `src/` file shows as modified, run `git checkout -- src/` to reset it to the clean `b6c491e` baseline before you begin. Also delete any stray `src/lib/clockGuard.ts` if present (you will recreate it cleanly in §3).

---

## 1. The reviewer's verification result (so you know what is trusted)

The reviewer read every file in `new/` and confirmed the following are CORRECT and compatible with the live code — copy them as-is:
- `new/closures.ts` (C-3, C-5) — gifts use unit_cost; partial-returned included; net_profit subtracts returns_total. ✔
- `new/maintenance.ts` (C-7) — delivered→non-delivered reversal; double-delivery guard intact; uses `sequences.last_val`. ✔
- `new/operations.ts` (C-8 + C-9) — LEFT JOIN + Arabic NULL-account labels; clock guard on topup/transfer. ✔
- `new/clockGuard.ts` (C-9) — monotonic guard; safe on first-run and forward clock; uses `readSetting`/`writeSetting` (verified those return parsed values). ✔
- `new/cart.store.ts` (NEW-1) — `activeCartId` added to `partialize`. ✔
- `new/PaymentDialog.tsx` (C-6) — split effects A/B/C with `isManualEdit` dirty-tracking. ✔
- `new/complete_sale_rpc.sql` (C-2) — credits GROSS, forces `fee_amount=0`. ✔
- `new/client.ts`, `new/DailyLockScreen.tsx` (A-1) — cloud-only cleanup + "requires internet" banner. ✔

**Two defects were found** (see §2). Both MUST be fixed during integration.

---

## 2. The TWO corrections you MUST apply (this is the heart of your task)

### Correction 1 — `reports.ts`: Overview `netProfit` ignores partial returns (three-surface inconsistency)

In `new/reports.ts`, inside `getReport(...)`, the variable `partialReturnsTotal` is computed (around line 120) but is **never subtracted** from profit. As written:
```ts
const grossProfit = totalSales - totalCost;
...
const netProfit = grossProfit + topupProfit + maintenanceRevenue - totalExpenses;
```
This makes the Overview KPI disagree with `getProfitAndLoss` (P&L) and `getOpenDayPreview` (Day Closure) whenever a day contains a **partial return** — which is exactly the bug class this whole effort is fixing.

**Required fix:** subtract `partialReturnsTotal` so the Overview matches the other two surfaces. The agreed definition is `sales_net = totalSales - partialReturnsTotal`, and gross/net profit derive from that. Apply this change:

Replace:
```ts
  const grossProfit = totalSales - totalCost;
  const totalExpenses = expRow?.total_expenses ?? 0;
  const topupProfit = Number(topupRow?.total ?? 0);
  const maintenanceRevenue = Number(mainRow?.total ?? 0);
  // C-4 + C-1: net profit includes topup + maintenance, subtracts expenses.
  // No payment-fee term (C-2 decision: fees are not tracked).
  const netProfit = grossProfit + topupProfit + maintenanceRevenue - totalExpenses;
```
With:
```ts
  // C-1: sales_net deducts ONLY partial_returns_total (full returns are already
  // excluded from totalSales by the status filter — do NOT subtract them again).
  const salesNet = totalSales - partialReturnsTotal;
  const grossProfit = salesNet - totalCost;
  const totalExpenses = expRow?.total_expenses ?? 0;
  const topupProfit = Number(topupRow?.total ?? 0);
  const maintenanceRevenue = Number(mainRow?.total ?? 0);
  // C-4 + C-1: net profit = grossProfit + topup + maintenance - expenses.
  // No payment-fee term (C-2 decision: fees are not tracked).
  const netProfit = grossProfit + topupProfit + maintenanceRevenue - totalExpenses;
```

**Consistency check you must reason through and confirm in your report:** for a day with one 1000-fils sale (cost 600) partially refunded 300, all three surfaces must yield `gross_profit = 100` and `net_profit = 100`:
- P&L (`getProfitAndLoss`): sales_gross 1000 − partial 300 = 700; − cogs 600 = **100**. ✔ (already correct in `new/reports.ts`)
- Day Closure (`getOpenDayPreview`): sales_total 1000 − cogs 600 − returns_total 300 = **100**. ✔ (already correct in `new/closures.ts`)
- Overview (`getReport`): after your fix, salesNet 700 − cost 600 = **100**. ✔
Also confirm a **full-return** day (1000 sale fully refunded) yields 0 on all three.

### Correction 2 — `sales.ts`: unused `format` import after the clock-guard edit breaks the build

`new/call_site_edits.md` §1 replaces `const today = format(new Date(), 'yyyy-MM-dd')` with `await assertClockNotTampered()` in `completeSale` AND in `returnInvoice`. After both edits, `format` is **no longer used anywhere** in `src/db/queries/sales.ts`, so the line `import { format } from 'date-fns';` becomes an unused import. Under the project's strict TypeScript settings this is a **compile error** (`'format' is declared but its value is never read`).

**Required fix:** after applying the §1 call-site edits, **remove** the now-unused import line `import { format } from 'date-fns';` from `src/db/queries/sales.ts`.

> Important: do this check per-file. In every OTHER file where you apply a clock-guard edit (`inventory.ts`, `expenses.ts`, `closures.ts`), verify whether `format` is still used elsewhere in that file BEFORE removing its import. In those files `format` is typically still used for `'yyyy-MM-dd HH:mm:ss'` timestamps or other dates, so DO NOT remove it there. Only remove it where it becomes genuinely unused (confirmed: `sales.ts`). Let the typecheck in §4 catch any you miss, then fix accordingly.

---

## 3. Integration steps (do them in this order)

**Step A — copy full-replacement files** from `new/` to their real locations:
| From | To |
|---|---|
| `new/reports.ts` | `src/db/queries/reports.ts` |
| `new/closures.ts` | `src/db/queries/closures.ts` |
| `new/maintenance.ts` | `src/db/queries/maintenance.ts` |
| `new/operations.ts` | `src/db/queries/operations.ts` |
| `new/cart.store.ts` | `src/stores/cart.store.ts` |
| `new/PaymentDialog.tsx` | `src/modules/pos/components/PaymentDialog.tsx` |
| `new/clockGuard.ts` | `src/lib/clockGuard.ts` |
| `new/client.ts` | `src/db/client.ts` |
| `new/DailyLockScreen.tsx` | `src/components/auth/DailyLockScreen.tsx` |

**Step B — apply Correction 1** to `src/db/queries/reports.ts` (the `getReport` netProfit edit from §2).

**Step C — apply the find/replace edits** in `new/call_site_edits.md` exactly:
- §1 → `src/db/queries/sales.ts` (import add; `completeSale` and `returnInvoice` clock-guard; AND the optional §1d C-2 fee-zeroing edits in `completeSale` and `returnInvoice` — apply them, they are recommended).
- §3 → `src/db/queries/inventory.ts` (import add; `createInventoryCount`; `createAccountReconciliation`).
- §4 → `src/db/queries/expenses.ts` (import add; `addExpense`, `deleteExpense`, `restoreExpense`, `updateExpense`).
- §5 → `src/App.tsx` (clockGuard import + boot seed inside `setup()`).
- §2 of call_site_edits (closures.ts clock guard import + `closeDay`): apply to the NEW `src/db/queries/closures.ts` you copied in Step A.

**Step D — apply Correction 2** to `src/db/queries/sales.ts` (remove the unused `format` import).

**Step E — apply the small Mode-C bundles** that are NOT code-logic but still required:
- `new/vite_config_change.md` → update the PWA manifest `description` in `vite.config.ts`.
- `new/package_json_changes.md` → remove the listed dependencies (`@sqlite.org/sqlite-wasm`, `comlink`) from `package.json`. **Do not run `npm install` yet** unless typecheck requires it; if removing deps breaks an import, report it.
- Read `new/BUNDLE5_NOTES.md` and `new/BUNDLE3_NOTES.md` and `new/BUNDLE2_NOTES.md` for any extra one-line touches they specify; apply only what is concretely instructed there.

**Step F — DO NOT apply Bundle 6 (security / `new/01_exec_sql_readonly.sql`, `new/02_rls_policies.sql`, `new/supabaseAdapter.ts`, `new/BUNDLE6_README.md`).** That is the optional security hardening the owner will deploy separately. Leave those files untouched in `new/`.

**Step G — Supabase SQL (do NOT run it; just confirm it's ready):** `new/complete_sale_rpc.sql` must be pasted by the owner into the Supabase SQL editor. You do not have DB access. Just confirm the file is present and note in your report that this manual step is pending.

---

## 4. Verify (this is mandatory — do not skip)

Run, in order, and paste the full output of each into your report:
1. `npx tsc --noEmit` (or `npm run typecheck`) — must be **clean** (zero errors). If you see `'format' is declared but never read` in any file, that file's `format` import is now unused — remove it (per §2 Correction 2 guidance) and re-run.
2. `npm run test` (Vitest) — all tests must pass.
3. `npm run build` — must succeed.

If any step fails, fix the cause and re-run until all three are green. Do not report success unless all three pass.

---

## 5. Report back (for the reviewer)

Produce a short Markdown report with:
1. HEAD SHA you worked against; confirmation the tree was clean before you started.
2. List of files copied (Step A) and files edited (Steps B–E), each with one line of what changed.
3. **Correction 1:** paste the final `getReport` profit block and your three-surface consistency check (the 1000/600/300 partial-return scenario AND the full-return scenario) showing all three surfaces = the same number.
4. **Correction 2:** confirm which files had `format` removed and which kept it (with the reason — "still used for HH:mm:ss" etc.).
5. Full output of `tsc --noEmit`, `npm run test`, `npm run build`.
6. Anything that did NOT go as expected, any file in `new/` whose "find" snippet did not match the live code (and how you resolved it), and the pending manual Supabase SQL step.
7. Confirm Bundle 6 was NOT applied.

Do not commit or push unless explicitly asked. Leave the changes in the working tree for the reviewer to inspect.
