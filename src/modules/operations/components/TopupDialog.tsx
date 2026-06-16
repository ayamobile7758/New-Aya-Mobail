import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getActiveAccounts } from '@/db/queries/accounts';
import { dbClient } from '@/db/client';
import { createTopup } from '@/db/queries/operations';
import { X, Save } from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';
import { useAuth } from '@/contexts/AuthContext';

export function TopupDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { requireAdminAction } = useAuth();
  const [accountId, setAccountId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [costStr, setCostStr] = useState('');
  const [notes, setNotes] = useState('');
  
  const queryClient = useQueryClient();

  useEscKey(onClose, isOpen);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      return await dbClient.query('SELECT * FROM suppliers ORDER BY name');
    },
    enabled: isOpen
  });
  
  useEffect(() => {
    if (isOpen) {
      setAccountId('');
      setSupplierId('');
      setAmountStr('');
      setCostStr('');
      setNotes('');
    }
  }, [isOpen]);

  const topupMutation = useMutation({
    mutationFn: createTopup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('تم تسجيل شحن الرصيد بنجاح');
      onClose();
    },
    onError: (error) => {
      console.error(error);
      toast.error('حدث خطأ أثناء الحفظ');
    }
  });

  if (!isOpen) return null;

  const amount = parseMoney(amountStr);
  const cost = parseMoney(costStr);
  const profit = amount - cost;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) {
      toast.error('الرجاء اختيار الحساب');
      return;
    }
    if (amount <= 0 || cost <= 0) {
      toast.error('القيمة يجب أن تكون أكبر من صفر');
      return;
    }
    
    requireAdminAction(() => topupMutation.mutate({
      account_id: accountId,
      supplier_id: supplierId || undefined,
      amount,
      cost,
      profit,
      notes,
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl w-[calc(100%-2rem)] max-w-md shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface shrink-0">
          <h2 className="text-xl font-bold">شحن رصيد جديد</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">الحساب (الصندوق) *</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
              required
            >
              <option value="">-- اختر الحساب --</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
              ))}
            </select>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-sm font-medium">المزود (اختياري)</label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
            >
              <option value="">-- بدون مزود --</option>
              {suppliers.map((sup: any) => (
                <option key={sup.id} value={sup.id}>{sup.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">المبلغ المستلم من العميل *</label>
            <input
              type="number"
              step="any"
              min="0"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">التكلفة الفعلية (من المزود) *</label>
            <input
              type="number"
              step="any"
              min="0"
              value={costStr}
              onChange={e => setCostStr(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric"
              required
            />
          </div>

          <div className="p-3 bg-muted/50 rounded-xl space-y-2 text-sm">
            <div className="flex justify-between">
              <span>المبلغ المستلم:</span>
              <span className="font-bold numeric">{formatMoney(amount)}</span>
            </div>
            <div className="flex justify-between">
              <span>التكلفة:</span>
              <span className="font-bold numeric text-danger">{formatMoney(cost)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <span>الربح المفترض:</span>
              <span className={profit >= 0 ? "font-bold numeric text-success" : "font-bold numeric text-danger"}>
                {formatMoney(profit)}
              </span>
            </div>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-sm font-medium">ملاحظات</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg p-3 outline-none focus:border-accent min-h-[80px]"
            />
          </div>

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
              disabled={topupMutation.isPending}
              className="flex-1 h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              حفظ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
