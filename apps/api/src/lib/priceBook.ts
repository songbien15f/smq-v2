/**
 * The price book, from the API's side.
 *
 * A book is a **content-addressed, immutable SQLite file** named by the SHA-256 of the dump it
 * was built from. Publishing the same dump twice produces the same hash and reuses the file, so
 * "which book priced this quote" is answerable from the hash alone — and a saved revision
 * records that hash, which is what makes an old quote's figures explainable a year later.
 *
 * ## Why this lives here rather than in `@sq/core`
 *
 * The publishing *logic* is in core (`publish.ts`) and is pure file work. This module is the
 * API's cache around it: it holds the open handle so a request does not re-open the file, and it
 * reads the active book from the database rather than from `active.json`, because the database
 * is what survives a redeploy of the container.
 *
 * **One book per installation.** This product runs for one company, so there is no per-tenant
 * book and no per-tenant activation; the `price_book_active` singleton row is the whole story.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Db as AppDb } from '@sq/db';
import { openPublishedBook, publishPriceBook, bookKind, countSupplierCodes } from '@sq/core/pricing';
import { createLookup } from '@sq/core/pricing';
import type { PriceLookup } from '@sq/core/pricing';

/** The open books, by hash, so a request does not re-open the file. */
const openBooks = new Map<string, { db: ReturnType<typeof openPublishedBook>; lookup: PriceLookup }>();

/** Where published books live. Relative paths resolve from the workspace root. */
export function priceBooksDir(): string {
  return resolve(process.cwd(), process.env.PRICE_BOOKS ?? './data/price-books');
}

/** One published book, as the admin screen shows it. */
export interface PriceBookSummary {
  hash: string;
  kind: 'sample' | 'licensed';
  active: boolean;
  supplierCodeCount: number;
  publishedAt: string | null;
  note: string | null;
}

/** The active book's hash, or `null` before one has been published. */
export async function activeBookHash(db: AppDb): Promise<string | null> {
  const row = await db.get<{ hash: string }>('SELECT hash FROM price_book_active LIMIT 1');
  return row?.hash ?? null;
}

/**
 * Open a book and its lookup, caching both.
 *
 * The cache is keyed on the hash, which is the book's identity, so a republish cannot serve a
 * stale lookup: a different file is a different hash.
 */
export function openBook(hash: string): { lookup: PriceLookup; close: () => void } {
  const cached = openBooks.get(hash);
  if (cached !== undefined) {
    return { lookup: cached.lookup, close: () => undefined };
  }

  const path = resolve(priceBooksDir(), `${hash}.db`);
  if (!existsSync(path)) {
    throw new BookMissingError(
      `The active price book (${hash.slice(0, 12)}…) is not on disk at ${path}. Publish it again, or restore the file.`,
    );
  }

  const db = openPublishedBook(hash, priceBooksDir());
  const lookup = createLookup(db);
  openBooks.set(hash, { db, lookup });

  // The handle stays open for the process's life: a book is immutable, so there is nothing to
  // release early, and reopening it per request would be slower than the query it serves.
  return { lookup, close: () => undefined };
}

/** Raised when the database names a book that is not on disk. */
export class BookMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookMissingError';
  }
}

/**
 * Close every open book.
 *
 * Called on shutdown, and by a test that published into a temporary directory — an open SQLite
 * handle makes `rmSync` fail with EPERM on Windows, which is a confusing way to learn that a
 * process leaked a file descriptor. A book is immutable, so nothing is lost by closing it; the
 * next request opens it again.
 */
export function closeAllBooks(): void {
  for (const [hash, entry] of openBooks) {
    try {
      entry.db.close();
    } catch {
      /* already closed */
    }
    openBooks.delete(hash);
  }
}

/**
 * Publish a dump directory and make it active.
 *
 * The **dump's own marker** decides `kind`, and the result is checked rather than trusted: a book
 * labelled `sample` that still contains supplier codes is refused for a demo, because a label is
 * a claim and the codes are the fact. See `countSupplierCodes`.
 */
export async function publishAndActivate(
  db: AppDb,
  input: { dumpDir: string; publishedByUserId: string; publishedByEmail: string; note?: string },
): Promise<PriceBookSummary> {
  const dir = priceBooksDir();
  mkdirSync(dir, { recursive: true });

  const published = publishPriceBook(input.dumpDir, dir);
  const kind = bookKind(published.hash, dir);

  // Scan every column of every table rather than trusting the label. A sample book that carries
  // real codes is how a supplier's price list ends up on a prospect's screen.
  const db2 = openPublishedBook(published.hash, dir);
  let supplierCodes = 0;
  let tableCount = 0;
  let rowCount = 0;
  try {
    supplierCodes = countSupplierCodes(db2);
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    tableCount = tables.length;
    for (const table of tables) {
      const row = db2.prepare(`SELECT COUNT(*) AS n FROM "${table.name}"`).get() as { n: number } | undefined;
      rowCount += Number(row?.n ?? 0);
    }
  } finally {
    db2.close();
  }

  if (kind === 'sample' && supplierCodes > 0) {
    throw new Error(
      `This book declares itself a sample but still contains ${supplierCodes} supplier code(s). ` +
        'It was not activated: a sample whose codes are real is the same leak with a label on it.',
    );
  }

  // Republishing the same dump is the same hash, so the row is an update rather than a second row.
  await db.run(
    `INSERT INTO price_books (hash, kind, published_at, published_by, published_by_email, table_count, row_count, supplier_code_count, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hash) DO UPDATE SET
       kind = excluded.kind,
       supplier_code_count = excluded.supplier_code_count,
       table_count = excluded.table_count,
       row_count = excluded.row_count,
       note = excluded.note`,
    [
      published.hash,
      kind,
      new Date().toISOString(),
      input.publishedByUserId,
      input.publishedByEmail,
      tableCount,
      rowCount,
      supplierCodes,
      input.note ?? null,
    ],
  );

  await db.run(
    `INSERT INTO price_book_active (id, hash, activated_at, activated_by)
     VALUES ('singleton', ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET hash = excluded.hash, activated_at = excluded.activated_at, activated_by = excluded.activated_by`,
    [published.hash, new Date().toISOString(), input.publishedByUserId],
  );

  // Drop the cached lookup for the book being replaced. It is immutable, so a cached handle is
  // still *correct*, but holding every published book open is a file handle per publication.
  for (const hash of openBooks.keys()) {
    if (hash !== published.hash) openBooks.delete(hash);
  }

  return {
    hash: published.hash,
    kind,
    active: true,
    supplierCodeCount: supplierCodes,
    publishedAt: new Date().toISOString(),
    note: input.note ?? null,
  };
}

/** Every published book, with the active one marked. */
export async function listBooks(db: AppDb): Promise<PriceBookSummary[]> {
  const active = await activeBookHash(db);
  const rows = await db.all<{
    hash: string;
    kind: string;
    published_at: string;
    supplier_code_count: number;
    note: string | null;
  }>(
    `SELECT hash, kind, published_at, supplier_code_count, note
       FROM price_books ORDER BY published_at DESC`,
  );

  return rows.map((row) => ({
    hash: row.hash,
    kind: row.kind === 'sample' ? 'sample' : 'licensed',
    active: row.hash === active,
    supplierCodeCount: Number(row.supplier_code_count),
    publishedAt: row.published_at,
    note: row.note,
  }));
}

/** Hash a value into a stable string, for comparing a config a browser sent with the one priced. */
export function canonicalHash(value: unknown): string {
  const stable = (input: unknown): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'null';
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
    return `{${entries.join(',')}}`;
  };
  return createHash('sha256').update(stable(value)).digest('hex');
}
