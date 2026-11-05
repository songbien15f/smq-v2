/**
 * The materials list for a revision, as an Excel workbook.
 *
 * The BOM a customer is quoted is the same one a workshop buys from, so this is **not** part of the
 * customer document — the customer gets the plan and the price, and this sheet is for whoever has to
 * make the shed. It is therefore served to the company's own people, and it is the only route that
 * exposes unit costs and group subtotals. That is exactly why the gate is `cost:read`, not
 * `quote:read`: a viewer may read a quote but the policy says they see no cost, and this sheet is
 * cost.
 *
 * The workbook is built from the revision's frozen BOM, not re-priced: the figures are what the
 * quote stated, and a workbook that shows different numbers would be the one lie this product must
 * not tell.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { buildBomSheet, bomSheetFilename } from '@sq/core/documents';
import type { BomResult, BomGroup, BomLine } from '@sq/core/bom';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { loadFrozenRevision, RevisionNotFound } from '../lib/documents.js';

/** The BOM, reassembled from the frozen lines. */
function toBomResult(linesJson: string): BomResult {
  const lines = JSON.parse(linesJson || '[]') as (BomLine & { group: string })[];

  // The lines were flattened for storage; the engine's result is grouped. Rebuilding groups in
  // first-seen order keeps a sheet that was grouped in the engine reading grouped here too.
  const order: string[] = [];
  const byGroup = new Map<string, BomLine[]>();
  for (const line of lines) {
    if (!byGroup.has(line.group)) {
      order.push(line.group);
      byGroup.set(line.group, []);
    }
    byGroup.get(line.group)?.push(line);
  }

  const groups: BomGroup[] = order.map((id) => ({
    id: id as BomGroup['id'],
    label: id,
    lines: byGroup.get(id) ?? [],
  }));

  const all = lines;
  return {
    groups,
    buildingCost: all
      .filter((line) => line.group !== 'misc')
      .reduce((sum, line) => sum + line.amount, 0),
    totalCost: all.reduce((sum, line) => sum + line.amount, 0),
    totalMassKg: all.reduce((sum, line) => sum + line.massKg, 0),
    mockedLines: all.filter((line) => line.mocked === true).length,
  };
}

/**
 * The steelwork schedule for a revision.
 *
 * This is the desktop's "Steelwork Schedule / Member Size" report: one row per member with the
 * section the design chose, the cut length and the count. It is a workshop document, so it sits
 * behind `cost:read` with the BOM — the section sizes are the factory's design, not something a
 * reader of the customer quote is owed.
 *
 * It is read from the revision's frozen `members_json`, never recomputed: the same reason the BOM
 * is frozen. A newer price book or factory profile must not change the steel a sent quote was
 * built from.
 */
/**
 * The punching detail for a revision.
 *
 * The desktop's `PunchingDetailForm`: for each frame member, where the knee, haunch and apex holes
 * sit, the hole size and the punch centre. A workshop document, so `cost:read` with the BOM and the
 * steelwork schedule — hole positions are the factory's data, not the customer's.
 *
 * Read from `punchings_json`, never recomputed: the offsets come from the book's connector tables,
 * and a book revision must not change the sheet a member was already cut from. An empty list is a
 * sheet that is not printed — it means the book could not name the connectors — not a sheet with
 * guessed holes.
 */
function registerPunchings(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/punchings',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'cost:read');
      if (session === null) return;

      const revisionNumber = Number(request.params.rev);
      if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
        sendFail(reply, 'validation_failed', 'The revision number must be a positive whole number.');
        return;
      }

      const row = await db.get<{ punchings_json: string }>(
        `SELECT punchings_json FROM quote_revisions
          WHERE quote_id = ? AND tenant_id = ? AND revision = ?`,
        [request.params.quoteId, session.tenantId, revisionNumber],
      );
      if (row === null) {
        sendFail(reply, 'not_found', 'Not found.');
        return;
      }

      return sendOk(reply, { pages: JSON.parse(row.punchings_json || '[]') as unknown[] });
    },
  );
}

