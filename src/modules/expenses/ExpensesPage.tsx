import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFilteredExpenses, addExpense, getExpenseCategories, deleteExpense, updateExpense } from '@/db/queries/expenses';
import { getActiveAccounts } from '@/db/queries/accounts';
import { formatMoney, parseMoney } from '@/lib/money';
import { Plus, Receipt, CheckCircle, Settings, Download, Calendar, Trash2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { ExpenseCategoriesDialog } from './components/ExpenseCategoriesDialog';
import { format } from 'date-fns';

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { requireAdminAction } = useAuth();
  const [isAddMode, setIsAddMode] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmountInput, setEditAmountInput] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [showEditAccountPicker, setShowEditAccountPicker] = useState(false);
  
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses-filtered', startDate, endDate],
    queryFn: () => getFilteredExpenses(startDate || undefined, endDate || undefined, null)
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => getExpenseCategories(false)
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
  });

  // Auto-fill: prefer cash account
  useEffect(() => {
    if (accounts.length > 0 && !accountId) {
      const cashAcc = accounts.find(a => a.type === 'cash');
      setAccountId((cashAcc || accounts[0]).id);
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  // Reset account picker when form closes
  useEffect(() => {
    if (!isAddMode) setShowAccountPicker(false);
  }, [isAddMode]);

  const selectedAccount = accounts.find(a => a.id === accountId);

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
      queryClient.invalidateQueries({ queryKey: ['expenses-filtered', startDate, endDate] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      toast.success('تم تسجيل المصروف بنجاح');
      setIsAddMode(false);
      setAmountInput('');
      setDescription('');
    },
    onError: (err: any) => {
      toast.error('خطأ أثناء تسجيل المصروف: ' + err.message);
    }
  });

  const editExpenseMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      const selectedCategory = categories.find(c => c.id === editCategoryId);
      const selectedAcc = accounts.find(a => a.id === editAccountId);
      
      await updateExpense(editingId, {
        amount: parseMoney(editAmountInput),
        category_id: editCategoryId,
        category_name: selectedCategory?.name || '',
        description: editDescription,
        accountId: editAccountId,
        account_name: selectedAcc?.name || ''
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses-filtered', startDate, endDate] });
      queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      toast.success('تم تعديل المصروف بنجاح');
      setEditingId(null);
    },
    onError: (err: any) => {
      toast.error('خطأ أثناء تعديل المصروف: ' + err.message);
    }
  });

  const grandTotal = useMemo(() => {
    return expenses.reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const handleExportCSV = () => {
    if (expenses.length === 0) return;
    
    const headers = ['رقم المصروف', 'التاريخ', 'الفئة', 'المبلغ', 'الحساب', 'البيان'];
    const csvContent = [
      headers.join(','),
      ...expenses.map(e => [
        e.expense_number,
        e.expense_date,
        e.category_name,
        e.amount,
        e.account_name,
        `"${e.description || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `expenses_${startDate || 'all'}_to_${endDate || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">المصروفات</h1>
              <p className="text-sm text-text-secondary">تسجيل مصاريف المحل اليومية</p>
            </div>
          </div>
          
          <div className="flex flex-row flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2 w-full sm:w-auto bg-muted p-1 px-3 rounded-xl border border-border h-11">
              <Calendar className="w-4 h-4 text-text-secondary" />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none outline-none text-sm font-medium w-full sm:w-auto"
              />
              <span className="text-text-secondary">-</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none outline-none text-sm font-medium w-full sm:w-auto"
              />
            </div>

            <div className="flex gap-2 w-full sm:w-auto">
              <button 
                onClick={handleExportCSV}
                disabled={expenses.length === 0}
                className="bg-muted text-text-primary px-3 h-11 box-border rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-muted/80 transition-colors shadow-sm disabled:opacity-50 flex-1 sm:flex-none"
                title="تصدير CSV"
              >
                <Download className="w-5 h-5"/>
              </button>
              <button 
                onClick={() => setIsCategoriesOpen(true)}
                className="bg-muted text-text-primary px-3 h-11 box-border rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-muted/80 transition-colors shadow-sm flex-1 sm:flex-none"
                title="إعدادات الحسابات والفئات"
              >
                <Settings className="w-5 h-5"/>
              </button>
              <button 
                onClick={() => setIsAddMode(!isAddMode)}
                className="bg-accent text-white px-4 h-11 box-border rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors shadow-sm flex-1 sm:flex-none whitespace-nowrap"
              >
                {isAddMode ? 'إلغاء' : <><Plus className="w-5 h-5"/> <span className="hidden sm:inline">تسجيل مصروف</span></>}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto space-y-6">
          {isAddMode && (
            <div className="bg-surface border border-border rounded-2xl p-6 mb-6 shadow-sm animate-in slide-in-from-top-4">
              <h2 className="text-lg font-bold mb-4">تسجيل مصروف جديد</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">المبلغ <span className="text-danger">*</span></label>
                  <div className="relative">
                    <input 
                      type="text" 
                      inputMode="decimal"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full h-12 pe-12 ps-4 rounded-xl border border-border bg-background focus:border-accent focus:ring-1 outline-none text-xl font-bold numeric"
                      placeholder="0"
                    />
                    <span className="absolute start-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm font-medium">د.أ</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">التبويب <span className="text-danger">*</span></label>
                  <select 
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
                  >
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">البيان (التفاصيل) <span className="text-danger">*</span></label>
                <input 
                  type="text" 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none"
                  placeholder="مثال: فاتورة كهرباء لشهر مايو..."
                />
              </div>

              {/* Account — secondary/collapsible */}
              <div className="mb-6">
                {!showAccountPicker ? (
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5 rounded-xl border border-border text-sm">
                    <span className="text-text-secondary">
                      الحساب: <span className="font-medium text-text-primary">{selectedAccount?.name || '—'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAccountPicker(true)}
                      className="text-accent text-xs font-medium hover:underline ms-3 shrink-0"
                      style={{ fontFamily: 'Tajawal, sans-serif' }}
                    >
                      تغيير
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">الدفع من حساب <span className="text-danger">*</span></label>
                      <button
                        type="button"
                        onClick={() => setShowAccountPicker(false)}
                        className="text-text-secondary text-xs hover:text-accent transition-colors"
                        style={{ fontFamily: 'Tajawal, sans-serif' }}
                      >
                        إخفاء ▲
                      </button>
                    </div>
                    <select 
                      value={accountId}
                      onChange={(e) => { setAccountId(e.target.value); setShowAccountPicker(false); }}
                      className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <button
                onClick={() => expenseMutation.mutate()}
                disabled={expenseMutation.isPending || !amountInput || !description || !categoryId}
                className="w-full h-[var(--btn-height)] bg-accent text-white font-bold rounded-xl disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-5 h-5" /> تأكيد المصروف
              </button>
            </div>
          )}

          <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-muted/30">
              <h2 className="font-bold flex items-center gap-2 text-lg">
                <Receipt className="w-5 h-5 text-accent" />
                سجل المصروفات الأخير
              </h2>
            </div>
            
            {isLoading ? (
              <div className="p-8 flex justify-center"><div className="animate-spin w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full"></div></div>
            ) : expenses.length === 0 ? (
              <div className="p-10 flex flex-col items-center gap-3 text-text-secondary text-center">
                <Receipt className="w-10 h-10 opacity-25" />
                <div>
                  <p className="font-semibold text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد مصروفات بعد</p>
                  <p className="text-sm mt-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>أضِف أول مصروف بالضغط على زر "تسجيل مصروف"</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {expenses.map(expense => {
                  return (
                    <div key={expense.id} className="p-4 hover:bg-muted/30 transition-colors flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded text-text-secondary">{expense.expense_number}</span>
                          <span className="font-bold">{expense.category_name}</span>
                          <span className="text-sm bg-muted px-2 py-0.5 rounded text-text-secondary">{expense.expense_date}</span>
                        </div>
                        <p className="text-secondary text-sm">{expense.description}</p>
                        <p className="text-xs text-text-secondary mt-1">عبر: {expense.account_name}</p>
                      </div>
                      <div className="flex items-center gap-3 self-end md:self-center">
                        <div className="font-bold text-lg text-danger numeric whitespace-nowrap bg-danger-bg px-3 py-1 rounded-lg">
                          - {formatMoney(expense.amount)}
                        </div>
                        <button
                          onClick={() => requireAdminAction(() => {
                            setEditingId(expense.id);
                            setEditAmountInput(String(expense.amount / 100));
                            setEditCategoryId(expense.category_id);
                            setEditDescription(expense.description);
                            setEditAccountId(expense.account_id);
                            setShowEditAccountPicker(false);
                          })}
                          className="p-2 text-text-secondary hover:text-accent hover:bg-accent/10 rounded-full transition-colors"
                          aria-label="تعديل"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => requireAdminAction(async () => {
                            if (!confirm('هل أنت متأكد من حذف هذا المصروف؟ سيتم إرجاع المبلغ للحساب.')) return;
                            try {
                              await deleteExpense(expense.id);
                              queryClient.invalidateQueries({ queryKey: ['expenses-filtered', startDate, endDate] });
                              queryClient.invalidateQueries({ queryKey: ['active-accounts'] });
                              queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
                              queryClient.invalidateQueries({ queryKey: ['report'] });
                              toast.success('تم حذف المصروف بنجاح');
                            } catch (e: any) {
                              toast.error(e.message);
                            }
                          })}
                          className="p-2 text-text-secondary hover:text-danger hover:bg-danger/10 rounded-full transition-colors"
                          aria-label="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {!isLoading && expenses.length > 0 && (
              <div className="p-4 border-t border-border bg-muted/20 flex flex-col sm:flex-row justify-between items-center gap-3">
                <div className="text-text-secondary font-medium">الإجمالي للفترة المحددة:</div>
                <div className="text-xl sm:text-2xl font-bold text-danger numeric">
                  {formatMoney(grandTotal)}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      
      {editingId && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          dir="rtl"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingId(null); }}
        >
          <div className="bg-surface w-[calc(100%-2rem)] max-w-md rounded-[24px] p-6 shadow-xl relative animate-in zoom-in-95 flex flex-col max-h-[90vh] overflow-y-auto text-text-primary">
            <button
              onClick={() => setEditingId(null)}
              className="absolute top-4 end-4 p-2 text-text-secondary hover:bg-muted rounded-full transition-colors outline-none"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-6 mt-2">
              <div className="w-10 h-10 bg-accent/10 border border-accent/20 text-accent rounded-xl flex items-center justify-center">
                <Pencil className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">تعديل المصروف</h2>
                <p className="text-xs text-text-secondary">تعديل تفاصيل المصروف الحالي</p>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-1">المبلغ <span className="text-danger">*</span></label>
                <div className="relative">
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editAmountInput}
                    onChange={(e) => setEditAmountInput(e.target.value)}
                    className="w-full h-12 pe-12 ps-4 rounded-xl border border-border bg-background focus:border-accent focus:ring-1 outline-none text-xl font-bold numeric"
                    placeholder="0"
                  />
                  <span className="absolute start-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm font-medium">د.أ</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">التبويب <span className="text-danger">*</span></label>
                <select 
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">البيان (التفاصيل) <span className="text-danger">*</span></label>
                <input 
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none"
                />
              </div>

              <div>
                {!showEditAccountPicker ? (
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5 rounded-xl border border-border text-sm">
                    <span className="text-text-secondary">
                      الحساب: <span className="font-medium text-text-primary">
                        {accounts.find(a => a.id === editAccountId)?.name || '—'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowEditAccountPicker(true)}
                      className="text-accent text-xs font-medium hover:underline ms-3 shrink-0"
                      style={{ fontFamily: 'Tajawal, sans-serif' }}
                    >
                      تغيير
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">الدفع من حساب <span className="text-danger">*</span></label>
                      <button
                        type="button"
                        onClick={() => setShowEditAccountPicker(false)}
                        className="text-text-secondary text-xs hover:text-accent transition-colors"
                        style={{ fontFamily: 'Tajawal, sans-serif' }}
                      >
                        إخفاء ▲
                      </button>
                    </div>
                    <select 
                      value={editAccountId}
                      onChange={(e) => { setEditAccountId(e.target.value); setShowEditAccountPicker(false); }}
                      className="w-full h-12 px-4 rounded-xl border border-border bg-background focus:border-accent outline-none font-medium"
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => editExpenseMutation.mutate()}
                disabled={editExpenseMutation.isPending || !editAmountInput || !editDescription || !editCategoryId || !editAccountId}
                className="flex-1 h-12 bg-accent text-white font-bold rounded-xl disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-5 h-5" /> حفظ التعديل
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="px-4 h-12 bg-muted text-text-primary font-medium rounded-xl hover:bg-muted/80 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      <ExpenseCategoriesDialog isOpen={isCategoriesOpen} onClose={() => setIsCategoriesOpen(false)} />
    </div>
  );
}
