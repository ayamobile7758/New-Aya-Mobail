# Implementation Task — Produce Ready-to-Merge Fix Files for Aya Mobile POS

This is the third and final task in our sequence. In your previous response (`AYA_POS_FollowUp_Resolution_<sha>.md`) you analyzed and proposed fixes. The owner has now **made the product decisions** below. Your job is to produce **ready-to-use files** that the owner will hand to an engineer to drop into the codebase.

The owner is **not a programmer**. The integrating engineer is. So: write complete, copy-paste-ready files, not fragments scattered in prose.

---

## 0. MANDATORY FIRST STEP — Re-anchor to the current code

Fetch from `https://github.com/ayamobile7758/New-Aya-Mobail.git` (branch `main`) and print:
1. The current HEAD commit SHA (full hash) and its subject + author date.
2. Confirm whether it is still `4aad411` or has moved. If it moved, list `git log -5 --oneline` and re-verify that none of the new commits touched the files you are about to modify. If any did, re-read those files and adjust your line references.

All code you produce must be valid against this exact HEAD.

---

## 1. The Owner's Decisions (these are FINAL — implement exactly these, do not re-litigate)

| Item | Owner's decision | What this means for your implementation |
|---|---|---|
| **C-1** Full-return double-count | FIX IT | Apply your chosen option (b): `sales_net = sales_gross - partial_returns_total` (do NOT subtract `returns_total`). |
| **C-2** Card payment fees | **DO NOT TRACK FEES AT ALL (simplest)** | The owner does not want any fee tracking. The account must be credited the **FULL** `amount` (not the net). The simplest correct fix: in `complete_sale`, credit `v_amount` (gross) instead of `v_net_amount`, and ledger the gross. This removes the leak entirely because there is no longer any fee being subtracted and lost. **Do NOT create a "merchant fees" account.** Also decide: should `fee_percent` on accounts simply be ignored/treated as 0 going forward, or should the fee still be *recorded* on the `invoice_payments` row for reference but NOT affect the balance? Recommend the cleanest option and state it. Make `getReport` "Sales by Account" reconcile (it already sums gross `ip.amount`, which now matches the balance). |
| **C-3** Gifts value | **USE COST (`unit_cost`)** | Apply your proposed `unit_price` → `unit_cost` change. |
| **C-4** Overview missing topup/maintenance | FIX IT | Add topup + maintenance to `getReport` netProfit. (No payment_fees term needed now, per C-2 decision.) |
| **C-5** Day-Closure vs P&L divergence | FIX IT | Align `getOpenDayPreview` with P&L. (No payment_fees term needed now, per C-2 decision.) |
| **C-6** PaymentDialog wipes payments | FIX IT | Your split-effect + dirty-row solution. |
| **C-7** Cancel delivered maintenance | **FIX IT — cancel reverses the delivery** | The owner confirms: pressing "إلغاء" on a delivered job means "cancel the execution," so the money received must be reversed out of the cash/account. Implement your reversal branch (debit the account, reversing ledger entry, clear delivered_at/final_amount). |
| **C-8** Inventory adjustments hidden in recent ledger | FIX IT | LEFT JOIN + label fallback. |
| **C-9** Clock tampering | FIX IT | Your `clockGuard.ts` + call sites. |
| **A-1** Cloud-only architecture | **COMMIT TO SUPABASE-ONLY (no offline mode)** | The owner does NOT want offline operation. So: do the cleanup (remove/quarantine dead SQLite worker code, simplify `client.ts`, update README + PWA manifest description), and add a clear "requires internet" banner on the lock screen. This is your option (a). |
| **A-3** Offline queue | **SKIP ENTIRELY** | Because the owner accepts cloud-only, there is NO offline queue. Do not build it. Instead, ensure a network failure during a sale shows a **clear Arabic error** and preserves the cart (it already does), so the owner simply retries when the connection returns. Confirm the current behavior already does this and note any small improvement to the error message. |
| **A-2** exec_sql / RLS security hole | **PROVIDE THE PLAN + FILES, owner will decide timing** | This is the biggest/riskiest. Produce the full hardening as a SEPARATE, self-contained deliverable (its own files + its own README), clearly marked "OPTIONAL / DEPLOY SEPARATELY." Do not entangle it with the accounting fixes. The owner may apply it later. |
| **NEW-1** activeCartId not persisted | FIX IT | Add `activeCartId` to `partialize`. |
| **NEW-2** Overview KPIs exclude partially_returned | FIX IT | Align with P&L, same family as C-5. |

---

## 2. What To Produce (the deliverable format)

The owner will collect your output files and pass them to the engineer. Choose the BEST of these three output modes **per file**, and tell the owner clearly which mode you used:

**Preferred (Mode A) — full replacement source files.** For any file you change *substantially* or *entirely*, output the **complete new file content** in a single fenced code block, headed by the exact target path. The engineer overwrites the existing file with it. This is the safest for a non-programmer to relay. Use this whenever practical.

**Acceptable (Mode B) — new files.** For brand-new files (e.g. `src/lib/clockGuard.ts`, the new migration, the "requires internet" banner if separate), output the complete file content with its target path.

