import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Shield, HardDrive, Download, Upload, AlertTriangle, Key, Store, Receipt, ClipboardList, RefreshCw, Tag, Plus, Pencil, Trash2, EyeOff, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { exportDb, importDb } from '@/lib/backup';
import { changeDailyLock, changeAdminPin } from '@/lib/auth';
import { useSettingsStore } from '@/stores/settings.store';
import { getAuditLog } from '@/db/queries/audit';
import { getCategories, addCategory, updateCategory, deleteCategory, Category } from '@/db/queries/categories';
import { format, parseISO } from 'date-fns';

const ACTION_LABELS: Record<string, string> = {
  'إتمام_بيع': 'إتمام بيع',
  'استرجاع_فاتورة': 'استرجاع فاتورة',
  'تغيير_قفل_يومي': 'تغيير قفل اليومية',
  'تغيير_رمز_مشرف': 'تغيير رمز المشرف',
  'استعادة_نسخة_احتياطية': 'استعادة نسخة احتياطية',
  'تعديل_سعر_منتج': 'تعديل سعر منتج',
};

const ACTION_COLORS: Record<string, string> = {
  'إتمام_بيع': 'bg-success/10 text-success',
  'استرجاع_فاتورة': 'bg-danger/10 text-danger',
  'تغيير_قفل_يومي': 'bg-warning/10 text-warning',
  'تغيير_رمز_مشرف': 'bg-danger/10 text-danger',
  'استعادة_نسخة_احتياطية': 'bg-accent/10 text-accent',
  'تعديل_سعر_منتج': 'bg-warning/10 text-warning',
};

interface CategoryForm {
  name: string;
  color: string;
  icon: string;
  sort_order: string;
}

