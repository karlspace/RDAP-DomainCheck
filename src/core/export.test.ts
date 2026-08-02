import { describe, expect, it } from 'vitest';
import type { CheckResult } from './types.js';
import { escapeCsvCell, exportFilename, toCsv, toJson, toPlainList } from './export.js';

const RESULT: CheckResult = {
  domain: { ascii: 'acme.com', display: 'acme.com', isIdn: false },
  suffix: 'com',
  status: 'registered',
  confidence: 'authoritative',
  registry: 'https://rdap.verisign.com/com/v1',
  queryUrl: 'https://rdap.verisign.com/com/v1/domain/acme.com',
  httpStatus: 200,
  warnings: [],
  durationMs: 143,
  details: {
    registrar: 'MarkMonitor Inc.',
    registered: '1995-08-13T04:00:00Z',
    expires: '2027-08-12T04:00:00Z',
    statuses: ['client transfer prohibited'],
    nameservers: ['ns1.acme.com'],
    dnssec: true,
  },
};

const options = { labelFor: (status: string) => status };

describe('escapeCsvCell', () => {
  it('quotes every field and doubles inner quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'defuses a cell starting with %j so spreadsheets read it as text',
    (trigger) => {
      expect(escapeCsvCell(`${trigger}HYPERLINK("http://evil")`)).toMatch(/^"'/);
    },
  );

  it('leaves an ordinary value alone', () => {
    expect(escapeCsvCell('acme.com')).toBe('"acme.com"');
  });

  it('handles an empty value', () => {
    expect(escapeCsvCell('')).toBe('""');
  });
});

describe('toCsv', () => {
  it('starts with a BOM so Excel reads UTF-8 correctly', () => {
    expect(toCsv([RESULT], options).startsWith('\uFEFF')).toBe(true);
  });

  it('writes a header and one row per result', () => {
    const lines = toCsv([RESULT], options).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"domain"');
    expect(lines[1]).toContain('"acme.com"');
    expect(lines[1]).toContain('"MarkMonitor Inc."');
  });

  it('neutralises a formula injected through registry data', () => {
    const hostile: CheckResult = {
      ...RESULT,
      details: { ...RESULT.details!, registrar: '=HYPERLINK("http://evil","click")' },
    };
    expect(toCsv([hostile], options)).toContain('"\'=HYPERLINK');
  });

  it('emits empty cells for missing details', () => {
    const bare: CheckResult = {
      domain: { ascii: 'free.com', display: 'free.com', isIdn: false },
      suffix: 'com',
      status: 'available',
      confidence: 'authoritative',
      warnings: [],
    };
    expect(() => toCsv([bare], options)).not.toThrow();
    expect(toCsv([bare], options)).toContain('"free.com"');
  });
});

describe('toJson', () => {
  it('round-trips into a structured document', () => {
    const parsed: unknown = JSON.parse(toJson([RESULT], '2026-08-02T10:00:00.000Z'));
    expect(parsed).toMatchObject({
      generatedAt: '2026-08-02T10:00:00.000Z',
      count: 1,
      results: [{ domain: 'acme.com', status: 'registered' }],
    });
  });
});

describe('toPlainList', () => {
  it('returns queryable names, one per line', () => {
    expect(toPlainList([RESULT, RESULT])).toBe('acme.com\nacme.com');
  });
});

describe('exportFilename', () => {
  it('builds a sortable, filesystem-safe name', () => {
    expect(exportFilename('csv', new Date(2026, 7, 2, 14, 35))).toBe(
      'domaincheck-2026-08-02-1435.csv',
    );
  });
});
