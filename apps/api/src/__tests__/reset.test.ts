import { describe, it, expect } from 'vitest';
import { makeTestApp, seedCompany, testConfig, type TestApp } from './helpers';
import type { OutboundMail } from '../lib/mail/transport';
import type { TransactionalDeps } from '../lib/mail/transactional';

/**
 * A test app whose mail transport records instead of sending.
 *
 * Every test in this file needs the same three lines: an array that collects, a transport that
 * pushes into it, and the deps object. A local helper keeps each test about the request it is
 * making rather than about the harness.
 */
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

describe('requesting a password reset', () => {
  it('answers the same sentence for a good code and a bad one', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Reset Sheds', slug: 'reset-sheds', code: 'RESETC', username: 'jo',
      email: 'jo@reset.test', password: 'a-long-enough-password',
    });

    const good = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'RESETC', email: 'jo@reset.test' },
    });
    const badCode = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'NOPE', email: 'jo@reset.test' },
    });
    const badEmail = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'RESETC', email: 'nobody@reset.test' },
    });

    expect(good.statusCode).toBe(200);
    expect(badCode.statusCode).toBe(good.statusCode);
    expect(badEmail.statusCode).toBe(good.statusCode);
    expect(badCode.json().data).toEqual(good.json().data);
    expect(badEmail.json().data).toEqual(good.json().data);
    await ctx.close();
  });

  it('sends mail only when the code and the address both resolve', async () => {
    const { ctx, sent } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Mail Sheds', slug: 'mail-sheds', code: 'MAILSHED', username: 'jo',
      email: 'jo@mail.test', password: 'a-long-enough-password',
    });

    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'MAILSHED', email: 'jo@mail.test' },
    });
    expect(sent).toHaveLength(1);

    // A stranger must not be able to trigger mail to another company's staff.
    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'WRONG', email: 'jo@mail.test' },
    });
    expect(sent).toHaveLength(1);
    await ctx.close();
  });

  it('writes a reset invitation that a confirm step can spend', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Row Sheds', slug: 'row-sheds', code: 'ROWX', username: 'jo',
      email: 'jo@row.test', password: 'a-long-enough-password',
    });

    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'ROWX', email: 'jo@row.test' },
    });

    const row = await ctx.db.get<{ kind: string; email: string }>(
      "SELECT kind, email FROM invitations WHERE tenant_id = ? AND kind = 'reset'",
      [company.tenantId],
    );
    expect(row?.email).toBe('jo@row.test');
    await ctx.close();
  });

  it('answers 503 rather than pretending to send when mail is unconfigured', async () => {
    const ctx = await makeTestApp(testConfig(), null);
    await seedCompany(ctx.db, {
      name: 'No Mail', slug: 'no-mail', code: 'NOMAIL', username: 'jo',
      email: 'jo@nomail.test', password: 'a-long-enough-password',
    });

    const response = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'NOMAIL', email: 'jo@nomail.test' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('not_configured');
    await ctx.close();
  });
});
