import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, FileText, Fuel, ReceiptIndianRupee, Search, Truck, Users, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Plate } from '@/components/Plate';
import { cn } from '@/lib/utils';
import { useApp } from '@/store';
import { searchAll, type SearchGroupKey } from '../search';

const ICON: Record<SearchGroupKey, typeof Users> = { drivers: Users, vehicles: Truck, fuel: Fuel, expenses: ReceiptIndianRupee, payments: Wallet, documents: FileText };
const EXAMPLES = ['Ramesh', 'KA 22 AB 1234', 'IndianOil', 'RZP'];

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const fuel = useApp((s) => s.fuel);
  const expenses = useApp((s) => s.expenses);
  const payments = useApp((s) => s.payments);
  const documents = useApp((s) => s.documents);

  const groups = useMemo(() => searchAll(query, { drivers, vehicles, fuel, expenses, payments, documents }, t, i18n.language), [query, drivers, vehicles, fuel, expenses, payments, documents, t, i18n.language]);
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((it) => it.to)), [groups]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[12vh] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0 data-[state=open]:slide-in-from-top-2">
        <DialogTitle className="sr-only">{t('admin.search.title')}</DialogTitle>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && flat[active]) {
                go(flat[active]);
              }
            }}
            placeholder={t('admin.search.placeholder')}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="search-input"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Esc</kbd>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[60vh] overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <div className="px-3 py-6">
              <p className="text-sm text-muted-foreground">{t('admin.search.hint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => setQuery(ex)} className="rounded-full border px-3 py-1 text-sm hover:bg-accent">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : groups.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">{t('admin.search.empty', { query })}</p>
          ) : (
            groups.map((g) => {
              const Icon = ICON[g.key];
              return (
                <div key={g.key} className="mb-2" data-testid={`search-group-${g.key}`}>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <Icon className="size-3.5" />
                      {t(`admin.search.groups.${g.key}`)}
                      <span className="figure rounded bg-muted px-1.5 text-[11px]">{g.total}</span>
                    </p>
                    {g.total > g.items.length && g.viewAll && (
                      <button onClick={() => go(g.viewAll!)} className="text-xs font-semibold text-primary hover:underline">
                        {t('admin.search.viewAll', { count: g.total })}
                      </button>
                    )}
                  </div>
                  {g.items.map((it) => {
                    index += 1;
                    const i = index;
                    return (
                      <button
                        key={it.id}
                        data-index={i}
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(it.to)}
                        className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left', active === i && 'bg-accent')}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{it.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{it.sub}</p>
                        </div>
                        {it.plate && <Plate reg={it.plate} size="xs" />}
                        {active === i && <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
