/**
 * Quotes: the list, and one quote.
 *
 * The list is deliberately thin — a row needs a number, a customer, a status and a
 * price, and reading every revision to build it would make a 200-quote account slow
 * for no benefit. The contract price and the `incomplete` flag are denormalised onto
 * the `quotes` row and maintained by the save transaction.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { pageQuery, parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { nextQuoteNumber } from '../lib/evaluations.js';
import type { QuoteListItem, QuoteStatus } from '@sq/contracts';
import { revisionMetadataRequest } from '@sq/contracts';

export function registerQuotes(app: FastifyInstance, db: Db): void {
  app.get('/quotes', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendFail(reply, 'validation_failed', 'Check the paging parameters.');

    const { limit, cursor } = query.data;
    const tenantId = session.tenantId as string;

    // Cursor is the last row's `updated_at`. Offsets skip a row when a quote is saved
    // mid-scroll, which on a busy account is every few seconds.
    //
    // ## Why the predicate is built rather than passed as a null
    //
    // The obvious form is `AND (? IS NULL OR q.updated_at < ?)`, passing `null` for the first
    // page. That works on SQLite and **fails on Postgres** with *"could not determine data type
    // of parameter $2"*: Postgres infers a parameter's type from its context, and a bare
    // `? IS NULL` gives it none. The same statement was a 500 on every first page load the
    // moment the driver was switched — found by running the suite against Postgres, not by
    // reading the SQL.
    //
    // Building the clause means the parameter list itself differs between the two cases, which
    // is the honest shape: a first page has no cursor, rather than a cursor that happens to be
    // null.
    const cursorClause = cursor === undefined ? '' : ' AND q.updated_at < ?';
    const params: (string | number)[] = [tenantId];
    if (cursor !== undefined) params.push(cursor);
    params.push(limit + 1);

    const rows = await db.all<{
      id: string;
      number: string;
      customer_name: string | null;
      site_json: string;
      status: string;
      current_revision: number;
      contract_cents: number | null;
      incomplete: number;
      updated_at: string;
    }>(
      `SELECT q.id, q.number, q.status, q.current_revision, q.contract_cents, q.incomplete,
              q.site_json, q.updated_at,
              TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS customer_name
         FROM quotes q
         LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.tenant_id = ?${cursorClause}
        ORDER BY q.updated_at DESC, q.id DESC
        LIMIT ?`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: QuoteListItem[] = page.map((row) => {
      const site = safeParse<{ suburb?: string }>(row.site_json, {});
      return {
        id: row.id,
        number: row.number,
        customerName: row.customer_name ?? '',
        siteSuburb: site.suburb ?? '',
        status: row.status as QuoteStatus,
        revision: row.current_revision,
        contractCents: row.contract_cents,
        incomplete: row.incomplete === 1,
        updatedAt: row.updated_at,
      };
    });

    return sendOk(reply, {
      items,
      nextCursor: hasMore && page.length > 0 ? (page[page.length - 1]?.updated_at ?? null) : null,
      total: null,
    });
  });

  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId', async (request, reply) => {
    // `cost:read` is not required to read the quote header: a viewer may see which
    // quote this is and what it is for. The price is the part that needs cost:read,
    // and it is omitted below rather than hidden by the client.
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    const quote = await db.get<{
      id: string;
      number: string;
      status: string;
      current_revision: number;
      contract_cents: number | null;
      incomplete: number;
      site_json: string;
      customer_json: string;
      config_json: string | null;
      price_json: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT q.id, q.number, q.status, q.current_revision, q.contract_cents, q.incomplete,
              q.site_json, q.created_at, q.updated_at,
              (SELECT r.customer_json FROM quote_revisions r
                WHERE r.quote_id = q.id AND r.revision = q.current_revision) AS customer_json,
              (SELECT r.config_json FROM quote_revisions r
                WHERE r.quote_id = q.id AND r.revision = q.current_revision) AS config_json,
              (SELECT r.price_json FROM quote_revisions r
                WHERE r.quote_id = q.id AND r.revision = q.current_revision) AS price_json
         FROM quotes q
        WHERE q.id = ? AND q.tenant_id = ?`,
      [request.params.quoteId, tenantId],
    );

    if (quote === null) return sendFail(reply, 'not_found', 'Not found.');

    /*
     * The building and the money, so a quote can be **re-opened for editing**.
     *
     * Without these, `QuoteEditor`'s `initial` prop had no caller: a saved quote could only be
     * looked at, never amended, so a second revision was unreachable and the "Save revision" branch
     * was dead code. Both are omitted for a viewer for the same reason the price is — `pricing`
     * carries the negotiated contract, which is the sell price, and a viewer's policy is "no cost,
     * no margin".
     */
    const canSeeCost = session.role !== 'viewer';

    return sendOk(reply, {
      id: quote.id,
      number: quote.number,
      status: quote.status as QuoteStatus,
      revision: quote.current_revision,
      /** Omitted entirely for a role without `cost:read` — not sent as null, because
       *  a null price is indistinguishable from an unpriced quote. */
      contractCents: canSeeCost ? quote.contract_cents : undefined,
      incomplete: quote.incomplete === 1,
      site: safeParse<Record<string, unknown>>(quote.site_json, {}),
      customer: quote.customer_json === null ? null : safeParse<Record<string, unknown>>(quote.customer_json, {}),
      ...(canSeeCost && quote.config_json !== null
        ? { config: safeParse<Record<string, unknown>>(quote.config_json, {}) }
        : {}),
      ...(canSeeCost && quote.price_json !== null
        ? { pricing: pricingInputsFromPrice(safeParse<Record<string, unknown>>(quote.price_json, {})) }
        : {}),
      createdAt: quote.created_at,
      updatedAt: quote.updated_at,
    });
  });

  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId/revisions', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const rows = await db.all(
      `SELECT r.id, r.revision, r.name, r.description, r.created_at, r.created_by_email,
              r.engine_version, r.contract_cents, r.total_cost_cents, r.total_mass_kg,
              r.mocked_lines, r.bom_hash, r.price_book_hash, r.price_json
         FROM quote_revisions r
        WHERE r.quote_id = ? AND r.tenant_id = ?
        ORDER BY r.revision DESC`,
      [request.params.quoteId, session.tenantId],
    );

    return sendOk(reply, { items: rows });
  });

  /**
   * Delete a quote.
   *
   * A **status**, not a row delete. The desktop removed the `.sqd` file; on the web that would
   * also destroy the record of what a customer was sent, and a hard delete is refused by the
   * append-only guard on revisions anyway. Marking the quote `deleted` takes it out of use and
   * keeps the audit trail, which is the difference between "deleted" and "deniable".
   */
  app.delete<{ Params: { quoteId: string } }>('/quotes/:quoteId', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    const quote = await db.get<{ id: string }>(
      'SELECT id FROM quotes WHERE id = ? AND tenant_id = ?',
      [request.params.quoteId, tenantId],
    );
    if (quote === null) return sendFail(reply, 'not_found', 'Not found.');

    await db.run('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?', [
      'deleted',
      now(),
      quote.id,
    ]);

    return sendOk(reply, { id: quote.id, status: 'deleted' });
  });

  /**
   * Rename a revision.
   *
   * The content is immutable — config, price and BOM are frozen and the append-only trigger
   * enforces it. `name` and `description` are labels written after the fact, and
   * `010_revision_label` narrows the trigger to allow exactly those. A field left out of the
   * body is left as it is.
   */
  app.patch<{ Params: { quoteId: string; revision: string } }>(
    '/quotes/:quoteId/revisions/:revision',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'quote:write');
      if (session === null) return;

      const body = parseBody(revisionMetadataRequest, request.body, reply);
      if (body === null) return;

      const revision = Number(request.params.revision);
      if (!Number.isInteger(revision) || revision < 1) {
        return sendFail(reply, 'not_found', 'Not found.');
      }

      const tenantId = session.tenantId as string;
      const existing = await db.get<{ id: string }>(
        `SELECT r.id FROM quote_revisions r
          JOIN quotes q ON q.id = r.quote_id
         WHERE r.quote_id = ? AND r.revision = ? AND q.tenant_id = ?`,
        [request.params.quoteId, revision, tenantId],
      );
      if (existing === null) return sendFail(reply, 'not_found', 'Not found.');

      // Allowed only because the frozen columns are unchanged.
      await db.run(
        `UPDATE quote_revisions
            SET name = COALESCE(?, name), description = COALESCE(?, description)
          WHERE quote_id = ? AND revision = ? AND tenant_id = ?`,
        [body.name ?? null, body.description ?? null, request.params.quoteId, revision, tenantId],
      );

      return sendOk(reply, { revision });
    },
  );

  /**
   * Copy a quote, as the desktop's "Copy All".
   *
   * The copy is an **independent quote**: its own number, its own revision 1, its own
   * idempotency key. Revisions are never shared between quotes — a later edit to one must not
   * move the other, and two quotes pointing at one frozen revision would make the second
   * unamendable.
   *
   * The current revision's content (config, price, BOM, customer, site) is copied verbatim,
   * including the frozen figures: a copy is a snapshot of what was quoted, not a re-price.
   */
  app.post<{ Params: { quoteId: string } }>('/quotes/:quoteId/copy', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    const source = await db.get<{
      id: string;
      number: string;
      current_revision: number;
      customer_id: string | null;
      contract_cents: number;
      incomplete: number;
      site_json: string;
    }>(
      `SELECT id, number, current_revision, customer_id, contract_cents, incomplete, site_json
         FROM quotes WHERE id = ? AND tenant_id = ?`,
      [request.params.quoteId, tenantId],
    );
    if (source === null) return sendFail(reply, 'not_found', 'Not found.');

    const revision = await db.get<{
      description: string;
      config_json: string;
      bom_json: string;
      members_json: string;
      price_json: string;
      issues_json: string;
      customer_json: string;
      company_json: string;
      provenance_json: string;
      config_hash: string;
      result_hash: string;
      bom_hash: string;
      price_book_hash: string;
      override_version: number;
      settings_version: number;
      engine_version: number;
      contract_cents: number;
      total_cost_cents: number;
      total_mass_kg: number;
      mocked_lines: number;
    }>(
      'SELECT * FROM quote_revisions WHERE quote_id = ? AND revision = ? AND tenant_id = ?',
      [source.id, source.current_revision, tenantId],
    );
    if (revision === null) return sendFail(reply, 'not_found', 'Not found.');

    const quoteId = newId();
    const revisionId = newId();
    const at = now();
    let createdNumber = '';

    await db.transaction(async (tx) => {
      const number = await nextQuoteNumber(tx, tenantId);
      createdNumber = number;
      await tx.run(
        `INSERT INTO quotes (id, tenant_id, number, customer_id, status, current_revision,
                             contract_cents, incomplete, site_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)`,
        [
          quoteId,
          tenantId,
          number,
          source.customer_id,
          source.contract_cents,
          source.incomplete,
          source.site_json,
          session.userId,
          at,
          at,
        ],
      );

      await tx.run(
        `INSERT INTO quote_revisions (
           id, quote_id, tenant_id, revision, name, description,
           config_json, bom_json, members_json, price_json, issues_json, customer_json, company_json, provenance_json,
           config_hash, result_hash, bom_hash, price_book_hash, override_version, settings_version,
           engine_version, contract_cents, total_cost_cents, total_mass_kg, mocked_lines,
           idempotency_key, created_by, created_by_email, created_at
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionId,
          quoteId,
          tenantId,
          `Copy of ${source.number}`,
          String(revision.description),
          revision.config_json,
          revision.bom_json,
          revision.members_json,
          revision.price_json,
          revision.issues_json,
          revision.customer_json,
          revision.company_json,
          revision.provenance_json,
          revision.config_hash,
          revision.result_hash,
          revision.bom_hash,
          revision.price_book_hash,
          revision.override_version,
          revision.settings_version,
          revision.engine_version,
          revision.contract_cents,
          revision.total_cost_cents,
          revision.total_mass_kg,
          revision.mocked_lines,
          `copy-${revisionId}`,
          session.userId,
          session.email,
          at,
        ],
      );
    });

    return sendOk(reply, { quoteId, quoteNumber: createdNumber, revision: 1 }, 201);
  });

  // `parseBody` is imported for the save route that follows in phase 5; keeping the
  // import used here avoids a dead-import warning while the route is being written.
  void parseBody;
}

/** Parse a JSON column, tolerating a value written by an older version. */
function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * The **pricing inputs** a saved revision was priced under, rebuilt from the frozen price view.
 *
 * A revision stores `price_json` as the *outputs* (`PriceView`: kit, contract, stages, and which of
 * the three the operator typed). The editor needs the *inputs* (`PricingInput`) to re-open the quote
 * without silently changing it. Most of them are recoverable exactly — the charges and the quote
 * rate are copied through, and an overridden figure becomes an override again rather than a derived
 * number the operator never chose.
 *
 * The two percentages are the one approximation: `PriceView` does not carry `depositPct`/
 * `progressPct`, only the resulting cents. They are recovered from the contract when it was not
 * overridden, and fall back to the company defaults (10 / 70) when it was — in which case the
 * override cents win anyway, so the percentages are inert.
 *
 * A field that is missing or the wrong type falls back rather than throwing: a revision written by
 * an older version must still open.
 */
function pricingInputsFromPrice(price: Record<string, unknown>): Record<string, unknown> {
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const overridden = (price.overridden ?? {}) as Record<string, unknown>;
  const contractCents = num(price.contractCents, 0);
  const depositCents = num(price.depositCents, 0);
  const progressCents = num(price.progressCents, 0);

  const contractOverridden = overridden.contract === true;
  const depositOverridden = overridden.deposit === true;
  const progressOverridden = overridden.progress === true;

  // Percentages are only meaningful when the figure was *derived* from them. When it was typed,
  // the override below wins and the percentage is inert, so a default is honest there.
  const depositPct =
    !depositOverridden && !contractOverridden && contractCents > 0
      ? Math.round((depositCents / contractCents) * 1000) / 10
      : 10;
  const progressPct =
    !progressOverridden && !contractOverridden && contractCents > 0
      ? Math.round((progressCents / contractCents) * 1000) / 10
      : 70;

  return {
    quoteRatePct: num(price.quoteRatePct, 0),
    depositPct,
    progressPct,
    deliveryCents: num(price.deliveryCents, 0),
    engineeringCents: num(price.engineeringCents, 0),
    extraCents: num(price.extraCents, 0),
    additionsCents: num(price.additionsCents, 0),
    // An overridden figure is restored as an override, never as a computed number: reopening a
    // negotiated quote must not quietly re-derive the price the customer agreed to.
    contractOverrideCents: contractOverridden ? contractCents : null,
    depositOverrideCents: depositOverridden ? depositCents : null,
    progressOverrideCents: progressOverridden ? progressCents : null,
  };
}
