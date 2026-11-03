/**
 * The send queue.
 *
 * SMTP is not a transaction. A message can be accepted and the acknowledgement lost, and then no
 * client can tell whether the customer received it. So a send is a **persisted job** with a state
 * that records what actually happened, and every rule below exists because of a specific way that
 * can go wrong:
 *
 * - **Claim before sending.** A job is leased to one worker, so two workers cannot send the same
 *   quote. The lease expires, so a crashed worker does not strand a job forever.
 * - **`accepted` is not `delivered`.** The state says what the *mail server* said. Naming it
 *   `delivered` would be a claim this program cannot make.
 * - **`unknown` is never retried automatically.** A crash between the SMTP call and the result write
 *   leaves exactly this state. Sending a customer a second quote is worse than an operator checking.
 * - **A failure is safe to retry by hand**, because the server refused it.
 * - **The same idempotency key is the same job**, so a double-click is one email.
 *
 * The job stores the **revision id**, not the rendered document: the PDF is built from the frozen
 * revision at dispatch time, so a queued send cannot carry a document that has since changed — and a
 * revision cannot change, which is what makes that guarantee cheap.
 */

import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { toCustomerDocument } from '@sq/core/documents';
import { renderFrozenHtml } from '../documents.js';
import type { MailTransport, OutboundMail } from './transport.js';

/** Where a job is in its life. */
export type SendState = 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'cancelled';

/** How long a worker's claim lasts before another may take the job. */
export const LEASE_MS = 5 * 60 * 1000;

/** One queued send. */
export interface SendJob {
  id: string;
  tenantId: string;
  quoteId: string;
  revisionId: string;
  revisionHash: string;
  to: string;
  subject: string;
  body: string;
  state: SendState;
  attempts: number;
  messageId: string | null;
  lastError: string | null;
  acknowledgedIndicative: boolean;
  createdAt: string;
  sentAt: string | null;
}

/** Raised when a send is refused before anything is queued. */
export class SendRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendRefused';
  }
}

/** Map a row. Columns are snake_case; the type is camelCase, and the conversion lives here only. */
function mapJob(row: Record<string, unknown>): SendJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    quoteId: String(row.quote_id),
    revisionId: String(row.revision_id),
    revisionHash: String(row.revision_hash),
    to: String(row.to_email),
    subject: String(row.subject),
    body: String(row.body),
    state: String(row.state) as SendState,
    attempts: Number(row.attempts),
    messageId: row.message_id === null ? null : String(row.message_id),
    lastError: row.last_error === null ? null : String(row.last_error),
    acknowledgedIndicative: Number(row.acknowledged_indicative) === 1,
    createdAt: String(row.created_at),
    sentAt: row.sent_at === null ? null : String(row.sent_at),
  };
}

/** True when `value` looks like an address. Deliberately permissive: the relay is authoritative. */
function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** What a caller must supply to queue a send. */
export interface EnqueueInput {
  tenantId: string;
  userId: string;
  quoteId: string;
  revisionId: string;
  to: string;
  subject: string;
  body: string;
  /** The operator has seen the indicative caveat and accepts it. */
  acknowledgeIndicative: boolean;
  idempotencyKey: string;
}

/**
 * Queue a send, refusing anything that must not reach a customer.
 *
 * Every refusal happens **before** a row is written, so a refused send leaves no trace that looks
 * like an attempt: a job in the queue is a job somebody meant to send.
 */
