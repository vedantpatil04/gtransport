import * as React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { initials, cn } from '@/lib/utils';
import type { Driver } from '@/types';

export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1.5 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" />
            {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Headline figure. `hero` gives the fuel card the visual weight the brief asks for. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  hero,
  to,
  className,
  testId,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
  hero?: boolean;
  to?: string;
  className?: string;
  testId?: string;
}) {
  const toneCls = { neutral: 'bg-muted text-foreground/70', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', primary: 'bg-primary text-primary-foreground' }[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-sm font-medium', hero ? 'text-white/70' : 'text-muted-foreground')}>{label}</p>
        {Icon && (
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', hero ? 'bg-plate text-[#1a1a1a]' : toneCls)}>
            <Icon className="size-[18px]" />
          </span>
        )}
      </div>
      <p className={cn('figure mt-2 font-bold leading-none tracking-tight', hero ? 'text-4xl' : 'text-[26px]')} data-testid={testId}>
        {value}
      </p>
      {sub && <div className={cn('mt-2 text-sm', hero ? 'text-white/70' : 'text-muted-foreground')}>{sub}</div>}
    </>
  );
  const cls = cn('block rounded-lg border p-4 transition-colors', hero ? 'border-transparent bg-primary text-white dark:bg-[#1f3354]' : 'bg-card', to && (hero ? 'hover:bg-primary/95' : 'hover:border-input hover:bg-accent/40'), className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Panel({ title, action, children, className, bodyClass }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn('panel overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9 pr-8" aria-label={placeholder} />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={t('admin.common.clear')}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children, onClear, active }: { children: React.ReactNode; onClear?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-3 sm:px-4">
      {children}
      {onClear && active && (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          <X />
          {t('admin.common.clearFilters')}
        </Button>
      )}
    </div>
  );
}

export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="scroll-thin overflow-x-auto">
    <table className={cn('w-full border-collapse text-sm', className)} {...p} />
  </div>
);
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 whitespace-nowrap border-b bg-muted/40 px-3 text-left text-xs font-semibold text-muted-foreground first:pl-4 last:pr-4', className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('h-14 border-b px-3 align-middle first:pl-4 last:pr-4', className)} {...p} />;
export const TR = ({ className, onClick, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none', className)}
    onClick={onClick}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => (e.key === 'Enter' ? onClick(e as unknown as React.MouseEvent<HTMLTableRowElement>) : undefined) : undefined}
    {...p}
  />
);

export function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>{t('admin.common.records', { count: total })}</span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <span className="figure">{t('admin.common.pageOf', { page: page + 1, total: pageCount })}</span>
          <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t('admin.common.prev')}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label={t('admin.common.next')}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

export function usePaged<T>(items: T[], size = 20, resetKey?: unknown) {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage(0), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safe = Math.min(page, pageCount - 1);
  return { rows: items.slice(safe * size, safe * size + size), page: safe, pageCount, setPage, total: items.length };
}

export function DriverCell({ driver, sub, link = true }: { driver: Driver | undefined; sub?: React.ReactNode; link?: boolean }) {
  if (!driver) return <span className="text-muted-foreground">—</span>;
  const inner = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{initials(driver.name)}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{driver.name}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
    </span>
  );
  return link ? (
    <Link to={`/admin/drivers/${driver.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, destructive }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            data-testid="confirm-action"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DetailList({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('divide-y rounded-lg border text-sm', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
