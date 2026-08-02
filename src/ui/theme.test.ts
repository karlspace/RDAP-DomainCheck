// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveTheme, getTheme, initTheme, isTheme, setTheme } from './theme.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

/** Stands in for `window.matchMedia`, which happy-dom answers statically. */
function stubPrefersDark(matches: boolean): { fire: () => void } {
  const listeners: (() => void)[] = [];
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    removeEventListener: () => undefined,
  }));
  return {
    fire: () => {
      for (const listener of listeners) listener();
    },
  };
}

beforeEach(() => {
  installMemoryStorage();
  document.documentElement.removeAttribute('data-theme');
  document.head.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isTheme', () => {
  it.each(['system', 'light', 'dark'])('accepts %s', (value) => {
    expect(isTheme(value)).toBe(true);
  });

  it.each(['solarized', '', null])('rejects %s', (value) => {
    expect(isTheme(value)).toBe(false);
  });
});

describe('theme', () => {
  it('defaults to system when nothing is stored', () => {
    stubPrefersDark(false);
    expect(initTheme()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('resolves system to the OS preference', () => {
    stubPrefersDark(true);
    initTheme();
    expect(effectiveTheme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('an explicit choice overrides the OS preference', () => {
    stubPrefersDark(true);
    initTheme();
    setTheme('light');

    expect(getTheme()).toBe('light');
    expect(effectiveTheme()).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('restores the stored preference', () => {
    stubPrefersDark(false);
    setTheme('dark');
    expect(initTheme()).toBe('dark');
  });

  it('ignores a corrupted stored value', () => {
    stubPrefersDark(false);
    localStorage.setItem('rdap-domaincheck:theme-v1', 'neon');
    expect(initTheme()).toBe('system');
  });

  it('follows a live OS change while set to system', () => {
    // This is what makes "System" mean something after the page has loaded.
    let dark = false;
    const listeners: (() => void)[] = [];
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: () => undefined,
    }));

    initTheme();
    expect(document.documentElement.dataset['theme']).toBe('light');

    dark = true;
    for (const listener of listeners) listener();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('updates the theme-color meta tag for the browser chrome', () => {
    stubPrefersDark(false);
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);

    initTheme();
    setTheme('dark');
    expect(meta.content).toBe('#0b0d16');
  });
});
