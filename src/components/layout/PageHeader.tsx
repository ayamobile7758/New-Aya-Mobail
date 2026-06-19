import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("bg-surface border-b border-border p-4 md:sticky md:top-0 z-10 shrink-0", className)}>
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-accent/10 text-accent rounded-xl flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
              {subtitle && <p className="text-sm text-text-secondary">{subtitle}</p>}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
