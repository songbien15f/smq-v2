import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { now } from '@sq/db';
import { makeTestApp, seedCompany, type TestApp } from './helpers';
import {
  createInvitation,
  resolveInvitation,
  spendInvitation,
  RESET_TTL_MS,
} from '../lib/invitations';

let ctx: TestApp;
let company: { tenantId: string; userId: string; code: string; username: string };

beforeAll(async () => {
  ctx = await makeTestApp();
  company = await seedCompany(ctx.db, {
    name: 'Invite Sheds',
    slug: 'invite-sheds',
    code: 'INVSHED',
    username: 'owner',
    email: 'owner@invite.test',
    password: 'a-long-enough-password',
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('the invitation service', () => {
  it('stores only the hash of the token it hands back', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    // The plaintext token is in the return value and nowhere in the row.
    expect(created.token.length).toBeGreaterThan(20);
    const row = await ctx.db.get<{ token_hash: string }>(
      'SELECT token_hash FROM invitations WHERE id = ?',
      [created.id],
    );
    expect(row?.token_hash).not.toBe(created.token);
    expect(row?.token_hash).toHaveLength(64);
  });

  it('resolves a live reset token to the person it was made for', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    const resolved = await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' });
    expect(resolved?.userId).toBe(company.userId);
    expect(resolved?.tenantId).toBe(company.tenantId);
  });

  it('refuses a token presented for the other kind', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'estimator',
      kind: 'member',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses a spent token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    await spendInvitation(ctx.db, created.id);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses an expired token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: 1,
    });

    // Move the expiry into the past rather than sleeping for a millisecond.
    await ctx.db.run('UPDATE invitations SET expires_at = ? WHERE id = ?', [now(), created.id]);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses a revoked token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    await ctx.db.run('UPDATE invitations SET revoked_at = ? WHERE id = ?', [now(), created.id]);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });
});
