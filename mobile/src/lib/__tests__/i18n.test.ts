import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '../../i18n/locales/en.json';
import hi from '../../i18n/locales/hi.json';
import kn from '../../i18n/locales/kn.json';
import mr from '../../i18n/locales/mr.json';
import ta from '../../i18n/locales/ta.json';
import te from '../../i18n/locales/te.json';
import i18n, { initI18n, LANGUAGES, languageFromApi, readStoredLanguage, setLanguage } from '../../i18n';

const flatten = (value: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object'
      ? flatten(child as Record<string, unknown>, prefix ? `${prefix}.${key}` : key)
      : [prefix ? `${prefix}.${key}` : key],
  );

describe('translations', () => {
  it('offers all six driver languages', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'hi', 'kn', 'mr', 'ta', 'te']);
  });

  it.each([
    ['hi', hi],
    ['kn', kn],
    ['mr', mr],
    ['ta', ta],
    ['te', te],
  ])('%s covers every English key', (_code, locale) => {
    expect(flatten(locale as Record<string, unknown>).sort()).toEqual(flatten(en as Record<string, unknown>).sort());
  });

  it.each([
    ['hi', hi.login.signIn],
    ['kn', kn.login.signIn],
    ['mr', mr.login.signIn],
    ['ta', ta.login.signIn],
    ['te', te.login.signIn],
  ])('uses native script rather than transliterated English for %s', (_code, text) => {
    expect(text).not.toMatch(/^[\x20-\x7F]+$/);
  });
});

describe('language selection', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await initI18n();
  });

  it('changes language immediately', async () => {
    await setLanguage('kn');
    expect(i18n.language).toBe('kn');
    expect(i18n.t('tabs.home')).toBe(kn.tabs.home);
  });

  it('persists the choice so it survives a restart', async () => {
    await setLanguage('ta');
    await expect(readStoredLanguage()).resolves.toBe('ta');

    // Simulate a fresh launch: init reads the saved value back.
    await i18n.changeLanguage('en');
    await initI18n();
    expect(i18n.language).toBe('ta');
  });

  it('maps the office record language onto an app language', () => {
    expect(languageFromApi('KN')).toBe('kn');
    expect(languageFromApi('MR')).toBe('mr');
    expect(languageFromApi('ZZ')).toBeNull();
    expect(languageFromApi(null)).toBeNull();
  });
});
