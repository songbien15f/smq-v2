/**
 * A fixed-window rate limiter, in the database.
 *
 * ## Why not in memory
 *
 * The old licence server kept its counters in a process-local dictionary. Two
 * instances behind a proxy therefore doubled every limit, and a restart cleared
 * them — so the limit an operator believed in was not the limit in force. The table
 * makes the limit the same wherever the request lands.
 *
 * ## Why before the work, not after
 *
 * A limiter consulted after the password check is a limiter that has already done
 * the expensive thing. `consume` is called before verification, so a brute-force
 * attempt costs the attacker a row instead of costing the server a scrypt run.
 */

import type { Db } from '@sq/db';

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts remaining inside this window. */
  remaining: number;
  /** ISO timestamp when the window resets. */
  resetAt: string;
}

/**
 * Consume one attempt.
 *
 * `key` should already be namespaced (`signin:email:hash`), so two limits on
 * different things cannot collide. The window is part of the row key, so a new
 * window starts clean rather than inheriting a stale count.
 */
export async function consume(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowEndMs = nowMs + windowMs;
  const windowEnd = new Date(windowEndMs).toISOString();

  return db.transaction(async (tx) => {
    const row = await tx.get<{ count: number; window_end: string }>(
      'SELECT count, window_end FROM rate_limits WHERE key = ?',
      [key],
    );

    const stillOpen = row !== null && Date.parse(row.window_end) > nowMs;

    if (!stillOpen) {
      await tx.run(
        `INSERT INTO rate_limits (key, count, window_end) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET count = 1, window_end = excluded.window_end`,
        [key, windowEnd],
      );
      return { allowed: true, remaining: limit - 1, resetAt: windowEnd };
    }

    const next = row.count + 1;
    await tx.run('UPDATE rate_limits SET count = ? WHERE key = ?', [next, key]);

    return {
      allowed: next <= limit,
      remaining: Math.max(0, limit - next),
      resetAt: row.window_end,
    };
  });
}

/** Clear a limit — used after a successful sign-in, so a correct password resets
 *  the counter an attacker was filling. */
export async function reset(db: Db, key: string): Promise<void> {
  await db.run('DELETE FROM rate_limits WHERE key = ?', [key]);
}
