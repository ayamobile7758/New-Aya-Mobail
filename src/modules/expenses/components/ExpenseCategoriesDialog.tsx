import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExpenseCategories, addExpenseCategory, updateExpenseCategory, ExpenseCategory } from '@/db/queries/expenses';
import { Plus, CheckCircle, Edit2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useEscKey } from '@/hooks/useEscKey';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ExpenseCategoriesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExpenseCategoriesDialog({ isOpen, onClose }: ExpenseCategoriesDialogProps) {
  const queryClient = useQueryClient();
  const { requireAdminAction } = useAuth();
  
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCat, setNewCat] = useState({ name: '', type: 'variable' as 'fixed' | 'variable', sort_order: 0 });
  const [editCat, setEditCat] = useState<Partial<ExpenseCategory>>({});

  useEscKey(onClose, isOpen);
  const trapRef = useFocusTrap(isOpen);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['all-expense-categories'],
    queryFn: () => getExpenseCategories(true),
    enabled: isOpen,
  });

  const addMutation = useMutation({
    mutationFn: () => addExpenseCategory(newCat),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['all-expense-categories'] });
      setIsAdding(false);
      setNewCat({ name: '', type: 'variable', sort_order: 0 });
      toast.success('تمت إضافة الفئة بنجاح');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: Partial<ExpenseCategory> }) => updateExpenseCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['all-expense-categories'] });
      setEditingId(null);
      setEditCat({});
      toast.success('تم الحفظ بنجاح');
    }
  });

  const handleAdd = () => {
    if (!newCat.name.trim()) return;
    requireAdminAction(() => addMutation.mutate());
  };

  const handleUpdate = (id: string) => {
    if (editCat.name !== undefined && !editCat.name.trim()) {
      return;
    }
    requireAdminAction(() => updateMutation.mutate({ id, data: editCat }));
  };

  const toggleStatus = (cat: ExpenseCategory) => {
    requireAdminAction(() => updateMutation.mutate({ id: cat.id, data: { is_active: !cat.is_active } }));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="exp-cat-dialog-title" className="bg-surface rounded-2xl w-[calc(100%-2rem)] max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-border">
          <h2 id="exp-cat-dialog-title" className="text-xl font-bold">إدارة فئات المصروفات</h2>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-full" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-4 overflow-y-auto hide-scrollbar flex-1">
          {isAdding ? (
            <div className="p-4 border border-border rounded-xl bg-muted/30 space-y-3">
              <h4 className="font-bold text-sm mb-2">إضافة فئة جديدة</h4>
              <div>
                <label className="block text-sm font-medium mb-1">اسم الفئة</label>
                <input
                  className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                  value={newCat.name}
                  onChange={e => setNewCat({ ...newCat, name: e.target.value })}
                  placeholder="مثال: رواتب، كهرباء..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-sm font-medium mb-1">النوع</label>
                  <select 
                    className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                    value={newCat.type}
                    onChange={e => setNewCat({ ...newCat, type: e.target.value as 'fixed' | 'variable' })}
                  >
                    <option value="variable">متغير</option>
                    <option value="fixed">ثابت</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">الترتيب</label>
                  <input
                    className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                    type="number"
                    value={newCat.sort_order}
                    onChange={e => setNewCat({ ...newCat, sort_order: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button 
                  className="flex-1 h-11 bg-accent text-white font-bold rounded-lg disabled:opacity-50 hover:bg-accent-hover flex items-center justify-center"
                  onClick={handleAdd} 
                  disabled={addMutation.isPending || !newCat.name}
                >
                  <CheckCircle className="w-4 h-4 me-2" /> حفظ
                </button>
                <button 
                  className="flex-1 h-11 border border-border bg-background font-medium rounded-lg hover:bg-muted"
                  onClick={() => setIsAdding(false)}
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <button 
              className="w-full h-11 border border-dashed border-border text-accent bg-accent/5 font-medium rounded-lg hover:bg-accent/10 flex items-center justify-center"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="w-4 h-4 me-2" /> إضافة فئة جديدة
            </button>
          )}

          <div className="space-y-2 mt-4">
            {isLoading ? (
              <div className="text-center py-4 text-text-secondary">جاري التحميل...</div>
            ) : (
              categories.map(cat => (
                <div key={cat.id} className={`p-3 border border-border rounded-xl flex flex-col md:flex-row gap-3 md:items-center justify-between transition-colors ${!cat.is_active ? 'opacity-60 bg-muted/50' : 'bg-surface'}`}>
                  {editingId === cat.id ? (
                    <div className="flex-1 space-y-3 w-full">
                      <div>
                        <label className="block text-sm font-medium mb-1">اسم الفئة</label>
                        <input
                          className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                          value={editCat.name !== undefined ? editCat.name : cat.name}
                          onChange={e => setEditCat({ ...editCat, name: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="block text-sm font-medium mb-1">النوع</label>
                          <select 
                            className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                            value={editCat.type !== undefined ? editCat.type : cat.type}
                            onChange={e => setEditCat({ ...editCat, type: e.target.value as 'fixed' | 'variable' })}
                          >
                            <option value="variable">متغير</option>
                            <option value="fixed">ثابت</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">الترتيب</label>
                          <input
                            className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none"
                            type="number"
                            value={editCat.sort_order !== undefined ? editCat.sort_order : cat.sort_order}
                            onChange={e => setEditCat({ ...editCat, sort_order: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          className="flex-1 h-11 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover"
                          onClick={() => handleUpdate(cat.id)}
                        >
                          حفظ
                        </button>
                        <button 
                          className="flex-1 h-11 border border-border bg-background font-medium rounded-lg hover:bg-muted"
                          onClick={() => setEditingId(null)}
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{cat.name}</span>
                          {!cat.is_active && <span className="text-xs bg-danger/10 text-danger px-1.5 py-0.5 rounded">معطّل</span>}
                        </div>
                        <div className="text-xs text-text-secondary mt-1 flex items-center gap-2">
                          <span>{cat.type === 'fixed' ? 'ثابت' : 'متغير'}</span>
                          <span>• ترتيب: {cat.sort_order}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          className="p-2 hover:bg-muted rounded-lg text-text-secondary"
                          onClick={() => {
                            setEditingId(cat.id);
                            setEditCat({});
                          }}
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        
                        <button
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${cat.is_active ? 'text-danger hover:bg-danger/10' : 'text-success hover:bg-success/10'}`}
                          onClick={() => toggleStatus(cat)}
                        >
                          {cat.is_active ? 'تعطيل' : 'تفعيل'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
