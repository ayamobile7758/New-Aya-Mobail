// src/db/queries/reports.ts
// =============================================================================
// BUNDLE 1 — Accounting Core (C-1, C-3, C-4, NEW-2)
// HEAD: b6c491e
//
// AGREED NET-PROFIT FORMULA (must stay consistent across all three surfaces):
// ─────────────────────────────────────────────────────────────────────────────
//   sales_gross   = SUM(invoices.total_amount) WHERE status IN ('active','partially_returned')
//   returns_total = SUM(invoices.total_amount) WHERE status = 'returned'   [KPI only, NOT subtracted]
//   partial_returns_total = SUM(invoices.total_amount - invoices.paid_amount) WHERE status='partially_returned'
//   sales_net     = sales_gross - partial_returns_total                    [C-1: do NOT subtract returns_total]
//   cogs          = SUM(invoice_items.unit_cost * invoice_items.quantity) WHERE invoice.status IN ('active','partially_returned')
//   gross_profit  = sales_net - cogs
//   topup_profit  = SUM(topups.profit)        WHERE topup_date BETWEEN from AND to
//   maintenance_revenue = SUM(maintenance_jobs.final_amount) WHERE status='delivered' AND substr(delivered_at,1,10) BETWEEN from AND to
//   expenses_total = SUM(expenses.amount)    WHERE expense_date BETWEEN from AND to
//   net_profit    = gross_profit + topup_profit + maintenance_revenue - expenses_total
//
//   [C-2 decision] No payment-fee term — fees are no longer tracked anywhere.
//
// This formula must produce the SAME net_profit as:
//   - getProfitAndLoss(...) in this file
//   - getOpenDayPreview(targetDate) in src/db/queries/closures.ts
// for any single-day range (fromDate == toDate == targetDate).
// ─────────────────────────────────────────────────────────────────────────────

import { dbClient } from '../client';

const CATEGORY_NAMES: Record<string, string> = {
  device: 'أجهزة',
  sim: 'شرائح اتصال',
  service_general: 'خدمات عامة',
  service_repair: 'خدمات صيانة',
  accessory: 'إكسسوارات',
  package: 'باقات',
};

export function categoryLabel(cat: string | null | undefined): string {
  if (!cat) return 'غير مصنف';
  return CATEGORY_NAMES[cat] || cat;
}

