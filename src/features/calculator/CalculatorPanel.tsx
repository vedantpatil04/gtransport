import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, Plus, ReceiptIndianRupee, RotateCcw, Route, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { monthKey, todayISO } from '@/lib/dates';
import { inr, num } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { cn, sum } from '@/lib/utils';
import { useApp } from '@/store';

type Mode = 'fuel' | 'trip' | 'salary' | 'expense';
const MODES: { key: Mode; icon: typeof Fuel }[] = [
  { key: 'fuel', icon: Fuel },
  { key: 'trip', icon: Route },
  { key: 'salary', icon: Wallet },
  { key: 'expense', icon: ReceiptIndianRupee },
];

const n = (v: string) => {
  const x = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(x) ? x : 0;
};

function Field({ id, label, value, onChange, prefix, suffix, testId }: { id: string; label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; testId?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex h-11 items-center rounded-lg border border-input bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25">
        {prefix && <span className="pl-3 text-sm font-semibold text-muted-foreground">{prefix}</span>}
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          className="figure h-full w-full min-w-0 bg-transparent px-3 text-[15px] font-semibold outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid={testId}
        />
        {suffix && <span className="shrink-0 pr-3 text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function Result({ items, formula }: { items: { label: string; value: string; big?: boolean; tone?: 'success' | 'danger' }[]; formula?: string }) {
  return (
    <div className="rounded-xl bg-primary p-4 text-primary-foreground" aria-live="polite" data-testid="calc-result">
      <div className="grid grid-cols-2 gap-4">
        {items.map((it) => (
          <div key={it.label} className={cn(it.big && 'col-span-2')}>
            <p className="text-xs text-white/65">{it.label}</p>
            <p className={cn('figure font-bold leading-tight', it.big ? 'text-3xl' : 'text-xl', it.tone === 'success' && 'text-[#7fe0a8]', it.tone === 'danger' && 'text-[#ff9b8f]')}>{it.value}</p>
          </div>
        ))}
      </div>
      {formula && <p className="figure mt-3 border-t border-white/10 pt-2.5 text-xs text-white/65">{formula}</p>}
    </div>
  );
}

function FuelCalc() {
  const { t } = useTranslation();
  const [v, setV] = useState({ km: '420', kmpl: '6', price: '95' });
  const litres = n(v.kmpl) > 0 ? n(v.km) / n(v.kmpl) : 0;
  const cost = litres * n(v.price);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Field id="f-km" label={t('admin.calc.distance')} value={v.km} onChange={(km) => setV({ ...v, km })} suffix="km" testId="calc-fuel-km" />
        <Field id="f-kmpl" label={t('admin.calc.mileage')} value={v.kmpl} onChange={(kmpl) => setV({ ...v, kmpl })} suffix="km/L" testId="calc-fuel-kmpl" />
        <Field id="f-price" label={t('admin.calc.price')} value={v.price} onChange={(price) => setV({ ...v, price })} prefix="₹" suffix="/L" testId="calc-fuel-price" />
      </div>
      <Result
        items={[
          { label: t('admin.calc.fuelNeeded'), value: t('units.litres', { value: num(litres, 1) }) },
          { label: t('admin.calc.fuelCost'), value: inr(cost) },
          { label: t('admin.calc.costPerKm'), value: n(v.km) ? inr(cost / n(v.km), true) : '—' },
        ]}
        formula={`${num(n(v.km), 1)} km ÷ ${num(n(v.kmpl), 2)} km/L = ${num(litres, 1)} L × ₹${num(n(v.price), 2)} = ${inr(cost)}`}
      />
      <Reset onClick={() => setV({ km: '', kmpl: '', price: '' })} />
    </div>
  );
}

function TripCalc() {
  const { t } = useTranslation();
  const [v, setV] = useState({ km: '380', kmpl: '5', price: '89', toll: '1450', allowance: '800', other: '300', freight: '14500' });
  const fuel = n(v.kmpl) > 0 ? (n(v.km) / n(v.kmpl)) * n(v.price) : 0;
  const total = fuel + n(v.toll) + n(v.allowance) + n(v.other);
  const profit = n(v.freight) - total;
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Field id="t-km" label={t('admin.calc.distance')} value={v.km} onChange={set('km')} suffix="km" />
        <Field id="t-kmpl" label={t('admin.calc.mileage')} value={v.kmpl} onChange={set('kmpl')} suffix="km/L" />
        <Field id="t-price" label={t('admin.calc.price')} value={v.price} onChange={set('price')} prefix="₹" />
        <Field id="t-toll" label={t('admin.calc.tolls')} value={v.toll} onChange={set('toll')} prefix="₹" />
        <Field id="t-allow" label={t('admin.calc.allowance')} value={v.allowance} onChange={set('allowance')} prefix="₹" />
        <Field id="t-other" label={t('admin.calc.otherCosts')} value={v.other} onChange={set('other')} prefix="₹" />
      </div>
      <Field id="t-freight" label={t('admin.calc.freight')} value={v.freight} onChange={set('freight')} prefix="₹" />
      <Result
        items={[
          { label: t('admin.calc.tripCost'), value: inr(total), big: true },
          { label: t('admin.calc.fuelCost'), value: inr(fuel) },
          { label: t('admin.calc.costPerKm'), value: n(v.km) ? inr(total / n(v.km), true) : '—' },
          ...(n(v.freight) ? [{ label: profit >= 0 ? t('admin.calc.profit') : t('admin.calc.loss'), value: inr(Math.abs(profit)), tone: (profit >= 0 ? 'success' : 'danger') as 'success' | 'danger' }, { label: t('admin.calc.margin'), value: `${num((profit / n(v.freight)) * 100, 1)}%` }] : []),
        ]}
        formula={`${inr(fuel)} + ${inr(n(v.toll))} + ${inr(n(v.allowance))} + ${inr(n(v.other))} = ${inr(total)}`}
      />
      <Reset onClick={() => setV({ km: '', kmpl: '', price: '', toll: '', allowance: '', other: '', freight: '' })} />
    </div>
  );
}

