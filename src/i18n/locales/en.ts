import type { TranslationKey } from '../keys.js';

/**
 * English translations.
 *
 * Typed as `Record<TranslationKey, string>`: a missing or misspelled key fails
 * `npm run typecheck` instead of silently rendering an empty label.
 */
export const en: Record<TranslationKey, string> = {
  'app.eyebrow': 'RDAP · RFC 9082',
  'app.title': 'Check domain availability',
  'app.subtitle':
    'Queries the responsible registries directly over RDAP — structured data instead of WHOIS free text. Runs entirely in your browser, no backend.',
  'app.skipToContent': 'Skip to content',

  'nav.language': 'Language',
  'nav.theme': 'Appearance',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',

  'bootstrap.loading': 'Loading IANA bootstrap registry …',
  'bootstrap.ready': '{iana} TLDs from IANA (as of {publication}) · {manual} added manually',
  'bootstrap.readyNoDate': '{iana} TLDs from IANA · {manual} added manually',
  'bootstrap.stale': 'Using cached registry data (IANA unreachable)',
  'bootstrap.error': 'IANA bootstrap registry unreachable: {message}',
  'bootstrap.retry': 'Reload',

  'input.tab.list': 'Domain list',
  'input.tab.matrix': 'TLD matrix',
  'input.list.label': 'Domains (one per line)',
  'input.list.placeholder': 'example-corp.de\nexample-corp.com\nproject-xy.eu\nmünchen.example',
  'input.list.hint': '{count} domains detected',
  'input.list.hintOne': '1 domain detected',
  'input.list.rejected': '{count} entries could not be parsed',
  'input.list.truncated': 'Limited to {max} domains',
  'input.matrix.namesLabel': 'Names',
  'input.matrix.namesPlaceholder': 'example-corp\nproject-xy',
  'input.matrix.tldsLabel': 'Endings',
  'input.matrix.tldsPlaceholder': 'de com net eu io',
  'input.matrix.presets': 'Presets',
  'input.matrix.preview': 'Yields {count} combinations',

  'action.check': 'Check availability',
  'action.checking': 'Checking …',
  'action.cancel': 'Cancel',
  'action.clear': 'Clear',

  'results.title': 'Results',
  'results.empty': 'No check run yet.',
  'results.emptyFiltered': 'No rows match this filter.',
  'results.progress': '{done} of {total}',
  'results.cancelled': 'Check cancelled.',

  'summary.available': 'Available',
  'summary.registered': 'Registered',
  'summary.inconclusive': 'Inconclusive',

  'filter.all': 'All',
  'filter.search': 'Search',
  'filter.searchPlaceholder': 'Filter domains …',

  'table.domain': 'Domain',
  'table.status': 'Status',
  'table.registrar': 'Registrar',
  'table.expires': 'Expires',
  'table.registry': 'Registry',
  'table.details': 'Details',
  'table.showDetails': 'Show details for {domain}',

  'detail.registered': 'Registered',
  'detail.updated': 'Last changed',
  'detail.expires': 'Expires',
  'detail.handle': 'Registry handle',
  'detail.registrarId': 'IANA registrar ID',
  'detail.nameservers': 'Name servers',
  'detail.eppStatus': 'EPP status',
  'detail.dnssec': 'DNSSEC',
  'detail.dnssecOn': 'signed',
  'detail.dnssecOff': 'unsigned',
  'detail.httpStatus': 'HTTP status',
  'detail.duration': 'Response time',
  'detail.diagnostic': 'Diagnostics',
  'detail.openJson': 'Open RDAP JSON',
  'detail.none': '—',

  'status.pending': 'Queued',
  'status.running': 'Checking …',
  'status.available': 'Available',
  'status.registered': 'Registered',
  'status.reserved': 'Reserved',
  'status.no-registry': 'No RDAP',
  'status.rate-limited': 'Rate limited',
  'status.blocked': 'Refused',
  'status.unreachable': 'Unreachable',
  'status.browser-blocked': 'Check manually',
  'status.invalid': 'Invalid query',
  'status.registry-error': 'Registry error',
  'status.cancelled': 'Cancelled',

  'confidence.label': 'Confidence',
  'confidence.authoritative': 'Authoritative answer from the registry',
  'confidence.indicative': 'Indicative only — please verify manually',
  'confidence.unknown': 'No reliable statement possible',

  'badge.dropping': 'dropping',
  'badge.droppingHint': 'Domain is in the deletion pipeline and is expected to become available',

  'warning.possible-subdomain':
    'Looks like a subdomain — the registry answer then says nothing about a registrable domain',
  'warning.idn-converted': 'IDN domain; the punycode form was queried',
  'warning.manual-registry': 'RDAP server comes from the manual override list, not from IANA',
  'warning.registry-blocks-browser':
    'This registry does not allow browser queries (no CORS header). Its answer is correct but unreadable here — check it directly via “Open RDAP JSON”.',
  'warning.stale-bootstrap': 'Based on cached IANA data',
  'warning.unexpected-payload': 'Registry responded with unexpected content',

  'export.csv': 'CSV',
  'export.json': 'JSON',
  'export.copyAvailable': 'Copy available',
  'export.copied': 'Copied',
  'export.failed': 'Copying failed',

  'footer.privacy':
    'All queries go straight from your browser to the respective registry. There is no backend, no tracking and no analytics.',
  'footer.cors':
    'A few registries — DENIC for .de among them — do not allow browser queries. Those domains are marked “Check manually” and linked straight to the RDAP answer.',
  'footer.source': 'Source code',
  'footer.version': 'Version {version}',
};
