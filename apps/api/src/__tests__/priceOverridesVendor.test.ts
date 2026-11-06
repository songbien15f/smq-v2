import { describe, expect, it } from 'vitest';
import { makeTestApp, seedCompany, seedPlatformAdmin, signInPlatform } from './helpers.js';

/**
 * The vendor's price-override writes.
 *
 * These routes were **missing** while the admin screen had been calling them since it shipped:
 * `/prices` PUTs to `admin/companies/<id>/prices/overrides`, which answered **404** — measured
 * 2026-11-06 — so "Change", "Use book price" and "Remove" did nothing at all. The GET beside them
 * existed, so the screen looked complete and the defect only appeared when somebody tried to save.
 *
 * The proxy made it worse: a Next route module accepts only the methods it exports, and the admin
 * bridge exported GET/POST/PATCH/DELETE but not PUT, so the request was answered 405 before it
 * reached the API. Both halves are fixed here, and this test is on the API half.
 */
describe('vendor price overrides', () => {
  async function setup() {
    const ctx = await makeTestApp();
    const company = await seedCompany(ctx.db, {
      name: 'Override Sheds',
      slug: 'override-sheds',
      code: 'OVR',
      email: 'ovr@example.com',
      password: 'a-long-enough-password',
    });
    await seedPlatformAdmin(ctx.db, { email: 'ops@ovr.test', password: 'a-long-enough-password' });
    const cookie = await signInPlatform(ctx.app, 'ops@ovr.test', 'a-long-enough-password');
    return { ctx, cookie, tenantId: company.tenantId };
  }

  it('lets the vendor set a price for a named company', async () => {
    const { ctx, cookie, tenantId } = await setup();

    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
      payload: { rowKey: 'cost_frame|C15012', unitCostCents: 1234 },
    });

    // 404 was the defect. A 200 with a version is the fix.
    expect(response.statusCode).toBe(200);
    const body = response.json().data as { version: number; rowCount: number };
    expect(body.version).toBe(1);
    expect(body.rowCount).toBe(1);

    // And the row is really there, readable through the GET that already worked.
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    const versions = read.json().data.versions as { rows: { rowKey: string; unitCostCents: number }[] }[];
    expect(versions[0]?.rows[0]?.rowKey).toBe('cost_frame|C15012');
    expect(versions[0]?.rows[0]?.unitCostCents).toBe(1234);
  });

  it('supersedes instead of editing, so a frozen revision keeps its meaning', async () => {
    const { ctx, cookie, tenantId } = await setup();
    const set = (cents: number) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
        headers: { cookie },
        payload: { rowKey: 'cost_frame|C15012', unitCostCents: cents },
      });

    await set(1000);
    const second = await set(2000);
    expect((second.json().data as { version: number }).version).toBe(2);

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    const versions = read.json().data.versions as { version: number; rows: { unitCostCents: number }[] }[];
    // Two versions, and the old one still says 1000 — an edit in place would have rewritten it.
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.version === 1)?.rows[0]?.unitCostCents).toBe(1000);
    expect(versions.find((v) => v.version === 2)?.rows[0]?.unitCostCents).toBe(2000);
  });

  it('deletes one version for a named company', async () => {
    const { ctx, cookie, tenantId } = await setup();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
      payload: { rowKey: 'cost_frame|C15012', unitCostCents: 1000 },
    });
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    const versionId = (read.json().data.versions as { id: string }[])[0]?.id;

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides/${versionId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    expect((after.json().data.versions as unknown[]).length).toBe(0);
  });

  it('returns a named company to the shared book', async () => {
    const { ctx, cookie, tenantId } = await setup();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
      payload: { rowKey: 'cost_frame|C15012', unitCostCents: 1000 },
    });

    const cleared = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    expect(cleared.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    expect((after.json().data.versions as unknown[]).length).toBe(0);
  });

  it('refuses a company that does not exist, rather than writing an orphan version', async () => {
    const { ctx, cookie } = await setup();
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/companies/tenant-that-is-not-there/prices/overrides',
      headers: { cookie },
      payload: { rowKey: 'cost_frame|C15012', unitCostCents: 1000 },
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not let one company delete another company’s version by guessing its id', async () => {
    /*
     * The delete is scoped by tenant in its own WHERE clause, so naming a real version id from a
     * different company answers 404 rather than deleting it. This is the check that a shared helper
     * makes easy to get wrong.
     */
    const { ctx, cookie, tenantId } = await setup();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
      payload: { rowKey: 'cost_frame|C15012', unitCostCents: 1000 },
    });
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    const versionId = (read.json().data.versions as { id: string }[])[0]?.id;

    const other = await seedCompany(ctx.db, {
      name: 'Other Sheds',
      slug: 'other-override-sheds',
      code: 'OVR2',
      email: 'ovr2@example.com',
      password: 'a-long-enough-password',
    });

    const attempt = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/companies/${other.tenantId}/prices/overrides/${versionId}`,
      headers: { cookie },
    });
    expect(attempt.statusCode).toBe(404);

    // The original company's version is untouched.
    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/companies/${tenantId}/prices/overrides`,
      headers: { cookie },
    });
    expect((after.json().data.versions as unknown[]).length).toBe(1);
  });
});
