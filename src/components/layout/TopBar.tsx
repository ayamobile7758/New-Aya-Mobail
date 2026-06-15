import { Settings } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export function TopBar() {
  const navigate = useNavigate();
  const today = format(new Date(), 'dd/MM/yyyy');

  return (
    <header className="h-[56px] border-b border-border bg-surface flex items-center justify-between px-4 sticky top-0 z-10 shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-bold text-lg text-accent" style={{ fontFamily: 'Tajawal, sans-serif' }}>POS الذكي</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:block text-text-secondary text-sm font-medium numeric">{today}</div>
        <button
          onClick={() => navigate('/settings')}
          title="الإعدادات"
          className="p-2 hover:bg-muted rounded-full text-text-secondary transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
