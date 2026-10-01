import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin, RefreshCw } from 'lucide-react';
import { MOTION_HEX } from '@/components/status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MapLibreMap } from './MapLibreMap';
import { isPlottable, resolveMapStyle, type MapMarker, type MapStatus } from './provider';

export interface FleetMapProps {
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  /** Shown in the legend. The prototype's positions are simulated; real fleet data is not. */
  simulated?: boolean;
  /**
   * True until the first fleet response has arrived. Until then an empty marker list means "not
   * here yet", and the map must not claim that nobody is reporting.
   */
  loading?: boolean;
  /** Pixels on the left edge covered by the driver panel; messages and selections stay clear of it. */
  focusInsetLeft?: number;
}

/**
 * The fleet map, and the honest states around it.
 *
 * It is a convenience, not the record: the list beside it answers every operational question. So a
 * map that cannot draw says exactly that — with a retry — and never stands in a drawing of the
 * region that merely looks live. Everything the office needs to act (the list, the details, the
 * coordinates, Open in Google Maps) lives outside this component and keeps working.
 */
export function FleetMap(props: FleetMapProps) {
  // Build-time configuration: it cannot change while the page is open.
  const config = useMemo(() => resolveMapStyle(), []);

  if (config.status !== 'ready') {
    return <MapConfigUnavailable reason={config.reason} className={props.className} inset={props.focusInsetLeft} />;
  }

  return (
    <MapBoundary className={props.className} inset={props.focusInsetLeft}>
      <LiveMap {...props} styleUrl={config.styleUrl} />
    </MapBoundary>
  );
}

function LiveMap({ styleUrl, markers, selectedId, onSelect, className, simulated = false, loading = false, focusInsetLeft = 0 }: FleetMapProps & { styleUrl: string }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<MapStatus>({ state: 'loading' });
  const anyPlottable = useMemo(() => markers.some(isPlottable), [markers]);

  // A new key is a new map: the one way to retry that cannot inherit whatever state broke the last.
  const retry = () => {
    setStatus({ state: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <MapLibreMap
      key={attempt}
      styleUrl={styleUrl}
      markers={markers}
      selectedId={selectedId}
      onSelect={onSelect}
      onStatusChange={setStatus}
      focusInsetLeft={focusInsetLeft}
      className={className}
    >
      {status.state !== 'error' && <Legend simulated={simulated} />}
      {status.state === 'loading' && (
        <Overlay inset={focusInsetLeft}>
          <div className="flex items-center gap-2 rounded-lg border bg-card/95 px-4 py-2.5 text-sm shadow-sm" role="status" data-testid="fleet-map-loading">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            {t('map.loading')}
          </div>
        </Overlay>
      )}
      {status.state === 'ready' && !loading && !anyPlottable && (
        <Overlay inset={focusInsetLeft}>
          <div className="flex items-center gap-2 rounded-lg border bg-card/95 px-4 py-2.5 text-sm shadow-sm" role="status" data-testid="fleet-map-empty">
            <MapPin className="size-4 text-muted-foreground" />
            {t('map.empty')}
          </div>
        </Overlay>
      )}
      {status.state === 'error' && (
        <Overlay inset={focusInsetLeft} solid>
          <Problem title={t('map.loadFailed')} body={t('map.loadFailedBody')} onRetry={retry} testId="fleet-map-error" />
        </Overlay>
      )}
    </MapLibreMap>
  );
}

/** Centres a message in the part of the map the driver panel is not covering. */
function Overlay({ inset, solid = false, children }: { inset: number; solid?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn('absolute inset-0 flex items-center justify-center p-4', solid ? 'z-[200] bg-card' : 'pointer-events-none z-10')}
      style={{ paddingLeft: 16 + inset }}
    >
      {children}
    </div>
  );
}

function Problem({ title, body, onRetry, testId }: { title: string; body: string; onRetry?: () => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 text-center" role="alert" data-testid={testId}>
      <MapPin className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-1" onClick={onRetry} data-testid="fleet-map-retry">
          <RefreshCw />
          {t('map.retry')}
        </Button>
      )}
    </div>
  );
}

function Legend({ simulated }: { simulated: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      // Bottom-left, clear of the attribution at bottom-right. On a narrow map the attribution runs the
      // width of the bottom edge, so there the legend moves to the top-left instead: details open as a
      // bottom sheet on narrow screens, so that corner is free (on desktop the panel owns it).
      className="pointer-events-none absolute bottom-3 left-3 z-[110] flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-card/90 px-2.5 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur max-md:bottom-auto max-md:top-3 max-md:max-w-[calc(100%-4rem)]"
      data-testid="fleet-map-legend"
    >
      {(['moving', 'stopped', 'offline'] as const).map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: MOTION_HEX[tone] }} />
          {t(`enum.motion.${tone}`)}
        </span>
      ))}
      {simulated && <span className="text-muted-foreground">· {t('map.simulated')}</span>}
    </div>
  );
}

/** The deployment has no usable map style. Nothing is drawn, and the reason is logged for whoever deploys it. */
function MapConfigUnavailable({ reason, className, inset = 0 }: { reason: 'missing' | 'invalid'; className?: string; inset?: number }) {
  const { t } = useTranslation();
  useEffect(() => {
    // The configured value is deliberately not logged: it can carry a provider key.
    console.error(
      reason === 'missing'
        ? '[fleet-map] VITE_MAP_STYLE_URL is not set, so the Live Fleet map cannot be drawn.'
        : '[fleet-map] VITE_MAP_STYLE_URL is not a usable MapLibre style URL (expected an absolute https URL or a root-relative path).',
    );
  }, [reason]);

  return (
    <div className={cn('flex items-center justify-center rounded-lg border bg-muted/30 p-4', className)} style={{ paddingLeft: 16 + inset }} data-testid="fleet-map-config-error">
      <Problem title={t('map.configUnavailable')} body={t('map.configUnavailableBody')} testId="fleet-map-config-message" />
    </div>
  );
}

/**
 * Keeps a crash inside the map from taking the screen with it.
 *
 * MapLibre's own failures arrive as status, not exceptions; this is for the rest — a bug, a
 * browser quirk — so the list beside the map survives whatever the map does. Error boundaries
 * must be class components; this is the one place in the app that warrants one.
 */
class MapBoundary extends Component<{ className?: string; inset?: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[fleet-map] the map crashed while rendering; the driver list is unaffected', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <MapCrashed className={this.props.className} inset={this.props.inset} onRetry={() => this.setState({ failed: false })} />;
  }
}

function MapCrashed({ className, inset = 0, onRetry }: { className?: string; inset?: number; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center justify-center rounded-lg border bg-muted/30 p-4', className)} style={{ paddingLeft: 16 + inset }} data-testid="fleet-map-crashed">
      <Problem title={t('map.loadFailed')} body={t('map.loadFailedBody')} onRetry={onRetry} testId="fleet-map-error" />
    </div>
  );
}
