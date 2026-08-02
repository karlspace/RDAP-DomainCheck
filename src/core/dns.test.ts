import { describe, expect, it, vi } from 'vitest';
import { DohResolver } from './dns.js';

/** Shaped after a real Cloudflare DoH answer for a delegated name. */
const DELEGATED = {
  Status: 0,
  Answer: [
    { name: 'denic.de.', type: 2, TTL: 3600, data: 'a.nic.de.' },
    { name: 'denic.de.', type: 2, TTL: 3600, data: 'f.nic.de.' },
  ],
};

const NXDOMAIN = {
  Status: 3,
  Authority: [{ name: 'de.', type: 6, TTL: 3600, data: 'f.nic.de. its.denic.de. 1 2 3 4 5' }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/dns-json' },
  });
}

const resolver = (fetchImpl: typeof fetch): DohResolver => new DohResolver({ fetchImpl });

describe('DohResolver.lookupDelegation', () => {
  it('reports delegation when NS records exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(DELEGATED));
    const result = await resolver(fetchImpl).lookupDelegation('denic.de');

    expect(result.status).toBe('delegated');
    expect(result.nameservers).toEqual(['a.nic.de', 'f.nic.de']);
  });

  it('queries the NS record type for the given name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(DELEGATED));
    await resolver(fetchImpl).lookupDelegation('denic.de');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cloudflare-dns.com/dns-query?name=denic.de&type=NS',
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
  });

  it('never turns NXDOMAIN into an availability claim', async () => {
    // The whole point of the module: this direction is not sound, so the type
    // has no value to express it.
    const fetchImpl = vi.fn().mockResolvedValue(json(NXDOMAIN));
    const result = await resolver(fetchImpl).lookupDelegation('djdudjd.de');

    expect(result.status).toBe('unknown');
    expect(result.nameservers).toEqual([]);
  });

  it.each([
    ['NOERROR without an answer section', { Status: 0 }],
    ['NOERROR with an empty answer section', { Status: 0, Answer: [] }],
    ['answers of other record types only', { Status: 0, Answer: [{ type: 1, data: '1.2.3.4' }] }],
    ['a malformed payload', { nonsense: true }],
    ['a null payload', null],
    ['answer entries without data', { Status: 0, Answer: [{ type: 2 }] }],
  ])('stays unknown for %s', async (_label, payload) => {
    const fetchImpl = vi.fn().mockResolvedValue(json(payload));
    expect((await resolver(fetchImpl).lookupDelegation('acme.de')).status).toBe('unknown');
  });

  it('stays unknown on a resolver error status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 502 }));
    const result = await resolver(fetchImpl).lookupDelegation('acme.de');

    expect(result.status).toBe('unknown');
    expect(result.diagnostic).toBe('HTTP 502');
  });

  it('stays unknown on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await resolver(fetchImpl).lookupDelegation('acme.de')).status).toBe('unknown');
  });

  it('stays unknown on a malformed body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('{ broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    const result = await resolver(fetchImpl).lookupDelegation('acme.de');

    expect(result.status).toBe('unknown');
    expect(result.diagnostic).toContain('not valid JSON');
  });

  it('does not query at all once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const result = await resolver(fetchImpl).lookupDelegation('acme.de', controller.signal);
    expect(result.status).toBe('unknown');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps an absurd number of name servers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        Status: 0,
        Answer: Array.from({ length: 200 }, (_, i) => ({
          type: 2,
          data: `ns${String(i)}.acme.de.`,
        })),
      }),
    );
    const result = await resolver(fetchImpl).lookupDelegation('acme.de');
    expect(result.nameservers.length).toBeLessThanOrEqual(16);
  });

  it('honours a custom resolver URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(DELEGATED));
    await new DohResolver({ fetchImpl, url: 'https://dns.example/resolve' }).lookupDelegation(
      'acme.de',
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://dns.example/resolve?name=acme.de&type=NS',
      expect.anything(),
    );
  });
});
