/**
 * Usage: what the product is being used for.
 *
 * ## Why a vendor screen and a company screen are the same route
 *
 * `usage:read` is a company capability — a shed company may see its own activity. A platform
 * administrator sees every company's. One route with a scope decision is better than two that can
 * disagree about what a count means.
 *
 * ## Why `page_view` is a POST from the client
 *
 * The server cannot know a screen was opened: a Next.js server component renders for a prefetch as
 * well as a visit, and counting those would inflate the figure with pages nobody looked at. So the
 * browser says so, once, after mount — and the route is deliberately cheap and never fails a request.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { pageQuery, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability, requirePlatformCapability } from '../lib/guard.js';
import { recentUsage, recordUsage, usageSummary } from '../lib/usage.js';

export function registerUsage(app: FastifyInstance, db: Db): void {
  /**
   * The summary a dashboard shows.
   *
   * A platform administrator sees every company; a company user sees their own. The decision is made
   * here from the session rather than from a query parameter, so a company cannot read another's
   * numbers by editing a URL.
   */
  app.get('/usage', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'usage:read');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    const tenantId = session.tenantId as string;
    const summary = await usageSummary(db, tenantId);
    const recent = await recentUsage(db, { tenantId, limit: query.data.limit });

    return sendOk(reply, { scope: 'company', summary, recent });
  });

  /** The same summary across every company, for the vendor. */
  app.get('/admin/usage', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:audit');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    const summary = await usageSummary(db, null);
    const recent = await recentUsage(db, { tenantId: null, limit: query.data.limit });

    return sendOk(reply, { scope: 'platform', summary, recent });
  });

  /**
   * Record that a screen was opened.
   *
   * Cheap and forgiving: an unknown kind is refused, but a failure to write never reaches the caller
   * as an error — a page view is not something an operator should ever see fail.
   */
  app.post('/usage/page-view', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const record = (request.body ?? {}) as Record<string, unknown>;
    const route = typeof record.route === 'string' ? record.route.slice(0, 120) : '';

    await recordUsage(db, {
      kind: 'page_view',
      tenantId: session.tenantId as string,
      userId: session.userId,
      detail: { route },
    });

    return sendOk(reply, { recorded: true });
  });

  /*
   * There was a `GET /usage/kinds` here, returning the four ids.
   *
   * Nothing called it, and the screen that lists them keeps its own English labels — "Quotes
   * created", not `quote_created` — because a shed owner should not read an identifier, and a route
   * that hands over ids cannot supply that. Its comment said "so a screen labels them from one
   * list", but the list it returns is the one the screen cannot use. Removed 2026-11-06.
   */
}
