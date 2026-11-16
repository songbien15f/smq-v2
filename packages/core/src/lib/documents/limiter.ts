/**
 * A concurrency limiter, for work whose cost is a whole process.
 *
 * ## Why this exists
 *
 * Every PDF render launches its own Chromium, and a Chromium is roughly 200–300 MB of RAM. Nothing
 * limited how many could run at once, so ten simultaneous downloads of an uncached revision started ten
 * browsers: on a 2 GB VPS the machine starts swapping and then the OOM killer picks a process — quite
 * possibly the API itself.
 *
 * The cache means only the **first** render of each revision is expensive, so the burst is short. A
 * queue is the right shape for a short burst: the tenth request waits a few seconds and gets its PDF,
 * instead of the machine dying.
 *
 * ## What it is not
 *
 * Not a scheduler: FIFO, no priorities, no fairness between companies. A person waiting for a PDF is
 * waiting for a file they asked for, and the alternative to waiting is failing.
 */

/** The queue was too long for the caller's patience. */
export class LimiterTimeoutError extends Error {
  constructor(message = 'Timed out waiting for a free slot.') {
    super(message);
    this.name = 'LimiterTimeoutError';
  }
}

export interface Limiter {
  /** Run `task` when a slot is free. Rejects `LimiterTimeoutError` if it waits longer than `maxWaitMs`. */
  run<T>(task: () => Promise<T>, maxWaitMs: number): Promise<T>;
  /** Change the limit. Takes effect as running tasks finish; queued tasks are admitted up to it. */
  setConcurrency(n: number): void;
  /** Tasks currently holding a slot. */
  readonly active: number;
  /** Tasks waiting for a slot. */
  readonly waiting: number;
}

interface Waiter {
  admit: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Build a limiter.
 *
 * A slot is released in `finally`, so a task that throws does not leak one — which is the failure that
 * would convert a queue into a permanent refusal after the first error.
 */
export function createLimiter(concurrency: number): Limiter {
  let limit = assertConcurrency(concurrency);
  let active = 0;
  const queue: Waiter[] = [];

  /** Admit queued tasks while there is room. */
  const pump = (): void => {
    while (active < limit && queue.length > 0) {
      const waiter = queue.shift() as Waiter;
      clearTimeout(waiter.timer);
      active += 1;
      waiter.admit();
    }
  };

  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },

    run<T>(task: () => Promise<T>, maxWaitMs: number): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          /*
           * `active` was incremented before `admit()` was called, so the task is already counted. The
           * release happens exactly once, in `finally`, whether the task resolves or throws.
           */
          void (async () => {
            try {
              resolve(await task());
            } catch (error) {
              reject(error);
            } finally {
              active -= 1;
              pump();
            }
          })();
        };

        if (active < limit) {
          active += 1;
          start();
          return;
        }

        /*
         * Queued. The timeout removes this waiter from the queue and rejects; it never holds a slot, so
         * there is nothing to release and no way to leak one.
         */
        const waiter: Waiter = {
          admit: start,
          timer: setTimeout(() => {
            const index = queue.indexOf(waiter);
            if (index === -1) return; // already admitted by `pump`
            queue.splice(index, 1);
            reject(new LimiterTimeoutError());
          }, maxWaitMs),
        };
        // A queued task must not keep the process alive on its own.
        waiter.timer.unref?.();
        queue.push(waiter);
      });
    },

    setConcurrency(n: number): void {
      limit = assertConcurrency(n);
      // Raising the limit admits waiting tasks immediately; lowering it lets running ones finish.
      pump();
    },
  };
}

/** A limit has to be a positive whole number, or the queue either never admits or admits everything. */
function assertConcurrency(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`A concurrency limit must be a whole number of at least 1, got ${String(n)}.`);
  }
  return n;
}
