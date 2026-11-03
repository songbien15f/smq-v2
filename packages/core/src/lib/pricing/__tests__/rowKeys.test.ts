/**
 * The row key is built in two places — the catalogue and the lookup — and an
 * override only works if both produce the same string.
 *
 * That is not a style preference. If they differ, `setRowOverride` stores a key
 * the lookup never asks for: the save reports success, the price box shows the
 * new number, and every quote keeps using the book's price. It is the exact
 * class of silent failure this feature exists to avoid, and no amount of testing
 * either side alone would catch it.
 *
 * So these tests run **against the real published book** and compare the two
 * paths row by row. They skip when no book is published, because a clone without
 * the licensed dump must still be able to run its test suite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { CATALOGUE_SOURCES, rowKeyOf, buildRowKey, parseRowKey } from '../rowKeys';
import { readActiveBookHash, openPublishedBook } from '../publish';
import { createLookup } from '../lookup';
import type { PriceLookup } from '../types';

const BOOKS_ROOT = process.env.PRICE_BOOKS ?? join(process.cwd(), 'data', 'price-books');
const HASH = readActiveBookHash(BOOKS_ROOT);
const HAS_BOOK = HASH !== null && existsSync(join(BOOKS_ROOT, `${HASH}.db`));

describe.skipIf(!HAS_BOOK)('row keys against the real book', () => {
  let db: DatabaseSync;
  let lookup: PriceLookup;

  beforeAll(() => {
    db = openPublishedBook(HASH as string, BOOKS_ROOT);
    lookup = createLookup(db);
  });

  it('every declared source produces a unique key for every row', () => {
    for (const source of CATALOGUE_SOURCES) {
      const where = source.filter === undefined ? '' : `WHERE ${source.filter}`;
      const rows = db.prepare(`SELECT * FROM ${source.source} ${where}`).all() as Record<
        string,
        unknown
      >[];
      const keys = new Set(rows.map((row) => rowKeyOf(source.source, row)));

      // A duplicate key means one override would price two different items.
      expect(rows.length, `${source.source} has no rows`).toBeGreaterThan(0);
      expect(keys.size, `${source.source}: ${rows.length} rows, ${keys.size} keys`).toBe(
        rows.length,
      );
    }
  });

  /**
   * The cross-check that matters: pick the row the lookup would return and
   * confirm the key it reports is the key the catalogue would have computed for
   * that same row.
   *
   * Each case names a lookup call and the source whose catalogue listing must
   * agree with it.
   */
  const agreementCases: {
    name: string;
    source: string;
    call: (lookup: PriceLookup) => { rowKey: string } | undefined;
    /** The catalogue row the lookup is expected to have chosen. */
    row: (db: DatabaseSync) => Record<string, unknown> | undefined;
  }[] = [
    {
      name: 'frame',
      source: 'cost_frame',
      call: (l) => l.frame('100 x 100 x 2.0 SHS'),
      row: (d) =>
        d.prepare('SELECT * FROM cost_frame WHERE description = ? LIMIT 1').get(
          '100 x 100 x 2.0 SHS',
        ) as Record<string, unknown> | undefined,
    },
    {
      name: 'purlin',
      source: 'cost_purlin',
      call: (l) => l.purlin('TH64075'),
      row: (d) =>
        d.prepare('SELECT * FROM cost_purlin WHERE description = ? LIMIT 1').get('TH64075') as
          | Record<string, unknown>
          | undefined,
    },
    {
      name: 'sheeting',
      source: 'view_cost_sheeting',
      call: (l) => l.sheeting('Corro', 0.42),
      row: (d) =>
        d
          .prepare(
            'SELECT * FROM view_cost_sheeting WHERE profile = ? AND bmt = ? ORDER BY id, code ASC LIMIT 1',
          )
          .get('Corro', 0.42) as Record<string, unknown> | undefined,
    },
    {
      name: 'gutter',
      source: 'gutter',
      call: (l) => l.gutter('115 Quad'),
      // The lookup prefers a painted row over a galvanised one, so this query
      // reproduces that ordering rather than the old "dearest row wins".
      row: (d) =>
        d
          .prepare(
            "SELECT * FROM gutter WHERE gutter_type = 'GUTTER' AND gutter_size = ? ORDER BY CASE WHEN color LIKE '%Galv%' OR LOWER(color) = 'zinc' THEN 1 ELSE 0 END, gutter_price ASC, gutter_product_code ASC LIMIT 1",
          )
          .get('115 Quad') as Record<string, unknown> | undefined,
    },
    {
      name: 'flashing',
      source: 'flashing',
      call: (l) => l.flashing('GABLE_BARGE'),
      row: (d) =>
        d
          .prepare(
            'SELECT * FROM flashing WHERE flashing_type = ? ORDER BY flashing_price ASC, flashing_product_code ASC, flashing_size ASC LIMIT 1',
          )
          .get('GABLE_BARGE') as Record<string, unknown> | undefined,
    },
    {
      name: 'bracket',
      source: 'cost_bracket',
      call: (l) => l.bracketExact('AB-75'),
      row: (d) =>
        d.prepare('SELECT * FROM cost_bracket WHERE description = ? LIMIT 1').get('AB-75') as
          | Record<string, unknown>
          | undefined,
    },
    {
      name: 'bolt',
      source: 'cost_bolt',
      call: (l) => l.bolt('HD16x300'),
      row: (d) =>
        d.prepare('SELECT * FROM cost_bolt WHERE description = ? LIMIT 1').get('HD16x300') as
          | Record<string, unknown>
          | undefined,
    },
    {
      name: 'pa door',
      source: 'padoor',
      call: (l) => l.door('pa', 820, 2040),
      row: (d) =>
        d
          .prepare(
            'SELECT * FROM padoor WHERE isActive = 1 AND width >= ? AND height >= ? ORDER BY width ASC, height ASC, padoor_product_code ASC LIMIT 1',
          )
          .get(820, 2040) as Record<string, unknown> | undefined,
    },
    {
      name: 'roller door',
      source: 'roller_door',
      call: (l) => l.door('roller', 3000, 2500),
      row: (d) =>
        d
          .prepare(
            'SELECT * FROM roller_door WHERE isActive = 1 AND width >= ? AND height >= ? ORDER BY width ASC, height ASC, rdoor_code ASC LIMIT 1',
          )
          .get(3000, 2500) as Record<string, unknown> | undefined,
    },
    {
      name: 'window',
      source: 'cost_window',
      call: (l) => l.window(900, 900),
      row: (d) =>
        d
          .prepare(
            `SELECT c.* FROM material_window w
             JOIN cost_window c ON c.material_window_id = w.id
             WHERE w.is_active = 1 AND w.width >= ? AND w.height >= ?
             ORDER BY w.width ASC, w.height ASC, c.cost ASC LIMIT 1`,
          )
          .get(900, 900) as Record<string, unknown> | undefined,
    },
  ];

  for (const testCase of agreementCases) {
    it(`${testCase.name}: the lookup and the catalogue agree on the key`, () => {
      const returned = testCase.call(lookup);
      const expectedRow = testCase.row(db);

      // A missing row is a different failure (the book lacks that item), and the
      // other tests cover mocked lines. Here both sides must exist.
      expect(expectedRow, `${testCase.name}: no catalogue row`).toBeDefined();
      expect(returned, `${testCase.name}: lookup returned nothing`).toBeDefined();

      expect(returned?.rowKey).toBe(rowKeyOf(testCase.source, expectedRow as Record<string, unknown>));
    });
  }

  it('a key survives a round trip through parseRowKey', () => {
    const row = db
      .prepare("SELECT * FROM gutter WHERE gutter_type = 'GUTTER' LIMIT 1")
      .get() as Record<string, unknown>;
    const key = rowKeyOf('gutter', row);
    const parsed = parseRowKey(key);

    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('gutter');
    // Every declared identity column is present with the row's own value.
    for (const field of ['gutter_size', 'state', 'color', 'gutter_type']) {
      expect(parsed?.parts[field]).toBe(row[field] === null ? '' : String(row[field]));
    }
  });

  it('escapes a value that contains the separators', () => {
    const key = buildRowKey('gutter', [
      ['gutter_size', 'A&B=C'],
      ['state', ''],
    ]);
    expect(key).toBe('gutter:gutter_size=A%26B%3DC&state=');
    expect(parseRowKey(key)?.parts.gutter_size).toBe('A&B=C');
  });

  it('distinguishes a missing value from the text "null"', () => {
    const missing = buildRowKey('gutter', [['state', null]]);
    const literal = buildRowKey('gutter', [['state', 'null']]);
    expect(missing).not.toBe(literal);
  });

  it('prints a numeric identity the same way twice', () => {
    // `bmt` is a REAL; 0.42 must not become 0.42000000000000004 and stop matching.
    expect(buildRowKey('view_cost_sheeting', [['bmt', 0.42]])).toBe(
      buildRowKey('view_cost_sheeting', [['bmt', 0.42000000000000004]]),
    );
  });

  it('refuses a key it did not build', () => {
    expect(parseRowKey('not-a-key')).toBeNull();
    expect(parseRowKey('unknown_table:a=1')).toBeNull();
  });
});
