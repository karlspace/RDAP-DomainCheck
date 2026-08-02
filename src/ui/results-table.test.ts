// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CheckResult, RowStatus } from '../core/types.js';
import {
  ResultsTable,
  isStatusFilter,
  matchesFilter,
  statusGroup,
  statusLabel,
} from './results-table.js';
import { setLocale } from '../i18n/index.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    domain: { ascii: 'acme.com', display: 'acme.com', isIdn: false },
    suffix: 'com',
    status: 'available',
    confidence: 'authoritative',
    warnings: [],
    ...overrides,
  };
}

function makeTable(): { table: ResultsTable; body: HTMLTableSectionElement } {
  const body = document.createElement('tbody');
  document.body.replaceChildren(body);
  return { table: new ResultsTable(body), body };
}

beforeEach(() => {
  installMemoryStorage();
  setLocale('de');
});

describe('statusGroup', () => {
  it.each([
    ['available', 'available'],
    ['registered', 'registered'],
    ['reserved', 'registered'],
    ['pending', 'pending'],
    ['running', 'pending'],
    ['unreachable', 'inconclusive'],
    ['rate-limited', 'inconclusive'],
    ['no-registry', 'inconclusive'],
    ['cancelled', 'inconclusive'],
  ] as [RowStatus, string][])('maps %s to %s', (status, group) => {
    expect(statusGroup(status)).toBe(group);
  });
});

describe('statusLabel', () => {
  it('translates every status', () => {
    expect(statusLabel('available')).toBe('Frei');
    setLocale('en');
    expect(statusLabel('available')).toBe('Available');
  });
});

