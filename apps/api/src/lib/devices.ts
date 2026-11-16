/**
 * Devices: the browser profile that holds a licence seat.
 *
 * ## Why a device and not a session
 *
 * A seat used to be claimed by a session (`tenant_seats`, migration 002). A session can die without
 * giving the seat back — idle expiry, sign-out after expiry, a removed member — and then the seat is
 * held by nobody and available to nobody. A device is what a person actually owns: **one browser
 * profile, for one user, in one company**. Signing in again on the same browser reuses its seat.
 *
 * Two users signing in on one browser are two devices and two seats: the licence is per seat, not
 * per computer.
 *
 * ## Lazy reclaim, and why there is no cron
 *
 * A device is dead when it is revoked, or when it has not been seen for `deviceIdleDays`. Its seat is
 * released **inside the sign-in transaction that needs it**. That is the only moment the answer
 * matters, it needs no scheduler, and it cannot drift out of step with the clock — a sweeper running
 * every N minutes would leave a seat unavailable for up to N minutes after the moment it expired.
 */

import type { Db } from '@sq/db';
import { now } from '@sq/db';
import { hashToken, newToken } from './tokens.js';

/** Cookie holding the device token. Long-lived; the DB stores only its hash. */
export const DEVICE_COOKIE = 'sq_device';

/** Cookie lifetime, seconds. 400 days is Chrome's ceiling for a cookie's `Max-Age`. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** One row an admin sees on Team → Devices. */
export interface DeviceRow {
  id: string;
  userId: string;
  userDisplayName: string;
  username: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  holdsSeat: boolean;
}

/**
 * A short, human label for a browser and platform, from a User-Agent string.
 *
 * Deliberately a lookup rather than a parser: an admin needs to tell "Chrome on Windows" from
 * "Safari on iPhone" to know which one to free, and that is all. A full User-Agent parser is a
 * dependency, a CVE surface and a maintenance job for a label in a table.
 *
 * Order matters. Edge and Chrome both claim to be Safari; Chrome also claims to be Safari in its
 * token list; and an iPad reports `Macintosh` on some versions. The checks below are ordered from
 * most specific to least for that reason.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined || userAgent.trim() === '') {
    return 'Unknown browser';
  }
  const ua = userAgent;

  // Browsers, most specific first.
  if (/Edg\//i.test(ua) || /EdgA\//i.test(ua) || /EdgiOS\//i.test(ua)) {
    return `Edge on ${platformOf(ua)}`;
  }
  if (/Firefox\/|FxiOS\//i.test(ua)) return `Firefox on ${platformOf(ua)}`;
  if (/OPR\/|Opera/i.test(ua)) return `Opera on ${platformOf(ua)}`;
  if (/Chrome\/|CriOS\//i.test(ua)) return `Chrome on ${platformOf(ua)}`;
  if (/Safari\//i.test(ua)) return `Safari on ${platformOf(ua)}`;
  return 'Unknown browser';
}

/** The platform part of a device label. */
function platformOf(ua: string): string {
  // iPad before iPhone: some iPad UAs report "like Macintosh", and iPhone before macOS so a phone is
  // never called a desktop.
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'an unknown device';
}

/** A fresh device token, and the hash to store. */
export function newDeviceToken(): { token: string; hash: string } {
  const token = newToken();
  return { token, hash: hashToken(token) };
}

/** True when `value` looks like a token this module issued, so a junk cookie is not trusted. */
export function looksLikeDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);
}

/**
 * Release the seats of devices that can no longer hold one.
 *
 * Two statements, both optional on `tenantId`, and the parameter list is **built** rather than
 * passing nulls: `? IS NULL` cannot be typed by Postgres (DECISIONS A20 — it answers 500 with "could
 * not determine data type of parameter"). Cutting the clause out of the SQL is both correct and
 * faster.
 *
 * Comparing ISO-8601 strings is valid because every timestamp in this schema comes from
 * `toISOString()`, which sorts lexicographically the same way it sorts in time.
 *
 * Idempotent: a second run finds no device past the cutoff and revokes nothing.
 */
