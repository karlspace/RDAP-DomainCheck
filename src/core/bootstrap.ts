import type { BootstrapRegistry, BootstrapService } from './types.js';
import { StorageKeys, readJson, writeJson } from './storage.js';

/** IANA's authoritative RDAP bootstrap file for the DNS (RFC 7484 §3). */
export const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

/** Re-fetch the registry at most once a day; it changes rarely. */
export const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;

export interface ManualOverride {
  readonly urls: readonly string[];
  /**
   * Set when the registry answers RDAP but omits `Access-Control-Allow-Origin`.
   * Such an entry is still worth having: it names the right registry and yields
   * a working link, even though the lookup itself has to happen in a tab.
   */
  readonly browserBlocked?: boolean;
}

/**
 * TLDs that operate a public RDAP service but are (still) missing from IANA's
 * bootstrap file.
 *
 * These only ever *fill gaps*: if IANA publishes an entry for the same suffix,
 * IANA wins, so this table cannot silently pin a stale URL once upstream
 * catches up.
 *
 * Before adding an entry, verify it against the registry's own documentation
 * and check the CORS header, because that decides whether a browser can use it:
 *
 *     curl -sD - -o /dev/null -H 'Origin: https://example.org' \
 *       https://rdap.<registry>/domain/<known-domain> | grep -i access-control
 *
 * No header means `browserBlocked: true`. Registries offering RDAP only behind
 * authentication (e.g. SWITCH for `.ch`) do not fit this model at all.
 */
export const MANUAL_OVERRIDES: Readonly<Record<string, ManualOverride>> = {
  // DENIC RDAP service — https://www.denic.de/en/service/whois-service/rdap-service
  // Answers 404/200 correctly but sends no Access-Control-Allow-Origin on
  // either, unlike every gTLD registry and every other ccTLD checked.
  // Verified 2026-08-02.
  de: {
    urls: ['https://rdap.denic.de/'],
    browserBlocked: true,
  },
};

/**
 * Accepts a registry base URL only if it is safe to fetch and to render as a
 * link. This is the trust boundary for remote bootstrap data: everything the
 * app later requests or links to has passed through here.
 */
export function normalizeRegistryUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // Reject cleartext (no downgrade from an HTTPS page) and every exotic scheme,
  // `javascript:` above all — these strings end up in `href` attributes.
  if (parsed.protocol !== 'https:') return null;
  // Embedded credentials would be leaked into the UI and into exports.
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.hostname === '') return null;

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/** Normalises a suffix key: lowercase, no surrounding dots. */
function normalizeSuffix(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const suffix = raw
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return suffix.length === 0 ? null : suffix;
}

/**
 * Validates and flattens IANA's `{ services: [[[tlds], [urls]], …] }` payload.
 *
 * Written defensively on purpose: this is untrusted remote JSON, so every
 * level is shape-checked and malformed entries are skipped rather than
 * aborting the whole load.
 */
export function parseBootstrapPayload(payload: unknown): {
  services: Map<string, BootstrapService>;
  publication: string | null;
} {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Bootstrap payload is not an object');
  }

  const record = payload as Record<string, unknown>;
  const rawServices = record['services'];
  if (!Array.isArray(rawServices)) {
    throw new Error('Bootstrap payload has no services array');
  }

  const services = new Map<string, BootstrapService>();

  for (const entry of rawServices) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [rawSuffixes, rawUrls] = entry as [unknown, unknown];
    if (!Array.isArray(rawSuffixes) || !Array.isArray(rawUrls)) continue;

    const urls = rawUrls.map(normalizeRegistryUrl).filter((url): url is string => url !== null);
    if (urls.length === 0) continue;

    for (const rawSuffix of rawSuffixes) {
      const suffix = normalizeSuffix(rawSuffix);
      if (suffix === null) continue;
      services.set(suffix, { suffix, urls, origin: 'iana', browserBlocked: false });
    }
  }

  if (services.size === 0) {
    throw new Error('Bootstrap payload contained no usable services');
  }

  const publication = record['publication'];
  return { services, publication: typeof publication === 'string' ? publication : null };
}

