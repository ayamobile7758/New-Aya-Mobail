// src/db/queries/__tests__/purchases-three-surface.test.ts
// =============================================================================
// Three-surface net-profit unchanged check.
//
// PURPOSE:
//   Prove that creating a purchase (which calls createPurchase → mutates
//   products.cost_price and products.stock_qty, optionally debits an
//   account, and writes a ledger row with ref_type='purchase') does NOT
//   change the net_profit reported by any of the three accounting
//   surfaces:
//     1. getReport(fromDate, toDate)         — Reports → Overview
//     2. getProfitAndLoss(fromDate, toDate)  — Reports → P&L
//     3. getOpenDayPreview(targetDate)       — Operations → EOD
//
// WHY IT MUST NOT CHANGE:
//   The net-profit formulas (reports.ts:6-25, closures.ts:6-28) compute
//   COGS as SUM(invoice_items.unit_cost * invoice_items.quantity) over
//   SOLD items only. Past invoices have their unit_cost snapshotted at
//   sale time (functions.sql:249). A purchase updates products.cost_price
//   but does NOT touch any existing invoice_items rows. Therefore all
//   three surfaces must return IDENTICAL net_profit before and after a
//   purchase — for the same date range.
//
// METHOD:
//   We stub dbClient.query to return canned rows that simulate a shop
//   with one past sale (with a snapshotted unit_cost=400 fils). Then we
//   call each surface BEFORE and AFTER simulating a purchase. Because
//   the purchase mutation only touches products + accounts + ledger_entries
//   (and adds a purchases row), and NONE of the three surfaces read
//   products.cost_price directly (they all read invoice_items.unit_cost
//   for COGS), the results must be identical.
//
//   We do NOT call createPurchase() here — that would require a real
//   Supabase connection. Instead we simulate its DATA EFFECTS by changing
//   what the stub returns for the second call. This proves the formulas
//   themselves are immune to a cost_price change.
//
// Run with:  npx vitest run src/db/queries/__tests__/purchases-three-surface.test.ts
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stubbing strategy ──────────────────────────────────────────────────
// We mock '@/db/client' so dbClient.query returns canned rows based on
// the SQL it receives. We detect SQL by substring matching.

const FAKE_TODAY = '2026-06-18';
const FAKE_SALE_DATE = '2026-06-15';  // past sale

// State: tracks whether a purchase has "happened" (mutates the stub)
let purchaseHasHappened = false;

// Canned data for the past sale (one invoice, one item, one payment):
const pastInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-000001',
  invoice_date: FAKE_SALE_DATE,
  status: 'active',
  total_amount: 1000,        // 10.00 JOD
  paid_amount: 1000,
  discount_amount: 0,
  subtotal: 1000,
};

const pastInvoiceItem = {
  id: 'ii-1',
  invoice_id: 'inv-1',
  product_id: 'prod-1',
  product_name: 'Sample Phone',
  quantity: 1,
  unit_price: 1000,
  unit_cost: 400,             // snapshotted at sale time — 4.00 JOD
  product_category: 'device',
  discount_amount: 0,
  line_total: 1000,
  is_gift: 0,
};

const pastPayment = {
  id: 'pay-1',
  invoice_id: 'inv-1',
  account_id: 'acc-cash',
  amount: 1000,
  fee_amount: 0,
};

const cashAccount = {
  id: 'acc-cash',
  name: 'الصندوق',
  type: 'cash',
  balance: 50000,             // 500 JOD — changes if purchase debits it
  fee_percent: 0,
  is_active: 1,
};

// ── Mock the dbClient module ───────────────────────────────────────────
// The mock returns canned data based on SQL substring matching.

