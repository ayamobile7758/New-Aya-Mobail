import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOpenDayPreview, closeDay } from '@/db/queries/closures';
import { getActiveAccounts } from '@/db/queries/accounts';
import { formatMoney, parseMoney } from '@/lib/money';
import { useAuth } from '@/contexts/AuthContext';
import { useEscKey } from '@/hooks/useEscKey';
import { toast } from 'sonner';
import { X, Lock, TrendingUp, TrendingDown, Package, Tag, Gift, Receipt, DollarSign, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetDate: string;
}

function PreviewCard({ icon: Icon, label, value, color = 'text-text-primary' }: {
  icon: React.ElementType; label: string; value: string; color?: string;
}) {
  return (
    <div className="bg-muted/40 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-text-secondary text-xs">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span style={{ fontFamily: 'Tajawal, sans-serif' }}>{label}</span>
      </div>
      <div className={cn('text-base font-bold numeric tabular-nums', color)}>
        {value}
      </div>
    </div>
  );
}

export function EODCloseDialog({ isOpen, onClose, targetDate }: Props) {
  const { requireAdminAction } = useAuth();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [actualCash, setActualCash] = useState<Record<string, string>>({});

  useEscKey(onClose, isOpen);

  const { data: preview } = useQuery({
    queryKey: ['eod-preview', targetDate],
    queryFn: () => getOpenDayPreview(targetDate),
    enabled: isOpen,
  });

  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts-active'],
    queryFn: getActiveAccounts,
    enabled: isOpen,
  });
  const cashAccounts = allAccounts.filter(a => a.type === 'cash');

  const closeMutation = useMutation({
    mutationFn: () => {
      const counts = cashAccounts.map(a => ({
        accountId: a.id,
        actualCash: parseMoney(actualCash[a.id] ?? ''),
      }));
      return closeDay(targetDate, counts, notes.trim() || undefined);
    },
    onSuccess: () => {
      toast.success('تم إقفال اليوم بنجاح');
      qc.invalidateQueries({ queryKey: ['day-status'] });
      qc.invalidateQueries({ queryKey: ['day-closures-history'] });
      qc.invalidateQueries({ queryKey: ['daily-summary'] });
      qc.invalidateQueries({ queryKey: ['accounts-active'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'فشل إقفال اليوم'),
  });

  const handleSubmit = () => {
    requireAdminAction(() => closeMutation.mutate());
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface w-[calc(100%-2rem)] max-w-lg rounded-[24px] shadow-xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base" style={{ fontFamily: 'Tajawal, sans-serif' }}>إقفال اليوم</h2>
              <p className="text-xs text-text-secondary numeric">{targetDate}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-secondary hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* ── Live Preview ── */}
          <div>
            <p className="text-sm font-semibold mb-3 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
              ملخص اليوم
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <PreviewCard
                icon={Receipt}
                label="المبيعات"
                value={formatMoney(preview?.sales_total ?? 0)}
                color="text-success"
              />
              <PreviewCard
                icon={Package}
                label="التكلفة (COGS)"
                value={formatMoney(preview?.cogs_total ?? 0)}
                color="text-warning"
              />
              <PreviewCard
                icon={Tag}
                label="الخصومات"
                value={formatMoney(preview?.discounts_total ?? 0)}
                color="text-danger"
              />
              <PreviewCard
                icon={Gift}
                label="قيمة الهدايا"
                value={formatMoney(preview?.gifts_value ?? 0)}
                color="text-accent"
              />
              <PreviewCard
                icon={TrendingDown}
                label="المردودات"
                value={formatMoney(preview?.returns_total ?? 0)}
                color="text-danger"
              />
              <PreviewCard
                icon={DollarSign}
                label="المصاريف"
                value={formatMoney(preview?.expenses_total ?? 0)}
                color="text-danger"
              />
              <PreviewCard
                icon={TrendingUp}
                label="صافي الربح"
                value={formatMoney(preview?.net_profit ?? 0)}
                color={(preview?.net_profit ?? 0) >= 0 ? 'text-success' : 'text-danger'}
              />
            </div>
          </div>

          {/* ── Cash Count ── */}
          {cashAccounts.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3 text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                جرد الصناديق النقدية
              </p>
              <div className="space-y-3">
                {cashAccounts.map(acct => {
                  const inputVal = actualCash[acct.id] ?? '';
                  const actual = inputVal === '' ? null : parseMoney(inputVal);
                  const diff = actual !== null ? actual - acct.balance : null;

                  return (
                    <div
                      key={acct.id}
                      className="bg-muted/40 rounded-xl p-4 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-accent shrink-0" />
                        <span className="font-semibold text-sm" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                          {acct.name}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 items-center">
                        <div>
                          <p className="text-xs text-text-secondary mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            الرصيد النظامي
                          </p>
                          <p className="font-bold numeric text-sm">{formatMoney(acct.balance)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-text-secondary mb-1" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            الرصيد الفعلي
                          </p>
                          <input
                            type="text"
                            dir="ltr"
                            inputMode="decimal"
                            placeholder="0.000"
                            value={inputVal}
                            onChange={e => setActualCash(prev => ({ ...prev, [acct.id]: e.target.value }))}
                            className="w-full h-9 px-2 text-sm rounded-lg border border-border bg-background focus:border-accent outline-none numeric"
                          />
                        </div>
                      </div>
                      {diff !== null && diff !== 0 && (
                        <p className={cn(
                          'text-xs font-bold numeric',
                          diff > 0 ? 'text-success' : 'text-danger'
                        )}>
                          {diff > 0 ? '▲' : '▼'} فرق {formatMoney(Math.abs(diff))}
                          {diff < 0 ? ' (عجز)' : ' (زيادة)'}
                        </p>
                      )}
                      {diff === 0 && inputVal !== '' && (
                        <p className="text-xs text-success font-medium" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                          ✓ لا يوجد فرق
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Notes ── */}
          <div>
            <label className="text-sm font-semibold text-text-secondary block mb-2" style={{ fontFamily: 'Tajawal, sans-serif' }}>
              ملاحظات (اختياري)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="أي ملاحظات تتعلق بإقفال هذا اليوم..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-background focus:border-accent outline-none resize-none"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary" style={{ fontFamily: 'Tajawal, sans-serif' }}>
            يتطلب PIN المشرف للتأكيد
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-9 px-4 text-sm rounded-xl border border-border hover:bg-muted transition-colors font-medium"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              إلغاء
            </button>
            <button
              onClick={handleSubmit}
              disabled={closeMutation.isPending}
              className="h-9 px-5 bg-accent text-white text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              style={{ fontFamily: 'Tajawal, sans-serif' }}
            >
              <Lock className="w-4 h-4" />
              {closeMutation.isPending ? 'جاري الإقفال...' : 'إقفال اليوم'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
