// src/modules/operations/components/PurchaseDialog.tsx
// =============================================================================
// AYA POS — Purchase Dialog (weighted-average cost recomputation at purchase)
// =============================================================================
// Mirrors the structure of TopupDialog.tsx (same header, same form layout,
// same overlay styling, same auth pattern via requireAdminAction).
//
// KEY UI FEATURES:
//   1. Product picker (only active, track_stock products)
//   2. Quantity (positive integer) + unit cost (decimal JOD → fils)
//   3. Live WAC preview: shows old cost × old qty → new cost × new qty
//   4. Optional paying-account picker (cash/bank). When "بدون حساب دافع"
//      is selected, only stock + cost_price are updated (credit purchase).
//   5. Optional supplier picker
//   6. Notes
//
// All money inputs are parsed via parseMoney (handles Arabic-Indic digits,
// rounds to integer fils). All money displays use formatMoney.
// =============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getActiveAccounts } from '@/db/queries/accounts';
import { getAllProducts, Product } from '@/db/queries/products';
import { dbClient } from '@/db/client';
import { createPurchase, computeWeightedAverageCost } from '@/db/queries/purchases';
import { X, Save, ShoppingCart, TrendingUp, TrendingDown } from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export function PurchaseDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { requireAdminAction } = useAuth();
  const queryClient = useQueryClient();

  const [productId, setProductId] = useState('');
  const [quantityStr, setQuantityStr] = useState('1');
  const [unitCostStr, setUnitCostStr] = useState('');
  const [accountId, setAccountId] = useState('');          // '' = no account
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');

  useEscKey(onClose, isOpen);

  // ── Data: products, accounts, suppliers ──
  const { data: products = [] } = useQuery({
    queryKey: ['products', '', 'all', false],
    queryFn: () => getAllProducts('', 'all', false),
    enabled: isOpen,
  });

  // Only show products that track stock (you can't purchase stock for a
  // service product that doesn't track stock).
  const trackableProducts = useMemo(
    () => products.filter(p => p.track_stock && p.is_active),
    [products]
  );

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      return await dbClient.query('SELECT * FROM suppliers ORDER BY name');
    },
    enabled: isOpen,
  });

  // ── Reset state when dialog opens ──
  useEffect(() => {
    if (isOpen) {
      setProductId('');
      setQuantityStr('1');
      setUnitCostStr('');
      setAccountId('');
      setSupplierId('');
      setNotes('');
    }
  }, [isOpen]);

  // ── Mutation ──
  const purchaseMutation = useMutation({
    mutationFn: createPurchase,
    onSuccess: (result) => {
      // Invalidate everything that could be affected:
      // - products list (stock_qty + cost_price changed)
      // - accounts list (if account was debited)
      // - ledger entries + daily summary
      // - reports (because future sales will use the new cost_price — but
      //   past reports are unaffected; still we invalidate to refresh the
      //   products' cost shown on any open report)
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-period'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      toast.success(
        `تم تسجيل الشراء ${result.purchase_number} — التكلفة الجديدة: ${formatMoney(result.new_cost_price)} للوحدة`
      );
      onClose();
    },
    onError: (error: any) => {
      console.error(error);
      toast.error('حدث خطأ أثناء حفظ الشراء: ' + (error?.message ?? ''));
    },
  });

  // ── Derived: live WAC preview ──
  const selectedProduct: Product | undefined = trackableProducts.find(p => p.id === productId);
  const quantity = parseInt(quantityStr, 10) || 0;
  const unitCost = parseMoney(unitCostStr);    // integer fils
  const totalCost = quantity * unitCost;

  const oldStockQty = selectedProduct?.stock_qty ?? 0;
  const oldCostPrice = selectedProduct?.cost_price ?? 0;
  const newCostPrice = (selectedProduct && quantity > 0 && unitCost >= 0)
    ? computeWeightedAverageCost(oldStockQty, oldCostPrice, quantity, unitCost)
    : oldCostPrice;
  const newStockQty = oldStockQty + quantity;
  const wacDelta = newCostPrice - oldCostPrice;

  // ── Submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast.error('الرجاء اختيار منتج');
      return;
    }
    if (!selectedProduct) {
      toast.error('المنتج غير صالح');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('الكمية يجب أن تكون عدداً صحيحاً موجباً');
      return;
    }
    if (!Number.isInteger(unitCost) || unitCost < 0) {
      toast.error('تكلفة الوحدة غير صالحة');
      return;
    }
    requireAdminAction(() =>
      purchaseMutation.mutate({
        product_id: productId,
        quantity,
        unit_cost: unitCost,
        account_id: accountId || null,
        supplier_id: supplierId || null,
        notes: notes || null,
      })
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl w-[calc(100%-2rem)] max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* ── Header ── */}
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-accent" />
            تسجيل شراء بضاعة
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full" aria-label="إغلاق">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto flex-1 space-y-4">

          {/* Product picker */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">المنتج *</label>
            <select
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
              required
            >
              <option value="">-- اختر منتجاً --</option>
              {trackableProducts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — مخزون: {p.stock_qty} — تكلفة حالية: {formatMoney(p.cost_price)}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity + Unit cost (two-column on wide screens) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">الكمية *</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantityStr}
                onChange={e => setQuantityStr(e.target.value)}
                className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">تكلفة الوحدة (د.أ) *</label>
              <input
                type="number"
                step="any"
                min="0"
                value={unitCostStr}
                onChange={e => setUnitCostStr(e.target.value)}
                className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          {/* ── Live WAC preview ── */}
          {selectedProduct && quantity > 0 && (
            <div className="p-3 bg-muted/50 rounded-xl space-y-2 text-sm">
              <div className="flex justify-between">
                <span>الوضع الحالي:</span>
                <span className="font-bold numeric">
                  {oldStockQty} وحدة × {formatMoney(oldCostPrice)} = {formatMoney(oldStockQty * oldCostPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>الشراء الجديد:</span>
                <span className="font-bold numeric">
                  +{quantity} وحدة × {formatMoney(unitCost)} = {formatMoney(totalCost)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span>المخزون بعد الشراء:</span>
                <span className="font-bold numeric">{newStockQty} وحدة</span>
              </div>
              <div className="flex justify-between border-t border-dashed border-border pt-2 font-bold">
                <span>التكلفة الجديدة (متوسط موزون):</span>
                <span className={cn(
                  "numeric flex items-center gap-1",
                  wacDelta > 0 ? "text-danger" : wacDelta < 0 ? "text-success" : ""
                )}>
                  {wacDelta > 0 && <TrendingUp className="w-4 h-4" />}
                  {wacDelta < 0 && <TrendingDown className="w-4 h-4" />}
                  {formatMoney(newCostPrice)}
                  {wacDelta !== 0 && (
                    <span className="text-xs font-normal">
                      ({wacDelta > 0 ? '+' : ''}{formatMoney(wacDelta)})
                    </span>
                  )}
                </span>
              </div>
              <p className="text-xs text-text-secondary pt-1">
                ملاحظة: شراء البضاعة لا يقلّل صافي الربح الآن — التكلفة تُحتسب فقط عند البيع.
              </p>
            </div>
          )}

          {/* Paying account (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">الحساب الدافع (اختياري)</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
            >
              <option value="">— بدون خصم من حساب (شراء آجل) —</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({formatMoney(acc.balance)})
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">
              إذا اخترت حساباً سيُخصم {totalCost > 0 ? formatMoney(totalCost) : '—'} من رصيده. اتركه فارغاً للشراء الآجل.
            </p>
          </div>

          {/* Supplier (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">المورّد (اختياري)</label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
            >
              <option value="">-- بدون مورّد --</option>
              {suppliers.map((sup: any) => (
                <option key={sup.id} value={sup.id}>{sup.name}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">ملاحظات</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg p-3 outline-none focus:border-accent min-h-[80px]"
              placeholder="مثال: فاتورة المورّد رقم ١٢٣٤، شحنة بتاريخ كذا..."
            />
          </div>

          {/* Actions */}
          <div className="pt-4 flex gap-3 pb-safe">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-[var(--btn-height)] bg-surface border border-border font-bold rounded-lg hover:bg-muted transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={purchaseMutation.isPending}
              className="flex-1 h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Save className="w-5 h-5" />
              {purchaseMutation.isPending ? 'جاري الحفظ…' : 'حفظ الشراء'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
