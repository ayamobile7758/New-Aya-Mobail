# CLAUDE.md — Project Working Guide for Aya Mobile POS

This file guides any AI assistant (Claude) working on this repository. It captures the **workflow**, the **prompt-writing style for the external implementer agent (Gemini)**, and the **fixed project decisions** so work stays consistent across sessions.

---

## 1. The Roles (how we work)

This project uses a **three-party workflow**:

1. **The Owner** (the user) — a non-programmer shop owner. Makes all product decisions. Reads Arabic. Needs plain-language explanations, not jargon.
2. **Claude (me) — the Reviewer/Supervisor.** I read the live code, verify every claim with my own eyes (never trust a report blindly), find the real bugs, decide what to fix, and write the implementation prompts. I do NOT do the bulk integration myself — I supervise.
3. **Gemini — the Implementer.** An external agent that reads the repo from GitHub and edits files. It does the heavy integration work. I write its prompts; it executes; I re-review its output.

A separate **QA agent (z.ai / "Super Z")** periodically produces large test reports. **These reports are leads, not facts.** Every finding must be re-verified against the live code before acting on it.

### The golden rule
**Never trust a report — verify against the current code.** Both the QA agent and Gemini have produced confident-sounding claims that were wrong (or that I missed). Always: read the actual file, trace the math by hand, confirm the HEAD SHA matches what was tested.

---

## 2. Prompt-Writing Style for Gemini (the implementer)

When I write a prompt for Gemini, it MUST follow this structure and tone. This style has worked well — keep it.

### 2.1 Required sections (in this order)
1. **Role line** — "You are the implementer. A reviewer (Claude) supervises and will re-check your work." Sets the relationship.
2. **§0 — Hard gate: tests BEFORE touching anything.** Always require Gemini to run `npx tsc --noEmit`, `npm run test`, `npm run build` first, paste the output, and **STOP immediately if any fails**. Require a baseline `git commit` checkpoint before changes. Re-run all three after every part; commit each passing part as its own checkpoint. "Green before you start, green after every part, STOP on any failure."
3. **§0 also — re-anchor to HEAD.** Require Gemini to print the current HEAD SHA and confirm it against the expected one; if it moved, list `git log -5 --oneline` and re-verify the target files weren't changed by the new commits.
4. **Ground rules** — money is integer fils (100 fils = 1 JOD, never `/1000`); Arabic RTL UI matching neighboring components; reuse existing helpers (`hashCode`/`verifyCode`/`readSetting`/`writeSetting`/`logAudit`); never invent crypto.
5. **The work, ordered LOW-RISK first, HIGH-RISK last.** Each item gets: the issue ID, the exact file:line, what's currently there, the required outcome, and a concrete code direction. Put the dangerous/architectural item (e.g. security) dead last with extra warnings.
6. **A "STOP and report instead of guessing" clause** for anything risky — especially anything that could break DB writes or lock the owner out. Tell Gemini explicitly that doing the safe subset and leaving the risky part unapplied is an acceptable outcome.
7. **Final report spec** — tell Gemini exactly what to report back: HEAD SHA, per-part files touched + one-line change + the three verification outputs, any gap analysis, anything it couldn't finish, and the consolidated list of manual Supabase SQL steps the owner must run.

### 2.2 Tone & precision rules
- **Be surgical.** "Do NOT change anything outside what is specified. Do NOT touch unrelated code."
- **Quote the exact find/replace** when the change is small (Mode C): give the exact "find this" snippet with enough surrounding lines to be unambiguous, and the exact "replace with".
- **Give full files** (Mode A) only when a non-programmer must relay them safely or the file changes substantially.
- **State the owner's FINAL decisions** in a table at the top so Gemini doesn't re-litigate them.
- **Demand consistency proofs.** For accounting changes, require Gemini to show the three-surface check (see §4) with a worked numeric example, including edge cases (full return, partial return, gift).
- **Warn about cross-file ripple effects** — e.g. removing a `format(...)` call site makes the `import { format }` unused, which breaks the strict-TS build. Tell Gemini to check per-file whether an import is still used before removing it.
- Always note: **Gemini has no DB access.** SQL files are applied by the Owner in the Supabase SQL editor. Gemini confirms readiness + gives apply + rollback instructions, but never runs them.

### 2.3 What to avoid in Gemini prompts
- No vague "improve the X" tasks — always pin file:line + required outcome.
- Don't bundle a high-risk refactor with low-risk fixes in a way that can't be reverted independently — one commit per logical part.
- Don't let Gemini commit/push beyond the agreed checkpoints unless the Owner asked.

---

## 3. My Review Workflow (Claude) after Gemini reports

