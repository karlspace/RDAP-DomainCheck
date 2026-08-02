// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import { requireElement } from './dom.js';
import { setLocale } from '../i18n/index.js';
import { installMemoryStorage } from '../test-support/memory-storage.js';

/**
 * Integration smoke tests against the *real* `index.html`.
 *
 * `App` resolves 25 element ids at construction time. Unit tests cannot catch a
 * renamed id or a moved element — only booting the actual markup can, which is
 * exactly what makes this suite worth its runtime.
 */

const BOOTSTRAP = {
  publication: '2026-07-15T00:00:00Z',
  services: [[['com'], ['https://rdap.example.com/v1/']]],
};

const TAKEN = {
  objectClassName: 'domain',
  ldhName: 'taken.com',
  status: ['client transfer prohibited'],
  events: [{ eventAction: 'expiration', eventDate: '2027-08-12T04:00:00Z' }],
  entities: [
    {
      roles: ['registrar'],
      vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar GmbH']]],
    },
  ],
};

function mountIndexHtml(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  // DOMParser rather than innerHTML: the project bans innerHTML outright, and
  // the ban should hold in tests too.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // The module script is what Vitest already imported; leaving it in would make
  // happy-dom try to fetch `/src/main.ts` from a server that does not exist.
  for (const script of parsed.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(
    ...[...parsed.body.childNodes].map((node) => document.importNode(node, true)),
  );
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn((input: unknown) => {
    const url = String(input);

    if (url.includes('data.iana.org')) {
      return Promise.resolve(
        new Response(JSON.stringify(BOOTSTRAP), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.includes('/domain/free.com')) {
      return Promise.resolve(new Response('', { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(TAKEN), {
        status: 200,
        headers: { 'Content-Type': 'application/rdap+json' },
      }),
    );
  });

  vi.stubGlobal('fetch', impl);
  return impl;
}

// Built on the production helper so the tests exercise its runtime type check
// as well, instead of asserting their own way past it.
const byId = (id: string): HTMLElement => requireElement(id, HTMLElement);
const button = (id: string): HTMLButtonElement => requireElement(id, HTMLButtonElement);
const field = (id: string): HTMLTextAreaElement => requireElement(id, HTMLTextAreaElement);

beforeEach(() => {
  installMemoryStorage();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // The locale module resolves the browser language once at import time, and
  // happy-dom reports en-US. Pin it so assertions do not depend on that.
  setLocale('de');
  mountIndexHtml();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App boot', () => {
  it('resolves every element it needs from the shipped index.html', () => {
    stubFetch();
    expect(() => {
      new App().start();
    }).not.toThrow();
  });

  it('enables the check button once the registry has loaded', async () => {
    stubFetch();
    new App().start();

    await vi.waitFor(() => {
      expect(button('checkBtn').disabled).toBe(false);
    });
    expect(byId('bootstrapStatus').dataset['state']).toBe('ready');
  });

  it('keeps the check button disabled when IANA is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    new App().start();

    await vi.waitFor(() => {
      expect(byId('bootstrapStatus').dataset['state']).toBe('error');
    });
    expect(button('checkBtn').disabled).toBe(true);
  });
});

describe('App interaction', () => {
  async function bootReady(): Promise<void> {
    stubFetch();
    new App().start();
    await vi.waitFor(() => {
      expect(button('checkBtn').disabled).toBe(false);
    });
  }

  function type(id: string, value: string): void {
    const target = field(id);
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Waits for a run to *finish*, not merely to start.
   *
   * Rows appear synchronously as "queued" placeholders, so waiting on their
   * presence races the lookups. The check button being re-enabled is the one
   * signal that `#finishRun` has settled every row.
   */
  async function runAndWait(expectedRows: number): Promise<void> {
    button('checkBtn').click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.result-row')).toHaveLength(expectedRows);
      expect(button('checkBtn').disabled).toBe(false);
    });
  }

  it('counts recognised domains as they are typed', async () => {
    await bootReady();
    type('domainInput', 'free.com\ntaken.com\nnonsense');

    expect(byId('inputHint').textContent).toContain('2');
    // The unusable third line is reported, not silently dropped.
    expect(byId('inputHint').dataset['warn']).toBe('true');
  });

  it('runs a check and renders both outcomes', async () => {
    await bootReady();
    type('domainInput', 'free.com\ntaken.com');
    await runAndWait(2);

    expect(
      [...document.querySelectorAll('.result-row')].map((row) => row.getAttribute('data-status')),
    ).toEqual(['available', 'registered']);
    expect(byId('resultsCard').hidden).toBe(false);
    expect(byId('progressText').textContent).toContain('2');
    expect(document.querySelector('.cell-registrar')?.textContent).toBe('');
    expect(document.querySelectorAll('.cell-registrar')[1]?.textContent).toBe(
      'Example Registrar GmbH',
    );
  });

  it('filters the rendered rows', async () => {
    await bootReady();
    type('domainInput', 'free.com\ntaken.com');
    await runAndWait(2);

    document.querySelector<HTMLButtonElement>('[data-filter="available"]')?.click();

    const rows = [...document.querySelectorAll('.result-row')];
    expect(rows[0]?.hasAttribute('hidden')).toBe(false);
    expect(rows[1]?.hasAttribute('hidden')).toBe(true);
  });

  it('builds the cartesian product in matrix mode', async () => {
    await bootReady();
    button('tabMatrix').click();
    type('matrixNames', 'acme zenith');
    type('matrixTlds', 'com net');

    expect(byId('panelMatrix').hidden).toBe(false);
    expect(byId('panelList').hidden).toBe(true);
    expect(byId('inputHint').textContent).toContain('4');
  });

  it('applies a TLD preset', async () => {
    await bootReady();
    button('tabMatrix').click();
    type('matrixNames', 'acme');

    document.querySelector<HTMLButtonElement>('#tldPresets .chip-button')?.click();
    expect(field('matrixTlds').value).toBe('de at ch li');
  });

  it('switches language across static labels and rendered rows', async () => {
    await bootReady();
    type('domainInput', 'free.com');
    await runAndWait(1);

    expect(document.querySelector('.pill')?.textContent).toContain('Frei');

    document.querySelector<HTMLButtonElement>('[data-locale-value="en"]')?.click();

    expect(byId('checkBtn').textContent).toBe('Check availability');
    expect(document.querySelector('.pill')?.textContent).toContain('Available');
    expect(document.documentElement.lang).toBe('en');
  });

  it('clears input and results', async () => {
    await bootReady();
    type('domainInput', 'free.com');
    await runAndWait(1);

    button('clearBtn').click();

    expect(field('domainInput').value).toBe('');
    expect(byId('resultsCard').hidden).toBe(true);
  });

  it('restores the previous input on the next visit', async () => {
    await bootReady();
    type('domainInput', 'free.com');
    // Persistence is debounced; starting a run flushes it synchronously.
    await runAndWait(1);

    mountIndexHtml();
    new App().start();
    expect(field('domainInput').value).toBe('free.com');
  });

  it('does nothing when the input is empty', async () => {
    await bootReady();
    button('checkBtn').click();
    expect(byId('resultsCard').hidden).toBe(true);
  });

  it('cancels a running check and marks the unfinished rows', async () => {
    // Lookups hang until aborted, which is what a slow registry looks like.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init?: RequestInit) => {
        if (String(input).includes('data.iana.org')) {
          return Promise.resolve(
            new Response(JSON.stringify(BOOTSTRAP), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
    );

    new App().start();
    await vi.waitFor(() => {
      expect(button('checkBtn').disabled).toBe(false);
    });

    type('domainInput', 'a.com\nb.com\nc.com');
    button('checkBtn').click();

    await vi.waitFor(() => {
      expect(byId('cancelBtn').hidden).toBe(false);
    });
    button('cancelBtn').click();

    await vi.waitFor(() => {
      expect(byId('cancelBtn').hidden).toBe(true);
      expect(button('checkBtn').disabled).toBe(false);
    });

    const statuses = [...document.querySelectorAll('.result-row')].map((row) =>
      row.getAttribute('data-status'),
    );
    expect(statuses).toEqual(['inconclusive', 'inconclusive', 'inconclusive']);
    expect(document.querySelectorAll('.pill')[0]?.textContent).toContain('Abgebrochen');
  });
});

describe('App exports', () => {
  async function runTwo(): Promise<void> {
    stubFetch();
    new App().start();
    await vi.waitFor(() => {
      expect(button('checkBtn').disabled).toBe(false);
    });

    const target = field('domainInput');
    target.value = 'free.com\ntaken.com';
    target.dispatchEvent(new Event('input', { bubbles: true }));

    button('checkBtn').click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.result-row')).toHaveLength(2);
      expect(button('checkBtn').disabled).toBe(false);
    });
  }

  /** Captures a download without writing anything to disk. */
  function captureDownload(): { name: string | undefined; body: () => Promise<string> } {
    const captured: { name?: string; blob?: Blob } = {};
    vi.spyOn(URL, 'createObjectURL').mockImplementation((source: Blob | MediaSource) => {
      captured.blob = source as Blob;
      return 'blob:mock';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(
      this: HTMLAnchorElement,
    ) {
      captured.name = this.download;
    });

    return {
      get name() {
        return captured.name;
      },
      body: async () => (await captured.blob?.text()) ?? '',
    };
  }

  it('downloads the results as CSV', async () => {
    await runTwo();
    const download = captureDownload();

    button('csvBtn').click();

    expect(download.name).toMatch(/^domaincheck-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
    const csv = await download.body();
    expect(csv).toContain('"free.com"');
    expect(csv).toContain('"Example Registrar GmbH"');
  });

  it('downloads the results as JSON', async () => {
    await runTwo();
    const download = captureDownload();

    button('jsonBtn').click();

    expect(download.name).toMatch(/\.json$/);
    const parsed: unknown = JSON.parse(await download.body());
    expect(parsed).toMatchObject({ count: 2 });
  });

  it('exports only what the active filter shows', async () => {
    await runTwo();
    document.querySelector<HTMLButtonElement>('[data-filter="available"]')?.click();
    const download = captureDownload();

    button('jsonBtn').click();

    const parsed: unknown = JSON.parse(await download.body());
    expect(parsed).toMatchObject({ count: 1 });
  });

  it('copies the available domains to the clipboard', async () => {
    await runTwo();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // defineProperty, not stubGlobal: replacing `navigator` wholesale would
    // drop everything else on it.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    button('copyBtn').click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('free.com');
    });
    await vi.waitFor(() => {
      expect(byId('copyBtn').textContent).toBe('Kopiert');
    });
  });
});
