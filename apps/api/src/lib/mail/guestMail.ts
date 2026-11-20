/**
 * Mail for a Guest quote request (plan G-a P13): a confirmation to the guest and a notification
 * to whoever answers leads.
 *
 * ## No prices, in either message
 *
 * A guest never sees a price (D-T3 / G2), and the notification is plain-text mail that can be
 * forwarded anywhere. Nothing here reads a price book or a cent value; the message describes the
 * shed, not what it costs.
 *
 * ## Why a failure here never reaches the guest
 *
 * The request row is the lead and is already stored when this runs. Like the enquiry mail
 * (`enquiryMail.ts`) the send is started, not awaited, every failure is swallowed, and the promise
 * is tracked with `trackEnquiryNotification` so shutdown and tests can wait for it.
 *
 * ## Who is notified
 *
 * `GUEST_NOTIFY_TO` (comma-separated) when it is set; otherwise the enquiry recipients —
 * `ENQUIRY_TO` plus every active platform administrator — so a fresh install still hears about a
 * lead without a new setting.
 */

import type { GuestBuildingTypeSpec, GuestSiteEstimate, GuestReviewFlag } from '@sq/core/domain';
import { guestLengthMm } from '@sq/core/domain';
import type { GuestRequestBody } from '@sq/contracts';
import type { OutboundMail } from './transport.js';
import type { TransactionalDeps } from './transactional.js';
import { ENQUIRY_MAIL_BUDGET_MS, enquiryRecipients } from './enquiryMail.js';

export interface GuestRequestRecord {
  number: string;
  body: GuestRequestBody;
  type: GuestBuildingTypeSpec;
  /** E.164, already normalised. */
  mobile: string;
  /** True when the contact's email has been confirmed before (a returning, verified guest). */
  emailVerified: boolean;
  /**
   * The server's own estimate, or `null` for an enquiry (Class 1 House) and for an address that
   * could not be placed. **Only the internal notification reports it** — the guest's copy never
   * carries an unconfirmed wind region (plan §3.3 step 5).
   */
  estimate?: GuestSiteEstimate | null;
  /** Places inside the page's limits that the book does not state. Internal mail only. */
  reviewFlags?: readonly GuestReviewFlag[];
  /**
   * What the guest and the assistant said to each other, when they used it. **Internal mail only** —
   * the guest's own copy does not repeat their conversation back at them. Already redacted.
   */
  transcript?: readonly { role: 'guest' | 'assistant'; text: string }[];
}

/**
 * A newline, named.
 *
 * Several blocks in this file are multi-line plain text, and an escaped newline inside a template
 * literal is easy to lose in a refactor while still type-checking. `join(NL)` says what it means.
 */
const NL = String.fromCharCode(10);

const OPENING_LABEL: Record<string, string> = {
  roller_door: 'Roller door',
  pa_door: 'Personal access door',
  sliding_door: 'Sliding door',
  window: 'Window',
};

const ROOF_LABEL: Record<string, string> = { gable: 'Gable', skillion: 'Skillion' };

const SLAB_LABEL: Record<string, string> = {
  in_slab: 'In Slab',
  on_slab: 'On Slab',
  footing_only: 'Footing Only',
};

const KNEE_LABEL: Record<string, string> = {
  standard: 'Knee Brace',
  none_if_possible: 'No Knee Brace – If Possible',
};

const CLADDING_LABEL: Record<string, string> = { vertical: 'Vertical', horizontal: 'Horizontal' };

/** `9000` → `9 m`, `2950` → `2.95 m`. */
function metres(mm: number): string {
  return `${Number((mm / 1000).toFixed(3))} m`;
}

