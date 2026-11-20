/**
 * Optional Guest accounts (spec docs/specs/guest-accounts.md).
 *
 * - `POST   /public/guest/account/sign-up`      — create, sign in, answer the profile.
 * - `POST   /public/guest/account/sign-in`      — answer the profile.
 * - `POST   /public/guest/account/sign-out`
 * - `GET    /public/guest/account`              — the profile, or 401.
 * - `PATCH  /public/guest/account`              — first name, last name, mobile.
 * - `POST   /public/guest/account/password`     — current + next.
 * - `GET    /public/guest/account/requests`     — requests sent while signed in.
 * - `GET    /public/guest/account/drafts`       — designs in progress.
 * - `PUT    /public/guest/account/drafts/:id`   — create or update (the page generates the id).
 * - `DELETE /public/guest/account/drafts/:id`
 *
 * Every query is filtered by the session's account: another account's draft id answers 404, the same
 * as an id that never existed. Only `sq_guest` is read here; `sq_session` opens nothing on this path.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import {
  guestDraftWriteSchema,
  guestPasswordChangeSchema,
  guestProfilePatchSchema,
  guestSignInSchema,
  guestSignUpSchema,
  normaliseAuMobile,
  type GuestAccountRequestView,
  type GuestDraftStep,
  type GuestDraftView,
  type GuestRequestPublicStatus,
} from '@sq/contracts';
import { clientIp, parseBody, sendFail, sendOk } from '../lib/http.js';
import { burnVerificationTime, hashPassword, verifyPassword } from '../lib/password.js';
import { consume, reset } from '../lib/rateLimit.js';
import { hashIp } from '../lib/tokens.js';
import {
  endGuestSession,
  guestAccountFromRequest,
  normaliseGuestEmail,
  profileView,
  startGuestSession,
  type GuestAccountRow,
  type GuestAccountSession,
} from '../lib/guestAccount.js';

const MINUTE_MS = 60 * 1000;
export const GUEST_ACCOUNT_LIMITS = {
  signInPerIp: { limit: 10, windowMs: 15 * MINUTE_MS },
  signInPerEmail: { limit: 10, windowMs: 15 * MINUTE_MS },
  signUpPerIp: { limit: 5, windowMs: 60 * MINUTE_MS },
  draftWritesPerAccount: { limit: 120, windowMs: 10 * MINUTE_MS },
} as const;
export const GUEST_DRAFT_LIMIT = 20;
const REQUEST_LIST_LIMIT = 100;

const WRONG_CREDENTIALS = 'Email or password is incorrect.';
const SIGNED_OUT = 'Sign in to see your profile.';
const TOO_MANY = 'Too many attempts. Try again in a few minutes.';

const ACCOUNT_COLUMNS = 'id, email_norm, password_hash, first_name, last_name, mobile, created_at';

const draftId = z.uuid();

function publicStatus(status: string): GuestRequestPublicStatus {
  if (status === 'transferred') return 'being_quoted';
  if (status === 'declined' || status === 'spam') return 'closed';
  return 'received';
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface DraftRow {
  id: string;
  design_json: string;
  step: string;
  source_json: string | null;
  revision_of: string | null;
  created_at: string;
  updated_at: string;
}

function draftView(row: DraftRow): GuestDraftView | null {
  const design = parseJson<GuestDraftView['design']>(row.design_json);
  if (design === null) return null;
  return {
    id: row.id,
    design,
    step: row.step as GuestDraftStep,
    source: parseJson(row.source_json),
    revisionOf: row.revision_of,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerGuestAccount(app: FastifyInstance, db: Db): void {
  /** The session, or null after a 401 has been sent. */
  async function requireGuest(request: FastifyRequest, reply: FastifyReply): Promise<GuestAccountSession | null> {
    const session = await guestAccountFromRequest(db, request);
    if (session === null) {
      sendFail(reply, 'unauthorized', SIGNED_OUT);
      return null;
    }
    return session;
  }

  app.post('/public/guest/account/sign-up', async (request, reply) => {
    const ipLimit = await consume(
      db,
      `guest-signup:ip:${hashIp(clientIp(request))}`,
      GUEST_ACCOUNT_LIMITS.signUpPerIp.limit,
      GUEST_ACCOUNT_LIMITS.signUpPerIp.windowMs,
    );
    if (!ipLimit.allowed) return sendFail(reply, 'rate_limited', TOO_MANY);

    const body = parseBody(guestSignUpSchema, request.body, reply);
    if (body === null) return;

    const mobile = normaliseAuMobile(body.mobile) ?? body.mobile;
    const emailNorm = normaliseGuestEmail(body.email);
    const passwordHash = await hashPassword(body.password);
    const at = now();

    const created = await db.get<GuestAccountRow>(
      `INSERT INTO guest_accounts (id, email_norm, password_hash, first_name, last_name, mobile, created_at, updated_at, last_sign_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email_norm) DO NOTHING
       RETURNING ${ACCOUNT_COLUMNS}`,
      [newId(), emailNorm, passwordHash, body.firstName, body.lastName, mobile, at, at, at],
    );
    if (created === null) {
      return sendFail(reply, 'conflict', 'An account with this email already exists — sign in instead.', [
        { path: 'email', message: 'An account with this email already exists' },
      ]);
    }

    await startGuestSession(db, reply, created.id);
    return sendOk(reply, profileView(created), 201);
  });

  app.post('/public/guest/account/sign-in', async (request, reply) => {
    const ipLimit = await consume(
      db,
      `guest-signin:ip:${hashIp(clientIp(request))}`,
      GUEST_ACCOUNT_LIMITS.signInPerIp.limit,
      GUEST_ACCOUNT_LIMITS.signInPerIp.windowMs,
    );
    if (!ipLimit.allowed) return sendFail(reply, 'rate_limited', TOO_MANY);

    const body = parseBody(guestSignInSchema, request.body, reply);
    if (body === null) return;

    const emailNorm = normaliseGuestEmail(body.email);
    const emailKey = `guest-signin:email:${emailNorm}`;
    const emailLimit = await consume(
      db,
      emailKey,
      GUEST_ACCOUNT_LIMITS.signInPerEmail.limit,
      GUEST_ACCOUNT_LIMITS.signInPerEmail.windowMs,
    );
    if (!emailLimit.allowed) return sendFail(reply, 'rate_limited', TOO_MANY);

    const account = await db.get<GuestAccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM guest_accounts WHERE email_norm = ?`,
      [emailNorm],
    );
    if (account === null) {
      // Same work and the same answer as a wrong password: the reply does not say which emails exist.
      await burnVerificationTime(body.password);
      return sendFail(reply, 'unauthorized', WRONG_CREDENTIALS);
    }
    if (!(await verifyPassword(body.password, account.password_hash))) {
      return sendFail(reply, 'unauthorized', WRONG_CREDENTIALS);
    }

    await reset(db, emailKey);
    await db.run('UPDATE guest_accounts SET last_sign_in_at = ? WHERE id = ?', [now(), account.id]);
    await startGuestSession(db, reply, account.id);
    return sendOk(reply, profileView(account));
  });

  app.post('/public/guest/account/sign-out', async (request, reply) => {
    await endGuestSession(db, request, reply);
    return sendOk(reply, { signedOut: true });
  });

  app.get('/public/guest/account', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;
    return sendOk(reply, profileView(session.account));
  });

  app.patch('/public/guest/account', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;
    const body = parseBody(guestProfilePatchSchema, request.body, reply);
    if (body === null) return;

    const mobile = normaliseAuMobile(body.mobile) ?? body.mobile;
    const updated = await db.get<GuestAccountRow>(
      `UPDATE guest_accounts SET first_name = ?, last_name = ?, mobile = ?, updated_at = ?
        WHERE id = ? RETURNING ${ACCOUNT_COLUMNS}`,
      [body.firstName, body.lastName, mobile, now(), session.account.id],
    );
    if (updated === null) return sendFail(reply, 'unauthorized', SIGNED_OUT);
    return sendOk(reply, profileView(updated));
  });

  app.post('/public/guest/account/password', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;

    const limit = await consume(
      db,
      `guest-password:account:${session.account.id}`,
      GUEST_ACCOUNT_LIMITS.signInPerEmail.limit,
      GUEST_ACCOUNT_LIMITS.signInPerEmail.windowMs,
    );
    if (!limit.allowed) return sendFail(reply, 'rate_limited', TOO_MANY);

    const body = parseBody(guestPasswordChangeSchema, request.body, reply);
    if (body === null) return;
    if (!(await verifyPassword(body.current, session.account.password_hash))) {
      return sendFail(reply, 'validation_failed', 'The current password is incorrect.', [
        { path: 'current', message: 'The current password is incorrect' },
      ]);
    }

    const hash = await hashPassword(body.next);
    await db.transaction(async (tx) => {
      await tx.run('UPDATE guest_accounts SET password_hash = ?, updated_at = ? WHERE id = ?', [
        hash,
        now(),
        session.account.id,
      ]);
      // Other browsers signed in with the old password are signed out; this one stays.
      await tx.run('DELETE FROM guest_account_sessions WHERE account_id = ? AND id <> ?', [
        session.account.id,
        session.sessionId,
      ]);
    });
    return sendOk(reply, { changed: true });
  });

  app.get('/public/guest/account/requests', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;

    const rows = await db.all<{ number: string; status: string; design_json: string; created_at: string }>(
      `SELECT number, status, design_json, created_at FROM guest_requests
        WHERE account_id = ? ORDER BY created_at DESC LIMIT ${REQUEST_LIST_LIMIT}`,
      [session.account.id],
    );
    const items: GuestAccountRequestView[] = [];
    for (const row of rows) {
      const design = parseJson<GuestAccountRequestView['design']>(row.design_json);
      if (design === null) continue;
      items.push({ number: row.number, status: publicStatus(row.status), design, createdAt: row.created_at });
    }
    return sendOk(reply, { items });
  });

  app.get('/public/guest/account/drafts', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;

    const rows = await db.all<DraftRow>(
      `SELECT id, design_json, step, source_json, revision_of, created_at, updated_at FROM guest_drafts
        WHERE account_id = ? ORDER BY updated_at DESC LIMIT ${GUEST_DRAFT_LIMIT}`,
      [session.account.id],
    );
    const items = rows.map(draftView).filter((d): d is GuestDraftView => d !== null);
    return sendOk(reply, { items });
  });

  app.put<{ Params: { id: string } }>('/public/guest/account/drafts/:id', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;
    const id = draftId.safeParse(request.params.id);
    if (!id.success) return sendFail(reply, 'not_found', 'That draft was not found.');

    const limit = await consume(
      db,
      `guest-drafts:account:${session.account.id}`,
      GUEST_ACCOUNT_LIMITS.draftWritesPerAccount.limit,
      GUEST_ACCOUNT_LIMITS.draftWritesPerAccount.windowMs,
    );
    if (!limit.allowed) return sendFail(reply, 'rate_limited', 'Saving too often. Your design is still on this page.');

    const body = parseBody(guestDraftWriteSchema, request.body, reply);
    if (body === null) return;

    const accountId = session.account.id;
    const at = now();
    const saved = await db.transaction(async (tx) => {
      /*
       * The id is the page's, so this is an upsert. The `WHERE` on the update half is what makes an
       * id that belongs to another account a 404: Postgres returns no row when the update is skipped.
       */
      const row = await tx.get<DraftRow>(
        `INSERT INTO guest_drafts (id, account_id, design_json, step, source_json, revision_of, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           design_json = excluded.design_json,
           step        = excluded.step,
           source_json = excluded.source_json,
           revision_of = excluded.revision_of,
           updated_at  = excluded.updated_at
         WHERE guest_drafts.account_id = excluded.account_id
         RETURNING id, design_json, step, source_json, revision_of, created_at, updated_at`,
        [
          id.data,
          accountId,
          JSON.stringify(body.design),
          body.step,
          body.source === undefined ? null : JSON.stringify(body.source),
          body.revisionOf ?? null,
          at,
          at,
        ],
      );
      if (row === null) return null;
      // Keep the newest GUEST_DRAFT_LIMIT; the oldest goes.
      await tx.run(
        `DELETE FROM guest_drafts WHERE account_id = ? AND id NOT IN (
           SELECT id FROM guest_drafts WHERE account_id = ? ORDER BY updated_at DESC, id LIMIT ${GUEST_DRAFT_LIMIT})`,
        [accountId, accountId],
      );
      return row;
    });

    const view = saved === null ? null : draftView(saved);
    if (view === null) return sendFail(reply, 'not_found', 'That draft was not found.');
    return sendOk(reply, view);
  });

  app.delete<{ Params: { id: string } }>('/public/guest/account/drafts/:id', async (request, reply) => {
    const session = await requireGuest(request, reply);
    if (session === null) return;
    const id = draftId.safeParse(request.params.id);
    if (!id.success) return sendFail(reply, 'not_found', 'That draft was not found.');

    const gone = await db.get<{ id: string }>(
      'DELETE FROM guest_drafts WHERE id = ? AND account_id = ? RETURNING id',
      [id.data, session.account.id],
    );
    if (gone === null) return sendFail(reply, 'not_found', 'That draft was not found.');
    return sendOk(reply, { deleted: true });
  });
}
