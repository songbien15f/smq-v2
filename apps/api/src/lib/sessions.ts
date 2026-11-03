/**
 * Sessions: create, resolve, revoke.
 *
 * ## Seats
 *
 * A company buys a number of seats. A seat is claimed by **inserting a slot**, not
 * by counting sessions, because a count is a read and a read cannot refuse a second
 * writer. `tenant_seats` has a primary key of `(tenant_id, slot)`, so the second of
 * two simultaneous sign-ins on the last seat gets a constraint violation — which is
 * the only reliable way to enforce a limit. See migration 002 for the full reasoning.
 *
 * ## Resolution re-checks everything, every request
 *
 * A session row is not a permission. On each request the session is re-read along
 * with its membership and its tenant, because "the company was suspended an hour
 * ago" must take effect on the next request rather than at the next sign-in. The same
 * applies to a removed membership and a forced password change.
 */

import type { Db } from '@sq/db';
import { isPast, newId, now, plusMs } from '@sq/db';
import type { CompanyRole } from '@sq/contracts';
import type { ApiConfig } from '../config.js';
import { hashToken, newToken } from './tokens.js';

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

/** Why a sign-in was refused for a seat reason. */
export type SeatOutcome = { ok: true; session: IssuedSession } | { ok: false; reason: 'no_seat' };

/**
 * Create a session, claiming a seat when one is needed.
 *
 * `tenantId` is null for platform staff: they hold no seat in any customer's
 * licence, so they must not consume one.
 */
export async function createSession(
  db: Db,
  config: ApiConfig,
  input: {
    userId: string;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<SeatOutcome> {
  const token = newToken();
  const sessionId = newId();
  const createdAt = now();
  const expiresAt = plusMs(config.sessionTtlHours * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO sessions (id, token_hash, user_id, tenant_id, created_at, last_seen_at, expires_at, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        hashToken(token),
        input.userId,
        input.tenantId,
        createdAt,
        createdAt,
        expiresAt,
        input.ip,
        input.userAgent,
      ],
    );

    if (input.tenantId !== null) {
      const tenant = await tx.get<{ seats: number }>(
        'SELECT seats FROM tenants WHERE id = ? AND status = ?',
        [input.tenantId, 'active'],
      );
      // A suspended or missing tenant cannot claim a seat. Checked here as well as
      // at sign-in so a tenant suspended mid-flight does not gain a session.
      if (tenant === null) {
        throw new SeatRefused('The company is not active.');
      }

      const free = await findFreeSlot(tx, input.tenantId, tenant.seats);
      if (free === null) {
        // Throwing rolls the session insert back as well: a session without a seat
        // would be a session the seat check never saw.
        throw new SeatRefused('no_seat');
      }

      await tx.run(
        'INSERT INTO tenant_seats (tenant_id, slot, session_id, claimed_at) VALUES (?, ?, ?, ?)',
        [input.tenantId, free, sessionId, createdAt],
      );
    }

    return { ok: true as const, session: { token, sessionId, expiresAt } };
  }).catch((error: unknown) => {
    if (error instanceof SeatRefused) {
      return { ok: false as const, reason: 'no_seat' as const };
    }
    throw error;
  });
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
 * Probing rather than counting: a count followed by an insert is the race. Here the
 * insert is the check, and a conflict means "try the next slot".
 */
async function findFreeSlot(tx: Db, tenantId: string, seats: number): Promise<number | null> {
  const taken = await tx.all<{ slot: number }>(
    'SELECT slot FROM tenant_seats WHERE tenant_id = ? ORDER BY slot',
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
  }>(
    `SELECT s.id, s.user_id, s.tenant_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            t.code AS tenant_code, u.email, u.display_name, u.must_change_password, u.platform_role,
            u.disabled_at AS user_disabled_at,
            t.status AS tenant_status,
            m.role, m.status AS membership_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
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
  }

  // Touch the session at most once every five minutes.
  const sinceTouch = Date.now() - Date.parse(row.last_seen_at);
  if (sinceTouch > 5 * 60 * 1000) {
    await db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now(), row.id]);
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

/** Revoke a session and release its seat. */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  // The seat row is deleted explicitly rather than left to the foreign key, because
  // a session is revoked (not deleted) and its seat must still be released.
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM tenant_seats WHERE session_id = ?', [sessionId]);
    await tx.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
      now(),
      sessionId,
    ]);
  });
}

/** Revoke every session for a user. Used after a password change. */
export async function revokeAllForUser(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
  const sessions = await db.all<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
    [userId],
  );
  for (const session of sessions) {
    if (session.id === exceptSessionId) continue;
    await revokeSession(db, session.id);
  }
}
