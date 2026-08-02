import type { NormalizedDomain } from './types.js';

/** DNS wire-format limit for a fully qualified name (RFC 1035 §2.3.4). */
const MAX_DOMAIN_LENGTH = 253;

/** Guard rail: pasting a 50k-line spreadsheet should not hammer registries. */
export const MAX_DOMAINS_PER_RUN = 500;

/** A single LDH label: letters/digits/hyphen, no leading or trailing hyphen. */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Top-level labels are alphabetic (`com`, `de`) or A-label encoded IDN
 * (`xn--80asehdb` for `.онлайн`). Excluding digits also rules out IPv4
 * literals, which must never be sent to a registry as a domain query.
 */
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Leading list decoration people paste along with domains: `- `, `* `, `• `.
 *
 * A bullet only counts as decoration when whitespace follows it. Stripping a
 * glued-on hyphen would silently repair `-example.com` — an invalid name, since
 * labels may not start with a hyphen — into a valid one.
 */
const LIST_DECORATION = /^(?:[-*•·>]\s+|[\s,;|]+)+/;

/** `https://`, `http://`, `ftp://`, … — anything scheme-like. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `user@` or an email local part; the part we want is what follows. */
const USERINFO = /^[^/@]*@/;

/** Everything a domain list may be separated by. */
const LIST_SEPARATORS = /[\s,;|]+/;

/**
 * Reduces a pasted token to its bare host string without resolving IDN.
 *
 * Kept separate from {@link normalizeDomain} so the *display* form can keep
 * the unicode the user actually typed while the *query* form is punycode.
 */
function extractHost(input: string): string {
  let host = input.trim().replace(LIST_DECORATION, '');
  host = host.replace(SCHEME, '');
  // Wildcard prefixes from DNS/certificate contexts.
  host = host.replace(/^\*\./, '');
  host = host.replace(USERINFO, '');
  // Cut path, query and fragment.
  host = host.split(/[/?#]/, 1)[0] ?? '';
  // Cut an explicit port, but never an IPv6 bracket group (rejected later).
  host = host.replace(/:\d{1,5}$/, '');
  // A trailing dot marks an FQDN root and is not part of the registered name.
  host = host.replace(/\.+$/, '');
  return host.toLowerCase();
}

/** True when every label and the overall length satisfy DNS + registry rules. */
export function isValidAsciiDomain(ascii: string): boolean {
  if (ascii.length === 0 || ascii.length > MAX_DOMAIN_LENGTH) return false;
  const labels = ascii.split('.');
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1];
  if (tld === undefined || !TLD_PATTERN.test(tld)) return false;

  return labels.every((label) => LABEL_PATTERN.test(label));
}

/**
 * Turns one user-supplied token into the pair of forms we need, or `null` when
 * it cannot be a registrable domain.
 *
 * IDN handling rides on the WHATWG URL parser, which performs UTS-46/IDNA
 * conversion natively in browsers and in Node — no punycode dependency, and
 * therefore no third-party code in the path that touches user input.
 */
export function normalizeDomain(input: string): NormalizedDomain | null {
  const display = extractHost(input);
  if (display.length === 0) return null;

  // Bracketed IPv6 literals and anything else the URL parser rejects.
  let ascii: string;
  try {
    ascii = new URL(`https://${display}`).hostname;
  } catch {
    return null;
  }

  // `new URL` happily accepts IP literals; a registry query never should.
  if (ascii.startsWith('[')) return null;

  if (!isValidAsciiDomain(ascii)) return null;

  return { ascii, display: display === ascii ? ascii : display, isIdn: display !== ascii };
}

/** Result of turning a textarea full of noise into a work list. */
export interface ParsedDomainList {
  readonly domains: readonly NormalizedDomain[];
  /** Tokens that looked like input but could not be parsed, deduplicated. */
  readonly rejected: readonly string[];
  /** True when the input exceeded {@link MAX_DOMAINS_PER_RUN} and was cut. */
  readonly truncated: boolean;
}

/**
 * Parses free-form input (newlines, commas, semicolons, URLs, e-mail
 * addresses) into a deduplicated, capped list of queryable domains.
 */
export function parseDomainList(raw: string): ParsedDomainList {
  const domains: NormalizedDomain[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const seenRejected = new Set<string>();
  let truncated = false;

  for (const token of raw.split(LIST_SEPARATORS)) {
    if (token.trim().length === 0) continue;

    const normalized = normalizeDomain(token);
    if (normalized === null) {
      const label = token.trim().slice(0, 64);
      if (!seenRejected.has(label)) {
        seenRejected.add(label);
        rejected.push(label);
      }
      continue;
    }

    if (seen.has(normalized.ascii)) continue;
    if (domains.length >= MAX_DOMAINS_PER_RUN) {
      truncated = true;
      break;
    }
    seen.add(normalized.ascii);
    domains.push(normalized);
  }

  return { domains, rejected, truncated };
}

/**
 * Builds the cartesian product of names × TLDs for the "check one name across
 * many endings" workflow.
 *
 * Names may be typed with or without an ending (`acme` and `acme.com` both
 * yield `acme.<tld>`), because that is how people actually paste them.
 */
export function expandMatrix(rawNames: string, rawTlds: string): readonly NormalizedDomain[] {
  const names = rawNames
    .split(LIST_SEPARATORS)
    .map((name) => extractHost(name).split('.')[0] ?? '')
    .filter((name) => name.length > 0);

  const tlds = rawTlds
    .split(LIST_SEPARATORS)
    .map((tld) => tld.trim().toLowerCase().replace(/^\./, ''))
    .filter((tld) => tld.length > 0);

  const out: NormalizedDomain[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    for (const tld of tlds) {
      const normalized = normalizeDomain(`${name}.${tld}`);
      if (normalized === null || seen.has(normalized.ascii)) continue;
      if (out.length >= MAX_DOMAINS_PER_RUN) return out;
      seen.add(normalized.ascii);
      out.push(normalized);
    }
  }

  return out;
}

/**
 * Heuristic: `shop.acme.de` under the `de` registry has one label more than a
 * registrable name, so the registry's "not found" says nothing useful.
 *
 * Without bundling the full Public Suffix List this cannot be exact, which is
 * why the caller surfaces it as a warning rather than rejecting the row.
 */
export function looksLikeSubdomain(ascii: string, suffix: string): boolean {
  const suffixLabels = suffix.split('.').length;
  return ascii.split('.').length > suffixLabels + 1;
}
