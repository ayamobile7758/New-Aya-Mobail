import React from 'react';
import { Delete, Check } from 'lucide-react';

interface NumPadProps {
  onDigit: (digit: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  submitDisabled?: boolean;
  allowDecimal?: boolean;
}

export const NumPad: React.FC<NumPadProps> = ({
  onDigit,
  onClear,
  onSubmit,
  submitDisabled = false,
  allowDecimal = false,
}) => {
  const Btn = ({
    children,
    onClick,
    className = '',
    disabled = false,
    label,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    className?: string;
    disabled?: boolean;
    label: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`w-16 h-16 rounded-full flex justify-center items-center text-xl font-bold bg-white border border-gray-200 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {children}
    </button>
  );

  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  if (allowDecimal) {
    return (
      <div className="flex flex-col gap-3 items-center" dir="ltr">
        <div className="grid grid-cols-3 gap-3 place-items-center">
          {digits.map((num) => (
            <Btn key={num} onClick={() => onDigit(num.toString())} label={`رقم ${num}`}>{num}</Btn>
          ))}
          <Btn onClick={() => onDigit('.')} className="text-lg font-black" label="نقطة عشرية">.</Btn>
          <Btn onClick={() => onDigit('0')} label="رقم 0">0</Btn>
          <Btn onClick={onClear} className="text-red-500" label="حذف آخر رقم">
            <Delete className="w-6 h-6" />
          </Btn>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          aria-label="تأكيد"
          className="w-full h-12 rounded-xl flex justify-center items-center font-bold bg-[#CF694A] text-white hover:bg-[#b0583e] active:bg-[#974b34] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
        >
          <Check className="w-6 h-6" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 place-items-center" dir="ltr">
      {digits.map((num) => (
        <Btn key={num} onClick={() => onDigit(num.toString())} label={`رقم ${num}`}>{num}</Btn>
      ))}
      <Btn onClick={onClear} className="text-red-500" label="حذف آخر رقم">
        <Delete className="w-6 h-6" />
      </Btn>
      <Btn onClick={() => onDigit('0')} label="رقم 0">0</Btn>
      <Btn
        onClick={onSubmit}
        disabled={submitDisabled}
        className="bg-[#CF694A] border-none text-white hover:bg-[#b0583e] active:bg-[#974b34]"
        label="تأكيد"
      >
        <Check className="w-6 h-6" />
      </Btn>
    </div>
  );
};