function SalaryCalc() {
  const { t } = useTranslation();
  const drivers = useApp((s) => s.drivers);
  const payments = useApp((s) => s.payments);
  const [driverId, setDriverId] = useState('');
  const [v, setV] = useState({ base: '20000', advance: '3000', deductions: '1200', bonus: '' });
  const net = n(v.base) - n(v.advance) - n(v.deductions) + n(v.bonus);
  const pick = (id: string) => {
    setDriverId(id);
    const d = drivers.find((x) => x.id === id);
    if (!d) return;
    const month = monthKey(todayISO());
    const adv = sum(payments.filter((p) => p.driverId === id && p.status === 'paid' && p.type !== 'salary' && p.type !== 'reimbursement' && monthKey(paymentDate(p)) === month), (p) => p.amount);
    setV({ base: String(d.baseSalary), advance: String(adv), deductions: '', bonus: '' });
  };
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="s-driver">{t('admin.calc.fillFromDriver')}</Label>
        <NativeSelect id="s-driver" value={driverId} onChange={(e) => pick(e.target.value)}>
          <option value="">{t('admin.calc.manual')}</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="s-base" label={t('admin.calc.baseSalary')} value={v.base} onChange={set('base')} prefix="₹" testId="calc-salary-base" />
        <Field id="s-adv" label={t('admin.calc.advances')} value={v.advance} onChange={set('advance')} prefix="− ₹" testId="calc-salary-advance" />
        <Field id="s-ded" label={t('admin.calc.deductions')} value={v.deductions} onChange={set('deductions')} prefix="− ₹" testId="calc-salary-deductions" />
        <Field id="s-bonus" label={t('admin.calc.bonus')} value={v.bonus} onChange={set('bonus')} prefix="+ ₹" />
      </div>
      <Result
        items={[{ label: t('admin.calc.netSalary'), value: inr(net), big: true, tone: net < 0 ? 'danger' : undefined }]}
        formula={`${inr(n(v.base))} − ${inr(n(v.advance))} − ${inr(n(v.deductions))}${n(v.bonus) ? ` + ${inr(n(v.bonus))}` : ''} = ${inr(net)}`}
      />
      <Reset onClick={() => { setDriverId(''); setV({ base: '', advance: '', deductions: '', bonus: '' }); }} />
    </div>
  );
}

function ExpenseCalc() {
  const { t } = useTranslation();
  const blank = () => ({ id: Math.random().toString(36).slice(2), label: '', amount: '' });
  const [rows, setRows] = useState([
    { id: 'a', label: t('enum.category.toll'), amount: '1450' },
    { id: 'b', label: t('enum.category.rto'), amount: '400' },
    { id: 'c', label: t('enum.category.tyre'), amount: '150' },
  ]);
  const total = useMemo(() => sum(rows, (r) => n(r.amount)), [rows]);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            {i === 0 && <Label>{t('admin.calc.item')}</Label>}
            <Input value={r.label} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))} placeholder={t('admin.calc.itemPlaceholder')} aria-label={t('admin.calc.item')} />
          </div>
          <div className="w-32 space-y-1.5">
            {i === 0 && <Label>{t('admin.common.amount')}</Label>}
            <Input inputMode="decimal" className="figure text-right" value={r.amount} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))} aria-label={t('admin.common.amount')} placeholder="₹0" />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} disabled={rows.length === 1} aria-label={t('common.remove')}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setRows([...rows, blank()])}>
        <Plus />
        {t('admin.calc.addItem')}
      </Button>
      <Result items={[{ label: t('admin.calc.totalExpense'), value: inr(total), big: true }, { label: t('admin.calc.items'), value: String(rows.filter((r) => n(r.amount) > 0).length) }, { label: t('admin.calc.average'), value: inr(rows.length ? total / Math.max(1, rows.filter((r) => n(r.amount) > 0).length) : 0) }]} />
      <Reset onClick={() => setRows([blank()])} />
    </div>
  );
}

function Reset({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="text-muted-foreground">
      <RotateCcw />
      {t('admin.calc.clear')}
    </Button>
  );
}

/** Four working calculators. `compact` is the header slide-over; the page shows it wider. */
export function CalculatorPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('fuel');
  return (
    <Tabs value={mode} onValueChange={(m) => setMode(m as Mode)}>
      <TabsList className={cn('grid w-full grid-cols-4', !compact && 'h-12')}>
        {MODES.map(({ key, icon: Icon }) => (
          <TabsTrigger key={key} value={key} className="gap-1.5" data-testid={`calc-mode-${key}`}>
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{t(`admin.calc.mode.${key}`)}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <p className="mb-4 mt-3 text-sm text-muted-foreground">{t(`admin.calc.hint.${mode}`)}</p>
      <TabsContent value="fuel">
        <FuelCalc />
      </TabsContent>
      <TabsContent value="trip">
        <TripCalc />
      </TabsContent>
      <TabsContent value="salary">
        <SalaryCalc />
      </TabsContent>
      <TabsContent value="expense">
        <ExpenseCalc />
      </TabsContent>
    </Tabs>
  );
}