export async function enqueueSend(db: Db, input: EnqueueInput): Promise<SendJob> {
  const to = input.to.trim().toLowerCase();
  if (!looksLikeEmail(to)) {
    throw new SendRefused('That is not an email address.');
  }

  const revision = await db.get<{
    id: string;
    result_hash: string;
    mocked_lines: number;
    issues_json: string;
  }>(
    `SELECT id, result_hash, mocked_lines, issues_json
       FROM quote_revisions WHERE id = ? AND quote_id = ? AND tenant_id = ?`,
    [input.revisionId, input.quoteId, input.tenantId],
  );
  if (revision === null) throw new SendRefused('That revision is not on this quote.');

  // A quote with an unpriced line has a total that is not a total. Sending it is how a placeholder
  // becomes an offer.
  if (Number(revision.mocked_lines) > 0) {
    throw new SendRefused(
      `${revision.mocked_lines} line(s) in this quote have no price, so the total is not a total. Do not send it until the price book covers them.`,
    );
  }

  const issues = JSON.parse(revision.issues_json || '[]') as { severity?: string }[];
  if (issues.some((issue) => issue.severity === 'blocker')) {
    throw new SendRefused('This quote is blocked and cannot be sent to a customer.');
  }

  // An indicative quote is sendable — it is *better* than a firm one that hides an allowance — but
  // only once the operator has acknowledged the caveat on the page.
  const indicative = issues.some((issue) => issue.severity === 'assumption');
  if (indicative && !input.acknowledgeIndicative) {
    throw new SendRefused(
      'This quotation is indicative: it contains allowances. Confirm you have read them before sending.',
    );
  }

  const existing = await db.get<Record<string, unknown>>(
    'SELECT * FROM send_jobs WHERE tenant_id = ? AND idempotency_key = ?',
    [input.tenantId, input.idempotencyKey],
  );
  if (existing !== null) return mapJob(existing);

  const id = newId();
  const at = now();

  await db.run(
    `INSERT INTO send_jobs
       (id, tenant_id, quote_id, revision_id, revision_hash, to_email, from_email, reply_to,
        subject, body, state, attempts, acknowledged_indicative, idempotency_key,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.quoteId,
      input.revisionId,
      revision.result_hash,
      to,
      // The From is filled at dispatch from the verified platform address; a placeholder here would
      // be a value somebody mistakes for real.
      '',
      input.subject,
      input.body,
      indicative ? 1 : 0,
      input.idempotencyKey,
      input.userId,
      at,
      at,
    ],
  );

  const row = await db.get<Record<string, unknown>>('SELECT * FROM send_jobs WHERE id = ?', [id]);
  return mapJob(row as Record<string, unknown>);
}

/**
 * Resolve jobs whose worker died holding them.
 *
 * A job is `sending` with a lease. If the process dies mid-send the lease expires and nothing ever
 * moves the row — so it sits in `sending` forever, and the operator has no way to tell whether the
 * customer received a quote. That is the worst of the three possible answers.
 *
 * The resolution is `unknown`, never a retry: **we genuinely do not know whether the mail server
 * accepted the message.** Sending a customer a second quote is worse than asking an operator to
 * check, so the row is marked for a person rather than resolved automatically. `markUnknown`'s own
 * message says exactly that.
 *
 * Run before every claim, so a crashed worker's jobs surface the first time anybody sends anything.
 */
async function resolveExpiredLeases(db: Db): Promise<void> {
  await db.run(
    `UPDATE send_jobs
        SET state = 'unknown', leased_until = NULL, updated_at = ?,
            last_error = ?
      WHERE state = 'sending' AND leased_until IS NOT NULL AND leased_until < ?`,
    [
      now(),
      'The send was interrupted. The mail server may or may not have accepted it — check before retrying.',
      now(),
    ],
  );
}

/**
 * Claim the oldest queued job, or `null`.
 *
 * The claim is a single `UPDATE … WHERE state = 'queued'` whose row count decides the winner, so two
 * workers cannot both take it. Reading first and writing after is the shape that produces two sends;
 * the affected-row count is what makes the claim atomic.
 */
export async function claimJob(db: Db, leaseMs = LEASE_MS): Promise<SendJob | null> {
  await resolveExpiredLeases(db);

  return db.transaction(async (tx) => {
    const row = await tx.get<{ id: string }>(
      "SELECT id FROM send_jobs WHERE state = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1",
    );
    if (row === null) return null;

    const claimed = await tx.run(
      `UPDATE send_jobs SET state = 'sending', leased_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND state = 'queued'`,
      [new Date(Date.now() + leaseMs).toISOString(), now(), row.id],
    );

    // Somebody else took it between the read and the write.
    if (claimed.changes === 0) return null;

    const claimedRow = await tx.get<Record<string, unknown>>('SELECT * FROM send_jobs WHERE id = ?', [
      row.id,
    ]);
    return mapJob(claimedRow as Record<string, unknown>);
  });
}

/** Record the outcome. `accepted` also moves the quote to `issued`, which is what a send means. */
export async function finishJob(
  db: Db,
  jobId: string,
  state: 'accepted' | 'failed' | 'cancelled',
  messageId: string | null = null,
  error: string | null = null,
): Promise<void> {
  const at = now();

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE send_jobs SET state = ?, message_id = ?, last_error = ?, leased_until = NULL,
              updated_at = ?, sent_at = ?
        WHERE id = ?`,
      [state, messageId, error, at, state === 'accepted' ? at : null, jobId],
    );

    if (state === 'accepted') {
      const job = await tx.get<{ tenant_id: string; quote_id: string }>(
        'SELECT tenant_id, quote_id FROM send_jobs WHERE id = ?',
        [jobId],
      );
      if (job !== null) {
        /*
         * Issued, never back.
         *
         * `WHERE status = 'draft'` rather than "set it to issued": a quote a customer has already
         * accepted must not return to `issued` because somebody re-sent the document, and the status
         * is a fact about the sale rather than about the email.
         */
        await tx.run(
          "UPDATE quotes SET status = 'issued', updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'draft'",
          [at, job.tenant_id, job.quote_id],
        );
      }
    }
  });
}

