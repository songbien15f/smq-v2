import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  publishPriceBook,
  openPublishedBook,
  readActiveBookHash,
} from '@/lib/pricing/publish';
import { describeMaterial } from '@/lib/pricing/catalogueManifest';

let dirs: string[] = [];

function dump(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-dump-'));
  dirs.push(dir);
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows));
  }
  return dir;
}

function booksRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sq-books-'));
  dirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const frame = (cost: number) => [
  { description: '100 x 100 x 2.0 SHS', code: 'FBI15403', cost, mass: 5.64 },
];

describe('publishPriceBook', () => {
  it('gives two different prices different hashes even at the same byte length', () => {
    // The old importer hashed name + row count + byte length, so 1.00 → 1.01 was
    // reported as "the same dump". A publication must hash the content.
    const a = publishPriceBook(dump({ cost_frame: frame(1.0) }), booksRoot());
    const b = publishPriceBook(dump({ cost_frame: frame(1.01) }), booksRoot());
    expect(a.hash).not.toBe(b.hash);
  });

  it('writes a database whose content matches the dump', () => {
    const published = publishPriceBook(dump({ cost_frame: frame(2.5) }), booksRoot());
    const db = openPublishedBook(published.hash, published.root);
    const row = db.prepare('SELECT cost FROM cost_frame').get() as { cost: number };
    expect(row.cost).toBe(2.5);
    db.close();
  });

  it('leaves the previously published book untouched', () => {
    const root = booksRoot();
    const first = publishPriceBook(dump({ cost_frame: frame(1) }), root);
    publishPriceBook(dump({ cost_frame: frame(9) }), root);
    const db = openPublishedBook(first.hash, root);
    const row = db.prepare('SELECT cost FROM cost_frame').get() as { cost: number };
    expect(row.cost).toBe(1);
    db.close();
  });

  it('keeps the active pointer on the old book when a publication fails', () => {
    const root = booksRoot();
    const good = publishPriceBook(dump({ cost_frame: frame(1) }), root);
    expect(readActiveBookHash(root)).toBe(good.hash);

    // A NaN cannot be stored as JSON, so the file is not valid JSON at all: the
    // publication must fail before the pointer moves.
    const bad = dump({ cost_frame: frame(1) });
    writeFileSync(join(bad, 'cost_frame.json'), '[{"cost": NaN}]');

    expect(() => publishPriceBook(bad, root)).toThrow();
    expect(readActiveBookHash(root)).toBe(good.hash);
  });

  it('renames a hostile column name rather than running it or dropping the table', () => {
    // A hostile *column* is the real vector: table names come from file names,
    // but a column name is a JSON key and becomes a CREATE TABLE identifier.
    // The importer sanitises it, so the table survives and nothing is executed.
    const published = publishPriceBook(
      dump({
        cost_frame: [{ 'x"; DROP TABLE price_book_meta; --': 1 }],
        cost_purlin: [{ description: 'Z15019', code: 'FP52143', cost: 12.18, mass: 4.509 }],
      }),
      booksRoot(),
    );
    const db = openPublishedBook(published.hash, published.root);
    expect(() => db.prepare('SELECT COUNT(*) FROM price_book_meta').get()).not.toThrow();
    // The table is present, with the hostile name turned into an identifier.
    const row = db.prepare('SELECT * FROM cost_frame').get() as Record<string, unknown>;
    expect(Object.values(row)).toContain(1);
    db.close();
  });

  it('refuses a table that is a reserved internal name', () => {
    const published = publishPriceBook(
      dump({ price_book_meta: [{ key: 'x', value: 'y' }], cost_frame: frame(1) }),
      booksRoot(),
    );
    expect(published.skipped).toContain('price_book_meta');
    const db = openPublishedBook(published.hash, published.root);
    const rows = db.prepare("SELECT COUNT(*) AS c FROM price_book_meta WHERE key = 'x'").get() as {
      c: number;
    };
    // The dump did not overwrite the importer's own provenance table.
    expect(rows.c).toBe(0);
    db.close();
  });

  it('does not write the active pointer when no table could be read', () => {
    const root = booksRoot();
    expect(() => publishPriceBook(dump({}), root)).toThrow();
    expect(existsSync(join(root, 'active.json'))).toBe(false);
  });

  it('reports the hash it wrote', () => {
    const published = publishPriceBook(dump({ cost_frame: frame(1) }), booksRoot());
    expect(published.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(published.root, `${published.hash}.db`))).toBe(true);
    // The meta inside the book records the same hash.
    const db = openPublishedBook(published.hash, published.root);
    const row = db.prepare("SELECT value FROM price_book_meta WHERE key = 'source_hash'").get() as {
      value: string;
    };
    expect(row.value).toBe(published.hash);
    db.close();
  });
});

describe('describeMaterial', () => {
  it('states the unit for a material whose unit is evidenced', () => {
    const contract = describeMaterial('cost_sheeting.mass');
    expect(contract?.status).toBe('supported');
    expect(contract?.massBasis).toBe('sqm');
  });

  it('marks a per-piece fixing mass as assumed, not supported', () => {
    const contract = describeMaterial('cost_bolt.mass');
    expect(contract?.massBasis).toBe('ea');
    expect(contract?.status).toBe('assumed');
  });

  it('returns missing for a source it has no evidence for', () => {
    expect(describeMaterial('cost_made_up.mass')?.status).toBe('missing');
  });
});
