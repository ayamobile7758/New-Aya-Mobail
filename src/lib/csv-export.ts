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
  const bom = '\uFEFF';  // BOM for Excel UTF-8 detection
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
