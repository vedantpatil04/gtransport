import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'h-5 text-[11px] pl-[14px] pr-1.5 [--strip:10px]',
  sm: 'h-6 text-[13px] pl-[17px] pr-2 [--strip:12px]',
  md: 'h-8 text-base pl-[21px] pr-2.5 [--strip:15px]',
  lg: 'h-11 text-[22px] pl-[28px] pr-3.5 [--strip:20px]',
} as const;

/**
 * Indian commercial registration plate — yellow, black characters, with the HSRP "IND" strip.
 * Used everywhere a vehicle number is shown so registrations are instantly recognisable.
 */
export function Plate({ reg, size = 'sm', className }: { reg: string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  if (!reg) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center whitespace-nowrap rounded-[4px] border-[1.5px] border-[#1a1a1a] bg-plate font-bold uppercase leading-none tracking-[0.04em] text-[#111] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]',
        SIZES[size],
        className,
      )}
      style={{ fontStretch: '80%' }}
      aria-label={reg}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 flex w-[var(--strip)] flex-col items-center justify-end rounded-l-[2px] bg-[#1f4aa8] pb-[2px] text-[0.36em] font-bold leading-none tracking-normal text-white">
        IND
      </span>
      {reg}
    </span>
  );
}
