import { describe, expect, it, vi } from 'vitest';
import type { BootstrapService } from './types.js';
import { RdapClient, backoffDelay, parseRetryAfter } from './rdap.js';

const SERVICE: BootstrapService = {
  suffix: 'com',
  urls: ['https://rdap.example.com/v1'],
  origin: 'iana',
  browserBlocked: false,
};

const FAILOVER_SERVICE: BootstrapService = {
  suffix: 'com',
  urls: ['https://primary.example.com', 'https://secondary.example.com'],
  origin: 'iana',
  browserBlocked: false,
};

const DOMAIN_BODY = { objectClassName: 'domain', ldhName: 'acme.com' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/rdap+json', ...headers },
  });
}

/** A client whose retries do not actually wait, so tests stay fast. */
function makeClient(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}): RdapClient {
  return new RdapClient({
    fetchImpl,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    now: () => 0,
    ...overrides,
  });
}

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-08-02T10:00:00Z');
    expect(parseRetryAfter('Sun, 02 Aug 2026 10:00:05 GMT', now)).toBe(5000);
  });

  it('caps absurd values so one registry cannot stall the batch', () => {
    expect(parseRetryAfter('86400', 0)).toBe(15_000);
  });

  it('clamps a date in the past to zero', () => {
    const now = Date.parse('2026-08-02T10:00:00Z');
    expect(parseRetryAfter('Sun, 02 Aug 2026 09:00:00 GMT', now)).toBe(0);
  });

  it.each([null, '', '   ', 'soon'])('returns null for %s', (header) => {
    expect(parseRetryAfter(header, 0)).toBeNull();
  });
});

describe('backoffDelay', () => {
  it('grows with the attempt number', () => {
    expect(backoffDelay(1, () => 1)).toBe(400);
    expect(backoffDelay(2, () => 1)).toBe(800);
    expect(backoffDelay(3, () => 1)).toBe(1600);
  });

  it('is capped', () => {
    expect(backoffDelay(20, () => 1)).toBe(8000);
  });

  it('applies full jitter so retries do not resynchronise', () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(800);
  });
});

describe('RdapClient.buildQueryUrl', () => {
  it('builds the RFC 9082 lookup path', () => {
    expect(RdapClient.buildQueryUrl('https://rdap.example.com/v1/', 'acme.com')).toBe(
      'https://rdap.example.com/v1/domain/acme.com',
    );
  });
});

describe('RdapClient.lookupDomain', () => {
  it('returns the parsed body for a 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(DOMAIN_BODY));
    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual(DOMAIN_BODY);
    expect(result.failure).toBeNull();
    expect(result.attempts).toBe(1);
  });

  it('passes a 404 straight through without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);

    expect(result.httpStatus).toBe(404);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends credential-free, referrer-free requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(DOMAIN_BODY));
    await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://rdap.example.com/v1/domain/acme.com',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
  });

  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(json(DOMAIN_BODY));

    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toBe(2);
  });

  it('gives up after the attempt budget and reports the last status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    const result = await makeClient(fetchImpl, { maxAttempts: 3 }).lookupDomain(
      'acme.com',
      SERVICE,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.httpStatus).toBe(503);
  });

  it('reports a network failure with a CORS hint', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await makeClient(fetchImpl, { maxAttempts: 1 }).lookupDomain(
      'acme.com',
      SERVICE,
    );

    expect(result.failure).toBe('network');
    expect(result.httpStatus).toBeNull();
    expect(result.diagnostic).toContain('CORS');
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE, controller.signal);
    expect(result.failure).toBe('aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails over to the next registry URL on a transport failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(DOMAIN_BODY));

    const result = await makeClient(fetchImpl, { maxAttempts: 1 }).lookupDomain(
      'acme.com',
      FAILOVER_SERVICE,
    );

    expect(result.httpStatus).toBe(200);
    expect(result.url).toContain('secondary.example.com');
  });

  it('does not fail over when the first registry gave a valid answer', async () => {
    // A 404 *is* the answer; asking a second server would invent a disagreement.
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const result = await makeClient(fetchImpl).lookupDomain('acme.com', FAILOVER_SERVICE);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.url).toContain('primary.example.com');
  });

  it('limits concurrent requests to one origin', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return json(DOMAIN_BODY);
    });

    const client = makeClient(fetchImpl, { perOriginConcurrency: 1 });
    await Promise.all([
      client.lookupDomain('a.com', SERVICE),
      client.lookupDomain('b.com', SERVICE),
      client.lookupDomain('c.com', SERVICE),
    ]);

    expect(peak).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('ignores a body that is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>nope</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);
    expect(result.body).toBeNull();
    expect(result.diagnostic).toContain('Content-Type');
  });

  it('refuses to parse an oversized payload', async () => {
    const huge = JSON.stringify({ padding: 'x'.repeat(1_100_000) });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(huge, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);
    expect(result.body).toBeNull();
    expect(result.diagnostic).toBe('Response body too large');
  });

  it('survives malformed JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('{ broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await makeClient(fetchImpl).lookupDomain('acme.com', SERVICE);
    expect(result.body).toBeNull();
    expect(result.diagnostic).toContain('not valid JSON');
  });
});
