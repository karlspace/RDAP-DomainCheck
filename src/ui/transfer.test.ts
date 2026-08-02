// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, downloadText } from './transfer.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('downloadText', () => {
  it('creates an object URL, clicks a download link and cleans up', () => {
    vi.useFakeTimers();
    // Spy rather than stubGlobal: replacing the whole `URL` global would drop
    // the constructor (class statics are not enumerable, so `{...URL}` is `{}`)
    // and break every `new URL(...)` for the duration of the test.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    expect(downloadText('results.csv', 'a,b', 'text/csv')).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicked).toEqual(['results.csv']);
    // The anchor must not linger in the document.
    expect(document.querySelector('a[download]')).toBeNull();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('reports failure instead of throwing', () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(downloadText('x.csv', 'data', 'text/csv')).toBe(false);
  });
});

describe('copyToClipboard', () => {
  it('writes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyToClipboard('acme.com')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('acme.com');
  });

  it('reports failure when permission is denied', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(copyToClipboard('acme.com')).resolves.toBe(false);
  });

  it('reports failure in an insecure context with no clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyToClipboard('acme.com')).resolves.toBe(false);
  });
});
