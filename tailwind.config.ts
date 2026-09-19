import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const v = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      fontFamily: {
        sans: ['Archivo', 'Noto Sans Devanagari', 'Noto Sans Kannada', 'Noto Sans Tamil', 'Noto Sans Telugu', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: v('border'),
        input: v('input'),
        ring: v('ring'),
        background: v('background'),
        foreground: v('foreground'),
        primary: { DEFAULT: v('primary'), foreground: v('primary-foreground') },
        secondary: { DEFAULT: v('secondary'), foreground: v('secondary-foreground') },
        muted: { DEFAULT: v('muted'), foreground: v('muted-foreground') },
        accent: { DEFAULT: v('accent'), foreground: v('accent-foreground') },
        card: { DEFAULT: v('card'), foreground: v('card-foreground') },
        popover: { DEFAULT: v('popover'), foreground: v('popover-foreground') },
        destructive: { DEFAULT: v('danger'), foreground: v('primary-foreground') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        plate: v('plate'),
        sidebar: { DEFAULT: v('sidebar'), foreground: v('sidebar-foreground'), muted: v('sidebar-muted'), active: v('sidebar-active') },
        map: { land: v('map-land'), sea: v('map-sea'), road: v('map-road'), border: v('map-border') },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: {
        'ring-pulse': { '0%': { transform: 'scale(1)', opacity: '0.6' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
      },
      animation: { 'ring-pulse': 'ring-pulse 1.8s ease-out infinite' },
    },
  },
  plugins: [animate],
} satisfies Config;
