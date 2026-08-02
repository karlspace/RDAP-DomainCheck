import type { CheckResult, Confidence, RowStatus, WarningCode } from '../core/types.js';
import type { TranslationKey } from '../i18n/keys.js';
import { isDropping } from '../core/rdap-response.js';
import { formatDate, formatDateTime, formatDuration } from '../i18n/format.js';
import { t } from '../i18n/index.js';
import { IconPaths, el, icon, setSafeHref } from './dom.js';

export const STATUS_FILTERS = ['all', 'available', 'registered', 'inconclusive'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Narrows an arbitrary `data-filter` attribute value from the DOM. */
export function isStatusFilter(value: unknown): value is StatusFilter {
  return typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value);
}

/** Status → i18n key. A typed record instead of string concatenation, so an
 *  added status cannot silently render as a missing translation. */
const STATUS_KEYS: Record<RowStatus, TranslationKey> = {
  pending: 'status.pending',
  running: 'status.running',
  available: 'status.available',
  registered: 'status.registered',
  reserved: 'status.reserved',
  'no-registry': 'status.no-registry',
  'rate-limited': 'status.rate-limited',
  blocked: 'status.blocked',
  unreachable: 'status.unreachable',
  'browser-blocked': 'status.browser-blocked',
  invalid: 'status.invalid',
  'registry-error': 'status.registry-error',
  cancelled: 'status.cancelled',
};

const WARNING_KEYS: Record<WarningCode, TranslationKey> = {
  'possible-subdomain': 'warning.possible-subdomain',
  'idn-converted': 'warning.idn-converted',
  'manual-registry': 'warning.manual-registry',
  'registry-blocks-browser': 'warning.registry-blocks-browser',
  'dns-derived': 'warning.dns-derived',
  'stale-bootstrap': 'warning.stale-bootstrap',
  'unexpected-payload': 'warning.unexpected-payload',
};

const CONFIDENCE_KEYS: Record<Confidence, TranslationKey> = {
  authoritative: 'confidence.authoritative',
  indicative: 'confidence.indicative',
  unknown: 'confidence.unknown',
};

export function statusLabel(status: RowStatus): string {
  return t(STATUS_KEYS[status]);
}

/** Collapses the detailed status set into the three buckets users filter by. */
export function statusGroup(status: RowStatus): Exclude<StatusFilter, 'all'> | 'pending' {
  switch (status) {
    case 'available':
      return 'available';
    case 'registered':
    case 'reserved':
      return 'registered';
    case 'pending':
    case 'running':
      return 'pending';
    default:
      return 'inconclusive';
  }
}

/** Filter predicate shared by the table and the export buttons. */
export function matchesFilter(result: CheckResult, filter: StatusFilter, query: string): boolean {
  if (filter !== 'all' && statusGroup(result.status) !== filter) return false;
  if (query.length === 0) return true;

  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  return (
    result.domain.display.toLowerCase().includes(needle) ||
    result.domain.ascii.toLowerCase().includes(needle) ||
    (result.details?.registrar?.toLowerCase().includes(needle) ?? false)
  );
}

function definition(label: string, value: Node | string | null): HTMLElement | null {
  if (value === null || value === '') return null;
  return el('div', { className: 'detail-item' }, [
    el('dt', { className: 'detail-term', text: label }),
    el('dd', { className: 'detail-value' }, [value]),
  ]);
}

/**
 * One result rendered as a pair of rows: the summary row and a collapsed
 * detail row beneath it.
 *
 * Rows are mutated in place rather than rebuilt, which keeps the open/closed
 * state, scroll position and focus stable while a batch is still filling in.
 */
class RowView {
  readonly main: HTMLTableRowElement;
  readonly detail: HTMLTableRowElement;
  readonly #detailCell: HTMLTableCellElement;
  readonly #toggle: HTMLButtonElement;
  #result: CheckResult;
  #expanded = false;

