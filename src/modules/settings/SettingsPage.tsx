import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Shield, HardDrive, Download, Upload, AlertTriangle, Key, Store, Receipt, ClipboardList, RefreshCw, Tag, Plus, Pencil, Trash2, EyeOff, Eye, FileDown, Tablet, Copy, Wrench, ShoppingCart, Smartphone, Monitor, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { exportDb, importDb } from '@/lib/backup';
import { changeDailyLock, changeAdminPin, isDailyLockEnabled, setDailyLockEnabled, isMaintenanceEnabled, setMaintenanceEnabled, changeMaintenancePin, setAdminRecovery, getAdminRecoveryQuestion, getDiscountPolicy, setDiscountPolicy } from '@/lib/auth';
import { useSettingsStore } from '@/stores/settings.store';
import { useUIStore } from '@/stores/ui.store';
import { getAuditLog, getAuditActions, getAuditDevices } from '@/db/queries/audit';
import { getDeviceId, getDeviceName, setDeviceName } from '@/lib/device';
import { getCategories, addCategory, updateCategory, deleteCategory, Category, getDeletedCategories, restoreCategory } from '@/db/queries/categories';
import { getDeletedProducts, restoreProduct } from '@/db/queries/products';
import { getDeletedAccounts, restoreAccount, getActiveAccounts, createAccount, updateAccount, deactivateAccount, Account } from '@/db/queries/accounts';
import { getDeletedJobs, restoreJob } from '@/db/queries/maintenance';
import { getDeletedExpenses, restoreExpense } from '@/db/queries/expenses';
import { formatMoney } from '@/lib/money';
import { isSupabaseMode } from '@/db/client';
import { format, parseISO } from 'date-fns';

const ACTION_LABELS: Record<string, string> = {
  'إتمام_بيع': 'إتمام بيع',
  'استرجاع_فاتورة_كامل': 'استرجاع كامل',
  'استرجاع_فاتورة_جزئي': 'استرجاع جزئي',
  'استرجاع_فاتورة': 'استرجاع فاتورة',
  'تغيير_قفل_يومي': 'تغيير قفل اليومية',
  'تغيير_رمز_مشرف': 'تغيير رمز المشرف',
  'استعادة_نسخة_احتياطية': 'استعادة نسخة احتياطية',
  'تصدير_نسخة_احتياطية': 'تصدير نسخة احتياطية',
  'تعديل_سعر_منتج': 'تعديل سعر منتج',
  'تعديل_منتج': 'تعديل منتج',
  'إضافة_منتج': 'إضافة منتج',
  'تفعيل_منتج': 'تفعيل منتج',
  'تعطيل_منتج': 'تعطيل منتج',
  'إضافة_فئة': 'إضافة فئة',
  'تعديل_فئة': 'تعديل فئة',
  'حذف_فئة': 'حذف فئة',
  'مصروف_جديد': 'مصروف جديد',
  'شحن_جديد': 'شحن جديد',
  'تحويل_جديد': 'تحويل جديد',
  'جرد_مخزون': 'جرد مخزون',
  'تسوية_حساب': 'تسوية حساب',
  'استعادة_عنصر': 'استعادة عنصر',
};

const ACTION_COLORS: Record<string, string> = {
  'إتمام_بيع': 'bg-success/10 text-success',
  'استرجاع_فاتورة_كامل': 'bg-danger/10 text-danger',
  'استرجاع_فاتورة_جزئي': 'bg-warning/10 text-warning',
  'استرجاع_فاتورة': 'bg-danger/10 text-danger',
  'تغيير_قفل_يومي': 'bg-warning/10 text-warning',
  'تغيير_رمز_مشرف': 'bg-danger/10 text-danger',
  'استعادة_نسخة_احتياطية': 'bg-accent/10 text-accent',
  'تصدير_نسخة_احتياطية': 'bg-accent/10 text-accent',
  'تعديل_سعر_منتج': 'bg-warning/10 text-warning',
  'تعديل_منتج': 'bg-warning/10 text-warning',
  'إضافة_منتج': 'bg-success/10 text-success',
  'تفعيل_منتج': 'bg-success/10 text-success',
  'تعطيل_منتج': 'bg-muted text-text-secondary',
  'إضافة_فئة': 'bg-success/10 text-success',
  'تعديل_فئة': 'bg-warning/10 text-warning',
  'حذف_فئة': 'bg-danger/10 text-danger',
  'مصروف_جديد': 'bg-danger/10 text-danger',
  'شحن_جديد': 'bg-accent/10 text-accent',
  'تحويل_جديد': 'bg-accent/10 text-accent',
  'جرد_مخزون': 'bg-warning/10 text-warning',
  'تسوية_حساب': 'bg-warning/10 text-warning',
  'استعادة_عنصر': 'bg-success/10 text-success',
};

interface CategoryForm {
  name: string;
  color: string;
  icon: string;
  sort_order: string;
}

