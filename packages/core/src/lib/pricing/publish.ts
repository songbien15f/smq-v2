/**
 * Publishing a price book as an immutable, content-addressed snapshot.
 *
 * The importer used to rewrite one live `pricing.db` in place, one table per
 * transaction. Two things were wrong with that for a quoting product:
 *
 * 1. **A quote that is already saved must never change price.** Re-importing a
 *    new book under a revision that is being printed is exactly how a customer
 *    receives a number nobody approved.
 * 2. **A hash of file names and byte lengths is not a fingerprint.** Editing
 *    `1.00` to `1.01` keeps the length, so the old importer reported "the same
 *    dump". A publication hashes the bytes.
 *
 * So a publication is: validate every table into a staging database, hash the
 * dump's **contents**, write `<root>/<hash>.db`, and only then move the active
 * pointer. A failure at any step leaves the previous book active and readable.
 * Old books are never deleted — a revision's provenance names the hash it was
 * priced with, and that hash has to keep resolving.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from './sqliteRuntime.js';
import { importPriceBook } from './import';
import { applyPriceSchema } from './schema';

/** A published, immutable book. */
export interface PublishedBook {
  /** SHA-256 of the dump's contents, hex. Also the file's name. */
  hash: string;
  /** The directory holding `<hash>.db`. */
  root: string;
  /** Objects that could not be imported, by name. */
  skipped: string[];
}

const ACTIVE_FILE = 'active.json';

/** The sorted list of dump files, by name. */
function dumpFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

/**
 * A hash of the dump's **contents**.
 *
 * File name and bytes, in sorted order, so two dumps with the same tables in the
 * same order hash the same and any byte change hashes differently.
 */
