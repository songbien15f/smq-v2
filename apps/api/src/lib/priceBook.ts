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

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
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
 * The open SQLite handle for a book.
 *
 * `openBook` returns the lookup, which is all the pricing path needs. The catalogue
 * reader needs the raw tables, so this exposes the same cached handle rather than
 * opening a second connection to an immutable file. It throws `BookMissingError`
 * for a hash that is not on disk, exactly as `openBook` does.
 */
export function openBookDatabase(hash: string): ReturnType<typeof openPublishedBook> {
  openBook(hash);
  const entry = openBooks.get(hash);
  if (entry === undefined) {
    throw new BookMissingError(`The price book ${hash.slice(0, 12)}… could not be opened.`);
  }
  return entry.db;
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
 * Copy a book's file into Postgres, so the bytes survive a lost volume.
 *
 * Idempotent: `ON CONFLICT DO NOTHING`, because republishing the same dump is the same hash and the
 * stored bytes cannot change — a book is immutable. A missing file is **not** an error here: the
 * publish path has just written it, and the boot backfill deliberately tolerates a book whose file
 * somebody deleted (it logs and moves on, because refusing to start would be worse than a warning).
 */
export async function storeBookBytes(db: AppDb, hash: string): Promise<boolean> {
  const path = join(priceBooksDir(), `${hash}.db`);
  if (!existsSync(path)) return false;

  const bytes = readFileSync(path);
  const fileSha256 = createHash('sha256').update(bytes).digest('hex');

  await db.run(
    `INSERT INTO price_book_files (hash, file_sha256, bytes, size_bytes, stored_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (hash) DO NOTHING`,
    /*
     * `new Uint8Array(bytes)` rather than the Buffer itself: under `@types/node` 26 a Buffer is a
     * `NonSharedBuffer`, which the driver's `SqlValue` does not name. A plain view over the same
     * memory binds identically and keeps the driver's type honest about what it accepts.
     */
    [hash, fileSha256, new Uint8Array(bytes), bytes.length, new Date().toISOString()],
  );
  return true;
}

/**
 * Make sure a book is on disk, restoring it from Postgres when it is not.
 *
 * `openBook` and the engine are synchronous, so this runs **before** they are called, from the routes
 * that need a book (DECISIONS D2: Postgres is the source of the bytes, disk is a cache).
 *
 * Three rules, each earning its place:
 *
 * 1. **A file already there is left alone.** Re-writing it on every request would be a 3 MB write per
 *    evaluation, and the file is immutable — if it exists it is the right file.
 * 2. **The bytes are verified before they are written.** `file_sha256` is checked against what came
 *    back from the database, so a corrupted row cannot become a file the engine then trusts. A
 *    mismatch throws and writes nothing.
 * 3. **The write is a rename.** `<hash>.db.tmp` then `renameSync`, which is atomic on every platform
 *    this runs on, so two requests racing cannot leave a half-written book where a complete one is
 *    expected.
 */
export async function ensureBookOnDisk(db: AppDb, hash: string): Promise<void> {
  const dir = priceBooksDir();
  const path = join(dir, `${hash}.db`);
  if (existsSync(path)) return;

  const row = await db.get<{ file_sha256: string; bytes: Uint8Array }>(
    'SELECT file_sha256, bytes FROM price_book_files WHERE hash = ?',
    [hash],
  );
  if (row === null) {
    // Same answer the old code gave for a missing file, with the road that leads out of it.
    throw new BookMissingError(
      `The active price book (${hash.slice(0, 12)}…) is neither on disk nor stored in the database. ` +
        'Publish it again.',
    );
  }

  const bytes = Buffer.from(row.bytes);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== row.file_sha256) {
    throw new BookMissingError(
      `The stored bytes for the price book (${hash.slice(0, 12)}…) do not match their recorded digest. ` +
        'Nothing was written to disk. Publish the book again from its dump.',
    );
  }

  mkdirSync(dir, { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, bytes);
  try {
    renameSync(temp, path);
  } catch (error) {
    // A rename over an existing file fails on Windows; if somebody else won the race, their file is
    // the same immutable book, so treat that as success rather than an error.
    if (!existsSync(path)) throw error;
  }
}

/**
 * Copy every published book that is on disk into Postgres.
 *
 * Run at boot rather than behind a script: a deployment that upgrades and then never runs the script
 * is a deployment whose books are still only on the volume. A book whose file is gone is **logged and
 * skipped**, not thrown — refusing to start because one old book's file was removed is worse than
 * starting with the rest stored.
 */
export async function backfillBookBytes(db: AppDb): Promise<number> {
  const rows = await db.all<{ hash: string }>(
    `SELECT b.hash FROM price_books b
      WHERE NOT EXISTS (SELECT 1 FROM price_book_files f WHERE f.hash = b.hash)`,
  );

  let stored = 0;
  for (const row of rows) {
    if (await storeBookBytes(db, row.hash)) stored += 1;
  }
  return stored;
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
  /*
   * The bytes go into Postgres **before** the book is recorded as active. If this fails, the publish
   * fails: a book that only exists on this container's disk is the state that lost every evaluation
   * when the volume went away, and the point of this step is that it cannot happen again.
   */
  await storeBookBytes(db, published.hash);
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
