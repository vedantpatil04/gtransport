import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ClipboardList, CloudOff, Fuel, Plus } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FileView } from '@/components/media/FileView';
import { UPDATE_TYPES } from '@/data/constants';
import { addDays, todayISO } from '@/lib/dates';
import { fmtDate, fmtTime, inr, num } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { Expense, FileRef, FuelEntry, Payment, SyncStatus, UpdateType } from '@/types';
import { AddUpdateSheet } from '../components/AddUpdateSheet';
import { DriverHeader, SectionTitle } from '../components/DriverHeader';
import { UPDATE_META, type AnyCategory } from '../updateMeta';

interface Row {
  id: string;
  category: AnyCategory;
  amount: number;
  title: string;
  sub: string;
  date: string;
  createdAt: string;
  sync: SyncStatus;
  status?: Expense['status'];
  receipt: FileRef | null;
  litres?: number;
  fuelType?: string;
}

export function Updates() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const driver = useCurrentDriver();
  const fuel = useApp((s) => s.fuel);
  const expenses = useApp((s) => s.expenses);
  const payments = useApp((s) => s.payments);
  const [type, setType] = useState<UpdateType | null>(null);
  const [open, setOpen] = useState<Row | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [
      ...fuel
        .filter((f: FuelEntry) => f.driverId === driver.id)
        .map((f) => ({
          id: f.id, category: 'fuel' as const, amount: f.amount, title: t(`enum.fuelType.${f.fuelType}`), sub: f.station, date: f.date, createdAt: f.createdAt,
          sync: f.sync, receipt: f.receipt, litres: f.litres, fuelType: f.fuelType,
        })),
      ...expenses
        .filter((e: Expense) => e.driverId === driver.id && e.enteredBy === 'driver')
        .map((e) => ({ id: e.id, category: e.category, amount: e.amount, title: t(`enum.category.${e.category}`), sub: e.note, date: e.date, createdAt: e.createdAt, sync: e.sync, status: e.status, receipt: e.receipt })),
      ...payments
        .filter((p: Payment) => p.driverId === driver.id && p.reportedByDriver)
        .map((p) => ({ id: p.id, category: 'advance' as const, amount: p.amount, title: t('enum.category.advance'), sub: p.note, date: p.createdAt.slice(0, 10), createdAt: p.createdAt, sync: p.sync, receipt: null })),
    ];
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
  }, [fuel, expenses, payments, driver.id, t]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  const dayLabel = (d: string) => (d === todayISO() ? t('common.today') : d === addDays(todayISO(), -1) ? t('common.yesterday') : fmtDate(d, i18n.language, { weekday: 'long', day: 'numeric', month: 'short' }));

  return (
    <div>
      <DriverHeader title={t('driver.updates.title')} />
      <div className="space-y-6 px-4 py-5">
        <section>
          <SectionTitle>{t('driver.updates.addTitle')}</SectionTitle>
          <button onClick={() => navigate('/driver/fuel/new')} className="mb-2.5 flex h-[72px] w-full items-center gap-3 rounded-xl bg-primary px-4 text-left text-white" data-testid="updates-add-fuel">
            <span className="flex size-11 items-center justify-center rounded-xl bg-plate text-[#1a1a1a]">
              <Fuel className="size-6" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-1 text-lg font-extrabold uppercase">
                <Plus className="size-5" strokeWidth={3} />
                {t('driver.home.addFuel')}
              </span>
              <span className="text-sm text-white/70">{t('driver.updates.fuelPrimary')}</span>
            </span>
            <ChevronRight className="size-5 text-white/60" />
          </button>
          <div className="grid grid-cols-4 gap-2">
            {UPDATE_TYPES.map((ut) => {
              const meta = UPDATE_META[ut];
              const Icon = meta.icon;
              return (
                <button key={ut} onClick={() => setType(ut)} className="panel flex h-[84px] flex-col items-center justify-center gap-1.5 px-1 hover:bg-accent" data-testid={`updates-tile-${ut}`}>
                  <span className={cn('flex size-10 items-center justify-center rounded-lg', meta.tint)}>
                    <Icon className="size-5" />
                  </span>
                  <span className="max-w-full truncate px-0.5 text-xs font-semibold">{t(`enum.categoryShort.${ut}`)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle>{t('driver.updates.history')}</SectionTitle>
          {groups.length === 0 ? (
            <div className="panel">
              <EmptyState icon={ClipboardList} title={t('driver.updates.empty')} hint={t('driver.updates.emptyHint')} />
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([date, items]) => (
                <div key={date}>
                  <p className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">{dayLabel(date)}</p>
                  <ul className="panel divide-y overflow-hidden">
                    {items.map((r) => {
                      const meta = UPDATE_META[r.category];
                      const Icon = meta.icon;
                      return (
                        <li key={r.id}>
                          <button onClick={() => setOpen(r)} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/60" data-testid="update-row">
                            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', meta.tint)}>
                              <Icon className="size-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">
                                {r.category === 'fuel' ? `${t('enum.category.fuel')} · ${r.title}` : r.title}
                              </span>
                              <span className="block truncate text-sm text-muted-foreground">
                                {r.category === 'fuel' ? t('units.litresShort', { value: num(r.litres ?? 0) }) + ' · ' : ''}
                                {r.sub || fmtTime(r.createdAt, i18n.language)}
                              </span>
                            </span>
                            <span className="flex flex-col items-end gap-1">
                              <span className="figure font-bold">{inr(r.amount)}</span>
                              <RowStatus row={r} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <AddUpdateSheet type={type} onClose={() => setType(null)} />
      <UpdateDetail row={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function RowStatus({ row }: { row: Row }) {
  const { t } = useTranslation();
  if (row.sync === 'pending')
    return (
      <Badge tone="warning">
        <CloudOff />
        {t('enum.sync.pending')}
      </Badge>
    );
  if (row.status === 'approved') return <Badge tone="success">{t('enum.expenseStatus.approved')}</Badge>;
  if (row.status === 'rejected') return <Badge tone="danger">{t('enum.expenseStatus.rejected')}</Badge>;
  if (row.status === 'submitted') return <Badge tone="neutral">{t('enum.expenseStatus.submitted')}</Badge>;
  return null;
}

function UpdateDetail({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  if (!row) return null;
  const meta = UPDATE_META[row.category];
  const Icon = meta.icon;
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-[440px]">
        <div className="overflow-y-auto px-5 pb-7 pt-3">
          <div className="flex items-center gap-3">
            <span className={cn('flex size-11 items-center justify-center rounded-xl', meta.tint)}>
              <Icon className="size-6" />
            </span>
            <SheetTitle>{row.category === 'fuel' ? `${t('enum.category.fuel')} · ${row.title}` : row.title}</SheetTitle>
          </div>
          <p className="figure mt-5 text-4xl font-extrabold">{inr(row.amount)}</p>
          {row.litres !== undefined && <p className="figure mt-1 text-lg font-semibold text-muted-foreground">{t('units.litres', { value: num(row.litres, 2) })}</p>}
          <dl className="mt-5 divide-y rounded-lg border text-[15px]">
            {row.sub && (
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-muted-foreground">{row.category === 'fuel' ? t('driver.fuel.station') : t('common.note')}</dt>
                <dd className="text-right font-semibold">{row.sub}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-muted-foreground">{t('common.date')}</dt>
              <dd className="text-right font-semibold">{fmtDate(row.date, i18n.language)}, {fmtTime(row.createdAt, i18n.language)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted-foreground">{t('common.status')}</dt>
              <dd>
                <RowStatus row={row} />
                {row.sync === 'synced' && !row.status && <Badge tone="success">{t('enum.sync.synced')}</Badge>}
              </dd>
            </div>
          </dl>
          {row.receipt && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium">{t('driver.receipt.view')}</p>
              <FileView file={row.receipt} alt={t('driver.receipt.preview')} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
