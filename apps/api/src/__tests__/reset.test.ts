import { describe, it, expect } from 'vitest';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';
import { createInvitation, RESET_TTL_MS } from '../lib/invitations';
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

describe('confirming a reset', () => {
  it('spends a reset token, signs the person in, and kills every earlier session', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Confirm Sheds', slug: 'confirm-sheds', code: 'CONFIRM', username: 'jo',
      email: 'jo@confirm.test', password: 'a-long-enough-password',
    });

    // An existing session an attacker might be holding.
    const oldCookie = await signIn(ctx.app, 'CONFIRM', 'jo', 'a-long-enough-password');

    const fresh = await createInvitation(ctx.db, {
      tenantId: company.tenantId, email: 'jo@confirm.test', role: 'company_admin',
      kind: 'reset', invitedBy: null, ttlMs: RESET_TTL_MS,
    });

    const confirmed = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/confirm',
      payload: { token: fresh.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data.currentTenantCode).toBe('CONFIRM');
    expect(confirmed.headers['set-cookie']).toBeDefined();

    // The old session is dead.
    const stale = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: oldCookie } });
    expect(stale.statusCode).toBe(401);

    // And the new password works.
    const ok = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'CONFIRM', username: 'jo', password: 'a-brand-new-password' },
    });
    expect(ok.statusCode).toBe(200);
    await ctx.close();
  });

  it('refuses the same token twice, with the same sentence as an unknown token', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Once Sheds', slug: 'once-sheds', code: 'ONCE', username: 'jo',
      email: 'jo@once.test', password: 'a-long-enough-password',
    });
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId, email: 'jo@once.test', role: 'company_admin',
      kind: 'reset', invitedBy: null, ttlMs: RESET_TTL_MS,
    });

    const first = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/confirm',
      payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
    });
    const second = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/confirm',
      payload: { token: created.token, password: 'another-new-password', confirmPassword: 'another-new-password' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/confirm',
      payload: { token: 'x'.repeat(40), password: 'another-new-password', confirmPassword: 'another-new-password' },
    });

    expect(first.statusCode).toBe(200);
    // 422, not 400: the envelope maps `validation_failed` to 422 and has no 400 code. A dead link
    // is not a field the person typed, but it is the code a form already renders.
    expect(second.statusCode).toBe(422);
    expect(unknown.statusCode).toBe(422);
    // A used link and a made-up link are indistinguishable.
    expect(second.json().message).toBe(unknown.json().message);
    await ctx.close();
  });
});

describe('a grant is only good while the membership behind it is', () => {
  it('refuses a reset link after the member has been removed', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Gone Sheds', slug: 'gone-sheds', code: 'GONE', username: 'jo',
      email: 'jo@gone.test', password: 'a-long-enough-password',
    });
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId, email: 'jo@gone.test', role: 'company_admin',
      kind: 'reset', invitedBy: null, ttlMs: RESET_TTL_MS,
    });

    // The administrator removes them while the link is still live.
    await ctx.db.run("UPDATE memberships SET status = 'removed' WHERE tenant_id = ? AND user_id = ?", [
      company.tenantId,
      company.userId,
    ]);

    const confirmed = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/confirm',
      payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
    });

    // Same sentence as a dead link, and no session — an offboarded person must not be able to
    // change a global password and must not consume a seat of a company they have left.
    expect(confirmed.statusCode).toBe(422);
    expect(confirmed.json().message).toBe('That link is no longer valid. Ask for a new one.');

    const sessions = await ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
      [company.userId],
    );
    expect(Number(sessions?.n)).toBe(0);

    await ctx.close();
  });

  it('refuses a member invitation whose membership row is no longer pending', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Stale Sheds', slug: 'stale-sheds', code: 'STALE', username: 'owner',
      email: 'owner@stale.test', password: 'a-long-enough-password',
    });
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId, email: 'gone@stale.test', role: 'estimator',
      kind: 'member', invitedBy: null, ttlMs: RESET_TTL_MS,
    });

    // The invitation exists but its membership was removed, so there is nothing to activate.
    await ctx.db.run(
      `INSERT INTO users (id, email, display_name, password_hash, must_change_password, created_at, updated_at)
       VALUES ('ghost-1', 'gone@stale.test', 'Ghost', NULL, 1, ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()],
    );
    await ctx.db.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username)
       VALUES (?, 'ghost-1', 'estimator', 'removed', ?, ?, 'ghost')`,
      [company.tenantId, new Date().toISOString(), new Date().toISOString()],
    );

    const joined = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/join/confirm',
      payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
    });
    expect(joined.statusCode).toBe(422);

    const rows = await ctx.db.get<{ status: string }>(
      "SELECT status FROM memberships WHERE tenant_id = ? AND user_id = 'ghost-1'",
      [company.tenantId],
    );
    expect(rows?.status).toBe('removed');
    await ctx.close();
  });
});

describe('mail is configured only when it has a From address', () => {
  it('treats SMTP credentials without MAIL_FROM as unconfigured', async () => {
    const { mailIsConfigured } = await import('../lib/mail/smtp');

    const credentials = {
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_HOST: 'mail.example.test',
      SMTP_PORT: '587',
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv;

    // No MAIL_FROM: there is an address to connect as and none to send from, so every message is
    // refused. Reporting "configured" made a reset form promise a link that could never arrive.
    expect(mailIsConfigured({ ...credentials })).toBe(false);
    expect(mailIsConfigured({ ...credentials, MAIL_FROM: '   ' })).toBe(false);
    expect(mailIsConfigured({ ...credentials, MAIL_FROM: 'no_reply@example.test' })).toBe(true);
  });
});
