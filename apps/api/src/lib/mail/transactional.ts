/**
 * Mail that is not a quote: a reset link and an invitation.
 *
 * ## Why this is not the quote queue
 *
 * `send_jobs` has `quote_id` and `revision_id` as `NOT NULL`, because a queued quote send exists to
 * prove *which revision* a customer was given. A reset link has no revision, so it cannot use that
 * table, and loosening the table to allow nulls would make every existing query responsible for a
 * case it was not written for.
 *
 * Sending **inline** is the honest choice here, not a shortcut: the volume is "somebody forgot a
 * password", and a failure must be visible to the person standing at the form. A queued job would
 * let the request answer "sent" while the relay was refusing every message.
 *
 * ## Which address and which name
 *
 * `from` is the platform's, never a tenant's: a company does not own a reset, and sending as an
 * address the relay has not verified is how a mail domain gets blacklisted. `replyTo` is the same
 * platform address, for the same reason.
 *
 * ## Why the body names the company code and the username
 *
 * The sign-in key became a company code plus a username, and a person who has forgotten one has
 * often forgotten the other. Telling them here is not a leak: receiving the message is what proves
 * they control the mailbox it was sent to.
 */

import { randomUUID } from 'node:crypto';
import type { MailTransport, OutboundMail } from './transport.js';

/** Everything needed to send one transactional message. */
export interface TransactionalDeps {
  transport: MailTransport;
  /** The platform's verified From address. Empty means the server is not configured. */
  from: string;
  /** Where the client app answers, so a link points somewhere a person can reach. */
  publicOrigin: string;
}

/** Raised when a message cannot be built because the server has no sender. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('Mail is not configured: there is no From address to send as.');
    this.name = 'MailNotConfiguredError';
  }
}

/** Trim the trailing slash so a link never contains `//`. */
function origin(deps: TransactionalDeps): string {
  return deps.publicOrigin.replace(/\/+$/, '');
}

/** Build the envelope, refusing to produce one with no sender. */
function envelope(deps: TransactionalDeps, fields: Omit<OutboundMail, 'from' | 'replyTo' | 'messageId'>): OutboundMail {
  const from = deps.from.trim();
  if (from === '') throw new MailNotConfiguredError();
  return { ...fields, from, replyTo: from, messageId: `${fields.subject.slice(0, 12)}-${Date.now()}-${randomUUID()}` };
}

/** The link to choose a new password. The token rides in the fragment, as a share link does. */
export function resetLink(publicOrigin: string, token: string): string {
  return `${publicOrigin.replace(/\/+$/, '')}/reset#token=${token}`;
}

/** The link to accept an invitation. */
export function joinLink(publicOrigin: string, token: string): string {
  return `${publicOrigin.replace(/\/+$/, '')}/join#token=${token}`;
}

export async function sendResetMail(
  deps: TransactionalDeps,
  input: { to: string; companyName: string; companyCode: string; username: string; token: string },
): Promise<void> {
  const link = resetLink(origin(deps), input.token);
  const text =
    `Hello,\n\n` +
    `Somebody asked to choose a new password for your ${input.companyName} account.\n\n` +
    `Choose one here, within the hour:\n${link}\n\n` +
    `You will need these at sign-in:\n` +
    `  Company code: ${input.companyCode}\n` +
    `  Username:     ${input.username}\n\n` +
    `If you did not ask for this, ignore this message. Your password has not changed and the link ` +
    `expires on its own.\n`;

  await deps.transport.send(
    envelope(deps, {
      to: input.to,
      subject: `Choose a new password — ${input.companyName}`,
      text,
    }),
  );
}

export async function sendInviteMail(
  deps: TransactionalDeps,
  input: {
    to: string;
    companyName: string;
    companyCode: string;
    username: string;
    role: string;
    token: string;
  },
): Promise<void> {
  const link = joinLink(origin(deps), input.token);
  const text =
    `Hello,\n\n` +
    `${input.companyName} has added you to their SmartQuote workspace as ${input.role}.\n\n` +
    `Choose a password to start, within seven days:\n${link}\n\n` +
    `You will need these at sign-in:\n` +
    `  Company code: ${input.companyCode}\n` +
    `  Username:     ${input.username}\n\n` +
    `If you were not expecting this, ignore this message and nothing will change.\n`;

  await deps.transport.send(
    envelope(deps, {
      to: input.to,
      subject: `You have been added to ${input.companyName}`,
      text,
    }),
  );
}
