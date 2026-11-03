// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * The mock book carries no real supplier code.
 *
 * ## Why this is a test and not a review
 *
 * The first pass at scrambling covered the columns whose names contain `code` and
 * left two behind: `cost_frame.plain_code`, and `roller_door.rdoor_code_color`
 * beside `rdoor_code`, and `skylight.skylight_productCode` in camel case. None of
 * them is read by any query, so nothing failed — the book simply still contained a
 * distributor's codes, which is the leak the scrambling exists to prevent.
 *
 * A list of columns maintained by hand is a list that goes stale the first time a
 * dump adds one. This test reads the built book and looks for the *shape* of a
 * real code, so a column nobody thought of is caught the next time the book is
 * built.
 */

/** The prefixes the licensed supplier's SKUs use. */
const REAL_CODE = /^(FBI|FBD|FBT|FBM|FP5|FFP|FPC|FDC|FP2|FFT|FFR|FBL|BA2)[A-Z0-9]{3,}$/;

/**
 * The workspace root, so the dump is found whether the suite runs from this
 * package or from the repository root.
 *
 * The dump lives at `<root>/tools/price-dump/out` and is git-ignored, so a
 * checkout without it skips these tests rather than failing them — but a run that
 * *has* the dump must read the same file in both directories, or the mock would be
 * compared against a different book than it was built from.
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

const DUMP_DIR = join(workspaceRoot(), 'tools', 'price-dump', 'out');

/** Build the mock book into a scratch directory, once, for every test here. */
function buildMock(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-mock-'));
  execFileSync('npx', ['tsx', 'scripts/make-mock-price-book.ts', '--out', dir], {
    cwd: process.cwd(),
    stdio: 'pipe',
    shell: true,
  });
  return dir;
}

describe('the sample price book', () => {
  const dir = buildMock();
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));

  it('replaced every supplier code, in every column, of every table', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const rows = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const column of Object.keys(rows[0] as object)) {
        const hit = (rows as Record<string, unknown>[]).find((row) =>
          REAL_CODE.test(String(row[column] ?? '')),
        );
        if (hit !== undefined) leaks.push(`${file.replace('.json', '')}.${column} (e.g. ${hit[column]})`);
      }
    }
    // Named, not counted: "1 column leaks" does not say which one to fix.
    expect(leaks).toEqual([]);
  });

  it('keeps the placeholder order identical to the real code order', () => {
    // The lookup breaks ties on `ORDER BY code`. A scramble that reordered them
    // would change which of two same-sized rows wins, and the mock would price a
    // different building than the real book — quantity changes, not prices, which
    // is the one thing this book must never do.
    for (const [table, column] of [
      ['cost_frame', 'code'],
      ['roller_door', 'rdoor_code'],
      ['cost_sheeting', 'code'],
    ] as const) {
      const mock = JSON.parse(readFileSync(join(dir, `${table}.json`), 'utf8')) as Record<
        string,
        unknown
      >[];
      const real = JSON.parse(
        readFileSync(join(DUMP_DIR, `${table}.json`), 'utf8'),
      ) as Record<string, unknown>[];

      const rank = (rows: Record<string, unknown>[]): string[] =>
        [...new Set(rows.map((row) => String(row[column] ?? '')).filter((c) => c !== ''))].sort();

      // Same number of distinct codes, and the same row carries the same rank.
      const mockOrder = rank(mock);
      const realOrder = rank(real);
      expect(mockOrder.length, `${table}.${column} distinct count`).toBe(realOrder.length);

      const mockRank = new Map(mockOrder.map((code, index) => [code, index]));
      const realRank = new Map(realOrder.map((code, index) => [code, index]));

      // Walk the rows in the same order and compare ranks. Row *i* of the dump is
      // the same catalogue row in both books, so its rank must be the same.
      for (let i = 0; i < real.length; i++) {
        const realCode = String(real[i][column] ?? '');
        const mockCode = String(mock[i][column] ?? '');
        if (realCode === '' || mockCode === '') continue;
        expect(mockRank.get(mockCode), `row ${i} of ${table}`).toBe(realRank.get(realCode));
      }
    }
  });

  it('leaves a blank code blank, because a blank one is a distinct row', () => {
    // 621 of 824 gutter rows have no product code. Inventing one would make rows
    // that the catalogue treats as one into several.
    const mock = JSON.parse(readFileSync(join(dir, 'gutter.json'), 'utf8')) as Record<
      string,
      unknown
    >[];
    const real = JSON.parse(
      readFileSync(join(DUMP_DIR, 'gutter.json'), 'utf8'),
    ) as Record<string, unknown>[];

    const blankMock = mock.filter((row) => String(row.gutter_product_code ?? '') === '').length;
    const blankReal = real.filter((row) => String(row.gutter_product_code ?? '') === '').length;
    expect(blankMock).toBe(blankReal);
  });

  it('marks itself a sample, so the demo gate knows it may be shown', () => {
    const marker = join(dir, 'BOOK_KIND.json');
    expect(existsSync(marker)).toBe(true);
    const parsed = JSON.parse(readFileSync(marker, 'utf8')) as { kind?: string };
    expect(parsed.kind).toBe('sample');
  });

  /**
   * A book that declares itself a sample is not thereby safe.
   *
   * One book on disk said `book_kind=sample` while carrying 1,488 real supplier
   * codes: it was scrambled by the first version of the generator, which missed
   * three columns. A demo gate that trusted the label would have waved through the
   * most dangerous book in the directory, so the check reads the data as well.
   */
  it('is refused for a demo when it still contains supplier codes', async () => {
    const { openPriceDb } = await import('@/lib/pricing/db');
    const { importPriceBook } = await import('@/lib/pricing/import');
    const { countSupplierCodes } = await import('@/lib/pricing/publish');

    const db = openPriceDb(':memory:');
    importPriceBook(db, dir);
    // The generator's own output is clean.
    expect(countSupplierCodes(db)).toBe(0);

    // Now put one real code back, as the first scramble left three columns' worth.
    db.prepare("UPDATE cost_frame SET plain_code = 'FBI15403' WHERE id = 1").run();
    expect(countSupplierCodes(db)).toBe(1);
    db.close();
  });
});
