/**
 * The company's own prices, as a spreadsheet.
 *
 * ## Why this exists at all
 *
 * Every shed company buys from its own supplier, and a supplier's price list arrives as a
 * spreadsheet. Without a way to load it, a company on a different factory cannot use the product:
 * their whole list imports as "not matched" and vanishes. The importer in `@sq/core` was written
 * and tested for exactly this and then never wired to a route, so the capability existed in the
 * code and not in the product.
 *
 * ## Why it is two steps and not one
 *
 * An import writes prices that every future quote is built from, and the file comes from outside.
 * Applying it blind is how a company discovers a month later that a column was mis-mapped. So the
 * upload answers with a **preview** — every row, what would happen to it, and why — and nothing is
 * written until the operator confirms with the fingerprint that preview produced. The fingerprint is
 * what makes the confirmation honest: if the book or the company's own items changed between the two
 * calls, the preview is stale and the apply is refused rather than applied to a different world.
 *
 * ## What it deliberately does not do
 *
 * It never touches the shared price book. A company's prices are overrides and own items; the book
 * is the supplier's and is replaced wholesale by a publication, which is a different act with a
 * different permission.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import {
  buildTemplate,
  indexBook,
  normaliseDescription,
  pricesFingerprint,
  readSpreadsheet,
  type ImportPreview,
  type OwnItem,
} from '@sq/core/pricing';
import { openPublishedBook } from '@sq/core/pricing';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { activeBookHash, priceBooksDir } from '../lib/priceBook.js';

/** The largest sheet accepted, in bytes. A price list is thousands of rows, not a database dump. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** What the browser posts: the file as base64, because a JSON API has no multipart parser here. */
const uploadBody = {
  parse(input: unknown): { buffer: Buffer } | null {
    if (typeof input !== 'object' || input === null) return null;
    const record = input as Record<string, unknown>;
    const data = record.data;
    if (typeof data !== 'string' || data === '') return null;
    // A data URL is what `FileReader.readAsDataURL` produces; accept the bare base64 too.
    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    try {
      const buffer = Buffer.from(base64, 'base64');
      return buffer.length === 0 ? null : { buffer };
    } catch {
      return null;
    }
  },
};

/** The company's own catalogue items, as the importer wants them. */
async function ownItems(db: Db, tenantId: string): Promise<OwnItem[]> {
  const rows = await db.all<{
    source: string;
    name: string;
    code: string;
    description: string;
    unit: string;
    unit_cost_cents: number;
  }>(
    `SELECT source, name, code, description, unit, unit_cost_cents
       FROM company_catalogue_rows WHERE tenant_id = ? ORDER BY source, name`,
    [tenantId],
  );
  return rows.map((row) => ({
    source: row.source,
    name: row.name,
    code: row.code,
    description: row.description,
    unit: row.unit as OwnItem['unit'],
    unitCostCents: Number(row.unit_cost_cents),
  }));
}

/** The current override version for a company, creating version 1 when it has none. */
async function overrideVersion(db: Db, tenantId: string): Promise<number> {
  const row = await db.get<{ version: number }>(
    'SELECT MAX(version) AS version FROM price_overrides WHERE tenant_id = ?',
    [tenantId],
  );
  return Number(row?.version ?? 0);
}

/** What a preview looks like on the wire: the maps become plain objects. */
function previewView(preview: ImportPreview, fingerprint: string) {
  return {
    fingerprint,
    counts: preview.counts,
    rows: preview.rows,
  };
}

