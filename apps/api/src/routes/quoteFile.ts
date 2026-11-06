/**
 * The legacy `.sqd` quote file: export a quote, and read one back.
 *
 * ## Why a web product still speaks this format
 *
 * `.sqd` is the file the desktop app wrote, one per quote. A company leaving this product, or a
 * quote that has to reach somebody still on the desktop, must arrive as a file that app can open —
 * otherwise the data is trapped. The reader has existed in `@sq/core` and was never wired to
 * anything; the writer did not exist at all.
 *
 * ## Why export is plain JSON and not the legacy AES
 *
 * The desktop's own reader auto-detects: a file starting with `{` is parsed as JSON, and only
 * otherwise is it decrypted. So plaintext is the one format both sides read without sharing a
 * hardcoded key — and that key is obfuscation, not encryption, so writing with it would add
 * ceremony and no secrecy.
 *
 * ## Why import does not create a quote directly
 *
 * A `.sqd` carries a whole building the desktop computed, including prices from a book this build
 * may not have. Importing it as a *quote* would record figures the engine never produced. So the
 * import answers with what the file contains — its revisions, quote number, company and the money
 * the file states — and leaves the decision to a person. Refusing a `BinaryFormatter` file with an
 * explanation is part of that: a half-read quote is worse than a refusal.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { readQuoteFileBytes, writeQuoteFile, type WritableRevision } from '@sq/core/quoteFile';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';

/** The largest file accepted, in bytes. A quote is kilobytes; this is generous. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Read a base64 body into a buffer, or `null`. */
function decode(input: unknown): Buffer | null {
  if (typeof input !== 'object' || input === null) return null;
  const data = (input as Record<string, unknown>).data;
  if (typeof data !== 'string' || data === '') return null;
  const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  try {
    const buffer = Buffer.from(base64, 'base64');
    return buffer.length === 0 ? null : buffer;
  } catch {
    return null;
  }
}

export function registerQuoteFile(app: FastifyInstance, db: Db): void {
  /**
   * Export a quote as a `.sqd` file.
   *
   * Built from the **frozen revisions**, not from a fresh evaluation: the file must carry the
   * figures the customer was sent, and a re-price would put this month's book into a document that
   * says last month's date.
   */
  app.get<{ Params: { quoteId: string } }>('/quotes/:quoteId/export/sqd', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return;

    const tenantId = session.tenantId as string;
    const quote = await db.get<{ number: string }>(
      'SELECT number FROM quotes WHERE id = ? AND tenant_id = ?',
      [request.params.quoteId, tenantId],
    );
    if (quote === null) return sendFail(reply, 'not_found', 'Not found.');

    const revisions = await db.all<{
      revision: number;
      name: string;
      description: string;
      contract_cents: number;
      price_json: string;
      company_json: string;
      created_at: string;
    }>(
      `SELECT revision, name, description, contract_cents, price_json, company_json, created_at
         FROM quote_revisions
        WHERE quote_id = ? AND tenant_id = ?
        ORDER BY revision ASC`,
      [request.params.quoteId, tenantId],
    );

    if (revisions.length === 0) {
      return sendFail(
        reply,
        'conflict',
        'This quote has no saved revisions, so there is nothing to export. Save it first.',
      );
    }

    const writable: WritableRevision[] = revisions.map((row) => {
      const price = safeParse(row.price_json, {});
      const company = safeParse(row.company_json, {});
      const cents = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) ? value / 100 : 0;

      return {
        revision: Number(row.revision),
        name: row.name || `Revision ${row.revision}`,
        description: row.description,
        companyName: typeof company.name === 'string' ? company.name : '',
        companyCode: typeof company.abn === 'string' ? company.abn : '',
        quoteNumber: quote.number,
        // The file format stores dollars; the database stores cents.
        contractPrice: cents(price.contractCents ?? Number(row.contract_cents)),
        deposit: cents(price.depositCents),
        progress: cents(price.progressCents),
        balance: cents(price.balanceCents),
        createdAt: row.created_at,
        lastEdited: row.created_at,
      };
    });

    const bytes = writeQuoteFile({ revisions: writable });

    return reply
      .status(200)
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${quote.number}.sqd"`)
      .send(bytes);
  });

  /**
   * Read a `.sqd` file and report what it contains. **Creates nothing.**
   *
   * The answer is the file's own claims — its revisions and the money it states — so a person can
   * see what they are holding before deciding whether to re-key it. A `BinaryFormatter` file is
   * refused with the reason rather than half-read.
   */
  app.post('/quotes/import/sqd', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:write');
    if (session === null) return;

    const bytes = decode(request.body);
    if (bytes === null) return sendFail(reply, 'validation_failed', 'Attach the .sqd file.');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return sendFail(reply, 'validation_failed', 'That file is larger than 4 MB. A quote file is not that big.');
    }

    const file = readQuoteFileBytes(bytes);

    if (file.refusal !== undefined) {
      // A format this build cannot read is the operator's problem to understand, not a 500.
      return sendFail(reply, 'validation_failed', file.refusal);
    }

    return sendOk(reply, {
      format: file.format,
      /*
       * What the file claims about itself, and what to do about each answer.
       *
       * `absent` is normal — a file from the old desktop makes no claim — so it is not an error.
       * `invalid` is the one that matters: the file states a digest and does not match it, which
       * means somebody edited it after it was written. The two digests come back so the operator
       * can compare against a copy they trust.
       */
      integrity: file.integrity ?? 'absent',
      ...(file.integrityDetail === undefined ? {} : { integrityDetail: file.integrityDetail }),
      revisions: file.revisions.map((revision) => ({
        revision: revision.RevisionId ?? null,
        name: revision.RevisionName ?? '',
        description: revision.RevisionDescription ?? '',
        quoteNumber: revision.QuoteNumber ?? '',
        companyName: revision.CompanyName ?? '',
        // Dollars, as the file states them. Not converted: the caller is showing the file's own
        // claim, and converting would invite a comparison between two units.
        contractPrice: revision.ContractPrice ?? null,
        deposit: revision.QuoteDeposite ?? null,
        progress: revision.QuotePayment ?? null,
        balance: revision.QuoteBalance ?? null,
        lastEdited: revision.QuoteLastEdited ?? null,
      })),
    });
  });
}

/** Parse a JSON column, tolerating a value written by an older version. */
function safeParse(json: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}
