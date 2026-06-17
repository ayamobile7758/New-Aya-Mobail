import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getActiveAccounts } from '@/db/queries/accounts';
import { createTransfer } from '@/db/queries/operations';
import { useAuth } from '@/contexts/AuthContext';
import { X, Save, ArrowRightLeft } from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';

export function TransferDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const { requireAdminAction } = useAuth();
  
  const queryClient = useQueryClient();

  useEscKey(onClose, isOpen);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen
  });

  useEffect(() => {
    if (isOpen) {
      setFromAccountId('');
      setToAccountId('');
      setAmountStr('');
      setNotes('');
    }
  }, [isOpen]);

  const transferMutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-period'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('تم تحويل المبلغ بنجاح');
      onClose();
    },
    onError: (error) => {
      console.error(error);
      toast.error('حدث خطأ أثناء الحفظ');
    }
  });

  if (!isOpen) return null;

  const amount = parseMoney(amountStr);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAccountId || !toAccountId) {
      toast.error('الرجاء اختيار الحسابات المهنية');
      return;
    }
    if (fromAccountId === toAccountId) {
      toast.error('لا يمكن التحويل لنفس الحساب');
      return;
    }
    if (amount <= 0) {
      toast.error('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }
    
    requireAdminAction(() => {
      transferMutation.mutate({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount,
        notes
      });
    });
  };

  return (
    <div
      className="fixed inset-0 z-[40] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl w-[calc(100%-2rem)] max-w-md shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-accent" />
            تحويل بين الحسابات
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">من حساب (مرسل) *</label>
            <select
              value={fromAccountId}
              onChange={e => setFromAccountId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
              required
            >
              <option value="">-- اختر الحساب الساحب --</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
              ))}
            </select>
          </div>
          
          <div className="flex justify-center -my-2 relative z-10">
            <div className="bg-muted text-text-secondary p-1 rounded-full border border-border">
               <ArrowRightLeft className="w-4 h-4 transform rotate-90" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">إلى حساب (مستقبل) *</label>
            <select
              value={toAccountId}
              onChange={e => setToAccountId(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
              required
            >
              <option value="">-- اختر الحساب المودع --</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border">
            <label className="text-sm font-medium">المبلغ المراد تحويله *</label>
            <input
              type="number"
              step="any"
              min="0"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-bold numeric text-lg"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">ملاحظات (اختياري)</label>
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
              disabled={transferMutation.isPending}
              className="flex-1 h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              تحويل
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
