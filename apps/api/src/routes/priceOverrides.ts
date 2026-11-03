/**
 * Price overrides, read and edited from the admin app.
 *
 * ## Why a read route was the missing half
 *
 * `price_row_overrides` and `company_catalogue_rows` were **written** by the price list import and
 * never read by any route. A vendor could not answer "what prices has this company overridden?" — and
 * until the evaluate route was wired, the overrides did not affect a quote either. Both halves are
 * needed: a screen that edits rows nobody can see is as useless as a table nobody reads.
 *
 * ## Why editing creates a new version rather than updating in place
 *
 * A revision records the version it was priced under. Editing version 3 in place would change what an
 * already-saved quote claims to have been priced from — the frozen revision would still hold the
 * numbers, but the version it names would no longer mean what it did. So every edit **supersedes**:
 * the new row set is written as a new version, and the old one stays readable.
 *
 * ## Why deleting a version is allowed but deleting the last one is careful
 *
 * An operator who imports a bad spreadsheet needs to undo it. Deleting the newest version rolls back
 * to the one before, which is exactly the undo they want. Deleting **every** version returns the
 * company to the shared book, which is also legitimate — but it is a different act, so it is a
 * separate explicit route rather than a side effect.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { z } from 'zod';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability, requirePlatformCapability } from '../lib/guard.js';

/** Set one row's price. Creates a new version; never edits an existing one. */
const setPriceRequest = z
  .object({
    rowKey: z.string().trim().min(1).max(400),
    /** Whole cents. `null` removes the override and lets the book's price show through. */
    unitCostCents: z.number().int().min(0).max(100_000_000).nullable(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

/** A version as the database stores it. */
interface VersionDbRow {
  id: string;
  version: number;
  created_at: string;
  created_by: string | null;
  note: string | null;
  row_count: number;
}

/** A version as a screen reads it, with its rows. */
interface VersionRow {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  rowCount: number;
  rows: OverrideRow[];
}

/** The row as the database stores it. */
interface OverrideDbRow {
  row_key: string;
  unit_cost_cents: number;
  code_override: string | null;
  updated_at: string;
}

/** The row as a screen reads it. */
interface OverrideRow {
  rowKey: string;
  unitCostCents: number;
  codeOverride: string | null;
  updatedAt: string;
}

export function registerPriceOverrides(app: FastifyInstance, db: Db): void {
  /**
   * A company's overrides, version by version.
   *
   * A company user sees their own; a platform administrator names the company. The scope decision is
   * made from the session, so a company cannot read another's prices by editing a URL.
   */
  app.get('/prices/overrides', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    return sendOk(reply, await overridesFor(db, tenantId));
  });

  /** The same, for a named company, so a vendor can answer a support call. */
  app.get<{ Params: { tenantId: string } }>('/admin/companies/:tenantId/prices/overrides', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:companies');
    if (session === null) return;

    return sendOk(reply, await overridesFor(db, request.params.tenantId));
  });

  /**
   * Set, change or clear one row's price.
   *
   * A write always produces a **new version** — see the note at the top of this file for why editing in
   * place would corrupt what a frozen revision means.
   */
  app.put('/prices/overrides', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const body = parseBody(setPriceRequest, request.body, reply);
    if (body === null) return;

    const tenantId = session.tenantId as string;
    const result = await supersede(db, {
      tenantId,
      userId: session.userId,
      change: body,
    });

    return sendOk(reply, result);
  });

  /** Delete one version, rolling back to the previous one. */
  app.delete<{ Params: { versionId: string } }>('/prices/overrides/:versionId', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    const row = await db.get<{ version: number }>(
      'SELECT version FROM price_overrides WHERE id = ? AND tenant_id = ?',
      [request.params.versionId, tenantId],
    );
    if (row === null) return sendFail(reply, 'not_found', 'Not found.');

    await db.transaction(async (tx) => {
      // The rows cascade on the foreign key, but deleting them explicitly keeps this correct on a
      // database restored without the constraint.
      await tx.run('DELETE FROM price_row_overrides WHERE override_id = ? AND tenant_id = ?', [
        request.params.versionId,
        tenantId,
      ]);
      await tx.run('DELETE FROM price_overrides WHERE id = ? AND tenant_id = ?', [
        request.params.versionId,
        tenantId,
      ]);
    });

    return sendOk(reply, { deleted: true, version: Number(row.version) });
  });

  /** Return the company to the shared book by removing every version it has. */
  app.delete('/prices/overrides', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM price_row_overrides WHERE tenant_id = ?', [tenantId]);
      await tx.run('DELETE FROM price_overrides WHERE tenant_id = ?', [tenantId]);
    });

    return sendOk(reply, { cleared: true });
  });
}

