/**
 * Design tokens taken directly from the approved web app (src/index.css), converted from HSL
 * to hex. The native app must look like the same product, so these values are copied rather
 * than reinvented — do not "improve" them without a real platform constraint.
 */
export const colors = {
  primary: '#1C2C45',
  primaryForeground: '#FFFFFF',
  background: '#F3F5F7',
  card: '#FFFFFF',
  foreground: '#15202D',
  muted: '#EAEDF0',
  mutedForeground: '#596573',
  border: '#DAE0E7',
  success: '#1C7D48',
  successSoft: '#E5F6EC',
  warning: '#B86E00',
  warningSoft: '#FFF3D6',
  danger: '#BE362D',
  dangerSoft: '#FCE9E8',
  /** Number-plate yellow, used for the plate and the Add Fuel icon tile. */
  plate: '#F4C32F',
  /** Gold accent from the brand wordmark. */
  gold: '#D97706',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/**
 * Minimum touch target. Drivers use this app one-handed, often in poor light, so nothing
 * tappable goes below this.
 */
export const TOUCH_TARGET = 48;

export const typography = {
  /** Font scaling is allowed, but capped so long translations do not destroy the layout. */
  maxFontSizeMultiplier: 1.4,
  h1: { fontSize: 26, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  figure: { fontSize: 22, fontWeight: '700' },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F1E32',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  raised: {
    shadowColor: '#1B2B44',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;
