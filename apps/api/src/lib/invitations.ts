/**
 * Invitation tokens: a single-use grant, mailed as a link.
 *
 * ## One table, two purposes
 *
 * `invitations.kind` was in the schema from the first migration with `member | platform | reset`
 * written beside it, and nothing ever inserted a row. It is the right shape for both flows this file
 * serves: a **reset** lets somebody who already has an account choose a new password, and a
 * **member** invitation lets a company add a person who does not have one yet. They differ in the
 * length of the grant and in what spending it means, not in how the token works.
 *
 * ## Only the hash is stored
 *
 * The same rule as sessions and share links: a row holds `sha256(token)`, so a database dump yields
 * no usable link. `sha256` and not `scrypt`, because the token is 256 bits of randomness — there is
 * nothing to brute-force, so a slow hash would only cost a lookup.
 *
 * ## Every failure looks the same
 *
 * `resolveInvitation` answers `null` for an unknown token, a revoked one, a spent one, an expired
 * one, and one presented for the other kind. The caller turns that into one sentence. A function
 * that said *which* of those it was would let a caller test whether a token ever existed.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { hashToken, newToken } from './tokens.js';

/** What a token is for. */
export type InvitationKind = 'reset' | 'member';

/**
 * How long each grant lives.
 *
 * A reset is short because the person asking is at the keyboard right now. An invitation is long
 * because the person may be on leave, and a link that expires before it is read turns "we added
 * you" into a support call.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A newly minted invitation. `token` is the only time the plaintext exists. */
export interface CreatedInvitation {
  id: string;
  token: string;
  expiresAt: string;
}

/** A token that resolved to a live grant. */
export interface ResolvedInvitation {
  id: string;
  tenantId: string | null;
  email: string;
  role: string;
  kind: InvitationKind;
  /** The person this grant is for. Always present: a token for an address with no account is unusable. */
  userId: string;
}

/** Create a grant, returning the plaintext token once. */
export async function createInvitation(
  db: Db,
  input: {
    tenantId: string;
    email: string;
    role: string;
    kind: InvitationKind;
    invitedBy: string | null;
    ttlMs: number;
  },
): Promise<CreatedInvitation> {
  const id = newId();
  const token = newToken();
  const createdAt = now();
  const expiresAt = new Date(Date.parse(createdAt) + input.ttlMs).toISOString();

  await db.run(
    `INSERT INTO invitations
       (id, token_hash, tenant_id, email, role, kind, invited_by, created_at, expires_at, accepted_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [id, hashToken(token), input.tenantId, input.email.trim().toLowerCase(), input.role, input.kind, input.invitedBy, createdAt, expiresAt],
  );

  return { id, token, expiresAt };
}

/**
 * Find the live grant a token belongs to, or `null`.
 *
 * The `users` join is what makes the result useful to a caller that has to act on a person, and
 * its absence is also a refusal: a reset token for an address with no account cannot be spent, and
 * saying so distinctly would tell a caller the address is unknown.
 */
export async function resolveInvitation(
  db: Db,
  input: { token: string; kind: InvitationKind },
): Promise<ResolvedInvitation | null> {
  const row = await db.get<{
    id: string;
    tenant_id: string | null;
    email: string;
    role: string;
    kind: string;
    accepted_at: string | null;
    revoked_at: string | null;
    expires_at: string;
    user_id: string | null;
  }>(
    `SELECT i.id, i.tenant_id, i.email, i.role, i.kind, i.accepted_at, i.revoked_at, i.expires_at,
            u.id AS user_id
       FROM invitations i
       LEFT JOIN users u ON lower(u.email) = lower(i.email)
      WHERE i.token_hash = ?`,
    [hashToken(input.token)],
  );

  if (row === null) return null;
  if (row.kind !== input.kind) return null;
  if (row.accepted_at !== null) return null;
  if (row.revoked_at !== null) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  if (row.user_id === null) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    kind: row.kind as InvitationKind,
    userId: row.user_id,
  };
}

/**
 * Mark a grant as used.
 *
 * Conditional on it not already being used, so two simultaneous clicks cannot both spend it: the
 * second updates nothing, and `resolveInvitation` refuses it from then on.
 */
export async function spendInvitation(db: Db, invitationId: string): Promise<void> {
  await db.run('UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL', [
    now(),
    invitationId,
  ]);
}
