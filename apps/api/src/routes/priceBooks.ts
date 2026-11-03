/**
 * Price books, from the administrator's side.
 *
 * Two routes, and the split between them is the point:
 *
 * - **Publish** builds an immutable content-addressed book from a dump directory and makes it
 *   active. It is the only thing that changes what every quote in the product costs.
 * - **List** shows what has been published, with the supplier-code count so the operator can see
 *   for themselves that a sample book contains no real catalogue.
 *
 * ## Why publishing is not just "point at a file"
 *
 * A book is the supplier's price list. Two things must be true before it can price a customer's
 * quote: it must be structurally readable (the engine asks for tables by name), and it must be
 * *allowed to be shown* — a book labelled a sample that still carries real supplier codes is the
 * same leak with a label on it. Both are checked here rather than trusted, and a book that fails
 * is refused rather than activated with a warning.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { parseBody, sendFail, sendOk } from '../lib/http.js';
import { requirePlatformCapability } from '../lib/guard.js';
import {
  BookMissingError,
  activeBookHash,
  listBooks,
  publishAndActivate,
  priceBooksDir,
} from '../lib/priceBook.js';

/** The workspace root, so a relative dump path means the same thing wherever the API was started. */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

/**
 * Resolve a configured dump directory.
 *
 * Absolute paths are taken as given — a deployment puts the dump wherever it likes. A relative
 * path starts at the workspace root, never at the caller's cwd: `pnpm --filter` runs a script
 * inside a package directory, so cwd-relative resolution would find a different directory from
 * the CLI than from the running server, and the error would name a path nobody configured.
 */
function resolveDumpDir(value: string): string {
  return isAbsolute(value) ? value : resolve(workspaceRoot(), value);
}

/** Publish a dump directory and make it active. */
const publishRequest = z.object({
  /** The directory holding the dump's JSON files. Relative paths resolve from the repo root. */
  dumpDir: z.string().trim().min(1, 'Enter the dump directory.'),
  /** A note for the audit trail: which supplier revision this is, and when it arrived. */
  note: z.string().trim().max(500).optional(),
});

export function registerPriceBooks(app: FastifyInstance, db: Db): void {
  app.get('/admin/price-books', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:pricebooks');
    if (session === null) return;

    const books = await listBooks(db);
    const active = await activeBookHash(db);

    return sendOk(reply, {
      books,
      activeHash: active,
      /** Where the files live, so an operator can find them without reading the source. */
      directory: priceBooksDir(),
    });
  });

  app.post('/admin/price-books', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:pricebooks');
    if (session === null) return;

    const body = parseBody(publishRequest, request.body, reply);
    if (body === null) return;

    try {
      // The dump path is resolved from the workspace root, like every other configured path in
      // this product. `pnpm --filter` runs inside a package directory, so a path relative to the
      // caller's cwd would resolve differently for the CLI and for the running API.
      const published = await publishAndActivate(db, {
        dumpDir: resolveDumpDir(body.dumpDir),
        publishedByUserId: session.userId,
        publishedByEmail: session.email,
        ...(body.note === undefined ? {} : { note: body.note }),
      });

      // Audited in the same breath as the change: publishing a book moves the price of every
      // quote in the product, and "who did that, and when" must be answerable.
      await db.run(
        `INSERT INTO audit_events (id, at, actor_id, actor_email, action, target_type, target_id, summary)
         VALUES (?, ?, ?, ?, 'pricebook.publish', 'price_book', ?, ?)`,
        [
          crypto.randomUUID(),
          new Date().toISOString(),
          session.userId,
          session.email,
          published.hash,
          `Published and activated a ${published.kind} book (${published.supplierCodeCount} supplier codes). ${body.note ?? ''}`.trim(),
        ],
      );

      return sendOk(reply, published, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Three refusals worth naming rather than returning a 500 for: a missing directory, a dump
      // that cannot be read, and a sample book that still carries real codes.
      if (/ENOENT|no such file|not found/i.test(message)) {
        return sendFail(reply, 'validation_failed', `That directory could not be read: ${message}`);
      }
      if (/sample but still contains/i.test(message)) {
        return sendFail(reply, 'conflict', message);
      }
      throw error;
    }
  });

  app.get('/admin/price-books/active', async (request, reply) => {
    const session = requirePlatformCapability(request, reply, 'platform:pricebooks');
    if (session === null) return;

    const hash = await activeBookHash(db);
    if (hash === null) {
      return sendFail(
        reply,
        'not_configured',
        'No price book is active, so nothing can be priced. Publish one.',
      );
    }
    return sendOk(reply, { hash });
  });
}

/** Re-exported so a caller handling a missing book has one place to look. */
export { BookMissingError };
