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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@sq/db';
import { now } from '@sq/db';
import {
  capabilitiesFor,
  changePasswordRequest,
  platformCapabilitiesFor,
  platformSignInRequest,
  signInRequest,
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

  /*
   * The current company, resolved once here so no screen has to guess.
   *
   * A screen that needs "which company am I in" reads these three. The client used to read
   * `memberships[0]`, which answers a different question — "which company sorts first" — and
   * answers it wrongly the moment a person holds two memberships.
   */
  const current = memberships.find((membership) => membership.tenantId === session.tenantId) ?? null;

  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    memberships,
    currentTenantId: session.tenantId,
    currentTenantCode: session.tenantCode,
    currentTenantName: current?.tenantName ?? null,
    platformRole: session.platformRole,
    capabilities,
    mustChangePassword: session.mustChangePassword,
    expiresAt: session.expiresAt,
  };
}

/** The companies a person may enter. */
async function loadMemberships(db: Db, userId: string): Promise<MembershipView[]> {
  const rows = await db.all<{ tenant_id: string; tenant_name: string; role: string; username: string }>(
    `SELECT m.tenant_id, t.name AS tenant_name, m.role, m.username
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
    username: row.username,
  }));
}

/**
 * Which person, in which company.
 *
 * The company is resolved **first** because the username is only unique inside one: `jo` in AAA
 * and `jo` in BBB are different people.
 *
 * A **suspended** company is resolved, not hidden. The caller checks the password before acting
 * on `tenantStatus`, so "this company is on hold" is only ever told to somebody who proved they
 * work there — a refusal that needed no password would confirm which codes are real. Everything
 * that is genuinely indistinguishable returns `null`: unknown code, unknown username, removed
 * membership, disabled account.
 */
export async function resolveSignIn(
  db: Db,
  input: { companyCode: string; username: string },
): Promise<{ userId: string; tenantId: string; tenantStatus: string } | null> {
  const row = await db.get<{
    user_id: string;
    tenant_id: string;
    tenant_status: string;
    disabled_at: string | null;
  }>(
    `SELECT m.user_id, m.tenant_id, t.status AS tenant_status, u.disabled_at
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN users   u ON u.id = m.user_id
      WHERE t.code = ?
        AND m.username = ? AND m.status = 'active'`,
    [input.companyCode.trim().toUpperCase(), input.username.trim().toLowerCase()],
  );

  if (row === null || row.disabled_at !== null) return null;
  return { userId: row.user_id, tenantId: row.tenant_id, tenantStatus: row.tenant_status };
}

export function registerAuth(app: FastifyInstance, db: Db, config: ApiConfig): void {
  /**
   * A company user signs in with the code of their company, their username and their password.
   *
   * Everything that can go wrong answers the same way. A caller who learns "that company exists
   * but that username does not" has been handed a way to enumerate customers and staff, so the
   * four failure modes below are deliberately indistinguishable in text, status and timing.
   */
  app.post('/auth/sign-in', async (request, reply) => {
    const body = parseBody(signInRequest, request.body, reply);
    if (body === null) return;

    if (body.companyCode === undefined || body.companyCode.trim() === '') {
      return sendFail(reply, 'validation_failed', 'Enter your company code.', [
        { path: 'companyCode', message: 'Enter your company code.' },
      ]);
    }

    const ip = clientIp(request.headers, request.ip);
    const ipHash = hashIp(ip);

    // Two limits: one per account (stops one target being hammered) and one per address (stops
    // one attacker spraying many accounts). The account key includes the company, because `jo`
    // in AAA and `jo` in BBB are different people.
    const perAccount = `signin:acct:${hashToken(`${body.companyCode.toUpperCase()}:${body.username}`)}`;
    const accountLimit = await rateLimit.consume(db, perAccount, SIGNIN_LIMIT, SIGNIN_WINDOW_MS);
    if (!accountLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }
    const ipLimit = await rateLimit.consume(db, `signin:ip:${ipHash}`, SIGNIN_LIMIT * 3, SIGNIN_WINDOW_MS);
    if (!ipLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts from this network. Try again later.');
    }

    const resolved = await resolveSignIn(db, {
      companyCode: body.companyCode,
      username: body.username,
    });

    if (resolved === null) {
      // Same cost as a real check: a fast "no such person" answers a different question from a
      // slow one, and the difference is how an attacker learns a code is real.
      await burnVerificationTime(body.password);
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    const user = await db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', [
      resolved.userId,
    ]);

    if (user === null) {
      await burnVerificationTime(body.password);
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    // A suspended company is only reported at this point: the password above has proved this is
    // their member, so the message leaks nothing a stranger could have used to enumerate codes.
    if (resolved.tenantStatus !== 'active') {
      return sendFail(reply, 'forbidden', 'This company is on hold. Contact your account manager.');
    }

    return completeSignIn({ request, reply, userId: resolved.userId, tenantId: resolved.tenantId, perAccount });
  });

  /**
   * Licence-vendor staff sign in by email.
   *
   * A separate route, not a flag on the one above: they belong to no company, so there is no code
   * to resolve and no username to look up. Keeping the two doors apart is what makes it impossible
   * for a company user to arrive through this one — the check below refuses an account that holds
   * a membership, because a company person belongs on the client app where seats and prices live.
   */
  app.post('/auth/sign-in-platform', async (request, reply) => {
    const body = parseBody(platformSignInRequest, request.body, reply);
    if (body === null) return;

    const ipHash = hashIp(clientIp(request.headers, request.ip));
    const perAccount = `signin:acct:${hashToken(body.email)}`;

    const accountLimit = await rateLimit.consume(db, perAccount, SIGNIN_LIMIT, SIGNIN_WINDOW_MS);
    if (!accountLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }
    const ipLimit = await rateLimit.consume(db, `signin:ip:${ipHash}`, SIGNIN_LIMIT * 3, SIGNIN_WINDOW_MS);
    if (!ipLimit.allowed) {
      return sendFail(reply, 'rate_limited', 'Too many attempts from this network. Try again later.');
    }

    const user = await db.get<{
      id: string;
      password_hash: string | null;
      platform_role: string | null;
      disabled_at: string | null;
    }>('SELECT id, password_hash, platform_role, disabled_at FROM users WHERE email = ?', [body.email]);

    if (user === null || user.disabled_at !== null || user.platform_role === null) {
      await burnVerificationTime(body.password);
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return sendFail(reply, 'unauthorized', 'Those details do not match an account.');
    }

    return completeSignIn({ request, reply, userId: user.id, tenantId: null, perAccount });
  });

  /**
   * Issue the session and answer with the view.
   *
   * Shared by both doors so a seat refusal, a cookie's attributes and the session view are written
   * once. A second copy would be a second place for the cookie to lose `httpOnly`.
   */
  async function completeSignIn(input: {
    request: FastifyRequest;
    reply: FastifyReply;
    userId: string;
    tenantId: string | null;
    perAccount: string;
  }): Promise<FastifyReply> {
    const { request, reply } = input;

    const issued = await createSession(db, config, {
      userId: input.userId,
      tenantId: input.tenantId,
      ip: hashIp(clientIp(request.headers, request.ip)),
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });

    if (!issued.ok) {
      // A distinct code, because "the company is out of seats" is a call to the account manager,
      // not a wrong password.
      return sendFail(reply, 'forbidden', 'Every seat in this company is in use. Close a session or ask for another seat.');
    }

    // A correct password clears the counter an attacker was filling.
    await rateLimit.reset(db, input.perAccount);

    reply.setCookie(SESSION_COOKIE, issued.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      path: '/',
      // The cookie carries its own expiry rather than being a session cookie: a browser restart
      // must not sign out a salesperson mid-visit.
      maxAge: Math.floor((Date.parse(issued.session.expiresAt) - Date.now()) / 1000),
    });

    const session = await resolveSession(db, config, issued.session.token);
    if (session === null) {
      return sendFail(reply, 'internal', 'The session could not be created.');
    }

    const memberships = await loadMemberships(db, input.userId);
    return sendOk(reply, toSessionView(session, memberships));
  }

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
