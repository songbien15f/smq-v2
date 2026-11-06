/**
 * The enquiry notification: one copy to whoever answers it, one to the platform admins.
 *
 * ## Why this file exists as a separate unit
 *
 * The route has a row to write, a rate limiter to consume and a bot to ignore; adding "and now build
 * two emails, decide who receives them, and survive a relay that is down" to that would make the one
 * part that must never fail — the insert — hard to read. The decisions about *who gets a copy* are
 * pure arithmetic over a list of addresses, so they are testable without a database or a relay.
 *
 * ## Why `Reply-To` is the enquirer and not the platform
 *
 * The person who receives the notification wants to answer the enquiry. If `Reply-To` were the
 * platform address, "Reply" would land in the platform's own inbox and the customer's address would
 * be something to copy out of the body by hand. It is the one field where the enquirer's address
 * belongs in the envelope.
 *
 * ## Why the enquirer gets no copy
 *
 * A courtesy acknowledgement ("we have your enquiry") is a separate decision: it commits the company
 * to responding, and this product cannot know whether anybody will. Silence is what the form promises
 * — `received: true`, nothing else — and sending mail the operator did not ask for is the kind of
 * thing that makes an address get marked as spam.
 */

import type { OutboundMail } from './transport.js';
import type { TransactionalDeps } from './transactional.js';

/** One stored enquiry, as the notification needs it. */
export interface EnquiryRecord {
  name: string;
  email: string;
  phone: string | null;
  message: string;
  /** Where the form was: `contact`, `share` or `demo`. */
  source: string;
  createdAt: string;
}

/** Where the form was, as a sentence. A raw `demo` in an inbox means nothing. */
const SOURCE_LABEL: Record<string, string> = {
  contact: 'the contact form',
  share: 'a shared quote',
  demo: 'a demo request',
};

/**
 * Who receives a copy, in the order they appear in the result.
 *
 * **Deduplicated by address, case-insensitively.** `ENQUIRY_TO` is often the same mailbox as a
 * platform administrator's — an operator setting this up on a small install types their own address
 * twice — and two identical messages are how a notification becomes noise people filter away.
 *
 * Empty entries are dropped rather than sending to `''`, which the relay would refuse for every
 * recipient in the batch.
 */
export function enquiryRecipients(input: {
  /** `ENQUIRY_TO`, possibly a comma-separated list, possibly empty. */
  enquiryTo: string;
  /** Every platform administrator's address. */
  adminEmails: readonly string[];
}): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];

  const add = (raw: string): void => {
    const address = raw.trim();
    if (address === '') return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    recipients.push(address);
  };

  for (const part of input.enquiryTo.split(',')) add(part);
  for (const email of input.adminEmails) add(email);
  return recipients;
}

/**
 * The message one recipient receives.
 *
 * Plain text, like every other mail this product sends: it has no images to lay out, and a
 * multipart body would be two more places for the content to disagree with itself.
 *
 * The enquirer's own details are in the body as well as in `Reply-To`, because the recipient may
 * forward it to a colleague — and a forwarded message loses the envelope.
 */
