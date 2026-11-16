/**
 * Sessions: create, resolve, revoke.
 *
 * ## Seats belong to devices (DECISIONS D3)
 *
 * A company buys a number of seats. A seat is claimed by **inserting a slot** into `device_seats`,
 * not by counting sessions, because a count is a read and a read cannot refuse a second writer. The
 * primary key `(tenant_id, slot)` means the second of two simultaneous claims on the last seat gets a
 * constraint violation — the only reliable way to enforce a limit.
 *
 * What changed from `tenant_seats` is **what holds the seat**: a device (one browser profile for one
 * user in one company), not a session. A session that expires leaves its seat with the device, so
 * signing in again on the same browser never needs a free seat. `lib/devices.ts` explains why.
 *
 * ## Resolution re-checks everything, every request
 *
 * A session row is not a permission. On each request the session is re-read along with its membership
 * and its tenant, because "the company was suspended an hour ago" must take effect on the next
 * request rather than at the next sign-in. The same applies to a removed membership, a forced password
 * change, and now a revoked device.
 */

import type { Db } from '@sq/db';
import { isPast, isUniqueViolation, newId, now, plusMs } from '@sq/db';
import type { CompanyRole } from '@sq/contracts';
import type { ApiConfig } from '../config.js';
import { hashToken, newToken } from './tokens.js';
import {
  deviceLabel,
  looksLikeDeviceToken,
  newDeviceToken,
  reclaimDeadDevices,
  revokeDevicesForUser,
} from './devices.js';

/** A resolved session. */
export interface SessionRecord {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  /** The business code of the company this session is open in. Null for platform staff. */
  tenantCode: string | null;
  email: string;
  displayName: string;
  /** Null when the caller is platform staff rather than a company's staff. */
  role: CompanyRole | null;
  platformRole: 'platform_admin' | 'platform_support' | null;
  mustChangePassword: boolean;
  expiresAt: string;
}

/** The token to hand the browser, and when it stops working. */
export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

/** Why a sign-in was refused. */
export type SeatOutcome =
  | {
      ok: true;
      session: IssuedSession;
      /**
       * A device token to set as a cookie, or `null` when the browser already had a live one.
       * Setting it again on every sign-in is what keeps the cookie's expiry rolling forward.
       */
      deviceToken: string | null;
    }
  | { ok: false; reason: 'no_seat' };

/**
 * Create a session, claiming a seat for its device when one is needed.
 *
 * `tenantId` is null for platform staff: they hold no seat in any customer's licence, so they must
 * not consume one — and they get no device row either.
 *
 * ## Why this retries once
 *
 * Two sign-ins on the last seat can reach the `INSERT` together. One gets a unique violation and the
 * transaction rolls back (the driver rolls back on a thrown error). Re-running the whole attempt in a
 * **new** transaction gives the loser a chance at the slot the winner may have released, and if it
 * loses twice the answer is genuinely "no seat" rather than a 500 — which is what it was before.
 */
export async function createSession(
  db: Db,
  config: ApiConfig,
  input: {
    userId: string;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
    /** The `sq_device` cookie's value, when the browser sent one. */
    deviceToken: string | null;
  },
): Promise<SeatOutcome> {
  const attempt = (): Promise<SeatOutcome> =>
    db
      .transaction(async (tx) =>
        tenantIdIsNull(input.tenantId)
          ? insertSession(tx, config, input, null)
          : claimAndInsert(tx, config, input),
      )
      .catch((error: unknown) => {
        if (error instanceof SeatRefused) return { ok: false as const, reason: 'no_seat' as const };
        throw error;
      });

  try {
    return await attempt();
  } catch (error) {
    /*
     * A unique violation is a race, not a bug: the other sign-in took the slot between this attempt's
     * `findFreeSlot` and its `INSERT`. Retried once in a fresh transaction; if it loses again the
     * company really has no free seat.
     */
    if (isUniqueViolation(error)) {
      try {
        return await attempt();
      } catch (second) {
        if (isUniqueViolation(second)) return { ok: false, reason: 'no_seat' };
        throw second;
      }
    }
    throw error;
  }
}

function tenantIdIsNull(tenantId: string | null): boolean {
  return tenantId === null;
}