function registerMembers(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/members',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'cost:read');
      if (session === null) return;

      const revisionNumber = Number(request.params.rev);
      if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
        sendFail(reply, 'validation_failed', 'The revision number must be a positive whole number.');
        return;
      }

      const row = await db.get<{ members_json: string }>(
        `SELECT members_json FROM quote_revisions
          WHERE quote_id = ? AND tenant_id = ? AND revision = ?`,
        [request.params.quoteId, session.tenantId, revisionNumber],
      );
      if (row === null) {
        sendFail(reply, 'not_found', 'Not found.');
        return;
      }

      return sendOk(reply, { members: JSON.parse(row.members_json || '[]') as unknown[] });
    },
  );
}

export function registerBomExport(app: FastifyInstance, db: Db): void {
  registerMembers(app, db);
  registerPunchings(app, db);

  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/bom',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'cost:read');
      if (session === null) return;

      const revisionNumber = Number(request.params.rev);
      if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
        sendFail(reply, 'validation_failed', 'The revision number must be a positive whole number.');
        return;
      }

      let frozen;
      try {
        frozen = await loadFrozenRevision(db, {
          tenantId: session.tenantId as string,
          quoteId: request.params.quoteId,
          revision: revisionNumber,
        });
      } catch (error) {
        if (error instanceof RevisionNotFound) {
          sendFail(reply, 'not_found', 'Not found.');
          return;
        }
        throw error;
      }

      const revision = await db.get<{ bom_json: string }>(
        'SELECT bom_json FROM quote_revisions WHERE quote_id = ? AND tenant_id = ? AND revision = ?',
        [request.params.quoteId, session.tenantId, revisionNumber],
      );
      if (revision === null) {
        sendFail(reply, 'not_found', 'Not found.');
        return;
      }

      const bom = toBomResult(revision.bom_json);

      /*
       * CSV is the desktop's "BOM to CSV". It carries the same frozen figures as the
       * workbook — the sheet is a view of one BOM, not a second calculation.
       */
      const format = (request.query as { format?: string }).format;
      if (format === 'csv') {
        const rows: string[] = ['Group,Code,Description,Unit,Quantity,Unit cost,Mass (kg)'];
        for (const group of bom.groups) {
          for (const line of group.lines) {
            rows.push(
              [group.label, line.code, line.description, line.unit, line.quantity, (line.unitCost / 100).toFixed(2), line.massKg]
                .map(csvCell)
                .join(','),
            );
          }
        }
        rows.push(
          ['', '', 'Total', '', '', (bom.totalCost / 100).toFixed(2), bom.totalMassKg]
            .map(csvCell)
            .join(','),
        );

        return reply
          .status(200)
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="bom-${frozen.quoteNumber}-r${frozen.revision}.csv"`,
          )
          .send(rows.join('\r\n'));
      }

      const workbook = await buildBomSheet(bom, {
        quoteNumber: frozen.quoteNumber,
        revision: frozen.revision,
        issuedAt: frozen.createdAt,
        building: `${frozen.config.structureType} ${frozen.config.span / 1000} × ${frozen.config.length / 1000} × ${frozen.config.height / 1000} m`,
        companyName: frozen.company.name,
      });

      return reply
        .status(200)
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'content-disposition',
          `attachment; filename="${bomSheetFilename(frozen.quoteNumber, frozen.revision)}"`,
        )
        .send(workbook);
    },
  );
}

/** Re-exported so a caller has one place to look for a missing revision. */
export { RevisionNotFound };

/**
 * One CSV cell.
 *
 * Quoted when it contains a comma, a quote or a line break, with embedded quotes doubled — a
 * description such as `Downpipe, 90 mm` is the common case and would otherwise shift every
 * column after it.
 */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
