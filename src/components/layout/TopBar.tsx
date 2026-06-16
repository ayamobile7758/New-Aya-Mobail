import { format } from 'date-fns';

export function TopBar() {
  const today = format(new Date(), 'dd/MM/yyyy');

  return (
    <header className="h-[56px] border-b border-border bg-surface flex items-center justify-between px-4 sticky top-0 z-10 shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-bold text-lg text-accent" style={{ fontFamily: 'Tajawal, sans-serif' }}>POS الذكي</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:block text-text-secondary text-sm font-medium numeric">{today}</div>
      </div>
    </header>
  );
}
