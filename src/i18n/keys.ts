import type { de } from './locales/de.js';

/**
 * The canonical key set, derived from the German catalogue.
 *
 * Lives in its own module to keep `en.ts` from importing `de.ts` for its type
 * while `index.ts` imports both for their values — no circular imports.
 */
export type TranslationKey = keyof typeof de;
