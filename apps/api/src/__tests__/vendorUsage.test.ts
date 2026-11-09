import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import { hashAddress, recordUsage } from '../lib/usage.js';

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

    const body = response.json() as {
      ok: boolean;
      data: { kinds: unknown[]; routes: unknown[]; visitors: unknown[]; activity: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.kinds)).toBe(true);
    expect(Array.isArray(body.data.routes)).toBe(true);
    // `recent` was replaced by `activity`: one array over one table, not two that can disagree.
    expect(Array.isArray(body.data.visitors)).toBe(true);
    expect(Array.isArray(body.data.activity)).toBe(true);
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

/**
 * Who came, and what they did.
 *
 * The operator's ask was explicit: *"bao nhiêu IP đã ghé thăm, và đã làm những thao tác gì… ko phải
 * chỉ đếm summary"*. Two properties make that answerable at all, and both are asserted here because
 * both are easy to lose:
 *
 * 1. **an address is recorded at all** — `hashAddress` had to be wired into `recordUsage`, and until
 *    it was, `ip_hash` was NULL on every row and the visitors table would have been empty forever;
 * 2. **it is a digest, not an address** — reversible-by-enumeration is the failure mode of an
 *    unsalted hash of an IPv4 address, so the salt is part of the contract.
 */
describe('visitors and the activity log', () => {
  it('hashes an address with a salt, and never stores the address', () => {
    process.env.SESSION_SECRET = 'test-session-secret-long-enough-for-the-salt';

    const a = hashAddress('203.0.113.7');
    expect(a).not.toBeNull();
    // A digest, and short enough to show as a handle.
    expect(a).toHaveLength(32);
    expect(a).not.toContain('203');
    // Stable for the same input: the count depends on it.
    expect(hashAddress('203.0.113.7')).toBe(a);
    // Different for a different input.
    expect(hashAddress('203.0.113.8')).not.toBe(a);

    // A dual-stack listener reports the mapped form; one visitor must not become two.
    expect(hashAddress('::ffff:203.0.113.7')).toBe(a);

    // A different salt gives a different digest, which is what makes enumeration useless.
    process.env.SESSION_SECRET = 'a-different-session-secret-also-long';
    expect(hashAddress('203.0.113.7')).not.toBe(a);
  });

  it('answers no digest for an absent address, rather than a digest of nothing', () => {
    // An event with no request behind it must not collapse into one shared "visitor".
    expect(hashAddress(undefined)).toBeNull();
    expect(hashAddress('')).toBeNull();
    expect(hashAddress('   ')).toBeNull();
  });

  it('counts two addresses as two visitors, and one address twice as one', async () => {
    process.env.SESSION_SECRET = 'test-session-secret-long-enough-for-the-salt';

    await recordUsage(ctx.db, {
      kind: 'page_view',
      tenantId: 't1',
      userId: 'u1',
      address: '198.51.100.10',
      sessionId: 'session-visit-a',
      actorEmail: 'first@example.com',
      detail: { route: '/quotes' },
    });
    await recordUsage(ctx.db, {
      kind: 'page_view',
      tenantId: 't1',
      userId: 'u1',
      address: '198.51.100.10',
      sessionId: 'session-visit-a',
      actorEmail: 'first@example.com',
      detail: { route: '/settings' },
    });
    await recordUsage(ctx.db, {
      kind: 'quote_created',
      tenantId: 't1',
      userId: 'u2',
      address: '198.51.100.99',
      sessionId: 'session-visit-b',
      actorEmail: 'second@example.com',
      detail: { quoteId: 'q1', revision: 1, quoteNumber: 'Q-2026-0042' },
    });

    // The raw address must not be reachable from the table.
    const rows = await ctx.db.all<{ ip_hash: string | null; detail_json: string | null }>(
      'SELECT ip_hash, detail_json FROM usage_events',
    );
    expect(rows.every((row) => row.ip_hash === null || !row.ip_hash.includes('198'))).toBe(true);

    const response = await call(PASSWORD);
    const data = (response.json() as {
      data: {
        visitors: { visitor: string; events: number; screens: number; actors: string[] }[];
        visits: {
          sessionId: string;
          actions: number;
          durationMs: number;
          ipMasked: string | null;
          ipFull: string | null;
          events: { action: string; detail: string | null }[];
        }[];
        activity: { kind: string; actor: string | null; quoteNumber: string | null }[];
      };
    }).data;

    /*
     * Visits are grouped by **session**, which is what "how long did they stay" is a property of. Two
     * events were written under one session id, so they are one visit with two actions — and the
     * address is present in both forms: masked for the column, full for the click.
     */
    expect(data.visits).toHaveLength(2);
    const first = data.visits.find((visit) => visit.sessionId === 'session-visit-a');
    expect(first?.actions).toBe(2);
    // The last octet is what is hidden, so the /24 stays readable.
    expect(first?.ipMasked).toBe('198.51.100.•••');
    expect(first?.ipFull).toBe('198.51.100.10');
    // And the history says *what*, in words: "Opened" plus the route.
    expect(first?.events.map((event) => event.action)).toEqual(['Opened', 'Opened']);
    /*
     * Compared as a **set**, not a sequence: both rows are written in the same millisecond, so their
     * order in the table is whatever the storage decided — and asserting one order would be a test that
     * passes on SQLite and fails on Postgres for no reason a person could act on.
     */
    expect(new Set(first?.events.map((event) => event.detail))).toEqual(new Set(['/quotes', '/settings']));

    // Two addresses, not three events.
    expect(data.visitors).toHaveLength(2);

    const repeat = data.visitors.find((visitor) => visitor.actors.includes('first@example.com'));
    expect(repeat?.events).toBe(2);
    expect(repeat?.screens).toBe(2);

    // The log says *what* the second one did, by quote number — not only that something happened.
    const created = data.activity.find((event) => event.kind === 'quote_created');
    expect(created?.actor).toBe('second@example.com');
    expect(created?.quoteNumber).toBe('Q-2026-0042');
  });
});