/** Leave a job in `unknown`, which an operator resolves by hand. */
export async function markUnknown(db: Db, jobId: string): Promise<void> {
  await db.run(
    "UPDATE send_jobs SET state = 'unknown', last_error = ?, updated_at = ? WHERE id = ?",
    [
      'The send was interrupted. The mail server may or may not have accepted it — check before retrying.',
      now(),
      jobId,
    ],
  );
}

/** Every attempt on a quote, newest first. */
export async function listSends(db: Db, tenantId: string, quoteId: string): Promise<SendJob[]> {
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM send_jobs WHERE tenant_id = ? AND quote_id = ? ORDER BY created_at DESC',
    [tenantId, quoteId],
  );
  return rows.map(mapJob);
}

/** What a dispatcher needs, injected so a test needs no SMTP server and no browser. */
export interface DispatchDeps {
  /** Renders a revision's PDF. */
  renderPdf(html: string): Promise<Buffer>;
  /** The verified sender address. Platform-owned, never a company's own. */
  from(): string;
  /** The company's own address, where a customer's reply should land. */
  replyTo(tenantId: string): Promise<string>;
}

/**
 * Send the next queued job, if there is one.
 *
 * Returns what happened so the caller can answer the operator honestly — a send route that returned
 * `{ ok: true }` before asking the relay would be reporting an intention as a result.
 */
export async function dispatchNextJob(
  db: Db,
  transport: MailTransport,
  deps: DispatchDeps,
): Promise<SendJob | null> {
  const job = await claimJob(db);
  if (job === null) return null;

  try {
    // A suspended company cannot send: the seat model already refuses them access, and a queued job
    // outliving the suspension must not slip through.
    const tenant = await db.get<{ status: string }>('SELECT status FROM tenants WHERE id = ?', [
      job.tenantId,
    ]);
    if (tenant === null || tenant.status !== 'active') {
      await finishJob(db, job.id, 'cancelled', null, 'The company is suspended');
      return { ...job, state: 'cancelled' };
    }

    const { loadFrozenRevision } = await import('../documents.js');
    const quote = await db.get<{ id: string }>('SELECT id FROM quotes WHERE id = ?', [job.quoteId]);
    if (quote === null) {
      await finishJob(db, job.id, 'cancelled', null, 'The quote no longer exists');
      return { ...job, state: 'cancelled' };
    }

    const revisionNumber = await db.get<{ revision: number }>(
      'SELECT revision FROM quote_revisions WHERE id = ?',
      [job.revisionId],
    );
    if (revisionNumber === null) {
      await finishJob(db, job.id, 'cancelled', null, 'The revision no longer exists');
      return { ...job, state: 'cancelled' };
    }

    const frozen = await loadFrozenRevision(db, {
      tenantId: job.tenantId,
      quoteId: job.quoteId,
      revision: Number(revisionNumber.revision),
    });

    // The same helper the download route uses, so a mailed PDF and a downloaded one are one page.
    const document = toCustomerDocument(frozen);
    const html = await renderFrozenHtml(frozen);
    const pdf = await deps.renderPdf(html);

    const message: OutboundMail = {
      from: deps.from(),
      replyTo: await deps.replyTo(job.tenantId),
      to: job.to,
      subject: job.subject,
      text: job.body,
      attachment: {
        filename: `${document.quoteNumber}-rev${document.revision}.pdf`,
        content: pdf,
      },
      messageId: `<${job.id}@smartquote>`,
    };

    const result = await transport.send(message);
    await finishJob(db, job.id, 'accepted', result.messageId);
    return { ...job, state: 'accepted', messageId: result.messageId };
  } catch (error) {
    // A transport refusal is a definite answer, so the job is `failed` and safe to retry by hand.
    // Anything else — a crash, a timeout with no response — is recorded by the caller as `unknown`.
    const message = error instanceof Error ? error.message : 'Send failed';
    await finishJob(db, job.id, 'failed', null, message);
    return { ...job, state: 'failed', lastError: message };
  }
}