const EMPTY_CAT_FORM: CategoryForm = { name: '', color: '#CF694A', icon: 'Box', sort_order: '0' };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'pos' | 'security' | 'backup' | 'audit' | 'categories'>('general');
  const { settings, updateSettings } = useSettingsStore();
  const qc = useQueryClient();

  // General Settings
  const [storeName, setStoreName] = useState(settings.storeName);
  const [storePhone, setStorePhone] = useState(settings.storePhone);
  const [storeAddress, setStoreAddress] = useState(settings.storeAddress);

  // POS Settings
  const [receiptHeader, setReceiptHeader] = useState(settings.receiptHeader);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [taxPercent, setTaxPercent] = useState(settings.taxPercent.toString());
  
  // Security - Daily
  const [dailyLockCurrentAdminPin, setDailyLockCurrentAdminPin] = useState('');
  const [newDailyLock, setNewDailyLock] = useState('');
  const [confirmDailyLock, setConfirmDailyLock] = useState('');
  
  // Security - Admin
  const [adminCurrentPin, setAdminCurrentPin] = useState('');
  const [newAdminPin, setNewAdminPin] = useState('');
  const [confirmAdminPin, setConfirmAdminPin] = useState('');

  const [isChangingDaily, setIsChangingDaily] = useState(false);
  const [isChangingAdmin, setIsChangingAdmin] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requireAdminAction } = useAuth();

  const { data: auditRows = [], refetch: refetchAudit } = useQuery({
    queryKey: ['audit_log'],
    queryFn: () => getAuditLog(200),
    enabled: activeTab === 'audit',
  });

  // Categories state
  const [catForm, setCatForm] = useState<CategoryForm>(EMPTY_CAT_FORM);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);

  const { data: categories = [], refetch: refetchCats } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
    enabled: activeTab === 'categories',
  });

  const addCatMutation = useMutation({
    mutationFn: () => addCategory({
      name: catForm.name,
      color: catForm.color,
      icon: catForm.icon,
      sort_order: parseInt(catForm.sort_order) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      refetchCats();
      setCatForm(EMPTY_CAT_FORM);
      setShowCatForm(false);
      toast.success('تمت إضافة الفئة');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateCatMutation = useMutation({
    mutationFn: () => updateCategory(editingCat!.id, {
      name: catForm.name,
      color: catForm.color,
      icon: catForm.icon,
      sort_order: parseInt(catForm.sort_order) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      refetchCats();
      setEditingCat(null);
      setShowCatForm(false);
      setCatForm(EMPTY_CAT_FORM);
      toast.success('تم تحديث الفئة');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleCatMutation = useMutation({
    mutationFn: (cat: Category) => updateCategory(cat.id, { is_active: !cat.is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      refetchCats();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      refetchCats();
      toast.success('تم حذف الفئة');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openAddCat = () => {
    setEditingCat(null);
    setCatForm(EMPTY_CAT_FORM);
    setShowCatForm(true);
  };

  const openEditCat = (cat: Category) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, color: cat.color, icon: cat.icon, sort_order: cat.sort_order.toString() });
    setShowCatForm(true);
  };

  const submitCatForm = () => {
    if (!catForm.name.trim()) { toast.error('اسم الفئة مطلوب'); return; }
    requireAdminAction(() => {
      if (editingCat) updateCatMutation.mutate();
      else addCatMutation.mutate();
    });
  };

  const handleSaveDailyLock = async () => {
    if (newDailyLock.length < 4) {
      toast.error('الرمز يجب أن يكون 4 أرقام على الأقل');
      return;
    }
    if (newDailyLock !== confirmDailyLock) {
      toast.error('الرموز غير متطابقة');
      return;
    }

    try {
      await changeDailyLock(newDailyLock, dailyLockCurrentAdminPin);
      toast.success('تم تغيير قفل اليومية بنجاح');
      setIsChangingDaily(false);
      setNewDailyLock('');
      setConfirmDailyLock('');
      setDailyLockCurrentAdminPin('');
    } catch (e: any) {
      toast.error(e.message || 'خطأ في تغيير الرمز');
    }
  };

  const handleSaveAdminPin = async () => {
    if (newAdminPin.length < 4) {
      toast.error('الرمز يجب أن يكون 4 أرقام على الأقل');
      return;
    }
    if (newAdminPin !== confirmAdminPin) {
      toast.error('الرموز غير متطابقة');
      return;
    }

    try {
      await changeAdminPin(adminCurrentPin, newAdminPin);
      toast.success('تم تغيير رمز المشرف بنجاح');
      setIsChangingAdmin(false);
      setNewAdminPin('');
      setConfirmAdminPin('');
      setAdminCurrentPin('');
    } catch (e: any) {
      toast.error(e.message || 'خطأ في تغيير الرمز');
    }
  };

  const handleExportBackup = async () => {
    requireAdminAction(async () => {
      try {
        await exportDb();
        toast.success('تم تصدير النسخة الاحتياطية بنجاح');
      } catch (e: any) {
        toast.error('فشل تصدير النسخة الاحتياطية: ' + e.message);
      }
    });
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) fileInputRef.current.value = '';

    requireAdminAction(async () => {
      try {
        toast.loading('جارٍ التحقق من الملف وأخذ نسخة احتياطية واستعادة البيانات...');
        await importDb(file);
      } catch (err: any) {
        toast.dismiss();
        toast.error('فشلت الاستعادة: ' + err.message);
      }
    });
  };

  const handleSaveGeneral = () => {
    requireAdminAction(() => {
      updateSettings({
        storeName,
        storePhone,
        storeAddress,
      });
      toast.success('تم حفظ إعدادات المتجر');
    });
  };

  const handleSavePOS = () => {
    requireAdminAction(() => {
      updateSettings({
        receiptHeader,
        receiptFooter,
        taxPercent: parseFloat(taxPercent) || 0,
      });
      toast.success('تم حفظ إعدادات الطباعة');
    });
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-12 h-12 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الإعدادات</h1>
            <p className="text-sm text-text-secondary">إدارة الأمان والنسخ الاحتياطي</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-6">
          
          {/* Sidebar Tabs */}
          <div className="w-full md:w-64 shrink-0 flex flex-col gap-2">
            <button
              onClick={() => setActiveTab('general')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'general' 
                  ? "bg-accent text-white shadow-sm" 
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Store className="w-5 h-5" />
              إعدادات المتجر
            </button>
            <button
              onClick={() => setActiveTab('pos')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'pos' 
                  ? "bg-accent text-white shadow-sm" 
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Receipt className="w-5 h-5" />
              نقطة البيع والطباعة
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'security' 
                  ? "bg-accent text-white shadow-sm" 
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Shield className="w-5 h-5" />
              الأمان
            </button>
            <button
              onClick={() => setActiveTab('backup')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'backup' 
                  ? "bg-accent text-white shadow-sm" 
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <HardDrive className="w-5 h-5" />
              النسخ الاحتياطي
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'audit'
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <ClipboardList className="w-5 h-5" />
              سجل التدقيق
            </button>
            <button
              onClick={() => setActiveTab('categories')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'categories'
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Tag className="w-5 h-5" />
              إدارة الفئات
            </button>
          </div>

          {/* Main Content */}
          <div className="flex-1 bg-surface border border-border rounded-2xl p-6">
            
            {activeTab === 'general' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                  <Store className="w-6 h-6 text-accent" /> إعدادات المتجر
                </h2>
                
                <div className="max-w-md space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">اسم المتجر</label>
                    <input
                      type="text"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">رقم الهاتف (للتواصل السريع)</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={storePhone}
                      onChange={(e) => setStorePhone(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-start"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">العنوان</label>
                    <textarea
                      value={storeAddress}
                      onChange={(e) => setStoreAddress(e.target.value)}
                      className="w-full p-3 rounded-lg border border-border outline-none focus:border-accent resize-none h-24"
                    />
                  </div>
                  
                  <button
                    onClick={handleSaveGeneral}
                    className="h-11 px-6 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    حفظ إعدادات المتجر
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'pos' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                  <Receipt className="w-6 h-6 text-accent" /> نقطة البيع والطباعة
                </h2>
                
                <div className="max-w-md space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">الرقم الضريبي / ترويسة الفاتورة (أعلى الفاتورة)</label>
                    <textarea
                      value={receiptHeader}
                      onChange={(e) => setReceiptHeader(e.target.value)}
                      className="w-full p-3 rounded-lg border border-border outline-none focus:border-accent resize-none h-24 text-center leading-relaxed"
                      placeholder="مثال: الرقم الضريبي: 123456789"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">الجزء السفلي من الفاتورة (تذييل)</label>
                    <textarea
                      value={receiptFooter}
                      onChange={(e) => setReceiptFooter(e.target.value)}
                      className="w-full p-3 rounded-lg border border-border outline-none focus:border-accent resize-none h-24 text-center leading-relaxed"
                      placeholder="مثال: شكراً لتسوقكم معنا"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">نسبة الضريبة الافتراضية (%)</label>
                    <input
                      type="number"
                      dir="ltr"
                      min="0"
                      max="100"
                      value={taxPercent}
                      onChange={(e) => setTaxPercent(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-start"
                    />
                  </div>
                  
                  <button
                    onClick={handleSavePOS}
                    className="h-11 px-6 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    حفظ إعدادات الطباعة
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-8 animate-in fade-in">
                {/* Daily Lock Section */}
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                    <Key className="w-6 h-6 text-accent" /> رمز قفل اليومية (Daily Lock)
                  </h2>
                  <div className="bg-muted p-4 rounded-xl border border-border">
                    <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                      يُستخدم لفتح اليومية في بداية المناوبة.
                    </p>
                    
                    {!isChangingDaily ? (
                      <button
                        onClick={() => setIsChangingDaily(true)}
                        className="h-11 px-6 bg-surface border border-border text-text-primary font-bold rounded-lg hover:border-accent transition-colors flex items-center gap-2"
                      >
                        تغيير قفل اليومية
                      </button>
                    ) : (
                      <div className="space-y-4 max-w-sm bg-surface p-4 rounded-xl border border-border">
                        <h3 className="font-bold">إعداد رمز جديد</h3>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز المشرف الحالي (للتحقق)</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={dailyLockCurrentAdminPin} onChange={e => setDailyLockCurrentAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">الرمز اليومي الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={newDailyLock} onChange={e => setNewDailyLock(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">تأكيد الرمز الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={confirmDailyLock} onChange={e => setConfirmDailyLock(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleSaveDailyLock} className="flex-1 h-11 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors">
                            حفظ
                          </button>
                          <button onClick={() => setIsChangingDaily(false)} className="flex-1 h-11 bg-muted text-text-primary font-bold rounded-lg hover:bg-border transition-colors border border-border">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin PIN Section */}
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                    <Shield className="w-6 h-6 text-danger" /> رمز المشرف (Admin PIN)
                  </h2>
                  <div className="bg-danger-bg/50 p-4 rounded-xl border border-danger/20">
                    <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                      للعمليات الحساسة مثل المرتجعات، الإعدادات، واسترجاع المبالغ.
                    </p>
                    
                    {!isChangingAdmin ? (
                      <button
                        onClick={() => setIsChangingAdmin(true)}
                        className="h-11 px-6 bg-danger text-white font-bold rounded-lg hover:opacity-90 transition-colors flex items-center gap-2"
                      >
                        تغيير رمز المشرف
                      </button>
                    ) : (
                      <div className="space-y-4 max-w-sm bg-surface p-4 rounded-xl border border-danger/20 shadow-sm">
                        <h3 className="font-bold text-danger">تغيير رمز المشرف</h3>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز المشرف الحالي</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={adminCurrentPin} onChange={e => setAdminCurrentPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-danger text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز المشرف الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={newAdminPin} onChange={e => setNewAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-danger text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">تأكيد الرمز الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={confirmAdminPin} onChange={e => setConfirmAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-danger text-center tracking-widest text-lg"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleSaveAdminPin} className="flex-1 h-11 bg-danger text-white font-bold rounded-lg hover:opacity-90 transition-opacity">
                            تأكيد التغيير
                          </button>
                          <button onClick={() => setIsChangingAdmin(false)} className="flex-1 h-11 bg-muted text-text-primary font-bold rounded-lg hover:bg-border transition-colors border border-border">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <ClipboardList className="w-6 h-6 text-accent" /> سجل التدقيق
                  </h2>
                  <button
                    onClick={() => refetchAudit()}
                    className="p-2 text-text-secondary hover:bg-muted rounded-lg transition-colors"
                    title="تحديث"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-text-secondary mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  آخر 200 عملية حساسة — قراءة فقط، الأحدث أولاً.
                </p>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-text-secondary">
                      <tr>
                        <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>التاريخ والوقت</th>
                        <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>نوع العملية</th>
                        <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الوصف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {auditRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-10 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            لا توجد عمليات مسجّلة بعد
                          </td>
                        </tr>
                      ) : auditRows.map(row => (
                        <tr key={row.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                            {format(parseISO(row.ts), 'yyyy-MM-dd HH:mm:ss')}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={cn(
                              'px-2 py-0.5 rounded-full text-xs font-bold',
                              ACTION_COLORS[row.action] ?? 'bg-muted text-text-secondary'
                            )} style={{ fontFamily: 'Tajawal, sans-serif' }}>
                              {ACTION_LABELS[row.action] ?? row.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-primary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            {row.detail ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'categories' && (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Tag className="w-6 h-6 text-accent" /> إدارة الفئات
                  </h2>
                  <button
                    onClick={openAddCat}
                    className="flex items-center gap-2 px-4 h-10 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    فئة جديدة
                  </button>
                </div>

                {showCatForm && (
                  <div className="border border-accent/30 bg-accent/5 rounded-xl p-4 space-y-3 mb-4">
                    <h3 className="font-bold text-accent">{editingCat ? 'تعديل فئة' : 'إضافة فئة جديدة'}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">اسم الفئة *</label>
                        <input
                          type="text"
                          value={catForm.name}
                          onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent"
                          placeholder="مثال: هواتف مستعملة"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">الترتيب</label>
                        <input
                          type="number"
                          dir="ltr"
                          value={catForm.sort_order}
                          onChange={e => setCatForm(f => ({ ...f, sort_order: e.target.value }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-start"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">اللون</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={catForm.color}
                            onChange={e => setCatForm(f => ({ ...f, color: e.target.value }))}
                            className="h-10 w-14 rounded border border-border cursor-pointer bg-background p-1"
                          />
                          <input
                            type="text"
                            dir="ltr"
                            value={catForm.color}
                            onChange={e => setCatForm(f => ({ ...f, color: e.target.value }))}
                            className="flex-1 h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-start font-mono text-sm"
                            placeholder="#CF694A"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">اسم الأيقونة (Lucide)</label>
                        <input
                          type="text"
                          dir="ltr"
                          value={catForm.icon}
                          onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-start"
                          placeholder="Box"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={submitCatForm}
                        disabled={addCatMutation.isPending || updateCatMutation.isPending}
                        className="px-5 h-10 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
                      >
                        {editingCat ? 'حفظ التعديل' : 'إضافة'}
                      </button>
                      <button
                        onClick={() => { setShowCatForm(false); setEditingCat(null); setCatForm(EMPTY_CAT_FORM); }}
                        className="px-5 h-10 bg-muted border border-border text-text-primary font-bold rounded-lg hover:bg-border transition-colors"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-text-secondary">
                      <tr>
                        <th className="px-4 py-3 text-start">الفئة</th>
                        <th className="px-4 py-3 text-start">اللون</th>
                        <th className="px-4 py-3 text-start">الترتيب</th>
                        <th className="px-4 py-3 text-start">الحالة</th>
                        <th className="px-4 py-3 text-start">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {categories.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-text-secondary">لا توجد فئات بعد</td>
                        </tr>
                      ) : categories.map(cat => (
                        <tr key={cat.id} className={cn("hover:bg-muted/30", !cat.is_active && "opacity-50")}>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: cat.color }}
                              />
                              {cat.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-text-secondary" dir="ltr">{cat.color}</td>
                          <td className="px-4 py-3 numeric text-text-secondary">{cat.sort_order}</td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-xs font-bold",
                              cat.is_active ? "bg-success/10 text-success" : "bg-muted text-text-secondary"
                            )}>
                              {cat.is_active ? 'نشطة' : 'موقوفة'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditCat(cat)}
                                className="p-1.5 hover:bg-muted rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                                title="تعديل"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => requireAdminAction(() => toggleCatMutation.mutate(cat))}
                                className="p-1.5 hover:bg-muted rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                                title={cat.is_active ? 'إيقاف' : 'تفعيل'}
                              >
                                {cat.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => requireAdminAction(() => deleteCatMutation.mutate(cat.id))}
                                className="p-1.5 hover:bg-danger/10 rounded-lg transition-colors text-text-secondary hover:text-danger"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'backup' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <HardDrive className="w-6 h-6 text-accent" /> النسخ الاحتياطي والاستعادة
                </h2>

                <div className="bg-warning-bg/30 border border-warning/30 p-4 rounded-xl mb-6 flex gap-3">
                  <AlertTriangle className="w-6 h-6 text-warning shrink-0" />
                  <div className="text-sm text-text-primary">
                    <p className="font-bold mb-1">البيانات تخزن محلياً فقط!</p>
                    <p>هذا المتجر يعمل بدون إنترنت ويخزن بياناته داخل متصفحك. <strong>يجب عليك أخذ نسخة احتياطية بشكل دوري</strong> لتجنب فقدان البيانات أو في حال أردت نقلها لجهاز آخر.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-border rounded-xl p-5 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-12 h-12 bg-success/10 text-success rounded-full flex items-center justify-center">
                      <Download className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold">أخذ نسخة احتياطية</h3>
                    <p className="text-sm text-text-secondary">تحميل قاعدة البيانات الحالية لـحفظها في مكان آمن.</p>
                    <button
                      onClick={handleExportBackup}
                      className="mt-2 w-full h-11 bg-success text-white font-bold rounded-lg hover:opacity-90 transition-opacity"
                    >
                      تنزيل ملف النسخة
                    </button>
                  </div>

                  <div className="border border-border rounded-xl p-5 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-12 h-12 bg-accent/10 text-accent rounded-full flex items-center justify-center">
                      <Upload className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold">استعادة نسخة</h3>
                    <p className="text-sm text-text-secondary">رفع ملف نسخة سابقة واستعادة كامل البيانات منها.</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 w-full h-11 border-2 border-accent text-accent font-bold rounded-lg hover:bg-accent/5 transition-colors"
                    >
                      اختيار ملف النسخة
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept=".db"
                      onChange={handleImportBackup}
                    />
                  </div>
                </div>
                
              </div>
            )}
            
          </div>
        </div>
      </main>
    </div>
  );
}
