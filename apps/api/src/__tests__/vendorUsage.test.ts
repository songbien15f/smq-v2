import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';

/**
 * The vendor dashboard's data route, and the one thing that matters about it: **nobody without the
 * password gets in.**
 *
 * ## Why the refusals are the test
 *
 * The happy path is four queries and a map. The failure that costs something is a route that answers
 * 200 to a caller who guessed — this page reads every company's activity, and it sits outside the
 * product's session model entirely, so there is no role check behind it to catch a mistake here.
 *
 * Two refusals are deliberately the same answer. A missing password and a wrong one both look like a
 * route that does not exist, because "there is a dashboard here" is itself information.
 */

const PASSWORD = 'test-dashboard-password-abc123';

let ctx: TestApp;
const original = process.env.VENDOR_DASHBOARD_PASSWORD;

beforeAll(async () => {
  process.env.VENDOR_DASHBOARD_PASSWORD = PASSWORD;
  ctx = await makeTestApp();
});

afterAll(async () => {
  await ctx.close();
  if (original === undefined) delete process.env.VENDOR_DASHBOARD_PASSWORD;
  else process.env.VENDOR_DASHBOARD_PASSWORD = original;
});

/** Call the route with an optional key. */
async function call(key?: string) {
  return ctx.app.inject({
    method: 'GET',
    url: '/api/v1/vendor/usage',
    headers: key === undefined ? {} : { 'x-vendor-key': key },
  });
}

describe('GET /vendor/usage', () => {
  it('refuses a caller with no key, as a 404', async () => {
    const response = await call();
    // Not 401: an unauthenticated caller should not learn that this route exists.
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
  });

  it('refuses a wrong key with the same 404', async () => {
    const response = await call('not-the-password');
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
  });

  it('refuses a key that is a prefix of the real one', async () => {
    // A length-based early return is the classic way a constant-time comparison stops being one. This
    // asserts the behaviour, not the timing: a prefix must not be accepted.
    const response = await call(PASSWORD.slice(0, 10));
    expect(response.statusCode).toBe(404);
  });

  it('closes the route when no password is configured at all', async () => {
    delete process.env.VENDOR_DASHBOARD_PASSWORD;
    const response = await call('anything');
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('not_configured');
    process.env.VENDOR_DASHBOARD_PASSWORD = PASSWORD;
  });

  it('answers the figures to the right key', async () => {
    const response = await call(PASSWORD);
    expect(response.statusCode).toBe(200);

    const body = response.json() as { ok: boolean; data: { kinds: unknown[]; routes: unknown[]; recent: unknown[] } };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.kinds)).toBe(true);
    expect(Array.isArray(body.data.routes)).toBe(true);
    expect(Array.isArray(body.data.recent)).toBe(true);
  });

  it('records a page view and counts it under a grouped route', async () => {
    /*
     * The grouping is the part with a real bug behind it: the first version replaced identifiers while
     * *rendering*, so three separate quotes' editors showed as three rows all labelled
     * `/quotes/:id/edit`. Grouping and labelling are one question, so the map key is the normalised
     * route — and this test writes two different quote ids to prove they land in one row.
     */
    await ctx.db.run(
      `INSERT INTO usage_events (id, at, kind, tenant_id, user_id, ip_hash, detail_json)
       VALUES ('u1', ?, 'page_view', 't1', 'user1', NULL, '{"route":"/quotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/edit"}')`,
      [new Date().toISOString()],
    );
    await ctx.db.run(
      `INSERT INTO usage_events (id, at, kind, tenant_id, user_id, ip_hash, detail_json)
       VALUES ('u2', ?, 'page_view', 't1', 'user1', NULL, '{"route":"/quotes/11111111-2222-3333-4444-555555555555/edit"}')`,
      [new Date().toISOString()],
    );

    const response = await call(PASSWORD);
    const routes = (response.json() as { data: { routes: { route: string; total: number }[] } }).data.routes;
    const editor = routes.find((row) => row.route === '/quotes/:id/edit');

    expect(editor, 'two quote ids did not group into one route').toBeDefined();
    expect(editor?.total).toBe(2);
    // And no raw identifier survives into the answer.
    expect(routes.some((row) => /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(row.route))).toBe(false);
  });
});
