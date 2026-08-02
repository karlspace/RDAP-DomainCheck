import type { TranslationKey } from './keys.js';
import { de } from './locales/de.js';
import { en } from './locales/en.js';
import { StorageKeys, readString, writeString } from '../core/storage.js';

export type { TranslationKey };

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGUES: Record<Locale, Record<TranslationKey, string>> = { de, en };

/** Values substituted into `{placeholder}` slots. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** Narrows an arbitrary stored or `data-*` value to a supported locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Stored preference first, then the browser's list, then English. */
export function detectLocale(): Locale {
  const stored = readString(StorageKeys.locale);
  if (isLocale(stored)) return stored;

  // `navigator` is absent in workers and in older Node runtimes, despite the
  // DOM typings insisting it always exists.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const preferences: readonly string[] = globalThis.navigator?.languages ?? [];
  for (const preference of preferences) {
    const primary = preference.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  writeString(StorageKeys.locale, locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Subscribes to locale changes; returns the unsubscribe function. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Looks up a translation and fills `{placeholder}` slots.
 *
 * Results are always inserted into the DOM as text, never as markup, so no
 * escaping happens (or is needed) here.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = CATALOGUES[current][key];
  if (params === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    // An unresolved placeholder stays visible on purpose: it is a bug signal,
    // not something to paper over with an empty string.
    return value === undefined ? placeholder : String(value);
  });
}

/** German has irregular plurals often enough that a dedicated key beats a rule. */
export function tCount(
  key: TranslationKey,
  oneKey: TranslationKey,
  count: number,
  params?: TranslationParams,
): string {
  return count === 1 ? t(oneKey, params) : t(key, { ...params, count });
}
