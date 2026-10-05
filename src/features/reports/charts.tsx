import type * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, inrCompact, num } from '@/lib/format';
import { cn, sum } from '@/lib/utils';
import { Panel } from '@/features/admin/components/ui';

/**
 * Report charts, shared by the live reports and the demo Reports page so both read alike.
 * Every chart plots a figure the API computed; none derives its own totals.
 */

export const C = (i: number) => `hsl(var(--chart-${i}))`;
export const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--popover-foreground))' };
export const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false } as const;

export function ChartPanel({ title, sub, children, className, height = 'h-72', action }: { title: string; sub?: React.ReactNode; children: React.ReactNode; className?: string; height?: string; action?: React.ReactNode }) {
  return (
    <Panel className={className} action={action} title={<span>{title} {sub && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{sub}</span>}</span>}>
      <div className={cn('px-3 pb-3 pt-4', height)}>{children}</div>
    </Panel>
  );
}

/** Horizontal bars, largest first. `onSelect` makes a bar a drill-down into its records. */
export function HBar({ data, color, onSelect, format = inr }: { data: { id?: string | null; name: string; value: number }[]; color: string; onSelect?: (id: string) => void; format?: (n: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickFormatter={format === inr ? inrCompact : (v: number) => num(v, 0)} {...axis} />
        <YAxis type="category" dataKey="name" {...axis} width={128} interval={0} tick={{ fill: 'hsl(var(--foreground))', fontSize: 11, width: 200 }} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [format(v), '']} separator="" />
        <Bar
          dataKey="value"
          fill={color}
          radius={[0, 3, 3, 0]}
          barSize={16}
          cursor={onSelect ? 'pointer' : undefined}
          onClick={onSelect ? (entry: { id?: string | null }) => entry.id && onSelect(entry.id) : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, center, centerLabel, onSelect, format = inr }: { data: { key: string; name: string; value: number; color: string; extra?: string }[]; center: string; centerLabel: string; onSelect?: (key: string) => void; format?: (n: number) => string }) {
  const total = sum(data, (d) => d.value);
  return (
    <div className="flex h-full items-center gap-4">
      <div className="relative h-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={1.5} stroke="none" cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (entry: { key?: string }) => entry.key && onSelect(entry.key) : undefined}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [format(v), n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="figure text-base font-bold">{center}</span>
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="scroll-thin max-h-full w-[46%] space-y-1.5 overflow-y-auto text-sm">
        {data.map((d) => (
          <li key={d.key} className="flex items-start gap-2">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 leading-tight">
              {onSelect ? (
                <button type="button" onClick={() => onSelect(d.key)} className="block max-w-full truncate text-left hover:underline">
                  {d.name}
                </button>
              ) : (
                <span className="block truncate">{d.name}</span>
              )}
              <span className="figure block text-xs text-muted-foreground">
                {format(d.value)} · {total ? num((d.value / total) * 100, 0) : 0}%{d.extra ? ` · ${d.extra}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

/** Stacked bars over the report's own buckets (days or months). */
export function StackedTrend({ data, series, labelFor, format = inr }: { data: Record<string, string | number>[]; series: Series[]; labelFor: (bucket: string) => string; format?: (n: number) => string }) {
  const rows = data.map((d) => ({ ...Object.fromEntries(series.map((s) => [s.key, Number(d[s.key] ?? 0)])), label: labelFor(String(d.bucket)) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickFormatter={format === inr ? inrCompact : (v: number) => num(v, 0)} {...axis} width={56} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, key: string) => [format(v), series.find((s) => s.key === key)?.label ?? key]} />
        {series.length > 1 && <Legend formatter={(key: string) => <span className="text-xs text-foreground">{series.find((s) => s.key === key)?.label ?? key}</span>} iconSize={10} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={i === series.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Overlapping areas, for two measures that are not parts of one total (inflow and outflow). */
export function AreaTrend({ data, series, labelFor, format = inr }: { data: Record<string, string | number>[]; series: Series[]; labelFor: (bucket: string) => string; format?: (n: number) => string }) {
  const rows = data.map((d) => ({ ...Object.fromEntries(series.map((s) => [s.key, Number(d[s.key] ?? 0)])), label: labelFor(String(d.bucket)) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickFormatter={format === inr ? inrCompact : (v: number) => num(v, 0)} {...axis} width={56} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, key: string) => [format(v), series.find((s) => s.key === key)?.label ?? key]} />
        <Legend formatter={(key: string) => <span className="text-xs text-foreground">{series.find((s) => s.key === key)?.label ?? key}</span>} iconSize={10} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
