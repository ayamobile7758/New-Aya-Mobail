// src/modules/debtbook/DebtBookPage.tsx
// =============================================================================
// DEBT BOOK PAGE UI
// ⛔ 100% SEPARATE FROM ALL FINANCIAL/ACCOUNTING LOGIC.
// =============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  BookUser,
  Plus,
  Search,
  Phone,
  Trash2,
  X,
  FilePlus2,
  Settings,
  CheckCircle,
  MessageSquare,
  AlertCircle
} from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { format } from 'date-fns';
import { readSetting, writeSetting } from '@/lib/auth';
import {
  listDebtors,
  getDebtorDetail,
  createDebtor,
  updateDebtor,
  deleteDebtor,
  addDebtItem,
  deleteDebtItem,
  recordPayment,
  deletePayment,
  getBookSummary,
  DebtorSummary
} from '@/db/queries/debtbook';

const DEFAULT_CATEGORIES = ["تليفون", "بطاقة", "كفر", "تعمير", "صيانة", "إكسسوار", "أخرى"];
const DEFAULT_REMINDER_TEMPLATE = "مرحباً سيد [الاسم]، معك [المحل]. نذكّركم بمبلغ مستحق علينا بقيمة [المتبقي]. التفاصيل: [البنود]. شكراً لتعاملكم معنا 🌹";
const DEFAULT_CONFIRM_TEMPLATE = "مرحباً سيد [الاسم]، استلمنا منكم مبلغ [المدفوع]. المتبقي الآن [المتبقي]. شكراً لكم 🌹";

