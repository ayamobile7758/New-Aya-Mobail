import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { verifyCode, getLockoutSecondsRemaining, recordFailedAttempt, readSetting, hasAdminRecovery, getAdminRecoveryQuestion, resetAdminPinViaRecovery } from '@/lib/auth';
import { set } from 'idb-keyval';
import { Shield, Clock, X, AlertTriangle, Key } from 'lucide-react';
import { toastSuccess, toastError } from '@/components/ui/toast';
import { NumPad } from '@/components/ui/NumPad';
import { useEscKey } from '@/hooks/useEscKey';

interface AdminPinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
  description?: string;
}

export function AdminPinDialog({ isOpen, onClose, onSuccess, title, description }: AdminPinDialogProps) {
  const { grantAdminAccess } = useAuth();
  const [pin, setPin] = useState('');
  const [lockoutSecs, setLockoutSecs] = useState(0);

  // Recovery flow states
  const [mode, setMode] = useState<'pin' | 'recovery-question' | 'recovery-reset' | 'no-recovery'>('pin');
  const [recoveryQuestion, setRecoveryQuestion] = useState<string | null>(null);
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');

  useEscKey(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) {
      setPin('');
      setMode('pin');
      setRecoveryAnswer('');
      setNewPin('');
      setConfirmNewPin('');
      return;
    }
    const checkLockout = async () => {
      const remaining = await getLockoutSecondsRemaining('admin');
      setLockoutSecs(remaining);
      if (remaining > 0) {
        setMode('pin'); // Force back to PIN/lockout screen if currently locked
      }
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleSubmitPin = async (pinToCheck: string) => {
    if (lockoutSecs > 0) return;
    if (pinToCheck.length !== 4) return;

    const stored = await readSetting('admin_pin');
    if (stored && await verifyCode(pinToCheck, stored)) {
      await set('pin_lockout_admin', null);
      grantAdminAccess();
      onSuccess();
      toastSuccess("تم تأكيد الصلاحية");
      setPin('');
    } else {
      await recordFailedAttempt('admin');
      setPin('');
      toastError("الرمز غير صحيح");
      const remaining = await getLockoutSecondsRemaining('admin');
      setLockoutSecs(remaining);
    }
  };

  const handleKeyPress = (num: number) => {
    if (pin.length < 4 && lockoutSecs === 0) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 4) {
        handleSubmitPin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleForgotPinClick = async () => {
    const hasRec = await hasAdminRecovery();
    if (!hasRec) {
      setMode('no-recovery');
      return;
    }
    const q = await getAdminRecoveryQuestion();
    setRecoveryQuestion(q);
    setMode('recovery-question');
    setRecoveryAnswer('');
  };

  const handleFinalRecoverySubmit = async () => {
    if (lockoutSecs > 0) {
      toastError(`تم قفل المحاولة. حاول مجدداً بعد ${lockoutSecs} ثانية.`);
      return;
    }
    if (newPin.length !== 4) {
      toastError("يجب أن يتكون الرمز الجديد من 4 أرقام");
      return;
    }
    if (newPin !== confirmNewPin) {
      toastError("الرموز غير متطابقة");
      return;
    }

    try {
      await resetAdminPinViaRecovery(recoveryAnswer, newPin);
      toastSuccess("تم استرجاع وتغيير رمز المشرف بنجاح");
      grantAdminAccess();
      onSuccess();
      setMode('pin');
      setRecoveryAnswer('');
      setNewPin('');
      setConfirmNewPin('');
    } catch (e: any) {
      toastError(e.message || "فشلت العملية");
      const remaining = await getLockoutSecondsRemaining('admin');
      setLockoutSecs(remaining);
      if (remaining > 0) {
        setMode('pin');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      dir="rtl"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-full max-w-sm rounded-[24px] p-6 shadow-xl relative animate-in zoom-in-95 flex flex-col items-center">
        <button
          onClick={onClose}
          className="absolute top-4 end-4 p-2 text-text-secondary hover:bg-muted rounded-full transition-colors outline-none"
        >
          <X className="w-5 h-5" />
        </button>

        {mode === 'pin' && (
          <>
            <div className="w-14 h-14 bg-accent/10 border border-accent/20 text-accent rounded-2xl flex items-center justify-center mb-4 mt-2">
              <Shield className="w-7 h-7" />
            </div>

            <h2 className="text-xl font-bold mb-1">{title || 'صلاحيات المدير'}</h2>
            <p className="text-sm text-text-secondary text-center mb-6">
              {description || 'الرجاء إدخال رمز المدير (Admin PIN) للمتابعة'}
            </p>

            {lockoutSecs > 0 ? (
              <div className="w-full bg-danger/10 text-danger rounded-xl p-4 flex flex-col items-center mb-6">
                <Clock className="w-8 h-8 mb-2 animate-pulse" />
                <span className="font-bold">قفل مؤقت للحماية</span>
                <span className="text-sm opacity-90">{lockoutSecs} ثانية متبقية</span>
              </div>
            ) : (
              <>
                <div className="flex gap-4 mb-8" dir="ltr">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                        pin.length > i
                          ? 'border-accent bg-accent text-white scale-110'
                          : 'border-border bg-surface'
                      }`}
                    >
                      {pin.length > i ? '•' : ''}
                    </div>
                  ))}
                </div>

                <NumPad
                  onDigit={(num) => handleKeyPress(Number(num))}
                  onClear={handleBackspace}
                  onSubmit={() => handleSubmitPin(pin)}
                  submitDisabled={pin.length < 4}
                />

                <button
                  type="button"
                  onClick={handleForgotPinClick}
                  className="mt-4 text-sm text-accent hover:underline outline-none border-0 bg-transparent cursor-pointer"
                  style={{ fontFamily: 'Tajawal, sans-serif' }}
                >
                  نسيت رمز المشرف؟
                </button>
              </>
            )}
          </>
        )}

        {mode === 'no-recovery' && (
          <div className="w-full flex flex-col items-center text-center py-4">
            <div className="w-14 h-14 bg-danger/10 border border-danger/20 text-danger rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold mb-2">استرجاع غير متوفر</h2>
            <p className="text-sm text-text-secondary leading-relaxed px-2">
              لم يتم إعداد سؤال استرجاع لرمز المشرف مسبقاً. يرجى مراجعة إعدادات الأمان أو التواصل مع الدعم.
            </p>
            <button
              type="button"
              onClick={() => setMode('pin')}
              className="mt-6 w-full h-11 bg-muted hover:bg-border text-text-primary font-bold rounded-xl transition-colors border-0 outline-none"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              رجوع
            </button>
          </div>
        )}

        {mode === 'recovery-question' && (
          <div className="w-full flex flex-col items-center">
            <div className="w-14 h-14 bg-accent/10 border border-accent/20 text-accent rounded-2xl flex items-center justify-center mb-4 mt-2">
              <Key className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold mb-2">سؤال استرجاع المشرف</h2>
            <p className="text-sm text-text-secondary text-center mb-4 leading-relaxed px-2">
              أجب عن سؤال الأمان لإعادة تعيين الرمز
            </p>
            <div className="w-full bg-muted p-3.5 rounded-xl text-center font-bold text-sm text-text-primary mb-4 border border-border">
              {recoveryQuestion}
            </div>
            <input
              type="text"
              placeholder="أدخل الإجابة هنا..."
              value={recoveryAnswer}
              onChange={e => setRecoveryAnswer(e.target.value)}
              className="w-full h-11 px-4 mb-5 rounded-xl border border-border outline-none focus:border-accent text-center font-bold"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            />
            <button
              type="button"
              onClick={() => {
                if (!recoveryAnswer.trim()) {
                  toastError("الرجاء إدخال الإجابة");
                  return;
                }
                setMode('recovery-reset');
              }}
              className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl transition-colors border-0 outline-none"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              التالي
            </button>
            <button
              type="button"
              onClick={() => setMode('pin')}
              className="mt-3 text-sm text-text-secondary hover:underline outline-none border-0 bg-transparent"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              إلغاء
            </button>
          </div>
        )}

        {mode === 'recovery-reset' && (
          <div className="w-full flex flex-col items-center">
            <div className="w-14 h-14 bg-accent/10 border border-accent/20 text-accent rounded-2xl flex items-center justify-center mb-4 mt-2">
              <Shield className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold mb-2">إعادة تعيين رمز المشرف</h2>
            <p className="text-sm text-text-secondary text-center mb-4 leading-relaxed">
              أدخل الرمز الجديد المكون من 4 أرقام
            </p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="الرمز الجديد (4 أرقام)"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="w-full h-11 px-3 mb-3 rounded-xl border border-border outline-none focus:border-accent text-center tracking-widest text-lg font-bold"
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="تأكيد الرمز الجديد"
              value={confirmNewPin}
              onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
              className="w-full h-11 px-3 mb-5 rounded-xl border border-border outline-none focus:border-accent text-center tracking-widest text-lg font-bold"
            />
            <button
              type="button"
              onClick={handleFinalRecoverySubmit}
              className="w-full h-11 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl transition-colors border-0 outline-none"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              تأكيد وإعادة تعيين الرمز
            </button>
            <button
              type="button"
              onClick={() => setMode('recovery-question')}
              className="mt-3 text-sm text-text-secondary hover:underline outline-none border-0 bg-transparent"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              رجوع للسؤال
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
