import { describe, expect, it, vi } from 'vitest';
import { createLimiter, LimiterTimeoutError } from '../limiter';

/**
 * The limiter, asserted on its own terms.
 *
 * Each test is one way a queue goes wrong in production: admitting more than the limit (memory), never
 * admitting (a request that hangs for ever), leaking a slot after a throw (the queue becomes a
 * permanent refusal), or admitting out of order (a person who asked first waits longest).
 */

/** A promise plus the handles to settle it, so a test can hold a task open deliberately. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending microtasks and timers run, so `pump()` has a chance to act. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createLimiter', () => {
  it('admits up to the limit and queues the rest', async () => {
    const limiter = createLimiter(2);
    const first = deferred();
    const second = deferred();
    const third = deferred();

    const runs = [
      limiter.run(() => first.promise, 10_000),
      limiter.run(() => second.promise, 10_000),
      limiter.run(() => third.promise, 10_000),
    ];

    // Two run, one waits.
    expect(limiter.active).toBe(2);
    expect(limiter.waiting).toBe(1);

    // Finishing the first admits the third.
    first.resolve();
    await tick();
    expect(limiter.active).toBe(2);
    expect(limiter.waiting).toBe(0);

    second.resolve();
    third.resolve();
    await Promise.all(runs);
    expect(limiter.active).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  it('releases the slot when a task throws, so the queue keeps moving', async () => {
    const limiter = createLimiter(1);
    const failure = new Error('chromium died');

    await expect(
      limiter.run(async () => {
        throw failure;
      }, 5_000),
    ).rejects.toThrow(failure);

    // The slot is back: a queued task would now run, and `active` is zero rather than stuck at 1.
    expect(limiter.active).toBe(0);
    await expect(limiter.run(async () => 'ok', 5_000)).resolves.toBe('ok');
  });

  it('rejects a task that waits too long, and leaves no slot behind', async () => {
    vi.useFakeTimers();
    try {
      const limiter = createLimiter(1);
      const hold = deferred();

      const running = limiter.run(() => hold.promise, 60_000);
      const impatient = limiter.run(async () => 'never', 1_000);

      expect(limiter.waiting).toBe(1);

      // Past the waiting budget: the queued task is rejected and removed.
      vi.advanceTimersByTime(1_001);
      await expect(impatient).rejects.toBeInstanceOf(LimiterTimeoutError);
      expect(limiter.waiting).toBe(0);
      // The running task still holds its slot; nothing was leaked or double-counted.
      expect(limiter.active).toBe(1);

      hold.resolve();
      await expect(running).resolves.toBeUndefined();
      expect(limiter.active).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs tasks in the order they were queued', async () => {
    const limiter = createLimiter(1);
    const order: number[] = [];
    const gate = deferred();

    const first = limiter.run(async () => {
      await gate.promise;
      order.push(1);
    }, 60_000);
    // Queued behind it, in this order.
    const rest = [2, 3, 4].map((n) => limiter.run(async () => {
      order.push(n);
    }, 60_000));

    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('refuses a limit that is not a positive whole number', () => {
    expect(() => createLimiter(0)).toThrow(/whole number of at least 1/);
    expect(() => createLimiter(-1)).toThrow(/whole number of at least 1/);
    expect(() => createLimiter(1.5)).toThrow(/whole number of at least 1/);

    const limiter = createLimiter(2);
    expect(() => limiter.setConcurrency(0)).toThrow(/whole number of at least 1/);
  });

  it('admits waiting tasks when the limit is raised', async () => {
    const limiter = createLimiter(1);
    const hold = deferred();

    const running = limiter.run(() => hold.promise, 60_000);
    const queued = limiter.run(async () => 'second', 60_000);
    expect(limiter.waiting).toBe(1);

    // Raising the limit admits the queued task without waiting for the first to finish.
    limiter.setConcurrency(2);
    await expect(queued).resolves.toBe('second');
    expect(limiter.active).toBe(1);

    hold.resolve();
    await running;
  });
});
