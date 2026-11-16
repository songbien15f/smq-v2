import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publishPriceBook } from '@sq/core/pricing';
import { makeTestApp, seedCompany, signIn, testConfig, type TestApp } from './helpers';

/**
 * The price book's bytes in Postgres (DECISIONS D2).
 *
 * The failure these tests exist for: `pg_dump` did not contain the book, so losing the volume — or
 * starting a second instance against the same database — left `openBook` throwing and **every
 * evaluation failing**. The file is now a cache of bytes stored in the database.
 *
 * These run only when the price dump is present. Without it there is no book to publish, and a test
 * that skipped silently for a missing fixture would be a test nobody notices is not running.
 */

function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

const ROOT = workspaceRoot();
const DUMP = resolve(ROOT, 'tools', 'price-dump', 'out');
const hasDump = existsSync(join(DUMP, 'cost_frame.json'));

describe.skipIf(!hasDump)('price book bytes in the database', () => {
  let ctx: TestApp;
  let cookie: string;
  let booksDir: string;
  const originalBooks = process.env.PRICE_BOOKS;
  let hash = '';

  const bookFile = (): string => join(booksDir, `${hash}.db`);

  beforeAll(async () => {
    booksDir = mkdtempSync(join(tmpdir(), 'sq-bookbytes-'));
    process.env.PRICE_BOOKS = booksDir;
    publishPriceBook(DUMP, booksDir);

    ctx = await makeTestApp(testConfig());
    await seedCompany(ctx.db, {
      name: 'Book Bytes Sheds',
      slug: 'book-bytes',
      email: 'owner@bookbytes.test',
      password: 'a-long-enough-password',
      role: 'company_admin',
    });
    cookie = await signIn(ctx.app, 'owner@bookbytes.test', 'a-long-enough-password');

    const { publishAndActivate } = await import('../lib/priceBook');
    const published = await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test',
      publishedByEmail: 'test@vendor',
    });
    hash = published.hash;
  });

  afterAll(async () => {
    const { closeAllBooks } = await import('../lib/priceBook');
    await ctx.close();
    // Windows keeps an open SQLite handle and then refuses the directory removal.
    closeAllBooks();
    if (originalBooks === undefined) delete process.env.PRICE_BOOKS;
    else process.env.PRICE_BOOKS = originalBooks;
    rmSync(booksDir, { recursive: true, force: true });
  });

  it('stores the file on publish, with a digest of the bytes', async () => {
    const row = await ctx.db.get<{ file_sha256: string; size_bytes: number }>(
      'SELECT file_sha256, size_bytes FROM price_book_files WHERE hash = ?',
      [hash],
    );
    expect(row).not.toBeNull();

    const bytes = readFileSync(bookFile());
    expect(row?.size_bytes).toBe(bytes.length);
    expect(row?.file_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('restores the file from the database when disk has lost it', async () => {
    /*
     * Called directly rather than through `/evaluate`.
     *
     * The first version of this test went through the route and accepted 422 as a pass, which proved
     * nothing: a 422 means the request never reached the book at all, so the restore never ran and the
     * assertion was reading the absence of work as success. The function under test is the restore, so
     * the test calls it.
     */
    const { closeAllBooks, ensureBookOnDisk } = await import('../lib/priceBook');
    // Close the open handle first: on Windows an open SQLite file cannot be deleted.
    closeAllBooks();
    unlinkSync(bookFile());
    expect(existsSync(bookFile())).toBe(false);

    await ensureBookOnDisk(ctx.db, hash);

    expect(existsSync(bookFile())).toBe(true);
    // Byte-for-byte: the digest recorded at publish time is what came back out.
    const restored = createHash('sha256').update(readFileSync(bookFile())).digest('hex');
    const row = await ctx.db.get<{ file_sha256: string }>(
      'SELECT file_sha256 FROM price_book_files WHERE hash = ?',
      [hash],
    );
    expect(restored).toBe(row?.file_sha256);
  });

  it('leaves an existing file alone instead of rewriting it on every call', async () => {
    // Re-writing 3 MB per evaluation would be absurd, and the file is immutable: if it exists it is
    // the right file.
    const { ensureBookOnDisk } = await import('../lib/priceBook');
    const before = readFileSync(bookFile()).length;
    await ensureBookOnDisk(ctx.db, hash);
    expect(readFileSync(bookFile()).length).toBe(before);
  });

  it('refuses to write a file whose bytes do not match the recorded digest', async () => {
    const { closeAllBooks, ensureBookOnDisk } = await import('../lib/priceBook');
    closeAllBooks();
    if (existsSync(bookFile())) unlinkSync(bookFile());

    // A corrupted row must not become a file the engine then trusts.
    await ctx.db.run('UPDATE price_book_files SET bytes = ? WHERE hash = ?', [
      new Uint8Array([1, 2, 3, 4]),
      hash,
    ]);

    await expect(ensureBookOnDisk(ctx.db, hash)).rejects.toThrow(/do not match their recorded digest/i);
    // Nothing was written, so nothing downstream can read the corrupted bytes.
    expect(existsSync(bookFile())).toBe(false);
  });

  it('publishing the same dump twice keeps one row', async () => {
    const { publishAndActivate, closeAllBooks } = await import('../lib/priceBook');
    // Restore a good row first: the previous test corrupted it on purpose.
    closeAllBooks();
    await ctx.db.run('DELETE FROM price_book_files WHERE hash = ?', [hash]);
    publishPriceBook(DUMP, booksDir);
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test',
      publishedByEmail: 'test@vendor',
    });
    await publishAndActivate(ctx.db, {
      dumpDir: DUMP,
      publishedByUserId: 'test',
      publishedByEmail: 'test@vendor',
    });

    const rows = await ctx.db.all<{ n: number }>(
      'SELECT COUNT(*) AS n FROM price_book_files WHERE hash = ?',
      [hash],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
