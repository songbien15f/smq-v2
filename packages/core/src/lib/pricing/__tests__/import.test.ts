import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPriceDb } from '@/lib/pricing/db';
import { importPriceBook, columnFor } from '@/lib/pricing/import';

let dir: string | undefined;

function fixture(files: Record<string, unknown[]>): string {
  dir = mkdtempSync(join(tmpdir(), 'sq-price-'));
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows));
  }
  writeFileSync(
    join(dir, '_summary.tsv'),
    Object.keys(files)
      .map((name) => `${name}\ttable\t${files[name].length}`)
      .join('\n'),
  );
  return dir;
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('importPriceBook', () => {
  it('creates a table per file and loads every row', () => {
    const db = openPriceDb(':memory:');
    const report = importPriceBook(
      db,
      fixture({
        cost_purlin: [
          { id: 1, description: '150IB', cost: 3.6916, mass: 0.5 },
          { id: 2, description: 'TH22', cost: 1.1266, mass: 0.3814 },
        ],
        cost_frame: [{ id: 1, description: '100 x 100 x 2.0 SHS', cost: 16.9571 }],
      }),
    );

    expect(report.tables.map((t) => t.name).sort()).toEqual(['cost_frame', 'cost_purlin']);
    expect(report.tables.find((t) => t.name === 'cost_purlin')?.rows).toBe(2);

    const rows = db.prepare('SELECT description, cost FROM cost_purlin ORDER BY id').all();
    expect(rows).toEqual([
      { description: '150IB', cost: 3.6916 },
      { description: 'TH22', cost: 1.1266 },
    ]);
  });

  it('records the source hash in the meta table', () => {
    const db = openPriceDb(':memory:');
    const report = importPriceBook(db, fixture({ cost_purlin: [{ id: 1, cost: 1 }] }));
    const meta = db
      .prepare("SELECT value FROM price_book_meta WHERE key = 'source_hash'")
      .get() as { value: string };
    expect(meta.value).toBe(report.sourceHash);
    expect(report.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent: importing the same dump twice yields the same row counts', () => {
    const db = openPriceDb(':memory:');
    const path = fixture({ cost_purlin: [{ id: 1, cost: 1 }, { id: 2, cost: 2 }] });
    importPriceBook(db, path);
    importPriceBook(db, path);
    const count = db.prepare('SELECT COUNT(*) AS n FROM cost_purlin').get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('infers numeric columns and keeps nulls', () => {
    const db = openPriceDb(':memory:');
    importPriceBook(db, fixture({ t: [{ a: 1, b: null }, { a: 2, b: 3.5 }] }));
    const rows = db.prepare('SELECT a, b FROM t ORDER BY a').all();
    expect(rows).toEqual([{ a: 1, b: null }, { a: 2, b: 3.5 }]);
  });

  it('stores integer columns as INTEGER and mixed columns as REAL', () => {
    const db = openPriceDb(':memory:');
    importPriceBook(db, fixture({ t: [{ n: 1, r: 1.5 }, { n: 2, r: 2 }] }));
    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 't'")
      .get() as { sql: string };
    expect(sql.sql).toMatch(/"n"\s+INTEGER/);
    expect(sql.sql).toMatch(/"r"\s+REAL/);
  });

  it('rejects a table name that is not a plain identifier', () => {
    const db = openPriceDb(':memory:');
    const path = fixture({ 'bad name; DROP TABLE x': [{ a: 1 }] });
    const report = importPriceBook(db, path);
    expect(report.skipped).toContain('bad name; DROP TABLE x');
    expect(report.tables.map((t) => t.name)).not.toContain('bad name; DROP TABLE x');
  });

  it('works without a summary file by listing the json files', () => {
    const db = openPriceDb(':memory:');
    dir = mkdtempSync(join(tmpdir(), 'sq-price-nosum-'));
    writeFileSync(join(dir, 'only_table.json'), JSON.stringify([{ a: 1 }]));
    const report = importPriceBook(db, dir);
    expect(report.tables).toEqual([{ name: 'only_table', rows: 1 }]);
  });
});

describe('untrusted column names', () => {
  /**
   * A hostile column name is **renamed**, not obeyed and not fatal.
   *
   * The importer used to skip the whole table, which was safe but cost the frame
   * section table: the real book has a column called `no_M/EW`, and dropping
   * `system_lookup_data` left every frame priced from one fixed section. So the
   * name is sanitised — and the sanitising is what makes it safe, because the
   * result cannot close an identifier or carry a statement.
   */
  it('renames a column name that is not a plain identifier, and runs none of it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-inject-'));
    writeFileSync(
      join(dir, 'evil.json'),
      JSON.stringify([{ 'x" TEXT); DROP TABLE price_book_meta; --': 1 }]),
    );
    writeFileSync(join(dir, 'good.json'), JSON.stringify([{ id: 1, name: 'ok' }]));

    const db = openPriceDb(':memory:');
    const report = importPriceBook(db, dir);

    // Both tables exist, and the hostile name is reported under its new form.
    expect(report.tables.map((t) => t.name)).toContain('good');
    expect(report.tables.map((t) => t.name)).toContain('evil');
    expect(report.renamed.join(' ')).toMatch(/^evil\./);
    // The injected statement is data, not SQL: the importer's own table survives.
    expect(() => db.prepare('SELECT COUNT(*) FROM price_book_meta').get()).not.toThrow();
    // And the value is readable under the sanitised name.
    const row = db.prepare('SELECT * FROM evil').get() as Record<string, unknown>;
    expect(Object.values(row)).toContain(1);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('turns a real book column into an identifier a query can name', () => {
    // `system_lookup_data.no_M/EW` is the column that used to drop the table.
    expect(columnFor('no_M/EW')).toBe('no_M_EW');
    expect(columnFor('plain_name')).toBe('plain_name');
    expect(columnFor('2start')).toBe('_2start');
    expect(columnFor('')).toBe('_');
  });

  it('doubles an embedded quote in an identifier', () => {
    // Belt and braces: even a quoted name must not terminate early.
    const dir = mkdtempSync(join(tmpdir(), 'sq-quote-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify([{ id: 1 }]));
    const db = openPriceDb(':memory:');
    expect(() => importPriceBook(db, dir)).not.toThrow();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
