import { afterEach, describe, expect, it } from 'vitest';
import type { AdminCompanyPeopleView } from '@sq/contracts';
import {
  makeTestApp,
  seedCompany,
  seedPlatformAdmin,
  signInPlatform,
  signInWithDevice,
  type TestApp,
} from './helpers.js';

/**
 * Two things the desktop licence server did and v2 did not, found by comparing the admin sites
 * (docs/reviews/2026-11-16-admin-uiux-review.md §7b):
 *
 * 1. **An ended subscription stopped the company.** v2 stored `subscription_ends_at`, showed it, and
 *    then ignored it: a company past its end date kept signing in and quoting.
 * 2. **The vendor could see and remove a company's keys.** v2 showed only counts, so "we are out of
 *    seats" could be answered only by the customer's own administrator.
 */

const PASSWORD = 'a-long-enough-password';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let ctx: TestApp | null = null;
afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function setup() {
  ctx = await makeTestApp();
  const company = await seedCompany(ctx.db, {
    name: 'Ended Sheds',
    slug: 'ended-sheds',
    code: 'ENDED',
    username: 'owner',
    email: 'owner@ended.test',
    password: PASSWORD,
  });
  const other = await seedCompany(ctx.db, {
    name: 'Other Sheds',
    slug: 'other-sheds',
    code: 'OTHER',
    username: 'owner',
    email: 'owner@other.test',
    password: PASSWORD,
  });
  return { ctx, company, other };
}

async function endsAt(db: TestApp['db'], tenantId: string, iso: string | null): Promise<void> {
  await db.run('UPDATE tenants SET subscription_ends_at = ? WHERE id = ?', [iso, tenantId]);
}

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const nextMonth = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

describe('an ended subscription', () => {
  it('refuses sign-in, and says why', async () => {
    const { ctx, company } = await setup();
    await endsAt(ctx.db, company.tenantId, yesterday());

    const result = await signInWithDevice(ctx.app, 'ENDED', 'owner', PASSWORD);

    expect(result.statusCode).toBe(403);
    expect(result.body).toContain('subscription has ended');
    expect(result.sessionCookie).toBe('');
    // No seat was taken by the refused attempt.
    const held = await ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM device_seats WHERE tenant_id = ?',
      [company.tenantId],
    );
    expect(Number(held?.n)).toBe(0);
  });

  it('still lets a company with a future end date in', async () => {
    const { ctx, company } = await setup();
    await endsAt(ctx.db, company.tenantId, nextMonth());

    const result = await signInWithDevice(ctx.app, 'ENDED', 'owner', PASSWORD);
    expect(result.statusCode).toBe(200);
  });

  it('stops an open tab on its next request, and lets it back in once renewed', async () => {
    const { ctx, company } = await setup();
    const { sessionCookie } = await signInWithDevice(ctx.app, 'ENDED', 'owner', PASSWORD);
    const session = () =>
      ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: sessionCookie } });

    expect((await session()).statusCode).toBe(200);

    await endsAt(ctx.db, company.tenantId, yesterday());
    expect((await session()).statusCode).toBe(401);

    // Renewing does not need anybody to sign in again: nothing was revoked.
    await endsAt(ctx.db, company.tenantId, nextMonth());
    expect((await session()).statusCode).toBe(200);
  });
});

