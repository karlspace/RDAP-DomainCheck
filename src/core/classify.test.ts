import { describe, expect, it } from 'vitest';
import type { RdapResponse } from './rdap.js';
import { classifyResponse, isConclusive } from './classify.js';

function response(overrides: Partial<RdapResponse>): RdapResponse {
  return {
    url: 'https://rdap.example.com/domain/acme.com',
    httpStatus: null,
    body: null,
    failure: null,
    diagnostic: null,
    durationMs: 10,
    attempts: 1,
    ...overrides,
  };
}

const DOMAIN_BODY = {
  objectClassName: 'domain',
  ldhName: 'acme.com',
  status: ['client transfer prohibited'],
};

describe('classifyResponse', () => {
  it('treats 404 as an authoritative "available"', () => {
    const result = classifyResponse(response({ httpStatus: 404 }));
    expect(result.status).toBe('available');
    expect(result.confidence).toBe('authoritative');
  });

  it('treats a domain object as registered and keeps its details', () => {
    const result = classifyResponse(response({ httpStatus: 200, body: DOMAIN_BODY }));
    expect(result.status).toBe('registered');
    expect(result.confidence).toBe('authoritative');
    expect(result.details?.statuses).toEqual(['client transfer prohibited']);
  });

  it('reports reserved names separately from registered ones', () => {
    const result = classifyResponse(
      response({ httpStatus: 200, body: { ...DOMAIN_BODY, status: ['reserved'] } }),
    );
    expect(result.status).toBe('reserved');
  });

  it('honours an embedded errorCode over the HTTP status', () => {
    // Some registries answer 200 with an RDAP error object.
    const result = classifyResponse(
      response({ httpStatus: 200, body: { errorCode: 404, title: 'Not Found' } }),
    );
    expect(result.status).toBe('available');
  });

  it('never claims "available" for an unrecognisable 200', () => {
    const result = classifyResponse(response({ httpStatus: 200, body: { hello: 'world' } }));
    expect(result.status).toBe('registered');
    expect(result.confidence).toBe('indicative');
    expect(result.warnings).toContain('unexpected-payload');
  });

  it.each([
    [400, 'invalid'],
    [422, 'invalid'],
    [403, 'blocked'],
    [451, 'blocked'],
    [429, 'rate-limited'],
    [500, 'registry-error'],
    [503, 'registry-error'],
    [418, 'registry-error'],
  ])('maps HTTP %i to %s', (httpStatus, expected) => {
    expect(classifyResponse(response({ httpStatus })).status).toBe(expected);
  });

  it.each([
    ['network', 'unreachable'],
    ['timeout', 'unreachable'],
    ['aborted', 'cancelled'],
  ] as const)('maps a %s failure to %s', (failure, expected) => {
    expect(classifyResponse(response({ failure })).status).toBe(expected);
  });

  it('never reports a conclusive status without a real answer', () => {
    for (const failure of ['network', 'timeout'] as const) {
      expect(isConclusive(classifyResponse(response({ failure })).status)).toBe(false);
    }
  });
});

describe('isConclusive', () => {
  it.each(['available', 'registered', 'reserved'] as const)('%s is conclusive', (status) => {
    expect(isConclusive(status)).toBe(true);
  });

  it.each(['pending', 'unreachable', 'rate-limited', 'cancelled', 'no-registry'] as const)(
    '%s is not conclusive',
    (status) => {
      expect(isConclusive(status)).toBe(false);
    },
  );
});