/** Platform staff: a session with no tenant, no device and no seat. */
async function insertSession(
  tx: Db,
  config: ApiConfig,
  input: { userId: string; tenantId: string | null; ip: string | null; userAgent: string | null },
  deviceId: string | null,
): Promise<SeatOutcome> {
  const token = newToken();
  const sessionId = newId();
  const createdAt = now();
  const expiresAt = plusMs(config.sessionTtlHours * 60 * 60 * 1000);

  await tx.run(
    `INSERT INTO sessions (id, token_hash, user_id, tenant_id, device_id, created_at, last_seen_at, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      hashToken(token),
      input.userId,
      input.tenantId,
      deviceId,
      createdAt,
      createdAt,
      expiresAt,
      input.ip,
      input.userAgent,
    ],
  );

  return { ok: true as const, session: { token, sessionId, expiresAt }, deviceToken: null };
}

/** A company sign-in: find or create the device, take its seat, then open the session. */
async function claimAndInsert(
  tx: Db,
  config: ApiConfig,
  input: {
    userId: string;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
    deviceToken: string | null;
  },
): Promise<SeatOutcome> {
  const tenantId = input.tenantId as string;
  const createdAt = now();

  const tenant = await tx.get<{ seats: number }>(
    'SELECT seats FROM tenants WHERE id = ? AND status = ?',
    [tenantId, 'active'],
  );
  // A suspended or missing tenant cannot claim a seat. Checked here as well as at sign-in so a tenant
  // suspended mid-flight does not gain a session.
  if (tenant === null) throw new SeatRefused('The company is not active.');

  /*
   * Free the seats of dead devices **inside this transaction**, before looking for a slot. Doing it
   * here rather than in a background job means the answer is current at exactly the moment it is
   * asked for, and a company whose people abandoned their browsers can sign in again immediately.
   */
  await reclaimDeadDevices(tx, { tenantId, idleDays: config.deviceIdleDays });

  // The browser's own device, if it has one and it is still live.
  const existing =
    input.deviceToken !== null && looksLikeDeviceToken(input.deviceToken)
      ? await tx.get<{ id: string }>(
          `SELECT id FROM devices
            WHERE tenant_id = ? AND user_id = ? AND token_hash = ? AND revoked_at IS NULL`,
          [tenantId, input.userId, hashToken(input.deviceToken)],
        )
      : null;

  let deviceId: string;
  let deviceToken: string | null = null;

  if (existing === null) {
    // A new browser (or a cookie this server did not issue): mint a device and its token.
    const fresh = newDeviceToken();
    deviceId = newId();
    deviceToken = fresh.token;
    await tx.run(
      `INSERT INTO devices (id, tenant_id, user_id, token_hash, label, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, tenantId, input.userId, fresh.hash, deviceLabel(input.userAgent), createdAt, createdAt],
    );
  } else {
    deviceId = existing.id;
    await tx.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [createdAt, deviceId]);
  }

  // A device that already holds a seat keeps it — that is the whole point of the change.
  const held = await tx.get<{ slot: number }>(
    'SELECT slot FROM device_seats WHERE device_id = ? AND tenant_id = ?',
    [deviceId, tenantId],
  );

  if (held === null) {
    const free = await findFreeSlot(tx, tenantId, tenant.seats);
    if (free === null) {
      // Throwing rolls the whole attempt back, including a device row minted a moment ago: a device
      // with no seat is not a device this company has room for.
      throw new SeatRefused('no_seat');
    }
    await tx.run(
      'INSERT INTO device_seats (tenant_id, slot, device_id, claimed_at) VALUES (?, ?, ?, ?)',
      [tenantId, free, deviceId, createdAt],
    );
  }

  const issued = await insertSession(tx, config, input, deviceId);
  return issued.ok ? { ...issued, deviceToken } : issued;
}

/** Internal signal: the transaction must roll back. */
class SeatRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatRefused';
  }
}

/**
 * The lowest free seat slot, or `null` when every seat is taken.
 *
 * Probing rather than counting: a count followed by an insert is the race. Here the insert is the
 * check, and a conflict means "try the next slot".
 */