export function enquiryMail(deps: TransactionalDeps, to: string, enquiry: EnquiryRecord): OutboundMail {
  const from = deps.from.trim();
  if (from === '') {
    throw new Error('Mail is not configured: there is no From address to send as.');
  }

  const where = SOURCE_LABEL[enquiry.source] ?? enquiry.source;
  const phone = enquiry.phone === null || enquiry.phone.trim() === '' ? '(not given)' : enquiry.phone;

  const text =
    `A new enquiry arrived from ${where}.\n\n` +
    `Name:  ${enquiry.name}\n` +
    `Email: ${enquiry.email}\n` +
    `Phone: ${phone}\n\n` +
    `--- their message ---\n\n` +
    `${enquiry.message}\n\n` +
    `---------------------\n\n` +
    `Reply to this message to answer them directly. The enquiry is also in the admin queue ` +
    `under Enquiries, where it can be marked handled.\n`;

  return {
    from,
    // The enquirer, so a reply reaches them instead of the platform's own inbox.
    replyTo: enquiry.email,
    to,
    subject: `Enquiry from ${enquiry.name} — ${where}`,
    text,
    messageId: `enquiry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

/**
 * Send the notification, swallowing every failure.
 *
 * **This must never throw.** The enquiry is already in the database by the time it is called, and a
 * person filling in a contact form can do nothing about a relay refusing mail. Turning that into a
 * 500 would tell them their enquiry was not received when it was — the worst of both answers.
 *
 * The failure is reported to the caller rather than logged here, so a test can observe it and the
 * route can decide what to write.
 *
 * ## Why there is a deadline
 *
 * SMTP timeouts in this codebase are measured in tens of seconds. A relay that accepts a connection
 * and then stalls would hold the request open until the browser gave up, and the enquiry would appear
 * to have failed. The budget is small on purpose: this is a notification, and a late one is worth
 * less than a fast form.
 */
/**
 * How long one notification batch may take before it is abandoned.
 *
 * **Measured, not guessed.** A real send through SMTP2GO from this machine takes ~6.5 s — the relay
 * accepts the connection, then takes its time per message — and a first draft of this file used a
 * 4 s budget, which meant every real notification was abandoned while the relay was still working.
 * The number here is deliberately generous; it exists to stop a *stalled* relay holding a socket
 * forever, not to bound a healthy one.
 *
 * It no longer costs the caller anything: the route answers before this runs. See
 * `trackEnquiryNotification`.
 */
export const ENQUIRY_MAIL_BUDGET_MS = 30_000;

export interface EnquirySendOutcome {
  sent: string[];
  failed: string[];
  skipped: string;
}

export async function sendEnquiryNotifications(
  deps: TransactionalDeps | null,
  enquiry: EnquiryRecord,
  options: {
    enquiryTo: string;
    adminEmails: readonly string[];
    budgetMs?: number;
    /** Called once per recipient with the outcome, so a caller can log what happened. */
    onResult?: (result: { to: string; ok: boolean; reason?: string }) => void;
  } = {
    enquiryTo: '',
    adminEmails: [],
  },
): Promise<EnquirySendOutcome> {
  if (deps === null) {
    return { sent: [], failed: [], skipped: 'mail is not configured on this server' };
  }

  const recipients = enquiryRecipients({
    enquiryTo: options.enquiryTo,
    adminEmails: options.adminEmails,
  });
  if (recipients.length === 0) {
    return { sent: [], failed: [], skipped: 'no ENQUIRY_TO and no platform administrator' };
  }

  const budget = options.budgetMs ?? ENQUIRY_MAIL_BUDGET_MS;
  const sent: string[] = [];
  const failed: string[] = [];

  /*
   * One message per recipient, sent concurrently under a single deadline for the whole batch.
   * Sequential sends would multiply the wait by the number of administrators; no deadline at all is
   * the stall this function exists to prevent.
   */
  await Promise.all(
    recipients.map(async (to) => {
      try {
        const message = enquiryMail(deps, to, enquiry);
        await Promise.race([
          deps.transport.send(message),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('the mail budget ran out')), budget);
            // A pending timer would keep the process alive after the test that started it.
            if (typeof timer === 'object' && 'unref' in timer) timer.unref();
          }),
        ]);
        sent.push(to);
        options.onResult?.({ to, ok: true });
      } catch (error) {
        failed.push(to);
        options.onResult?.({
          to,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return { sent, failed, skipped: '' };
}

/**
 * The notifications currently being sent, so nothing loses track of them.
 *
 * ## Why the route does not await the send
 *
 * It did, with a 4 s cap, and a live measurement showed the relay needs ~6.5 s — so **every**
 * notification was abandoned and nobody received an enquiry while the form still said "received".
 * Awaiting without a cap is no better: a person filling in a contact form would watch a spinner for
 * seven seconds, on a page that has already done its job.
 *
 * So the request answers first and the send continues. The row is already written, which is what
 * makes this safe: the notification is a copy of a recorded lead, never the record itself. Keeping
 * the promises in a set is what makes it *observable* — a test can wait for them and a shutdown can
 * refuse to drop them — instead of a `void`ed promise nobody can see.
 */
const inFlight = new Set<Promise<unknown>>();

/** Start a notification and remember it. Never throws: the promise is already wrapped inside. */
export function trackEnquiryNotification(promise: Promise<unknown>): void {
  inFlight.add(promise);
  void promise.finally(() => inFlight.delete(promise)).catch(() => {});
}

/**
 * Wait for every notification in flight.
 *
 * Used by the test suite to assert that mail was built, and by the server's shutdown path so a
 * restart during a burst of enquiries does not silently drop the last few. It re-checks the set
 * because one batch may start another while it waits.
 */
export async function settleEnquiryNotifications(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
