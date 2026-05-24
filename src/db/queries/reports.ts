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

  const totalSales = kpiRow?.total_sales ?? 0;
  const totalDiscounts = kpiRow?.total_discounts ?? 0;
  const invoiceCount = kpiRow?.invoice_count ?? 0;
  const avgInvoice = kpiRow?.avg_invoice ?? 0;
  const totalQty = kpiRow?.total_qty ?? 0;
  const totalCost = kpiRow?.total_cost ?? 0;
  const grossProfit = totalSales - totalCost;
  const totalExpenses = expRow?.total_expenses ?? 0;
  const netProfit = grossProfit - totalExpenses;
  const returnCount = retRow?.return_count ?? 0;
  const returnValue = retRow?.return_value ?? 0;
  const giftCost = giftRow?.gift_cost ?? 0;

  // 5. Sales by category (snapshot)
  const byCategoryRaw = await dbClient.query(
    `SELECT
       ii.product_category               AS category,
       COALESCE(SUM(ii.line_total), 0)  AS revenue,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost,
       COALESCE(SUM(ii.quantity), 0)    AS qty
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active'
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

  // 6. Top 10 products by revenue
  const topProductsRaw = await dbClient.query(
    `SELECT
       ii.product_name                   AS name,
       COALESCE(SUM(ii.quantity), 0)    AS qty,
       COALESCE(SUM(ii.line_total), 0)  AS revenue,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost
     FROM invoice_items ii
     JOIN invoices i ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active'
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
  const byAccountRaw = await dbClient.query(
    `SELECT
       a.name AS account_name,
       a.type AS account_type,
       COALESCE(SUM(ip.amount), 0) AS amount
     FROM invoice_payments ip
     JOIN accounts a ON ip.account_id = a.id
     JOIN invoices i ON ip.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active' AND ip.amount > 0
     GROUP BY a.id, a.name, a.type
     ORDER BY amount DESC`,
    [fromDate, toDate]
  );

  // 8. Daily breakdown (sales)
  const dailySalesRaw = await dbClient.query(
    `SELECT
       i.invoice_date AS date,
       COALESCE(SUM(i.total_amount), 0)    AS sales,
       COALESCE(SUM(i.discount_amount), 0) AS discounts,
       COALESCE(SUM(ii.unit_cost * ii.quantity), 0) AS cost
     FROM invoices i
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.invoice_date BETWEEN ? AND ? AND i.status = 'active'
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

// ── P&L ──────────────────────────────────────────────────────────────────────
export interface ProfitAndLoss {
  sales_gross: number;
  returns_total: number;
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
  const [salesRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status IN ('active', 'partially_returned')`,
    [fromDate, toDate]
  );

  const [returnsRow] = await dbClient.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM invoices
     WHERE invoice_date BETWEEN ? AND ?
       AND status = 'returned'`,
    [fromDate, toDate]
  );

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
       AND DATE(delivered_at) BETWEEN ? AND ?`,
    [fromDate, toDate]
  );

  const sales_gross        = Number(salesRow?.total  ?? 0);
  const returns_total      = Number(returnsRow?.total ?? 0);
  const sales_net          = sales_gross;
  const cogs               = Number(cogsRow?.cogs    ?? 0);
  const gross_profit       = sales_net - cogs;
  const expenses_total     = Number(expRow?.total    ?? 0);
  const topup_profit       = Number(topupRow?.total  ?? 0);
  const maintenance_revenue = Number(mainRow?.total  ?? 0);
  const other_income       = topup_profit + maintenance_revenue;
  const net_profit         = gross_profit + other_income - expenses_total;

  return {
    sales_gross,
    returns_total,
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