/** Adds manual entries for suffixes IANA does not cover. Returns how many. */
function applyManualOverrides(services: Map<string, BootstrapService>): number {
  let added = 0;

  for (const [rawSuffix, override] of Object.entries(MANUAL_OVERRIDES)) {
    const suffix = normalizeSuffix(rawSuffix);
    if (suffix === null || services.has(suffix)) continue;

    const urls = override.urls
      .map(normalizeRegistryUrl)
      .filter((url): url is string => url !== null);
    if (urls.length === 0) continue;

    services.set(suffix, {
      suffix,
      urls,
      origin: 'manual',
      browserBlocked: override.browserBlocked ?? false,
    });
    added += 1;
  }

  return added;
}

/**
 * Finds the RDAP service responsible for a domain by longest-suffix match
 * (RFC 7484 §4). `shop.example.co.uk` prefers a `co.uk` entry over `uk`.
 */
export function findService(
  registry: BootstrapRegistry,
  asciiDomain: string,
): BootstrapService | null {
  const labels = asciiDomain.split('.');
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    const service = registry.services.get(candidate);
    if (service !== undefined) return service;
  }
  return null;
}

/** Compact cache record — smaller than the raw IANA payload. */
interface CachedBootstrap {
  readonly v: 1;
  readonly fetchedAt: number;
  readonly publication: string | null;
  readonly entries: readonly (readonly [string, readonly string[]])[];
}

function isCachedBootstrap(value: unknown): value is CachedBootstrap {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['v'] === 1 &&
    typeof record['fetchedAt'] === 'number' &&
    (typeof record['publication'] === 'string' || record['publication'] === null) &&
    Array.isArray(record['entries'])
  );
}

function buildRegistry(
  services: Map<string, BootstrapService>,
  publication: string | null,
  fetchedAt: number,
  stale: boolean,
): BootstrapRegistry {
  const manualCount = applyManualOverrides(services);
  return { services, publication, manualCount, fetchedAt, stale };
}

function fromCache(cached: CachedBootstrap, stale: boolean): BootstrapRegistry | null {
  const services = new Map<string, BootstrapService>();
  for (const entry of cached.entries) {
    const [suffix, urls] = entry;
    if (typeof suffix !== 'string' || !Array.isArray(urls)) continue;
    const safeUrls = urls.map(normalizeRegistryUrl).filter((url): url is string => url !== null);
    if (safeUrls.length === 0) continue;
    // Only IANA entries are cached; the manual table is re-applied from source.
    services.set(suffix, { suffix, urls: safeUrls, origin: 'iana', browserBlocked: false });
  }
  if (services.size === 0) return null;
  return buildRegistry(services, cached.publication, cached.fetchedAt, stale);
}

function toCache(registry: BootstrapRegistry): CachedBootstrap {
  const entries: (readonly [string, readonly string[]])[] = [];
  for (const service of registry.services.values()) {
    // Manual entries are re-applied from source on every load, so they are not
    // persisted — otherwise removing one here would not take effect.
    if (service.origin === 'manual') continue;
    entries.push([service.suffix, service.urls]);
  }
  return {
    v: 1,
    fetchedAt: registry.fetchedAt,
    publication: registry.publication,
    entries,
  };
}

export interface LoadBootstrapOptions {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly url?: string | undefined;
  readonly ttlMs?: number | undefined;
  /** Skip the cache and force a network read. */
  readonly forceRefresh?: boolean | undefined;
}

/**
 * Loads the bootstrap registry, preferring a fresh cache, then the network,
 * then a stale cache.
 *
 * That last fallback is what keeps the tool usable when `data.iana.org` is
 * unreachable — a stale suffix table is dramatically better than no tool at
 * all, and the `stale` flag lets the UI say so honestly.
 */
export async function loadBootstrapRegistry(
  options: LoadBootstrapOptions = {},
): Promise<BootstrapRegistry> {
  const now = options.now ?? Date.now;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const ttlMs = options.ttlMs ?? BOOTSTRAP_TTL_MS;
  const url = options.url ?? IANA_BOOTSTRAP_URL;

  const cached = readJson(StorageKeys.bootstrap, isCachedBootstrap);

  if (cached !== null && options.forceRefresh !== true && now() - cached.fetchedAt < ttlMs) {
    const registry = fromCache(cached, false);
    if (registry !== null) return registry;
  }

  try {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

    const response = await doFetch(url, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);

    const payload: unknown = await response.json();
    const { services, publication } = parseBootstrapPayload(payload);
    const registry = buildRegistry(services, publication, now(), false);
    writeJson(StorageKeys.bootstrap, toCache(registry));
    return registry;
  } catch (error) {
    if (cached !== null) {
      const registry = fromCache(cached, true);
      if (registry !== null) return registry;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
