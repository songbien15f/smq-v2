/**
 * Release every claimed seat.
 *
 * ## Why this exists
 *
 * Seats are claimed by **sessions**, not by people: one person signed in on two devices holds two
 * seats. That is deliberate — a second session is a second session — but it means a development
 * machine that signs in repeatedly without signing out fills a five-seat licence in a few minutes and
 * then answers 403 to everything.
 *
 * A real operator hits the same wall after a browser crash or a closed laptop: the session is still
 * live on the server, so their own seat is gone. This is the script that gives it back, and it is the
 * reason the seat model is defensible rather than merely strict.
 *
 *   pnpm seats:release            # revoke every live session and release its seat
 *   pnpm seats:release -- --tenant demo-sheds
 */

import { dbConfigFromEnv, now, openDb } from '@sq/db';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugIndex = args.indexOf('--tenant');
  const slug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;

  const db = openDb(dbConfigFromEnv());

  try {
    const before = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tenant_seats');
    const sessions = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL',
    );

    const at = now();

    if (slug === undefined) {
      await db.transaction(async (tx) => {
        await tx.run('DELETE FROM tenant_seats');
        await tx.run('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL', [at]);
      });
      process.stdout.write(
        `Released every seat and revoked ${Number(sessions?.n ?? 0)} live session(s).\n` +
          `Seats claimed before: ${Number(before?.n ?? 0)}.\n`,
      );
    } else {
      const tenant = await db.get<{ id: string; name: string }>(
        'SELECT id, name FROM tenants WHERE slug = ?',
        [slug],
      );
      if (tenant === null) {
        process.stderr.write(`No company with the slug "${slug}".\n`);
        process.exitCode = 1;
        return;
      }

      const released = await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM tenant_seats WHERE tenant_id = ?',
        [tenant.id],
      );

      await db.transaction(async (tx) => {
        await tx.run('DELETE FROM tenant_seats WHERE tenant_id = ?', [tenant.id]);
        await tx.run(
          'UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL',
          [at, tenant.id],
        );
      });

      process.stdout.write(
        `${tenant.name}: released ${Number(released?.n ?? 0)} seat(s).\n` +
          'Those people are signed out and will need to sign in again.\n',
      );
    }

    // A leftover row would be a seat nobody can use, so report the count rather than assume zero.
    const after = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tenant_seats');
    process.stdout.write(`Seats claimed now: ${Number(after?.n ?? 0)}.\n`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
