import { cn } from '@/lib/utils';

export function LogoMark({ className, size }: { className?: string; size?: number | string }) {
  return (
    <img
      src="/branding/gangamata-mark.png"
      alt="Gangamata Transport Mark"
      style={typeof size === 'number' ? { height: `${size}px` } : undefined}
      className={cn('h-9 w-auto shrink-0 object-contain drop-shadow-sm', className)}
    />
  );
}

/**
 * Gangamata Transport Brand Logo:
 * [LOGO MARK]  Gangamata
 *              Transport
 *
 * Mark: transparent symbol (truck + road + tricolor)
 * Text: application-rendered HTML typography
 */
export function Logo({
  tone = 'dark',
  size = 'default',
  compact = false,
  className,
  markSrc = '/branding/gangamata-mark.png',
}: {
  tone?: 'dark' | 'light';
  size?: 'sm' | 'default' | 'lg';
  compact?: boolean;
  className?: string;
  /** The same mark at another resolution, for pages where the full-size file is wasted bytes. */
  markSrc?: string;
}) {
  if (compact) {
    return <LogoMark className={className} />;
  }

  // Sizing:
  // sm (driver header): mark ~30px (28–34px), text compact
  // default (admin sidebar): mark ~38px (36–42px), text balanced
  // lg (login screens): mark ~46px, text prominent
  const markHeight =
    size === 'sm' ? 'h-[30px]' : size === 'lg' ? 'h-[46px]' : 'h-[38px]';

  const gangamataClass =
    size === 'sm'
      ? 'text-[15px] font-bold tracking-[0.02em]'
      : size === 'lg'
        ? 'text-[22px] font-bold tracking-[0.03em]'
        : 'text-[17px] font-bold tracking-[0.02em]';

  const transportClass =
    size === 'sm'
      ? 'text-[9px] font-semibold tracking-[0.18em]'
      : size === 'lg'
        ? 'text-[12px] font-semibold tracking-[0.2em]'
        : 'text-[10px] font-semibold tracking-[0.18em]';

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src={markSrc}
        alt="Gangamata Transport Mark"
        className={cn('w-auto shrink-0 object-contain drop-shadow-sm', markHeight)}
      />
      <div className="flex flex-col justify-center leading-none">
        <span
          className={cn(
            'font-serif',
            gangamataClass,
            tone === 'light' ? 'text-white' : 'text-[#0B2545] dark:text-white',
          )}
          style={{ fontFamily: "'Cinzel', Georgia, serif" }}
        >
          Gangamata
        </span>
        <span
          className={cn(
            'mt-0.5 font-sans',
            transportClass,
            tone === 'light' ? 'text-[#F4C430]' : 'text-[#D97706] dark:text-[#F4C430]',
          )}
        >
          TRANSPORT
        </span>
      </div>
    </div>
  );
}
