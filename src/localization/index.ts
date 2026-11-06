import { useSyncExternalStore } from 'react';
import { isIosPlatform } from '../platform/capabilities';
import { iosMessages } from './ios';
import { en } from './en';
import { aeb } from './aeb';
import { ar } from './ar';
import { fr } from './fr';
import type { Messages } from './types';

export const LANGUAGE_KEY = 'taxi-check.language';
export const languages = {
  aeb: { label: 'تونسي', lang: 'aeb-TN', dir: 'rtl' },
  ar: { label: 'العربية', lang: 'ar', dir: 'rtl' },
  fr: { label: 'Français', lang: 'fr', dir: 'ltr' },
  en: { label: 'English', lang: 'en', dir: 'ltr' },
} as const;
export type Language = keyof typeof languages;
export const catalogs: Record<Language, Messages> = { aeb, ar, fr, en };
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(languages, value);
}
export function readLanguagePreference(): Language {
  try { const value = localStorage.getItem(LANGUAGE_KEY); return isLanguage(value) ? value : 'aeb'; }
  catch { return 'aeb'; }
}
let selected: Language | undefined;
const listeners = new Set<() => void>();
function applyDocument(language: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = languages[language].lang;
  document.documentElement.dir = languages[language].dir;
}
export function getLanguage(): Language {
  if (selected === undefined) { selected = readLanguagePreference(); applyDocument(selected); }
  return selected;
}
export function selectLanguage(language: Language): void {
  selected = isLanguage(language) ? language : 'aeb';
  try { localStorage.setItem(LANGUAGE_KEY, selected); } catch { /* Keep the deliberate choice for this session. */ }
  applyDocument(selected);
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useLanguage(): Language { return useSyncExternalStore(subscribe, getLanguage, () => 'aeb'); }
export function useMessages(): Messages { const language=useLanguage();return isIosPlatform()?iosMessages(catalogs[language],language):catalogs[language]; }
export function getMessages(): Messages { const language=getLanguage();return isIosPlatform()?iosMessages(catalogs[language],language):catalogs[language]; }
