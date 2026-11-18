import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-sm',
    secondary: 'bg-surface border border-line hover:bg-raised text-fg',
    ghost: 'hover:bg-raised text-muted hover:text-fg',
    danger: 'bg-bad/10 text-bad hover:bg-bad/15',
  };
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12.5px] gap-1.5' : 'h-9 px-3.5 text-[13.5px] gap-2';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-[background,filter,color,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none ${styles[variant]} ${sizes} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          <h2 className="text-[13px] font-semibold text-muted">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-md bg-[linear-gradient(90deg,rgb(var(--raised)),rgb(var(--line)/0.6),rgb(var(--raised)))] bg-[length:200%_100%] animate-shimmer ${className}`} />;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 animate-rise">
      <div className="size-11 rounded-xl bg-accent-soft text-accent grid place-items-center mb-4">
        <Icon className="size-5" />
      </div>
      <h3 className="font-display font-semibold text-[15px]">{title}</h3>
      {children && <p className="text-muted mt-1.5 max-w-sm text-[13.5px]">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad/[0.06] px-4 py-3 text-[13.5px] animate-rise">
      <AlertTriangle className="size-4 text-bad mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-raised text-muted">{children}</kbd>;
}
