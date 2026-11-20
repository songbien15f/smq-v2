/**
 * Delete the `rate_limits` rows whose window has ended.
 *
 * ```
 * pnpm ratelimits:prune
 * ```
 *
 * `consume` (`src/lib/rateLimit.ts`) never deletes: an expired row is simply overwritten the next
 * time its key is used. Keys that are used once — a Guest Places session id, a day's system-wide
 * counter, an address that never comes back — therefore stay forever. They are harmless to the
 * limits (an ended window counts as no row) but the table only grows, so this removes them.
 *
 * Safe to run at any time, including while the API serves requests: a deleted row is exactly what
 * `consume` would have treated as absent. Window ends are ISO-8601 UTC strings of one shape, so the
 * comparison is a plain string comparison.
 */

import { dbConfigFromEnv, openDb } from '@sq/db';

async function main(): Promise<void> {
  const db = openDb(dbConfigFromEnv());
  try {
    const before = await db.get<{ n: number | string }>('SELECT COUNT(*) AS n FROM rate_limits');
    const result = await db.run('DELETE FROM rate_limits WHERE window_end < ?', [new Date().toISOString()]);
    process.stdout.write(
      `rate_limits: removed ${result.changes} expired row(s); ${Number(before?.n ?? 0) - result.changes} remain.\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
