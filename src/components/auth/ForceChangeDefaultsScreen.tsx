import { useState } from 'react';
import { hashCode } from '@/lib/auth';
import { set } from 'idb-keyval';
import { Shield, Key, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { NumPad } from '@/components/ui/NumPad';

export function ForceChangeDefaultsScreen() {
  const { recheckDefaults } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [newCode, setNewCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [showPin, setShowPin] = useState(false);

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
        await set('daily_lock', codeData);
        setStep(2);
        resetState();
      } else {
        const codeData = await hashCode(codeToUse);
        await set('admin_pin', codeData);
        await recheckDefaults();
      }
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
    }
  };

  const resetState = () => {
    setNewCode('');
    setConfirmCode('');
    setIsConfirming(false);
    setError('');
    setShowPin(false);
  };


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
            <div className={cn("flex-1 h-1.5 rounded-full", step === 2 ? "bg-accent" : "bg-muted")} />
          </div>

          <div className="text-center">
            <h2 className="text-xl font-bold flex items-center justify-center gap-2 mb-2">
              {step === 1 ? <Key className="w-5 h-5 text-accent" /> : <Shield className="w-5 h-5 text-danger" />}
              {step === 1 ? "اكتب رقم سري جديد لليوميات" : "اكتب رقم سري جديد للمشرف"}
            </h2>
            <p className="text-sm text-text-secondary h-5 font-bold text-accent">
              {isConfirming ? 'أعد كتابة الرقم الجديد للتأكيد' : 'ألف رقم جديد من 4 خانات'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-center gap-4">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={cn(
                    "w-12 h-14 rounded-xl border-2 flex items-center justify-center text-3xl font-bold transition-all",
                    activeCode.length > i
                      ? "border-accent bg-accent text-white scale-110 shadow-lg shadow-accent/20"
                      : "border-border bg-muted text-transparent"
                  )}
                >
                  {activeCode.length > i && showPin ? activeCode[i] : '•'}
                </div>
              ))}
            </div>
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
        </div>
      </div>
    </div>
  );
}
