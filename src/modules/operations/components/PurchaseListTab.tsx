// src/modules/operations/components/PurchaseListTab.tsx
// =============================================================================
// AYA POS — Purchase history tab (drop-in for OperationsPage)
// =============================================================================
// Shows a filterable table of past purchases with the WAC snapshot columns.
// Recommended placement: as a third tab on OperationsPage (next to "ledger"
// and "eod"). See OPERATIONS_PAGE_PATCH.md for the exact edit.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPurchases, deletePurchase, Purchase } from '@/db/queries/purchases';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Trash2, ShoppingCart, Download } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';

export function PurchaseListTab() {
  const qc = useQueryClient();
  const { requireAdminAction } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(today);

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ['purchases', fromDate, toDate],
    queryFn: () => getPurchases({ fromDate, toDate, limit: 500 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePurchase(id),
    onSuccess: () => {
      toast.success('تم حذف عملية الشراء وعكس تأثيرها المالي');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['all-products'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['ledger-entries'] });
      qc.invalidateQueries({ queryKey: ['daily-summary'] });
    },
    onError: (err: any) => {
      toast.error('فشل الحذف: ' + (err?.message ?? ''));
    },
  });

  const handleDelete = (id: string) => {
    requireAdminAction(() => {
      if (!window.confirm('هل أنت متأكد من حذف هذه العملية؟ سيتم عكس التأثير المالي بالكامل.')) return;
      deleteMutation.mutate(id);
    });
  };

  const exportCSV = () => {
    if (!purchases.length) { toast.error('لا توجد بيانات للتصدير'); return; }
    const BOM = '\uFEFF';
    const header = ['رقم الشراء', 'التاريخ', 'المنتج', 'الكمية', 'تكلفة الوحدة', 'الإجمالي', 'التكلفة القديمة', 'التكلفة الجديدة', 'الحساب', 'ملاحظات'];
    const rows = purchases.map(p => [
      p.purchase_number,
      p.purchase_date,
      p.product_name,
      p.quantity,
      (p.unit_cost / 100).toFixed(2),
      (p.total_cost / 100).toFixed(2),
      (p.old_cost_price / 100).toFixed(2),
      (p.new_cost_price / 100).toFixed(2),
      p.account_name ?? '',
      p.notes ?? '',
    ]);
    const csv = BOM + [header, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `purchases_${fromDate}_to_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Aggregate KPIs
  const totals = purchases.reduce((acc, p) => {
    acc.totalPurchases += p.total_cost;
    acc.totalQty += p.quantity;
    return acc;
  }, { totalPurchases: 0, totalQty: 0 });

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-border p-4 rounded-2xl">
          <span className="text-text-secondary text-sm mb-1 block" style={{ fontFamily: 'Tajawal, sans-serif' }}>عدد المشتريات</span>
          <span className="font-bold text-xl md:text-2xl numeric text-accent">{purchases.length}</span>
        </div>
        <div className="bg-surface border border-border p-4 rounded-2xl">
          <span className="text-text-secondary text-sm mb-1 block" style={{ fontFamily: 'Tajawal, sans-serif' }}>إجمالي الكميات</span>
          <span className="font-bold text-xl md:text-2xl numeric">{totals.totalQty}</span>
        </div>
        <div className="bg-surface border border-border p-4 rounded-2xl col-span-2 md:col-span-1">
          <span className="text-text-secondary text-sm mb-1 block" style={{ fontFamily: 'Tajawal, sans-serif' }}>إجمالي قيمة المشتريات</span>
          <span className="font-bold text-xl md:text-2xl numeric text-warning">{formatMoney(totals.totalPurchases)}</span>
        </div>
      </div>

      {/* Filter + export row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 bg-muted p-1 rounded-xl h-11">
          <input type="date" value={fromDate} dir="ltr"
            onChange={e => setFromDate(e.target.value)}
            className="bg-transparent border-none outline-none font-medium px-2 py-1 text-sm cursor-pointer h-full" />
          <span className="text-text-secondary text-xs">←</span>
          <input type="date" value={toDate} dir="ltr"
            onChange={e => setToDate(e.target.value)}
            className="bg-transparent border-none outline-none font-medium px-2 py-1 text-sm cursor-pointer h-full" />
        </div>
        <button
          onClick={exportCSV}
          disabled={isLoading || !purchases.length}
          className="h-11 px-3 bg-surface border border-border text-sm font-medium rounded-xl hover:border-accent transition-colors flex items-center gap-1.5 disabled:opacity-50"
          style={{ fontFamily: 'Tajawal, sans-serif' }}
        >
          <Download className="w-4 h-4 text-accent" />
          تصدير CSV
        </button>
        <span className="text-xs text-text-secondary ms-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
          {isLoading ? '...' : `${purchases.length} عملية`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-accent" />
          <h2 className="font-bold text-lg" style={{ fontFamily: 'Tajawal, sans-serif' }}>سجل المشتريات</h2>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full" />
          </div>
        ) : purchases.length === 0 ? (
          <div className="p-12 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
            لا توجد مشتريات في هذه الفترة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-muted text-text-secondary">
                <tr>
                  <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>رقم الشراء</th>
                  <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>التاريخ</th>
                  <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>المنتج</th>
                  <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الكمية</th>
                  <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>تكلفة الوحدة</th>
                  <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>الإجمالي</th>
                  <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>التكلفة القديمة</th>
                  <th className="px-4 py-3 text-end" style={{ fontFamily: 'Tajawal, sans-serif' }}>التكلفة الجديدة</th>
                  <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الحساب</th>
                  <th className="px-4 py-3 text-center" style={{ fontFamily: 'Tajawal, sans-serif' }}>حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchases.map((p: Purchase) => {
                  const delta = p.new_cost_price - p.old_cost_price;
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs numeric">{p.purchase_number}</td>
                      <td className="px-4 py-3 numeric">{p.purchase_date}</td>
                      <td className="px-4 py-3 font-medium">{p.product_name}</td>
                      <td className="px-4 py-3 text-end numeric font-bold">+{p.quantity}</td>
                      <td className="px-4 py-3 text-end numeric">{formatMoney(p.unit_cost)}</td>
                      <td className="px-4 py-3 text-end numeric font-bold text-warning">{formatMoney(p.total_cost)}</td>
                      <td className="px-4 py-3 text-end numeric text-text-secondary">
                        {formatMoney(p.old_cost_price)} <span className="text-xs">×{p.old_stock_qty}</span>
                      </td>
                      <td className={cn("px-4 py-3 text-end numeric font-bold", delta > 0 ? "text-danger" : delta < 0 ? "text-success" : "")}>
                        {formatMoney(p.new_cost_price)} <span className="text-xs">×{p.new_stock_qty}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-secondary">{p.account_name ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 rounded-lg text-danger hover:bg-danger-bg/50 transition-colors disabled:opacity-40"
                          aria-label="حذف"
                          title="حذف الشراء وعكس تأثيره المالي"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
