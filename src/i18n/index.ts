import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Lang } from '@/types';
import en from './en.json';
import hi from './hi.json';
import kn from './kn.json';
import mr from './mr.json';
import ta from './ta.json';
import te from './te.json';

/** Languages offered to drivers, labelled in their own script. */
export const LANGUAGES: { code: Lang; native: string; english: string }[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
];

export const nativeName = (code: Lang) => LANGUAGES.find((l) => l.code === code)?.native ?? code;

const LANG_KEY = 'gangamata-lang';

function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    kn: { translation: kn },
    mr: { translation: mr },
    ta: { translation: ta },
    te: { translation: te },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Switches the active UI language and remembers it on this device. */
export function applyLanguage(lang: Lang) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage blocked */
  }
}

export default i18n;
