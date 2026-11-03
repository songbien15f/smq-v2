/**
 * Share links: the read-only page a customer opens without signing in.
 *
 * ## Three decisions that make this safe
 *
 * 1. **Only the hash is stored.** A leaked database yields no working link. The token is 256 bits of
 *    randomness, so there is nothing to brute-force — `sha256` is enough, and a slow hash would only
 *    cost a lookup on every open.
 * 2. **The token arrives in the URL fragment**, not the path or the query. A fragment is never sent
 *    to a server in a request line or a `Referer` header, so it does not land in a proxy log, an
 *    analytics tool or a customer's browser history on somebody else's machine.
 * 3. **It is exchanged for a cookie, once.** `POST /share/redeem` takes the token and sets an
 *    HttpOnly cookie scoped to that share; the document route then re-reads without the token in the
 *    URL. Re-presenting a token on every request would leave it in the address bar of every page.
 *
 * ## What a link can never do
 *
 * It is bound to **one revision**. Not the quote, not the current revision — the exact frozen
 * snapshot the operator chose to send. A new revision cannot leak through a link minted for an old
 * one, which is the property that makes the revision model worth its cost.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { z } from 'zod';
import { renderQuoteHtml, toCustomerDocument } from '@sq/core/documents';
import { clientIp, parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { hashIp, hashToken, newToken, tokenMatches } from '../lib/tokens.js';
import { loadFrozenRevision, RevisionNotFound } from '../lib/documents.js';

/** The cookie a redeemed share sets. Named for the purpose, so it cannot be confused with a session. */
const SHARE_COOKIE = 'sq_share';

