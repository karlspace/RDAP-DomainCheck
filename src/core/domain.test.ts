import { describe, expect, it } from 'vitest';
import {
  MAX_DOMAINS_PER_RUN,
  expandMatrix,
  isValidAsciiDomain,
  looksLikeSubdomain,
  normalizeDomain,
  parseDomainList,
} from './domain.js';

describe('normalizeDomain', () => {
  it('accepts a plain domain unchanged', () => {
    expect(normalizeDomain('example.com')).toEqual({
      ascii: 'example.com',
      display: 'example.com',
      isIdn: false,
    });
  });

  it.each([
    ['https://example.com/path?q=1', 'example.com'],
    ['http://example.com', 'example.com'],
    ['EXAMPLE.COM', 'example.com'],
    ['  example.com  ', 'example.com'],
    ['example.com.', 'example.com'],
    ['example.com:8443', 'example.com'],
    ['*.example.com', 'example.com'],
    ['- example.com', 'example.com'],
    ['www.example.com', 'www.example.com'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeDomain(input)?.ascii).toBe(expected);
  });

  it('extracts the domain from an e-mail address', () => {
    // Pasting a contact list is a real workflow; the host part is what matters.
    expect(normalizeDomain('info@example.com')?.ascii).toBe('example.com');
  });

  it('converts IDN to punycode while keeping the typed form for display', () => {
    const result = normalizeDomain('münchen.de');
    expect(result).toEqual({ ascii: 'xn--mnchen-3ya.de', display: 'münchen.de', isIdn: true });
  });

  it('accepts an IDN top-level domain in A-label form', () => {
    // `[a-z]{2,63}` alone would reject every punycode TLD.
    expect(isValidAsciiDomain('beispiel.xn--80asehdb')).toBe(true);
  });

  it.each([
    ['', 'empty input'],
    ['localhost', 'no dot'],
    ['192.168.1.1', 'IPv4 literal'],
    ['[2001:db8::1]', 'IPv6 literal'],
    ['-example.com', 'label starts with a hyphen'],
    ['example-.com', 'label ends with a hyphen'],
    ['exa mple.com', 'space in the host'],
    ['foo_bar.com', 'underscore is not a hostname character'],
    ['example.123', 'numeric top-level domain'],
    ['example.c', 'single-character top-level domain'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });

  it('rejects names longer than the DNS limit', () => {
    const long = `${'a'.repeat(60)}.`.repeat(5) + 'com';
    expect(long.length).toBeGreaterThan(253);
    expect(normalizeDomain(long)).toBeNull();
  });
});

describe('parseDomainList', () => {
  it('splits on newlines, commas, semicolons and whitespace', () => {
    const parsed = parseDomainList('a.com\nb.com, c.com; d.com e.com');
    expect(parsed.domains.map((domain) => domain.ascii)).toEqual([
      'a.com',
      'b.com',
      'c.com',
      'd.com',
      'e.com',
    ]);
  });

  it('deduplicates by the queried (ascii) form', () => {
    const parsed = parseDomainList('Example.com\nhttps://example.com\nexample.com.');
    expect(parsed.domains).toHaveLength(1);
  });

  it('collects unparseable tokens instead of failing the batch', () => {
    const parsed = parseDomainList('good.com\nnope\nalso bad!!');
    expect(parsed.domains.map((domain) => domain.ascii)).toEqual(['good.com']);
    expect(parsed.rejected).toContain('nope');
  });

  it('deduplicates rejected tokens as well', () => {
    const parsed = parseDomainList('nope\nnope\nnope');
    expect(parsed.rejected).toEqual(['nope']);
  });

  it('caps the batch and reports the truncation', () => {
    const many = Array.from({ length: MAX_DOMAINS_PER_RUN + 25 }, (_, i) => `d${String(i)}.com`);
    const parsed = parseDomainList(many.join('\n'));
    expect(parsed.domains).toHaveLength(MAX_DOMAINS_PER_RUN);
    expect(parsed.truncated).toBe(true);
  });

  it('returns an empty result for blank input', () => {
    expect(parseDomainList('   \n\n  ')).toEqual({
      domains: [],
      rejected: [],
      truncated: false,
    });
  });
});

describe('expandMatrix', () => {
  it('builds the cartesian product of names and endings', () => {
    const result = expandMatrix('acme\nzenith', 'de com');
    expect(result.map((domain) => domain.ascii)).toEqual([
      'acme.de',
      'acme.com',
      'zenith.de',
      'zenith.com',
    ]);
  });

  it('strips an ending the user already typed on the name', () => {
    expect(expandMatrix('acme.com', 'de')[0]?.ascii).toBe('acme.de');
  });

  it('tolerates leading dots on endings', () => {
    expect(expandMatrix('acme', '.de, .com').map((d) => d.ascii)).toEqual(['acme.de', 'acme.com']);
  });

  it('drops combinations that cannot be valid domains', () => {
    expect(expandMatrix('acme', '123')).toHaveLength(0);
  });

  it('respects the batch cap', () => {
    const names = Array.from({ length: 60 }, (_, i) => `n${String(i)}`).join(' ');
    const tlds = Array.from({ length: 20 }, (_, i) => `t${String(i)}xx`).join(' ');
    expect(expandMatrix(names, tlds).length).toBeLessThanOrEqual(MAX_DOMAINS_PER_RUN);
  });
});

describe('looksLikeSubdomain', () => {
  it('accepts a registrable name under a single-label suffix', () => {
    expect(looksLikeSubdomain('acme.de', 'de')).toBe(false);
  });

  it('accepts a registrable name under a multi-label suffix', () => {
    expect(looksLikeSubdomain('acme.co.uk', 'co.uk')).toBe(false);
  });

  it('flags an extra label as a probable subdomain', () => {
    expect(looksLikeSubdomain('shop.acme.de', 'de')).toBe(true);
  });
});
