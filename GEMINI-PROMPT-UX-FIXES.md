# Gemini Implementation Prompt — UX/UI Fixes Round (Aya Mobile POS)

You are the **implementer**. A reviewer (Claude) supervises this work and will re-check every change you make against the live code, line by line. Do exactly what is specified here and **nothing more**. Do not "improve" unrelated code.

---

## §0 — HARD GATE: run tests BEFORE touching anything

Before you edit a single file:

1. Run, and paste the full output of each:
   - `npm run typecheck`
   - `npm run test`
   - `npm run build`
2. If **any** of the three fails on the untouched repo, **STOP immediately** and report the failure. Do not start.
3. If all three pass, make a baseline checkpoint commit (no code changes — just to mark the clean starting point) — e.g. `chore: baseline before UX fixes round`.

**Re-anchor to HEAD:**
- Print `git rev-parse HEAD`. The expected HEAD is **`34f1ad1e0a89609c0f2c0a6f75c7d71d246b88e5`** (commit "fix(cart): wrap localStorage setItem ... (Part 9)").
- If HEAD differs, run `git log -8 --oneline` and check whether any of the target files below were changed by the newer commits. If so, re-read those files and adjust your edits to match the current code before proceeding.

**After EVERY part below:** re-run the three commands (`typecheck`, `test`, `build`). All must stay green. Commit each part as its own checkpoint with a clear message. **Green before you start, green after every part, STOP on any failure.**

---

## Ground rules (do not violate)

- **Surgical edits only.** Do NOT change anything outside what each part specifies. Do NOT touch unrelated code, accounting logic, DB writes, or auth/PIN logic.
- **Arabic RTL UI** — match the styling, spacing, and tone of the neighboring components. All visible text is Arabic.
- **Reuse existing tokens.** The CSS variables already exist in `src/index.css`: `--color-accent` (= `#CF694A`), `--color-accent-hover`, `--color-danger`, `--btn-height: 44px`, etc. Use Tailwind classes that map to these (`bg-accent`, `text-accent`, `border-accent`, `bg-danger`, `text-danger`) instead of hardcoding hex.
- **Cross-file ripple check:** when you remove a JSX element or a call site, check per-file whether any `import` becomes unused — an unused import breaks the strict-TS build. Remove now-unused imports in the same file.
- **No new dependencies.** No new crypto. No new libraries.
- This is a **Supabase-only** cloud app. Do not re-introduce offline/local-storage data concepts.

---

## The work — ordered LOW-RISK first

Each part is independent and committed separately. If a part turns out riskier than described, do the safe subset and **report the rest unapplied** rather than guessing.

---

### PART 1 — Remove the stale OPFS storage warning

**File:** `src/components/layout/Shell.tsx`
**Issue:** The amber warning banner ("تنبيه هام: يتم حفظ بيانات نقطة البيع في هذا المتصفح فقط...") is misleading — data lives in Supabase (cloud), not the browser. Remove it entirely.

- Delete the `showWarning` state, its `useEffect` that reads `localStorage.getItem('opfs_warning_dismissed')`, the `dismissWarning` function, and the entire `{!isPOS && showWarning && (...)}` JSX block (currently lines ~20–32 and ~62–74).
- After removal, check whether `AlertTriangle` and `X` imports from `lucide-react` are still used elsewhere in this file. If not, remove them from the import. (Note: `LogOut` and `Shield` ARE still used by the admin indicator — keep them.)

---

### PART 2 — Change admin-exit FAB colour so it differs from the cart FAB

**File:** `src/components/layout/Shell.tsx` (the admin-exit button, currently ~line 104–111)
**Issue:** The admin-exit FAB uses `bg-accent` (= `#CF694A`), identical to the POS cart-toggle FAB. On the POS page both are visible at once and the manager can't tell them apart.

- Change the admin-exit button's background from `bg-accent hover:bg-accent-hover` to **`bg-danger hover:opacity-90`** (red), keeping `text-white`. Everything else (position, size, icon) stays the same.

---

