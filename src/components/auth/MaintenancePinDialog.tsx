import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { verifyCode, getLockoutSecondsRemaining, recordFailedAttempt, readSetting, markUnlocked } from '@/lib/auth';
import { Wrench, Clock, X } from 'lucide-react';
import { toastSuccess, toastError } from '@/components/ui/toast';
import { NumPad } from '@/components/ui/NumPad';
import { PinDots } from '@/components/ui/PinDots';
import { useEscKey } from '@/hooks/useEscKey';

interface MaintenancePinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
  description?: string;
}

export function MaintenancePinDialog({ isOpen, onClose, onSuccess, title, description }: MaintenancePinDialogProps) {
  const { grantMaintenanceAccess } = useAuth();
  const [pin, setPin] = useState('');
  const [success, setSuccess] = useState(false);
  const [lockoutSecs, setLockoutSecs] = useState(0);

  useEscKey(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) {
      setPin('');
      setSuccess(false);
      return;
    }
    const checkLockout = async () => {
      const remaining = await getLockoutSecondsRemaining('maintenance');
      setLockoutSecs(remaining);
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleSubmitPin = async (pinToCheck: string) => {
    if (lockoutSecs > 0) return;
    if (pinToCheck.length !== 4) return;

    const stored = await readSetting('maintenance_pin');
    if (stored && await verifyCode(pinToCheck, stored)) {
      await markUnlocked();
      // Flash all boxes (~600ms) before entering maintenance mode.
      setSuccess(true);
      setTimeout(() => {
        grantMaintenanceAccess();
        onSuccess();
        toastSuccess("تم الدخول لوضع الصيانة");
        setPin('');
      }, 550);
    } else {
      await recordFailedAttempt('maintenance');
      setPin('');
      toastError("الرمز غير صحيح");
      const remaining = await getLockoutSecondsRemaining('maintenance');
      setLockoutSecs(remaining);
    }
  };

  const handleKeyPress = (num: number) => {
    if (pin.length < 4 && lockoutSecs === 0 && !success) {
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

        <div className="w-14 h-14 bg-accent/10 border border-accent/20 text-accent rounded-2xl flex items-center justify-center mb-4 mt-2">
          <Wrench className="w-7 h-7" />
        </div>

        <h2 className="text-xl font-bold mb-1">{title || 'وضع الصيانة'}</h2>
        <p className="text-sm text-text-secondary text-center mb-6">
          {description || 'الرجاء إدخال رمز الصيانة (Maintenance PIN) للمتابعة'}
        </p>

        {lockoutSecs > 0 ? (
          <div className="w-full bg-danger/10 text-danger rounded-xl p-4 flex flex-col items-center mb-6">
            <Clock className="w-8 h-8 mb-2 animate-pulse" />
            <span className="font-bold">قفل مؤقت للحماية</span>
            <span className="text-sm opacity-90">{lockoutSecs} ثانية متبقية</span>
          </div>
        ) : (
          <>
            <PinDots filled={pin.length} success={success} className="mb-8" />

            <NumPad
              onDigit={(num) => handleKeyPress(Number(num))}
              onClear={handleBackspace}
              onSubmit={() => handleSubmitPin(pin)}
              submitDisabled={pin.length < 4}
            />
          </>
        )}
      </div>
    </div>
  );
}
