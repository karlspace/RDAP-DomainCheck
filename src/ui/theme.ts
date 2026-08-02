import { StorageKeys, readString, writeString } from '../core/storage.js';

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Narrows an arbitrary stored or `data-*` value to a known preference. */
export function isTheme(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

let current: ThemePreference = 'system';

/**
 * True when the OS asks for dark mode.
 *
 * `matchMedia` is missing in non-browser runtimes (tests, SSR), which the DOM
 * typings do not model — hence the guard the type checker considers redundant.
 */
function prefersDark(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(DARK_QUERY).matches;
}

/** Resolves `system` to the concrete scheme currently in effect. */
export function effectiveTheme(): 'light' | 'dark' {
  if (current !== 'system') return current;
  return prefersDark() ? 'dark' : 'light';
}

function apply(): void {
  const resolved = effectiveTheme();
  const root = document.documentElement;
  root.dataset['theme'] = resolved;
  // Tells the browser which scheme to use for form controls and scrollbars.
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta instanceof HTMLMetaElement) {
    meta.content = resolved === 'dark' ? '#0d1117' : '#f6f8f9';
  }
}

export function getTheme(): ThemePreference {
  return current;
}

export function setTheme(preference: ThemePreference): void {
  current = preference;
  writeString(StorageKeys.theme, preference);
  apply();
}

/**
 * Restores the stored preference and keeps `system` in sync with the OS.
 *
 * The media-query listener is what makes "System" actually live: switching the
 * OS to dark mode at 18:00 should flip the page without a reload.
 */
export function initTheme(): ThemePreference {
  const stored = readString(StorageKeys.theme);
  current = isTheme(stored) ? stored : 'system';
  apply();

  if (typeof globalThis.matchMedia === 'function') {
    globalThis.matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (current === 'system') apply();
    });
  }

  return current;
}
