import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';
import mr from './locales/mr.json';
import ta from './locales/ta.json';
import te from './locales/te.json';

/** The six languages Gangamata drivers use, labelled in their own script. */
export const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'hi', native: 'हिंदी' },
  { code: 'kn', native: 'ಕನ್ನಡ' },
  { code: 'mr', native: 'मराठी' },
  { code: 'ta', native: 'தமிழ்' },
  { code: 'te', native: 'తెలుగు' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/** Maps a driver's preferred language from the API (EN, KN, …) onto an app language. */
export const languageFromApi = (value?: string | null): LanguageCode | null => {
  const lower = value?.toLowerCase();
  return LANGUAGES.some((l) => l.code === lower) ? (lower as LanguageCode) : null;
};

const STORAGE_KEY = 'gangamata.language';
const resources = { en: { translation: en }, hi: { translation: hi }, kn: { translation: kn }, mr: { translation: mr }, ta: { translation: ta }, te: { translation: te } };

/** The phone's language if we support it, otherwise English. */
function deviceLanguage(): LanguageCode {
  const tag = Localization.getLocales()[0]?.languageCode?.toLowerCase();
  return LANGUAGES.some((l) => l.code === tag) ? (tag as LanguageCode) : 'en';
}

export async function readStoredLanguage(): Promise<LanguageCode | null> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return LANGUAGES.some((l) => l.code === saved) ? (saved as LanguageCode) : null;
  } catch {
    return null;
  }
}

/**
 * Initialises translations. The saved choice wins, then the phone's language, then English —
 * so a driver's selection survives restarts.
 */
export async function initI18n(): Promise<typeof i18n> {
  const stored = await readStoredLanguage();

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: stored ?? deviceLanguage(),
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
      compatibilityJSON: 'v4',
    });
  } else if (stored && i18n.language !== stored) {
    await i18n.changeLanguage(stored);
  }

  return i18n;
}

/** Changes language immediately and remembers it for next launch. */
export async function setLanguage(code: LanguageCode): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, code);
  } catch {
    // A failed write only costs the preference at next launch; the change still applies now.
  }
}

export default i18n;
