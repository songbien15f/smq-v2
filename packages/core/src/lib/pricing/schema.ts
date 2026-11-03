/**
 * The price book's own schema.
 *
 * Only the meta table is declared here. Every other table is created by the
 * importer from the dump's own JSON, because the dump already knows each table's
 * columns — declaring 75 tables by hand would be a second source of truth that
 * drifts the moment the client's price book gains a column.
 */

import type { DatabaseSync } from 'node:sqlite';

/** Bumped when the meta layout changes. */
export const PRICE_SCHEMA_VERSION = 1;

/** The keys the importer writes into `price_book_meta`. */
export const PRICE_META_KEYS = [
  'imported_at',
  'source_file',
  'source_hash',
  'row_counts',
  /**
   * `'sample'` or `'licensed'`.
   *
   * A sample book is the mock built by `make-mock-price-book.ts`: every price
   * moved 10–30%, structure unchanged. It exists so a demo can be shown without
   * the licensed supplier book ever leaving an operator's machine.
   *
   * **This flag decides what a stranger may see.** The demo workspace shows a
   * read-only price list, which is the best evidence the product has that a
   * company's prices are its own — and showing it is only safe while the book is
   * a sample. Recorded at publish time rather than inferred from the path: a
   * directory name is a convention, and a convention is not a guarantee.
   */
  'book_kind',
] as const;

export const PRICE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS price_book_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Create the meta table. Imported tables are created by the importer. */
export function applyPriceSchema(db: DatabaseSync): void {
  db.exec(PRICE_SCHEMA_SQL);
}
