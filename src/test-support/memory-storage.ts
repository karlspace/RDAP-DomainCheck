import { vi } from 'vitest';

/**
 * Minimal in-memory `Storage` implementation for tests.
 *
 * Node has no `localStorage`, and the modules under test are written to cope
 * with that — so tests that *want* persistence have to supply it explicitly.
 */
export function installMemoryStorage(): Storage {
  const data = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };

  vi.stubGlobal('localStorage', storage);
  return storage;
}

/** A `Storage` whose writes always fail, as with an exhausted quota. */
export function installFailingStorage(): void {
  vi.stubGlobal('localStorage', {
    length: 0,
    clear: () => undefined,
    getItem: () => {
      throw new Error('storage disabled');
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  } satisfies Storage);
}
