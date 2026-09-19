import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { BORDERS, CITIES, CITY_IDS, COASTLINE, HIGHWAYS, MAP_BOUNDS, REGION_LABELS, project, toLatLng } from '@/data/geo';
import { MOTION_HEX } from '@/components/status';
import { cn } from '@/lib/utils';
import type { FleetItem } from './useFleet';

interface View {
  x: number;
  y: number;
  w: number;
}

const MAJOR_CITIES = new Set(['pune', 'kolhapur', 'belagavi', 'hubballi', 'panaji', 'bengaluru', 'davanagere', 'vijayapura', 'solapur', 'ballari']);
const pt = (lat: number, lng: number) => project(lat, lng);
const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/**
 * Hand-built vector map of the fleet's operating region (Maharashtra–Karnataka–Goa),
 * drawn from real coordinates. No map API needed; positions come from the simulation.
 */
export function FleetMap({ items, selectedId, onSelect, className }: { items: FleetItem[]; selectedId: string | null; onSelect: (id: string | null) => void; className?: string }) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(200, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.h / size.w;
  const fit = useCallback(
    (focus?: FleetItem[]) => {
      const pts = (focus?.length ? focus : items).filter((i) => i.pos.motion !== 'none' || focus).map((i) => pt(i.pos.lat, i.pos.lng));
      if (!pts.length) return setView({ x: 150, y: 80, w: 420 });
      let minX = Math.min(...pts.map((p) => p.x));
      let maxX = Math.max(...pts.map((p) => p.x));
      let minY = Math.min(...pts.map((p) => p.y));
      let maxY = Math.max(...pts.map((p) => p.y));
      const pad = focus?.length === 1 ? 60 : 36;
      minX -= pad;
      maxX += pad;
      minY -= pad;
      maxY += pad;
      const w = Math.max(maxX - minX, (maxY - minY) / aspect, 90);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setView({ x: cx - w / 2, y: cy - (w * aspect) / 2, w });
    },
    [items, aspect],
  );

  // First fit once the container size is known.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 200) {
      fitted.current = true;
      fit();
    }
  }, [size.w, fit]);

  // Centre on a newly selected vehicle if it is off-screen.
  useEffect(() => {
    if (!selectedId || !view) return;
    const it = items.find((i) => i.driver.id === selectedId);
    if (!it) return;
    const p = pt(it.pos.lat, it.pos.lng);
    const h = view.w * aspect;
    const inside = p.x > view.x + view.w * 0.1 && p.x < view.x + view.w * 0.6 && p.y > view.y + h * 0.1 && p.y < view.y + h * 0.9;
    if (!inside) setView((v) => (v ? { ...v, x: p.x - v.w * 0.35, y: p.y - (v.w * aspect) / 2 } : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const v = view ?? { x: 150, y: 80, w: 420 };
  const vh = v.w * aspect;
  const upp = v.w / size.w; // map units per screen pixel

  const zoom = (factor: number, cx = v.x + v.w / 2, cy = v.y + vh / 2) => {
    const w = Math.min(MAP_BOUNDS.maxX, Math.max(40, v.w * factor));
    const k = w / v.w;
    setView({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w });
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrap.current!.getBoundingClientRect();
    const cx = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
    const cy = v.y + ((e.clientY - rect.top) / rect.height) * vh;
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
  };

  const static_ = useMemo(() => {
    const coast = COASTLINE.map(([la, ln]) => pt(la, ln));
    const sea = `${path(coast)} L${-50} ${coast[coast.length - 1].y} L${-50} ${coast[0].y} Z`;
    return {
      sea,
      coast: path(coast),
      borders: BORDERS.map((b) => path(b.map(([la, ln]) => pt(la, ln)))),
      roads: HIGHWAYS.map((h) => {
        const pts = h.path.map((p) => {
          const ll = toLatLng(p);
          return pt(ll.lat, ll.lng);
        });
        // Label sits ~40% along the road so it does not cover the cities at the joints.
        const segs = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
        let left = segs.reduce((a, b) => a + b, 0) * 0.4;
        let mid = pts[0];
        for (let i = 0; i < segs.length; i++) {
          if (left <= segs[i]) {
            const k = segs[i] ? left / segs[i] : 0;
            mid = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
            break;
          }
          left -= segs[i];
        }
        return { id: h.id, label: h.label, major: h.major, d: path(pts), mid };
      }),
    };
  }, []);

  const fs = 12 * upp; // label font size in map units
  const selected = items.find((i) => i.driver.id === selectedId);

  return (
    <div ref={wrap} className={cn('relative select-none overflow-hidden bg-map-sea', className)} data-testid="fleet-map">
      <svg
        viewBox={`${v.x} ${v.y} ${v.w} ${vh}`}
        className={cn('size-full touch-none', drag.current ? 'cursor-grabbing' : 'cursor-grab')}
        onWheel={onWheel}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view: v, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = (e.clientX - d.x) * upp;
          const dy = (e.clientY - d.y) * upp;
          if (Math.abs(dx) + Math.abs(dy) > 2 * upp) d.moved = true;
          setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const id = (e.target as Element).closest('[data-driver]')?.getAttribute('data-driver');
            onSelect(id ?? null);
          }
        }}
        role="application"
        aria-label={t('map.label')}
      >
        <rect x={-100} y={-100} width={MAP_BOUNDS.maxX + 200} height={MAP_BOUNDS.maxY + 200} className="fill-map-land" />
        <path d={static_.sea} className="fill-map-sea" />
        <path d={static_.coast} fill="none" className="stroke-map-border" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        {static_.borders.map((d, i) => (
          <path key={i} d={d} fill="none" className="stroke-map-border" strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" opacity={0.8} />
        ))}
        {REGION_LABELS.map((r) => {
          const p = pt(r.lat, r.lng);
          return (
            <text key={r.key} x={p.x} y={p.y} fontSize={fs * (r.key === 'sea' ? 1.05 : 1.15)} textAnchor="middle" className={cn('fill-muted-foreground/60 font-semibold uppercase', r.key === 'sea' && 'italic')} style={{ letterSpacing: `${0.25 * fs}px` }}>
              {t(`map.region.${r.key}`)}
            </text>
          );
        })}
        {static_.roads.map((r) => (
          <g key={r.id}>
            <path d={r.d} fill="none" stroke="hsl(var(--card))" strokeWidth={r.major ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={r.d} fill="none" className="stroke-map-road" strokeWidth={r.major ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={r.major ? 1 : 0.8} />
          </g>
        ))}
        {static_.roads
          .filter((r) => r.label)
          .map((r) => (
            <g key={`l-${r.id}`} transform={`translate(${r.mid.x} ${r.mid.y})`}>
              <rect x={-2.1 * fs} y={-0.62 * fs} width={4.2 * fs} height={1.24 * fs} rx={0.25 * fs} fill="#1f4a86" />
              <text fontSize={fs * 0.82} textAnchor="middle" dy={0.3 * fs} fill="#fff" fontWeight={700}>
                {r.label}
              </text>
            </g>
          ))}
        {CITY_IDS.map((id) => {
          const c = CITIES[id];
          const p = pt(c.lat, c.lng);
          const major = MAJOR_CITIES.has(id);
          if (!major && upp > 0.55) return null;
          return (
            <g key={id} pointerEvents="none">
              <circle cx={p.x} cy={p.y} r={(major ? 3.6 : 2.6) * upp} className="fill-card stroke-foreground/60" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <text x={p.x + 6 * upp} y={p.y - 5 * upp} fontSize={fs * (major ? 1 : 0.88)} className={cn('fill-foreground/75', major ? 'font-semibold' : 'font-medium')} paintOrder="stroke" stroke="hsl(var(--map-land))" strokeWidth={3 * upp}>
                {t(`city.${id}`)}
              </text>
            </g>
          );
        })}
        {items
          .filter((i) => i.pos.motion !== 'none')
          .sort((a, b) => Number(a.driver.id === selectedId) - Number(b.driver.id === selectedId))
          .map((it) => {
            const p = pt(it.pos.lat, it.pos.lng);
            const sel = it.driver.id === selectedId;
            const r = (sel ? 9 : 7) * upp;
            const color = MOTION_HEX[it.pos.motion];
            return (
              <g key={it.driver.id} data-driver={it.driver.id} className="cursor-pointer" style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: 'transform 3s linear' }}>
                {sel && <circle r={r * 2.2} fill={color} opacity={0.18} className="origin-center animate-ring-pulse" style={{ transformBox: 'fill-box' }} />}
                {it.pos.motion === 'moving' && (
                  <path d={`M ${r * 1.9} 0 L ${r * 0.9} ${-r * 0.75} L ${r * 0.9} ${r * 0.75} Z`} fill={color} transform={`rotate(${it.pos.heading})`} />
                )}
                <circle r={r} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <circle r={r * 0.36} fill="#fff" />
                {(sel || upp < 0.28) && (
                  <g transform={`translate(${r + 4 * upp} ${-r - 2 * upp})`}>
                    <rect x={0} y={-1.05 * fs} width={(it.vehicle?.reg.length ?? 8) * 0.62 * fs + 0.8 * fs} height={1.45 * fs} rx={0.2 * fs} fill="hsl(var(--plate))" stroke="#1a1a1a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <text x={0.4 * fs} y={0} fontSize={fs * 0.95} fontWeight={800} fill="#111">
                      {it.vehicle?.reg}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
      </svg>

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <button onClick={() => zoom(1 / 1.4)} className="flex size-9 items-center justify-center hover:bg-accent" aria-label={t('map.zoomIn')}>
          <Plus className="size-4" />
        </button>
        <button onClick={() => zoom(1.4)} className="flex size-9 items-center justify-center border-t hover:bg-accent" aria-label={t('map.zoomOut')}>
          <Minus className="size-4" />
        </button>
        <button onClick={() => fit(selected ? [selected] : undefined)} className="flex size-9 items-center justify-center border-t hover:bg-accent" aria-label={t('map.fit')} title={t('map.fit')}>
          <Crosshair className="size-4" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-card/90 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur">
        {(['moving', 'stopped', 'offline'] as const).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: MOTION_HEX[m] }} />
            {t(`enum.motion.${m}`)}
          </span>
        ))}
        <span className="text-muted-foreground">· {t('map.simulated')}</span>
      </div>
    </div>
  );
}