vi.mock('@/db/client', () => ({
  dbClient: {
    query: vi.fn(async (sql: string, _params: any[]) => {
      const s = sql.toLowerCase();

      // ── Products table queries ──
      // Before purchase: product has stock 10, cost 400
      // After purchase: product has stock 20, cost 450 (WAC recomputed)
      if (s.includes('from products') && s.includes('where id')) {
        return [{
          id: 'prod-1',
          name: 'Sample Phone',
          sku: 'SP-001',
          category: 'device',
          cost_price: purchaseHasHappened ? 450 : 400,
          stock_qty: purchaseHasHappened ? 20 : 10,
          track_stock: 1,
          is_active: 1,
        }];
      }

      // ── Invoices queries (used by all three surfaces) ──
      // Total sales / gross / discounts
      if (s.includes('from invoices') && s.includes('sum(') && s.includes('total_amount')) {
        if (s.includes("status = 'returned'")) {
          return [{ total: 0 }]; // no full returns
        }
        if (s.includes("status = 'partially_returned'")) {
          return [{ total: 0 }]; // no partial returns
        }
        return [{ total: 1000, discounts: 0 }]; // one active invoice
      }

      // ── invoice_items queries (COGS + gift cost + top products) ──
      if (s.includes('from invoice_items')) {
        // COGS sum
        if (s.includes('sum(ii.unit_cost * ii.quantity)')) {
          if (s.includes('is_gift = 1')) {
            return [{ gifts: 0 }];
          }
          return [{ cogs: 400, total_cost: 400 }];
        }
        // Group-by category / product
        if (s.includes('group by')) {
          return [{
            category: 'device',
            product_name: 'Sample Phone',
            name: 'Sample Phone',
            revenue: 1000,
            cost: 400,
            line_total: 1000,
            qty: 1,
            unit_cost: 400,
            quantity: 1,
          }];
        }
        return [pastInvoiceItem];
      }

      // ── invoice_payments queries ──
      if (s.includes('from invoice_payments')) {
        return [{ ...pastPayment, account_name: 'الصندوق', account_type: 'cash' }];
      }

      // ── expenses ──
      if (s.includes('from expenses')) {
        return [{ total_expenses: 0, total: 0 }];
      }

      // ── topups ──
      if (s.includes('from topups')) {
        return [{ total: 0, topup_profit: 0 }];
      }

      // ── maintenance_jobs ──
      if (s.includes('from maintenance_jobs')) {
        return [{ total: 0, maintenance_revenue: 0 }];
      }

      // ── ledger_entries (inventory_adjustment + eod_reconciliation) ──
      // BEFORE purchase: only the sale's credit ledger row exists.
      // AFTER purchase: that PLUS a 'purchase' debit row.
      // The three surfaces filter on ref_type='inventory_adjustment' (or
      // 'eod_reconciliation' for closure reversal) — they do NOT read
      // ref_type='purchase'. So the inventory_adjustment sum stays 0.
      if (s.includes('from ledger_entries')) {
        if (s.includes("ref_type = 'inventory_adjustment'")) {
          return [{ total: 0 }];
        }
        // Generic ledger query (used by operations.ts)
        if (s.includes('group by type')) {
          return purchaseHasHappened
            ? [
                { type: 'credit', total: 1000 }, // sale
                { type: 'debit', total: 500 },   // purchase (debit)
              ]
            : [
                { type: 'credit', total: 1000 }, // sale only
              ];
        }
        return [];
      }

      // ── accounts ──
      if (s.includes('from accounts')) {
        return [{
          ...cashAccount,
          balance: purchaseHasHappened ? 50000 - 5000 : 50000,
        }];
      }

      // ── purchases (the new table) ──
      if (s.includes('from purchases')) {
        return purchaseHasHappened
          ? [{
              id: 'pur-1',
              purchase_number: 'PRCS-2606-00001',
              purchase_date: FAKE_TODAY,
              product_id: 'prod-1',
              product_name: 'Sample Phone',
              quantity: 10,
              unit_cost: 500,
              total_cost: 5000,
              old_stock_qty: 10,
              old_cost_price: 400,
              new_stock_qty: 20,
              new_cost_price: 450,
              account_id: 'acc-cash',
              account_name: 'الصندوق',
              deleted_at: null,
            }]
          : [];
      }

      // ── sequences ──
      if (s.includes('from sequences') || s.includes('insert into sequences')) {
        return [{ last_val: 1 }];
      }

      // ── day_closures (used by isDayClosed) ──
      if (s.includes('from day_closures')) {
        return []; // day is open
      }

      // ── app_settings (used by clockGuard) ──
      if (s.includes('from app_settings')) {
        return []; // no settings → first-run behavior
      }

      // Default: empty rows
      console.warn('[mock dbClient.query] unhandled SQL:', sql.slice(0, 80));
      return [];
    }),

    run: vi.fn(async (_sql: string, _params: any[]) => ({ changes: 1, lastInsertRowid: 0 })),

    batchRun: vi.fn(async (_stmts: any[]) => {
      // Simulate the purchase mutation succeeding: flip the flag so the
      // next query reads see post-purchase state.
      purchaseHasHappened = true;
      return true;
    }),

    completeSaleRpc: vi.fn(),
    initDb: vi.fn(async () => true),
    getVersion: vi.fn(async () => 14),
    setVersion: vi.fn(),
    exportDatabase: vi.fn(),
    importDatabase: vi.fn(),
  },
}));

// Also mock clockGuard to always return FAKE_TODAY
vi.mock('@/lib/clockGuard', () => ({
  assertClockNotTampered: vi.fn(async () => FAKE_TODAY),
}));