**Fallback (Mode C) — Markdown solution bundles.** If you genuinely cannot output a complete source file for something (e.g. a change that is one line inside a 700-line file you don't want to reproduce in full), then write a Markdown file that contains, for that change: the exact target path, the exact "find this" snippet (enough surrounding lines to be unambiguous), and the exact "replace with" snippet. Group related small changes into one Markdown bundle per theme.

**Group the work into these bundles** (each bundle = one logical, independently-applyable unit, mirroring the commit grouping from your previous report):

- **Bundle 1 — Accounting Core** (C-1, C-3, C-4, C-5, NEW-2): files `src/db/queries/reports.ts`, `src/db/queries/closures.ts`. Prefer Mode A (full files) since these are query files of moderate size.
- **Bundle 2 — Payment Fee Simplification** (C-2): file `supabase/functions.sql` (the `complete_sale` RPC) + any reports.ts touch-ups. The SQL must be ready to paste into the Supabase SQL editor. Provide the FULL revised `complete_sale` function.
- **Bundle 3 — POS & Cart UX** (C-6, NEW-1): files `src/modules/pos/components/PaymentDialog.tsx`, `src/stores/cart.store.ts`. Prefer Mode A.
- **Bundle 4 — Maintenance, Ledger, Clock** (C-7, C-8, C-9): files `src/db/queries/maintenance.ts`, `src/db/queries/operations.ts`, NEW `src/lib/clockGuard.ts`, plus the clock-guard call-site edits across `sales.ts`, `closures.ts`, `inventory.ts`, `expenses.ts`, `operations.ts`, and the boot seed in `App.tsx`. Use Mode A for `maintenance.ts`, `operations.ts`, and the new `clockGuard.ts`; use Mode C (find/replace bundle) for the one-line call-site edits in the other files so you don't have to reproduce those large files in full.
- **Bundle 5 — Cloud-Only Cleanup** (A-1): files `src/db/client.ts` (full), README (full), the lock-screen banner change (Mode A or C), and the `vite.config.ts` manifest description (Mode C, one-line). List which dependencies to remove from `package.json`.
- **Bundle 6 — SECURITY (OPTIONAL, deploy separately)** (A-2): its own folder of SQL files + an app-adapter file + its own README. Clearly marked optional.

Any required DB migrations: provide BOTH (a) the migration file for `src/db/migrations/NNN_*.sql`, AND (b) the exact statement to paste into the Supabase SQL editor, AND (c) the one line to register it in `src/db/migrations/index.ts`.

---

## 3. The MAP file (most important deliverable for the owner)

Produce one top-level Markdown file named **`AYA_FIX_FILES_MAP.md`** that is the owner's index. It must contain:

1. The HEAD SHA you worked against.
2. A table: **Bundle # | What it fixes (plain Arabic, one line each) | Files included | Output mode (A/B/C) | Needs Supabase SQL? (yes/no) | Risk (low/med/high)**.
3. For each bundle, a 2–3 sentence plain-Arabic explanation a non-programmer can understand ("هذا الملف يصلح مشكلة كذا، الطريقة كذا").
4. A clear **application order** (which bundle first) and which bundles are independent.
5. For every bundle that needs a Supabase SQL step, a big visible note: **"⚠️ يجب نسخ هذا في محرر SQL في Supabase"** with the exact SQL.
6. A short **verification checklist per bundle** (the manual steps the owner can do to confirm it works), in Arabic.
7. An explicit statement of what was deliberately NOT changed (the design-intent items: partial-return no-COGS, no VAT, no purchases module, localStorage silent-fail) so the engineer doesn't "fix" them.

The map is what the owner reads first. Make it skimmable and non-technical in its explanations, even though the bundle files themselves are technical.

---

## 4. Hard Rules

- **Three-surface consistency:** after Bundle 1 + Bundle 2, the three net-profit surfaces — `getReport` (Overview), `getProfitAndLoss` (P&L), `getOpenDayPreview` (Day Closure) — MUST produce the same net profit for the same date range. For each accounting file, add a short comment block stating the agreed formula so future readers don't re-introduce divergence.
- **C-2 specifically:** since fees are no longer tracked, the agreed sale formula credits the FULL amount. Make sure NO surface subtracts a fee anymore. If you find any leftover `net_amount` / fee subtraction in the TS layer (`sales.ts` payment payload) or the RPC, neutralize it consistently (recommend: keep storing `fee_amount` on the row as informational = 0, credit gross). State exactly what you did.
- Money is integer **fils**, 100 fils = 1 JOD. Never introduce `/1000`.
- Keep diffs minimal where you use Mode C. Use Mode A (full file) only where it genuinely helps the non-programmer relay the change safely.
- Do NOT change the design-intent items listed in §3.7.
- Every new or replaced file must be self-consistent and compile (no references to symbols you removed; update imports accordingly).
- For the clock guard (C-9): make absolutely sure the boot-time seed and the per-mutation check cannot lock the owner out on first run or on a legitimate forward clock change. Include the exact Arabic error text.
- For C-7: keep the existing double-delivery guard intact; ensure a job can be re-delivered after a cancel-reversal.
- Where a fix needs a UI tweak the owner must see (e.g. the "requires internet" banner, the cancel-delivery confirmation dialog, the new "Net/Gross" columns if any), describe the visible change in the MAP file in plain Arabic so the owner knows what to look for after the engineer integrates it.

---

## 5. Output Summary (what the owner expects to receive)

1. `AYA_FIX_FILES_MAP.md` — the index/map (Arabic explanations).
2. Bundle 1 files (accounting core).
3. Bundle 2 files (payment fee simplification + Supabase SQL).
4. Bundle 3 files (POS/cart UX).
5. Bundle 4 files (maintenance/ledger/clock).
6. Bundle 5 files (cloud-only cleanup).
7. Bundle 6 files (security — optional, separate).

If your platform can emit real files, do so. If it cannot, emit each bundle as a clearly-named Markdown document containing the full file contents in fenced code blocks with their target paths, and make `AYA_FIX_FILES_MAP.md` point to each one. Either way, the MAP file must list every file you produced and what is in it.
