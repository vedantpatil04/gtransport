import { readFileSync } from 'fs';
import { join } from 'path';
import i18n, { initI18n } from '../../i18n';
import { localeFor, displayDate } from '../dates';
import { quantity, rupees } from '../format';
import { relativeTime } from '../relative';

/**
 * The phone shows figures, dates and times exactly as the office web console does, and talks to the
 * same production API.
 */

describe('money and quantities match the office console', () => {
  it('formats API strings and numbers alike: whole rupees, or exactly two paise digits', () => {
    expect(rupees('2450.00')).toBe('₹2,450');
    expect(rupees(2450)).toBe('₹2,450');
    expect(rupees('23999.7')).toBe('₹23,999.70');
    expect(rupees(23999.7)).toBe('₹23,999.70');
    expect(rupees('1250000.50')).toBe('₹12,50,000.50');
  });

  it('shows litres grouped, without trailing zeros', () => {
    expect(quantity('25.300')).toBe('25.3');
    expect(quantity('1234.5', 1)).toBe('1,234.5');
    expect(quantity('not a number')).toBe('—');
  });
});

describe('dates', () => {
  it('uses native month names with Latin digits in every language, like the web console', () => {
    expect(localeFor('mr')).toBe('mr-IN-u-nu-latn');
    expect(displayDate('2026-09-19', 'mr')).toMatch(/19/);
    expect(displayDate('2026-09-19', 'mr')).toMatch(/2026/);
  });
});

describe('relative time', () => {
  beforeAll(async () => {
    await initI18n();
    await i18n.changeLanguage('en');
  });

  const now = Date.parse('2026-10-06T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads naturally in the office language', () => {
    expect(relativeTime(ago(20_000), i18n.t, now)).toBe('Just now');
    expect(relativeTime(ago(5 * 60_000), i18n.t, now)).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3_600_000), i18n.t, now)).toBe('3 hours ago');
    expect(relativeTime(ago(26 * 3_600_000), i18n.t, now)).toBe('1 day ago');
    expect(relativeTime(null, i18n.t, now)).toBe('—');
  });

  it('is translated, not English with numbers', async () => {
    await i18n.changeLanguage('hi');
    expect(relativeTime(ago(3 * 3_600_000), i18n.t, now)).toBe('3 घंटे पहले');
    await i18n.changeLanguage('en');
  });
});

describe('production API configuration', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('defaults every build — Metro development builds included — to the production API on Render', () => {
    expect(read('../config.ts')).toContain("PRODUCTION_API_URL = 'https://gtransport-7vgf.onrender.com'");
    expect(read('../../../app.config.ts')).toContain("process.env.EXPO_PUBLIC_API_URL || 'https://gtransport-7vgf.onrender.com'");
  });

  it('has no localhost, emulator or LAN backend fallback', () => {
    // Any URL pointing at a developer's machine, an emulator alias or a private LAN address.
    const localUrl = /\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/;
    for (const file of ['../config.ts', '../../../app.config.ts', '../../../.env.example']) {
      expect(read(file)).not.toMatch(localUrl);
    }
  });

  it('falls back to the production API when a build carries no API URL at all', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
      const saved = process.env.EXPO_PUBLIC_API_URL;
      delete process.env.EXPO_PUBLIC_API_URL;
      try {
        const config = require('../config') as typeof import('../config');
        expect(config.API_URL).toBe('https://gtransport-7vgf.onrender.com');
      } finally {
        if (saved !== undefined) process.env.EXPO_PUBLIC_API_URL = saved;
      }
    });
  });
});
