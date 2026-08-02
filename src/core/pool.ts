/**
 * Small concurrency primitives.
 *
 * No dependency does this in fewer than a few hundred lines of transitive code,
 * and the semantics we need are narrow enough to own outright.
 */

/** Thrown when work is cancelled through an `AbortSignal`. */
export class AbortError extends Error {
  constructor(message = 'Operation aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * Counting semaphore keyed by an arbitrary string.
 *
 * Used to cap how many requests are in flight against a *single* RDAP origin,
 * independently of overall throughput: hammering one registry with the full
 * global budget is the fastest way to earn an HTTP 429.
 */
export class KeyedLimiter {
  readonly #limit: number;
  readonly #active = new Map<string, number>();
  readonly #waiting = new Map<string, (() => void)[]>();

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('limit must be a positive integer');
    }
    this.#limit = limit;
  }

  /** Resolves once a slot for `key` is free; call the returned function to release it. */
  async acquire(key: string): Promise<() => void> {
    const active = this.#active.get(key) ?? 0;

    if (active < this.#limit) {
      this.#active.set(key, active + 1);
      return () => {
        this.#release(key);
      };
    }

    await new Promise<void>((resolve) => {
      const queue = this.#waiting.get(key) ?? [];
      queue.push(resolve);
      this.#waiting.set(key, queue);
    });

    return () => {
      this.#release(key);
    };
  }

  #release(key: string): void {
    const queue = this.#waiting.get(key);
    const next = queue?.shift();

    if (next !== undefined) {
      // Hand the slot straight to the next waiter: the active count is unchanged.
      if (queue?.length === 0) this.#waiting.delete(key);
      next();
      return;
    }

    const active = (this.#active.get(key) ?? 1) - 1;
    if (active <= 0) this.#active.delete(key);
    else this.#active.set(key, active);
  }
}

export interface PoolOptions {
  readonly concurrency: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Runs `worker` over `items` with a fixed number of parallel lanes.
 *
 * Results are *not* collected — each worker reports its own outcome as it
 * finishes, which is what lets the table fill in progressively instead of
 * blocking on the slowest lookup in the batch.
 *
 * Cancellation is checked between items, so an abort stops scheduling new work
 * immediately while in-flight requests unwind through their own signal.
 */
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  options: PoolOptions,
): Promise<void> {
  const lanes = Math.max(1, Math.min(options.concurrency, items.length));
  let cursor = 0;

  const runLane = async (): Promise<void> => {
    while (cursor < items.length) {
      if (options.signal?.aborted === true) return;
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  };

  await Promise.all(Array.from({ length: lanes }, runLane));
}

/** Promise-based delay that rejects with {@link AbortError} when cancelled. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