/** The shed in words — the same block in both messages. */
function describeDesign(record: GuestRequestRecord): string {
  const { design } = record.body;
  const { building } = design;
  const bays = building.bayWidths.map((w) => metres(w)).join(' + ');
  const lines = [
    `Building:  ${record.type.name}`,
    `Size:      ${metres(building.span)} wide × ${metres(guestLengthMm(building))} long × ${metres(building.height)} high`,
    `Bays:      ${building.bayWidths.length} × (${bays})`,
    `Roof:      ${ROOF_LABEL[building.roof] ?? building.roof}, ${building.pitchDeg}°`,
    `Slab:      ${SLAB_LABEL[building.slab] ?? building.slab}`,
    `Bracing:   ${KNEE_LABEL[building.kneeBrace] ?? building.kneeBrace}`,
    `Cladding:  ${CLADDING_LABEL[building.cladding] ?? building.cladding}`,
    `Site:      ${[design.site.street, design.site.suburb, design.site.state, design.site.postcode]
      .filter((part) => part !== undefined && part !== '')
      .join(', ')}`,
    `Walls:     ${design.colours.walls}`,
    `Roof:      ${design.colours.roof}`,
    `Trim:      barge ${design.colours.trim.barge}, gutter ${design.colours.trim.gutter}, downpipe ${design.colours.trim.downpipe}`,
  ];
  if (design.openings.length === 0) {
    lines.push('Openings:  none');
  } else {
    lines.push('Openings:');
    for (const o of design.openings) {
      const motor = o.type === 'roller_door' && o.motorised === true ? ', motorised' : '';
      lines.push(
        `  - ${OPENING_LABEL[o.type] ?? o.type}, ${metres(o.size.width)} × ${metres(o.size.height)}, ${o.wall} wall${motor}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * The estimator's extra block: the estimate the page showed and the places the price book does not
 * state. Internal mail only — the guest's copy never says "Region B" before a person has confirmed it.
 */
function describeReview(record: GuestRequestRecord): string {
  const lines: string[] = [];
  const estimate = record.estimate ?? null;
  if (estimate !== null) {
    const enclosure = estimate.enclosure === 'roof_only' ? 'Roof Only' : 'Enclosed';
    lines.push(
      `Estimate:  ${estimate.region === null ? 'wind region not placed' : `Region ${estimate.region}`} · ` +
        `${estimate.buildingClass} ${enclosure} · Importance Level ${estimate.importanceLevel}`,
    );
  }
  const flags = record.reviewFlags ?? [];
  if (flags.length > 0) {
    const what = flags.map((f) => (f === 'pitch' ? 'roof pitch below the book' : f === 'bay' ? 'bay wider than the book' : 'span above the book'));
    lines.push(`Check:     ${what.join('; ')}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function requireFrom(deps: TransactionalDeps): string {
  const from = deps.from.trim();
  if (from === '') throw new Error('Mail is not configured: there is no From address to send as.');
  return from;
}

function messageId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The guest's copy: their number, their design, what happens next. */
export function guestConfirmationMail(deps: TransactionalDeps, record: GuestRequestRecord): OutboundMail {
  const from = requireFrom(deps);
  const { contact } = record.body;
  const text =
    `Hi ${contact.firstName},\n\n` +
    `Thanks for designing your shed with us. Your request number is ${record.number}.\n\n` +
    `${describeDesign(record)}\n\n` +
    `What happens next: a shed specialist reviews your design and contacts you with a quote, ` +
    `usually within one business day. Please quote ${record.number} if you get in touch.\n\n` +
    `If you did not send this request, you can ignore this message.\n`;
  return {
    from,
    replyTo: from,
    to: contact.email,
    subject: `Your shed request ${record.number}`,
    text,
    messageId: messageId('guest-confirm'),
  };
}

/** The notification to whoever answers leads. Reply-To is the guest, so a reply reaches them. */
export function guestNotificationMail(
  deps: TransactionalDeps,
  to: string,
  record: GuestRequestRecord,
): OutboundMail {
  const from = requireFrom(deps);
  const { contact } = record.body;
  const verified = record.emailVerified ? 'confirmed' : 'not yet confirmed';
  const text =
    `A new shed request ${record.number} arrived from the Guest quote page.\n\n` +
    `Name:   ${contact.firstName} ${contact.lastName}\n` +
    `Email:  ${contact.email} (${verified})\n` +
    `Mobile: ${record.mobile}\n\n` +
    `${describeDesign(record)}\n\n` +
    describeReview(record) +
    describeTranscript(record) +
    (additionalRequestOf(record) !== null
      ? `--- their request ---\n\n${additionalRequestOf(record)!.trim()}\n\n--------------------\n\n`
      : '') +
    `Reply to this message to answer them directly.\n`;
  return {
    from,
    replyTo: contact.email,
    to,
    subject: `Shed request ${record.number} — ${contact.firstName} ${contact.lastName}, ${record.body.design.site.suburb}`,
    text,
    messageId: messageId('guest-notify'),
  };
}

/**
 * The assistant conversation, for the estimator.
 *
 * Plain text, capped: a long chat is not more useful than its last few turns, and a mail that runs to
 * several screens gets skimmed. The lead row keeps the whole thing for whoever opens it properly.
 */
function describeTranscript(record: GuestRequestRecord): string {
  const turns = record.transcript ?? [];
  if (turns.length === 0) return '';
  const shown = turns.slice(-10);
  const lines = shown.map((turn) => `  ${turn.role === 'guest' ? 'Guest' : 'Assistant'}: ${turn.text.replace(/\s+/g, ' ')}`);
  const omitted = turns.length - shown.length;
  const header =
    `--- conversation with the assistant${omitted > 0 ? ` (last ${shown.length} of ${turns.length})` : ''} ---`;
  const rule = '-'.repeat(24);
  return [header, '', ...lines, '', rule, '', ''].join(NL);
}

/** The free-text request under either of its names (see `routes/guest.ts`). */
function additionalRequestOf(record: GuestRequestRecord): string | null {
  const text = (record.body.additionalRequest ?? record.body.notes ?? '').trim();
  return text === '' ? null : text;
}

/** `GUEST_NOTIFY_TO` when set, else `ENQUIRY_TO` plus the platform administrators. Deduplicated. */
export function guestNotifyRecipients(input: {
  guestNotifyTo: string;
  enquiryTo: string;
  adminEmails: readonly string[];
}): string[] {
  const own = enquiryRecipients({ enquiryTo: input.guestNotifyTo, adminEmails: [] });
  if (own.length > 0) return own;
  return enquiryRecipients({ enquiryTo: input.enquiryTo, adminEmails: input.adminEmails });
}

export interface GuestSendResult {
  to: string;
  kind: 'confirmation' | 'notification';
  ok: boolean;
  reason?: string;
}

/** Sends both messages; never throws. Each send has the enquiry mail's 30 s budget. */
export async function sendGuestRequestMail(
  deps: TransactionalDeps,
  record: GuestRequestRecord,
  recipients: readonly string[],
  onResult?: (result: GuestSendResult) => void,
  budgetMs: number = ENQUIRY_MAIL_BUDGET_MS,
): Promise<void> {
  const jobs: { kind: GuestSendResult['kind']; to: string; build: () => OutboundMail }[] = [
    { kind: 'confirmation', to: record.body.contact.email, build: () => guestConfirmationMail(deps, record) },
    ...recipients.map((to) => ({
      kind: 'notification' as const,
      to,
      build: () => guestNotificationMail(deps, to, record),
    })),
  ];

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const message = job.build();
        await Promise.race([
          deps.transport.send(message),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('the mail budget ran out')), budgetMs);
            if (typeof timer === 'object' && 'unref' in timer) timer.unref();
          }),
        ]);
        onResult?.({ to: job.to, kind: job.kind, ok: true });
      } catch (error) {
        onResult?.({
          to: job.to,
          kind: job.kind,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}
