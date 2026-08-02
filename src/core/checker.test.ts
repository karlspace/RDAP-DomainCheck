import { describe, expect, it, vi } from 'vitest';
import type { BootstrapRegistry, BootstrapService, CheckResult } from './types.js';
import type { RdapClient, RdapResponse } from './rdap.js';
import { checkDomain, pendingResult, runCheck, summarize } from './checker.js';
import { normalizeDomain } from './domain.js';

function service(suffix: string, origin: 'iana' | 'manual' = 'iana'): BootstrapService {
  return { suffix, urls: [`https://rdap.${suffix}.example`], origin };
}

function registry(
  entries: readonly BootstrapService[],
  overrides: Partial<BootstrapRegistry> = {},
): BootstrapRegistry {
  return {
    services: new Map(entries.map((entry) => [entry.suffix, entry])),
    publication: null,
    manualCount: 0,
    fetchedAt: 0,
    stale: false,
    ...overrides,
  };
}

/** A client that answers with a fixed response, without any network. */
function stubClient(response: Partial<RdapResponse>): RdapClient {
  return {
    lookupDomain: vi.fn().mockResolvedValue({
      url: 'https://rdap.example/domain/x',
      httpStatus: null,
      body: null,
      failure: null,
      diagnostic: null,
      durationMs: 5,
      attempts: 1,
      ...response,
    } satisfies RdapResponse),
  } as unknown as RdapClient;
}

const domain = (input: string) => normalizeDomain(input)!;

describe('checkDomain', () => {
  it('reports no-registry when the TLD has no RDAP service', async () => {
    const result = await checkDomain(domain('acme.invalidtld'), {
      registry: registry([service('com')]),
      client: stubClient({ httpStatus: 404 }),
    });

    expect(result.status).toBe('no-registry');
    expect(result.suffix).toBeNull();
  });

  it('resolves an available domain and records the registry', async () => {
    const result = await checkDomain(domain('acme.com'), {
      registry: registry([service('com')]),
      client: stubClient({ httpStatus: 404 }),
    });

    expect(result.status).toBe('available');
    expect(result.confidence).toBe('authoritative');
    expect(result.suffix).toBe('com');
    expect(result.registry).toBe('https://rdap.com.example');
  });

  it('downgrades confidence when the input looks like a subdomain', async () => {
    // `shop.acme.com` returning 404 says nothing about a registrable domain.
    const result = await checkDomain(domain('shop.acme.com'), {
      registry: registry([service('com')]),
      client: stubClient({ httpStatus: 404 }),
    });

    expect(result.status).toBe('available');
    expect(result.confidence).toBe('indicative');
    expect(result.warnings).toContain('possible-subdomain');
  });

  it('flags a manually configured registry', async () => {
    const result = await checkDomain(domain('acme.de'), {
      registry: registry([service('de', 'manual')]),
      client: stubClient({ httpStatus: 404 }),
    });

    expect(result.warnings).toContain('manual-registry');
  });

  it('flags stale bootstrap data and IDN conversion', async () => {
    const result = await checkDomain(domain('münchen.de'), {
      registry: registry([service('de')], { stale: true }),
      client: stubClient({ httpStatus: 404 }),
    });

    expect(result.warnings).toEqual(expect.arrayContaining(['idn-converted', 'stale-bootstrap']));
    expect(result.domain.ascii).toBe('xn--mnchen-3ya.de');
  });
});

describe('runCheck', () => {
  it('reports every row and preserves input order by index', async () => {
    const domains = ['a.com', 'b.com', 'c.com'].map(domain);
    const received: (CheckResult | undefined)[] = [];

    await runCheck(domains, {
      registry: registry([service('com')]),
      client: stubClient({ httpStatus: 404 }),
      concurrency: 2,
      onResult: (index, result) => {
        received[index] = result;
      },
    });

    expect(received.map((result) => result?.domain.ascii)).toEqual(['a.com', 'b.com', 'c.com']);
  });
});

describe('summarize', () => {
  it('counts settled rows by bucket and ignores pending ones', () => {
    const results: CheckResult[] = [
      { ...pendingResult(domain('p.com')) },
      { ...pendingResult(domain('a.com')), status: 'available' },
      { ...pendingResult(domain('b.com')), status: 'registered' },
      { ...pendingResult(domain('c.com')), status: 'reserved' },
      { ...pendingResult(domain('d.com')), status: 'unreachable' },
    ];

    expect(summarize(results)).toEqual({
      total: 5,
      done: 4,
      available: 1,
      registered: 2,
      inconclusive: 1,
    });
  });

  it('handles an empty result set', () => {
    expect(summarize([])).toEqual({
      total: 0,
      done: 0,
      available: 0,
      registered: 0,
      inconclusive: 0,
    });
  });
});
