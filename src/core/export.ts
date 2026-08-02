import type { CheckResult, RowStatus } from './types.js';

/**
 * Serialisers for the result table.
 *
 * Exports leave the app and get opened in spreadsheets, so they carry their own
 * injection risk — see {@link escapeCsvCell}.
 */

const CSV_COLUMNS = [
  'domain',
  'domain_ascii',
  'status',
  'confidence',
  'suffix',
  'registrar',
  'registered',
  'expires',
  'updated',
  'epp_status',
  'nameservers',
  'dnssec',
  'http_status',
  'warnings',
  'rdap_registry',
  'rdap_url',
] as const;

/** Characters that make Excel/LibreOffice treat a cell as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Quotes a CSV field and defuses spreadsheet formula injection (CWE-1236).
 *
 * A registrar name of `=HYPERLINK("http://evil","click")` is valid RDAP data
 * and becomes executable content the moment the export is opened in Excel.
 * Prefixing with an apostrophe forces the cell to be read as text; the visible
 * value is unchanged in every spreadsheet application.
 */
export function escapeCsvCell(value: string): string {
  const guarded = value.length > 0 && FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function cell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return escapeCsvCell('');
  return escapeCsvCell(String(value));
}

export interface ExportOptions {
  /** Maps a status to the label shown in the UI, so exports match the screen. */
  readonly labelFor: (status: RowStatus) => string;
}

/**
 * RFC 4180 CSV with a UTF-8 BOM.
 *
 * The BOM is what makes Excel read `münchen.de` correctly instead of
 * `mÃ¼nchen.de`; every other consumer ignores it.
 */
export function toCsv(results: readonly CheckResult[], options: ExportOptions): string {
  const lines: string[] = [CSV_COLUMNS.map(escapeCsvCell).join(',')];

  for (const result of results) {
    const details = result.details;
    lines.push(
      [
        cell(result.domain.display),
        cell(result.domain.ascii),
        cell(options.labelFor(result.status)),
        cell(result.confidence),
        cell(result.suffix),
        cell(details?.registrar),
        cell(details?.registered),
        cell(details?.expires),
        cell(details?.updated),
        cell(details?.statuses.join(' | ')),
        cell(details?.nameservers.join(' | ')),
        cell(details?.dnssec),
        cell(result.httpStatus),
        cell(result.warnings.join(' | ')),
        cell(result.registry),
        cell(result.queryUrl),
      ].join(','),
    );
  }

  // \uFEFF rather than a literal BOM: an invisible character in source is a
  // maintenance trap, and linters flag it as irregular whitespace.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Machine-readable export that keeps the full structure, including details. */
export function toJson(results: readonly CheckResult[], generatedAt: string): string {
  return JSON.stringify(
    {
      generatedAt,
      tool: 'rdap-domaincheck',
      count: results.length,
      results: results.map((result) => ({
        domain: result.domain.display,
        domainAscii: result.domain.ascii,
        status: result.status,
        confidence: result.confidence,
        suffix: result.suffix,
        httpStatus: result.httpStatus ?? null,
        registry: result.registry ?? null,
        rdapUrl: result.queryUrl ?? null,
        warnings: result.warnings,
        durationMs: result.durationMs ?? null,
        details: result.details ?? null,
      })),
    },
    null,
    2,
  );
}

/** Plain newline-separated list — the format people paste into a registrar. */
export function toPlainList(results: readonly CheckResult[]): string {
  return results.map((result) => result.domain.ascii).join('\n');
}

/** Builds a sortable, filesystem-safe filename such as `domaincheck-2026-08-02-1435`. */
export function exportFilename(extension: string, now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `domaincheck-${stamp}.${extension}`;
}