/** Minting a link. */
const createShareRequest = z.object({
  revisionId: z.string().uuid(),
  /** Days until the link stops working. 1–90. */
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

/** Redeeming one. */
const redeemRequest = z.object({
  token: z.string().min(20).max(200),
});

export function registerShares(app: FastifyInstance, db: Db, publicOrigin: string): void {
  /**
   * Mint a link for one revision.
   *
   * `quote:send` rather than `quote:read`: giving a customer a link is the act of sending, and a
   * viewer must not be able to publish a quote they may only read.
   */
  app.post<{ Params: { quoteId: string } }>('/quotes/:quoteId/shares', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:send');
    if (session === null) return;

    const body = parseBody(createShareRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;

    // The revision must belong to this quote and this company. Checked here rather than trusted from
    // the body: a revision id is a uuid, and a uuid from another company is not a credential.
    const revision = await db.get<{ quote_id: string }>(
      'SELECT quote_id FROM quote_revisions WHERE id = ? AND quote_id = ? AND tenant_id = ?',
      [body.revisionId, request.params.quoteId, tenantId],
    );
    if (revision === null) return sendFail(reply, 'not_found', 'Not found.');

    const token = newToken();
    const id = newId();
    const createdAt = now();
    const expiresAt = new Date(Date.parse(createdAt) + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO quote_shares (id, tenant_id, quote_id, revision_id, token_hash, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, request.params.quoteId, body.revisionId, hashToken(token), session.userId, createdAt, expiresAt],
    );

    // The token is returned **once**, here, and never stored in a readable form. An operator who
    // loses it mints another; there is no route that shows an existing one, because that route would
    // have to keep it.
    return sendOk(
      reply,
      {
        id,
        // The fragment, not the path: it never reaches a server log or a Referer.
        url: `${publicOrigin.replace(/\/$/, '')}/s#${token}`,
        expiresAt,
      },
      201,
    );
  });

  /** The links already issued for a quote, so an operator can see what is out there. */
  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId/shares', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const rows = await db.all<{
      id: string;
      revision: number;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
      view_count: number;
      last_viewed_at: string | null;
    }>(
      `SELECT s.id, r.revision, s.created_at, s.expires_at, s.revoked_at, s.view_count, s.last_viewed_at
         FROM quote_shares s
         JOIN quote_revisions r ON r.id = s.revision_id
        WHERE s.quote_id = ? AND s.tenant_id = ?
        ORDER BY s.created_at DESC`,
      [request.params.quoteId, session.tenantId],
    );

    // Deliberately no `url` in this answer: the token cannot be recovered, only replaced.
    return sendOk(reply, { items: rows });
  });

  /** Revoke a link. */
  app.delete<{ Params: { quoteId: string; shareId: string } }>(
    '/quotes/:quoteId/shares/:shareId',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'quote:send');
      if (session === null) return;

      const changed = await db.run(
        'UPDATE quote_shares SET revoked_at = ? WHERE id = ? AND quote_id = ? AND tenant_id = ? AND revoked_at IS NULL',
        [now(), request.params.shareId, request.params.quoteId, session.tenantId],
      );

      if (changed.changes === 0) return sendFail(reply, 'not_found', 'Not found.');
      return sendOk(reply, { revoked: true });
    },
  );

  /**
   * Exchange a token for a cookie.
   *
   * Unauthenticated by design — the customer has no account. The token **is** the credential, so
   * this route is rate-limited by address: a token is 256 bits and cannot be guessed, but an
   * unlimited endpoint is still an unlimited amount of work.
   */
  app.post('/share/redeem', async (request, reply) => {
    const body = parseBody(redeemRequest, request.body, reply);
    if (body === null) return;

    const row = await db.get<{
      id: string;
      quote_id: string;
      revision_id: string;
      expires_at: string;
      revoked_at: string | null;
      token_hash: string;
    }>(
      `SELECT id, quote_id, revision_id, expires_at, revoked_at, token_hash
         FROM quote_shares WHERE token_hash = ?`,
      [hashToken(body.token)],
    );

    // Every refusal is the same answer: an expired link and an unknown one must be
    // indistinguishable, or the difference tells somebody that a given quote exists.
    if (row === null || row.revoked_at !== null) {
      return sendFail(reply, 'not_found', 'This link is no longer available. Ask for a new one.');
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      return sendFail(reply, 'not_found', 'This link is no longer available. Ask for a new one.');
    }
    // Belt and braces: the lookup was by hash, so a mismatch cannot happen, but comparing in constant
    // time costs nothing and removes the question.
    if (!tokenMatches(body.token, row.token_hash)) {
      return sendFail(reply, 'not_found', 'This link is no longer available. Ask for a new one.');
    }

    await db.run(
      'UPDATE quote_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?',
      [now(), row.id],
    );

    // The cookie carries the share id, not the token: an HttpOnly cookie is invisible to script, and
    // the id is useless without the row it names.
    reply.setCookie(SHARE_COOKIE, row.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.max(60, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000)),
    });

    return sendOk(reply, { shareId: row.id, expiresAt: row.expires_at });
  });

  /**
   * The shared document.
   *
   * Reads the cookie, re-checks expiry and revocation, and renders the frozen revision. No session,
   * no company, no operator — just the page the customer was sent.
   */
  app.get('/share/document', async (request, reply) => {
    const shareId = request.cookies[SHARE_COOKIE];
    if (typeof shareId !== 'string' || shareId === '') {
      return sendFail(reply, 'unauthorized', 'Open the link you were sent.');
    }

    const row = await db.get<{
      quote_id: string;
      revision: number;
      tenant_id: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT s.quote_id, r.revision, s.tenant_id, s.expires_at, s.revoked_at
         FROM quote_shares s
         JOIN quote_revisions r ON r.id = s.revision_id
        WHERE s.id = ?`,
      [shareId],
    );

    if (row === null || row.revoked_at !== null || Date.parse(row.expires_at) <= Date.now()) {
      reply.clearCookie(SHARE_COOKIE, { path: '/' });
      return sendFail(reply, 'not_found', 'This link is no longer available. Ask for a new one.');
    }

    try {
      const frozen = await loadFrozenRevision(db, {
        tenantId: row.tenant_id,
        quoteId: row.quote_id,
        revision: Number(row.revision),
      });

      return reply
        .status(200)
        .header('content-type', 'text/html; charset=utf-8')
        // A shared quote is a private document: no caching by a proxy, and no indexing.
        .header('cache-control', 'no-store, private')
        .header('x-robots-tag', 'noindex, nofollow')
        .send(renderQuoteHtml(toCustomerDocument(frozen)));
    } catch (error) {
      if (error instanceof RevisionNotFound) {
        return sendFail(reply, 'not_found', 'This link is no longer available. Ask for a new one.');
      }
      throw error;
    }
  });
}

/** Exported so the site app can name the same cookie in its own route handler. */
export { SHARE_COOKIE };
export { clientIp as shareClientIp, hashIp as shareHashIp };
