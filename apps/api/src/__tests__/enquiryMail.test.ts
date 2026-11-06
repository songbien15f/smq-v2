import { describe, it, expect } from 'vitest';
import {
  enquiryMail,
  enquiryRecipients,
  sendEnquiryNotifications,
  ENQUIRY_MAIL_BUDGET_MS,
} from '../lib/mail/enquiryMail';
import type { OutboundMail } from '../lib/mail/transport';
import type { TransactionalDeps } from '../lib/mail/transactional';

/**
 * The enquiry notification.
 *
 * The route-level behaviour — that the row is written and the request still answers 201 when the
 * relay refuses — is in `enquiries.test.ts`, because that is a fact about the HTTP request. This file
 * is about the message: who receives one, what it says, and what happens when sending goes wrong.
 */

const deps: TransactionalDeps = {
  transport: { async send() { throw new Error('not used here'); } },
  from: 'no_reply@platform.test',
  publicOrigin: 'http://localhost:3061',
};

const enquiry = {
  name: 'Jo Citizen',
  email: 'jo@customer.test',
  phone: '0400 000 000',
  message: 'I would like a 12 by 24 metre workshop with one roller door.',
  source: 'contact',
  createdAt: '2026-11-06T00:00:00Z',
};

describe('enquiryRecipients', () => {
  it('lists ENQUIRY_TO first, then every administrator', () => {
    expect(
      enquiryRecipients({ enquiryTo: 'sales@sheds.test', adminEmails: ['ops@sheds.test', 'owner@sheds.test'] }),
    ).toEqual(['sales@sheds.test', 'ops@sheds.test', 'owner@sheds.test']);
  });

  it('sends one copy when ENQUIRY_TO is also an administrator', () => {
    // The common small-installation setup, and two identical messages is how people start filtering
    // the notification away. Case is not a distinguishing feature of an address.
    expect(
      enquiryRecipients({ enquiryTo: 'Ops@Sheds.test', adminEmails: ['ops@sheds.test'] }),
    ).toEqual(['Ops@Sheds.test']);
  });

  it('accepts a comma-separated ENQUIRY_TO and drops empty entries', () => {
    expect(
      enquiryRecipients({ enquiryTo: ' a@sheds.test , , b@sheds.test,', adminEmails: [] }),
    ).toEqual(['a@sheds.test', 'b@sheds.test']);
  });

  it('has nobody to write to when nothing is configured', () => {
    expect(enquiryRecipients({ enquiryTo: '', adminEmails: [] })).toEqual([]);
  });
});

describe('enquiryMail', () => {
  it('replies to the enquirer, not to the platform', () => {
    // The one place an enquirer's address belongs in the envelope: "Reply" must reach them.
    const message = enquiryMail(deps, 'sales@sheds.test', enquiry);
    expect(message.to).toBe('sales@sheds.test');
    expect(message.replyTo).toBe('jo@customer.test');
    expect(message.from).toBe('no_reply@platform.test');
  });

  it('carries the details in the body too, because a forwarded message loses the envelope', () => {
    const message = enquiryMail(deps, 'sales@sheds.test', enquiry);
    expect(message.text).toContain('Jo Citizen');
    expect(message.text).toContain('jo@customer.test');
    expect(message.text).toContain('0400 000 000');
    expect(message.text).toContain('one roller door');
    expect(message.subject).toContain('Jo Citizen');
  });

  it('says where the form was in words rather than as a code', () => {
    expect(enquiryMail(deps, 'a@b.test', { ...enquiry, source: 'demo' }).text).toContain('a demo request');
    expect(enquiryMail(deps, 'a@b.test', { ...enquiry, source: 'share' }).text).toContain('a shared quote');
    // An unknown source still says something rather than vanishing.
    expect(enquiryMail(deps, 'a@b.test', { ...enquiry, source: 'partner' }).text).toContain('partner');
  });

  it('says a phone number was not given rather than printing null', () => {
    const message = enquiryMail(deps, 'a@b.test', { ...enquiry, phone: null });
    expect(message.text).toContain('(not given)');
    expect(message.text).not.toContain('null');
  });
});

describe('sendEnquiryNotifications', () => {
  /** A transport that records what it was asked to send. */
  function recorder(): { deps: TransactionalDeps; sent: OutboundMail[] } {
    const sent: OutboundMail[] = [];
    return {
      sent,
      deps: {
        ...deps,
        transport: {
          async send(message) {
            sent.push(message);
            return { messageId: message.messageId };
          },
        },
      },
    };
  }

  it('writes one message to each recipient', async () => {
    const { deps: recording, sent } = recorder();
    const result = await sendEnquiryNotifications(recording, enquiry, {
      enquiryTo: 'sales@sheds.test',
      adminEmails: ['ops@sheds.test'],
    });

    expect(result.sent.sort()).toEqual(['ops@sheds.test', 'sales@sheds.test']);
    expect(result.failed).toEqual([]);
    expect(sent).toHaveLength(2);
    // Every copy still replies to the customer.
    for (const message of sent) expect(message.replyTo).toBe('jo@customer.test');
  });

  it('sends nothing, and reports why, when the server has no mail', async () => {
    const result = await sendEnquiryNotifications(null, enquiry, {
      enquiryTo: 'sales@sheds.test',
      adminEmails: [],
    });
    expect(result.sent).toEqual([]);
    expect(result.skipped).toMatch(/not configured/i);
  });

  it('sends nothing when there is nobody to write to', async () => {
    const { deps: recording, sent } = recorder();
    const result = await sendEnquiryNotifications(recording, enquiry, { enquiryTo: '', adminEmails: [] });
    expect(sent).toHaveLength(0);
    expect(result.skipped).toMatch(/no ENQUIRY_TO/i);
  });

  it('reports a refused recipient without throwing, and still sends the others', async () => {
    /*
     * A relay that refuses one address must not cost the other recipients their copy — the
     * administrator and the sales inbox are different mailboxes with different problems.
     */
    const sent: OutboundMail[] = [];
    const picky: TransactionalDeps = {
      ...deps,
      transport: {
        async send(message) {
          if (message.to === 'broken@sheds.test') throw new Error('550 mailbox unavailable');
          sent.push(message);
          return { messageId: message.messageId };
        },
      },
    };

    const result = await sendEnquiryNotifications(picky, enquiry, {
      enquiryTo: 'broken@sheds.test',
      adminEmails: ['ops@sheds.test'],
    });

    expect(result.failed).toEqual(['broken@sheds.test']);
    expect(result.sent).toEqual(['ops@sheds.test']);
    expect(sent).toHaveLength(1);
  });

  it('gives up on a stalled relay instead of holding the request open', async () => {
    /*
     * The behaviour that keeps a contact form fast. Without the deadline a relay that accepts the
     * connection and never answers holds the request until the browser gives up, and the person
     * concludes their enquiry failed — when the row is already written.
     */
    const stalled: TransactionalDeps = {
      ...deps,
      transport: { send: () => new Promise<never>(() => {}) },
    };

    const started = Date.now();
    const result = await sendEnquiryNotifications(stalled, enquiry, {
      enquiryTo: 'sales@sheds.test',
      adminEmails: [],
      budgetMs: 50,
    });
    const elapsed = Date.now() - started;

    expect(result.failed).toEqual(['sales@sheds.test']);
    // The budget is honoured, with headroom for a loaded machine rather than a tight bound.
    expect(elapsed).toBeLessThan(ENQUIRY_MAIL_BUDGET_MS);
  });
});
