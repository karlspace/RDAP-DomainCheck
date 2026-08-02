import type { BootstrapRegistry, CheckResult, NormalizedDomain } from '../core/types.js';
import type { StatusFilter } from './results-table.js';
import { MAX_DOMAINS_PER_RUN, expandMatrix, parseDomainList } from '../core/domain.js';
import { RdapClient } from '../core/rdap.js';
import { StorageKeys, readString, writeString } from '../core/storage.js';
import { exportFilename, toCsv, toJson, toPlainList } from '../core/export.js';
import { loadBootstrapRegistry } from '../core/bootstrap.js';
import { pendingResult, runCheck, summarize } from '../core/checker.js';
import { getLocale, isLocale, onLocaleChange, setLocale, t, tCount } from '../i18n/index.js';
import { formatNumber } from '../i18n/format.js';
import { ResultsTable, isStatusFilter, statusLabel } from './results-table.js';
import { getTheme, initTheme, isTheme, setTheme } from './theme.js';
import { applyTranslations } from './i18n-dom.js';
import { copyToClipboard, downloadText } from './transfer.js';
import { el, requireElement } from './dom.js';

/** Total requests in flight across all registries. */
const GLOBAL_CONCURRENCY = 8;
/** Requests in flight against a single registry — politeness beats raw speed. */
const PER_ORIGIN_CONCURRENCY = 2;

const INPUT_PERSIST_DELAY_MS = 400;
const SEARCH_DEBOUNCE_MS = 150;

/** Deliberately language-neutral so they need no translation. */
const TLD_PRESETS: readonly { readonly label: string; readonly tlds: string }[] = [
  { label: 'DACH', tlds: 'de at ch li' },
  { label: 'Global', tlds: 'com net org info biz' },
  { label: 'EU', tlds: 'eu de fr it es nl be pl' },
  { label: 'Tech', tlds: 'io dev app ai tech cloud' },
  { label: 'Shop', tlds: 'shop store online site' },
];

type InputMode = 'list' | 'matrix';

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, ms);
  };
}

/**
 * Wires the static markup to the core logic.
 *
 * Deliberately a plain class rather than a framework: the app has one screen,
 * one list and one asynchronous job. A renderer would add a dependency, a build
 * of its own and a hydration story for no behaviour we do not already have.
 */
