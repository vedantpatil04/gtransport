import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, Languages, MoreHorizontal, Power, Truck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Plate } from '@/components/Plate';
import { MotionLabel } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuCheckItem } from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/input';
import { positionFor } from '@/data/geo';
import { AddDriverDialog, AssignVehicleDialog } from '@/features/drivers/DriverDialogs';
import { useNow } from '@/hooks/useNow';
import { LANGUAGES, nativeName } from '@/i18n';
import { monthKey, todayISO } from '@/lib/dates';
import { inr } from '@/lib/format';
import { normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import type { Driver, Lang } from '@/types';
import { DriverCell, FilterBar, PageHeader, Panel, SearchInput, Table, TD, TH, TR } from '../components/ui';
import { useSyncedData } from '../useAdminData';

export function DriversPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const { fuel } = useSyncedData();
  const now = useNow(15_000);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [lang, setLang] = useState('');
  const [add, setAdd] = useState(false);
  const [assignFor, setAssignFor] = useState<Driver | null>(null);

  const month = monthKey(todayISO());
  const rows = useMemo(() => {
    const nq = normalize(q);
    return drivers
      .filter((d) => !status || d.status === status)
      .filter((d) => !lang || d.language === lang)
      .filter((d) => !nq || normalize(`${d.name} ${d.code} ${d.homeTown} ${vehicles.find((v) => v.id === d.vehicleId)?.reg ?? ''}`).includes(nq));
  }, [drivers, vehicles, q, status, lang]);

  return (
    <div>
      <PageHeader
        title={t('admin.drivers.title')}
        description={t('admin.drivers.subtitle', { active: drivers.filter((d) => d.status === 'active').length, total: drivers.length })}
        actions={
          <Button onClick={() => setAdd(true)}>
            <UserPlus />
            {t('admin.drivers.add')}
          </Button>
        }
      />
      <Panel>
        <FilterBar active={Boolean(q || status || lang)} onClear={() => { setQ(''); setStatus(''); setLang(''); }}>
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.drivers.search')} className="w-full sm:w-72" />
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[130px]" aria-label={t('admin.common.status')}>
            <option value="">{t('admin.drivers.allStatus')}</option>
            <option value="active">{t('enum.driverStatus.active')}</option>
            <option value="inactive">{t('enum.driverStatus.inactive')}</option>
          </NativeSelect>
          <NativeSelect value={lang} onChange={(e) => setLang(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.drivers.language')}>
            <option value="">{t('admin.drivers.allLanguages')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.common.driver')}</TH>
              <TH>{t('admin.drivers.phone')}</TH>
              <TH>{t('admin.common.vehicle')}</TH>
              <TH>{t('admin.drivers.location')}</TH>
              <TH>{t('admin.drivers.language')}</TH>
              <TH className="text-right">{t('admin.drivers.fuelMonth')}</TH>
              <TH>{t('admin.common.status')}</TH>
              <TH className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const v = vehicles.find((x) => x.id === d.vehicleId);
              const pos = positionFor(d, now);
              const motion = v ? pos.motion : 'none';
              return (
                <TR key={d.id} onClick={() => navigate(`/admin/drivers/${d.id}`)} data-testid="driver-row">
                  <TD className="min-w-[200px]">
                    <DriverCell driver={d} sub={`${d.code} · ${d.homeTown}`} link={false} />
                  </TD>
                  <TD className="figure whitespace-nowrap text-muted-foreground">{d.phone}</TD>
                  <TD>{v ? <Plate reg={v.reg} size="xs" /> : <span className="text-sm text-muted-foreground">{t('admin.drivers.noVehicle')}</span>}</TD>
                  <TD className="whitespace-nowrap">
                    <MotionLabel motion={motion} className="text-sm" />
                  </TD>
                  <TD>
                    <span lang={d.language}>{nativeName(d.language)}</span>
                  </TD>
                  <TD className="figure text-right font-medium">{inr(sum(fuel.filter((f) => f.driverId === d.id && monthKey(f.date) === month), (f) => f.amount))}</TD>
                  <TD>
                    <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{t(`enum.driverStatus.${d.status}`)}</Badge>
                  </TD>
                  <TD>
                    <DriverMenu driver={d} onAssign={() => setAssignFor(d)} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
      </Panel>
      <AddDriverDialog open={add} onOpenChange={setAdd} onCreated={(d) => navigate(`/admin/drivers/${d.id}`)} />
      <AssignVehicleDialog driver={assignFor} onOpenChange={(v) => !v && setAssignFor(null)} />
    </div>
  );
}

export function DriverMenu({ driver, onAssign, triggerVariant = 'icon' }: { driver: Driver; onAssign: () => void; triggerVariant?: 'icon' | 'button' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setLanguage = (l: Lang) => {
    useApp.getState().updateDriver(driver.id, { language: l });
    toast.success(t('admin.drivers.languageSet', { name: driver.name, lang: nativeName(l) }));
  };
  const toggle = () => {
    const next = driver.status === 'active' ? 'inactive' : 'active';
    useApp.getState().updateDriver(driver.id, { status: next });
    toast.success(t(next === 'active' ? 'admin.drivers.activated' : 'admin.drivers.deactivated', { name: driver.name }));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {triggerVariant === 'icon' ? (
          <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()} aria-label={t('admin.common.actions')}>
            <MoreHorizontal />
          </Button>
        ) : (
          <Button variant="outline">
            <MoreHorizontal />
            {t('admin.common.actions')}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="w-56">
        <DropdownMenuItem onSelect={() => navigate(`/admin/drivers/${driver.id}`)}>
          <Eye />
          {t('admin.drivers.view')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAssign}>
          <Truck />
          {t('admin.drivers.assignVehicle')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="driver-language-menu">
            <Languages />
            {t('admin.drivers.changeLanguage')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>{t('admin.drivers.appLanguage')}</DropdownMenuLabel>
            {LANGUAGES.map((l) => (
              <DropdownMenuCheckItem key={l.code} checked={driver.language === l.code} onSelect={() => setLanguage(l.code)} data-testid={`driver-lang-${l.code}`}>
                <span lang={l.code}>{l.native}</span>
                <span className="ml-auto text-xs text-muted-foreground">{l.english}</span>
              </DropdownMenuCheckItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive={driver.status === 'active'} onSelect={toggle}>
          <Power />
          {driver.status === 'active' ? t('admin.drivers.deactivate') : t('admin.drivers.activate')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
