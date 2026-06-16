import { NavLink } from 'react-router-dom';
import { Home, ShoppingCart, Package, DollarSign, ArrowRightLeft, Wrench, BarChart2, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui.store';

const navItems = [
  { path: '/dashboard', icon: Home, label: 'الرئيسية', requiresPin: true },
  { path: '/pos', icon: ShoppingCart, label: 'نقطة البيع', requiresPin: false },
  { path: '/products', icon: Package, label: 'المنتجات', requiresPin: false },
  { path: '/inventory', icon: Package, label: 'المخزون', requiresPin: true },
  { path: '/expenses', icon: DollarSign, label: 'المصروفات', requiresPin: true },
  { path: '/operations', icon: ArrowRightLeft, label: 'العمليات', requiresPin: true },
  { path: '/maintenance', icon: Wrench, label: 'الصيانة', requiresPin: false },
  { path: '/reports', icon: BarChart2, label: 'التقارير', requiresPin: true },
  { path: '/settings', icon: Settings, label: 'الإعدادات', requiresPin: true },
];

export function SideRail({ className, forceCollapsed }: { className?: string, forceCollapsed?: boolean }) {
  const sideRailMode = useUIStore(s => s.sideRailMode);
  const isCollapsed = forceCollapsed || sideRailMode === 'collapsed';

  return (
    <aside className={cn(
      "border-e border-border bg-surface flex flex-col py-4 shrink-0 transition-all",
      isCollapsed ? "w-[60px]" : "w-20 lg:w-[240px]",
      className
    )}>
      <nav className="flex flex-col gap-2 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center p-3 rounded-md text-text-secondary hover:bg-muted transition-colors",
                !isCollapsed && "lg:flex-row lg:gap-3",
                isCollapsed && "gap-1",
                isActive && "bg-accent-light text-accent font-semibold",
                !isCollapsed && isActive && "lg:border-s-4 lg:border-accent"
              )
            }
            title={item.label}
          >
            <item.icon className="w-6 h-6 shrink-0" />
            {!isCollapsed && <span className="text-[11px] lg:text-[14px] truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