  constructor(result: CheckResult, index: number) {
    this.#result = result;

    const detailId = `result-detail-${String(index)}`;

    this.#toggle = el('button', {
      className: 'disclosure',
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': detailId },
      on: {
        click: () => {
          this.toggle();
        },
      },
    });
    this.#toggle.appendChild(icon(IconPaths.chevron, { size: 14 }));

    this.main = el('tr', { className: 'result-row' });
    this.#detailCell = el('td', { className: 'detail-cell', attrs: { colspan: 5 } });
    this.detail = el('tr', { className: 'detail-row', attrs: { id: detailId, hidden: true } }, [
      this.#detailCell,
    ]);

    this.update(result);
  }

  get result(): CheckResult {
    return this.#result;
  }

  toggle(): void {
    this.#expanded = !this.#expanded;
    this.#toggle.setAttribute('aria-expanded', String(this.#expanded));
    this.detail.toggleAttribute('hidden', !this.#expanded);
    this.main.classList.toggle('is-expanded', this.#expanded);
    if (this.#expanded) this.#renderDetail();
  }

  setVisible(visible: boolean): void {
    this.main.toggleAttribute('hidden', !visible);
    this.detail.toggleAttribute('hidden', !visible || !this.#expanded);
  }

  update(result: CheckResult): void {
    this.#result = result;
    const { domain, details } = result;

    this.main.dataset['status'] = statusGroup(result.status);
    this.main.replaceChildren(
      el('td', { className: 'cell-domain' }, [
        this.#toggle,
        el('div', { className: 'domain-names' }, [
          el('span', { className: 'domain-name', text: domain.display }),
          domain.isIdn && el('span', { className: 'domain-ascii', text: domain.ascii }),
        ]),
      ]),
      el('td', { className: 'cell-status' }, [this.#statusCell()]),
      el('td', { className: 'cell-registrar col-secondary', text: details?.registrar ?? '' }),
      el('td', {
        className: 'cell-expires col-secondary',
        text: formatDate(details?.expires) ?? '',
        attrs: { title: formatDateTime(details?.expires) },
      }),
      el('td', {
        className: 'cell-registry col-secondary',
        text: hostOf(result.registry),
        attrs: { title: result.registry },
      }),
    );

    if (this.#expanded) this.#renderDetail();
  }

  #statusCell(): HTMLElement {
    const result = this.#result;
    const busy = result.status === 'pending' || result.status === 'running';

    const pill = el('span', { className: 'pill' }, [
      busy ? el('span', { className: 'pill-spinner' }) : el('span', { className: 'pill-dot' }),
      el('span', { text: statusLabel(result.status) }),
    ]);

    const badges: HTMLElement[] = [];

    // Not-fully-trustworthy conclusive answers are marked rather than hidden.
    if (result.confidence === 'indicative' && !busy) {
      badges.push(
        el('span', {
          className: 'badge badge-soft',
          text: '?',
          attrs: { title: t(CONFIDENCE_KEYS[result.confidence]) },
        }),
      );
    }

    if (result.details !== undefined && isDropping(result.details.statuses)) {
      badges.push(
        el('span', {
          className: 'badge badge-drop',
          text: t('badge.dropping'),
          attrs: { title: t('badge.droppingHint') },
        }),
      );
    }

    for (const warning of result.warnings) {
      if (warning === 'idn-converted') continue; // already visible as the ascii line
      // The blocked-registry case gets a link instead; a "!" would be noise.
      if (warning === 'registry-blocks-browser') continue;
      badges.push(
        el('span', {
          className: 'badge badge-warn',
          text: '!',
          attrs: { title: t(WARNING_KEYS[warning]) },
        }),
      );
    }

    // A row the tool cannot answer must carry its own way out. Burying the
    // link one disclosure click deep is what made "unreachable" read as
    // "broken" rather than "open this".
    const needsManualCheck = result.status === 'browser-blocked' || result.status === 'unreachable';
    if (needsManualCheck && result.queryUrl !== undefined) {
      const link = el('a', {
        className: 'inline-link',
        attrs: { title: t('detail.openJson') },
      });
      link.append(t('detail.openJson'), icon(IconPaths.external, { size: 12 }));
      setSafeHref(link, result.queryUrl);
      badges.push(link);
    }

    return el('div', { className: 'status-wrap' }, [pill, ...badges]);
  }

  #renderDetail(): void {
    const result = this.#result;
    const details = result.details;

    const jsonLink = el('a', { className: 'detail-link' }, [
      t('detail.openJson'),
      icon(IconPaths.external, { size: 13 }),
    ]);
    setSafeHref(jsonLink, result.queryUrl);

    const items: (HTMLElement | null)[] = [
      definition(t('confidence.label'), t(CONFIDENCE_KEYS[result.confidence])),
      definition(t('detail.registered'), formatDate(details?.registered)),
      definition(t('detail.updated'), formatDate(details?.updated)),
      definition(t('detail.expires'), formatDate(details?.expires)),
      definition(t('detail.handle'), details?.handle ?? null),
      definition(t('detail.registrarId'), details?.registrarIanaId ?? null),
      definition(
        t('detail.dnssec'),
        details?.dnssec === undefined
          ? null
          : details.dnssec
            ? t('detail.dnssecOn')
            : t('detail.dnssecOff'),
      ),
      definition(
        t('detail.eppStatus'),
        details !== undefined && details.statuses.length > 0
          ? el(
              'div',
              { className: 'chip-row' },
              details.statuses.map((status) => el('code', { className: 'chip', text: status })),
            )
          : null,
      ),
      definition(
        t('detail.nameservers'),
        details !== undefined && details.nameservers.length > 0
          ? el(
              'div',
              { className: 'chip-row' },
              details.nameservers.map((ns) => el('code', { className: 'chip', text: ns })),
            )
          : null,
      ),
      definition(t('detail.httpStatus'), result.httpStatus?.toString() ?? null),
      definition(t('detail.duration'), formatDuration(result.durationMs)),
      definition(t('detail.diagnostic'), result.diagnostic ?? null),
    ];

    const warnings = result.warnings.map((warning) =>
      el('li', { className: 'detail-warning', text: t(WARNING_KEYS[warning]) }),
    );

    this.#detailCell.replaceChildren(
      el(
        'dl',
        { className: 'detail-grid' },
        items.filter((item): item is HTMLElement => item !== null),
      ),
      ...(warnings.length > 0 ? [el('ul', { className: 'detail-warnings' }, warnings)] : []),
      ...(result.queryUrl !== undefined
        ? [el('div', { className: 'detail-actions' }, [jsonLink])]
        : []),
    );
  }
}

function hostOf(url: string | undefined): string {
  if (url === undefined) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Owns the `<tbody>` and keeps it in sync with the current result set. */
export class ResultsTable {
  readonly #body: HTMLTableSectionElement;
  #views: RowView[] = [];
  #filter: StatusFilter = 'all';
  #query = '';

  constructor(body: HTMLTableSectionElement) {
    this.#body = body;
  }

  /** Rebuilds the table from scratch — used when a new run starts. */
  setResults(results: readonly CheckResult[]): void {
    this.#views = results.map((result, index) => new RowView(result, index));
    const fragment = document.createDocumentFragment();
    for (const view of this.#views) fragment.append(view.main, view.detail);
    this.#body.replaceChildren(fragment);
    this.applyFilter(this.#filter, this.#query);
  }

  /** Updates a single row in place as its lookup settles. */
  updateResult(index: number, result: CheckResult): void {
    const view = this.#views[index];
    if (view === undefined) return;
    view.update(result);
    view.setVisible(matchesFilter(result, this.#filter, this.#query));
  }

  /** Applies the status filter and search query; returns the visible row count. */
  applyFilter(filter: StatusFilter, query: string): number {
    this.#filter = filter;
    this.#query = query;

    let visible = 0;
    for (const view of this.#views) {
      const match = matchesFilter(view.result, filter, query);
      view.setVisible(match);
      if (match) visible += 1;
    }
    return visible;
  }

  /** Re-renders every row, e.g. after a language switch. */
  refresh(): void {
    for (const view of this.#views) view.update(view.result);
    this.applyFilter(this.#filter, this.#query);
  }

  get results(): readonly CheckResult[] {
    return this.#views.map((view) => view.result);
  }

  /** Rows currently passing the filter — what the export buttons act on. */
  get visibleResults(): readonly CheckResult[] {
    return this.#views
      .map((view) => view.result)
      .filter((result) => matchesFilter(result, this.#filter, this.#query));
  }
}
