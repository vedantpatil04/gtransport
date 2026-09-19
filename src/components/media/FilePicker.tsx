import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, CheckCircle2, CloudOff, FileText, ImageUp, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { putFile } from '@/lib/fileStore';
import { prepareFile } from '@/lib/image';
import { cn, uid } from '@/lib/utils';
import { useFileUrl } from '@/hooks/useFileUrl';
import { useApp } from '@/store';
import type { FileRef } from '@/types';

interface Props {
  value: FileRef | null;
  onChange: (ref: FileRef | null) => void;
  purpose: 'receipt' | 'document';
  /** `driver` = large one-handed buttons; `admin` = compact */
  variant?: 'driver' | 'admin';
  labels: { camera: string; gallery: string; done: string };
  invalid?: boolean;
  testId?: string;
}

type Phase = { name: 'idle' } | { name: 'working'; progress: number; preview: string | null } | { name: 'error' };

/**
 * Camera / gallery picker with preview, progress and replace/remove.
 * Resizing and storage are invisible to the user — they only see "uploading" then "uploaded".
 */
export function FilePicker({ value, onChange, purpose, variant = 'driver', labels, invalid, testId }: Props) {
  const { t } = useTranslation();
  const offline = useApp((s) => s.offline);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const timer = useRef<number>();
  const { url } = useFileUrl(value);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setPhase({ name: 'working', progress: 6, preview: null });
    try {
      const prepared = await prepareFile(file, purpose);
      setPhase({ name: 'working', progress: 18, preview: prepared.kind === 'image' ? prepared.dataUrl : null });
      const id = uid(purpose === 'receipt' ? 'rcpt' : 'docf');
      await putFile(id, prepared.dataUrl);
      // Simulated network upload so the progress feels like the real thing.
      await new Promise<void>((resolve) => {
        let p = 18;
        timer.current = window.setInterval(() => {
          p = Math.min(100, p + (offline ? 41 : 9 + Math.random() * 14));
          setPhase((ph) => (ph.name === 'working' ? { ...ph, progress: p } : ph));
          if (p >= 100) {
            window.clearInterval(timer.current);
            resolve();
          }
        }, 110);
      });
      onChange({ id, kind: prepared.kind, name: prepared.name, size: prepared.size, uploaded: !offline });
      setPhase({ name: 'idle' });
    } catch {
      setPhase({ name: 'error' });
    }
  };

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} data-testid={testId ? `${testId}-camera` : undefined} />
      <input ref={galleryRef} type="file" accept={purpose === 'document' ? 'image/*,application/pdf' : 'image/*'} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} data-testid={testId ? `${testId}-gallery` : undefined} />
    </>
  );

  const big = variant === 'driver';

  if (phase.name === 'working') {
    return (
      <div className="panel flex items-center gap-3 p-3" aria-live="polite">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {phase.preview ? <img src={phase.preview} alt="" className="size-full object-cover" /> : <FileText className="size-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('driver.receipt.uploading')}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-success transition-[width] duration-100" style={{ width: `${phase.progress}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (value) {
    const isPdf = value.kind === 'pdf';
    return (
      <div className="panel p-3" data-testid={testId ? `${testId}-done` : undefined}>
        {inputs}
        <div className="flex items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {url && !isPdf ? <img src={url} alt={t('driver.receipt.preview')} className="size-full object-cover" /> : <FileText className="size-7 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            {value.uploaded ? (
              <p className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle2 className="size-5 shrink-0" />
                {labels.done}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                <CloudOff className="size-5 shrink-0" />
                {t('driver.receipt.savedOnPhone')}
              </p>
            )}
            {value.name && <p className="mt-0.5 truncate text-xs text-muted-foreground">{value.name}</p>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" size={big ? 'lg' : 'sm'} onClick={() => galleryRef.current?.click()}>
            <RefreshCw />
            {t('driver.receipt.replace')}
          </Button>
          <Button variant="outline" size={big ? 'lg' : 'sm'} className="text-danger hover:text-danger" onClick={() => onChange(null)}>
            <Trash2 />
            {t('driver.receipt.remove')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {inputs}
      <div className={cn('grid gap-2', big ? 'grid-cols-1' : 'grid-cols-2')}>
        <Button
          variant="outline"
          size={big ? 'xl' : 'default'}
          className={cn(big && 'h-16 justify-start border-2 border-dashed text-base', invalid && 'border-danger')}
          onClick={() => cameraRef.current?.click()}
          data-testid={testId ? `${testId}-camera-btn` : undefined}
        >
          <Camera className={big ? 'size-7 text-primary' : undefined} />
          {labels.camera}
        </Button>
        <Button
          variant="outline"
          size={big ? 'xl' : 'default'}
          className={cn(big && 'h-14 justify-start text-base', invalid && 'border-danger')}
          onClick={() => galleryRef.current?.click()}
          data-testid={testId ? `${testId}-gallery-btn` : undefined}
        >
          <ImageUp className={big ? 'size-6 text-muted-foreground' : undefined} />
          {labels.gallery}
        </Button>
      </div>
      {phase.name === 'error' && <p className="mt-2 text-sm font-medium text-danger">{t('driver.receipt.error')}</p>}
    </div>
  );
}
