/**
 * Optional Guest accounts: the `sq_guest` session (spec docs/specs/guest-accounts.md).
 *
 * A guest account is not a company user. Its session lives in its own table under its own cookie,
 * and `guard.ts` reads only `sq_session`, so this cookie can never open a company route — and the
 * routes here read only this cookie, so a company session cannot open a guest profile.
 *
 * Only the token's hash is stored (`lib/tokens.ts`): a dump hands out no live session.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import type { GuestProfileView } from '@sq/contracts';
import { hashToken, newToken } from './tokens.js';

export const GUEST_ACCOUNT_COOKIE = 'sq_guest';
/** 90 days, extended whenever the session is used. */
export const GUEST_SESSION_MAX_AGE = 90 * 24 * 60 * 60;
const SESSION_MS = GUEST_SESSION_MAX_AGE * 1000;
/** Extend the expiry at most once an hour, so a busy page is not a write per request. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

export interface GuestAccountRow {
  id: string;
  email_norm: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  mobile: string;
  created_at: string;
}

export interface GuestAccountSession {
  sessionId: string;
  account: GuestAccountRow;
}

export function normaliseGuestEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function profileView(row: GuestAccountRow): GuestProfileView {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email_norm,
    mobile: row.mobile,
    createdAt: row.created_at,
  };
}

/** Create a session row and set the cookie. */
export async function startGuestSession(db: Db, reply: FastifyReply, accountId: string): Promise<void> {
  const token = newToken();
  const at = now();
  await db.run(
    `INSERT INTO guest_account_sessions (id, account_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), accountId, hashToken(token), at, at, new Date(Date.now() + SESSION_MS).toISOString()],
  );
  reply.setCookie(GUEST_ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: GUEST_SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** The signed-in guest, or null. An expired session is treated as absent (and removed). */
export async function guestAccountFromRequest(
  db: Db,
  request: FastifyRequest,
): Promise<GuestAccountSession | null> {
  const token = request.cookies[GUEST_ACCOUNT_COOKIE];
  if (token === undefined || !TOKEN_PATTERN.test(token)) return null;

  const row = await db.get<GuestAccountRow & { session_id: string; last_seen_at: string; expires_at: string }>(
    `SELECT s.id AS session_id, s.last_seen_at, s.expires_at,
            a.id, a.email_norm, a.password_hash, a.first_name, a.last_name, a.mobile, a.created_at
       FROM guest_account_sessions s
       JOIN guest_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  if (row === null) return null;

  const nowMs = Date.now();
  if (Date.parse(row.expires_at) <= nowMs) {
    await db.run('DELETE FROM guest_account_sessions WHERE id = ?', [row.session_id]);
    return null;
  }
  if (nowMs - Date.parse(row.last_seen_at) > TOUCH_EVERY_MS) {
    await db.run('UPDATE guest_account_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [
      new Date(nowMs).toISOString(),
      new Date(nowMs + SESSION_MS).toISOString(),
      row.session_id,
    ]);
  }

  const { session_id, last_seen_at: _seen, expires_at: _exp, ...account } = row;
  return { sessionId: session_id, account };
}

/** Delete the session behind the cookie (if any) and clear the cookie. */
export async function endGuestSession(db: Db, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[GUEST_ACCOUNT_COOKIE];
  if (token !== undefined && TOKEN_PATTERN.test(token)) {
    await db.run('DELETE FROM guest_account_sessions WHERE token_hash = ?', [hashToken(token)]);
  }
  reply.clearCookie(GUEST_ACCOUNT_COOKIE, { path: '/' });
}
