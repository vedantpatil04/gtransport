import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FlaskConical, RotateCcw, Settings2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useApp } from '@/store';
import { cn } from '@/lib/utils';
import type { Role } from '@/types';

/**
 * Prototype-only strip. Deliberately styled apart from the product (dark, small, dashed)
 * so the client never mistakes it for a production setting.
 */
export function DemoBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useApp((s) => s.role);
  const lastRoute = useApp((s) => s.lastRoute);
  const offline = useApp((s) => s.offline);

  const switchTo = (r: Role) => {
    if (r === role) return;
    toast.dismiss(); // a toast from one role should not appear in the other role's screen
    useApp.getState().setRole(r);
    navigate(lastRoute[r] || `/${r}`);
  };

  return (
    <div className="relative z-40 border-b border-dashed border-white/15 bg-[#0d1522] text-white/75" data-demo-bar>
      <div className="mx-auto flex h-9 max-w-[1600px] items-center gap-2 px-2.5 text-xs sm:px-4">
        <span className="inline-flex items-center gap-1.5 rounded border border-dashed border-amber-300/40 px-1.5 py-0.5 font-semibold text-amber-200/90">
          <FlaskConical className="size-3.5" aria-hidden />
          <span className="hidden min-[380px]:inline">{t('demo.badge')}</span>
        </span>
        {offline && (
          <span className="inline-flex items-center gap-1 rounded bg-danger/80 px-1.5 py-0.5 font-semibold text-white">
            <WifiOff className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('demo.simulateOffline')}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-white/50 sm:inline">{t('demo.viewAs')}</span>
          <div role="tablist" aria-label={t('demo.viewAs')} className="flex rounded-md bg-white/10 p-0.5">
            {(['driver', 'admin'] as Role[]).map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={role === r}
                onClick={() => switchTo(r)}
                data-testid={`view-as-${r}`}
                className={cn('rounded px-2.5 py-1 font-semibold transition-colors', role === r ? 'bg-white text-[#0d1522]' : 'text-white/70 hover:text-white')}
              >
                {t(`demo.${r}`)}
              </button>
            ))}
          </div>
          <DemoSettings />
        </div>
      </div>
    </div>
  );
}

function DemoSettings() {
  const { t } = useTranslation();
  const drivers = useApp((s) => s.drivers);
  const currentDriverId = useApp((s) => s.currentDriverId);
  const offline = useApp((s) => s.offline);
  const vehicles = useApp((s) => s.vehicles);
  const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate();
  const role = useApp((s) => s.role);

  const reset = async () => {
    await useApp.getState().resetDemo();
    setConfirm(false);
    toast.success(t('demo.resetDone'));
    navigate(role === 'admin' ? '/admin' : '/driver');
  };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button className="rounded p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label={t('demo.settings')} data-testid="demo-settings">
            <Settings2 className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-bold">{t('demo.settings')}</p>
            <p className="text-xs text-muted-foreground">{t('demo.note')}</p>
          </div>
          <div className="space-y-4 px-4 py-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('demo.driverProfile')}</span>
              <NativeSelect value={currentDriverId} onChange={(e) => useApp.getState().setCurrentDriver(e.target.value)} data-testid="demo-driver-select">
                {drivers
                  .filter((d) => d.status === 'active')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {vehicles.find((v) => v.id === d.vehicleId)?.reg ?? '—'}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('demo.simulateOffline')}</p>
                <p className="text-xs text-muted-foreground">{t('demo.simulateOfflineHint')}</p>
              </div>
              <Switch checked={offline} onCheckedChange={(v) => useApp.getState().setOffline(v)} aria-label={t('demo.simulateOffline')} data-testid="demo-offline" />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirm(true)}>
              <RotateCcw />
              {t('demo.reset')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('demo.reset')}</DialogTitle>
            <DialogDescription>{t('demo.resetConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              {t('demo.reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