function contentHash(dir: string): string {
  const hash = createHash('sha256');
  for (const file of dumpFiles(dir)) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** A temporary file beside its target, renamed into place only when complete. */
function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

/**
 * Publish `dumpDir` under `root`, returning the book that is now active.
 *
 * Throws when the dump cannot be imported at all — an unreadable file, a table
 * that is not an array, or a dump with no tables. In every failure case the
 * previously active book stays active and its file is untouched.
 */
export function publishPriceBook(dumpDir: string, root: string): PublishedBook {
  if (!existsSync(dumpDir)) throw new Error(`No such dump directory: ${dumpDir}`);
  const files = dumpFiles(dumpDir);
  if (files.length === 0) throw new Error(`The dump at ${dumpDir} has no tables`);

  const hash = contentHash(dumpDir);
  mkdirSync(root, { recursive: true });
  const target = join(root, `${hash}.db`);

  // Already published: the file is immutable, so reuse it rather than rewriting
  // it under a reader. Only the pointer needs to move.
  if (!existsSync(target)) {
    // Stage into a temporary file, then rename. A half-written database never
    // becomes visible under a hash.
    const staging = join(root, `${hash}.staging.db`);
    for (const leftover of [staging, `${staging}-wal`, `${staging}-shm`]) {
      if (existsSync(leftover)) rmFile(leftover);
    }

    const db = new DatabaseSync(staging);
    let skipped: string[];
    let importedTables: number;
    try {
      db.exec('PRAGMA journal_mode = WAL');
      applyPriceSchema(db);
      const report = importPriceBook(db, dumpDir);
      skipped = report.skipped;
      importedTables = report.tables.filter((table) => table.rows > 0).length;
      // The importer hashed names and lengths; this book's identity is the hash
      // of its contents, so that is what the book records about itself.
      db.prepare("UPDATE price_book_meta SET value = ? WHERE key = 'source_hash'").run(hash);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${staging}${suffix}`)) rmFile(`${staging}${suffix}`);
    }
    // A dump that produced no readable table is not a price book. Publishing it
    // would move the pointer to an empty book and silently unprice every quote.
    if (importedTables === 0) {
      rmFile(staging);
      throw new Error(`The dump at ${dumpDir} produced no importable table`);
    }
    renameSync(staging, target);

    writeAtomic(
      join(root, `${hash}.meta.json`),
      JSON.stringify({ hash, skipped, publishedAt: Date.now() }),
    );
  }

  writeAtomic(join(root, ACTIVE_FILE), JSON.stringify({ hash }));

  const metaPath = join(root, `${hash}.meta.json`);
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { skipped: string[] })
    : { skipped: [] };

  return { hash, root, skipped: meta.skipped };
}

/** Remove a file, tolerating a reader holding it on Windows. */
function rmFile(path: string): void {
  rmSync(path, { force: true });
}

/** The hash of the active book, or `null` when nothing has been published. */
export function readActiveBookHash(root: string): string | null {
  const path = join(root, ACTIVE_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hash?: unknown };
    return typeof parsed.hash === 'string' ? parsed.hash : null;
  } catch {
    return null;
  }
}

/**
 * Whether the active book is the sample or a licensed one.
 *
 * Read from the book's own metadata, and **defaulting to `'licensed'`** for every
 * failure: a missing flag, an unreadable book, a book published before the flag
 * existed. The value decides whether a stranger may see a price list, so the only
 * safe default is the one that hides it.
 */
export function readActiveBookKind(root: string): 'sample' | 'licensed' {
  const hash = readActiveBookHash(root);
  return hash === null ? 'licensed' : bookKind(hash, root);
}

/**
 * Every column of a book, for a scan that must not miss one.
 *
 * Shared by the leak check below and by the mock generator's test, so "which
 * columns might hold a code" is answered in one place. A hand-written list is how
 * the first scramble missed three columns: `cost_frame.plain_code`,
 * `roller_door.rdoor_code_color` and `skylight.skylight_productCode` — camelCase,
 * and one that is not called a code at all.
 */
export function bookColumns(db: DatabaseSync): { table: string; column: string }[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all() as { name: string }[];
  const columns: { table: string; column: string }[] = [];
  for (const table of tables) {
    if (table.name.startsWith('sqlite_') || table.name === 'price_book_meta') continue;
    for (const column of db.prepare(`PRAGMA table_info("${table.name}")`).all() as {
      name: string;
    }[]) {
      columns.push({ table: table.name, column: column.name });
    }
  }
  return columns;
}

/**
 * A supplier code this build can recognise.
 *
 * The distributor prefixes the book uses. It is a heuristic and cannot be perfect —
 * a code the prefix list does not know would pass — but it catches the family this
 * product is built around, which is what matters for "may this be shown publicly".
 */
const SUPPLIER_CODE = /^(FBI|FBD|FBT|FBM|FP5|FFP|FPC|FDC|FP2|FFT|FFR|FBL|BA2)[A-Z0-9]{3,}$/;

/**
 * How many cells in this book look like a real supplier code.
 *
 * ## Why a label is not enough
 *
 * `book_kind=sample` is a claim the book makes about itself, and one book on disk
 * makes it **falsely**: it was scrambled by the first version of the generator,
 * which missed three columns, so it carries 1,488 real codes while declaring itself
 * safe. A demo gate that trusted the label would have waved through the most
 * dangerous book in the directory.
 *
 * So the check reads the data. It is slower — one scan of a 3 MB file — and it is
 * only run where a decision depends on it (an operator activating a book, and the
 * demo refusal below), never on a page load.
 */
export function countSupplierCodes(db: DatabaseSync): number {
  let found = 0;
  for (const { table, column } of bookColumns(db)) {
    let rows: Record<string, unknown>[];
    try {
      rows = db
        .prepare(`SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`)
        .all() as Record<string, unknown>[];
    } catch {
      // A column type this build cannot select is not a code column.
      continue;
    }
    for (const row of rows) {
      if (SUPPLIER_CODE.test(String(row.value ?? '').trim().toUpperCase())) found += 1;
    }
  }
  return found;
}

/**
 * Whether this book may be shown to an anonymous visitor.
 *
 * Both conditions, and the order matters: the label is checked first because it is
 * cheap, then the data because the label has lied before. `sample` with real codes
 * is refused.
 */
export function isDemoSafeBook(hash: string, root: string): { safe: boolean; reason: string } {
  if (bookKind(hash, root) !== 'sample') {
    return { safe: false, reason: 'it is a licensed supplier catalogue, not a sample' };
  }
  let db: DatabaseSync | null = null;
  try {
    db = openPublishedBook(hash, root);
    const leaks = countSupplierCodes(db);
    if (leaks > 0) {
      return {
        safe: false,
        reason: `it says it is a sample but still contains ${leaks.toLocaleString('en-AU')} supplier codes`,
      };
    }
    return { safe: true, reason: 'sample' };
  } catch (error) {
    return {
      safe: false,
      reason: `it could not be read (${error instanceof Error ? error.message : 'unknown error'})`,
    };
  } finally {
    db?.close();
  }
}

/**
 * Whether one published book is the scrambled sample or a licensed one.
 *
 * Separate from `readActiveBookKind` because a caller that is about to **activate**
 * a book needs to know what that book is, not what the current one is. Assuming a
 * book is licensed because the active one is would let a sample be swapped for a
 * licensed book with no check at all.
 *
 * Fails closed: an unreadable book or a missing key reads as `licensed`, so a
 * corrupt file cannot be mistaken for the safe one.
 *
 * This reads only the **label**. Use `isDemoSafeBook` for a decision about whether
 * a book may be served publicly.
 */
export function bookKind(hash: string, root: string): 'sample' | 'licensed' {
  let db: DatabaseSync | null = null;
  try {
    db = openPublishedBook(hash, root);
    const row = db
      .prepare("SELECT value FROM price_book_meta WHERE key = 'book_kind'")
      .get() as { value: string } | undefined;
    return row?.value === 'sample' ? 'sample' : 'licensed';
  } catch {
    return 'licensed';
  } finally {
    db?.close();
  }
}

/** Open a published book read-only. The caller closes it. */
export function openPublishedBook(hash: string, root: string): DatabaseSync {
  const path = join(root, `${hash}.db`);
  if (!existsSync(path)) throw new Error(`No published price book ${hash} under ${root}`);
  return new DatabaseSync(path, { readOnly: true });
}

/** One published book, as the admin page lists it. */
export interface BookSummary {
  hash: string;
  /** True for the book every new evaluation resolves against. */
  active: boolean;
  publishedAt: number | null;
  /** Bytes on disk, so an operator can tell a full book from a stub. */
  sizeBytes: number;
  /** Tables that imported with rows, and the rows in total. */
  tableCount: number;
  rowCount: number;
  /** Objects the importer could not create, by name. */
  skipped: string[];
}

/**
 * Every published book, newest first.
 *
 * Read from the directory rather than from a table: a publication *is* its file,
 * and a book someone copied in by hand should appear here too. A file whose meta
 * is missing or unreadable is still listed — with `null` dates and zero counts —
 * because hiding it would make a broken publication invisible exactly when an
 * operator needs to see it.
 */
export function listPublishedBooks(root: string): BookSummary[] {
  if (!existsSync(root)) return [];
  const activeHash = readActiveBookHash(root);

  return readdirSync(root)
    .filter((file) => file.endsWith('.db') && !file.includes('.staging.'))
    .map((file) => {
      const hash = file.slice(0, -3);
      const metaPath = join(root, `${hash}.meta.json`);
      let publishedAt: number | null = null;
      let skipped: string[] = [];
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
            publishedAt?: unknown;
            skipped?: unknown;
          };
          publishedAt = typeof meta.publishedAt === 'number' ? meta.publishedAt : null;
          skipped = Array.isArray(meta.skipped) ? (meta.skipped as string[]) : [];
        } catch {
          // A corrupt meta must not hide the book.
        }
      }

      let sizeBytes = 0;
      try {
        sizeBytes = statSync(join(root, file)).size;
      } catch {
        sizeBytes = 0;
      }

      // Counts come from the book's own `price_book_meta.row_counts`, written by
      // the importer. Reading every table to count would open and scan a
      // megabyte per book on a page load.
      let tableCount = 0;
      let rowCount = 0;
      try {
        const db = new DatabaseSync(join(root, file), { readOnly: true });
        try {
          const row = db
            .prepare("SELECT value FROM price_book_meta WHERE key = 'row_counts'")
            .get() as { value: string } | undefined;
          if (row !== undefined) {
            const counts = JSON.parse(row.value) as Record<string, number>;
            const values = Object.values(counts).filter((n) => typeof n === 'number' && n > 0);
            tableCount = values.length;
            rowCount = values.reduce((sum, n) => sum + n, 0);
          }
        } finally {
          db.close();
        }
      } catch {
        tableCount = 0;
        rowCount = 0;
      }

      return {
        hash,
        active: hash === activeHash,
        publishedAt,
        sizeBytes,
        tableCount,
        rowCount,
        skipped,
      };
    })
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

/**
 * Point the active book at an already-published one.
 *
 * The file is immutable, so activating is a pointer move and nothing else. A
 * hash with no file is refused: moving the pointer to a book that does not exist
 * would unprice every quote with no way back through the UI.
 */
export function activateBook(hash: string, root: string): void {
  const path = join(root, `${hash}.db`);
  if (!existsSync(path)) throw new Error(`No published price book ${hash}`);
  writeAtomic(join(root, ACTIVE_FILE), JSON.stringify({ hash }));
}