async function findFreeSlot(tx: Db, tenantId: string, seats: number): Promise<number | null> {
  const taken = await tx.all<{ slot: number }>(
    'SELECT slot FROM device_seats WHERE tenant_id = ? ORDER BY slot',
    [tenantId],
  );
  const used = new Set(taken.map((row) => row.slot));
  for (let slot = 0; slot < seats; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/**
 * Resolve a token to a live session, or `null`.
 *
 * Idle timeout and absolute expiry are both enforced, and the last-seen timestamp is
 * only written when it has moved enough to matter — an `UPDATE` on every request
 * would turn a read-only page view into a write and lock the database under load.
 */
export async function resolveSession(
  db: Db,
  config: ApiConfig,
  token: string,
): Promise<SessionRecord | null> {
  const row = await db.get<{
    id: string;
    user_id: string;
    tenant_id: string | null;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
    revoked_at: string | null;
    email: string;
    display_name: string;
    must_change_password: number;
    platform_role: string | null;
    user_disabled_at: string | null;
    tenant_status: string | null;
    tenant_code: string | null;
    role: string | null;
    membership_status: string | null;
    device_id: string | null;
    device_revoked_at: string | null;
  }>(
    `SELECT s.id, s.user_id, s.tenant_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            s.device_id, d.revoked_at AS device_revoked_at,
            t.code AS tenant_code, u.email, u.display_name, u.must_change_password, u.platform_role,
            u.disabled_at AS user_disabled_at,
            t.status AS tenant_status,
            m.role, m.status AS membership_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
       LEFT JOIN devices d ON d.id = s.device_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  );

  if (row === null) return null;
  if (row.revoked_at !== null) return null;
  if (row.user_disabled_at !== null) return null;
  if (isPast(row.expires_at)) return null;

  const idleDeadline = new Date(
    Date.parse(row.last_seen_at) + config.sessionIdleHours * 60 * 60 * 1000,
  ).toISOString();
  if (isPast(idleDeadline)) return null;

  // A company session needs a live membership in a live company. Both are re-read
  // now, so a removal or a suspension takes effect on this request, not the next one.
  if (row.tenant_id !== null) {
    if (row.tenant_status !== 'active') return null;
    if (row.membership_status !== 'active') return null;
    if (row.role === null) return null;
    /*
     * And a live device. A company session with **no** device is a row from before migration 017;
     * its seat was held by the session, which no longer exists as a concept. Refusing it is what
     * makes every company user sign in once after the upgrade instead of running untracked.
     */
    if (row.device_id === null) return null;
    if (row.device_revoked_at !== null) return null;
  }

  // Touch the session at most once every five minutes — and the device with it, because the reclaim
  // rule reads `devices.last_seen_at` and a device nobody touches would be reclaimed while in use.
  const sinceTouch = Date.now() - Date.parse(row.last_seen_at);
  if (sinceTouch > 5 * 60 * 1000) {
    const at = now();
    await db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [at, row.id]);
    if (row.device_id !== null) {
      await db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [at, row.device_id]);
    }
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code ?? null,
    email: row.email,
    displayName: row.display_name,
    role: (row.role as CompanyRole | null) ?? null,
    platformRole:
      row.platform_role === 'platform_admin' || row.platform_role === 'platform_support'
        ? row.platform_role
        : null,
    mustChangePassword: row.must_change_password === 1,
    expiresAt: row.expires_at,
  };
}

/**
 * Revoke a session. **The seat stays with its device.**
 *
 * Signing out is not giving the seat back — that was the old rule, and it meant a person who signed
 * out and back in on the same browser had to find a free seat twice. Releasing the seat is a separate,
 * deliberate action: "Sign out and free this device" (`releaseDevice` on the sign-out body), which
 * goes through `revokeDevice`.
 */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
    now(),
    sessionId,
  ]);
}

/**
 * Revoke every session for a user. Used after a password change and when a member is removed.
 *
 * `exceptSessionId` keeps the browser making the change signed in. Its **device** is kept too, because
 * the person is still using it; every other device of that user is revoked (and gives its seat back),
 * which is the point of revoking on a password change — a session somebody else may hold must die.
 */
export async function revokeAllForUser(
  db: Db,
  userId: string,
  exceptSessionId?: string,
  options: { tenantId?: string } = {},
): Promise<void> {
  const exceptDevice =
    exceptSessionId === undefined
      ? undefined
      : ((await db.get<{ device_id: string | null }>('SELECT device_id FROM sessions WHERE id = ?', [
          exceptSessionId,
        ]))?.device_id ?? undefined);

  const sessions = await db.all<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
    [userId],
  );
  for (const session of sessions) {
    if (session.id === exceptSessionId) continue;
    await revokeSession(db, session.id);
  }

  /*
   * Revoke the devices too, not just their sessions: a revoked session alone would let the same
   * browser sign straight back in and re-use the seat, which is the opposite of what a password change
   * is for. The device in use is excepted.
   */
  await revokeDevicesForUser(db, {
    userId,
    tenantId: options.tenantId,
    exceptDeviceId: exceptDevice ?? undefined,
  });
}