export class App {
  readonly #dom = {
    bootstrapStatus: requireElement('bootstrapStatus', HTMLElement),
    tabList: requireElement('tabList', HTMLButtonElement),
    tabMatrix: requireElement('tabMatrix', HTMLButtonElement),
    panelList: requireElement('panelList', HTMLElement),
    panelMatrix: requireElement('panelMatrix', HTMLElement),
    domainInput: requireElement('domainInput', HTMLTextAreaElement),
    matrixNames: requireElement('matrixNames', HTMLTextAreaElement),
    matrixTlds: requireElement('matrixTlds', HTMLTextAreaElement),
    tldPresets: requireElement('tldPresets', HTMLElement),
    inputHint: requireElement('inputHint', HTMLElement),
    checkBtn: requireElement('checkBtn', HTMLButtonElement),
    cancelBtn: requireElement('cancelBtn', HTMLButtonElement),
    clearBtn: requireElement('clearBtn', HTMLButtonElement),
    resultsCard: requireElement('resultsCard', HTMLElement),
    resultsBody: requireElement('resultsBody', HTMLTableSectionElement),
    progressText: requireElement('progressText', HTMLElement),
    progressFill: requireElement('progressFill', HTMLElement),
    statusFilter: requireElement('statusFilter', HTMLElement),
    searchInput: requireElement('searchInput', HTMLInputElement),
    emptyState: requireElement('emptyState', HTMLElement),
    copyBtn: requireElement('copyBtn', HTMLButtonElement),
    csvBtn: requireElement('csvBtn', HTMLButtonElement),
    jsonBtn: requireElement('jsonBtn', HTMLButtonElement),
    themeSwitch: requireElement('themeSwitch', HTMLElement),
    localeSwitch: requireElement('localeSwitch', HTMLElement),
  };

  readonly #table = new ResultsTable(this.#dom.resultsBody);
  readonly #client = new RdapClient({ perOriginConcurrency: PER_ORIGIN_CONCURRENCY });

  #registry: BootstrapRegistry | null = null;
  #results: CheckResult[] = [];
  #mode: InputMode = 'list';
  #filter: StatusFilter = 'all';
  #query = '';
  #abort: AbortController | null = null;

  start(): void {
    initTheme();
    this.#restoreInputs();
    this.#renderPresets();
    this.#bindEvents();
    this.#syncSwitches();
    applyTranslations();
    this.#updateHint();
    this.#updateEmptyState();

    onLocaleChange(() => {
      applyTranslations();
      this.#syncSwitches();
      this.#renderBootstrapStatus();
      this.#updateHint();
      this.#updateProgress();
      this.#table.refresh();
      this.#updateEmptyState();
    });

    void this.#loadRegistry();
  }

  // ---------------------------------------------------------------- bootstrap

  async #loadRegistry(): Promise<void> {
    this.#dom.checkBtn.disabled = true;
    this.#renderBootstrapStatus('loading');

    try {
      this.#registry = await loadBootstrapRegistry();
      this.#renderBootstrapStatus();
      this.#dom.checkBtn.disabled = false;
    } catch (error) {
      this.#registry = null;
      this.#renderBootstrapStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  #renderBootstrapStatus(state?: 'loading' | 'error', message?: string): void {
    const node = this.#dom.bootstrapStatus;
    node.dataset['state'] = state ?? (this.#registry?.stale === true ? 'stale' : 'ready');

    if (state === 'loading') {
      node.replaceChildren(el('span', { className: 'status-spinner' }), t('bootstrap.loading'));
      return;
    }

    if (state === 'error' || this.#registry === null) {
      node.replaceChildren(
        el('span', { className: 'status-dot' }),
        t('bootstrap.error', { message: message ?? '' }),
        el('button', {
          className: 'link-button',
          text: t('bootstrap.retry'),
          attrs: { type: 'button' },
          on: {
            click: () => {
              void this.#loadRegistry();
            },
          },
        }),
      );
      return;
    }

    const registry = this.#registry;
    const ianaCount = registry.services.size - registry.manualCount;
    const summary =
      registry.publication === null
        ? t('bootstrap.readyNoDate', {
            iana: formatNumber(ianaCount),
            manual: registry.manualCount,
          })
        : t('bootstrap.ready', {
            iana: formatNumber(ianaCount),
            publication: registry.publication.slice(0, 10),
            manual: registry.manualCount,
          });

    node.replaceChildren(
      el('span', { className: 'status-dot' }),
      registry.stale ? `${t('bootstrap.stale')} · ${summary}` : summary,
    );
  }

  // -------------------------------------------------------------------- input

  #restoreInputs(): void {
    this.#dom.domainInput.value = readString(StorageKeys.input) ?? '';
    this.#dom.matrixNames.value = readString(StorageKeys.matrixNames) ?? '';
    this.#dom.matrixTlds.value = readString(StorageKeys.matrixTlds) ?? 'de com net eu';
  }

  #renderPresets(): void {
    this.#dom.tldPresets.replaceChildren(
      ...TLD_PRESETS.map((preset) =>
        el('button', {
          className: 'chip-button',
          text: preset.label,
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.#dom.matrixTlds.value = preset.tlds;
              this.#persistInputs();
              this.#updateHint();
            },
          },
        }),
      ),
    );
  }

  /** The domains the current tab would check. */
  #currentDomains(): {
    domains: readonly NormalizedDomain[];
    rejected: number;
    truncated: boolean;
  } {
    if (this.#mode === 'matrix') {
      const domains = expandMatrix(this.#dom.matrixNames.value, this.#dom.matrixTlds.value);
      return { domains, rejected: 0, truncated: domains.length >= MAX_DOMAINS_PER_RUN };
    }
    const parsed = parseDomainList(this.#dom.domainInput.value);
    return {
      domains: parsed.domains,
      rejected: parsed.rejected.length,
      truncated: parsed.truncated,
    };
  }

  #updateHint(): void {
    const { domains, rejected, truncated } = this.#currentDomains();

    const parts = [
      this.#mode === 'matrix'
        ? t('input.matrix.preview', { count: domains.length })
        : tCount('input.list.hint', 'input.list.hintOne', domains.length),
    ];
    if (rejected > 0) parts.push(t('input.list.rejected', { count: rejected }));
    if (truncated) parts.push(t('input.list.truncated', { max: MAX_DOMAINS_PER_RUN }));

    this.#dom.inputHint.textContent = parts.join(' · ');
    this.#dom.inputHint.dataset['warn'] = String(rejected > 0 || truncated);
  }

  #persistInputs(): void {
    writeString(StorageKeys.input, this.#dom.domainInput.value);
    writeString(StorageKeys.matrixNames, this.#dom.matrixNames.value);
    writeString(StorageKeys.matrixTlds, this.#dom.matrixTlds.value);
  }

  #setMode(mode: InputMode): void {
    this.#mode = mode;
    const isList = mode === 'list';
    this.#dom.tabList.setAttribute('aria-selected', String(isList));
    this.#dom.tabMatrix.setAttribute('aria-selected', String(!isList));
    this.#dom.panelList.toggleAttribute('hidden', !isList);
    this.#dom.panelMatrix.toggleAttribute('hidden', isList);
    this.#updateHint();
  }

  // ------------------------------------------------------------------- events

  #bindEvents(): void {
    const persist = debounce(() => {
      this.#persistInputs();
    }, INPUT_PERSIST_DELAY_MS);

    for (const field of [this.#dom.domainInput, this.#dom.matrixNames, this.#dom.matrixTlds]) {
      field.addEventListener('input', () => {
        this.#updateHint();
        persist();
      });
      field.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          void this.#run();
        }
      });
    }

    this.#dom.tabList.addEventListener('click', () => {
      this.#setMode('list');
    });
    this.#dom.tabMatrix.addEventListener('click', () => {
      this.#setMode('matrix');
    });

    this.#dom.checkBtn.addEventListener('click', () => {
      void this.#run();
    });
    this.#dom.cancelBtn.addEventListener('click', () => {
      this.#abort?.abort();
    });
    this.#dom.clearBtn.addEventListener('click', () => {
      this.#clear();
    });

    this.#dom.statusFilter.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest('[data-filter]');
      if (!(button instanceof HTMLElement)) return;
      const filter = button.dataset['filter'];
      if (!isStatusFilter(filter)) return;
      this.#filter = filter;
      this.#syncFilterButtons();
      this.#applyFilter();
    });

    const search = debounce((value: string) => {
      this.#query = value;
      this.#applyFilter();
    }, SEARCH_DEBOUNCE_MS);
    this.#dom.searchInput.addEventListener('input', () => {
      search(this.#dom.searchInput.value);
    });

    this.#dom.themeSwitch.addEventListener('click', (event) => {
      const target = (event.target as Element | null)?.closest('[data-theme-value]');
      if (!(target instanceof HTMLElement)) return;
      const value = target.dataset['themeValue'];
      if (!isTheme(value)) return;
      setTheme(value);
      this.#syncSwitches();
    });

    this.#dom.localeSwitch.addEventListener('click', (event) => {
      const target = (event.target as Element | null)?.closest('[data-locale-value]');
      if (!(target instanceof HTMLElement)) return;
      const value = target.dataset['localeValue'];
      if (!isLocale(value)) return;
      setLocale(value);
    });

    this.#dom.copyBtn.addEventListener('click', () => {
      void this.#copyAvailable();
    });
    this.#dom.csvBtn.addEventListener('click', () => {
      this.#download('csv');
    });
    this.#dom.jsonBtn.addEventListener('click', () => {
      this.#download('json');
    });
  }

  #syncSwitches(): void {
    const theme = getTheme();
    for (const button of this.#dom.themeSwitch.querySelectorAll('[data-theme-value]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-theme-value') === theme),
      );
    }
    const locale = getLocale();
    for (const button of this.#dom.localeSwitch.querySelectorAll('[data-locale-value]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-locale-value') === locale),
      );
    }
    this.#syncFilterButtons();
  }

  #syncFilterButtons(): void {
    for (const button of this.#dom.statusFilter.querySelectorAll('[data-filter]')) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-filter') === this.#filter),
      );
    }
  }

  // ---------------------------------------------------------------------- run

  async #run(): Promise<void> {
    const registry = this.#registry;
    if (registry === null || this.#abort !== null) return;

    const { domains } = this.#currentDomains();
    if (domains.length === 0) return;

    this.#persistInputs();
    this.#results = domains.map(pendingResult);
    this.#table.setResults(this.#results);
    this.#dom.resultsCard.hidden = false;
    this.#setRunning(true);
    this.#updateProgress();
    this.#updateEmptyState();

    const controller = new AbortController();
    this.#abort = controller;

    try {
      await runCheck(domains, {
        registry,
        client: this.#client,
        signal: controller.signal,
        concurrency: GLOBAL_CONCURRENCY,
        onResult: (index, result) => {
          this.#results[index] = result;
          this.#table.updateResult(index, result);
          this.#updateProgress();
        },
      });
    } finally {
      this.#finishRun();
    }
  }

  /** Marks whatever never ran as cancelled and restores the idle UI. */
  #finishRun(): void {
    this.#results = this.#results.map((result, index) => {
      if (result.status !== 'pending' && result.status !== 'running') return result;
      const cancelled: CheckResult = { ...result, status: 'cancelled' };
      this.#table.updateResult(index, cancelled);
      return cancelled;
    });

    this.#abort = null;
    this.#setRunning(false);
    this.#updateProgress();
    this.#applyFilter();
  }

  #setRunning(running: boolean): void {
    this.#dom.checkBtn.disabled = running;
    this.#dom.checkBtn.textContent = t(running ? 'action.checking' : 'action.check');
    this.#dom.cancelBtn.hidden = !running;
    this.#dom.clearBtn.disabled = running;
  }

  #updateProgress(): void {
    const summary = summarize(this.#results);
    this.#dom.progressText.textContent = t('results.progress', {
      done: summary.done,
      total: summary.total,
    });

    const ratio = summary.total === 0 ? 0 : summary.done / summary.total;
    this.#dom.progressFill.style.width = `${String(Math.round(ratio * 100))}%`;
    this.#dom.progressFill.parentElement?.setAttribute('aria-valuenow', String(summary.done));
    this.#dom.progressFill.parentElement?.setAttribute('aria-valuemax', String(summary.total));

    const counts: Record<string, number> = {
      all: summary.total,
      available: summary.available,
      registered: summary.registered,
      inconclusive: summary.inconclusive,
    };
    for (const button of this.#dom.statusFilter.querySelectorAll('[data-filter]')) {
      const key = button.getAttribute('data-filter') ?? '';
      const badge = button.querySelector('.filter-count');
      if (badge !== null) badge.textContent = String(counts[key] ?? 0);
    }
  }

  #applyFilter(): void {
    this.#table.applyFilter(this.#filter, this.#query);
    this.#updateEmptyState();
  }

  #updateEmptyState(): void {
    const hasResults = this.#results.length > 0;
    const visible = this.#table.visibleResults.length;
    this.#dom.emptyState.hidden = !hasResults || visible > 0;
    this.#dom.emptyState.textContent = t('results.emptyFiltered');
  }

  #clear(): void {
    this.#dom.domainInput.value = '';
    this.#dom.matrixNames.value = '';
    this.#persistInputs();
    this.#results = [];
    this.#table.setResults([]);
    this.#dom.resultsCard.hidden = true;
    this.#updateHint();
    this.#updateEmptyState();
  }

  // ------------------------------------------------------------------ exports

  async #copyAvailable(): Promise<void> {
    const available = this.#table.visibleResults.filter((result) => result.status === 'available');
    const ok = available.length > 0 && (await copyToClipboard(toPlainList(available)));
    this.#flash(this.#dom.copyBtn, t(ok ? 'export.copied' : 'export.failed'));
  }

  #download(format: 'csv' | 'json'): void {
    const results = this.#table.visibleResults;
    if (results.length === 0) return;

    const now = new Date();
    if (format === 'csv') {
      downloadText(
        exportFilename('csv', now),
        toCsv(results, { labelFor: statusLabel }),
        'text/csv',
      );
    } else {
      downloadText(
        exportFilename('json', now),
        toJson(results, now.toISOString()),
        'application/json',
      );
    }
  }

  /**
   * Momentarily swaps a button's label to acknowledge an action.
   *
   * The original label is stashed in `dataset` so that a second click during
   * the flash restores the real label rather than the acknowledgement text.
   */
  #flash(button: HTMLButtonElement, message: string): void {
    // `textContent` is non-nullable on HTMLElement (only Document and
    // DocumentType nodes return null), so no fallback is needed here.
    const original = button.dataset['label'] ?? button.textContent;
    button.dataset['label'] = original;
    button.textContent = message;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }
}
