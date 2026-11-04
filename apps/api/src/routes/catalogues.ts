/**
 * The price book's dropdown catalogues, for the editor.
 *
 * The desktop's Step 1 and Step 2 forms read every list — colours, miscellaneous
 * options, engineering charges, structure options, profiles, footing types, delivery
 * scopes and the size hints — from the book. This route is the one place the client
 * gets them, so a supplier changing a list changes the form without a deploy.
 *
 * `:id` is a book hash or the literal `active`. The client asks for `active`
 * because it does not know the hash until a quote is priced, and an operator
 * changing a colour should not have to.
 *
 * A missing book is a deployment state, not a bad request: `not_configured`
 * (503) says "publish a price book", which is what the operator must do. A hash
 * that names a file which is not on disk is a conflict (409) — the database and
 * the filesystem disagree.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { createSqliteCatalogueSource } from '@sq/core/pricing';
import { sendFail, sendOk } from '../lib/http.js';
import { requireCompanyCapability } from '../lib/guard.js';
import { BookMissingError, activeBookHash, openBookDatabase } from '../lib/priceBook.js';

export function registerCatalogues(scope: FastifyInstance, db: Db): void {
  scope.get('/price-books/:id/catalogues', async (request, reply) => {
    const session = requireCompanyCapability(request, reply, 'quote:read');
    if (session === null) return reply;

    const id = (request.params as { id: string }).id;
    const hash = id === 'active' ? await activeBookHash(db) : id;

    if (hash === null) {
      return sendFail(reply, 'not_configured', 'No price book has been published yet.');
    }

    try {
      const catalogue = createSqliteCatalogueSource(openBookDatabase(hash)).load();
      return sendOk(reply, { bookHash: hash, catalogue });
    } catch (error) {
      if (error instanceof BookMissingError) return sendFail(reply, 'conflict', error.message);
      throw error;
    }
  });
}
