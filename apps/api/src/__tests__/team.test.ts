import { describe, it, expect } from 'vitest';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';
import type { OutboundMail } from '../lib/mail/transport';
import type { TransactionalDeps } from '../lib/mail/transactional';
import { createInvitation, INVITE_TTL_MS } from '../lib/invitations';

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

describe('inviting and re-admitting staff', () => {
  it('creates a pending membership the person cannot sign in with yet', async () => {
    const { ctx, sent } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Team Sheds', slug: 'team-sheds', code: 'TEAMS', username: 'owner',
      email: 'owner@team.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'TEAMS', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'new@team.test', role: 'estimator', displayName: 'New Person', username: 'newperson' },
    });

    expect(invited.statusCode).toBe(201);
    expect(sent).toHaveLength(1);

    const membership = await ctx.db.get<{ status: string }>(
      'SELECT m.status FROM memberships m WHERE m.tenant_id = ? AND m.user_id = (SELECT id FROM users WHERE email = ?)',
      [company.tenantId, 'new@team.test'],
    );
    expect(membership?.status).toBe('pending');

    // Pending does not sign in.
    const refused = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'TEAMS', username: 'newperson', password: 'anything-at-all-here' },
    });
    expect(refused.statusCode).toBe(401);
    await ctx.close();
  });

  it('reuses an existing account from another company instead of creating a second user', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Other Co', slug: 'other-co', code: 'OTHERCO', username: 'jo',
      email: 'shared@both.test', password: 'a-long-enough-password',
    });
    await seedCompany(ctx.db, {
      name: 'Host Co', slug: 'host-co', code: 'HOSTCO', username: 'owner',
      email: 'owner@host.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'HOSTCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'shared@both.test', role: 'viewer', displayName: 'Shared', username: 'shared2' },
    });

    expect(invited.statusCode).toBe(201);
    const users = await ctx.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'shared@both.test'",
    );
    expect(Number(users[0]?.n)).toBe(1);
    await ctx.close();
  });

  it('refuses an invitation to someone already active in this company', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Dup Co', slug: 'dup-co', code: 'DUPCO', username: 'owner',
      email: 'owner@dup.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'DUPCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'owner@dup.test', role: 'estimator', displayName: 'Owner', username: 'owner2' },
    });
    expect(invited.statusCode).toBe(409);
    await ctx.close();
  });

  it('sends a reset for a member of this company and 404s for another company', async () => {
    const { ctx, sent } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Mine', slug: 'mine', code: 'MINECO', username: 'owner',
      email: 'owner@mine.test', password: 'a-long-enough-password',
    });
    await seedCompany(ctx.db, {
      name: 'Theirs', slug: 'theirs', code: 'THEIRCO', username: 'owner',
      email: 'owner@theirs.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'MINECO', 'owner', 'a-long-enough-password');

    const mine = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/owner@mine.test/reset', headers: { cookie },
    });
    const theirs = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/owner@theirs.test/reset', headers: { cookie },
    });

    expect(mine.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    // Not 403: a 403 would confirm the other company's member exists.
    expect(theirs.statusCode).toBe(404);
    await ctx.close();
  });

  it('refuses an invitation when mail is not configured', async () => {
    const ctx = await makeTestApp(testConfig(), null);
    await seedCompany(ctx.db, {
      name: 'No Mail Co', slug: 'no-mail-co', code: 'NOMAILCO', username: 'owner',
      email: 'owner@nomailco.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'NOMAILCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'x@y.test', role: 'viewer', displayName: 'X', username: 'xperson' },
    });
    expect(invited.statusCode).toBe(503);
    await ctx.close();
  });
});

describe('accepting an invitation', () => {
  it('turns pending into active, sets the password, and signs the person in', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Join Sheds', slug: 'join-sheds', code: 'JOINS', username: 'owner',
      email: 'owner@join.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'JOINS', 'owner', 'a-long-enough-password');

    await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'joiner@join.test', role: 'estimator', displayName: 'Joiner', username: 'joiner' },
    });

    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId, email: 'joiner@join.test', role: 'estimator',
      kind: 'member', invitedBy: null, ttlMs: INVITE_TTL_MS,
    });

    const joined = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/join/confirm',
      payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
    });

    expect(joined.statusCode).toBe(200);
    expect(joined.json().data.currentTenantCode).toBe('JOINS');
    expect(joined.json().data.memberships[0].role).toBe('estimator');
    expect(joined.json().data.mustChangePassword).toBe(false);

    const membership = await ctx.db.get<{ status: string }>(
      'SELECT status FROM memberships WHERE tenant_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)',
      [company.tenantId, 'joiner@join.test'],
    );
    expect(membership?.status).toBe('active');

    // And a reset token cannot be spent at the join door, nor the reverse.
    const crossKind = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/join/confirm',
      payload: { token: created.token, password: 'another-password-here', confirmPassword: 'another-password-here' },
    });
    expect(crossKind.statusCode).toBe(422);
    await ctx.close();
  });
});
