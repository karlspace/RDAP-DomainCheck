import type { TranslationKey } from '../i18n/keys.js';
import { t } from '../i18n/index.js';

/**
 * Declarative translation binding.
 *
 * Static labels live in `index.html` with a `data-i18n` attribute instead of
 * being constructed in TypeScript. That keeps the markup readable and — more
 * usefully — lets the browser paint the layout before the module has run.
 */

const BINDINGS = [
  [
    'data-i18n',
    (node: Element, value: string) => {
      node.textContent = value;
    },
  ],
  [
    'data-i18n-placeholder',
    (node: Element, value: string) => {
      node.setAttribute('placeholder', value);
    },
  ],
  [
    'data-i18n-title',
    (node: Element, value: string) => {
      node.setAttribute('title', value);
    },
  ],
  [
    'data-i18n-label',
    (node: Element, value: string) => {
      node.setAttribute('aria-label', value);
    },
  ],
] as const;

/** Applies every `data-i18n*` binding inside `root` for the current locale. */
export function applyTranslations(root: ParentNode = document): void {
  for (const [attribute, apply] of BINDINGS) {
    for (const node of root.querySelectorAll(`[${attribute}]`)) {
      const key = node.getAttribute(attribute);
      if (key === null) continue;
      apply(node, t(key as TranslationKey));
    }
  }
}