### PART 3 — Enlarge SavedCartsTabs close-X touch target to 44×44

**File:** `src/modules/pos/components/SavedCartsTabs.tsx` (the per-tab close button, currently ~line 78–89)
**Issue:** The close-X bounding box is ~16×16 px — far below any minimum. It also sits inside the tab's click area, so a missed tap switches carts instead of closing.

- The button currently has `className="p-0.5 ... ms-1 shrink-0 ..."` wrapping `<X className="w-3 h-3" />`.
- Enlarge the **hit area to 44×44** without growing the visible chrome: change `p-0.5` to **`p-2.5 -m-2`** (negative margin absorbs the extra padding so the tab layout doesn't shift). Keep the icon at `w-3 h-3`. Keep `touchAction: 'manipulation'`.
- Verify the tab row height (`h-10` container, `h-8` tabs) still looks right after the negative margin; if the X visually overflows the tab, use `p-2 -m-1.5` instead. Pick whichever keeps the tab visually unchanged while giving ≥40px hit area.

---

### PART 4 — PaymentDialog max height (landscape safety)

**File:** `src/modules/pos/components/PaymentDialog.tsx` (the dialog panel, currently ~line 259)
**Issue:** On short landscape viewports the dialog can touch the screen edges when "advanced" is expanded.

- Change the panel's `max-h-[92vh]` to **`max-h-[85vh]`**. Nothing else. The existing `overflow-y-auto` inner scroll already handles overflow.

---

### PART 5 — PersistenceBanner: add a dismiss (X) button with 7-day cooldown

**File:** `src/components/layout/PersistenceBanner.tsx`
**Issue:** The banner has no close button; on browsers that deny persistence it shows forever.

- Add a dismiss state backed by `localStorage`. On mount, if `localStorage.getItem('persistence_banner_dismissed_until')` is a timestamp in the future, do not show the banner.
- Add an `X` button (import `X` from `lucide-react`) at the end of the banner row. On click: set `localStorage.setItem('persistence_banner_dismissed_until', String(Date.now() + 7*24*60*60*1000))` and hide the banner.
- Keep the existing "persisted → return null" behaviour. The X is an additional escape hatch.
- Style the X to match the banner (red text, small): `className="ms-auto p-1.5 -m-1 hover:bg-black/5 rounded-full shrink-0"` with `<X className="w-4 h-4" />`.

---

### PART 6 — AddToHomeScreen: use localStorage with a 30-day cooldown

**File:** `src/components/pwa/AddToHomeScreen.tsx`
**Issue:** Dismissal is stored in `sessionStorage`, so the banner reappears every fresh launch.

- Replace the two `sessionStorage` calls (read at ~line 15, write at ~line 25) with `localStorage`, but store a **cooldown timestamp**, not just `'true'`:
  - On mount: read `localStorage.getItem('a2hs_dismissed_until')`; if it parses to a timestamp in the future, set `dismissed = true`.
  - On dismiss: `localStorage.setItem('a2hs_dismissed_until', String(Date.now() + 30*24*60*60*1000))`.
- Keep the `isStandalone` check unchanged.

---

### PART 7 — Reports header: enlarge tiny touch targets

**File:** `src/modules/reports/ReportsPage.tsx` (header, ~lines 218–235)

- **Refresh button** (~line 219–225): currently `p-2` + `w-4 h-4` icon (~28px). Change `p-2` to **`p-2.5`** and the icon `w-4 h-4` to **`w-5 h-5`** so the hit area reaches ~44px.
- **Excel button** (~line 226–234): currently `h-9`. Change `h-9` to **`h-11`** and add **`box-border`** to the className. Keep the `hidden sm:inline` on the "Excel" label (icon-only on phone is INTENTIONAL per owner — do not change that).

---

### PART 8 — Maintenance status filter: dropdown on phone

**File:** `src/modules/maintenance/MaintenancePage.tsx` (status-filter tabs, ~line 146–158)
**Issue:** 6 horizontally-scrolling status tabs are hard to scan on phone.

- On phone (`< sm`), render the status filter as a native `<select>` (`h-11`, full width, styled like the other selects in the app). On `sm+`, keep the existing tab row.
- Pattern: wrap the existing tab row in a `hidden sm:flex ...` container, and add a `<select className="sm:hidden h-11 ...">` before it with the same 6 options (all / new / in_progress / ready / delivered / cancelled) bound to the same state setter. Reuse the exact Arabic labels already in the tabs.
- Do not change the filtering logic — only how the control is presented.

---

### PART 9 — MorePage: responsive columns

**File:** `src/modules/more/MorePage.tsx` (~line 19)

- Change `grid grid-cols-2 gap-4` to **`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`**. Nothing else.

---

### PART 10 — ExpensesPage: stop action buttons stacking vertically on phone

**File:** `src/modules/expenses/ExpensesPage.tsx` (~line 169)
**Issue:** `flex-col sm:flex-row` stacks the date pill + 3 action buttons vertically on phone, eating height. The buttons are already icon-only on phone (intentional).

- Change the outer controls container `flex flex-col sm:flex-row flex-wrap ...` (~line 169) to keep the date pill on its own row but the 3 action buttons inline. Simplest: change `flex-col sm:flex-row` to **`flex-row flex-wrap`** and ensure the date pill (`w-full sm:w-auto`) wraps cleanly above the buttons. Verify on a 390px-wide check that the 3 buttons sit in one row and the date pill is full-width above them — adjust `flex-1`/`w-full` only if needed to achieve that.

---

### PART 11 — CartSidebar: hint for qty/price buttons + gift badge

**File:** `src/modules/pos/components/CartSidebar.tsx`

**11a — qty/price action buttons** (~line 580–604): when no item is selected they're disabled with `opacity-50` and no explanation.
- Above the `grid grid-cols-2` of qty/price buttons, when `!selectedItemId`, render a small one-line hint: `<p className="text-[11px] text-text-secondary text-center" style={{ fontFamily: 'Tajawal, sans-serif' }}>اختر منتجاً من السلة لتعديل الكمية أو السعر</p>`. Hide it when an item IS selected.

**11b — gift item discount** (~line 486–508): the per-line discount button is `disabled={item.isGift}` with `opacity: 0.4` and no reason.
- When `item.isGift` is true, instead of the dimmed disabled discount button, render a small green "هدية" badge in that slot (mirror the existing gift-toggle green styling: bg `#DCFCE7`, border `#86EFAC`, text `#16A34A`). When not a gift, render the existing discount button unchanged. Keep the same slot width/flex so the row layout is unchanged.

---

### PART 12 — Empty states for Maintenance & Operations (icon + CTA)

- **Maintenance** (`src/modules/maintenance/MaintenancePage.tsx`): the no-jobs empty state is plain text "لا توجد أجهزة صيانة تطابق بحثك." Wrap it with the `Wrench` icon (already imported) in the app's standard empty-state pattern (centered icon in a muted circle + the text). Match the styling used by the POS/Sales empty states (`flex flex-col items-center justify-center py-12 text-center`, icon `w-12 h-12 text-text-secondary/40`).
- **Operations** (`src/modules/operations/OperationsPage.tsx`): the ledger "لا توجد حركات مالية في هذه الفترة." plain text — wrap it in the same empty-state pattern with an appropriate already-imported icon (e.g. the ledger/list icon used in that file).
- Do not change any data logic — presentation only.

---

### PART 13 — Reduced-motion: global override

**File:** `src/index.css` (the `@media (prefers-reduced-motion: reduce)` block, ~line 103–105)
**Issue:** Only `.admin-mode-line` is disabled.

- Extend the existing reduced-motion block to also neutralize the app's other animations. Add rules so that under `prefers-reduced-motion: reduce`, `.animate-float-up`, `.animate-spin`, and elements using the `animate-in` utilities have `animation` reduced. Concretely add:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .admin-mode-line { animation: none; }
    .animate-float-up,
    .animate-spin,
    [class*="animate-in"] { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
  }
  ```
- Keep it minimal; do not touch any other CSS.

---

### PART 14 — Admin-mode line: animate only on the 15-min pulse

**Files:** `src/index.css` + `src/components/layout/Shell.tsx`
**Issue:** `admin-line-slide 4s linear infinite` runs constantly while in admin mode — visually tiring.

- In `index.css`, **remove** the `animation: admin-line-slide 4s linear infinite;` from the base `.admin-mode-line` rule (keep the gradient + background-size). Add a modifier class `.admin-mode-line-pulse { animation: admin-line-slide 4s linear infinite; }`.
- In `Shell.tsx`, the admin line already toggles `adminPulse` (true for 4s every 15 min). Add the `admin-mode-line-pulse` class to the line element only when `adminPulse` is true (alongside the existing height/shadow change).
- Net effect: the line is a static gradient normally, and only animates during the 15-minute reminder pulse. Verify the reduced-motion rule from Part 13 still covers it (the `.admin-mode-line { animation: none }` rule stays).

---

### PART 15 — Replace hardcoded `#CF694A` with the accent token (className surfaces only)

**Issue:** `#CF694A` is hardcoded in ~23 places instead of using the `accent` token.

**Scope rule — IMPORTANT:** Only replace occurrences where the value maps cleanly to a Tailwind class on a `className` (e.g. `bg-[#CF694A]` → `bg-accent`, `text-[#CF694A]` → `text-accent`, `border-[#CF694A]` / `border-b-[#CF694A]` → `border-accent` / `border-b-accent`). 

**Do NOT touch:**
- Inline `style={{ ... }}` hex values that are inside a `<canvas>`/ECharts color array (`ReportsPage.tsx` chart `COLORS`) — leave those.
- SQL files / DB defaults.
- The `index.css` `@theme` definitions (that's the source of truth).
- Any inline `style` where converting to a Tailwind class would change behavior — if unsure, **leave it and list it in your report** rather than guessing.

Known className targets to convert (verify each still exists at the current line before editing):
- `src/modules/pos/POSPage.tsx` — cart FAB `bg-[#CF694A]` → `bg-accent`.
- `src/modules/pos/components/SavedCartsTabs.tsx` — `text-[#CF694A]` and `border-b-[#CF694A]` → `text-accent` / `border-b-accent`. (The `bg-[#F3F1EC]`/`text-[#6D6A62]` there → `bg-muted`/`text-text-secondary`.)
- `src/modules/pos/components/CartSidebar.tsx` — pay button `bg-[#CF694A]` → `bg-accent`.
- `src/modules/pos/components/ProductGrid.tsx` — any `text-[#CF694A]` / `bg-[#CF694A]` on className → accent classes. (The density slider `accentColor` inline style may stay if it's not a className.)

After this part, do a repo grep for `#CF694A` and list in your report every remaining occurrence with file:line and why you left it (chart color / inline-only / etc.).

---

### PART 16 — `h-11` buttons rendering at 39px: add `box-border`

**Issue:** Buttons declared `h-11` render at ~39px because of border + box-sizing, bypassing the intended 44px.

**Approach (low-risk):** Do NOT mass-rewrite every `h-11`. Instead, for the specific interactive buttons/inputs flagged below, add **`box-border`** to their className so the declared height includes the border and they render at the full 44px:
- `src/modules/sales/SalesPage.tsx`: the date inputs, amount inputs, account select, reset button, invoice search (all `h-11` in the header, ~lines 161, 181, 189, 199, 210, 222, 232).
- `src/modules/expenses/ExpensesPage.tsx`: the CSV / Categories / Add buttons (`h-11`, ~lines 191, 198, 205).
- `src/modules/maintenance/MaintenancePage.tsx`: the search input + the new phone `<select>` from Part 8.

If adding `box-border` visibly changes a layout for the worse, revert that specific element and note it in your report. This is presentation-only — do not change heights elsewhere in the app.

---

### PART 17 — Standardize active-tab colour

**Issue:** Active-tab styling differs across pages (`bg-text-primary text-white` on Products, `border-accent text-accent` on Reports, etc.).

- Pick the convention already used by Reports for **underline tabs**: active = `border-accent text-accent`, inactive = `border-transparent text-text-secondary`.
- For **pill tabs**: active = `bg-accent text-white`, inactive = `bg-muted text-text-secondary`.
- Apply ONLY to: `src/modules/products/ProductsPage.tsx` category tabs (currently `bg-text-primary text-white` active) and `src/modules/inventory/InventoryPage.tsx` tab buttons — bring them to the pill convention above.
- Do NOT restyle Reports (it's the reference) and do NOT change tab behavior. If a page's tabs are visually fine and already match, leave them and note it.

---

### PART 18 — Dashboard recent-invoices: card list on phone

**File:** `src/modules/dashboard/DashboardPage.tsx` (recent invoices section, the `min-w-[640px]` table)
**Issue:** The table forces horizontal scroll on phone.

- On phone (`< md`), render the recent invoices as a stacked card list (one card per invoice: number, date, total, status) instead of the wide table. On `md+`, keep the existing table.
- Pattern: wrap the existing `<table>` in `hidden md:block`, and add a `md:hidden` card list above/below it using the same data array. Match the card styling used by SalesPage invoice cards (`bg-surface border border-border rounded-2xl p-4`).
- Read the current section first to get the exact field names; do not invent fields.

---

### PART 19 — Reports tabs: collapse least-used into a "More" menu (phone)

**File:** `src/modules/reports/ReportsPage.tsx` (the 7-tab nav, ~line 318–337)
**Issue:** 7 horizontally-scrolling tabs are hard to scan on phone/landscape.

- This is the riskiest of the UI-presentation parts because it adds a small menu. **If it gets complex, STOP and report it unapplied** — the other parts are more valuable and must not be blocked by this one.
- Desired: on phone, show the 4 most-used tabs (overview / categories / products / daily) inline and put the remaining (expenses / discounts / pnl) behind a "المزيد" overflow button that opens a small dropdown. On `md+`, show all 7 as today.
- Keep `activeTab` state and switching logic exactly as-is — only the presentation of the tab triggers changes. If the active tab is one of the "More" items, the More button should show as active.

---

### PART 20 — Skeleton loaders (optional polish — do LAST)

**Issue:** Loading states use spinners; skeletons feel faster.

- Add simple skeleton placeholders (gray `bg-muted animate-pulse rounded` blocks) for: the POS product grid initial load, the SalesPage invoice list, and the Reports KPI cards — replacing (or showing alongside) the existing spinner during `isLoading`.
- This is pure polish. If time/risk is a concern, **skip it and report it as skipped** — it is the lowest priority.

---

## STOP-and-report clause

For Parts 8, 17, 18, 19 (the ones that restructure presentation), if the change would require touching state/logic to work, or if you're unsure whether you'd break the existing behavior: **do the safe subset, leave the rest unapplied, and report exactly what you skipped and why.** Doing 16 of 20 parts cleanly is a far better outcome than doing 20 parts with one regression. Never guess on auth, accounting, or DB code — none of these parts should touch those; if any seems to, STOP.

---

## Final report — give me exactly this

1. **HEAD SHA** you started from and ended at.
2. **Per-part:** the file(s) touched, a one-line description of the change, and confirmation that `typecheck` + `test` + `build` passed after that part (paste the summary line of each).
3. **Any part you skipped or partially applied**, with the reason.
4. **Part 15 leftover list:** every remaining `#CF694A` occurrence (file:line) you intentionally left, with why.
5. **Any import you removed** because a deletion made it unused.
6. **Gap analysis:** anything you noticed that looked wrong but was out of scope.
7. Confirm you did **NOT** touch: accounting queries (`reports.ts`, `closures.ts`, `sales.ts`), auth/PIN code, DB write paths, or the `exec_sql`/security RPCs.

There are **no manual Supabase SQL steps** for this round — it is UI-only. Confirm that in your report.
