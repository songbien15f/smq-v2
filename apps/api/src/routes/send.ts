/**
 * Sending a quote, and moving it through its life.
 *
 * A send and a status are different acts, and keeping them different is what makes "issued" mean
 * something. The status records the fact that a customer was sent something; the send route is what
 * makes the fact true. A status that could be set without the email going out would be a claim with
 * no evidence, and an email that could go out without the status moving would leave the quote in a
 * state that says it was never sent.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { z } from 'zod';
import { loadFrozenRevision } from '../lib/documents.js';
import { dispatchNextJob, enqueueSend, SendRefused } from '../lib/mail/queue.js';
import { createSmtpTransport, smtpConfigFromEnv, mailIsConfigured } from '../lib/mail/smtp.js';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { recordUsage } from '../lib/usage.js';
import { newId } from '@sq/db';
import { QUOTE_STATUSES, type QuoteStatus } from '@sq/contracts';

/**
 * What the email is for.
 *
 * The desktop's four send intents, each with its own counter on the quote: a quote goes to the
 * customer, engineering and manufacturing each get their own order. `both` increments the two
 * factory counters, because it is one action that serves both.
 */
const SEND_MODES = ['quote', 'engineering', 'manufacturing', 'both'] as const;
type SendMode = (typeof SEND_MODES)[number];

/** Ask for a quote to be emailed. */
const sendRequest = z.object({
  revisionId: z.string().uuid(),
  to: z.string().trim().min(3),
  subject: z.string().trim().min(1).max(200),
  /** A plain message, sent as the mail body. */
  body: z.string().min(0).max(5000).default(''),
  /** The operator has read the indicative caveats. */
  acknowledgeIndicative: z.boolean().default(false),
  /** One key per intent: a double-click is one email. */
  idempotencyKey: z.string().min(8).max(128),
  /** What the mail is for; the default keeps every existing caller working. */
  mode: z.enum(SEND_MODES).default('quote'),
});

/** The counter columns a mode increments. Exported for its unit test. */
export function countersFor(mode: SendMode): string[] {
  switch (mode) {
    case 'quote':
      return ['quote_send_count'];
    case 'engineering':
      return ['engineering_send_count'];
    case 'manufacturing':
      return ['manufacturing_send_count'];
    case 'both':
      return ['engineering_send_count', 'manufacturing_send_count'];
  }
}

/** Move a quote to a status a person is allowed to set. */
const statusRequest = z.object({
  to: z.enum(QUOTE_STATUSES),
  note: z.string().max(500).optional(),
});

