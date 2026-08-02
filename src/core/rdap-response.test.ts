import { describe, expect, it } from 'vitest';
import {
  extractDomainDetails,
  extractErrorCode,
  hasReservedStatus,
  isDomainObject,
  isDropping,
} from './rdap-response.js';

/** Shaped after a real gTLD response (RFC 9083 §5.3). */
const DOMAIN_RESPONSE = {
  objectClassName: 'domain',
  handle: '2336799_DOMAIN_COM-VRSN',
  ldhName: 'acme.com',
  status: ['client transfer prohibited', 'server delete prohibited'],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-13T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-08-12T04:00:00Z' },
    { eventAction: 'last changed', eventDate: '2026-01-09T15:32:11Z' },
  ],
  entities: [
    {
      objectClassName: 'entity',
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: '292' }],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'MarkMonitor Inc.'],
        ],
      ],
    },
  ],
  nameservers: [
    { objectClassName: 'nameserver', ldhName: 'ns1.acme.com' },
    { objectClassName: 'nameserver', ldhName: 'ns2.acme.com' },
  ],
  secureDNS: { delegationSigned: true },
};

describe('isDomainObject', () => {
  it('recognises an explicit objectClassName', () => {
    expect(isDomainObject(DOMAIN_RESPONSE)).toBe(true);
  });

  it('recognises a domain object without objectClassName', () => {
    // Not every registry sets it, so a name plus a domain-ish field must do.
    expect(isDomainObject({ ldhName: 'acme.de', events: [] })).toBe(true);
  });

  it.each([null, 42, 'domain', {}, { ldhName: 'acme.de' }, []])('rejects %s', (value) => {
    expect(isDomainObject(value)).toBe(false);
  });
});

describe('extractErrorCode', () => {
  it('reads an RDAP error object', () => {
    expect(extractErrorCode({ errorCode: 404, title: 'Not Found' })).toBe(404);
  });

  it.each([DOMAIN_RESPONSE, null, { errorCode: 'nope' }])('returns null for %#', (value) => {
    expect(extractErrorCode(value)).toBeNull();
  });
});

describe('extractDomainDetails', () => {
  it('pulls out the facts worth showing', () => {
    const details = extractDomainDetails(DOMAIN_RESPONSE);
    expect(details).toEqual({
      handle: '2336799_DOMAIN_COM-VRSN',
      registrar: 'MarkMonitor Inc.',
      registrarIanaId: '292',
      registered: '1995-08-13T04:00:00Z',
      expires: '2027-08-12T04:00:00Z',
      updated: '2026-01-09T15:32:11Z',
      statuses: ['client transfer prohibited', 'server delete prohibited'],
      nameservers: ['ns1.acme.com', 'ns2.acme.com'],
      dnssec: true,
    });
  });

  it('matches event actions case-insensitively', () => {
    const details = extractDomainDetails({
      ...DOMAIN_RESPONSE,
      events: [{ eventAction: 'Registration', eventDate: '2020-01-01T00:00:00Z' }],
    });
    expect(details?.registered).toBe('2020-01-01T00:00:00Z');
  });

  it('finds a registrar nested one level deep', () => {
    const details = extractDomainDetails({
      ...DOMAIN_RESPONSE,
      entities: [
        {
          roles: ['registrant'],
          entities: [
            {
              roles: ['registrar'],
              vcardArray: ['vcard', [['fn', {}, 'text', 'Nested Registrar GmbH']]],
            },
          ],
        },
      ],
    });
    expect(details?.registrar).toBe('Nested Registrar GmbH');
  });

  it('returns null for a non-domain payload', () => {
    expect(extractDomainDetails({ errorCode: 404 })).toBeNull();
  });

  it('survives a response where every optional field is garbage', () => {
    const details = extractDomainDetails({
      objectClassName: 'domain',
      ldhName: 'acme.com',
      status: 'not-an-array',
      events: [null, 42, { eventAction: 'registration' }],
      entities: 'nope',
      nameservers: [{}, { ldhName: 5 }],
      secureDNS: 'yes',
    });

    expect(details).toEqual({
      handle: undefined,
      registrar: undefined,
      registrarIanaId: undefined,
      registered: undefined,
      updated: undefined,
      expires: undefined,
      statuses: [],
      nameservers: [],
      dnssec: undefined,
    });
  });

  it('caps pathological list lengths', () => {
    const details = extractDomainDetails({
      objectClassName: 'domain',
      ldhName: 'acme.com',
      status: Array.from({ length: 500 }, (_, i) => `s${String(i)}`),
      nameservers: Array.from({ length: 500 }, (_, i) => ({ ldhName: `ns${String(i)}.acme.com` })),
    });

    expect(details?.statuses.length).toBeLessThanOrEqual(24);
    expect(details?.nameservers.length).toBeLessThanOrEqual(16);
  });
});

describe('status helpers', () => {
  it('detects reserved names', () => {
    expect(hasReservedStatus(['reserved'])).toBe(true);
    expect(hasReservedStatus(['client transfer prohibited'])).toBe(false);
  });

  it('detects names on their way back to the pool', () => {
    expect(isDropping(['pending delete'])).toBe(true);
    expect(isDropping(['redemptionPeriod'])).toBe(true);
    expect(isDropping(['active'])).toBe(false);
  });
});