// ─────────────────────────────────────────────────────────────────────────────
// getReport — Overview KPIs (used by Reports → Overview tab)
// ─────────────────────────────────────────────────────────────────────────────
export async function getReport(fromDate: string, toDate: string) {
  // 1. KPIs — C-5/NEW-2: include 'partially_returned' so a partially-refunded
  //    invoice still contributes its gross sale to the Overview KPIs.
  //    (Previously: filtered status='active' only, which hid partial returns.)
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

  // 2. Total expenses
  const [expRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses
     FROM expenses WHERE expense_date BETWEEN ? AND ?`,
    [fromDate, toDate]
  );

  // 3. Returns — full returns only (surfaced as a KPI; not subtracted from sales_net — see C-1)
  const [retRow] = await dbClient.query(
    `SELECT COUNT(id) AS return_count, COALESCE(SUM(total_amount), 0) AS return_value
     FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status = 'returned'`,
    [fromDate, toDate]
  );

  // C-1 NEW: partial returns — this IS subtracted from sales_net.
  const [partialReturnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ? AND status = 'partially_returned'`,
    [fromDate, toDate]
  );

  // 4. Gift cost — cost of goods given as gifts (0 revenue, full cost reduces profit)
  // C-3 / NEW-2: include 'partially_returned' so gift cost is counted even if the
  // invoice was partially refunded.
  const [giftRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS gift_cost
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned') AND ii.is_gift = 1`,
    [fromDate, toDate]
  );

  // C-4 NEW: topup profit for the period (was missing from Overview netProfit)
  const [topupRow] = await dbClient.query(
    `SELECT COALESCE(SUM(profit), 0) AS total
     FROM topups
     WHERE topup_date BETWEEN ? AND ?`,
    [fromDate, toDate]
  );

  // C-4 NEW: maintenance revenue for the period
  const [mainRow] = await dbClient.query(
    `SELECT COALESCE(SUM(final_amount), 0) AS total
     FROM maintenance_jobs
     WHERE status = 'delivered'
       AND substr(delivered_at, 1, 10) BETWEEN ? AND ?`,
    [fromDate, toDate]
  );

  const totalSales = kpiRow?.total_sales ?? 0;
  const totalDiscounts = kpiRow?.total_discounts ?? 0;
  const invoiceCount = kpiRow?.invoice_count ?? 0;
  const avgInvoice = kpiRow?.avg_invoice ?? 0;
  const totalQty = kpiRow?.total_qty ?? 0;
  const totalCost = kpiRow?.total_cost ?? 0;
  const partialReturnsTotal = Number(partialReturnsRow?.total ?? 0);
  // C-1: sales_net deducts ONLY partial_returns_total, NOT returns_total.
  // returns_total is kept in the response for the dashboard "Returns" KPI widget.
  const grossProfit = totalSales - totalCost;
  const totalExpenses = expRow?.total_expenses ?? 0;
  const topupProfit = Number(topupRow?.total ?? 0);
  const maintenanceRevenue = Number(mainRow?.total ?? 0);
  // C-4 + C-1: net profit includes topup + maintenance, subtracts expenses.
  // No payment-fee term (C-2 decision: fees are not tracked).
  const netProfit = grossProfit + topupProfit + maintenanceRevenue - totalExpenses;
  const returnCount = retRow?.return_count ?? 0;
  const returnValue = retRow?.return_value ?? 0;
  const giftCost = giftRow?.gift_cost ?? 0;

  // 5. Sales by category (snapshot) — NEW-2: include 'partially_returned'
  const byCategoryRaw = await dbClient.query(
    `SELECT
       ii.product_category               AS category,
       COALESCE(SUM(ii.line_total), 0)  AS revenue,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost,
       COALESCE(SUM(ii.quantity), 0)    AS qty
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned')
     GROUP BY ii.product_category
     ORDER BY revenue DESC`,
    [fromDate, toDate]
  );

  const salesByCategory = byCategoryRaw.map((r: any) => ({
    category: categoryLabel(r.category),
    revenue: r.revenue,
    cost: r.cost,
    profit: r.revenue - r.cost,
    qty: r.qty,
  }));

  // 6. Top 10 products by revenue — NEW-2: include 'partially_returned'
  const topProductsRaw = await dbClient.query(
    `SELECT
       ii.product_name                   AS name,
       COALESCE(SUM(ii.quantity), 0)    AS qty,
       COALESCE(SUM(ii.line_total), 0)  AS revenue,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned')
     GROUP BY ii.product_name
     ORDER BY revenue DESC
     LIMIT 10`,
    [fromDate, toDate]
  );

  const topProducts = topProductsRaw.map((r: any) => ({
    name: r.name,
    qty: r.qty,
    revenue: r.revenue,
    cost: r.cost,
    profit: r.revenue - r.cost,
  }));

  // 7. Sales by payment account
  // C-2 decision: fees no longer subtracted, so SUM(ip.amount) now reconciles
  // with accounts.balance (which receives the full gross amount after Bundle 2).
  // We still surface fee_amount for reference, but it will always be 0 going forward.
  const byAccountRaw = await dbClient.query(
    `SELECT
       a.name AS account_name,
       a.type AS account_type,
       COALESCE(SUM(ip.amount), 0)        AS amount,
       COALESCE(SUM(ip.fee_amount), 0)    AS fees
     FROM invoice_payments ip
     JOIN accounts a ON ip.account_id = a.id
     JOIN invoices i ON ip.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned') AND ip.amount > 0
     GROUP BY a.id, a.name, a.type
     ORDER BY amount DESC`,
    [fromDate, toDate]
  );

  // 8. Daily breakdown (sales) — NEW-2: include 'partially_returned'
  const dailySalesRaw = await dbClient.query(
    `SELECT
       i.invoice_date AS date,
       COALESCE(SUM(i.total_amount), 0)    AS sales,
       COALESCE(SUM(i.discount_amount), 0) AS discounts,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status IN ('active', 'partially_returned')
     GROUP BY i.invoice_date
     ORDER BY i.invoice_date ASC`,
    [fromDate, toDate]
  );

  // Daily expenses
  const dailyExpRaw = await dbClient.query(
    `SELECT expense_date AS date, COALESCE(SUM(amount), 0) AS expenses
     FROM expenses WHERE expense_date BETWEEN ? AND ?
     GROUP BY expense_date`,
    [fromDate, toDate]
  );

  const salesDayMap: Record<string, any> = {};
  dailySalesRaw.forEach((r: any) => { salesDayMap[r.date] = r; });
  const expDayMap: Record<string, any> = {};
  dailyExpRaw.forEach((r: any) => { expDayMap[r.date] = r; });

  const allDays = Array.from(new Set([...Object.keys(salesDayMap), ...Object.keys(expDayMap)])).sort();
  const daily = allDays.map(date => {
    const s = salesDayMap[date] ?? { sales: 0, discounts: 0, cost: 0 };
    const e = expDayMap[date] ?? { expenses: 0 };
    return {
      date,
      sales: s.sales,
      discounts: s.discounts,
      cost: s.cost,
      expenses: e.expenses,
      grossProfit: s.sales - s.cost,
      netProfit: s.sales - s.cost - e.expenses,
    };
  });

  // 9. Expenses by category
  const expByCatRaw = await dbClient.query(
    `SELECT ec.name AS category, COALESCE(SUM(e.amount), 0) AS total
     FROM expenses e
     LEFT JOIN expense_categories ec ON e.category_id = ec.id
     WHERE e.expense_date BETWEEN ? AND ?
     GROUP BY ec.name
     ORDER BY total DESC`,
    [fromDate, toDate]
  );

  const expensesByCategory = expByCatRaw.map((r: any) => ({
    category: r.category || 'غير مصنف',
    total: r.total,
  }));

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
      topupProfit,           // NEW (C-4)
      maintenanceRevenue,    // NEW (C-4)
      partialReturnsTotal,   // NEW (C-1)
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

export type ReportData = Awaited<ReturnType<typeof getReport>>;

// ─────────────────────────────────────────────────────────────────────────────
// P&L — used by Reports → Profit & Loss tab
// ─────────────────────────────────────────────────────────────────────────────
export interface ProfitAndLoss {
  sales_gross: number;
  returns_total: number;          // KPI only — NOT subtracted from sales_net (C-1)
  partial_returns_total: number;  // IS subtracted from sales_net
  sales_net: number;
  cogs: number;
  gross_profit: number;
  expenses_total: number;
  expenses_by_category: { category_name: string; total: number }[];
  topup_profit: number;
  maintenance_revenue: number;
  other_income: number;
  net_profit: number;
  period: { fromDate: string; toDate: string };
}

export async function getProfitAndLoss(fromDate: string, toDate: string): Promise<ProfitAndLoss> {
  // sales_gross INCLUDES 'partially_returned' so partial-return revenue is visible
  const [salesRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status IN ('active', 'partially_returned')`,
    [fromDate, toDate]
  );

  // returns_total: full returns only — surfaced as a KPI, NOT subtracted from sales_net (C-1)
  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'returned'`,
    [fromDate, toDate]
  );

  // cogs INCLUDES 'partially_returned' (mirrors sales_gross)
  const [cogsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cogs
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ?
       AND i.status IN ('active', 'partially_returned')`,
    [fromDate, toDate]
  );

  const [expRow] = await dbClient.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE expense_date BETWEEN ? AND ?`,
    [fromDate, toDate]
  );

  // CR-C: partial refunds (paid_amount reduced via returnInvoice for partials)
  // C-1: this is the ONLY refund term subtracted from sales_net.
  const [partialReturnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'partially_returned'`,
    [fromDate, toDate]
  );

  const expByCatRaw = await dbClient.query(
    `SELECT COALESCE(ec.name, 'غير مصنف') AS category_name,
            COALESCE(SUM(e.amount), 0)    AS total
     FROM expenses e
     LEFT JOIN expense_categories ec ON e.category_id = ec.id
     WHERE e.expense_date BETWEEN ? AND ?
     GROUP BY ec.name
     ORDER BY total DESC`,
    [fromDate, toDate]
  );

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

  const sales_gross        = Number(salesRow?.total  ?? 0);
  const returns_total      = Number(returnsRow?.total ?? 0);
  const partial_returns_total = Number(partialReturnsRow?.total ?? 0);
  // C-1 REGRESSION FIX: sales_net deducts ONLY partial_returns_total.
  // Previously subtracted returns_total too — double-counting fully-returned invoices
  // (they were already excluded from sales_gross by the status filter).
  const sales_net          = sales_gross - partial_returns_total;
  const cogs               = Number(cogsRow?.cogs    ?? 0);
  const gross_profit       = sales_net - cogs;
  const expenses_total     = Number(expRow?.total    ?? 0);
  const topup_profit       = Number(topupRow?.total  ?? 0);
  const maintenance_revenue = Number(mainRow?.total  ?? 0);
  const other_income       = topup_profit + maintenance_revenue;
  // No payment-fee term (C-2 decision: fees are not tracked).
  const net_profit         = gross_profit + other_income - expenses_total;

  return {
    sales_gross,
    returns_total,
    partial_returns_total,
    sales_net,
    cogs,
    gross_profit,
    expenses_total,
    expenses_by_category: expByCatRaw.map((r: any) => ({
      category_name: r.category_name,
      total: r.total,
    })),
    topup_profit,
    maintenance_revenue,
    other_income,
    net_profit,
    period: { fromDate, toDate },
  };
}