export async function reclaimDeadDevices(
  db: Db,
  input: { tenantId?: string; idleDays: number; at?: Date },
): Promise<number> {
  const at = input.at ?? new Date();
  const cutoff = new Date(at.getTime() - input.idleDays * 86_400_000).toISOString();
  const tenantFilter = input.tenantId === undefined ? '' : ' AND tenant_id = ?';
  const tenantParam = input.tenantId === undefined ? [] : [input.tenantId];

  const removed = await db.run(
    `DELETE FROM device_seats WHERE device_id IN (
       SELECT id FROM devices
        WHERE (revoked_at IS NOT NULL OR last_seen_at <= ?)${tenantFilter}
     )${tenantFilter}`,
    [cutoff, ...tenantParam, ...tenantParam],
  );

  await db.run(
    `UPDATE devices SET revoked_at = ?
      WHERE revoked_at IS NULL AND last_seen_at <= ?${tenantFilter}`,
    [at.toISOString(), cutoff, ...tenantParam],
  );

  return removed.changes;
}

/**
 * Revoke one device: its seat, its sessions, and the device itself.
 *
 * Returns `false` when the device does not exist **in that company** — the caller turns that into a
 * 404, so a guessed id from another tenant is not an oracle (the same rule the quote routes follow).
 */
export async function revokeDevice(
  db: Db,
  input: { tenantId: string; deviceId: string; exceptSessionId?: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const device = await tx.get<{ id: string }>(
      'SELECT id FROM devices WHERE id = ? AND tenant_id = ?',
      [input.deviceId, input.tenantId],
    );
    if (device === null) return false;

    const at = now();
    await tx.run('DELETE FROM device_seats WHERE device_id = ? AND tenant_id = ?', [
      input.deviceId,
      input.tenantId,
    ]);
    await tx.run(
      'UPDATE devices SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL',
      [at, input.deviceId, input.tenantId],
    );
    /*
     * Revoke the device's sessions, so a tab that is already open stops working on its next request.
     * `exceptSessionId` is for "sign out and free this device": the session being used to make the
     * request is revoked by the sign-out itself, and doing it twice would be harmless but noisy.
     */
    if (input.exceptSessionId === undefined) {
      await tx.run(
        'UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND tenant_id = ? AND revoked_at IS NULL',
        [at, input.deviceId, input.tenantId],
      );
    } else {
      await tx.run(
        `UPDATE sessions SET revoked_at = ?
          WHERE device_id = ? AND tenant_id = ? AND id <> ? AND revoked_at IS NULL`,
        [at, input.deviceId, input.tenantId, input.exceptSessionId],
      );
    }
    return true;
  });
}

/**
 * Revoke every device of a user in a company — or in every company when `tenantId` is omitted.
 *
 * Used when a member is removed from a company, and after a password change. `exceptDeviceId` is the
 * device making the change: changing your own password should not sign you out of the browser you are
 * using, but should sign out the one somebody else may have.
 */
export async function revokeDevicesForUser(
  db: Db,
  input: { userId: string; tenantId?: string; exceptDeviceId?: string },
): Promise<void> {
  const tenantClause = input.tenantId === undefined ? '' : ' AND tenant_id = ?';
  const tenantParams = input.tenantId === undefined ? [] : [input.tenantId];

  const rows = await db.all<{ id: string; tenant_id: string }>(
    `SELECT id, tenant_id FROM devices
      WHERE user_id = ? AND revoked_at IS NULL${tenantClause}`,
    [input.userId, ...tenantParams],
  );

  for (const row of rows) {
    if (input.exceptDeviceId !== undefined && row.id === input.exceptDeviceId) continue;
    await revokeDevice(db, { tenantId: row.tenant_id, deviceId: row.id });
  }
}

/** The devices that can still hold a seat, for the admin screen. */
export async function listDevices(db: Db, tenantId: string): Promise<DeviceRow[]> {
  const rows = await db.all<{
    id: string;
    user_id: string;
    display_name: string;
    username: string;
    label: string;
    created_at: string;
    last_seen_at: string;
    holds_seat: number;
  }>(
    `SELECT d.id, d.user_id, u.display_name, m.username, d.label, d.created_at, d.last_seen_at,
            CASE WHEN s.device_id IS NULL THEN 0 ELSE 1 END AS holds_seat
       FROM devices d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN memberships m ON m.tenant_id = d.tenant_id AND m.user_id = d.user_id
       LEFT JOIN device_seats s ON s.device_id = d.id AND s.tenant_id = d.tenant_id
      WHERE d.tenant_id = ? AND d.revoked_at IS NULL
      ORDER BY u.display_name, d.last_seen_at DESC`,
    [tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.display_name,
    username: row.username ?? '',
    label: row.label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    holdsSeat: row.holds_seat === 1,
  }));
}