export function registerSend(app: FastifyInstance, db: Db): void {
  /**
   * Queue and dispatch one send.
   *
   * Dispatched inline rather than left in the queue: a quote email is a rare, short operation and
   * the operator wants the relay's answer, not "accepted into the queue". The queue is what makes a
   * crash recoverable, not what defers the work.
   */
  app.post<{ Params: { quoteId: string } }>('/quotes/:quoteId/send', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:send');
    if (session === null) return;

    const body = parseBody(sendRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;

    // A refusal before anything is queued: the mailer, when it is not configured.
    if (!mailIsConfigured()) {
      return sendFail(
        reply,
        'not_configured',
        'Mail is not configured on this server, so a quote cannot be sent. The PDF and the share link still work.',
      );
    }

    let job;
    try {
      job = await enqueueSend(db, {
        tenantId,
        userId: session.userId,
        quoteId: request.params.quoteId,
        revisionId: body.revisionId,
        to: body.to,
        subject: body.subject,
        body: body.body,
        acknowledgeIndicative: body.acknowledgeIndicative,
        idempotencyKey: body.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof SendRefused) {
        return sendFail(reply, 'conflict', error.message);
      }
      throw error;
    }

    // An idempotent replay: the first send already happened, and it is the one that counts.
    if (job.state !== 'queued') {
      return sendOk(reply, { jobId: job.id, state: job.state, replayed: true });
    }

    /*
     * Count the intent, once the queue accepted it.
     *
     * The column name comes from `countersFor`'s closed set, never from the request. Counting
     * after the insert means a replay (handled above) cannot double-count, and a failed insert
     * cannot claim a request that was never queued.
     */
    for (const column of countersFor(body.mode)) {
      await db.run(`UPDATE quotes SET ${column} = ${column} + 1 WHERE id = ? AND tenant_id = ?`, [
        request.params.quoteId,
        tenantId,
      ]);
    }

    const dispatch = await dispatchNextJob(
      db,
      createSmtpTransport(smtpConfigFromEnv()),
      {
        async renderPdf(html) {
          const { renderPdf, chromePathFromEnv } = await import('@sq/core/documents');
          return renderPdf(html, { executablePath: chromePathFromEnv() });
        },
        from() {
          // The verified platform address. A company supplies a Reply-To, never a From.
          const value = process.env.MAIL_FROM;
          if (value === undefined || value.trim() === '') {
            throw new Error(
              'MAIL_FROM is not set: it must be an address on a domain verified with the relay.',
            );
          }
          return value.trim();
        },
        async replyTo(tenantId) {
          const row = await db.get<{ settings_json: string }>(
            'SELECT settings_json FROM company_settings WHERE tenant_id = ? ORDER BY version DESC LIMIT 1',
            [tenantId],
          );
          if (row === null) return process.env.MAIL_FROM ?? '';
          const parsed = JSON.parse(row.settings_json) as { email?: string };
          return parsed.email ?? process.env.MAIL_FROM ?? '';
        },
      },
    );

      /*
       * Record only an accepted send. A `failed` job never left the building and an `unknown` one may
       * not have, so counting either as "a quote was sent" would overstate the one figure a vendor
       * uses to judge whether the product is being used.
       */
      if (dispatch?.state === 'accepted') {
        await recordUsage(db, {
          kind: 'mail_sent',
          tenantId,
          userId: session.userId,
          detail: { quoteId: request.params.quoteId, revision: body.revisionId },
        });
      }

      return sendOk(
        reply,
        {
          jobId: dispatch?.id ?? job.id,
          state: dispatch?.state ?? 'queued',
          messageId: dispatch?.messageId ?? null,
          ...(dispatch?.lastError !== undefined && dispatch?.lastError !== null
            ? { error: dispatch.lastError }
            : {}),
        },
        dispatch?.state === 'accepted' ? 200 : 502,
      );
  });

  /** The attempts, newest first, so an operator can see what happened to a send. */
  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId/sends', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const { listSends } = await import('../lib/mail/queue.js');
    const jobs = await listSends(db, session.tenantId as string, request.params.quoteId);
    return sendOk(reply, { items: jobs });
  });

  /**
   * Move a quote's status.
   *
   * Only the moves a person is entitled to make: `draft → issued` happens through the send route,
   * and the terminal states are set from the customer's answer. No arbitrary jump: a status is a
   * record, and a record that can be set to anything is no record at all.
   */
  app.patch<{ Params: { quoteId: string } }>('/quotes/:quoteId/status', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const body = parseBody(statusRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;

    const ALLOWED: Record<string, readonly QuoteStatus[]> = {
      draft: ['issued', 'declined', 'expired'],
      issued: ['accepted', 'declined', 'expired'],
      // Terminal. A declined quote is information: the record stays, and it is not re-opened.
      accepted: [],
      declined: [],
      expired: [],
    };

    const current = await db.get<{ status: QuoteStatus }>(
      'SELECT status FROM quotes WHERE id = ? AND tenant_id = ?',
      [request.params.quoteId, tenantId],
    );
    if (current === null) return sendFail(reply, 'not_found', 'Not found.');

    if (!ALLOWED[current.status]?.includes(body.to)) {
      return sendFail(
        reply,
        'conflict',
        `A quote in "${current.status}" cannot be moved to "${body.to}". Only a send moves it out of "draft".`,
      );
    }

    const auditId = newId();
    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        [body.to, new Date().toISOString(), request.params.quoteId, tenantId],
      );
      await tx.run(
        `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
         VALUES (?, ?, ?, ?, ?, 'quote', ?, ?)`,
        [
          auditId,
          new Date().toISOString(),
          session.userId,
          session.email,
          'quote.status',
          request.params.quoteId,
          `Moved from ${current.status} to ${body.to}${body.note ? ` — ${body.note}` : ''}`,
        ],
      );
    });

    return sendOk(reply, { status: body.to });
  });
}
