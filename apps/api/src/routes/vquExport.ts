/**
 * The `.vqu` export: a saved revision in the shape the external BOM tool reads.
 *
 * The file itself is built in `@sq/core/domain` and tested there. This route supplies the two
 * things core cannot know: the **customer and site** of this revision, and the **colour names**
 * the book uses for the stored hex values. A `.vqu` that states `#bdbfba` instead of `Shale Grey`
 * is a file the tool cannot match.
 *
 * ISO-8859-1, because that is what the desktop wrote and what the tool reads.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { buildVqu } from '@sq/core/domain';
import { sendFail } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { loadFrozenRevision, RevisionNotFound } from '../lib/documents.js';
import { activeBookHash, openBook } from '../lib/priceBook.js';

export function registerVquExport(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/export/vqu',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'cost:read');
      if (session === null) return;

      const revisionNumber = Number(request.params.rev);
      if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
        return sendFail(reply, 'validation_failed', 'The revision number must be a positive whole number.');
      }

      const tenantId = session.tenantId as string;
      let frozen;
      try {
        frozen = await loadFrozenRevision(db, {
          tenantId,
          quoteId: request.params.quoteId,
          revision: revisionNumber,
        });
      } catch (error) {
        if (error instanceof RevisionNotFound) return sendFail(reply, 'not_found', 'Not found.');
        throw error;
      }

      const siteRow = await db.get<{ site_json: string }>(
        'SELECT site_json FROM quotes WHERE id = ? AND tenant_id = ?',
        [request.params.quoteId, tenantId],
      );
      const site = (() => {
        try {
          return JSON.parse(siteRow?.site_json ?? '{}') as {
            address?: string;
            suburb?: string;
            state?: string;
            postcode?: string;
          };
        } catch {
          return {};
        }
      })();

      const hash = await activeBookHash(db);
      if (hash === null) {
        return sendFail(reply, 'not_configured', 'No price book has been published yet.');
      }
      const { lookup } = openBook(hash);

      const colourName = (hex: string): string => {
        try {
          return lookup.colourName(hex) ?? '';
        } catch {
          return '';
        }
      };

      const miscOptions = frozen.config.options
        .filter((option): option is Extract<typeof option, { kind: 'misc_option' }> => option.kind === 'misc_option')
        .map((option) => option.name)
        .filter((name) => name.trim() !== '');

      const text = buildVqu({
        quoteNumber: frozen.quoteNumber,
        customer: {
          name: `${frozen.customer.firstName} ${frozen.customer.lastName}`.trim(),
          postcode: frozen.customer.postcode ?? '',
          siteStreet: site.address ?? '',
          siteState: site.state ?? '',
          siteSuburb: site.suburb ?? '',
          sitePostcode: site.postcode ?? '',
        },
        config: frozen.config,
        colors: {
          wall: colourName(frozen.config.colors.wall),
          roof: colourName(frozen.config.colors.roof),
          barge: colourName(frozen.config.colors.barge),
          gutter: colourName(frozen.config.colors.gutter),
          downpipe: colourName(frozen.config.colors.downpipe),
          rollerDoor: colourName(frozen.config.colors.rollerDoor),
          slidingDoor: colourName(frozen.config.colors.slidingDoor),
          window: colourName(frozen.config.colors.window),
          paDoor: colourName(frozen.config.colors.paDoor),
          dividingWall: colourName(frozen.config.colors.dividingWall),
        },
        miscOptions,
      });

      return reply
        .status(200)
        .header('content-type', 'text/plain; charset=iso-8859-1')
        .header(
          'content-disposition',
          `attachment; filename="${frozen.quoteNumber}-r${frozen.revision}.vqu"`,
        )
        .send(Buffer.from(text, 'latin1'));
    },
  );
}