describe('isStatusFilter', () => {
  it.each(['all', 'available', 'registered', 'inconclusive'])('accepts %s', (value) => {
    expect(isStatusFilter(value)).toBe(true);
  });

  it.each(['pending', '', null, 42])('rejects %s', (value) => {
    expect(isStatusFilter(value)).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('passes everything through the "all" filter', () => {
    expect(matchesFilter(result({ status: 'unreachable' }), 'all', '')).toBe(true);
  });

  it('filters by status group', () => {
    expect(matchesFilter(result({ status: 'reserved' }), 'registered', '')).toBe(true);
    expect(matchesFilter(result({ status: 'reserved' }), 'available', '')).toBe(false);
  });

  it('searches the display name', () => {
    expect(matchesFilter(result(), 'all', 'ACM')).toBe(true);
    expect(matchesFilter(result(), 'all', 'zzz')).toBe(false);
  });

  it('searches the punycode form of an IDN', () => {
    const idn = result({
      domain: { ascii: 'xn--mnchen-3ya.de', display: 'münchen.de', isIdn: true },
    });
    expect(matchesFilter(idn, 'all', 'xn--mnchen')).toBe(true);
    expect(matchesFilter(idn, 'all', 'münch')).toBe(true);
  });

  it('searches the registrar', () => {
    const withRegistrar = result({
      details: { registrar: 'MarkMonitor Inc.', statuses: [], nameservers: [] },
    });
    expect(matchesFilter(withRegistrar, 'all', 'markmonitor')).toBe(true);
  });

  it('ignores a whitespace-only query', () => {
    expect(matchesFilter(result(), 'all', '   ')).toBe(true);
  });
});

describe('ResultsTable', () => {
  it('renders one summary row and one detail row per result', () => {
    const { table, body } = makeTable();
    table.setResults([
      result(),
      result({ domain: { ascii: 'b.com', display: 'b.com', isIdn: false } }),
    ]);

    expect(body.querySelectorAll('.result-row')).toHaveLength(2);
    expect(body.querySelectorAll('.detail-row')).toHaveLength(2);
  });

  it('renders untrusted registry data as text, never as markup', () => {
    const { table, body } = makeTable();
    table.setResults([
      result({
        status: 'registered',
        details: {
          registrar: '<img src=x onerror="alert(1)">',
          statuses: [],
          nameservers: [],
        },
      }),
    ]);

    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('.cell-registrar')?.textContent).toContain('<img');
  });

  it('updates a row in place as its lookup settles', () => {
    const { table, body } = makeTable();
    table.setResults([result({ status: 'pending' })]);
    expect(body.querySelector('.result-row')?.getAttribute('data-status')).toBe('pending');

    table.updateResult(0, result({ status: 'registered' }));
    expect(body.querySelector('.result-row')?.getAttribute('data-status')).toBe('registered');
  });

  it('ignores an update for an unknown index', () => {
    const { table } = makeTable();
    table.setResults([result()]);
    expect(() => {
      table.updateResult(99, result());
    }).not.toThrow();
  });

  it('shows the punycode form only for IDN domains', () => {
    const { table, body } = makeTable();
    table.setResults([
      result({ domain: { ascii: 'xn--mnchen-3ya.de', display: 'münchen.de', isIdn: true } }),
      result(),
    ]);

    expect(body.querySelectorAll('.domain-ascii')).toHaveLength(1);
    expect(body.querySelector('.domain-ascii')?.textContent).toBe('xn--mnchen-3ya.de');
  });

  it('marks a merely indicative answer', () => {
    const { table, body } = makeTable();
    table.setResults([result({ confidence: 'indicative', warnings: ['possible-subdomain'] })]);
    expect(body.querySelector('.badge-soft')).not.toBeNull();
    expect(body.querySelector('.badge-warn')).not.toBeNull();
  });

  it('marks a domain that is dropping back to the pool', () => {
    const { table, body } = makeTable();
    table.setResults([
      result({
        status: 'registered',
        details: { statuses: ['pending delete'], nameservers: [] },
      }),
    ]);
    expect(body.querySelector('.badge-drop')?.textContent).toBe('wird frei');
  });

  it('expands and collapses the detail row', () => {
    const { table, body } = makeTable();
    table.setResults([result({ status: 'registered', queryUrl: 'https://rdap.example/x' })]);

    const toggle = body.querySelector<HTMLButtonElement>('.disclosure');
    const detail = body.querySelector('.detail-row');
    expect(detail?.hasAttribute('hidden')).toBe(true);

    toggle?.click();
    expect(detail?.hasAttribute('hidden')).toBe(false);
    expect(detail?.querySelector('.detail-grid')).not.toBeNull();
    expect(detail?.querySelector<HTMLAnchorElement>('.detail-link')?.href).toBe(
      'https://rdap.example/x',
    );

    toggle?.click();
    expect(detail?.hasAttribute('hidden')).toBe(true);
  });

  it('does not link to a non-https RDAP URL', () => {
    const { table, body } = makeTable();
    table.setResults([result({ queryUrl: 'javascript:alert(1)' })]);
    body.querySelector<HTMLButtonElement>('.disclosure')?.click();
    expect(body.querySelector('.detail-link')?.hasAttribute('href')).toBe(false);
  });

  it('hides rows that do not match the filter and reports the visible count', () => {
    const { table, body } = makeTable();
    table.setResults([
      result({ status: 'available' }),
      result({ status: 'registered', domain: { ascii: 'b.com', display: 'b.com', isIdn: false } }),
    ]);

    expect(table.applyFilter('available', '')).toBe(1);
    const rows = [...body.querySelectorAll('.result-row')];
    expect(rows[0]?.hasAttribute('hidden')).toBe(false);
    expect(rows[1]?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the active filter when a later result arrives', () => {
    const { table, body } = makeTable();
    table.setResults([result({ status: 'pending' })]);
    table.applyFilter('available', '');

    table.updateResult(0, result({ status: 'registered' }));
    expect(body.querySelector('.result-row')?.hasAttribute('hidden')).toBe(true);
  });

  it('exposes all and visible results separately', () => {
    const { table } = makeTable();
    table.setResults([
      result({ status: 'available' }),
      result({ status: 'registered', domain: { ascii: 'b.com', display: 'b.com', isIdn: false } }),
    ]);

    table.applyFilter('available', '');
    expect(table.results).toHaveLength(2);
    expect(table.visibleResults).toHaveLength(1);
  });

  it('re-renders labels after a language switch', () => {
    const { table, body } = makeTable();
    table.setResults([result()]);
    expect(body.querySelector('.pill')?.textContent).toContain('Frei');

    setLocale('en');
    table.refresh();
    expect(body.querySelector('.pill')?.textContent).toContain('Available');
  });
});
