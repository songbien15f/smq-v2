/**
 * The vendor dashboard's data: how much the product is being used, and from which screens.
 *
 * ## Why this is not `/admin/usage`
 *
 * `/admin/usage` answers a **platform administrator** holding a session — a person signed in to a
 * company or to the platform, with a role that grants `platform:audit`. This route answers
 * something else: the operator looking at a page he keeps for himself, with **no session at all**,
 * behind one password. Making it part of the session model would mean giving that operator a user
 * row and a role in a product where he may not be a member of any company.
 *
 * ## The secret travels in a header, and is compared in constant time
 *
 * The password lives server-side on both apps (`VENDOR_DASHBOARD_PASSWORD`). The browser never holds
 * it: it holds a signed cookie minted by the client app after a successful login, and the client app
 * — which does hold the password — makes this call itself. So the header is never seen by a browser.
 *
 * ## What it counts
 *
 * Two groupings, because two questions:
 *
 * - **by kind** — how much is happening (`quote_created`, `revision_saved`, `mail_sent`, `page_view`);
 * - **by route** — *which screens* people actually open, which is what "is anybody using this" means
 *   for a product whose whole value is a long form. A company that signs in and never opens the
 *   editor is a company that will not renew, and the kind counts alone cannot say that.
 *
 * Both over three windows, because a total says the product *has* been used and the windows say
 * whether it is used **now**.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { sendFail, sendOk } from '../lib/http.js';

/** The windows the dashboard offers. Anything else falls back to the first. */
const WINDOWS = [7, 30, 90] as const;

/**
 * Compare two strings without leaking their content or their length through timing.
 *
 * Both sides are hashed first, for the reason `verifyPassword` does the same: `timingSafeEqual`
 * throws on a length mismatch, so comparing raw input means either throwing on every wrong-length
 * guess or returning early — and an early return is exactly the timing difference a comparison is
 * supposed to hide. A SHA-256 digest is always 32 bytes, so the work is identical whatever arrives.
 *
 * An empty expected value is a *closed* route, not an open one: the caller checks that first.
 */