// Mock getDeviceId
vi.mock('@/lib/device', () => ({
  getDeviceId: vi.fn(() => 'test-device'),
}));

// ── Tests ──────────────────────────────────────────────────────────────

import { getReport, getProfitAndLoss } from '../reports';
import { getOpenDayPreview } from '../closures';
import { createPurchase } from '../purchases';

describe('Three-surface net-profit unchanged by a purchase (asset-swap, not expense)', () => {

  beforeEach(() => {
    purchaseHasHappened = false;
  });

  it('getReport: netProfit identical before and after a purchase', async () => {
    // BEFORE purchase
    const before = await getReport(FAKE_SALE_DATE, FAKE_SALE_DATE);
    const netProfitBefore = before.kpi.netProfit;
    const cogsBefore = before.kpi.totalCost;

    // Simulate the purchase: 10 units @ 500 fils, paid from cash account.
    // This will flip purchaseHasHappened = true via the batchRun mock.
    await createPurchase({
      product_id: 'prod-1',
      quantity: 10,
      unit_cost: 500,
      account_id: 'acc-cash',
    });

    // AFTER purchase
    const after = await getReport(FAKE_SALE_DATE, FAKE_SALE_DATE);
    const netProfitAfter = after.kpi.netProfit;
    const cogsAfter = after.kpi.totalCost;

    // ── The core assertion ──
    // Net profit must NOT change because buying inventory is an asset swap,
    // not an expense. COGS only hits when stock is SOLD.
    expect(netProfitAfter).toBe(netProfitBefore);
    expect(cogsAfter).toBe(cogsBefore);

    // The purchase itself should appear nowhere in the P&L components
    // that feed net_profit:
    expect(after.kpi.totalSales).toBe(before.kpi.totalSales);
    expect(after.kpi.totalExpenses).toBe(before.kpi.totalExpenses);
    expect(after.kpi.grossProfit).toBe(before.kpi.grossProfit);
    expect(after.kpi.topupProfit).toBe(before.kpi.topupProfit);
    expect(after.kpi.maintenanceRevenue).toBe(before.kpi.maintenanceRevenue);
    expect(after.kpi.inventoryAdjustmentsTotal).toBe(before.kpi.inventoryAdjustmentsTotal);
  });

  it('getProfitAndLoss: net_profit identical before and after a purchase', async () => {
    const before = await getProfitAndLoss(FAKE_SALE_DATE, FAKE_SALE_DATE);

    await createPurchase({
      product_id: 'prod-1',
      quantity: 10,
      unit_cost: 500,
      account_id: 'acc-cash',
    });

    const after = await getProfitAndLoss(FAKE_SALE_DATE, FAKE_SALE_DATE);

    expect(after.net_profit).toBe(before.net_profit);
    expect(after.cogs).toBe(before.cogs);
    expect(after.sales_gross).toBe(before.sales_gross);
    expect(after.expenses_total).toBe(before.expenses_total);
    expect(after.gross_profit).toBe(before.gross_profit);
  });

  it('getOpenDayPreview: net_profit identical before and after a purchase', async () => {
    // For this surface, we look at TODAY's preview (the purchase happens today).
    // BEFORE: no sales today, no purchases today → net = 0.
    // AFTER:  no sales today, one purchase today → net STILL 0 (asset swap).
    const before = await getOpenDayPreview(FAKE_TODAY);

    await createPurchase({
      product_id: 'prod-1',
      quantity: 10,
      unit_cost: 500,
      account_id: 'acc-cash',
    });

    const after = await getOpenDayPreview(FAKE_TODAY);

    expect(after.net_profit).toBe(before.net_profit);
    // Sales/cogs/expenses all unchanged:
    expect(after.sales_total).toBe(before.sales_total);
    expect(after.cogs_total).toBe(before.cogs_total);
    expect(after.expenses_total).toBe(before.expenses_total);
    expect(after.topup_profit).toBe(before.topup_profit);
    expect(after.maintenance_revenue).toBe(before.maintenance_revenue);
    expect(after.inventory_adjustments_total).toBe(before.inventory_adjustments_total);
  });

  it('purchase WITHOUT a paying account also leaves net profit unchanged', async () => {
    // Credit purchase (no cash leaves the shop) — even more obviously
    // an asset swap (stock ↑, no cash ↓).
    const before = await getReport(FAKE_SALE_DATE, FAKE_SALE_DATE);

    await createPurchase({
      product_id: 'prod-1',
      quantity: 5,
      unit_cost: 600,
      // no account_id — credit purchase
    });

    const after = await getReport(FAKE_SALE_DATE, FAKE_SALE_DATE);
    expect(after.kpi.netProfit).toBe(before.kpi.netProfit);
  });
});
