/**
 * Free licence seats held by devices that no longer deserve one.
 *
 * ## What a seat is now
 *
 * A seat belongs to a **device** — one browser profile, for one user, in one company (DECISIONS D3).
 * A device that is revoked, or that nobody has touched for `DEVICE_IDLE_DAYS`, no longer holds a seat.
 * The application reclaims those lazily at the next sign-in in that company; this script does the same
 * thing on demand, which is what an operator needs when somebody is on the phone and cannot get in.
 *
 * ## The modes
 *
 * ```
 * pnpm seats:release                  # reclaim dead devices everywhere (revoked, or idle past cutoff)
 * pnpm seats:release -- --tenant X    # the same, for one company
 * pnpm seats:release -- --all         # revoke EVERY device and session and clear every seat
 * pnpm seats:release -- --all --tenant X
 * ```
 *
 * The default is deliberately the gentle one: it cannot sign anybody out who is using the product,
 * because a device is only reclaimed when it is revoked or idle past the cutoff. `--all` is the blunt
 * instrument for a development machine that filled its own licence, and it says what it did.
 */

import { dbConfigFromEnv, now, openDb } from '@sq/db';
import { loadConfig } from '../src/config.js';
import { reclaimDeadDevices } from '../src/lib/devices.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const slugIndex = args.indexOf('--tenant');
  const slug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;

  const config = loadConfig();
  const db = openDb(dbConfigFromEnv());

  try {
    const tenant =
      slug === undefined
        ? null
        : await db.get<{ id: string; name: string }>('SELECT id, name FROM tenants WHERE slug = ?', [
            slug,
          ]);
    if (slug !== undefined && tenant === null) {
      process.stderr.write(`No company with the slug "${slug}".\n`);
      process.exitCode = 1;
      return;
    }

    const seatCount = async (): Promise<number> => {
      const row = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM device_seats${tenant === null ? '' : ' WHERE tenant_id = ?'}`,
        tenant === null ? [] : [tenant.id],
      );
      return Number(row?.n ?? 0);
    };

    const before = await seatCount();

    if (!all) {
      const released = await reclaimDeadDevices(db, {
        tenantId: tenant?.id,
        idleDays: config.deviceIdleDays,
      });
      process.stdout.write(
        `${tenant === null ? 'Every company' : tenant.name}: reclaimed ${released} seat(s) ` +
          `from devices revoked or idle for more than ${config.deviceIdleDays} day(s).\n` +
          `Seats claimed before: ${before}; now: ${await seatCount()}.\n`,
      );
      return;
    }

    const at = now();
    const tenantClause = tenant === null ? '' : ' AND tenant_id = ?';
    const tenantParams = tenant === null ? [] : [tenant.id];

    const sessions = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL${tenantClause}`,
      tenantParams,
    );

    await db.transaction(async (tx) => {
      await tx.run(`DELETE FROM device_seats WHERE 1 = 1${tenantClause}`, tenantParams);
      /*
       * Revoke the devices as well as clearing their seats. A device left live would take a seat back
       * on the next sign-in, which would make `--all` look like it had done nothing.
       */
      await tx.run(`UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL${tenantClause}`, [
        at,
        ...tenantParams,
      ]);
      await tx.run(`UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL${tenantClause}`, [
        at,
        ...tenantParams,
      ]);
    });

    process.stdout.write(
      `${tenant === null ? 'Every company' : tenant.name}: released every seat and revoked ` +
        `${Number(sessions?.n ?? 0)} live session(s).\n` +
        `Seats claimed before: ${before}.\n` +
        'Everybody affected is signed out and must sign in again.\n',
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
