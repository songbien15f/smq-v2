/**
 * Sign-in, sign-out, session and password change.
 *
 * ## What the sign-in answer refuses to reveal
 *
 * An unknown email and a wrong password produce the same message and, because of
 * `burnVerificationTime`, take about the same time. The alternative — "no account
 * with that email" — turns the sign-in form into a way to find out which of a
 * competitor's staff have accounts here.
 *
 * ## Why the rate limit is consumed before the password is checked
 *
 * A limiter consulted after verification has already paid for the expensive
 * operation. The limit is keyed on the email *and* on the IP, so one attacker cannot
 * be evaded by rotating addresses against a single account, and one noisy office
 * cannot lock out every account behind its NAT.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { now } from '@sq/db';
import {
  capabilitiesFor,
  changePasswordRequest,
  signInRequest,
  platformCapabilitiesFor,
  type MembershipView,
  type SessionView,
} from '@sq/contracts';
import type { ApiConfig } from '../config.js';
import { burnVerificationTime, hashPassword, verifyPassword } from '../lib/password.js';
import {
  createSession,
  resolveSession,
  revokeAllForUser,
  revokeSession,
  type SessionRecord,
} from '../lib/sessions.js';
import { clientIp, parseBody, sendFail, sendOk } from '../lib/http.js';
import * as rateLimit from '../lib/rateLimit.js';
import { hashIp, hashToken } from '../lib/tokens.js';
import { requireSession } from '../lib/guard.js';

/** Cookie name. One name, so a second app on the same host cannot shadow it. */
export const SESSION_COOKIE = 'sq_session';

const SIGNIN_LIMIT = 10;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;

/** Build the view a front-end reads. Capabilities come from `@sq/contracts`, not
 *  from anything the browser sent. */
function toSessionView(session: SessionRecord, memberships: MembershipView[]): SessionView {
  const capabilities =
    session.role !== null
      ? [...capabilitiesFor(session.role)]
      : session.platformRole !== null
        ? [...platformCapabilitiesFor(session.platformRole)]
        : [];

  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    memberships,
    platformRole: session.platformRole,
    capabilities,
    mustChangePassword: session.mustChangePassword,
    expiresAt: session.expiresAt,
  };
}

/** The companies a person may enter. */
async function loadMemberships(db: Db, userId: string): Promise<MembershipView[]> {
  const rows = await db.all<{ tenant_id: string; tenant_name: string; role: string }>(
    `SELECT m.tenant_id, t.name AS tenant_name, m.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
      ORDER BY t.name`,
    [userId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role as MembershipView['role'],
  }));
}

export function registerAuth(app: FastifyInstance, db: Db, config: ApiConfig): void {
  app.post('/auth/sign-in', async (request, reply) => {
    const body = parseBody(signInRequest, request.body, reply);
    if (body === null) return;

    const ip = clientIp(request.headers, request.ip);
    const ipHash = hashIp(ip);

    // Two limits: one per account (stops one target being hammered) and one per
    // address (stops one attacker spraying many accounts).
    const perAccount = `${SIGNIN_LIMIT}:${body.email}`;
    const accountLimit = await rateLimit.consume(db, `signin:acct:${hashToken(perAccount)}`, SIGNIN_LIMIT, SIGNIN_WINDOW_MS);
    if (!accountLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }
    const ipLimit = await rateLimit.consume(db, `signin:ip:${ipHash}`, SIGNIN_LIMIT * 3, SIGNIN_WINDOW_MS);
    if (!ipLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts from this network. Try again later.');
    }

    const user = await db.get<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string | null;
      platform_role: string | null;
      disabled_at: string | null;
      must_change_password: number;
    }>(
      'SELECT id, email, display_name, password_hash, platform_role, disabled_at, must_change_password FROM users WHERE email = ?',
      [body.email],
    );

    if (user === null || user.disabled_at !== null) {
      // Same cost as a real check, and the same message: an attacker learns nothing
      // from the timing or the text.
      await burnVerificationTime(body.password);
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    // Pick the company to open. The first active membership, alphabetically, is
    // deterministic; a person in two companies switches explicitly afterwards.
    const memberships = await loadMemberships(db, user.id);
    const tenantId = memberships[0]?.tenantId ?? null;

    if (tenantId === null && user.platform_role === null) {
      return sendFail(reply, 'forbidden', 'This account belongs to no active company.');
    }

    const issued = await createSession(db, config, {
      userId: user.id,
      tenantId,
      ip: ipHash,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });

    if (!issued.ok) {
      // A distinct code, because "the company is out of seats" is a call to the
      // account manager, not a wrong password.
      return sendFail(reply, 'forbidden', 'Every seat in this company is in use. Close a session or ask for another seat.');
    }

    // A correct password clears the counter an attacker was filling.
    await rateLimit.reset(db, `signin:acct:${hashToken(perAccount)}`);

    reply.setCookie(SESSION_COOKIE, issued.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      path: '/',
      // The cookie carries its own expiry rather than being a session cookie: a
      // browser restart must not sign out a salesperson mid-visit.
      maxAge: Math.floor((Date.parse(issued.session.expiresAt) - Date.now()) / 1000),
    });

    const session = await resolveSession(db, config, issued.session.token);
    if (session === null) {
      return sendFail(reply, 'internal', 'The session could not be created.');
    }

    return sendOk(reply, toSessionView(session, memberships));
  });

  app.post('/auth/sign-out', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (typeof token === 'string' && token !== '') {
      const session = await resolveSession(db, config, token);
      if (session !== null) await revokeSession(db, session.sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return sendOk(reply, { signedOut: true });
  });

  app.get('/auth/session', async (request, reply) => {
    const session = requireSession(request, reply);
    if (session === null) return;
    const memberships = await loadMemberships(db, session.userId);
    return sendOk(reply, toSessionView(session, memberships));
  });

  app.post('/auth/password', async (request, reply) => {
    const session = requireSession(request, reply);
    if (session === null) return;

    const body = parseBody(changePasswordRequest, request.body, reply);
    if (body === null) return;

    const user = await db.get<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE id = ?',
      [session.userId],
    );
    if (user === null) return sendFail(reply, 'unauthorized', 'Sign in again.');

    const valid = await verifyPassword(body.currentPassword, user.password_hash);
    if (!valid) return sendFail(reply, 'validation_failed', 'The current password is not correct.', [
      { path: 'currentPassword', message: 'The current password is not correct.' },
    ]);

    if (body.newPassword === body.currentPassword) {
      return sendFail(reply, 'validation_failed', 'Choose a password you have not used here before.', [
        { path: 'newPassword', message: 'Choose a password you have not used here before.' },
      ]);
    }

    const hash = await hashPassword(body.newPassword);
    await db.run(
      'UPDATE users SET password_hash = ?, must_change_password = 0, password_set_at = ?, updated_at = ? WHERE id = ?',
      [hash, now(), now(), session.userId],
    );

    // Every other session is revoked. A password change that leaves the intruder's
    // session alive has not changed anything that matters.
    await revokeAllForUser(db, session.userId, session.sessionId);

    return sendOk(reply, { changed: true });
  });
}
