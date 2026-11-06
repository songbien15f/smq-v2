import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, seedCompany, seedPlatformAdmin, testConfig, type TestApp } from './helpers';
import type { OutboundMail } from '../lib/mail/transport';
import type { TransactionalDeps } from '../lib/mail/transactional';
import { sendEnquiryNotifications, settleEnquiryNotifications } from '../lib/mail/enquiryMail';

/**
 * The public enquiry form, and the notification it sends.
 *
 * ## What this file is defending
 *
 * An enquiry is a **lead**: the one thing this product must never lose. So the assertions are all
 * about the insert surviving things that could otherwise take it down — a relay that refuses, a
 * relay that stalls, no mail configured at all — and about the notification never becoming a way to
 * send mail for free.
 *
 * ## Why every test that checks mail calls `settleEnquiryNotifications()`
 *
 * The route answers **before** the notification finishes, on purpose: a measurement of the real relay
 * showed a send takes ~6.5 s, and a contact form that spins for seven seconds has failed the person
 * filling it in. The promise is tracked rather than dropped, so this helper is how a test observes
 * what was actually sent — and it is the same helper the server's shutdown uses.
 */
afterEach(async () => {
  /*
   * Drain between tests, so a notification started by one test cannot appear in the next one's
   * recorder and make an assertion about "no mail" pass or fail at random.
   */
  await settleEnquiryNotifications();
});

/** A test app whose transport records, plus the deps the route needs. */
async function appWithMail(): Promise<{ ctx: TestApp; sent: OutboundMail[] }> {
  const sent: OutboundMail[] = [];
  const mail: TransactionalDeps = {
    transport: {
      async send(message) {
        sent.push(message);
        return { messageId: message.messageId };
      },
    },
    from: 'no_reply@platform.test',
    publicOrigin: 'http://localhost:3061',
  };
  const ctx = await makeTestApp(testConfig(), mail);
  return { ctx, sent };
}

/** A valid enquiry, as the site's form posts it. */
function form(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Jo Citizen',
    email: 'jo@customer.test',
    phone: '0400 000 000',
    message: 'A 12 by 24 metre workshop with one roller door, please.',
    source: 'contact',
    ...overrides,
  };
}

describe('the enquiry form', () => {
  it('stores the enquiry and answers a fixed acknowledgement, never the row', async () => {
    const { ctx } = await appWithMail();

    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ received: true });

    const stored = await ctx.db.get<{ name: string; email: string }>(
      'SELECT name, email FROM enquiries',
    );
    expect(stored?.name).toBe('Jo Citizen');
    await ctx.close();
  });

  it('sends one copy to ENQUIRY_TO and one to every platform administrator', async () => {
    const { ctx, sent } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Enquiry Sheds',
      slug: 'enquiry-sheds',
      code: 'ENQSHD',
      email: 'owner@enquiry.test',
      password: 'a-long-enough-password',
    });
    await seedPlatformAdmin(ctx.db, { email: 'ops@platform.test', password: 'a-long-enough-password' });

    process.env.ENQUIRY_TO = 'sales@sheds.test';
    try {
      const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
      expect(response.statusCode).toBe(201);

      // The route answered before the mail finished, so this is where the send is awaited.
      await settleEnquiryNotifications();
    } finally {
      delete process.env.ENQUIRY_TO;
    }

    expect(sent.map((message) => message.to).sort()).toEqual(['ops@platform.test', 'sales@sheds.test']);
    for (const message of sent) expect(message.replyTo).toBe('jo@customer.test');
    await ctx.close();
  });

  it('answers the form without waiting for the relay', async () => {
    /*
     * The defect this exists to prevent, measured: the real relay takes ~6.5 s per send, and a first
     * version awaited it under a four-second cap — so every notification was abandoned while the
     * form reported success. Slowness here stands in for that relay; the request must not feel it.
     */
    const slow: TransactionalDeps = {
      transport: {
        async send(message) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return { messageId: message.messageId };
        },
      },
      from: 'no_reply@platform.test',
      publicOrigin: 'http://localhost:3061',
    };
    const ctx = await makeTestApp(testConfig(), slow);
    await seedPlatformAdmin(ctx.db, { email: 'ops@platform.test', password: 'a-long-enough-password' });

    const started = Date.now();
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
    const elapsed = Date.now() - started;

    expect(response.statusCode).toBe(201);
    // Well under the mock's own delay, which proves the answer did not wait for it.
    expect(elapsed).toBeLessThan(1200);
    await ctx.close();
  });

  it('records the enquiry even when the relay refuses every message', async () => {
    /*
     * The whole point. A person filling in a contact form cannot fix a mail server, and answering
     * 500 would tell them their enquiry was lost when it is in the database.
     */
    const refusing: TransactionalDeps = {
      transport: { async send() { throw new Error('550 mailbox unavailable'); } },
      from: 'no_reply@platform.test',
      publicOrigin: 'http://localhost:3061',
    };
    const ctx = await makeTestApp(testConfig(), refusing);

    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
    expect(response.statusCode).toBe(201);

    const count = await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM enquiries');
    expect(Number(count?.n ?? 0)).toBe(1);
    await ctx.close();
  });

  it('accepts an enquiry on a server with no mail at all', async () => {
    // A demo or a fresh install has no SMTP, and the queue is still the record that matters.
    const ctx = await makeTestApp(testConfig(), null);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
    expect(response.statusCode).toBe(201);

    const count = await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM enquiries');
    expect(Number(count?.n ?? 0)).toBe(1);
    await ctx.close();
  });

  it('sends nothing when a bot fills the honeypot, and still looks successful', async () => {
    /*
     * The honeypot must not become a way to make this server send mail: it answers 201 and stops
     * before the insert, and it must stop before the notification too.
     */
    const { ctx, sent } = await appWithMail();
    await seedPlatformAdmin(ctx.db, { email: 'ops@platform.test', password: 'a-long-enough-password' });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enquiries',
      payload: form({ company: 'spam-bot-was-here' }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ received: true });
    await settleEnquiryNotifications();
    expect(sent).toHaveLength(0);

    const count = await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM enquiries');
    expect(Number(count?.n ?? 0)).toBe(0);
    await ctx.close();
  });

  it('does not write to a disabled platform administrator', async () => {
    // An address that belongs to somebody who has left is not a person who should get leads.
    const { ctx, sent } = await appWithMail();
    await seedPlatformAdmin(ctx.db, { email: 'gone@platform.test', password: 'a-long-enough-password' });
    await ctx.db.run("UPDATE users SET disabled_at = '2026-11-01T00:00:00Z' WHERE email = 'gone@platform.test'");

    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/enquiries', payload: form() });
    expect(response.statusCode).toBe(201);
    await settleEnquiryNotifications();
    expect(sent).toHaveLength(0);
    await ctx.close();
  });
});

describe('the notification helper used directly', () => {
  it('never throws, whatever the transport does', async () => {
    // The route relies on this: any throw here would turn a stored lead into a 500.
    const exploding: TransactionalDeps = {
      transport: { async send() { throw new Error('boom'); } },
      from: 'no_reply@platform.test',
      publicOrigin: 'http://localhost:3061',
    };
    const result = await sendEnquiryNotifications(
      exploding,
      {
        name: 'A', email: 'a@b.test', phone: null, message: 'm', source: 'contact',
        createdAt: '2026-11-06T00:00:00Z',
      },
      { enquiryTo: 'sales@sheds.test', adminEmails: [] },
    );
    expect(result.failed).toEqual(['sales@sheds.test']);
  });
});
