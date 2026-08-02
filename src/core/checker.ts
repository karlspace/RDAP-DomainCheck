import type {
  BootstrapRegistry,
  CheckResult,
  Confidence,
  NormalizedDomain,
  WarningCode,
} from './types.js';
import { findService } from './bootstrap.js';
import { classifyResponse } from './classify.js';
import { looksLikeSubdomain } from './domain.js';
import type { DohResolver } from './dns.js';
import { RdapClient } from './rdap.js';
import { runPool } from './pool.js';

/**
 * Orchestration layer: turns a list of normalised domains into result rows by
 * combining the bootstrap registry, the RDAP client and the availability
 * policy — and annotating each row with the caveats those layers cannot see on
 * their own.
 */

/** The row shown before a lookup has started. */
export function pendingResult(domain: NormalizedDomain): CheckResult {
  return {
    domain,
    suffix: null,
    status: 'pending',
    confidence: 'unknown',
    warnings: domain.isIdn ? ['idn-converted'] : [],
  };
}

export interface CheckOneOptions {
  readonly registry: BootstrapRegistry;
  readonly client: RdapClient;
  readonly signal?: AbortSignal | undefined;
  /**
   * Optional DNS fallback for registries that block browser access.
   *
   * Opt-in: it sends the queried name to a third-party resolver, which every
   * other request in this app deliberately avoids.
   */
  readonly dns?: DohResolver | undefined;
}

/** Resolves the registry for one domain, queries it and interprets the answer. */
export async function checkDomain(
  domain: NormalizedDomain,
  options: CheckOneOptions,
): Promise<CheckResult> {
  const { registry, client, signal } = options;

  const baseWarnings: WarningCode[] = [];
  if (domain.isIdn) baseWarnings.push('idn-converted');
  if (registry.stale) baseWarnings.push('stale-bootstrap');

  const service = findService(registry, domain.ascii);
  if (service === null) {
    return {
      domain,
      suffix: null,
      status: 'no-registry',
      confidence: 'unknown',
      warnings: baseWarnings,
    };
  }

  if (service.origin === 'manual') baseWarnings.push('manual-registry');

  const isSubdomain = looksLikeSubdomain(domain.ascii, service.suffix);
  if (isSubdomain) baseWarnings.push('possible-subdomain');

  // Skip the request entirely for a registry we know rejects cross-origin
  // reads. Sending it would spend a full timeout-and-retry cycle per domain to
  // arrive at an opaque failure indistinguishable from the network being down,
  // and would report it as "unreachable" — which reads as a broken tool even
  // though the registry is fine and its URL works in a browser tab.
  if (service.browserBlocked) {
    const queryUrl = RdapClient.buildQueryUrl(service.urls[0] ?? '', domain.ascii);

    // A name with NS records is delegated, and only registered names are
    // delegated — so this direction is sound. The converse is not, which is
    // why the resolver has no way to report "not delegated": everything else
    // falls through to the manual-check row below.
    if (options.dns !== undefined) {
      const delegation = await options.dns.lookupDelegation(domain.ascii, signal);
      if (delegation.status === 'delegated') {
        return {
          domain,
          suffix: service.suffix,
          status: 'registered',
          confidence: 'indicative',
          registry: service.urls[0],
          queryUrl,
          details: { statuses: [], nameservers: delegation.nameservers },
          warnings: [...baseWarnings, 'registry-blocks-browser', 'dns-derived'],
        };
      }
    }

    return {
      domain,
      suffix: service.suffix,
      status: 'browser-blocked',
      confidence: 'unknown',
      registry: service.urls[0],
      queryUrl,
      warnings: [...baseWarnings, 'registry-blocks-browser'],
    };
  }

  const response = await client.lookupDomain(domain.ascii, service, signal);
  const classification = classifyResponse(response);

  // A registry saying "no such object" for `shop.acme.de` is true but useless:
  // it answers about a host name, not about a registrable domain. Downgrading
  // the confidence keeps the row honest instead of advertising a free domain.
  const confidence: Confidence =
    isSubdomain && classification.status === 'available' ? 'indicative' : classification.confidence;

  return {
    domain,
    suffix: service.suffix,
    status: classification.status,
    confidence,
    registry: service.urls[0],
    queryUrl: response.url,
    httpStatus: response.httpStatus ?? undefined,
    details: classification.details ?? undefined,
    warnings: [...baseWarnings, ...classification.warnings],
    durationMs: response.durationMs,
    diagnostic: classification.diagnostic ?? undefined,
  };
}

export interface RunCheckOptions extends CheckOneOptions {
  readonly concurrency: number;
  /** Invoked as each row settles, in completion order — not input order. */
  readonly onResult: (index: number, result: CheckResult) => void;
}

/**
 * Checks a whole batch, reporting each row the moment it settles so the table
 * fills in progressively.
 */
export async function runCheck(
  domains: readonly NormalizedDomain[],
  options: RunCheckOptions,
): Promise<void> {
  await runPool(
    domains,
    async (domain, index) => {
      const result = await checkDomain(domain, options);
      options.onResult(index, result);
    },
    { concurrency: options.concurrency, signal: options.signal },
  );
}

/** Aggregate counts for the summary bar. */
export interface Summary {
  readonly total: number;
  readonly available: number;
  readonly registered: number;
  readonly inconclusive: number;
  readonly done: number;
}

export function summarize(results: readonly CheckResult[]): Summary {
  let available = 0;
  let registered = 0;
  let inconclusive = 0;
  let done = 0;

  for (const result of results) {
    if (result.status === 'pending' || result.status === 'running') continue;
    done += 1;
    if (result.status === 'available') available += 1;
    else if (result.status === 'registered' || result.status === 'reserved') registered += 1;
    else inconclusive += 1;
  }

  return { total: results.length, available, registered, inconclusive, done };
}
