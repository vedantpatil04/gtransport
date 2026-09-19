import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { size?: 'default' | 'lg' }>(
  ({ className, size = 'default', ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-success data-[state=unchecked]:bg-input',
        size === 'lg' ? 'h-8 w-14' : 'h-6 w-11',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow ring-0 transition-transform data-[state=unchecked]:translate-x-0',
          size === 'lg' ? 'size-7 data-[state=checked]:translate-x-6' : 'size-5 data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = 'Switch';
