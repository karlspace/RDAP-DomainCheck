/**
 * Namespaced, failure-tolerant wrapper around `localStorage`.
 *
 * `localStorage` is not merely "sometimes empty" — accessing it *throws* when
 * storage is disabled (Safari private browsing, blocked third-party contexts,
 * enterprise policy) and writing throws on quota exhaustion. Every call site in
 * this app treats persistence as a nice-to-have, so all of that collapses into
 * `null` / `false` here instead of leaking exceptions into feature code.
 */

const NAMESPACE = 'rdap-domaincheck';

function storage(): Storage | null {
  try {
    // Two distinct failure modes: reading the property can *throw* (blocked
    // storage), and it can be absent entirely (Node, worker contexts). The DOM
    // typings claim it is always present, hence the disabled rule.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function namespaced(key: string): string {
  return `${NAMESPACE}:${key}`;
}

/** Reads and validates a JSON value. Returns `null` on any problem. */
export function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  const store = storage();
  if (store === null) return null;

  let raw: string | null;
  try {
    raw = store.getItem(namespaced(key));
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes a JSON value. Returns `false` when storage is unavailable or full. */
export function writeJson(key: string, value: unknown): boolean {
  const store = storage();
  if (store === null) return false;

  try {
    store.setItem(namespaced(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Reads a plain string value. */
export function readString(key: string): string | null {
  const store = storage();
  if (store === null) return null;
  try {
    return store.getItem(namespaced(key));
  } catch {
    return null;
  }
}

/** Writes a plain string value. */
export function writeString(key: string, value: string): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    store.setItem(namespaced(key), value);
    return true;
  } catch {
    return false;
  }
}

/** Removes a value; silently does nothing when storage is unavailable. */
export function remove(key: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(namespaced(key));
  } catch {
    /* nothing to do — persistence is best-effort */
  }
}

/** Storage keys used by the app, in one place so they cannot drift apart. */
export const StorageKeys = {
  bootstrap: 'bootstrap-v1',
  input: 'input-v1',
  matrixNames: 'matrix-names-v1',
  matrixTlds: 'matrix-tlds-v1',
  theme: 'theme-v1',
  locale: 'locale-v1',
} as const;
