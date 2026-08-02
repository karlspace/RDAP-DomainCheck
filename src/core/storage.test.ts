import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys, readJson, readString, remove, writeJson, writeString } from './storage.js';
import { installFailingStorage, installMemoryStorage } from '../test-support/memory-storage.js';

const isNumber = (value: unknown): value is number => typeof value === 'number';

describe('storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with working storage', () => {
    beforeEach(() => {
      installMemoryStorage();
    });

    it('round-trips JSON', () => {
      expect(writeJson('k', 42)).toBe(true);
      expect(readJson('k', isNumber)).toBe(42);
    });

    it('round-trips strings', () => {
      expect(writeString('k', 'value')).toBe(true);
      expect(readString('k')).toBe('value');
    });

    it('namespaces keys so it cannot collide with other apps on the origin', () => {
      writeString('k', 'value');
      expect(localStorage.getItem('rdap-domaincheck:k')).toBe('value');
    });

    it('returns null for an absent key', () => {
      expect(readJson('missing', isNumber)).toBeNull();
      expect(readString('missing')).toBeNull();
    });

    it('rejects a value that fails validation', () => {
      writeJson('k', 'not a number');
      expect(readJson('k', isNumber)).toBeNull();
    });

    it('survives corrupted JSON', () => {
      localStorage.setItem('rdap-domaincheck:k', '{ broken');
      expect(readJson('k', isNumber)).toBeNull();
    });

    it('removes values', () => {
      writeString('k', 'value');
      remove('k');
      expect(readString('k')).toBeNull();
    });
  });

  describe('with unavailable storage', () => {
    it('degrades to null/false in Node, where localStorage does not exist', () => {
      // No stub at all — this is the environment the modules must not crash in.
      expect(readJson('k', isNumber)).toBeNull();
      expect(readString('k')).toBeNull();
      expect(writeJson('k', 1)).toBe(false);
      expect(writeString('k', 'v')).toBe(false);
      expect(() => {
        remove('k');
      }).not.toThrow();
    });

    it('degrades when storage throws (private mode, quota exhausted)', () => {
      installFailingStorage();
      expect(readString('k')).toBeNull();
      expect(readJson('k', isNumber)).toBeNull();
      expect(writeString('k', 'v')).toBe(false);
      expect(writeJson('k', 1)).toBe(false);
      expect(() => {
        remove('k');
      }).not.toThrow();
    });
  });

  it('exposes a single source of truth for key names', () => {
    const keys = Object.values(StorageKeys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
