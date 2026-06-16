import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllProducts } from '@/db/queries/products';
import { createInventoryCount, getInventoryCounts, createAccountReconciliation } from '@/db/queries/inventory';
import { getActiveAccounts } from '@/db/queries/accounts';
import { useAuth } from '@/contexts/AuthContext';
import { Search, CheckCircle, PackageSearch, History, Scale } from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<'new_count' | 'history' | 'reconciliation'>('new_count');

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
              <PackageSearch className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">إدارة المخزون والتسويات</h1>
              <p className="text-sm text-text-secondary">متابعة الأرصدة وجرد المنتجات</p>
            </div>
          </div>
          
          <div className="flex gap-2 bg-muted p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('new_count')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2",
                activeTab === 'new_count' ? "bg-surface text-accent shadow-sm" : "text-text-secondary hover:text-text-primary"
              )}
            >
              <PackageSearch className="w-4 h-4" />
              جرد جديد
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2",
                activeTab === 'history' ? "bg-surface text-accent shadow-sm" : "text-text-secondary hover:text-text-primary"
              )}
            >
              <History className="w-4 h-4" />
              سجل الجرد
            </button>
            <button
              onClick={() => setActiveTab('reconciliation')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2",
                activeTab === 'reconciliation' ? "bg-surface text-accent shadow-sm" : "text-text-secondary hover:text-text-primary"
              )}
            >
              <Scale className="w-4 h-4" />
              تسوية حساب
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 bg-background content-area">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'new_count' && <NewCountTab />}
          {activeTab === 'history' && <HistoryTab />}
          {activeTab === 'reconciliation' && <ReconciliationTab />}
        </div>
      </main>
    </div>
  );
}

function NewCountTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  
  const [actualCounts, setActualCounts] = useState<Record<string, { actual_qty: string, reason: string }>>({});
  const { requireAdminAction } = useAuth();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', search, categoryFilter, false],
    queryFn: () => getAllProducts(search, categoryFilter === 'all' ? undefined : categoryFilter, false),
  });

  const trackableProducts = products.filter(p => p.track_stock);

  const handleUpdateActualQty = (productId: string, value: string) => {
    setActualCounts(prev => ({
      ...prev,
      [productId]: { ...prev[productId], actual_qty: value, reason: prev[productId]?.reason || '' }
    }));
  };

  const handleUpdateReason = (productId: string, value: string) => {
    setActualCounts(prev => ({
      ...prev,
      [productId]: { ...prev[productId], reason: value, actual_qty: prev[productId]?.actual_qty || '' }
    }));
  };

  const inventoryMutation = useMutation({
    mutationFn: (items: any[]) => createInventoryCount(items, 'جرد روتيني'),
    onSuccess: () => {
      toast.success('تم الجرد وتحديث الأرصدة بنجاح');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      setActualCounts({});
    },
    onError: () => {
      toast.error('حدث خطأ أثناء حفظ الجرد');
    }
  });

  const changedItems = useMemo(() => {
    const items: any[] = [];
    Object.entries(actualCounts).forEach(([productId, data]: [string, any]) => {
      if (data.actual_qty && data.actual_qty !== '') {
        const p = trackableProducts.find(x => x.id === productId);
        if (p) {
          const actual = parseInt(data.actual_qty);
          if (!isNaN(actual) && actual !== p.stock_qty) {
            items.push({
              product_id: productId,
              system_qty: p.stock_qty,
              actual_qty: actual,
              reason: data.reason
            });
          }
        }
      }
    });
    return items;
  }, [actualCounts, trackableProducts]);

  const handleSubmit = async () => {
    if (changedItems.length === 0) {
      toast.error('لا توجد فروقات منتجات مدخلة');
      return;
    }
    requireAdminAction(() => inventoryMutation.mutate(changedItems));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute end-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input 
            type="text" 
            placeholder="بحث عن منتج..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-11 ps-4 pe-10 rounded-xl border border-border bg-background focus:border-accent outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-11 px-3 rounded-xl border border-border bg-background focus:border-accent outline-none"
        >
          <option value="all">كل الفئات</option>
          <option value="device">أجهزة</option>
          <option value="accessory">إكسسوارات</option>
          <option value="sim">شرائح</option>
          <option value="package">بطاقات/باقات</option>
        </select>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full"></div></div>
      ) : trackableProducts.length === 0 ? (
        <div className="text-center p-8 bg-surface rounded-2xl border border-border">
          <p className="text-secondary">لا توجد منتجات تطابق بحثك.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl px-2 py-4 space-y-3">
          <div className="flex font-bold px-2 text-sm text-text-secondary gap-4">
            <div className="flex-1">المنتج</div>
            <div className="w-20 text-center">نظامي</div>
            <div className="w-24 text-center">فعلي</div>
            <div className="w-1/3">السبب (إذا اختلف)</div>
          </div>
          {trackableProducts.map(product => {
            const actualQty = actualCounts[product.id]?.actual_qty ?? '';
            const reason = actualCounts[product.id]?.reason ?? '';
            const isDiff = actualQty !== '' && parseInt(actualQty) !== product.stock_qty;
            
            return (
              <div key={product.id} className={cn("flex flex-wrap sm:flex-nowrap items-center gap-4 p-2 rounded-lg border", isDiff ? "border-warning/50 bg-warning-bg/20" : "border-border/50")}>
                <div className="flex-1 min-w-[150px] font-medium">{product.name}</div>
                <div className="w-20 text-center font-bold numeric">{product.stock_qty}</div>
                <div className="w-24 shrink-0">
                  <input
                    type="number"
                    min="0"
                    placeholder={product.stock_qty.toString()}
                    value={actualQty}
                    onChange={(e) => handleUpdateActualQty(product.id, e.target.value)}
                    className="w-full text-center h-[var(--input-height)] rounded-lg border border-border focus:border-accent outline-none numeric font-bold bg-background"
                  />
                </div>
                <div className="w-full sm:w-1/3 shrink-0 mt-2 sm:mt-0">
                  {isDiff && (
                    <input
                      type="text"
                      placeholder="سبب التعديل..."
                      value={reason}
                      onChange={(e) => handleUpdateReason(product.id, e.target.value)}
                      className="w-full h-[var(--input-height)] px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {changedItems.length > 0 && (
        <div className="sticky bottom-0 bg-surface/90 backdrop-blur border-t border-border p-4 flex items-center justify-between shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)] rounded-t-xl z-10 mt-8 mb-4">
          <div className="font-bold">
            منتجات معدلة: <span className="text-accent numeric">{changedItems.length}</span>
          </div>
          <button
            onClick={handleSubmit}
            className="h-[var(--btn-height)] px-6 bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-colors flex items-center gap-2"
          >
            <CheckCircle className="w-5 h-5" />
            إتمام الجرد
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['inventory-counts'],
    queryFn: getInventoryCounts
  });

  if (isLoading) return <div className="p-12 text-center"><div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full"></div></div>;

  if (counts.length === 0) {
    return <div className="text-center p-12 bg-surface rounded-2xl border border-border text-text-secondary">لا توجد عمليات جرد مسجلة</div>;
  }

  return (
    <div className="space-y-4">
      {counts.map(count => (
        <div key={count.id} className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-border pb-3">
            <span className="font-bold">عملية جرد #{count.id.slice(0,6)}</span>
            <span className="text-sm text-text-secondary">{count.count_date}</span>
          </div>
          {count.notes && <div className="text-sm bg-muted p-2 rounded">{count.notes}</div>}
          <div className="space-y-1">
            {count.items.map((item: any) => {
              const diff = item.actual_qty - item.system_qty;
              return (
                <div key={item.id} className="flex justify-between items-center py-2 border-b border-border/30 text-sm">
                  <span className="flex-1 font-medium">{item.product_name}</span>
                  <div className="w-1/2 flex items-center justify-between text-center gap-2">
                    <span className="w-12 text-text-secondary line-through numeric">{item.system_qty}</span>
                    <span className="w-12 font-bold numeric">{item.actual_qty}</span>
                    <span className={cn("w-16 font-bold numeric", diff > 0 ? "text-success" : "text-danger")} dir="ltr">
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                    <span className="w-1/3 text-[10px] text-text-secondary truncate text-start">{item.reason || '-'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReconciliationTab() {
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [actualBalanceStr, setActualBalanceStr] = useState('');
  const { requireAdminAction } = useAuth();

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
  });

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const diff = selectedAccount && actualBalanceStr !== '' ? parseMoney(actualBalanceStr) - selectedAccount.balance : 0;

  const reconMutation = useMutation({
    mutationFn: () => createAccountReconciliation(selectedAccountId, parseMoney(actualBalanceStr)),
    onSuccess: () => {
      toast.success('تمت تسوية الحساب بنجاح');
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      setSelectedAccountId('');
      setActualBalanceStr('');
    },
    onError: () => {
      toast.error('حدث خطأ أثناء تسوية الحساب');
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) {
      toast.error('الرجاء اختيار الحساب');
      return;
    }
    if (diff === 0) {
      toast.error('الرصيد الفعلي يطابق رصيد النظام!');
      return;
    }
    requireAdminAction(() => reconMutation.mutate());
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 max-w-md mx-auto mt-8">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Scale className="w-5 h-5 text-accent" />
        تسوية حساب مالي
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">اختر الحساب *</label>
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
            required
          >
            <option value="">-- اختر الحساب --</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name} (نظامي: {formatMoney(acc.balance)})</option>
            ))}
          </select>
        </div>
        
        <div className="space-y-1.5">
          <label className="text-sm font-medium">الرصيد الفعلي الموجود *</label>
          <input
            type="number"
            step="any"
            value={actualBalanceStr}
            onChange={e => setActualBalanceStr(e.target.value)}
            className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric"
            required
            placeholder="0.00"
          />
        </div>

        {selectedAccount && actualBalanceStr !== '' && diff !== 0 && (
          <div className="p-3 bg-muted rounded-xl text-sm space-y-2">
            <div className="flex justify-between">
              <span>رصيد النظام:</span>
              <span className="font-bold numeric">{formatMoney(selectedAccount.balance)}</span>
            </div>
            <div className="flex justify-between">
              <span>الرصيد الفعلي:</span>
              <span className="font-bold numeric">{formatMoney(parseMoney(actualBalanceStr))}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 border-dashed font-bold">
              <span>الفرق للتسوية:</span>
              <span className={cn("numeric", diff > 0 ? "text-success" : "text-danger")} dir="ltr">
                {diff > 0 ? '+' : ''}{formatMoney(diff)}
              </span>
            </div>
          </div>
        )}

        <button
          type="submit"
          className="w-full h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 mt-4"
        >
          <CheckCircle className="w-5 h-5" />
          اعتماد التسوية
        </button>
      </form>
    </div>
  );
}

