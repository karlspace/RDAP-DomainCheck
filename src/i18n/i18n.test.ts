// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALES,
  detectLocale,
  getLocale,
  isLocale,
  onLocaleChange,
  setLocale,
  t,
  tCount,
} from './index.js';
import { formatDate, formatDateTime, formatDuration, formatNumber } from './format.js';
import { de } from './locales/de.js';
import { en } from './locales/en.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

describe('translation catalogues', () => {
  it('cover exactly the same keys', () => {
    // The compiler already enforces this; the test protects against someone
    // widening the type to silence it.
    expect(Object.keys(en).toSorted()).toEqual(Object.keys(de).toSorted());
  });

  it('has no empty strings', () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(value.trim(), `empty translation for ${key}`).not.toBe('');
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').toSorted();

    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(placeholders(en[key]), `placeholder mismatch in ${key}`).toEqual(
        placeholders(de[key]),
      );
    }
  });
});

describe('locale handling', () => {
  beforeEach(() => {
    installMemoryStorage();
    setLocale('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('narrows arbitrary values', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('switches language and updates the document lang attribute', () => {
    setLocale('de');
    expect(getLocale()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('notifies subscribers exactly once per change', () => {
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);

    setLocale('de');
    setLocale('de'); // no-op
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    setLocale('en');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('prefers a stored locale over the browser list', () => {
    localStorage.setItem('rdap-domaincheck:locale-v1', 'de');
    expect(detectLocale()).toBe('de');
  });

  it('falls back to the browser language', () => {
    vi.stubGlobal('navigator', { languages: ['de-AT', 'en-US'] });
    expect(detectLocale()).toBe('de');
  });

  it('falls back to English for an unsupported browser language', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR'] });
    expect(detectLocale()).toBe('en');
  });

  it('exposes the supported locales', () => {
    expect(LOCALES).toEqual(['de', 'en']);
  });
});

describe('t', () => {
  beforeEach(() => {
    installMemoryStorage();
    setLocale('en');
  });

  it('returns the translated string', () => {
    expect(t('action.check')).toBe('Check availability');
    setLocale('de');
    expect(t('action.check')).toBe('Verfügbarkeit prüfen');
  });

  it('substitutes named placeholders', () => {
    expect(t('results.progress', { done: 3, total: 10 })).toBe('3 of 10');
  });

  it('leaves an unresolved placeholder visible as a bug signal', () => {
    expect(t('results.progress', { done: 3 })).toContain('{total}');
  });

  it('picks the singular form for exactly one', () => {
    expect(tCount('input.list.hint', 'input.list.hintOne', 1)).toBe('1 domain detected');
    expect(tCount('input.list.hint', 'input.list.hintOne', 4)).toBe('4 domains detected');
  });
});

describe('formatting', () => {
  beforeEach(() => {
    installMemoryStorage();
    setLocale('de');
  });

  it('formats an RDAP timestamp as a calendar date', () => {
    expect(formatDate('2027-08-12T04:00:00Z')).toBe('12.08.2027');
  });

  it('returns the raw value when a registry sends something unparseable', () => {
    expect(formatDate('whenever')).toBe('whenever');
  });

  it('returns null for a missing value', () => {
    expect(formatDate(undefined)).toBeNull();
    expect(formatDateTime(undefined)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });

  it('produces a full timestamp for tooltips', () => {
    expect(formatDateTime('2027-08-12T04:00:00Z')).toContain('2027');
  });

  it('switches unit for durations above a second', () => {
    expect(formatDuration(842)).toBe('842 ms');
    expect(formatDuration(1240)).toBe('1,2 s');
  });

  it('formats numbers for the active locale', () => {
    expect(formatNumber(1234)).toBe('1.234');
    setLocale('en');
    expect(formatNumber(1234)).toBe('1,234');
  });
});