export function registerPriceImport(app: FastifyInstance, db: Db): void {
  /**
   * The template, ready to fill in.
   *
   * A template is not a nicety: without one, every company invents its own column names and the
   * first import fails on a header the operator had no way to know. This one carries the book's own
   * rows with their current prices, so the sheet starts from what the engine already knows.
   */
  app.get('/admin/prices/template', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const hash = await activeBookHash(db);
    if (hash === null) {
      return sendFail(
        reply,
        'not_configured',
        'No price book has been published yet, so there is nothing to build a template from.',
      );
    }

    const book = openPublishedBook(hash, priceBooksDir());
    try {
      const index = indexBook(book);
      const own = await ownItems(db, session.tenantId as string);
      const workbook = await buildTemplate(index, own);

      return reply
        .status(200)
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', 'attachment; filename="price-list-template.xlsx"')
        .send(workbook);
    } finally {
      book.close();
    }
  });

  /**
   * Read a sheet and report what it would do. **Writes nothing.**
   *
   * Every row comes back with its outcome, so the operator sees the four cases that matter before
   * committing: matched, ambiguous (two book rows could be meant), unmatched, and invalid. An
   * ambiguous row is never guessed — guessing is how a price lands on the wrong material.
   */
  app.post('/admin/prices/preview', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const body = uploadBody.parse(request.body);
    if (body === null) return sendFail(reply, 'validation_failed', 'Attach the spreadsheet file.');
    if (body.buffer.length > MAX_UPLOAD_BYTES) {
      return sendFail(reply, 'validation_failed', 'That file is larger than 8 MB. A price list is not that big.');
    }

    const hash = await activeBookHash(db);
    if (hash === null) {
      return sendFail(reply, 'not_configured', 'No price book has been published yet.');
    }

    const book = openPublishedBook(hash, priceBooksDir());
    try {
      const index = indexBook(book);
      const tenantId = session.tenantId as string;
      const own = await ownItems(db, tenantId);

      let preview: ImportPreview;
      try {
        preview = await readSpreadsheet(body.buffer, index, own);
      } catch (error) {
        // A sheet with no price column is the operator's mistake, not a server fault — say which
        // header is missing rather than answering 500.
        return sendFail(
          reply,
          'validation_failed',
          error instanceof Error ? error.message : 'That file could not be read as a spreadsheet.',
        );
      }

      // The fingerprint covers the book and the company's own items: if either moves between the
      // preview and the apply, the preview described a different world and must not be applied.
      const fingerprint = `${hash}:${pricesFingerprint(preview.toApply)}:${own
        .map((item) => `${item.source}/${item.name}=${item.unitCostCents}`)
        .join(',')}`;

      return sendOk(reply, previewView(preview, fingerprint));
    } finally {
      book.close();
    }
  });

  /**
   * Apply a preview the operator confirmed.
   *
   * `fingerprint` is the one the preview returned. A mismatch is a 409, not a silent apply: the
   * sheet was read against prices that have since changed, and writing it would set figures nobody
   * reviewed.
   */
  app.post('/admin/prices/apply', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'price:manage');
    if (session === null) return;

    const record = (request.body ?? {}) as Record<string, unknown>;
    if (typeof record.data !== 'string' || typeof record.fingerprint !== 'string') {
      return sendFail(reply, 'validation_failed', 'Attach the spreadsheet and the preview fingerprint.');
    }
    const fingerprint = record.fingerprint;

    const body = uploadBody.parse({ data: record.data });
    if (body === null) return sendFail(reply, 'validation_failed', 'Attach the spreadsheet file.');

    const hash = await activeBookHash(db);
    if (hash === null) {
      return sendFail(reply, 'not_configured', 'No price book has been published yet.');
    }

    const tenantId = session.tenantId as string;
    const book = openPublishedBook(hash, priceBooksDir());

    try {
      const index = indexBook(book);
      const own = await ownItems(db, tenantId);
      const preview = await readSpreadsheet(body.buffer, index, own);

      const fingerprint = `${hash}:${pricesFingerprint(preview.toApply)}:${own
        .map((item) => `${item.source}/${item.name}=${item.unitCostCents}`)
        .join(',')}`;

      if (fingerprint !== record.fingerprint) {
        return sendFail(
          reply,
          'conflict',
          'The prices changed after you previewed this sheet. Preview it again before applying.',
        );
      }

      const version = (await overrideVersion(db, tenantId)) + 1;
      const overrideId = newId();
      const at = now();

      await db.transaction(async (tx) => {
        // One override version per apply, so a quote can name the price set it was built from.
        await tx.run(
          `INSERT INTO price_overrides (id, tenant_id, version, created_at, created_by, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [overrideId, tenantId, version, at, session.userId, `Spreadsheet import, ${preview.counts.applied} row(s)`],
        );

        for (const [rowKey, unitCostCents] of preview.toApply) {
          await tx.run(
            `INSERT INTO price_row_overrides (override_id, tenant_id, row_key, unit_cost_cents, code_override, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?)
             ON CONFLICT (override_id, row_key) DO UPDATE SET
               unit_cost_cents = excluded.unit_cost_cents,
               updated_at = excluded.updated_at`,
            [overrideId, tenantId, rowKey, unitCostCents, at],
          );
        }

        // Own items are an **upsert**: an item the sheet does not mention is left alone. A sheet
        // that carried one new item once wiped every item the company had added before.
        //
        // The row is keyed on the **name the engine asks for** — the normalised description — not
        // the customer's SKU. A row keyed on a SKU sits in the table looking configured while every
        // quote falls back to an unpriced line, which is the failure this table exists to prevent.
        for (const item of preview.toCreate) {
          await tx.run(
            `INSERT INTO company_catalogue_rows
               (tenant_id, source, name, code, description, unit, unit_cost_cents, mass_kg, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (tenant_id, source, name) DO UPDATE SET
               code = excluded.code,
               description = excluded.description,
               unit = excluded.unit,
               unit_cost_cents = excluded.unit_cost_cents,
               updated_at = excluded.updated_at`,
            [
              tenantId,
              item.source,
              normaliseDescription(item.description),
              item.code,
              item.description,
              item.unit,
              item.unitCostCents,
              item.massKg,
              at,
            ],
          );
        }

        for (const removal of preview.toRemove) {
          await tx.run(
            'DELETE FROM company_catalogue_rows WHERE tenant_id = ? AND source = ? AND name = ?',
            [tenantId, removal.source, removal.name],
          );
        }
      });

      return sendOk(reply, { applied: true, version, counts: preview.counts });
    } finally {
      book.close();
    }
  });
}
