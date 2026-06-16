import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExpenseCategories, addExpense } from '@/db/queries/expenses';
import { getActiveAccounts } from '@/db/queries/accounts';
import { parseMoney, formatMoney } from '@/lib/money';
import { Receipt, X, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';

interface AddExpenseDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddExpenseDialog({ isOpen, onClose }: AddExpenseDialogProps) {
  const queryClient = useQueryClient();
  const [amountInput, setAmountInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');

  useEscKey(onClose, isOpen);

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => getExpenseCategories(false),
    enabled: isOpen
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
    enabled: isOpen
  });

  // Defaults
  useEffect(() => {
    if (isOpen) {
      if (accounts.length > 0 && !accountId) {
        const cashAcc = accounts.find(a => a.type === 'cash');
        setAccountId((cashAcc || accounts[0]).id);
      }
    }
  }, [accounts, accountId, isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (categories.length > 0 && !categoryId) {
        setCategoryId(categories[0].id);
      }
    }
  }, [categories, categoryId, isOpen]);

  // Reset on open/close
  useEffect(() => {
    if (!isOpen) {
      setAmountInput('');
      setCategoryId('');
      setDescription('');
      setAccountId('');
    }
  }, [isOpen]);

  const expenseMutation = useMutation({
    mutationFn: () => {
      const selectedCategory = categories.find(c => c.id === categoryId);
      const selectedAcc = accounts.find(a => a.id === accountId);
      
      return addExpense({
        amount: parseMoney(amountInput),
        category_id: categoryId,
        category_name: selectedCategory?.name || '',
        description,
        accountId: accountId,
        account_name: selectedAcc?.name || ''
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses-filtered'] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      toast.success('تم تسجيل المصروف بنجاح');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطأ أثناء تسجيل المصروف');
    }
  });

  if (!isOpen) return null;

  const parsedAmount = parseMoney(amountInput || '0');
  const isValid = parsedAmount > 0 && description.trim().length > 0 && categoryId && accountId;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      dir="rtl"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-full max-w-md rounded-[24px] p-6 shadow-xl relative animate-in zoom-in-95 flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 end-4 p-2 text-text-secondary hover:bg-muted rounded-full transition-colors outline-none"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6 mt-2">
          <div className="w-10 h-10 bg-accent/10 border border-accent/20 text-accent rounded-xl flex items-center justify-center">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'Tajawal, sans-serif' }}>تسجيل مصروف جديد</h2>
            <p className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>إدخال مصروف مباشر وسريع</p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ <span className="text-danger">*</span></label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full h-12 pe-12 ps-4 rounded-xl border border-border bg-background focus:border-accent focus:ring-1 outline-none text-xl font-bold numeric"
                placeholder="0.00"
                autoFocus
              />
              <span className="absolute start-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm font-medium">د.أ</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>التبويب <span className="text-danger">*</span></label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <option value="" disabled>اختر الفئة...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>الدفع من حساب <span className="text-danger">*</span></label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <option value="" disabled>اختر الحساب...</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>البيان (التفاصيل) <span className="text-danger">*</span></label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
              placeholder="مثال: شراء مستلزمات..."
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            />
          </div>
        </div>

        <button
          onClick={() => expenseMutation.mutate()}
          disabled={expenseMutation.isPending || !isValid}
          className="w-full h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-2"
          style={{ fontFamily: 'Tajawal, sans-serif' }}
        >
          <CheckCircle className="w-5 h-5" /> تسجيل المصروف
        </button>
      </div>
    </div>
  );
}
