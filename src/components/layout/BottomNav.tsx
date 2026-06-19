import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Store, Wrench, BarChart2, Menu, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const PROTECTED = new Set(['/dashboard', '/reports']);

export function BottomNav({ className }: { className?: string }) {
  const { accessLevel } = useAuth();
  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'الرئيسية' },
    { path: '/maintenance', icon: Wrench, label: 'الصيانة' },
    { path: '/pos', icon: Store, label: 'نقطة البيع', isCenter: true },
    { path: '/reports', icon: BarChart2, label: 'التقارير' },
    { path: '/more', icon: Menu, label: 'المزيد' },
  ];

  return (
    <nav className={cn("h-[60px] pb-[env(safe-area-inset-bottom)] bg-surface border-t border-border flex items-center justify-between px-2 shrink-0 relative", className)}>
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors relative",
              isActive ? "text-accent" : "text-text-secondary hover:text-text-primary",
              item.isCenter && "text-accent"
            )
          }
        >
          {({ isActive }) => (
            <>
              {item.isCenter ? (
                <div className="absolute -top-6 bg-accent text-white p-3 rounded-full shadow-md border-4 border-background">
                  <item.icon className="w-6 h-6" />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-0.5 relative">
                  <div className="relative">
                    <item.icon className={cn("w-6 h-6", isActive && "fill-current/20")} />
                    {PROTECTED.has(item.path) && accessLevel !== 'admin' && (
                      <Lock className="absolute -top-1 -end-1 w-3 h-3 text-accent bg-background rounded-full p-0.5 box-content" />
                    )}
                  </div>
                  <span className="text-[10px]">{item.label}</span>
                </div>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