/** Every version for a company, newest first, each with its rows. */
async function overridesFor(
  db: Db,
  tenantId: string,
): Promise<{ versions: VersionRow[]; custom: unknown[] }> {
  const versions = await db.all<VersionDbRow>(
    `SELECT o.id, o.version, o.created_at, o.created_by, o.note,
            (SELECT COUNT(*) FROM price_row_overrides r WHERE r.override_id = o.id) AS row_count
       FROM price_overrides o
      WHERE o.tenant_id = ?
      ORDER BY o.version DESC`,
    [tenantId],
  );

  const out: VersionRow[] = [];
  for (const version of versions) {
    const rows = await db.all<OverrideDbRow>(
      `SELECT row_key, unit_cost_cents, code_override, updated_at
         FROM price_row_overrides WHERE override_id = ? AND tenant_id = ?
        ORDER BY row_key`,
      [version.id, tenantId],
    );
    out.push({
      id: version.id,
      version: Number(version.version),
      createdAt: version.created_at,
      createdBy: version.created_by,
      note: version.note,
      rowCount: Number(version.row_count),
      rows: rows.map((row) => ({
        rowKey: row.row_key,
        unitCostCents: Number(row.unit_cost_cents),
        codeOverride: row.code_override,
        updatedAt: row.updated_at,
      })),
    });
  }

  const custom = await db.all(
    `SELECT source, name, code, description, unit, unit_cost_cents, updated_at
       FROM company_catalogue_rows WHERE tenant_id = ? ORDER BY source, name`,
    [tenantId],
  );

  return { versions: out, custom };
}

/**
 * Write a new version containing the previous rows plus the one change.
 *
 * Copying forward rather than mutating is what makes an edit reversible and a revision's recorded
 * version stable. It also means one override can be removed without clearing the rest, which is the
 * common case: a single material was mispriced.
 */
async function supersede(
  db: Db,
  input: {
    tenantId: string;
    userId: string;
    change: { rowKey: string; unitCostCents: number | null; note?: string };
  },
): Promise<{ version: number; rowCount: number; removed: boolean }> {
  const at = now();

  return db.transaction(async (tx) => {
    const latest = await tx.get<{ version: number; id: string }>(
      'SELECT version, id FROM price_overrides WHERE tenant_id = ? ORDER BY version DESC LIMIT 1',
      [input.tenantId],
    );

    const previous =
      latest === null
        ? []
        : await tx.all<{ row_key: string; unit_cost_cents: number; code_override: string | null }>(
            'SELECT row_key, unit_cost_cents, code_override FROM price_row_overrides WHERE override_id = ?',
            [latest.id],
          );

    // Carry every existing row forward, then apply the change. Removing the last row leaves an empty
    // version rather than deleting the chain: an empty version is a readable fact ("this company has
    // no overrides from version N"), while a missing version is indistinguishable from a bug.
    const next = new Map(previous.map((row) => [row.row_key, { cost: Number(row.unit_cost_cents), code: row.code_override }]));
    if (input.change.unitCostCents === null) next.delete(input.change.rowKey);
    else next.set(input.change.rowKey, { cost: input.change.unitCostCents, code: null });

    const version = (latest === null ? 0 : Number(latest.version)) + 1;
    const id = newId();

    await tx.run(
      `INSERT INTO price_overrides (id, tenant_id, version, created_at, created_by, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.tenantId, version, at, input.userId, input.change.note ?? null],
    );

    for (const [rowKey, entry] of next) {
      await tx.run(
        `INSERT INTO price_row_overrides (override_id, tenant_id, row_key, unit_cost_cents, code_override, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.tenantId, rowKey, entry.cost, entry.code, at],
      );
    }

    return { version, rowCount: next.size, removed: input.change.unitCostCents === null };
  });
}
