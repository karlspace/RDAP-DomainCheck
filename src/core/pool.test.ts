import { describe, expect, it } from 'vitest';
import { AbortError, KeyedLimiter, delay, runPool } from './pool.js';

/** Resolves on the next microtask/macrotask so pending lanes can advance. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('KeyedLimiter', () => {
  it('rejects a nonsensical limit', () => {
    expect(() => new KeyedLimiter(0)).toThrow(RangeError);
  });

  it('caps concurrency per key', async () => {
    const limiter = new KeyedLimiter(2);
    const releases = [await limiter.acquire('a'), await limiter.acquire('a')];

    let third = false;
    void limiter.acquire('a').then(() => {
      third = true;
    });

    await tick();
    expect(third).toBe(false);

    releases[0]?.();
    await tick();
    expect(third).toBe(true);
  });

  it('keeps different keys independent', async () => {
    const limiter = new KeyedLimiter(1);
    await limiter.acquire('a');

    let acquired = false;
    void limiter.acquire('b').then(() => {
      acquired = true;
    });

    await tick();
    expect(acquired).toBe(true);
  });

  it('hands a released slot to the longest waiter', async () => {
    const limiter = new KeyedLimiter(1);
    const release = await limiter.acquire('a');
    const order: number[] = [];

    void limiter.acquire('a').then(() => order.push(1));
    void limiter.acquire('a').then(() => order.push(2));

    release();
    await tick();
    expect(order).toEqual([1]);
  });
});

describe('runPool', () => {
  it('processes every item', async () => {
    const seen: number[] = [];
    await runPool(
      [1, 2, 3, 4, 5],
      async (item) => {
        seen.push(item);
        await tick();
      },
      { concurrency: 2 },
    );
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the configured concurrency', async () => {
    let active = 0;
    let peak = 0;

    await runPool(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick();
        active -= 1;
      },
      { concurrency: 3 },
    );

    expect(peak).toBe(3);
  });

  it('stops scheduling once the signal aborts', async () => {
    const controller = new AbortController();
    let processed = 0;

    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        processed += 1;
        if (processed === 2) controller.abort();
        await tick();
      },
      { concurrency: 1, signal: controller.signal },
    );

    expect(processed).toBe(2);
  });

  it('handles an empty work list', async () => {
    await expect(runPool([], () => Promise.resolve(), { concurrency: 4 })).resolves.toBeUndefined();
  });
});

describe('delay', () => {
  it('resolves after the timeout', async () => {
    await expect(delay(1)).resolves.toBeUndefined();
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(50, controller.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it('rejects when aborted while waiting', async () => {
    const controller = new AbortController();
    const pending = delay(5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AbortError);
  });
});
