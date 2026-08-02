// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTranslations } from './i18n-dom.js';
import { setLocale } from '../i18n/index.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

beforeEach(() => {
  installMemoryStorage();
  setLocale('de');
});

describe('applyTranslations', () => {
  it('replaces text content from data-i18n', () => {
    const node = document.createElement('button');
    node.dataset['i18n'] = 'action.check';
    node.textContent = 'placeholder default';
    document.body.replaceChildren(node);

    applyTranslations();
    expect(node.textContent).toBe('Verfügbarkeit prüfen');
  });

  it('binds placeholder, title and aria-label', () => {
    document.body.replaceChildren();
    const input = document.createElement('input');
    input.dataset['i18nPlaceholder'] = 'filter.searchPlaceholder';
    input.dataset['i18nLabel'] = 'filter.search';
    input.dataset['i18nTitle'] = 'filter.search';
    document.body.appendChild(input);

    applyTranslations();
    expect(input.getAttribute('placeholder')).toBe('Domain filtern …');
    expect(input.getAttribute('aria-label')).toBe('Suchen');
    expect(input.getAttribute('title')).toBe('Suchen');
  });

  it('re-applies after a language switch', () => {
    const node = document.createElement('span');
    node.dataset['i18n'] = 'action.cancel';
    document.body.replaceChildren(node);

    applyTranslations();
    expect(node.textContent).toBe('Abbrechen');

    setLocale('en');
    applyTranslations();
    expect(node.textContent).toBe('Cancel');
  });

  it('can be scoped to a subtree', () => {
    const outside = document.createElement('span');
    outside.dataset['i18n'] = 'action.clear';
    const scope = document.createElement('div');
    const inside = document.createElement('span');
    inside.dataset['i18n'] = 'action.clear';
    scope.appendChild(inside);
    document.body.replaceChildren(outside, scope);

    applyTranslations(scope);
    expect(inside.textContent).toBe('Leeren');
    expect(outside.textContent).toBe('');
  });
});
