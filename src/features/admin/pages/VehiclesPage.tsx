import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Droplets, Fuel, Gauge, Plus, ReceiptIndianRupee, Truck, Upload, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { Plate } from '@/components/Plate';
import { ExpiryChip, MotionLabel, VerificationChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { DOC_TYPES } from '@/data/constants';
import { positionFor } from '@/data/geo';
import { DocUploadForm, type DocTarget } from '@/features/documents/DocUploadForm';
import { docStatus } from '@/features/documents/expiry';
import { FuelEntrySheet } from '@/features/fuel/FuelEntrySheet';
import { AddVehicleDialog, AssignDriverDialog } from '@/features/vehicles/VehicleDialogs';
import { useNow } from '@/hooks/useNow';
import { monthKey, todayISO } from '@/lib/dates';
import { fmtDate, inr, num } from '@/lib/format';
import { vehicleMonthTotals } from '@/lib/selectors';
import { normalize } from '@/lib/utils';
import { useApp } from '@/store';
import type { DocRecord, VehicleStatus } from '@/types';
import { DetailList, DriverCell, FilterBar, PageHeader, Panel, SearchInput, StatCard, Table, TD, TH, TR } from '../components/ui';
import { useSyncedData } from '../useAdminData';

const STATUS_TONE: Record<VehicleStatus, 'success' | 'warning' | 'neutral'> = { active: 'success', maintenance: 'warning', idle: 'neutral' };

function worstDoc(docs: DocRecord[]) {
  return [...docs].sort((a, b) => docStatus(b).level - docStatus(a).level || (docStatus(a).days ?? 9999) - (docStatus(b).days ?? 9999))[0];
}

export function VehiclesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const vehicles = useApp((s) => s.vehicles);
  const drivers = useApp((s) => s.drivers);
  const documents = useApp((s) => s.documents);
  const { fuel, expenses } = useSyncedData();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [add, setAdd] = useState(false);
  const month = monthKey(todayISO());

  const rows = useMemo(() => {
    const nq = normalize(q);
    return vehicles
      .filter((v) => !status || v.status === status)
      .filter((v) => !fuelType || v.fuelType === fuelType)
      .filter((v) => !nq || normalize(`${v.reg} ${v.model} ${drivers.find((d) => d.id === v.driverId)?.name ?? ''}`).includes(nq));
  }, [vehicles, drivers, q, status, fuelType]);

  return (
    <div>
      <PageHeader
        title={t('admin.vehicles.title')}
        description={t('admin.vehicles.subtitle', { total: vehicles.length, active: vehicles.filter((v) => v.status === 'active').length })}
        actions={
          <Button onClick={() => setAdd(true)}>
            <Plus />
            {t('admin.vehicles.add')}
          </Button>
        }
      />
      <Panel>
        <FilterBar active={Boolean(q || status || fuelType)} onClear={() => { setQ(''); setStatus(''); setFuelType(''); }}>
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.vehicles.search')} className="w-full sm:w-72" />
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.status')}>
            <option value="">{t('admin.vehicles.allStatus')}</option>
            {(['active', 'maintenance', 'idle'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`enum.vehicleStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={fuelType} onChange={(e) => setFuelType(e.target.value)} className="w-auto min-w-[120px]" aria-label={t('admin.fuel.type')}>
            <option value="">{t('admin.fuel.allTypes')}</option>
            <option value="petrol">{t('enum.fuelType.petrol')}</option>
            <option value="diesel">{t('enum.fuelType.diesel')}</option>
          </NativeSelect>
        </FilterBar>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.common.vehicle')}</TH>
              <TH>{t('admin.vehicles.kind')}</TH>
              <TH>{t('admin.common.driver')}</TH>
              <TH>{t('admin.common.status')}</TH>
              <TH className="text-right">{t('admin.drivers.fuelMonth')}</TH>
              <TH>{t('admin.vehicles.documents')}</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const totals = vehicleMonthTotals(v.id, month, fuel, expenses);
              const worst = worstDoc(documents.filter((d) => d.ownerType === 'vehicle' && d.ownerId === v.id));
              return (
                <TR key={v.id} onClick={() => navigate(`/admin/vehicles/${v.id}`)} data-testid="vehicle-row">
                  <TD className="min-w-[220px]">
                    <div className="flex items-center gap-3">
                      <Plate reg={v.reg} size="sm" />
                      <span className="truncate text-sm text-muted-foreground">{v.model}</span>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {t(`enum.vehicleKind.${v.kind}`)} · <span className="text-muted-foreground">{t(`enum.fuelType.${v.fuelType}`)}</span>
                  </TD>
                  <TD className="min-w-[160px]">{v.driverId ? <DriverCell driver={drivers.find((d) => d.id === v.driverId)} /> : <span className="text-sm text-muted-foreground">{t('admin.vehicles.unassigned')}</span>}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[v.status]}>{t(`enum.vehicleStatus.${v.status}`)}</Badge>
                  </TD>
                  <TD className="figure text-right font-medium">{inr(totals.fuel)}</TD>
                  <TD className="whitespace-nowrap">{worst ? <ExpiryChip doc={worst} /> : '—'}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
      </Panel>
      <AddVehicleDialog open={add} onOpenChange={setAdd} onCreated={(v) => navigate(`/admin/vehicles/${v.id}`)} />
    </div>
  );
}

export function VehicleDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const vehicle = useApp((s) => s.vehicles.find((v) => v.id === id));
  const drivers = useApp((s) => s.drivers);
  const documents = useApp((s) => s.documents);
  const { fuel, expenses } = useSyncedData();
  const now = useNow(15_000);
  const [assign, setAssign] = useState(false);
  const [upload, setUpload] = useState<DocTarget | null>(null);

  if (!vehicle)
    return (
      <div>
        <PageHeader title={t('admin.vehicles.title')} back={{ to: '/admin/vehicles', label: t('admin.vehicles.title') }} />
        <EmptyState icon={Truck} title={t('admin.vehicles.notFound')} />
      </div>
    );

  const driver = drivers.find((d) => d.id === vehicle.driverId);
  const totals = vehicleMonthTotals(vehicle.id, monthKey(todayISO()), fuel, expenses);
  const myFuel = fuel.filter((f) => f.vehicleId === vehicle.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docs = documents.filter((d) => d.ownerType === 'vehicle' && d.ownerId === vehicle.id);
  const missing = DOC_TYPES.filter((d) => d.owner === 'vehicle' && !docs.some((x) => x.type === d.type));
  const pos = driver ? positionFor(driver, now) : null;

  const setStatus = (s: VehicleStatus) => {
    useApp.getState().updateVehicle(vehicle.id, { status: s });
    toast.success(t('admin.vehicles.statusSet', { reg: vehicle.reg, status: t(`enum.vehicleStatus.${s}`) }));
  };

  return (
    <div>
      <PageHeader
        back={{ to: '/admin/vehicles', label: t('admin.vehicles.title') }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate reg={vehicle.reg} size="lg" />
            <span className="text-lg font-semibold text-muted-foreground">{vehicle.model}</span>
          </span>
        }
        actions={
          <>
            <NativeSelect value={vehicle.status} onChange={(e) => setStatus(e.target.value as VehicleStatus)} className="w-auto" aria-label={t('admin.common.status')}>
              {(['active', 'maintenance', 'idle'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`enum.vehicleStatus.${s}`)}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={() => setAssign(true)}>
              <UserRound />
              {t('admin.vehicles.assignDriver')}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('admin.drivers.fuelMonth')} value={inr(totals.fuel)} icon={Fuel} sub={t('admin.dashboard.fuelUpdates', { count: totals.fuelCount })} />
        <StatCard label={t('admin.vehicles.litresMonth')} value={num(totals.litres, 0)} icon={Droplets} sub={totals.litres ? `${inr(totals.fuel / totals.litres, true)} / L` : undefined} />
        <StatCard label={t('admin.drivers.expensesMonth')} value={inr(totals.other)} icon={ReceiptIndianRupee} />
        <StatCard label={t('admin.vehicles.mileage')} value={`${num(vehicle.mileageKmpl, 1)}`} icon={Gauge} sub="km/L" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <Panel title={t('admin.vehicles.details')} bodyClass="p-4">
            <DetailList
              rows={[
                [t('admin.vehicles.kind'), t(`enum.vehicleKind.${vehicle.kind}`)],
                [t('admin.fuel.type'), t(`enum.fuelType.${vehicle.fuelType}`)],
                [t('admin.vehicles.capacity'), `${num(vehicle.capacityT, 1)} t`],
                [t('admin.vehicles.year'), vehicle.year],
                [t('admin.common.status'), <Badge tone={STATUS_TONE[vehicle.status]}>{t(`enum.vehicleStatus.${vehicle.status}`)}</Badge>],
                [t('admin.common.driver'), driver ? <DriverCell driver={driver} /> : t('admin.vehicles.unassigned')],
                [t('admin.drivers.location'), pos ? <MotionLabel motion={pos.motion} /> : '—'],
              ]}
            />
            {driver && pos && pos.motion !== 'none' && (
              <Link to={`/admin/fleet?driver=${driver.id}`} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
                {t('admin.fleet.near', { city: t(`city.${pos.near}`) })} · {t('admin.dashboard.openMap')}
              </Link>
            )}
          </Panel>
          <Panel title={t('admin.vehicles.documents')}>
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <Link to={`/admin/documents?doc=${d.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block text-sm font-medium">{t(`enum.docTypeLong.${d.type}`)}</span>
                    <span className="block text-xs text-muted-foreground">{d.number}</span>
                  </Link>
                  <VerificationChip value={d.verification} />
                  <ExpiryChip doc={d} />
                  <Button variant="ghost" size="icon-sm" onClick={() => setUpload({ ownerType: 'vehicle', ownerId: vehicle.id, type: d.type, existing: d })} aria-label={t('common.replace')}>
                    <Upload />
                  </Button>
                </li>
              ))}
              {missing.map((m) => (
                <li key={m.type} className="flex items-center gap-2 px-4 py-3">
                  <span className="flex-1 text-sm text-muted-foreground">{t(`enum.docTypeLong.${m.type}`)}</span>
                  <Button variant="outline" size="sm" onClick={() => setUpload({ ownerType: 'vehicle', ownerId: vehicle.id, type: m.type })}>
                    <Upload />
                    {t('common.upload')}
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title={t('admin.vehicles.recentFuel')}>
          <Table>
            <thead>
              <tr>
                <TH>{t('admin.common.date')}</TH>
                <TH>{t('admin.common.driver')}</TH>
                <TH className="text-right">{t('admin.common.amount')}</TH>
                <TH className="text-right">{t('admin.fuel.litres')}</TH>
                <TH>{t('admin.fuel.station')}</TH>
              </tr>
            </thead>
            <tbody>
              {myFuel.slice(0, 15).map((f) => (
                <TR key={f.id} onClick={() => setParams({ entry: f.id }, { replace: true })}>
                  <TD className="whitespace-nowrap">{fmtDate(f.date, i18n.language)}</TD>
                  <TD>{drivers.find((d) => d.id === f.driverId)?.name}</TD>
                  <TD className="figure text-right font-semibold">{inr(f.amount)}</TD>
                  <TD className="figure text-right">{num(f.litres, 2)}</TD>
                  <TD className="max-w-[200px] truncate text-muted-foreground">{f.station}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {myFuel.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
          {myFuel.length > 15 && (
            <div className="border-t px-4 py-2.5 text-right">
              <Link to={`/admin/fuel?vehicle=${vehicle.id}`} className="text-sm font-semibold text-primary hover:underline">
                {t('admin.search.viewAll', { count: myFuel.length })}
              </Link>
            </div>
          )}
        </Panel>
      </div>
      {assign && <AssignDriverDialog vehicle={vehicle} onOpenChange={(v) => !v && setAssign(false)} />}
      <UploadDocDialog target={upload} onClose={() => setUpload(null)} />
      <FuelEntrySheet entryId={params.get('entry')} onClose={() => setParams({}, { replace: true })} />
    </div>
  );
}

export function UploadDocDialog({ target, onClose }: { target: DocTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target?.existing ? t('admin.documents.replaceTitle', { doc: t(`enum.docTypeLong.${target.type}`) }) : t('admin.documents.uploadTitle', { doc: target ? t(`enum.docTypeLong.${target.type}`) : '' })}</DialogTitle>
        </DialogHeader>
        {target && (
          <DocUploadForm
            target={target}
            variant="admin"
            onDone={() => {
              toast.success(t('admin.documents.uploaded'));
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