function secretMatches(given: string | undefined, expected: string): boolean {
  if (given === undefined || given === '') return false;
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** One row of "how much of this happened". */
interface KindRow {
  kind: string;
  total: number;
  last7: number;
  last30: number;
  last90: number;
}

/** One row of "which screen was opened, and how often". */
interface RouteRow {
  route: string;
  total: number;
  last7: number;
  last30: number;
  last90: number;
}

/**
 * A route with its identifier replaced by `:id`.
 *
 * **This grouping has to happen here, not in the page.** The first version did the substitution while
 * *rendering*, so the table showed `/quotes/:id/edit` three times with 41, 16 and 16 views — three
 * rows that looked like one screen because they shared a label. Grouping and labelling are two halves
 * of the same question ("how many times was the editor opened"), so they belong in the same place: the
 * map key is the normalised route, and the page prints what it is given.
 *
 * The pattern covers a UUID, a long hex id and a trailing numeric id, because a route can carry any of
 * them (`/quotes/<uuid>/edit`, `/share/<token>`).
 */
function normaliseRoute(route: string): string {
  return route
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id');
}

export function registerVendor(app: FastifyInstance, db: Db): void {
  app.get('/vendor/usage', async (request, reply) => {
    const expected = process.env.VENDOR_DASHBOARD_PASSWORD ?? '';
    if (expected === '') {
      /*
       * No password configured is **not** "no password required". The dashboard is a page that reads
       * every company's activity, so an unset variable has to close it rather than open it — the same
       * rule the RFQ dashboard's settings file follows.
       */
      return sendFail(
        reply,
        'not_configured',
        'VENDOR_DASHBOARD_PASSWORD is not set, so the dashboard is closed.',
      );
    }

    const given = request.headers['x-vendor-key'];
    if (!secretMatches(typeof given === 'string' ? given : undefined, expected)) {
      // 404, not 401: an unauthenticated caller should not learn that this route exists.
      return sendFail(reply, 'not_found', 'No such route.');
    }

    const at = (days: number): string =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [d7, d30, d90] = [at(7), at(30), at(90)];

    /*
     * Both groupings in one pass over the table, with the three windows as conditional sums.
     *
     * The alternative — a query per window — is three scans of a table that grows with every save and
     * every screen opened. `SUM(CASE WHEN …)` is the shape `usageSummary` already uses, and keeping
     * the two consistent means a number here cannot disagree with the company's own Activity screen.
     */
    const kinds = await db.all<{ kind: string; total: number; last7: number; last30: number; last90: number }>(
      `SELECT kind,
              COUNT(*) AS total,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last7,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last30,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS last90
         FROM usage_events
        GROUP BY kind
        ORDER BY kind`,
      [d7, d30, d90],
    );

    /*
     * Routes, from the `detail_json` of the page-view rows.
     *
     * `detail_json` is TEXT holding a small JSON object, so extracting the route is a string operation.
     * It is done in JS rather than SQL because the portable-SQL adapter has to run this on SQLite and
     * Postgres, and JSON path syntax is one of the places they differ — a `->>` would work on one and
     * not the other, which is the kind of divergence that shows up as "the chart is empty in
     * production".
     *
     * The cost is reading every page-view row. That is acceptable for a dashboard opened rarely, and
     * it is written down rather than discovered: if this table ever reaches millions of rows, the fix
     * is a `route` column, not a cleverer query.
     */
    const pageViews = await db.all<{ at: string; detail_json: string | null }>(
      `SELECT at, detail_json FROM usage_events WHERE kind = 'page_view'`,
    );

    const byRoute = new Map<string, RouteRow>();
    for (const row of pageViews) {
      let route = '(unknown)';
      if (row.detail_json !== null) {
        try {
          const parsed = JSON.parse(row.detail_json) as { route?: unknown };
          if (typeof parsed.route === 'string' && parsed.route !== '') route = normaliseRoute(parsed.route);
        } catch {
          // A malformed detail is a row this route cannot classify; it still counts as a view, under
          // `(unknown)`, because dropping it would make the total disagree with the kind count.
        }
      }
      const entry = byRoute.get(route) ?? { route, total: 0, last7: 0, last30: 0, last90: 0 };
      entry.total += 1;
      if (row.at >= d7) entry.last7 += 1;
      if (row.at >= d30) entry.last30 += 1;
      if (row.at >= d90) entry.last90 += 1;
      byRoute.set(route, entry);
    }

    const routes = [...byRoute.values()].sort((a, b) => b.total - a.total);

    /*
     * The same shapes with numbers coerced.
     *
     * `SUM` over zero rows is NULL, and Postgres and SQLite return it differently through the adapter;
     * `Number(null)` is 0 and `Number(undefined)` is NaN, and a NaN on this screen renders as "NaN" in
     * a table cell. Coercing once, here, is cheaper than doing it in the component.
     */
    const kindRows: KindRow[] = kinds.map((row) => ({
      kind: row.kind,
      total: Number(row.total ?? 0),
      last7: Number(row.last7 ?? 0),
      last30: Number(row.last30 ?? 0),
      last90: Number(row.last90 ?? 0),
    }));

    /*
     * Who came, and what they did.
     *
     * Two readings of the same rows, because the operator asked two things:
     *
     * - **visitors** — a distinct `ip_hash` with its first and last visit, how many events it produced,
     *   and which person it was signed in as. This is "how many different people used it", which no
     *   total can answer: a thousand page views from one laptop is a different fact from a thousand
     *   from forty.
     * - **activity** — every event, newest first, with the actor and what it was about. This is the log.
     *
     * **The address is already a digest** by the time it reaches this table (`hashAddress` in
     * `lib/usage.ts`), so nothing here can turn it back into an address even if asked to. The screen
     * shows the first eight characters as a stable handle, which is enough to tell two visitors apart
     * and not enough to identify anybody.
     */
    const events = await db.all<{
      at: string;
      kind: string;
      ip_hash: string | null;
      user_id: string | null;
      tenant_id: string | null;
      detail_json: string | null;
    }>(
      `SELECT at, kind, ip_hash, user_id, tenant_id, detail_json
         FROM usage_events
        ORDER BY at DESC`,
    );

    /** The `detail_json` fields this route reads, parsed once per row. */
    type Parsed = { route?: string; actor?: string; quoteNumber?: string; mode?: string; revision?: number };
    const parsedOf = (json: string | null): Parsed => {
      if (json === null) return {};
      try {
        const value = JSON.parse(json) as unknown;
        return typeof value === 'object' && value !== null ? (value as Parsed) : {};
      } catch {
        return {};
      }
    };

    const byVisitor = new Map<
      string,
      {
        visitor: string;
        firstSeen: string;
        lastSeen: string;
        events: number;
        screens: number;
        actors: Set<string>;
        tenants: Set<string>;
      }
    >();

    for (const row of events) {
      // An event with no address (a job with no request behind it) cannot be a visitor.
      if (row.ip_hash === null) continue;

      const handle = row.ip_hash.slice(0, 8);
      const entry =
        byVisitor.get(handle) ??
        {
          visitor: handle,
          firstSeen: row.at,
          lastSeen: row.at,
          events: 0,
          screens: 0,
          actors: new Set<string>(),
          tenants: new Set<string>(),
        };

      entry.events += 1;
      if (row.kind === 'page_view') entry.screens += 1;
      if (row.at < entry.firstSeen) entry.firstSeen = row.at;
      if (row.at > entry.lastSeen) entry.lastSeen = row.at;
      const actor = parsedOf(row.detail_json).actor;
      if (typeof actor === 'string' && actor !== '') entry.actors.add(actor);
      if (row.tenant_id !== null) entry.tenants.add(row.tenant_id);

      byVisitor.set(handle, entry);
    }

    const visitors = [...byVisitor.values()]
      .map((entry) => ({
        visitor: entry.visitor,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        events: entry.events,
        screens: entry.screens,
        actors: [...entry.actors],
        tenants: entry.tenants.size,
      }))
      .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));

    /** A company name, so the log says "Demo Sheds" rather than a uuid. */
    const tenants = await db.all<{ id: string; name: string }>('SELECT id, name FROM tenants');
    const tenantName = new Map(tenants.map((row) => [row.id, row.name]));

    const activity = events.slice(0, 200).map((row) => {
      const parsed = parsedOf(row.detail_json);
      return {
        at: row.at,
        kind: row.kind,
        visitor: row.ip_hash === null ? null : row.ip_hash.slice(0, 8),
        actor: typeof parsed.actor === 'string' ? parsed.actor : null,
        tenant: row.tenant_id === null ? null : (tenantName.get(row.tenant_id) ?? null),
        route: typeof parsed.route === 'string' ? parsed.route : null,
        quoteNumber: typeof parsed.quoteNumber === 'string' ? parsed.quoteNumber : null,
        mode: typeof parsed.mode === 'string' ? parsed.mode : null,
        revision: typeof parsed.revision === 'number' ? parsed.revision : null,
      };
    });

    return sendOk(reply, {
      windows: WINDOWS,
      kinds: kindRows,
      routes,
      visitors,
      /*
       * `activity` is the log, and it replaced an older `recent` array — same rows, fewer fields.
       *
       * Two arrays over one table is how a screen ends up showing "the newest 40" beside "every
       * event" that disagree about what happened. One list, sliced here, and the page renders it.
       */
      activity,
    });
  });
}