export default function DebtBookPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [selectedDebtorId, setSelectedDebtorId] = useState<string | null>(null);
  
  // Dialog Open States
  const [isAddDebtorOpen, setIsAddDebtorOpen] = useState(false);
  const [isAddDebtOpen, setIsAddDebtOpen] = useState(false);
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [isEditTemplatesOpen, setIsEditTemplatesOpen] = useState(false);
  const [isEditDebtorOpen, setIsEditDebtorOpen] = useState(false);

  // Form states
  const [debtorForm, setDebtorForm] = useState({ name: '', phone: '', notes: '' });
  const [debtItemForm, setDebtItemForm] = useState({ category: '', amount: '', note: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', note: '' });
  const [newCategory, setNewCategory] = useState('');
  
  // Template & Shop Name forms
  const [shopNameInput, setShopNameInput] = useState('');
  const [reminderTemplateInput, setReminderTemplateInput] = useState('');
  const [confirmTemplateInput, setConfirmTemplateInput] = useState('');

  // Just paid amount tracking for showing WhatsApp confirmation modal
  const [lastPaymentAmount, setLastPaymentAmount] = useState<number | null>(null);

  // Esc Key closing
  useEscKey(() => {
    if (isAddDebtOpen) setIsAddDebtOpen(false);
    else if (isRecordPaymentOpen) {
      setIsRecordPaymentOpen(false);
      setLastPaymentAmount(null);
    }
    else if (isEditDebtorOpen) setIsEditDebtorOpen(false);
    else if (isManageCategoriesOpen) setIsManageCategoriesOpen(false);
    else if (isEditTemplatesOpen) setIsEditTemplatesOpen(false);
    else if (selectedDebtorId) setSelectedDebtorId(null);
    else if (isAddDebtorOpen) setIsAddDebtorOpen(false);
  }, !!(selectedDebtorId || isAddDebtorOpen || isAddDebtOpen || isRecordPaymentOpen || isManageCategoriesOpen || isEditTemplatesOpen || isEditDebtorOpen));

  // Focus Traps
  const addDebtorTrap = useFocusTrap(isAddDebtorOpen);
  const addDebtTrap = useFocusTrap(isAddDebtOpen);
  const recordPaymentTrap = useFocusTrap(isRecordPaymentOpen);
  const categoriesTrap = useFocusTrap(isManageCategoriesOpen);
  const templatesTrap = useFocusTrap(isEditTemplatesOpen);
  const editDebtorTrap = useFocusTrap(isEditDebtorOpen);

  // Queries
  const { data: debtors = [], isLoading: isListLoading } = useQuery<DebtorSummary[]>({
    queryKey: ['debtbook-debtors'],
    queryFn: listDebtors,
  });

  const { data: summary, isLoading: isSummaryLoading } = useQuery({
    queryKey: ['debtbook-summary'],
    queryFn: getBookSummary,
  });

  const { data: detail } = useQuery({
    queryKey: ['debtbook-detail', selectedDebtorId],
    queryFn: () => getDebtorDetail(selectedDebtorId!),
    enabled: !!selectedDebtorId,
  });

  const { data: categories = DEFAULT_CATEGORIES } = useQuery<string[]>({
    queryKey: ['debtbook-categories'],
    queryFn: async () => {
      const val = await readSetting('debtbook_categories');
      return Array.isArray(val) ? val : DEFAULT_CATEGORIES;
    }
  });

  const { data: shopName = '' } = useQuery<string>({
    queryKey: ['debtbook-shop-name'],
    queryFn: async () => {
      const val = await readSetting('debtbook_shop_name');
      return typeof val === 'string' ? val : '';
    }
  });

  const { data: reminderTemplate = DEFAULT_REMINDER_TEMPLATE } = useQuery<string>({
    queryKey: ['debtbook-msg-reminder'],
    queryFn: async () => {
      const val = await readSetting('debtbook_msg_reminder');
      return typeof val === 'string' ? val : DEFAULT_REMINDER_TEMPLATE;
    }
  });

  const { data: confirmTemplate = DEFAULT_CONFIRM_TEMPLATE } = useQuery<string>({
    queryKey: ['debtbook-msg-confirm'],
    queryFn: async () => {
      const val = await readSetting('debtbook_msg_confirm');
      return typeof val === 'string' ? val : DEFAULT_CONFIRM_TEMPLATE;
    }
  });

  // Mutations
  const createDebtorMutation = useMutation({
    mutationFn: createDebtor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      toast.success('تم إضافة العميل بنجاح');
      setIsAddDebtorOpen(false);
      setDebtorForm({ name: '', phone: '', notes: '' });
    },
    onError: (err: any) => {
      toast.error('فشل إضافة العميل: ' + err.message);
    }
  });

  const updateDebtorMutation = useMutation({
    mutationFn: ({ id, name, phone, notes }: { id: string; name: string; phone?: string; notes?: string }) => updateDebtor(id, { name, phone, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-detail', selectedDebtorId] });
      toast.success('تم تعديل بيانات العميل بنجاح');
      setIsEditDebtorOpen(false);
    },
    onError: (err: any) => {
      toast.error('فشل تعديل البيانات: ' + err.message);
    }
  });

  const deleteDebtorMutation = useMutation({
    mutationFn: deleteDebtor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      toast.success('تم حذف العميل وكافة سجلاته بنجاح');
      setSelectedDebtorId(null);
    },
    onError: (err: any) => {
      toast.error('فشل حذف العميل: ' + err.message);
    }
  });

  const addDebtItemMutation = useMutation({
    mutationFn: addDebtItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-detail', selectedDebtorId] });
      toast.success('تم إضافة الدين بنجاح');
      setIsAddDebtOpen(false);
      setDebtItemForm({ category: '', amount: '', note: '' });
    },
    onError: (err: any) => {
      toast.error('فشل إضافة الدين: ' + err.message);
    }
  });

  const deleteDebtItemMutation = useMutation({
    mutationFn: deleteDebtItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-detail', selectedDebtorId] });
      toast.success('تم حذف بند الدين');
    },
    onError: (err: any) => {
      toast.error('فشل الحذف: ' + err.message);
    }
  });

  const recordPaymentMutation = useMutation({
    mutationFn: recordPayment,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-detail', selectedDebtorId] });
      toast.success('تم تسجيل السداد بنجاح');
      setLastPaymentAmount(variables.amount);
      setPaymentForm({ amount: '', note: '' });
      setIsRecordPaymentOpen(false);
    },
    onError: (err: any) => {
      toast.error('فشل تسجيل السداد: ' + err.message);
    }
  });

  const deletePaymentMutation = useMutation({
    mutationFn: deletePayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-summary'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-detail', selectedDebtorId] });
      toast.success('تم التراجع عن السداد بنجاح');
    },
    onError: (err: any) => {
      toast.error('فشل التراجع: ' + err.message);
    }
  });

  const saveCategoriesMutation = useMutation({
    mutationFn: (newCats: string[]) => writeSetting('debtbook_categories', newCats),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-categories'] });
      toast.success('تم تحديث الأصناف بنجاح');
    },
    onError: (err: any) => {
      toast.error('فشل التحديث: ' + err.message);
    }
  });

  const saveTemplatesMutation = useMutation({
    mutationFn: async (data: { shopName: string; reminder: string; confirm: string }) => {
      await writeSetting('debtbook_shop_name', data.shopName);
      await writeSetting('debtbook_msg_reminder', data.reminder);
      await writeSetting('debtbook_msg_confirm', data.confirm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debtbook-shop-name'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-msg-reminder'] });
      queryClient.invalidateQueries({ queryKey: ['debtbook-msg-confirm'] });
      toast.success('تم حفظ القوالب بنجاح');
      setIsEditTemplatesOpen(false);
    },
    onError: (err: any) => {
      toast.error('فشل حفظ القوالب: ' + err.message);
    }
  });

  // Date Formatting Helpers
  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'yyyy-MM-dd HH:mm');
    } catch {
      return dateStr;
    }
  };

  const getDaysAgo = (dateStr: string) => {
    try {
      const diffTime = Math.abs(Date.now() - new Date(dateStr).getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return `منذ ${diffDays} يوم`;
    } catch {
      return '';
    }
  };

  // WhatsApp Helper Function
  const handleSendWhatsApp = (debtorName: string, phoneNum: string | null, type: 'reminder' | 'confirm', justPaidFils?: number) => {
    if (!phoneNum) {
      toast.error('لا يوجد رقم هاتف مسجل لهذا العميل');
      return;
    }

    // Phone Normalization for Jordan:
    // Strip non-digits
    let cleaned = phoneNum.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '962' + cleaned.substring(1);
    } else if (!cleaned.startsWith('962')) {
      cleaned = '962' + cleaned;
    }

    let template = type === 'reminder' ? reminderTemplate : confirmTemplate;
    
    // Build items string representing remaining dues
    let itemsStr = '';
    if (detail && detail.items) {
      itemsStr = detail.items
        .filter(item => item.remaining > 0)
        .map(item => `${item.category}: ${formatMoney(item.remaining)}`)
        .join('، ');
    }

    let msg = template
      .replace(/\[الاسم\]/g, debtorName)
      .replace(/\[المحل\]/g, shopName || 'المحل')
      .replace(/\[المتبقي\]/g, detail ? formatMoney(detail.remaining) : '0.00 د.أ')
      .replace(/\[البنود\]/g, itemsStr || 'لا يوجد');

    if (type === 'confirm' && justPaidFils !== undefined) {
      msg = msg.replace(/\[المدفوع\]/g, formatMoney(justPaidFils));
    }

    const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  // Filtered Debtors List
  const filteredDebtors = debtors.filter(d =>
    d.name.includes(keyword) || (d.phone && d.phone.includes(keyword))
  );

  return (
    <div className="flex flex-col h-full bg-background relative isolate" dir="rtl" style={{ fontFamily: 'Tajawal, sans-serif' }}>
      <PageHeader
        icon={BookUser}
        title="دفتر الدين"
        subtitle="متابعة ديون العملاء والمستحقات غير المسددة"
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setShopNameInput(shopName);
                setReminderTemplateInput(reminderTemplate);
                setConfirmTemplateInput(confirmTemplate);
                setIsEditTemplatesOpen(true);
              }}
              className="w-10 h-10 border border-border bg-surface text-text-secondary hover:text-text-primary hover:border-accent rounded-lg flex items-center justify-center transition-colors"
              title="إعدادات الرسائل والمحل"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsManageCategoriesOpen(true)}
              className="px-3 h-10 border border-border bg-surface text-text-secondary hover:text-text-primary hover:border-accent rounded-lg font-medium flex items-center gap-1.5 transition-colors"
            >
              <span>الأصناف</span>
            </button>
            <button
              onClick={() => setIsAddDebtorOpen(true)}
              className="bg-accent text-white px-4 h-10 rounded-lg font-medium flex items-center gap-2 hover:bg-accent-hover transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              <span>إضافة شخص مدين</span>
            </button>
          </div>
        }
      >
        <div className="relative max-w-sm flex-1">
          <Search className="w-5 h-5 absolute end-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="بحث باسم الشخص أو رقم الهاتف..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full h-11 box-border ps-4 pe-10 rounded-xl border border-border bg-background focus:border-accent outline-none"
          />
        </div>
      </PageHeader>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Summary Cards */}
          {isSummaryLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-24 bg-surface rounded-2xl border border-border animate-pulse" />
              ))}
            </div>
          ) : summary ? (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm relative">
                <span className="text-xs text-text-secondary font-medium">إجمالي الديون المستحقة</span>
                <p className="text-xl font-bold numeric text-accent mt-1">{formatMoney(summary.totalOutstanding)}</p>
                {summary.overdueCount > 0 && (
                  <span className="absolute top-2 end-2 bg-danger/10 text-danger text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                    {summary.overdueCount} متأخر 30+ يوم
                  </span>
                )}
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
                <span className="text-xs text-text-secondary font-medium">عدد الأشخاص المدينين</span>
                <p className="text-xl font-bold numeric mt-1">{summary.debtorCount}</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
                <span className="text-xs text-text-secondary font-medium">المسدّد هذا الشهر</span>
                <p className="text-xl font-bold text-success mt-1 numeric">{formatMoney(summary.paidThisMonth)}</p>
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
                <span className="text-xs text-text-secondary font-medium">أكبر مبلغ مستحق</span>
                {summary.largestRemaining ? (
                  <div className="mt-1">
                    <p className="text-sm font-bold truncate">{summary.largestRemaining.name}</p>
                    <span className="text-xs font-bold numeric text-accent">{formatMoney(summary.largestRemaining.remaining)}</span>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary mt-1">لا يوجد</p>
                )}
              </div>
              <div className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
                <span className="text-xs text-text-secondary font-medium">أقدم دين غير مسدّد</span>
                {summary.oldestUnpaid ? (
                  <div className="mt-1">
                    <p className="text-sm font-bold truncate">{summary.oldestUnpaid.name}</p>
                    <span className="text-xs font-semibold text-text-secondary">{getDaysAgo(summary.oldestUnpaid.date)}</span>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary mt-1">لا يوجد</p>
                )}
              </div>
            </div>
          ) : null}

          {/* List of Debtors */}
          {isListLoading ? (
            <div className="p-12 text-center">
              <div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full" />
            </div>
          ) : filteredDebtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center bg-surface rounded-2xl border border-border">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                <BookUser className="w-12 h-12 text-text-secondary/40" />
              </div>
              <p className="text-text-secondary font-medium">
                لا توجد سجلات تطابق بحثك أو الدفتر فارغ.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDebtors.map(debtor => {
                const isPaidFull = debtor.remaining === 0;
                return (
                  <div
                    key={debtor.id}
                    onClick={() => setSelectedDebtorId(debtor.id)}
                    className={cn(
                      "bg-surface border border-border rounded-2xl p-5 shadow-sm hover:border-accent transition-all cursor-pointer flex flex-col justify-between gap-3 relative",
                      isPaidFull && "opacity-60 bg-muted/30"
                    )}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="font-bold text-lg text-text-primary">{debtor.name}</h3>
                        {isPaidFull ? (
                          <span className="text-xs font-bold px-2 py-0.5 bg-success-bg text-success rounded-md">
                            مسدّد بالكامل
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 bg-accent/15 text-accent rounded-md">
                            {debtor.itemCount} ديون
                          </span>
                        )}
                      </div>
                      
                      {debtor.phone && (
                        <p className="text-xs text-text-secondary flex items-center gap-1.5 mt-1 numeric dir-ltr text-end">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{debtor.phone}</span>
                        </p>
                      )}

                      {debtor.notes && (
                        <p className="text-xs text-text-secondary/80 mt-2 line-clamp-1 border-t border-dashed border-border pt-2">
                          {debtor.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex justify-between items-end border-t border-border pt-3 mt-1">
                      <div>
                        <span className="text-[10px] text-text-secondary">المبلغ المتبقي</span>
                        <p className={cn("text-base font-bold numeric", isPaidFull ? "text-text-secondary" : "text-accent")}>
                          {formatMoney(debtor.remaining)}
                        </p>
                      </div>
                      
                      {debtor.oldestUnpaidAt && debtor.remaining > 0 && (
                        <span className="text-[10px] text-text-secondary font-semibold">
                          أقدم دين: {getDaysAgo(debtor.oldestUnpaidAt)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Add Debtor Dialog */}
      {isAddDebtorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddDebtorOpen(false); }}
        >
          <div ref={addDebtorTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">إضافة شخص مدين جديد</h2>
              <button onClick={() => setIsAddDebtorOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createDebtorMutation.mutate(debtorForm);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">الاسم الكامل <span className="text-danger">*</span></label>
                <input
                  type="text"
                  required
                  value={debtorForm.name}
                  onChange={e => setDebtorForm({ ...debtorForm, name: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                  placeholder="محمد أحمد..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={debtorForm.phone}
                  onChange={e => setDebtorForm({ ...debtorForm, phone: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm text-end dir-ltr numeric"
                  placeholder="079xxxxxxxx"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea
                  value={debtorForm.notes}
                  onChange={e => setDebtorForm({ ...debtorForm, notes: e.target.value })}
                  className="w-full h-20 p-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm resize-none"
                  placeholder="أي ملاحظات إضافية..."
                />
              </div>

              <button
                type="submit"
                disabled={createDebtorMutation.isPending || !debtorForm.name}
                className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center"
              >
                حفظ
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Debtor Detail Dialog */}
      {selectedDebtorId && detail && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedDebtorId(null); }}
        >
          <div className="bg-surface w-[calc(100%-1rem)] max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start p-5 border-b border-border bg-muted/20 shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold">{detail.debtor.name}</h2>
                  <button
                    onClick={() => {
                      setDebtorForm({
                        name: detail.debtor.name,
                        phone: detail.debtor.phone || '',
                        notes: detail.debtor.notes || ''
                      });
                      setIsEditDebtorOpen(true);
                    }}
                    className="text-xs bg-muted text-text-secondary px-2.5 py-1 rounded hover:bg-border transition-colors font-semibold"
                  >
                    تعديل البيانات
                  </button>
                </div>
                {detail.debtor.phone && (
                  <p className="text-xs text-text-secondary mt-1 numeric dir-ltr text-end">{detail.debtor.phone}</p>
                )}
                {detail.debtor.notes && (
                  <p className="text-xs text-text-secondary/80 mt-1 max-w-lg">{detail.debtor.notes}</p>
                )}
              </div>
              <button onClick={() => setSelectedDebtorId(null)} className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Side: Summary & Actions */}
              <div className="lg:col-span-4 space-y-4">
                <div className="bg-muted/40 border border-border rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-secondary">إجمالي الدين</span>
                    <span className="font-bold numeric">{formatMoney(detail.totalDebt)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-secondary font-medium">المسدّد</span>
                    <span className="font-bold text-success numeric">{formatMoney(detail.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-border pt-3 text-base">
                    <span className="font-bold text-text-primary">المتبقي</span>
                    <span className="font-extrabold text-accent numeric">{formatMoney(detail.remaining)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setDebtItemForm({ category: categories[0] || 'أخرى', amount: '', note: '' });
                      setIsAddDebtOpen(true);
                    }}
                    className="w-full h-11 bg-accent text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors"
                  >
                    <FilePlus2 className="w-5 h-5" />
                    <span>إضافة دين جديد</span>
                  </button>

                  <button
                    onClick={() => {
                      setPaymentForm({ amount: '', note: '' });
                      setIsRecordPaymentOpen(true);
                    }}
                    className="w-full h-11 bg-success-bg text-success border border-success/30 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-success-bg/85 transition-colors"
                    disabled={detail.remaining === 0}
                  >
                    <CheckCircle className="w-5 h-5" />
                    <span>تسجيل سداد</span>
                  </button>

                  <button
                    onClick={() => handleSendWhatsApp(detail.debtor.name, detail.debtor.phone, 'reminder')}
                    className="w-full h-11 border border-border bg-surface hover:border-accent text-text-primary font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
                    disabled={!detail.debtor.phone || detail.remaining === 0}
                  >
                    <MessageSquare className="w-5 h-5 text-[#25D366]" />
                    <span>إرسال تذكير بالدين (واتساب)</span>
                  </button>
                  
                  {lastPaymentAmount !== null && (
                    <button
                      onClick={() => handleSendWhatsApp(detail.debtor.name, detail.debtor.phone, 'confirm', lastPaymentAmount)}
                      className="w-full h-11 bg-[#25D366]/10 text-[#075E54] border border-[#25D366]/30 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-[#25D366]/15 transition-colors animate-pulse"
                    >
                      <MessageSquare className="w-5 h-5 text-[#25D366]" />
                      <span>إرسال تأكيد السداد المباشر</span>
                    </button>
                  )}

                  <div className="pt-4 border-t border-border mt-2">
                    <button
                      onClick={() => {
                        if (window.confirm('هل أنت متأكد من حذف هذا العميل وجميع سجلات الديون والمدفوعات الخاصة به؟ لا يمكن التراجع عن هذا الإجراء.')) {
                          deleteDebtorMutation.mutate(detail.debtor.id);
                        }
                      }}
                      className="w-full h-10 border border-danger/20 text-danger bg-danger/5 hover:bg-danger/10 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                      disabled={deleteDebtorMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>حذف العميل نهائياً من الدفتر</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Side: Detailed logs (Items and Payments) */}
              <div className="lg:col-span-8 space-y-6">
                {/* Debt Items Table */}
                <div>
                  <h3 className="font-bold text-base mb-2">سجل الديون (حسب الوارد أولاً FIFO)</h3>
                  <div className="border border-border rounded-xl overflow-hidden bg-surface max-h-[30vh] overflow-y-auto">
                    <table className="w-full text-sm text-start">
                      <thead className="bg-muted/40 font-bold text-text-secondary sticky top-0 border-b border-border">
                        <tr>
                          <th className="p-3 text-start">التاريخ</th>
                          <th className="p-3 text-start">الصنف</th>
                          <th className="p-3 text-start">القيمة الأصلية</th>
                          <th className="p-3 text-start">المتبقي</th>
                          <th className="p-3 text-start">ملاحظات</th>
                          <th className="p-3 text-center w-12">حذف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {detail.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-text-secondary">لا توجد ديون مسجلة</td>
                          </tr>
                        ) : (
                          detail.items.map(item => (
                            <tr key={item.id} className={cn(item.remaining === 0 && "bg-muted/10 opacity-60")}>
                              <td className="p-3 whitespace-nowrap text-xs font-mono">{formatDate(item.created_at)}</td>
                              <td className="p-3 whitespace-nowrap font-medium">{item.category}</td>
                              <td className="p-3 whitespace-nowrap numeric font-semibold">{formatMoney(item.amount)}</td>
                              <td className="p-3 whitespace-nowrap numeric font-bold text-accent">{formatMoney(item.remaining)}</td>
                              <td className="p-3 max-w-[150px] truncate text-xs" title={item.note || ''}>{item.note || '-'}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={() => {
                                    if (window.confirm('هل أنت متأكد من حذف بند الدين هذا؟ سيؤثر هذا على التخصيص الحسابي للـ FIFO.')) {
                                      deleteDebtItemMutation.mutate(item.id);
                                    }
                                  }}
                                  className="p-1.5 hover:bg-danger/10 text-danger rounded-md transition-colors"
                                  title="حذف"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Payments Table */}
                <div>
                  <h3 className="font-bold text-base mb-2">سجل الدفعات المستلمة (السداد)</h3>
                  <div className="border border-border rounded-xl overflow-hidden bg-surface max-h-[25vh] overflow-y-auto">
                    <table className="w-full text-sm text-start">
                      <thead className="bg-muted/40 font-bold text-text-secondary sticky top-0 border-b border-border">
                        <tr>
                          <th className="p-3 text-start">التاريخ</th>
                          <th className="p-3 text-start">المبلغ المدفوع</th>
                          <th className="p-3 text-start">ملاحظات</th>
                          <th className="p-3 text-center w-12">حذف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {detail.payments.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-8 text-center text-text-secondary">لا توجد مدفوعات مسجلة</td>
                          </tr>
                        ) : (
                          detail.payments.map(p => (
                            <tr key={p.id}>
                              <td className="p-3 whitespace-nowrap text-xs font-mono">{formatDate(p.paid_at)}</td>
                              <td className="p-3 whitespace-nowrap numeric font-bold text-success">{formatMoney(p.amount)}</td>
                              <td className="p-3 max-w-[200px] truncate text-xs" title={p.note || ''}>{p.note || '-'}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={() => {
                                    if (window.confirm('هل أنت متأكد من التراجع عن دفعة السداد هذه وحذفها؟')) {
                                      deletePaymentMutation.mutate(p.id);
                                    }
                                  }}
                                  className="p-1.5 hover:bg-danger/10 text-danger rounded-md transition-colors"
                                  title="حذف/تراجع"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Debtor Details Modal */}
      {isEditDebtorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsEditDebtorOpen(false); }}
        >
          <div ref={editDebtorTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">تعديل بيانات العميل</h2>
              <button onClick={() => setIsEditDebtorOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (selectedDebtorId) {
                  updateDebtorMutation.mutate({
                    id: selectedDebtorId,
                    name: debtorForm.name,
                    phone: debtorForm.phone,
                    notes: debtorForm.notes
                  });
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">الاسم الكامل <span className="text-danger">*</span></label>
                <input
                  type="text"
                  required
                  value={debtorForm.name}
                  onChange={e => setDebtorForm({ ...debtorForm, name: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={debtorForm.phone}
                  onChange={e => setDebtorForm({ ...debtorForm, phone: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm text-end dir-ltr numeric"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea
                  value={debtorForm.notes}
                  onChange={e => setDebtorForm({ ...debtorForm, notes: e.target.value })}
                  className="w-full h-20 p-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={updateDebtorMutation.isPending || !debtorForm.name}
                className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
              >
                تأكيد التعديل
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Debt Item Dialog */}
      {isAddDebtOpen && selectedDebtorId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddDebtOpen(false); }}
        >
          <div ref={addDebtTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-sm rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">إضافة دين جديد</h2>
              <button onClick={() => setIsAddDebtOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                addDebtItemMutation.mutate({
                  debtor_id: selectedDebtorId,
                  category: debtItemForm.category || categories[0] || 'أخرى',
                  amount: parseMoney(debtItemForm.amount),
                  note: debtItemForm.note
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">الصنف <span className="text-danger">*</span></label>
                <select
                  value={debtItemForm.category}
                  onChange={e => setDebtItemForm({ ...debtItemForm, category: e.target.value })}
                  className="w-full h-11 bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent text-sm"
                  required
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">المبلغ (دينار أردني JOD) <span className="text-danger">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={debtItemForm.amount}
                    onChange={e => setDebtItemForm({ ...debtItemForm, amount: e.target.value })}
                    className="w-full h-11 ps-10 pe-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm font-bold numeric"
                    placeholder="0.00"
                  />
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">د.أ</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظة</label>
                <input
                  type="text"
                  value={debtItemForm.note}
                  onChange={e => setDebtItemForm({ ...debtItemForm, note: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                  placeholder="كتابة أي ملاحظات للبند..."
                />
              </div>

              <button
                type="submit"
                disabled={addDebtItemMutation.isPending || !debtItemForm.amount}
                className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
              >
                تأكيد الإضافة
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Dialog */}
      {isRecordPaymentOpen && selectedDebtorId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsRecordPaymentOpen(false); }}
        >
          <div ref={recordPaymentTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-sm rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">تسجيل سداد دفعة</h2>
              <button onClick={() => setIsRecordPaymentOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                recordPaymentMutation.mutate({
                  debtor_id: selectedDebtorId,
                  amount: parseMoney(paymentForm.amount),
                  note: paymentForm.note
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">قيمة الدفعة (JOD) <span className="text-danger">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={paymentForm.amount}
                    onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="w-full h-11 ps-10 pe-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm font-bold numeric text-success"
                    placeholder="0.00"
                  />
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">د.أ</span>
                </div>
                {detail && (
                  <p className="text-[11px] text-text-secondary mt-1">
                    أقصى مبلغ متبقي: <span className="font-bold numeric">{formatMoney(detail.remaining)}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظة</label>
                <input
                  type="text"
                  value={paymentForm.note}
                  onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                  placeholder="دفعة نقدية / حوالة..."
                />
              </div>

              <button
                type="submit"
                disabled={recordPaymentMutation.isPending || !paymentForm.amount}
                className="w-full h-11 bg-success-bg text-success border border-success/30 font-bold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
              >
                تأكيد استلام الدفعة
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manage Categories Dialog */}
      {isManageCategoriesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsManageCategoriesOpen(false); }}
        >
          <div ref={categoriesTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-sm rounded-2xl p-6 shadow-xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">إدارة أصناف الديون</h2>
              <button onClick={() => setIsManageCategoriesOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Add New Category */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="صنف جديد..."
                  className="flex-1 h-10 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                />
                <button
                  onClick={() => {
                    const trimmed = newCategory.trim();
                    if (!trimmed) return;
                    if (categories.includes(trimmed)) {
                      toast.error('هذا الصنف موجود بالفعل');
                      return;
                    }
                    const updated = [...categories, trimmed];
                    saveCategoriesMutation.mutate(updated);
                    setNewCategory('');
                  }}
                  className="bg-accent text-white px-4 rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
                >
                  إضافة
                </button>
              </div>

              {/* Categories list */}
              <div className="border border-border rounded-lg max-h-48 overflow-y-auto divide-y divide-border bg-background">
                {categories.map(c => (
                  <div key={c} className="flex justify-between items-center p-3 text-sm">
                    <span className="font-semibold text-text-primary">{c}</span>
                    <button
                      onClick={() => {
                        if (categories.length <= 1) {
                          toast.error('يجب بقاء صنف واحد على الأقل');
                          return;
                        }
                        const updated = categories.filter(item => item !== c);
                        saveCategoriesMutation.mutate(updated);
                      }}
                      className="p-1 hover:bg-danger/10 text-danger rounded-md transition-colors"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Templates Setup Dialog */}
      {isEditTemplatesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setIsEditTemplatesOpen(false); }}
        >
          <div ref={templatesTrap} role="dialog" aria-modal="true" className="bg-surface w-[calc(100%-2rem)] max-w-lg rounded-2xl p-6 shadow-xl flex flex-col max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">إعدادات المحل والرسائل</h2>
              <button onClick={() => setIsEditTemplatesOpen(false)} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveTemplatesMutation.mutate({
                  shopName: shopNameInput,
                  reminder: reminderTemplateInput,
                  confirm: confirmTemplateInput
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">اسم المحل</label>
                <input
                  type="text"
                  value={shopNameInput}
                  onChange={e => setShopNameInput(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-sm"
                  placeholder="مثال: اتصالات آية"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-sm font-medium">قالب رسالة التذكير بالدين</label>
                  <span className="text-[10px] text-text-secondary font-mono">الواتساب</span>
                </div>
                <textarea
                  value={reminderTemplateInput}
                  onChange={e => setReminderTemplateInput(e.target.value)}
                  className="w-full h-24 p-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-xs resize-none"
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-sm font-medium">قالب رسالة تأكيد السداد</label>
                  <span className="text-[10px] text-text-secondary font-mono">الواتساب</span>
                </div>
                <textarea
                  value={confirmTemplateInput}
                  onChange={e => setConfirmTemplateInput(e.target.value)}
                  className="w-full h-24 p-3 rounded-lg border border-border focus:border-accent outline-none bg-background text-xs resize-none"
                  required
                />
              </div>

              <div className="bg-muted/50 p-3.5 rounded-xl border border-border space-y-1 text-[11px] text-text-secondary">
                <p className="font-bold text-text-primary flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 text-accent" />
                  <span>الرموز المتاحة للاستخدام في القوالب:</span>
                </p>
                <ul className="list-disc list-inside ps-2 space-y-0.5 font-mono">
                  <li><span className="font-bold text-accent">[الاسم]</span> - اسم العميل الكامل</li>
                  <li><span className="font-bold text-accent">[المحل]</span> - اسم المحل المسجل بالأعلى</li>
                  <li><span className="font-bold text-accent">[المتبقي]</span> - المبلغ المتبقي المستحق</li>
                  <li><span className="font-bold text-accent">[المدفوع]</span> - المبلغ المسدد حديثاً (لرسالة التأكيد)</li>
                  <li><span className="font-bold text-accent">[البنود]</span> - قائمة بالبنود المتبقية وتكلفتها</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={saveTemplatesMutation.isPending || !reminderTemplateInput || !confirmTemplateInput}
                className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
              >
                حفظ التغييرات
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
