import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJobs, addJob, updateJobStatus, MaintenanceJob } from '@/db/queries/maintenance';
import { getActiveAccounts } from '@/db/queries/accounts';
import { useAuth } from '@/contexts/AuthContext';
import { Wrench, Plus, CheckCircle, PackageCheck, Phone, X, Search } from 'lucide-react';
import { formatMoney, parseMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useEscKey } from '@/hooks/useEscKey';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const STATUS_MAP = {
  new: { label: 'قيد الاستلام', color: 'bg-muted text-text-secondary' },
  in_progress: { label: 'جاري الصيانة', color: 'bg-warning-bg text-warning' },
  ready: { label: 'تمت الصيانة (جاهز)', color: 'bg-success-bg text-success' },
  delivered: { label: 'سُلم للعميل', color: 'bg-accent/10 text-accent' },
  cancelled: { label: 'ملغي', color: 'bg-danger/10 text-danger' },
};

export default function MaintenancePage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [isAddMode, setIsAddMode] = useState(false);
  
  const [deliveryJobId, setDeliveryJobId] = useState<string | null>(null);
  const [finalAmount, setFinalAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');

  const { requireAdminAction } = useAuth();

  // Esc: close topmost open dialog
  useEscKey(() => {
    if (deliveryJobId) setDeliveryJobId(null);
    else if (isAddMode) setIsAddMode(false);
  }, !!(deliveryJobId || isAddMode));

  const addJobTrapRef = useFocusTrap(isAddMode);
  const deliveryTrapRef = useFocusTrap(!!deliveryJobId);
  
  const [formData, setFormData] = useState({
    job_date: new Date().toISOString().split('T')[0],
    customer_name: '',
    customer_phone: '',
    device_type: '',
    issue_description: '',
    estimated_cost: '',
    notes: ''
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['active-accounts'],
    queryFn: getActiveAccounts,
  });

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['maintenance', filter, keyword],
    queryFn: () => getJobs(filter, keyword)
  });

  const saveMutation = useMutation({
    mutationFn: () => addJob({
      ...formData,
      estimated_cost: parseMoney(formData.estimated_cost)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('تم استلام الجهاز بنجاح');
      setIsAddMode(false);
      setFormData({
        job_date: new Date().toISOString().split('T')[0],
        customer_name: '', customer_phone: '', device_type: '', 
        issue_description: '', estimated_cost: '', notes: ''
      });
    },
    onError: (err: any) => {
      toast.error('حدث خطأ أثناء استلام الجهاز: ' + err.message);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, finalAmount, accountId }: { id: string, status: MaintenanceJob['status'], finalAmount?: number, accountId?: string }) => updateJobStatus(id, status, finalAmount, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-jobs-active'] });
      queryClient.invalidateQueries({ queryKey: ['recent-invoices-dashboard'] });
      toast.success('تم تحديث حالة الجهاز');
      setDeliveryJobId(null);
    },
    onError: (err: any) => {
      toast.error('حدث خطأ أثناء التحديث: ' + err.message);
    }
  });

  const handleDeliverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryJobId || !paymentAccountId) return;
    updateStatusMutation.mutate({
        id: deliveryJobId, 
        status: 'delivered', 
        finalAmount: parseMoney(finalAmount), 
        accountId: paymentAccountId
    });
  };

  return (
    <div className="flex flex-col h-full bg-background relative isolate">
      <header className="bg-surface border-b border-border p-4 sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex justify-between items-start md:items-center">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold">صيانة الأجهزة</h1>
                <p className="text-sm text-text-secondary">متابعة وإصلاح أجهزة العملاء</p>
              </div>
            </div>
            <button 
              onClick={() => setIsAddMode(true)}
              className="bg-accent text-white px-4 h-10 rounded-lg font-medium flex items-center gap-2 hover:bg-accent-hover transition-colors shadow-sm shrink-0"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden sm:inline">استلام جهاز جديد</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="w-5 h-5 absolute end-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input 
                type="text" 
                placeholder="بحث برقم الوصل، اسم العميل، نوع الجهاز..." 
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full h-11 box-border ps-4 pe-10 rounded-xl border border-border bg-background focus:border-accent outline-none"
              />
            </div>
            
            {/* Mobile status select dropdown */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="sm:hidden h-11 box-border w-full rounded-xl border border-border bg-surface px-3 font-medium outline-none focus:border-accent text-text-secondary"
            >
              {['all', 'new', 'in_progress', 'ready', 'delivered', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'الكل' : STATUS_MAP[s as keyof typeof STATUS_MAP].label}
                </option>
              ))}
            </select>

            {/* Desktop status tabs */}
            <div className="hidden sm:flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {['all', 'new', 'in_progress', 'ready', 'delivered', 'cancelled'].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={cn(
                    "px-4 h-11 rounded-xl whitespace-nowrap font-medium transition-colors border shadow-sm",
                    filter === s ? "bg-text-primary text-white border-transparent" : "bg-surface border-border text-text-secondary hover:border-accent"
                  )}
                >
                  {s === 'all' ? 'الكل' : STATUS_MAP[s as keyof typeof STATUS_MAP].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 content-area">
        <div className="max-w-6xl mx-auto">
          {isLoading ? (
            <div className="p-12 text-center"><div className="animate-spin w-8 h-8 mx-auto border-4 border-accent/30 border-t-accent rounded-full"></div></div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center bg-surface rounded-2xl border border-border">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                <Wrench className="w-12 h-12 text-text-secondary/40" />
              </div>
              <p className="text-text-secondary font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                لا توجد أجهزة صيانة تطابق بحثك.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {jobs.map(job => (
                <div key={job.id} className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded text-text-secondary">{job.job_number}</span>
                        <span className={cn("text-xs font-bold px-2 py-1 rounded", STATUS_MAP[job.status].color)}>
                          {STATUS_MAP[job.status].label}
                        </span>
                      </div>
                      <h3 className="font-bold text-lg">{job.device_type}</h3>
                    </div>
                    {(job.estimated_cost && job.estimated_cost > 0) ? (
                      <div className="text-end">
                        <div className="text-xs text-text-secondary">التكلفة التقريبية</div>
                        <div className="font-bold numeric text-accent">{formatMoney(job.estimated_cost)}</div>
                      </div>
                    ) : null}
                  </div>
                  
                  <div className="bg-muted/50 p-3 rounded-xl text-sm space-y-1">
                    <p><span className="font-medium">المشكلة:</span> {job.issue_description}</p>
                    {job.notes && <p><span className="font-medium">ملاحظات:</span> {job.notes}</p>}
                  </div>

                  <div className="flex justify-between items-center text-sm border-t border-border pt-4">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Phone className="w-4 h-4" /> 
                      <span className="font-medium">{job.customer_name}</span>
                      {job.customer_phone && <span className="numeric dir-ltr">({job.customer_phone})</span>}
                    </div>

                    <div className="flex gap-2">
                      {job.status === 'new' && (
                        <button 
                          onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'in_progress' })}
                          className="px-3 h-11 bg-warning-bg text-warning rounded-lg font-bold text-xs flex items-center"
                        >
                          البدء بالعمل
                        </button>
                      )}
                      {job.status === 'in_progress' && (
                        <button 
                          onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'ready' })}
                          className="px-3 h-11 bg-success-bg text-success rounded-lg font-bold text-xs flex items-center gap-1"
                        >
                          <CheckCircle className="w-3 h-3" /> تم الإنجاز
                        </button>
                      )}
                      {job.status === 'ready' && (
                        <button 
                          onClick={() => {
                              setDeliveryJobId(job.id);
                              setFinalAmount(job.estimated_cost ? (job.estimated_cost).toString() : '');
                          }}
                          className="px-3 h-11 bg-accent text-white rounded-lg font-bold text-xs flex items-center gap-1"
                        >
                          <PackageCheck className="w-3 h-3" /> تسليم للعميل
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          requireAdminAction(() => {
                             updateStatusMutation.mutate({ id: job.id, status: 'cancelled' });
                          });
                        }}
                        className="px-3 h-11 bg-danger/10 text-danger rounded-lg font-bold text-xs flex items-center gap-1"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Delivery Dialog */}
      {deliveryJobId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) setDeliveryJobId(null); }}
          >
            <div ref={deliveryTrapRef} role="dialog" aria-modal="true" aria-labelledby="delivery-dialog-title" className="bg-surface w-[calc(100%-2rem)] max-w-sm rounded-2xl shadow-xl flex flex-col overflow-hidden max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-4 border-b border-border bg-muted/30">
                    <h2 id="delivery-dialog-title" className="text-xl font-bold">تسليم الجهاز</h2>
                    <button onClick={() => setDeliveryJobId(null)} className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-full text-text-secondary hover:text-text-primary" aria-label="إغلاق">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleDeliverySubmit} className="p-4 space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">المبلغ النهائي المدفوع <span className="text-danger">*</span></label>
                        <input 
                            type="number" 
                            step="any"
                            min="0"
                            required
                            value={finalAmount}
                            onChange={(e) => setFinalAmount(e.target.value)}
                            className="w-full h-[var(--input-height)] px-3 rounded-lg border border-border focus:border-accent outline-none bg-background numeric font-bold"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">إيداع إلى حساب <span className="text-danger">*</span></label>
                        <select
                            value={paymentAccountId}
                            onChange={e => setPaymentAccountId(e.target.value)}
                            className="w-full h-[var(--input-height)] bg-surface border border-border rounded-lg px-3 outline-none focus:border-accent font-medium"
                            required
                        >
                            <option value="">-- اختر الحساب --</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name} ({formatMoney(acc.balance)})</option>
                            ))}
                        </select>
                    </div>

                    <button
                        type="submit"
                        disabled={updateStatusMutation.isPending || !finalAmount || !paymentAccountId}
                        className="w-full h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm flex items-center justify-center gap-2 mt-2"
                    >
                        <CheckCircle className="w-5 h-5" />
                        تأكيد وحفظ
                    </button>
                </form>
            </div>
          </div>
      )}

      {/* Add Job Dialog */}
      {isAddMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddMode(false); }}
        >
          <div ref={addJobTrapRef} role="dialog" aria-modal="true" aria-labelledby="add-job-title" className="bg-surface w-[calc(100%-2rem)] max-w-lg rounded-2xl p-6 shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 id="add-job-title" className="text-xl font-bold">استلام جهاز جديد للصيانة</h2>
              <button onClick={() => setIsAddMode(false)} className="w-11 h-11 flex items-center justify-center hover:bg-muted rounded-full" aria-label="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pe-2 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">اسم العميل <span className="text-danger">*</span></label>
                  <input 
                    type="text" 
                    value={formData.customer_name}
                    onChange={e => setFormData({...formData, customer_name: e.target.value})}
                    className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">رقم الهاتف</label>
                  <input 
                    type="tel" 
                    value={formData.customer_phone}
                    onChange={e => setFormData({...formData, customer_phone: e.target.value})}
                    className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background numeric dir-ltr text-end"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">نوع وموديل الجهاز <span className="text-danger">*</span></label>
                <input 
                  type="text" 
                  value={formData.device_type}
                  onChange={e => setFormData({...formData, device_type: e.target.value})}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background"
                  placeholder="iPhone 13 Pro Max"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">وصف العطل <span className="text-danger">*</span></label>
                <textarea 
                  value={formData.issue_description}
                  onChange={e => setFormData({...formData, issue_description: e.target.value})}
                  className="w-full h-24 p-3 rounded-lg border border-border focus:border-accent outline-none bg-background resize-none"
                  placeholder="الشاشة مكسورة ولا تستجيب للمس..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">التكلفة التقريبية</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      inputMode="decimal"
                      value={formData.estimated_cost}
                      onChange={e => setFormData({...formData, estimated_cost: e.target.value})}
                      className="w-full h-11 ps-10 pe-3 rounded-lg border border-border focus:border-accent outline-none numeric font-bold bg-background"
                    />
                    <span className="absolute start-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">د.أ</span>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات إضافية</label>
                <input 
                  type="text" 
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full h-11 px-3 rounded-lg border border-border focus:border-accent outline-none bg-background"
                  placeholder="مثال: الجهاز بدون شريحة، يوجد خدش في الخلف الدائم..."
                />
              </div>
            </div>

            <div className="pt-4 border-t border-border shrink-0 mt-4">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !formData.customer_name || !formData.device_type || !formData.issue_description}
                className="w-full h-[var(--btn-height)] bg-accent text-white font-bold rounded-lg disabled:opacity-50 hover:bg-accent-hover transition-colors shadow-sm"
              >
                تأكيد الاستلام
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
