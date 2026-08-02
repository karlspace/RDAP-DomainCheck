import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_TTL_MS,
  findService,
  loadBootstrapRegistry,
  normalizeRegistryUrl,
  parseBootstrapPayload,
} from './bootstrap.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

const PAYLOAD = {
  publication: '2026-07-15T00:00:00Z',
  services: [
    [['com', 'net'], ['https://rdap.verisign.com/com/v1/']],
    [['uk'], ['https://rdap.nominet.uk/uk/']],
    [['co.uk'], ['https://rdap.nominet.uk/couk/']],
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeRegistryUrl', () => {
  it('keeps an https URL and strips the trailing slash', () => {
    expect(normalizeRegistryUrl('https://rdap.example.com/v1/')).toBe(
      'https://rdap.example.com/v1',
    );
  });

  it('drops query strings and fragments', () => {
    expect(normalizeRegistryUrl('https://rdap.example.com/v1?a=1#x')).toBe(
      'https://rdap.example.com/v1',
    );
  });

  it.each([
    ['http://rdap.example.com/', 'cleartext would downgrade the page'],
    ['javascript:alert(1)', 'script scheme could reach an href'],
    ['data:text/html,<script>', 'data scheme could reach an href'],
    ['https://user:pw@rdap.example.com/', 'embedded credentials would leak'],
    ['not a url', 'unparseable'],
    [42, 'not a string'],
  ])('rejects %s (%s)', (input, _reason) => {
    expect(normalizeRegistryUrl(input)).toBeNull();
  });
});

describe('parseBootstrapPayload', () => {
  it('flattens services into a suffix map', () => {
    const { services, publication } = parseBootstrapPayload(PAYLOAD);
    expect(publication).toBe('2026-07-15T00:00:00Z');
    expect(services.get('com')?.urls).toEqual(['https://rdap.verisign.com/com/v1']);
    expect(services.get('net')?.origin).toBe('iana');
  });

  it('skips malformed entries instead of failing the whole load', () => {
    const { services } = parseBootstrapPayload({
      services: [
        'garbage',
        [['ok']],
        [['bad'], ['http://insecure.example']],
        [[42], ['https://rdap.example.com/']],
        [['good'], ['https://rdap.example.com/']],
      ],
    });
    expect([...services.keys()]).toEqual(['good']);
  });

  it.each([
    [null, 'null payload'],
    [{}, 'no services key'],
    [{ services: [] }, 'no usable services'],
  ])('throws for %s', (payload, _reason) => {
    expect(() => parseBootstrapPayload(payload)).toThrow();
  });
});

describe('findService', () => {
  const registry = {
    services: parseBootstrapPayload(PAYLOAD).services,
    publication: null,
    manualCount: 0,
    fetchedAt: 0,
    stale: false,
  };

  it('matches the longest suffix, not the last label', () => {
    expect(findService(registry, 'acme.co.uk')?.suffix).toBe('co.uk');
  });

  it('falls back to the shorter suffix when no longer one exists', () => {
    expect(findService(registry, 'acme.uk')?.suffix).toBe('uk');
  });

  it('matches through additional labels', () => {
    expect(findService(registry, 'shop.acme.com')?.suffix).toBe('com');
  });

  it('returns null for an unknown TLD', () => {
    expect(findService(registry, 'acme.invalidtld')).toBeNull();
  });
});

describe('loadBootstrapRegistry', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, applies manual overrides and reports counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const registry = await loadBootstrapRegistry({ fetchImpl, now: () => 1000 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(registry.stale).toBe(false);
    // `.de` is missing from the fixture, so the override fills the gap.
    expect(registry.manualCount).toBe(1);
    expect(registry.services.get('de')?.origin).toBe('manual');
  });

  it('lets IANA win over a manual override for the same suffix', async () => {
    const withDe = {
      ...PAYLOAD,
      services: [...PAYLOAD.services, [['de'], ['https://rdap.denic.example/']]],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(withDe));
    const registry = await loadBootstrapRegistry({ fetchImpl, now: () => 1000 });

    expect(registry.manualCount).toBe(0);
    expect(registry.services.get('de')?.origin).toBe('iana');
  });

  it('serves a fresh cache without touching the network', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    await loadBootstrapRegistry({ fetchImpl, now: () => 1000 });

    const second = await loadBootstrapRegistry({ fetchImpl, now: () => 1000 + 60_000 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(second.services.get('com')).toBeDefined();
    expect(second.stale).toBe(false);
  });

  it('refetches once the cache has expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    await loadBootstrapRegistry({ fetchImpl, now: () => 0 });
    await loadBootstrapRegistry({ fetchImpl, now: () => BOOTSTRAP_TTL_MS + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to a stale cache when IANA is unreachable', async () => {
    const ok = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    await loadBootstrapRegistry({ fetchImpl: ok, now: () => 0 });

    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const registry = await loadBootstrapRegistry({
      fetchImpl: failing,
      now: () => BOOTSTRAP_TTL_MS + 1,
    });

    expect(registry.stale).toBe(true);
    expect(registry.services.get('com')).toBeDefined();
  });

  it('rejects when the network fails and nothing is cached', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(loadBootstrapRegistry({ fetchImpl: failing })).rejects.toThrow('offline');
  });

  it('treats a non-OK response as a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(loadBootstrapRegistry({ fetchImpl })).rejects.toThrow('HTTP 503');
  });
});
