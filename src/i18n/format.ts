import { getLocale } from './index.js';

/**
 * Locale-aware formatting helpers.
 *
 * `Intl` is used directly rather than a date library: it ships with every
 * browser we target, handles the German/English split for free, and adds
 * nothing to the bundle or the dependency tree.
 */

/**
 * Renders an RDAP timestamp as a plain calendar date.
 *
 * Registries emit ISO-8601, but not uniformly — some omit the timezone, some
 * send only a date. Anything unparseable is returned verbatim so the user sees
 * the registry's actual value instead of "Invalid Date".
 */
export function formatDate(iso: string | undefined): string | null {
  if (iso === undefined || iso.length === 0) return null;

  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;

  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

/** Full timestamp for tooltips, where precision is worth the extra width. */
export function formatDateTime(iso: string | undefined): string | null {
  if (iso === undefined || iso.length === 0) return null;

  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;

  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/** Milliseconds as `842 ms` / `1,2 s`, depending on magnitude and locale. */
export function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale()).format(value);
}
