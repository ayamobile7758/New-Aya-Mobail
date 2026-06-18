import { useState, useEffect } from 'react';
import { hashCode, writeSetting, isDailyLockEnabled, isDefaultDailyLock, setAdminRecovery } from '@/lib/auth';
import { Shield, Key, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { NumPad } from '@/components/ui/NumPad';
import { PinDots } from '@/components/ui/PinDots';

export function ForceChangeDefaultsScreen() {
  const { recheckDefaults } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [recoveryQuestion, setRecoveryQuestion] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');

  // On mount, determine starting step: skip daily-lock step if disabled or already changed
  useEffect(() => {
    (async () => {
      try {
        const enabled = await isDailyLockEnabled();
        const isDefault = await isDefaultDailyLock();
        // Skip step 1 if daily lock is disabled or already non-default
        if (!enabled || !isDefault) {
          setStep(2);
        }
      } catch (e) {
        // If check fails, default to showing both steps
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const activeCode = !isConfirming ? newCode : confirmCode;

  const handleNumber = (num: string) => {
    setError('');
    if (!isConfirming) {
      if (newCode.length < 4) {
        const next = newCode + num;
        setNewCode(next);
        if (next.length === 4) {
          if ((step === 1 && next === '1234') || (step === 2 && next === '0000')) {
            setError('لا يمكنك استخدام الرمز الافتراضي من فضلك ضع رمزاً جديداً');
            return;
          }
          setIsConfirming(true);
          setShowPin(false);
        }
      }
    } else {
      if (confirmCode.length < 4) {
        const next = confirmCode + num;
        setConfirmCode(next);
        if (next.length === 4) {
          handleNext(newCode, next);
        }
      }
    }
  };

  const handleDelete = () => {
    setError('');
    if (!isConfirming) {
      setNewCode(newCode.slice(0, -1));
    } else {
      setConfirmCode(confirmCode.slice(0, -1));
    }
  };

  const handleNext = async (customNew?: string, customConfirm?: string) => {
    const codeToUse = customNew !== undefined ? customNew : newCode;
    const confirmToUse = customConfirm !== undefined ? customConfirm : confirmCode;

    if (!isConfirming && customNew === undefined) {
      if (codeToUse.length !== 4) {
        setError('الرمز يجب أن يكون 4 أرقام');
        return;
      }
      if ((step === 1 && codeToUse === '1234') || (step === 2 && codeToUse === '0000')) {
        setError('لا يمكنك استخدام الرمز الافتراضي من فضلك ضع رمزاً جديداً');
        return;
      }
      setIsConfirming(true);
      setShowPin(false);
      return;
    }

    if (codeToUse !== confirmToUse) {
      setError('الرموز غير متطابقة، أعد المحاولة');
      setNewCode('');
      setConfirmCode('');
      setIsConfirming(false);
      return;
    }

    try {
      if (step === 1) {
        const codeData = await hashCode(codeToUse);
        await writeSetting('daily_lock', { enabled: true, ...codeData });
        setStep(2);
        resetState();
      } else if (step === 2) {
        const codeData = await hashCode(codeToUse);
        await writeSetting('admin_pin', codeData);
        setAdminPin(codeToUse);
        setStep(3);
        resetState();
      }
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
    }
  };

  const handleSubmitRecovery = async () => {
    if (!recoveryQuestion.trim()) {
      setError('سؤال الاسترجاع مطلوب');
      return;
    }
    if (!recoveryAnswer.trim()) {
      setError('الإجابة مطلوبة');
      return;
    }
    if (!adminPin) {
      setError('رمز المشرف مفقود، يرجى إعادة إدخاله في الخطوة السابقة');
      return;
    }

    try {
      await setAdminRecovery(recoveryQuestion, recoveryAnswer, adminPin);
      await recheckDefaults();
    } catch (e: any) {
      setError(e.message || 'حدث خطأ أثناء حفظ سؤال الاسترجاع');
    }
  };

  const resetState = () => {
    setNewCode('');
    setConfirmCode('');
    setIsConfirming(false);
    setError('');
    setShowPin(false);
  };


  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-8 animate-in slide-in-from-bottom-4">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto text-accent shadow-inner">
            <Shield className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">إعداد أرقام سرية جديدة</h1>
          <p className="text-text-secondary text-sm px-4">
            لحماية النظام، الرجاء تأليف و إدخال رقم سري <strong>جديد</strong> من اختيارك. 
            (لا تقم بإدخال الأرقام الافتراضية)
          </p>
        </div>

        <div className="bg-surface border border-border p-6 rounded-3xl shadow-xl space-y-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className={cn("flex-1 h-1.5 rounded-full", step === 1 ? "bg-accent" : "bg-success")} />
            <div className={cn("flex-1 h-1.5 rounded-full", step === 2 ? "bg-accent" : (step === 3 ? "bg-success" : "bg-muted"))} />
            <div className={cn("flex-1 h-1.5 rounded-full", step === 3 ? "bg-accent" : "bg-muted")} />
          </div>

          <div className="text-center">
            <h2 className="text-xl font-bold flex items-center justify-center gap-2 mb-2 font-tajawal">
              {step === 1 && <Key className="w-5 h-5 text-accent" />}
              {step === 2 && <Shield className="w-5 h-5 text-danger" />}
              {step === 3 && <Key className="w-5 h-5 text-accent" />}
              {step === 1 && "اكتب رقم سري جديد لليوميات"}
              {step === 2 && "اكتب رقم سري جديد للمشرف"}
              {step === 3 && "إعداد سؤال استرجاع رمز المشرف"}
            </h2>
            <p className="text-sm text-text-secondary h-5 font-bold text-accent">
              {step === 3
                ? 'يُسْتَخْدَم لاسترجاع الرمز عند نسيانه'
                : isConfirming
                ? 'أعد كتابة الرقم الجديد للتأكيد'
                : 'ألف رقم جديد من 4 خانات'}
            </p>
          </div>

          {step === 3 ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="block text-sm text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  السؤال (مثال: ما اسم أول مدرسة التحقت بها؟)
                </label>
                <input
                  type="text"
                  value={recoveryQuestion}
                  onChange={e => { setError(''); setRecoveryQuestion(e.target.value); }}
                  placeholder="أدخل سؤال الأمان الخاص بك"
                  className="w-full h-11 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                  الإجابة
                </label>
                <input
                  type="text"
                  value={recoveryAnswer}
                  onChange={e => { setError(''); setRecoveryAnswer(e.target.value); }}
                  placeholder="أدخل الإجابة هنا"
                  className="w-full h-11 px-3 rounded-lg border border-border bg-background outline-none focus:border-accent text-sm"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                />
              </div>

              {error && (
                <p className="text-danger text-center font-medium animate-in slide-in-from-top-2 text-sm">{error}</p>
              )}

              <button
                type="button"
                onClick={handleSubmitRecovery}
                className="w-full h-11 bg-accent text-white font-bold rounded-lg hover:bg-accent-hover transition-colors"
                style={{ fontFamily: 'Tajawal, sans-serif' }}
              >
                حفظ وإكمال الإعداد
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <PinDots
                  variant="setup"
                  filled={activeCode.length}
                  value={activeCode}
                  reveal={showPin}
                />
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowPin(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors py-1 px-2 rounded-lg"
                  >
                    {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPin ? 'إخفاء الأرقام' : 'إظهار الأرقام'}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-danger text-center font-medium animate-in slide-in-from-top-2">{error}</p>
              )}

              <NumPad
                onDigit={(num) => handleNumber(num)}
                onClear={handleDelete}
                onSubmit={handleNext}
                submitDisabled={activeCode.length !== 4}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
