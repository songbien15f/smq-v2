/**
 * The quote document, served.
 *
 * Two representations of one page: HTML and PDF. Both are built through the same projection, so they
 * cannot disagree about what a customer was sent.
 *
 * ## Why the HTML is a download and not a page in the client app
 *
 * The document is a customer artefact with its own print layout. Rendering it inside the workspace
 * would put the workspace's own CSS around it, and the customer's copy would then look different from
 * the one the operator printed. It is served from here, standalone.
 *
 * ## Why PDF can legitimately answer 503
 *
 * PDF needs a Chromium. When none is installed the honest answer is "not configured, download the
 * HTML" — never a silent fallback to a different format, and never a blank page that looks like a
 * quote.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@sq/db';
import { renderQuoteHtml, renderPdf, readCachedPdf, writeCachedPdf, PdfUnavailableError } from '@sq/core/documents';
import { toCustomerDocument } from '@sq/core/documents';
import { clientIp, sendFail } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { loadFrozenRevision, renderFrozenHtml, RevisionNotFound, revisionDocumentKey } from '../lib/documents.js';

/** Where rendered PDFs live. Content-addressed by revision, so a re-download is cheap. */
function pdfCacheRoot(): string {
  // Resolved from the workspace root like every other configured path: `pnpm --filter` changes the
  // working directory, and a cache that lands in a package build directory is a cache nobody finds.
  return process.env.PDF_CACHE ?? './data/pdf-cache';
}

/** The Chromium to drive, or `undefined`. */
function chromePath(): string | undefined {
  const value = process.env.CHROME_PATH;
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** A filename a browser saves sensibly: quote number, customer, revision. */
function filenameFor(quoteNumber: string, revision: number, extension: string): string {
  const safe = quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe}-rev${revision}.${extension}`;
}

export function registerDocuments(app: FastifyInstance, db: Db): void {
  /**
   * The HTML document.
   *
   * `quote:read` is the gate, not `cost:read`: the document contains no cost, so a viewer who may
   * read a quote may read the page it becomes.
   */
  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/html',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'quote:read');
      if (session === null) return;

      const rendered = await buildHtml(db, session.tenantId as string, request, reply);
      if (rendered === null) return;

      return reply
        .status(200)
        .header('content-type', 'text/html; charset=utf-8')
        .header(
          'content-disposition',
          `inline; filename="${filenameFor(rendered.quoteNumber, rendered.revision, 'html')}"`,
        )
        .send(rendered.html);
    },
  );

  /** The same page as a PDF. */
  app.get<{ Params: { quoteId: string; rev: string } }>(
    '/quotes/:quoteId/revisions/:rev/pdf',
    async (request, reply) => {
      const session = requireCompanyCapability(request, reply, 'quote:read');
      if (session === null) return;

      const rendered = await buildHtml(db, session.tenantId as string, request, reply);
      if (rendered === null) return;

      const cached = readCachedPdf(pdfCacheRoot(), rendered.cacheKey);
      if (cached !== null) {
        return reply
          .status(200)
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `attachment; filename="${filenameFor(rendered.quoteNumber, rendered.revision, 'pdf')}"`,
          )
          .send(cached);
      }

      try {
        const pdf = await renderPdf(rendered.html, { executablePath: chromePath() });
        writeCachedPdf(pdfCacheRoot(), rendered.cacheKey, pdf);

        return reply
          .status(200)
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `attachment; filename="${filenameFor(rendered.quoteNumber, rendered.revision, 'pdf')}"`,
          )
          .send(pdf);
      } catch (error) {
        if (error instanceof PdfUnavailableError) {
          // A deployment fact, not a bad request: the operator fixes it by installing Chromium.
          return sendFail(reply, 'not_configured', error.message);
        }
        throw error;
      }
    },
  );
}

/**
 * Load, project and render, or send the failure and return `null`.
 *
 * Takes `db` explicitly rather than closing over it: this function is also used by the share route,
 * which has its own scope, and a closure over one route's `db` would work by accident today and fail
 * the moment the two are registered with different connections.
 */
async function buildHtml(
  db: Db,
  tenantId: string,
  request: FastifyRequest<{ Params: { quoteId: string; rev: string } }>,
  reply: FastifyReply,
): Promise<{ html: string; quoteNumber: string; revision: number; cacheKey: string } | null> {
  const revisionNumber = Number(request.params.rev);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    sendFail(reply, 'validation_failed', 'The revision number must be a positive whole number.');
    return null;
  }

  try {
    const frozen = await loadFrozenRevision(db, {
      tenantId,
      quoteId: request.params.quoteId,
      revision: revisionNumber,
    });

    return {
      html: await renderFrozenHtml(frozen),
      quoteNumber: frozen.quoteNumber,
      revision: frozen.revision,
      cacheKey: revisionDocumentKey(frozen),
    };
  } catch (error) {
    if (error instanceof RevisionNotFound) {
      sendFail(reply, 'not_found', 'Not found.');
      return null;
    }
    throw error;
  }
}

/** Exported for the share route, which renders the same page from a token rather than a session. */
export { buildHtml as renderRevisionHtmlForShare };
export { pdfCacheRoot, chromePath, filenameFor };
export { clientIp };