describe("the vendor's view of a company's people", () => {
  async function vendor(ctx: TestApp, role: 'platform_admin' | 'platform_support' = 'platform_admin') {
    const email = `${role}@vendor.test`;
    await seedPlatformAdmin(ctx.db, { email, password: PASSWORD, role });
    return signInPlatform(ctx.app, email, PASSWORD);
  }

  async function signInChrome(ctx: TestApp, code: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { 'user-agent': CHROME_WINDOWS },
      payload: { companyCode: code, username: 'owner', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    const cookies = (Array.isArray(raw) ? raw : [raw ?? '']) as string[];
    return (cookies.find((value) => value.startsWith('sq_session='))?.split(';')[0] ?? '') as string;
  }

  async function people(ctx: TestApp, cookie: string, tenantId: string) {
    return ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/people`,
      headers: { cookie },
    });
  }

  it('lists members, the devices holding seats, and recent sign-ins', async () => {
    const { ctx, company } = await setup();
    await signInChrome(ctx, 'ENDED');
    const cookie = await vendor(ctx);

    const response = await people(ctx, cookie, company.tenantId);
    expect(response.statusCode).toBe(200);
    const view = response.json().data as AdminCompanyPeopleView;

    expect(view.seats).toBe(3);
    expect(view.seatsInUse).toBe(1);
    expect(view.members).toHaveLength(1);
    expect(view.members[0]).toMatchObject({ username: 'owner', role: 'company_admin', status: 'active' });
    expect(view.members[0]?.lastSignInAt).not.toBeNull();
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({ username: 'owner', holdsSeat: true, label: 'Chrome on Windows' });
    expect(view.recentSignIns).toHaveLength(1);
    expect(view.recentSignIns[0]).toMatchObject({ label: 'Chrome on Windows', state: 'active' });
  });

  it('answers 404 for a company that does not exist', async () => {
    const { ctx } = await setup();
    const cookie = await vendor(ctx);
    expect((await people(ctx, cookie, 'no-such-company')).statusCode).toBe(404);
  });

  it('is not open to a company administrator', async () => {
    const { ctx, company } = await setup();
    const companyCookie = await signInChrome(ctx, 'ENDED');
    expect((await people(ctx, companyCookie, company.tenantId)).statusCode).toBe(403);
  });

  it('frees a seat: the device is signed out, the seat is free, and it is audited', async () => {
    const { ctx, company } = await setup();
    const companyCookie = await signInChrome(ctx, 'ENDED');
    const cookie = await vendor(ctx);
    const deviceId = ((await people(ctx, cookie, company.tenantId)).json().data as AdminCompanyPeopleView)
      .devices[0]?.id as string;

    const freed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${company.tenantId}/devices/${deviceId}`,
      headers: { cookie },
    });
    expect(freed.statusCode).toBe(200);

    const after = (await people(ctx, cookie, company.tenantId)).json().data as AdminCompanyPeopleView;
    expect(after.seatsInUse).toBe(0);
    expect(after.devices).toHaveLength(0);
    expect(after.recentSignIns[0]?.state).toBe('ended');

    // The browser that was signed in stops working on its next request.
    const session = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: companyCookie },
    });
    expect(session.statusCode).toBe(401);

    const audit = await ctx.db.get<{ actor_email: string; target_id: string }>(
      "SELECT actor_email, target_id FROM audit_events WHERE action = 'device.revoked'",
    );
    expect(audit).toMatchObject({ actor_email: 'platform_admin@vendor.test', target_id: deviceId });

    // Freeing it twice is a 404, not a second audit row.
    const again = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${company.tenantId}/devices/${deviceId}`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(404);
  });

  it("cannot free another company's device through the wrong company", async () => {
    const { ctx, company, other } = await setup();
    await signInChrome(ctx, 'OTHER');
    const cookie = await vendor(ctx);
    const otherDevice = ((await people(ctx, cookie, other.tenantId)).json().data as AdminCompanyPeopleView)
      .devices[0]?.id as string;

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${company.tenantId}/devices/${otherDevice}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);

    const still = (await people(ctx, cookie, other.tenantId)).json().data as AdminCompanyPeopleView;
    expect(still.seatsInUse).toBe(1);
  });

  it('lets support look but not free a seat', async () => {
    const { ctx, company } = await setup();
    await signInChrome(ctx, 'ENDED');
    const cookie = await vendor(ctx, 'platform_support');

    const view = await people(ctx, cookie, company.tenantId);
    expect(view.statusCode).toBe(200);
    const deviceId = (view.json().data as AdminCompanyPeopleView).devices[0]?.id as string;

    const freed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${company.tenantId}/devices/${deviceId}`,
      headers: { cookie },
    });
    expect(freed.statusCode).toBe(403);
  });
});