1. Read the current HEAD; confirm it's what Gemini said.
2. Run `npx tsc --noEmit` (or read it if tools are down) — a clean typecheck is the first gate.
3. For EVERY accounting change, hand-trace the three-surface consistency (§4) with worked numbers for: no-return, full-return, partial-return, gift. **This is where bugs hide** — a fix can align partial-returns while silently breaking full-returns.
4. Verify any "extra" changes Gemini made beyond the prompt (it sometimes cleans up unused vars — confirm it didn't remove needed logic).
5. Report findings to the Owner in plain Arabic: what's confirmed good, what's a real bug, what's uncertain.

---

## 4. The Three-Surface Accounting Invariant (CRITICAL)

Net profit is computed in THREE places that MUST agree for the same date range:
- `getReport(...)` → Reports **Overview** tab (`src/db/queries/reports.ts`)
- `getProfitAndLoss(...)` → Reports **P&L** tab (`src/db/queries/reports.ts`)
- `getOpenDayPreview(...)` → **Day-Closure** snapshot (`src/db/queries/closures.ts`)

The agreed formula:
```
sales_gross   = SUM(total_amount)        WHERE status IN ('active','partially_returned')   -- excludes 'returned'
partial_returns_total = SUM(total_amount - paid_amount) WHERE status = 'partially_returned'
sales_net     = sales_gross - partial_returns_total       -- do NOT subtract full 'returned' again
cogs          = SUM(unit_cost * quantity) WHERE status IN ('active','partially_returned')   -- INCLUDES gift cost (no is_gift filter)
gross_profit  = sales_net - cogs
net_profit    = gross_profit + topup_profit + maintenance_revenue - expenses_total
```
**No payment-fee term** — fees were intentionally removed (see §5, C-2).

### Known trap (verify every time)
Because `sales_gross`/`sales_total` already EXCLUDE `status='returned'`, you must **NOT** also subtract a `returns_total` that includes full returns — that double-counts them and produces a negative profit for a fully-refunded day. A fully-returned invoice must net to **0**, not `-total_amount`. (This exact bug appeared first in `reports.ts`, was fixed there, then reappeared in `closures.ts` via a `returns_total` that included `'returned'`. Always test the full-return case on ALL THREE surfaces.)

### Gift cost trap
If a surface filters `is_gift=0` in its COGS query, it MUST subtract `gifts_value` (cost) elsewhere — otherwise gift cost vanishes and profit is overstated. Simplest correct approach: do NOT filter `is_gift` in COGS (let gift cost flow into COGS naturally), matching `reports.ts`.

---

## 5. Fixed Project Decisions (do NOT re-open without the Owner)

- **Storage: Supabase-only (cloud).** SQLite-WASM local mode removed. No offline mode, no offline queue — the Owner confirmed the shop WiFi is stable. A network failure shows a clear Arabic error and preserves the cart; the Owner retries.
- **C-2 Payment fees: NOT tracked.** Account is credited the FULL gross amount; `fee_amount` stored as 0; `accounts.fee_percent` is dead. No surface subtracts a fee.
- **Gifts valued at COST** (`unit_cost`), not retail (`unit_price`).
- **Partial returns: amount-only by design** — do NOT restore stock or reverse COGS. Treated as a retroactive discount. (Documented at `src/db/queries/sales.ts`.)
- **Maintenance "cancel" on a delivered job reverses the delivery** (debits the account back + reversing ledger entry).
- **Clock-tamper guard active** (`src/lib/clockGuard.ts`) — refuses to operate if the device clock is rolled back before `last_known_date`.
- **Admin PIN recovery = security question** (Owner sets Q + A; admin PIN only).
- **No VAT/tax module, no purchases/FIFO module, no customer/supplier UI** — out of scope by Owner decision.

---

## 6. Security (A-2) — pending, deploy separately

The `exec_sql`/`exec_batch` RPCs are `SECURITY DEFINER` and granted to `anon`; the anon key ships in the client bundle, so anyone who extracts it can run arbitrary SQL (delete tables, change balances). This is the highest-severity open item. The prepared "Bundle 6" fix in `new/` is **incomplete** — it restricts writes via typed RPCs but does NOT cover every `dbClient.run`/`batchRun` write path (products, categories, accounts, audit_log were missing). Applying it as-is would break those writes. **Do not apply until every write path has a typed RPC.** It is a separate, high-risk project — keep it isolated from accounting/UX fixes.

---

## 7. Commands

- Typecheck: `npm run typecheck`  (must be clean before any commit)
- Tests: `npm run test`  (Vitest — keep all passing)
- Build: `npm run build`
- These three are the gate for every change, every part, every round.