const EMPTY_CAT_FORM: CategoryForm = { name: '', color: '#CF694A', icon: 'Box', sort_order: '0' };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'pos' | 'security' | 'backup' | 'audit' | 'categories' | 'accounts' | 'trash'>('general');
  const { settings, updateSettings } = useSettingsStore();
  const { cartVisibility, setCartVisibility } = useUIStore();
  const qc = useQueryClient();

  // General Settings
  const [storeName, setStoreName] = useState(settings.storeName);
  const [storePhone, setStorePhone] = useState(settings.storePhone);
  const [storeAddress, setStoreAddress] = useState(settings.storeAddress);

  // Device identity
  const [deviceId] = useState(() => getDeviceId());
  const [deviceName, setDeviceNameState] = useState(() => getDeviceName());

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

  // Security - Daily Lock Toggle
  const [dailyLockEnabled, setDailyLockEnabledState] = useState(true);
  const [toggleDailyAdminPin, setToggleDailyAdminPin] = useState('');

  // Security - Maintenance
  const [maintEnabled, setMaintEnabledState] = useState(false);
  const [toggleMaintAdminPin, setToggleMaintAdminPin] = useState('');
  const [isChangingMaint, setIsChangingMaint] = useState(false);
  const [maintCurrentAdminPin, setMaintCurrentAdminPin] = useState('');
  const [newMaintPin, setNewMaintPin] = useState('');
  const [confirmMaintPin, setConfirmMaintPin] = useState('');

  // Security - Admin Recovery
  const [recoveryQuestion, setRecoveryQuestion] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [recoveryAdminPin, setRecoveryAdminPin] = useState('');
  const [existingRecoveryQuestion, setExistingRecoveryQuestion] = useState<string | null>(null);
  const [isSettingRecovery, setIsSettingRecovery] = useState(false);

  // Discount Policy Settings
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [policyCapType, setPolicyCapType] = useState<'percent' | 'amount'>('percent');
  const [policyCapValue, setPolicyCapValue] = useState('100');

  useEffect(() => {
    if (activeTab === 'pos') {
      getDiscountPolicy().then(p => {
        setPolicyEnabled(p.enabled);
        setPolicyCapType(p.capType);
        const displayVal = p.capType === 'amount' ? (p.capValue / 100).toString() : p.capValue.toString();
        setPolicyCapValue(displayVal);
      });
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'security') {
      isDailyLockEnabled().then(setDailyLockEnabledState);
      isMaintenanceEnabled().then(setMaintEnabledState);
      getAdminRecoveryQuestion().then(setExistingRecoveryQuestion);
    }
  }, [activeTab]);

  const handleToggleDailyLock = async () => {
    if (toggleDailyAdminPin.length < 4) {
      toast.error('رمز المشرف مطلوب ومكون من 4 أرقام');
      return;
    }
    try {
      const nextVal = !dailyLockEnabled;
      await setDailyLockEnabled(nextVal, toggleDailyAdminPin);
      toast.success(nextVal ? 'تم تفعيل قفل اليومية بنجاح' : 'تم تعطيل قفل اليومية بنجاح');
      setDailyLockEnabledState(nextVal);
      setToggleDailyAdminPin('');
    } catch (e: any) {
      toast.error(e.message || 'رمز المشرف غير صحيح');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requireAdminAction } = useAuth();

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  };

  const [auditFrom, setAuditFrom] = useState(sevenDaysAgo);
  const [auditTo, setAuditTo] = useState(todayStr);
  const [auditSelectedActions, setAuditSelectedActions] = useState<string[]>([]);
  const [auditSelectedDevice, setAuditSelectedDevice] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSearchDebounced, setAuditSearchDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setAuditSearchDebounced(auditSearch), 300);
    return () => clearTimeout(t);
  }, [auditSearch]);

  const { data: auditRows = [], refetch: refetchAudit } = useQuery({
    queryKey: ['audit_log', auditFrom, auditTo, auditSelectedActions, auditSearchDebounced, auditSelectedDevice],
    queryFn: () => getAuditLog({
      from: auditFrom || undefined,
      to: auditTo || undefined,
      actions: auditSelectedActions.length ? auditSelectedActions : undefined,
      search: auditSearchDebounced || undefined,
      deviceId: auditSelectedDevice || undefined,
      limit: 500,
    }),
    enabled: activeTab === 'audit',
  });

  const { data: auditActionOptions = [] } = useQuery({
    queryKey: ['audit_actions'],
    queryFn: getAuditActions,
    enabled: activeTab === 'audit',
  });

  const { data: auditDeviceOptions = [] } = useQuery({
    queryKey: ['audit_devices'],
    queryFn: getAuditDevices,
    enabled: activeTab === 'audit',
  });

  const handleExportAuditCsv = () => {
    const header = 'التاريخ,الفعل,الوصف,مرجع,الجهاز\n';
    const body = auditRows.map(r => [
      r.ts,
      r.action,
      (r.detail ?? '').replace(/"/g, '""'),
      r.ref_id ?? '',
      r.device_id ?? '',
    ].map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + header + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  // Accounts state
  interface AccountForm {
    name: string;
    type: 'cash' | 'card' | 'bank' | 'wallet';
    sort_order: string;
  }
  const EMPTY_ACC_FORM: AccountForm = { name: '', type: 'cash', sort_order: '0' };
  const [accForm, setAccForm] = useState<AccountForm>(EMPTY_ACC_FORM);
  const [editingAcc, setEditingAcc] = useState<Account | null>(null);
  const [showAccForm, setShowAccForm] = useState(false);

  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => getActiveAccounts(),
    enabled: activeTab === 'accounts',
  });

  const addAccMutation = useMutation({
    mutationFn: () => createAccount({
      name: accForm.name,
      type: accForm.type,
      sort_order: parseInt(accForm.sort_order) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      refetchAccounts();
      setAccForm(EMPTY_ACC_FORM);
      setShowAccForm(false);
      toast.success('تمت إضافة الحساب بنجاح');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateAccMutation = useMutation({
    mutationFn: () => updateAccount(editingAcc!.id, {
      name: accForm.name,
      type: accForm.type,
      sort_order: parseInt(accForm.sort_order) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      refetchAccounts();
      setEditingAcc(null);
      setShowAccForm(false);
      setAccForm(EMPTY_ACC_FORM);
      toast.success('تم تحديث الحساب بنجاح');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deactivateAccMutation = useMutation({
    mutationFn: (id: string) => deactivateAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['deleted_accounts'] });
      refetchAccounts();
      toast.success('تم تعطيل الحساب بنجاح');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openAddAcc = () => {
    setEditingAcc(null);
    setAccForm(EMPTY_ACC_FORM);
    setShowAccForm(true);
  };

  const openEditAcc = (acc: Account) => {
    setEditingAcc(acc);
    setAccForm({
      name: acc.name,
      type: acc.type as any,
      sort_order: (acc.sort_order ?? 0).toString(),
    });
    setShowAccForm(true);
  };

  const submitAccForm = () => {
    if (!accForm.name.trim()) { toast.error('اسم الحساب مطلوب'); return; }
    requireAdminAction(() => {
      if (editingAcc) updateAccMutation.mutate();
      else addAccMutation.mutate();
    });
  };

  // Trash / Restore queries
  const { data: deletedProducts = [], refetch: refetchDelProducts } = useQuery({
    queryKey: ['deleted_products'],
    queryFn: getDeletedProducts,
    enabled: activeTab === 'trash',
  });
  const { data: deletedCategories = [], refetch: refetchDelCats } = useQuery({
    queryKey: ['deleted_categories'],
    queryFn: getDeletedCategories,
    enabled: activeTab === 'trash',
  });
  const { data: deletedAccounts = [], refetch: refetchDelAccounts } = useQuery({
    queryKey: ['deleted_accounts'],
    queryFn: getDeletedAccounts,
    enabled: activeTab === 'trash',
  });
  const { data: deletedJobs = [], refetch: refetchDelJobs } = useQuery({
    queryKey: ['deleted_jobs'],
    queryFn: getDeletedJobs,
    enabled: activeTab === 'trash',
  });
  const { data: deletedExpenses = [], refetch: refetchDelExpenses } = useQuery({
    queryKey: ['deleted_expenses'],
    queryFn: getDeletedExpenses,
    enabled: activeTab === 'trash',
  });

  const restoreProductMutation = useMutation({
    mutationFn: (id: string) => restoreProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deleted_products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      refetchDelProducts();
      toast.success('تمت استعادة المنتج');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const restoreCategoryMutation = useMutation({
    mutationFn: (id: string) => restoreCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deleted_categories'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      refetchDelCats();
      toast.success('تمت استعادة الفئة');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const restoreAccountMutation = useMutation({
    mutationFn: (id: string) => restoreAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deleted_accounts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      refetchDelAccounts();
      toast.success('تمت استعادة الحساب');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const restoreJobMutation = useMutation({
    mutationFn: (id: string) => restoreJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deleted_jobs'] });
      qc.invalidateQueries({ queryKey: ['maintenance_jobs'] });
      refetchDelJobs();
      toast.success('تمت استعادة مهمة الصيانة');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const restoreExpenseMutation = useMutation({
    mutationFn: (id: string) => restoreExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deleted_expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-filtered'] });
      qc.invalidateQueries({ queryKey: ['active-accounts'] });
      refetchDelExpenses();
      toast.success('تمت استعادة المصروف');
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

  const handleSaveRecovery = async () => {
    if (!recoveryQuestion.trim()) {
      toast.error('سؤال الاسترجاع مطلوب');
      return;
    }
    if (!recoveryAnswer.trim()) {
      toast.error('الإجابة مطلوبة');
      return;
    }
    if (recoveryAdminPin.length < 4) {
      toast.error('رمز المشرف الحالي مطلوب ومكون من 4 أرقام');
      return;
    }

    try {
      await setAdminRecovery(recoveryQuestion, recoveryAnswer, recoveryAdminPin);
      toast.success('تم حفظ سؤال الاسترجاع بنجاح');
      setExistingRecoveryQuestion(recoveryQuestion);
      setIsSettingRecovery(false);
      setRecoveryQuestion('');
      setRecoveryAnswer('');
      setRecoveryAdminPin('');
    } catch (e: any) {
      toast.error(e.message || 'رمز المشرف غير صحيح');
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

  const handleSaveDevice = () => {
    requireAdminAction(() => {
      setDeviceName(deviceName.trim() || 'تابلت رقم 1');
      setDeviceNameState(deviceName.trim() || 'تابلت رقم 1');
      toast.success('تم حفظ اسم الجهاز');
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

  const handleSaveDiscountPolicy = () => {
    requireAdminAction(async () => {
      try {
        const val = parseFloat(policyCapValue) || 0;
        const storedValue = policyCapType === 'amount' ? Math.round(val * 100) : val;
        await setDiscountPolicy({
          enabled: policyEnabled,
          capType: policyCapType,
          capValue: storedValue,
        });
        toast.success('تم حفظ سياسة الخصم بنجاح');
      } catch (err: any) {
        toast.error('خطأ في حفظ سياسة الخصم: ' + err.message);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 md:sticky md:top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">الإعدادات</h1>
              <p className="text-sm text-text-secondary">إدارة الأمان والنسخ الاحتياطي</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6">
          
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
            <button
              onClick={() => setActiveTab('accounts')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'accounts'
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Wallet className="w-5 h-5" />
              الحسابات
            </button>
            <button
              onClick={() => setActiveTab('trash')}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors text-start",
                activeTab === 'trash'
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-secondary hover:bg-muted"
              )}
            >
              <Trash2 className="w-5 h-5" />
              العناصر المحذوفة
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

                {/* Device identity card */}
                <div className="max-w-md mt-8 pt-6 border-t border-border space-y-4">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Tablet className="w-5 h-5 text-accent" /> هذا الجهاز
                  </h3>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-text-secondary">معرّف الجهاز</label>
                    <div className="flex items-center gap-2">
                      <span
                        dir="ltr"
                        className="flex-1 h-11 px-3 rounded-lg border border-border bg-muted text-text-secondary text-sm font-mono flex items-center select-all"
                      >
                        {deviceId}
                      </span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(deviceId); toast.success('تم النسخ'); }}
                        className="h-11 w-11 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors shrink-0"
                        title="نسخ"
                      >
                        <Copy className="w-4 h-4 text-text-secondary" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">اسم الجهاز</label>
                    <input
                      type="text"
                      value={deviceName}
                      onChange={(e) => setDeviceNameState(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent"
                      placeholder="تابلت رقم 1"
                    />
                    <p className="text-xs text-text-secondary mt-1">
                      هذا الاسم سيظهر في سجلات التدقيق لتمييز الأجهزة في المحل.
                    </p>
                  </div>

                  <button
                    onClick={handleSaveDevice}
                    className="h-11 px-6 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    حفظ اسم الجهاز
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

                {/* ── Cart visibility control ── */}
                <div className="max-w-md mt-8 pt-6 border-t border-border space-y-3">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-accent" /> سلة المشتريات في شاشة البيع
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    اختر كيف تبدأ السلة عند فتح شاشة البيع. في الحالتين يمكنك دائماً إظهار السلة أو إخفاؤها بضغطة من شاشة البيع. يُحفظ هذا الإعداد على هذا الجهاز ويُطبّق فوراً.
                  </p>

                  <div className="space-y-2">
                    {([
                      { value: 'always' as const, label: 'ظاهرة دائماً', desc: 'تبدأ السلة ظاهرة كشريط جانبي على التابلت واللابتوب (وعلى الهاتف تُفتح بضغطة).', Icon: Monitor },
                      { value: 'hidden' as const, label: 'مخفية حتى أطلبها', desc: 'تبدأ السلة مغلقة لترى المنتجات بعرض أكبر. تظهر دائرة السلة أسفل الشاشة — اضغطها لفتح السلة (تغطي الشاشة على الهاتف، وتنزلق جانباً على التابلت واللابتوب).', Icon: Smartphone },
                    ]).map(({ value, label, desc, Icon }) => {
                      const active = cartVisibility === value;
                      return (
                        <button
                          key={value}
                          onClick={() => {
                            setCartVisibility(value);
                            toast.success('تم تحديث إعداد إظهار السلة');
                          }}
                          className={cn(
                            'w-full flex items-start gap-3 p-3 rounded-xl border text-start transition-colors',
                            active
                              ? 'border-accent bg-accent/5 shadow-sm'
                              : 'border-border bg-surface hover:bg-muted'
                          )}
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                            active ? 'bg-accent text-white' : 'bg-muted text-text-secondary'
                          )}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={cn('font-bold', active ? 'text-accent' : 'text-text-primary')}>
                              {label}
                            </div>
                            <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{desc}</div>
                          </div>
                          {active && (
                            <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">✓</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Discount policy control ── */}
                <div className="max-w-md mt-8 pt-6 border-t border-border space-y-4">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Tag className="w-5 h-5 text-accent" /> سياسة الخصم
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    حدد شروط ونوع الخصم المسموح به للموظفين دون الحاجة للموافقة من المشرف.
                  </p>

                  <div className="space-y-4">
                    {/* Toggle: enabled */}
                    <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface">
                      <span className="font-bold text-sm">السماح بالخصم للموظفين</span>
                      <label className="relative inline-flex items-center cursor-pointer" dir="ltr">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={policyEnabled}
                          onChange={(e) => setPolicyEnabled(e.target.checked)}
                        />
                        <div dir="ltr" className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>

                    {policyEnabled && (
                      <>
                        {/* Segmented choice / two buttons: capType */}
                        <div className="space-y-1.5">
                          <label className="block text-sm font-medium">نوع سقف الخصم</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setPolicyCapType('percent')}
                              className={cn(
                                "h-11 rounded-xl font-medium transition-colors border",
                                policyCapType === 'percent'
                                  ? "bg-text-primary text-white border-transparent"
                                  : "bg-surface border-border text-text-secondary hover:border-accent"
                              )}
                            >
                              نسبة %
                            </button>
                            <button
                              type="button"
                              onClick={() => setPolicyCapType('amount')}
                              className={cn(
                                "h-11 rounded-xl font-medium transition-colors border",
                                policyCapType === 'amount'
                                  ? "bg-text-primary text-white border-transparent"
                                  : "bg-surface border-border text-text-secondary hover:border-accent"
                              )}
                            >
                              مبلغ ثابت
                            </button>
                          </div>
                        </div>

                        {/* Numeric input: capValue */}
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            {policyCapType === 'percent'
                              ? "أقصى نسبة خصم مسموحة (%)"
                              : "أقصى مبلغ خصم مسموح (د.أ)"}
                          </label>
                          <input
                            type="number"
                            dir="ltr"
                            min="0"
                            step="any"
                            value={policyCapValue}
                            onChange={(e) => setPolicyCapValue(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border bg-background focus:border-accent outline-none text-start font-bold numeric"
                          />
                        </div>
                      </>
                    )}

                    <button
                      onClick={handleSaveDiscountPolicy}
                      className="h-11 px-6 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors w-full"
                    >
                      حفظ سياسة الخصم
                    </button>
                  </div>
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

                    <div className="border-t border-border mt-4 pt-4">
                      <h3 className="font-bold mb-2">تفعيل/تعطيل الرمز اليومي</h3>
                      <p className="text-xs text-text-secondary mb-3">
                        حالة الرمز حالياً: <strong>{dailyLockEnabled ? 'مفعّل' : 'معطّل'}</strong>. عند تعطيله، سيفتح النظام دون طلب الرمز اليومي.
                      </p>
                      <div className="flex flex-col sm:flex-row items-end gap-3 max-w-md">
                        <div className="flex-1">
                          <label className="block text-xs mb-1 text-text-secondary">رمز المشرف الحالي (للتحقق)</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={toggleDailyAdminPin} onChange={e => setToggleDailyAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent bg-surface text-center tracking-widest text-lg"
                          />
                        </div>
                        <button
                          onClick={handleToggleDailyLock}
                          className={cn(
                            "h-11 px-6 font-bold rounded-lg transition-colors whitespace-nowrap",
                            dailyLockEnabled ? "bg-danger text-white hover:opacity-90" : "bg-success text-white hover:opacity-90"
                          )}
                        >
                          {dailyLockEnabled ? "تعطيل الرمز اليومي" : "تفعيل الرمز اليومي"}
                        </button>
                      </div>
                    </div>
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

                {/* Admin Recovery Section */}
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                    <Key className="w-6 h-6 text-accent" /> سؤال استرجاع رمز المشرف (Recovery Question)
                  </h2>
                  <div className="bg-muted p-4 rounded-xl border border-border">
                    <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                      يُستخدم لاسترجاع وإعادة تعيين رمز المشرف إذا تم نسيانه.
                    </p>
                    
                    {existingRecoveryQuestion && (
                      <p className="text-xs text-text-secondary mb-3">
                        السؤال الحالي: <strong>{existingRecoveryQuestion}</strong>
                      </p>
                    )}

                    {!isSettingRecovery ? (
                      <button
                        onClick={() => setIsSettingRecovery(true)}
                        className="h-11 px-6 bg-surface border border-border text-text-primary font-bold rounded-lg hover:border-accent transition-colors flex items-center gap-2"
                      >
                        {existingRecoveryQuestion ? 'تغيير سؤال الاسترجاع' : 'إعداد سؤال الاسترجاع'}
                      </button>
                    ) : (
                      <div className="space-y-4 max-w-sm bg-surface p-4 rounded-xl border border-border">
                        <h3 className="font-bold">إعداد سؤال استرجاع</h3>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز المشرف الحالي (للتحقق)</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={recoveryAdminPin} onChange={e => setRecoveryAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">السؤال (مثال: ما اسم مدينتك الأولى؟)</label>
                          <input
                            type="text"
                            value={recoveryQuestion} onChange={e => setRecoveryQuestion(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">الإجابة</label>
                          <input
                            type="text"
                            value={recoveryAnswer} onChange={e => setRecoveryAnswer(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleSaveRecovery} className="flex-1 h-11 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors">
                            حفظ
                          </button>
                          <button onClick={() => setIsSettingRecovery(false)} className="flex-1 h-11 bg-muted text-text-primary font-bold rounded-lg hover:bg-border transition-colors border border-border">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Maintenance PIN Section */}
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                    <Wrench className="w-6 h-6 text-accent" /> رمز الصيانة (Maintenance PIN)
                  </h2>
                  <div className="bg-muted p-4 rounded-xl border border-border">
                    <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                      يُستخدم للسماح لفني الصيانة بالدخول لصفحة الصيانة فقط، دون الوصول لبقية النظام.
                    </p>

                    {!isChangingMaint ? (
                      <button
                        onClick={() => setIsChangingMaint(true)}
                        className="h-11 px-6 bg-surface border border-border text-text-primary font-bold rounded-lg hover:border-accent transition-colors flex items-center gap-2"
                      >
                        تغيير رمز الصيانة
                      </button>
                    ) : (
                      <div className="space-y-4 max-w-sm bg-surface p-4 rounded-xl border border-border">
                        <h3 className="font-bold">إعداد رمز صيانة جديد</h3>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز المشرف الحالي (للتحقق)</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={maintCurrentAdminPin} onChange={e => setMaintCurrentAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">رمز الصيانة الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={newMaintPin} onChange={e => setNewMaintPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm mb-1 text-text-secondary">تأكيد الرمز الجديد</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={confirmMaintPin} onChange={e => setConfirmMaintPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent text-center tracking-widest text-lg"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={async () => {
                            if (newMaintPin.length < 4) { toast.error('الرمز يجب أن يكون 4 أرقام على الأقل'); return; }
                            if (newMaintPin !== confirmMaintPin) { toast.error('الرموز غير متطابقة'); return; }
                            try {
                              await changeMaintenancePin(newMaintPin, maintCurrentAdminPin);
                              toast.success('تم تغيير رمز الصيانة بنجاح');
                              setIsChangingMaint(false);
                              setNewMaintPin(''); setConfirmMaintPin(''); setMaintCurrentAdminPin('');
                            } catch (e: any) { toast.error(e.message || 'خطأ في تغيير الرمز'); }
                          }} className="flex-1 h-11 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors">
                            حفظ
                          </button>
                          <button onClick={() => setIsChangingMaint(false)} className="flex-1 h-11 bg-muted text-text-primary font-bold rounded-lg hover:bg-border transition-colors border border-border">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="border-t border-border mt-4 pt-4">
                      <h3 className="font-bold mb-2">تفعيل/تعطيل رمز الصيانة</h3>
                      <p className="text-xs text-text-secondary mb-3">
                        حالة الرمز حالياً: <strong>{maintEnabled ? 'مفعّل' : 'معطّل'}</strong>. عند تفعيله، يمكن لفني الصيانة الدخول برمز خاص يفتح صفحة الصيانة فقط.
                      </p>
                      <div className="flex flex-col sm:flex-row items-end gap-3 max-w-md">
                        <div className="flex-1">
                          <label className="block text-xs mb-1 text-text-secondary">رمز المشرف الحالي (للتحقق)</label>
                          <input
                            type="password" inputMode="numeric" pattern="[0-9]*"
                            value={toggleMaintAdminPin} onChange={e => setToggleMaintAdminPin(e.target.value)}
                            className="w-full h-11 px-3 rounded-lg border border-border outline-none focus:border-accent bg-surface text-center tracking-widest text-lg"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            if (toggleMaintAdminPin.length < 4) { toast.error('رمز المشرف مطلوب ومكون من 4 أرقام'); return; }
                            try {
                              const nextVal = !maintEnabled;
                              await setMaintenanceEnabled(nextVal, toggleMaintAdminPin);
                              toast.success(nextVal ? 'تم تفعيل رمز الصيانة بنجاح' : 'تم تعطيل رمز الصيانة بنجاح');
                              setMaintEnabledState(nextVal);
                              setToggleMaintAdminPin('');
                            } catch (e: any) { toast.error(e.message || 'رمز المشرف غير صحيح'); }
                          }}
                          className={cn(
                            "h-11 px-6 font-bold rounded-lg transition-colors whitespace-nowrap",
                            maintEnabled ? "bg-danger text-white hover:opacity-90" : "bg-success text-white hover:opacity-90"
                          )}
                        >
                          {maintEnabled ? "تعطيل رمز الصيانة" : "تفعيل رمز الصيانة"}
                        </button>
                      </div>
                    </div>
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportAuditCsv}
                      disabled={auditRows.length === 0}
                      className="flex items-center gap-1.5 px-3 h-9 text-sm font-medium bg-surface border border-border rounded-lg hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
                      title="تصدير CSV"
                    >
                      <FileDown className="w-4 h-4" />
                      تصدير CSV
                    </button>
                    <button
                      onClick={() => refetchAudit()}
                      className="p-2 text-text-secondary hover:bg-muted rounded-lg transition-colors"
                      title="تحديث"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Filter Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 bg-muted rounded-xl border border-border">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>من تاريخ</label>
                    <input
                      type="date"
                      value={auditFrom}
                      onChange={e => setAuditFrom(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>إلى تاريخ</label>
                    <input
                      type="date"
                      value={auditTo}
                      onChange={e => setAuditTo(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>نوع العملية</label>
                    <select
                      multiple
                      size={3}
                      value={auditSelectedActions}
                      onChange={e => setAuditSelectedActions(Array.from(e.target.selectedOptions, o => o.value))}
                      className="w-full px-2 py-1 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                      style={{ fontFamily: 'Tajawal, sans-serif' }}
                    >
                      {auditActionOptions.map(a => (
                        <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                      ))}
                    </select>
                    {auditSelectedActions.length > 0 && (
                      <button
                        onClick={() => setAuditSelectedActions([])}
                        className="text-xs text-accent mt-1 hover:underline"
                        style={{ fontFamily: 'Tajawal, sans-serif' }}
                      >
                        مسح الفلتر
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>الجهاز</label>
                    <select
                      value={auditSelectedDevice}
                      onChange={e => setAuditSelectedDevice(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                      dir="ltr"
                    >
                      <option value="">الكل</option>
                      {auditDeviceOptions.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>بحث في الوصف</label>
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={e => setAuditSearch(e.target.value)}
                      placeholder="بحث..."
                      className="w-full h-9 px-2 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                      style={{ fontFamily: 'Tajawal, sans-serif' }}
                    />
                  </div>
                </div>

                <p className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  {auditRows.length} نتيجة — قراءة فقط، الأحدث أولاً.
                </p>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-text-secondary">
                      <tr>
                        <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>التاريخ والوقت</th>
                        <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>نوع العملية</th>
                        <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الوصف</th>
                        <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>الجهاز</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {auditRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            لا توجد عمليات تطابق الفلاتر المحددة
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
                          <td className="px-4 py-3 text-text-secondary whitespace-nowrap" dir="ltr" style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px' }}>
                            {row.device_id ?? '—'}
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

            {activeTab === 'accounts' && (
              <div className="space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Wallet className="w-6 h-6 text-accent" /> الحسابات
                  </h2>
                  <button
                    onClick={openAddAcc}
                    className="flex items-center gap-2 px-4 h-10 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    حساب جديد
                  </button>
                </div>

                {showAccForm && (
                  <div className="border border-accent/30 bg-accent/5 rounded-xl p-4 space-y-3 mb-4">
                    <h3 className="font-bold text-accent">{editingAcc ? 'تعديل الحساب' : 'إضافة حساب جديد'}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">اسم الحساب *</label>
                        <input
                          type="text"
                          value={accForm.name}
                          onChange={e => setAccForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent"
                          placeholder="مثال: الخزينة الرئيسية"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">الترتيب</label>
                        <input
                          type="number"
                          dir="ltr"
                          value={accForm.sort_order}
                          onChange={e => setAccForm(f => ({ ...f, sort_order: e.target.value }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-start"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">نوع الحساب *</label>
                        <select
                          value={accForm.type}
                          onChange={e => setAccForm(f => ({ ...f, type: e.target.value as any }))}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent"
                        >
                          <option value="cash">نقدي</option>
                          <option value="card">بطاقة</option>
                          <option value="bank">بنك</option>
                          <option value="wallet">محفظة</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={submitAccForm}
                        disabled={addAccMutation.isPending || updateAccMutation.isPending}
                        className="px-5 h-10 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
                      >
                        {editingAcc ? 'حفظ التعديل' : 'إضافة'}
                      </button>
                      <button
                        onClick={() => { setShowAccForm(false); setEditingAcc(null); setAccForm(EMPTY_ACC_FORM); }}
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
                        <th className="px-4 py-3 text-start">الحساب</th>
                        <th className="px-4 py-3 text-start">النوع</th>
                        <th className="px-4 py-3 text-start">الرصيد</th>
                        <th className="px-4 py-3 text-start">الترتيب</th>
                        <th className="px-4 py-3 text-start">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {accounts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-text-secondary">لا توجد حسابات بعد</td>
                        </tr>
                      ) : accounts.map(acc => (
                        <tr key={acc.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium">{acc.name}</td>
                          <td className="px-4 py-3 text-text-secondary">
                            {acc.type === 'cash' && 'نقدي'}
                            {acc.type === 'card' && 'بطاقة'}
                            {acc.type === 'bank' && 'بنك'}
                            {acc.type === 'wallet' && 'محفظة'}
                          </td>
                          <td className="px-4 py-3 font-bold numeric">{formatMoney(acc.balance)}</td>
                          <td className="px-4 py-3 numeric text-text-secondary">{acc.sort_order}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditAcc(acc)}
                                className="p-1.5 hover:bg-muted rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                                title="تعديل"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => requireAdminAction(() => deactivateAccMutation.mutate(acc.id))}
                                className="p-1.5 hover:bg-danger/10 rounded-lg transition-colors text-text-secondary hover:text-danger"
                                title="تعطيل"
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

            {activeTab === 'trash' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-4" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  <Trash2 className="w-6 h-6 text-accent" /> العناصر المحذوفة
                </h2>
                <p className="text-sm text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  العناصر المدرجة هنا محذوفة بشكل مؤقت. يمكن استعادتها في أي وقت.
                </p>

                {/* Deleted Products */}
                <div>
                  <h3 className="font-bold text-base mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>المنتجات</h3>
                  {deletedProducts.length === 0 ? (
                    <p className="text-sm text-text-secondary px-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد منتجات محذوفة</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الاسم</th>
                            <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>تاريخ الحذف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deletedProducts.map(p => (
                            <tr key={p.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{p.name}</td>
                              <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                                {p.deleted_at ? format(parseISO(p.deleted_at), 'yyyy-MM-dd HH:mm') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => requireAdminAction(() => restoreProductMutation.mutate(p.id))}
                                  className="px-3 py-1 text-xs font-bold rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                                >
                                  استعادة
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Deleted Categories */}
                <div>
                  <h3 className="font-bold text-base mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>الفئات</h3>
                  {deletedCategories.length === 0 ? (
                    <p className="text-sm text-text-secondary px-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد فئات محذوفة</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الاسم</th>
                            <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>تاريخ الحذف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deletedCategories.map(c => (
                            <tr key={c.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{c.name}</td>
                              <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                                {(c as any).deleted_at ? format(parseISO((c as any).deleted_at), 'yyyy-MM-dd HH:mm') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => requireAdminAction(() => restoreCategoryMutation.mutate(c.id))}
                                  className="px-3 py-1 text-xs font-bold rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                                >
                                  استعادة
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Deleted Accounts */}
                <div>
                  <h3 className="font-bold text-base mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>الحسابات</h3>
                  {deletedAccounts.length === 0 ? (
                    <p className="text-sm text-text-secondary px-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد حسابات محذوفة</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>الاسم</th>
                            <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>تاريخ الحذف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deletedAccounts.map(a => (
                            <tr key={a.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>{a.name}</td>
                              <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                                {(a as any).deleted_at ? format(parseISO((a as any).deleted_at), 'yyyy-MM-dd HH:mm') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => requireAdminAction(() => restoreAccountMutation.mutate(a.id))}
                                  className="px-3 py-1 text-xs font-bold rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                                >
                                  استعادة
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Deleted Maintenance Jobs */}
                <div>
                  <h3 className="font-bold text-base mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>مهام الصيانة</h3>
                  {deletedJobs.length === 0 ? (
                    <p className="text-sm text-text-secondary px-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد مهام صيانة محذوفة</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>رقم المهمة</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>العميل</th>
                            <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>تاريخ الحذف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deletedJobs.map(j => (
                            <tr key={j.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-medium numeric" style={{ fontFamily: 'Inter, sans-serif' }}>{j.job_number}</td>
                              <td className="px-4 py-3" style={{ fontFamily: 'Tajawal, sans-serif' }}>{j.customer_name}</td>
                              <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                                {(j as any).deleted_at ? format(parseISO((j as any).deleted_at), 'yyyy-MM-dd HH:mm') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => requireAdminAction(() => restoreJobMutation.mutate(j.id))}
                                  className="px-3 py-1 text-xs font-bold rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                                >
                                  استعادة
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Deleted Expenses */}
                <div>
                  <h3 className="font-bold text-base mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>المصروفات</h3>
                  {deletedExpenses.length === 0 ? (
                    <p className="text-sm text-text-secondary px-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>لا توجد مصروفات محذوفة</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-text-secondary">
                          <tr>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>رقم المصروف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>البيان</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}>المبلغ</th>
                            <th className="px-4 py-3 text-start whitespace-nowrap" style={{ fontFamily: 'Tajawal, sans-serif' }}>تاريخ الحذف</th>
                            <th className="px-4 py-3 text-start" style={{ fontFamily: 'Tajawal, sans-serif' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deletedExpenses.map(exp => (
                            <tr key={exp.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-mono text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>{exp.expense_number}</td>
                              <td className="px-4 py-3 text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>{exp.description}</td>
                              <td className="px-4 py-3 font-bold text-danger numeric">{formatMoney(exp.amount)}</td>
                              <td className="px-4 py-3 text-text-secondary whitespace-nowrap numeric" style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}>
                                {exp.deleted_at ? format(parseISO(exp.deleted_at), 'yyyy-MM-dd HH:mm') : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => requireAdminAction(() => restoreExpenseMutation.mutate(exp.id))}
                                  className="px-3 py-1 text-xs font-bold rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                                >
                                  استعادة
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'backup' && (
              <div className="space-y-6 animate-in fade-in">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <HardDrive className="w-6 h-6 text-accent" /> النسخ الاحتياطي والاستعادة
                </h2>

                {isSupabaseMode() ? (
                  <div className="p-4 bg-muted rounded-xl border border-border">
                    <p className="text-sm text-text-secondary leading-relaxed" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                      بياناتك محفوظة تلقائياً ومزامنة بشكل سحابي وآمن على خوادم Supabase. للحصول على نسخة من بياناتك، يرجى استخدام أزرار "تصدير CSV" المتوفرة في صفحة التقارير.
                    </p>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            )}
            
          </div>
        </div>
      </main>
    </div>
  );
}
