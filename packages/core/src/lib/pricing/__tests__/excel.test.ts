// @vitest-environment node
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildTemplate,
  indexBook,
  mapHeaders,
  matchRow,
  normaliseDescription,
  readSpreadsheet,
  type BookIndex,
} from '@/lib/pricing/excel';
import { openPriceDb } from '@/lib/pricing/db';
import { importPriceBook } from '@/lib/pricing/import';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** A book small enough to reason about, built through the real importer. */
function book(): BookIndex {
  const dir = mkdtempSync(join(tmpdir(), 'sq-excel-'));
  const files: Record<string, unknown[]> = {
    cost_frame: [
      { id: 1, description: 'C15024', code: 'FP52139', cost: 15.2084, mass: 5.6665 },
      // The trap: one code, two products, different prices. A description match
      // that guessed between them would misprice half a building.
      { id: 2, description: 'C15024 Duragal', code: 'FP52139', cost: 18.5, mass: 5.7 },
    ],
    cost_purlin: [
      { id: 1, description: 'TH64075', code: 'FFT74622', cost: 1.1266, mass: 0.3814, depth: 64 },
    ],
    gutter: [
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: '',
        gutter_price: 4.10395, gutter_mass: 0, color: 'Monument', state: 'QLD' },
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: '',
        gutter_price: 3.168165, gutter_mass: 0, color: 'Zinc', state: 'QLD' },
    ],
  };
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows));
  }
  const db = openPriceDb(':memory:');
  importPriceBook(db, dir);
  const index = indexBook(db);
  db.close();
  rmSync(dir, { recursive: true, force: true });
  return index;
}

/** A workbook from rows, as a customer's file would arrive. */
async function sheet(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('normaliseDescription', () => {
  it('treats case, spacing and punctuation as noise', () => {
    // A spreadsheet writes the same product four ways.
    expect(normaliseDescription('115 Quad')).toBe(normaliseDescription('115  quad'));
    expect(normaliseDescription('115-Quad')).toBe(normaliseDescription('115 Quad'));
    expect(normaliseDescription('  C15024 ')).toBe('c15024');
  });

  it('keeps every word, so two products stay two products', () => {
    // This is the whole reason matching on description can be safe: nothing is
    // dropped, so `C15024` and `C15024 Duragal` are different strings.
    expect(normaliseDescription('C15024')).not.toBe(normaliseDescription('C15024 Duragal'));
  });
});

describe('mapHeaders', () => {
  it('finds the columns by name, whatever order they are in', () => {
    const columns = mapHeaders(['Your price', 'Description', 'Category', 'Code', 'Unit']);
    // `Category` is the label a person reads, not the source name, so it is not
    // the `Source` column — the template carries both for different reasons.
    expect(columns).toEqual({ source: null, code: 3, description: 1, unit: 4, price: 0 });
  });

  it('accepts a customer sheet that says "Price" instead of "Your price"', () => {
    expect(mapHeaders(['Code', 'Price']).price).toBe(1);
  });

  it('is not fooled by spacing or case in the header', () => {
    expect(mapHeaders(['  YOUR   PRICE ']).price).toBe(0);
  });

  it('returns null for a column the sheet does not have', () => {
    expect(mapHeaders(['Code', 'Your price']).source).toBeNull();
  });
});

describe('matchRow', () => {
  const index = book();

  it('matches on source and code, the template path', () => {
    const outcome = matchRow(index, { source: 'cost_frame', code: 'FP52139', description: '' });
    // Two rows share this code, so even source+code is ambiguous — and saying so
    // is the correct answer rather than picking one.
    expect(outcome.kind).toBe('ambiguous');
  });

  it('matches on a unique code', () => {
    const outcome = matchRow(index, { source: '', code: 'FFT74622', description: '' });
    expect(outcome).toMatchObject({ kind: 'matched', how: 'code' });
  });

  it('matches on a unique description', () => {
    const outcome = matchRow(index, { source: '', code: '', description: 'th64075' });
    expect(outcome).toMatchObject({ kind: 'matched', how: 'description' });
  });

  it('refuses to guess when a code names two products', () => {
    // FP52139 is both C15024 and C15024 Duragal at different prices. Picking one
    // would price every portal in the wrong steel.
    const outcome = matchRow(index, { source: '', code: 'FP52139', description: '' });
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind === 'ambiguous') expect(outcome.candidates).toHaveLength(2);
  });

  it('reports a row it cannot find rather than inventing one', () => {
    expect(matchRow(index, { source: '', code: 'NOPE', description: 'Not a product' }).kind).toBe(
      'unmatched',
    );
  });

  it('matches a gutter, whose code is empty in the book', () => {
    // 621 of 824 gutter rows have no product code at all, so a code-only matcher
    // would make most of the gutter table unreachable.
    const outcome = matchRow(index, { source: '', code: '', description: '115 Quad' });
    expect(outcome.kind).toBe('ambiguous'); // two colours, same size
  });
});

describe('readSpreadsheet', () => {
  const index = book();

  it('reads a price and reports the row it matched', async () => {
    const preview = await readSpreadsheet(
      await sheet([
        ['Category', 'Code', 'Description', 'Unit', 'Book price', 'Your price'],
        ['Purlin', 'FFT74622', 'TH64075', 'm', 1.13, 1.35],
      ]),
      index,
    );
    expect(preview.counts.applied).toBe(1);
    expect([...preview.toApply.values()]).toEqual([135]);
  });

  it('leaves a row with no price alone instead of pricing it at zero', async () => {
    // A blank cell means "keep the book's price". Reading it as 0 would make
    // every untouched item free — the worst possible import.
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FFT74622', 'TH64075', null],
      ]),
      index,
    );
    expect(preview.counts.blank).toBe(1);
    expect(preview.counts.applied).toBe(0);
    expect(preview.toApply.size).toBe(0);
  });

  it('refuses a price that is not a number rather than reading it as zero', async () => {
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FFT74622', 'TH64075', 'call us'],
      ]),
      index,
    );
    expect(preview.counts.invalid).toBe(1);
    expect(preview.toApply.size).toBe(0);
    const row = preview.rows.find((entry) => entry.sheetRow === 2);
    expect(row?.outcome).toMatchObject({ kind: 'invalid' });
  });

  it('reads a price written with a currency symbol and thousands separator', async () => {
    // A real sheet says `$1,234.50`. Refusing it would make the importer useless
    // on the sheets customers actually have.
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FFT74622', 'TH64075', '$1,234.50'],
      ]),
      index,
    );
    expect([...preview.toApply.values()]).toEqual([123450]);
  });

  it('does not apply an ambiguous row', async () => {
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FP52139', '', 20],
      ]),
      index,
    );
    expect(preview.counts.ambiguous).toBe(1);
    expect(preview.toApply.size).toBe(0);
  });

  it('applies the matched rows and keeps an unmatched one as a new item', async () => {
    // The unmatched row is not thrown away: it is a thing this company buys that
    // the book does not list, which is what a different factory means.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Description', 'Your price'],
        ['', 'FFT74622', 'TH64075', 1.5],
        ['cost_frame', 'ABC-001', 'C25030', 40],
      ]),
      index,
    );
    expect(preview.counts.applied).toBe(1);
    expect(preview.counts.created).toBe(1);
    expect(preview.toCreate).toHaveLength(1);
    expect(preview.toCreate[0]).toMatchObject({
      source: 'cost_frame',
      code: 'ABC-001',
      description: 'C25030',
      unit: 'm',
      unitCostCents: 4000,
    });
  });

  it('refuses an unmatched row with no group, rather than storing it where nothing looks', async () => {
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['NOPE', 'Widget', 9],
      ]),
      index,
    );
    expect(preview.counts.created).toBe(0);
    expect(preview.counts.invalid).toBe(1);
    expect(preview.rows[0].outcome.kind).toBe('invalid');
  });

  it('refuses a row with no description, because the engine asks by name', async () => {
    // `frame('C15024')` is how the engine asks. A row with only a code would be
    // stored and never found, which looks configured and prices nothing.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Your price'],
        ['cost_frame', 'ABC-001', 40],
      ]),
      index,
    );
    expect(preview.counts.created).toBe(0);
    expect(preview.counts.invalid).toBe(1);
  });

  it('takes the unit from the group, never from the sheet', async () => {
    // 12.5 metres of section × a price typed as "each" would charge for one.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Description', 'Unit', 'Your price'],
        ['cost_frame', 'ABC-001', 'C25030', 'ea', 40],
      ]),
      index,
    );
    expect(preview.toCreate[0].unit).toBe('m');
  });

  it('updates one of the company’s own items rather than adding a second', async () => {
    // The name is the identity. A sheet that names an item the company already has
    // is re-pricing it — and `mine` is what lets the screen say "updated" rather
    // than "added", which is different news.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Description', 'Your price'],
        ['cost_frame', 'ABC-001', 'C25030', 44.5],
      ]),
      index,
      [
        {
          source: 'cost_frame',
          name: 'c25030',
          code: 'ABC-001',
          description: 'C25030',
          unit: 'm',
          unitCostCents: 4000,
        },
      ],
    );
    expect(preview.counts.created).toBe(0);
    expect(preview.counts.updated).toBe(1);
    expect(preview.rows[0].outcome).toMatchObject({ kind: 'created', mine: true });
    expect(preview.toCreate[0]).toMatchObject({ unitCostCents: 4450, unit: 'm' });
  });

  it('recognises an own item by its code when the sheet has no description', async () => {
    // A real sheet often puts the name in the Code column and prose, or nothing, in
    // the Description column.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Your price'],
        ['cost_frame', 'ABC-001', 44.5],
      ]),
      index,
      [
        {
          source: 'cost_frame',
          name: 'c25030',
          code: 'ABC-001',
          description: 'C25030',
          unit: 'm',
          unitCostCents: 4000,
        },
      ],
    );
    expect(preview.counts.updated).toBe(1);
    expect(preview.toCreate[0].description).toBe('C25030');
  });

  it('takes an own item out when the sheet leaves its price empty', async () => {
    // An item of the company's own has no book price to fall back to, so a cleared
    // price can only mean one thing — and the preview has to say so, because a
    // deletion nobody is shown is the failure this screen exists to prevent.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Description', 'Your price'],
        ['cost_frame', 'ABC-001', 'C25030', ''],
      ]),
      index,
      [
        {
          source: 'cost_frame',
          name: 'c25030',
          code: 'ABC-001',
          description: 'C25030',
          unit: 'm',
          unitCostCents: 4000,
        },
      ],
    );
    expect(preview.counts.removed).toBe(1);
    expect(preview.counts.blank).toBe(0);
    expect(preview.toRemove).toEqual([{ source: 'cost_frame', name: 'c25030' }]);
    expect(preview.rows[0].outcome).toMatchObject({ kind: 'removed' });
  });

  it('keeps a blank price on a book row meaning "the book’s price"', async () => {
    // The removal rule must not leak: a book row with no price is still "leave it
    // alone", never "delete something".
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FFT74622', 'TH64075', ''],
      ]),
      index,
      [
        // An item of the company's own, but not this one: the purlin row is the
        // book's, so a blank cell there is still "leave it at the book's price".
        {
          source: 'cost_frame',
          name: 'c25030',
          code: 'ABC-001',
          description: 'C25030',
          unit: 'm',
          unitCostCents: 99,
        },
      ],
    );
    expect(preview.counts.blank).toBe(1);
    expect(preview.counts.removed).toBe(0);
    expect(preview.toRemove).toEqual([]);
  });

  it('lets the company’s own item win even when the book has the name too', async () => {
    // Once a name is the company's it stays theirs. Matching the book first would
    // write a price override that the lookup never reaches, because their own item
    // wins there — an edit that saves and does nothing.
    const preview = await readSpreadsheet(
      await sheet([
        ['Source', 'Code', 'Description', 'Your price'],
        ['cost_frame', 'FP52139', 'C15024', 30],
      ]),
      index,
      [
        {
          source: 'cost_frame',
          name: 'c15024',
          code: 'FP52139',
          description: 'C15024',
          unit: 'm',
          unitCostCents: 2000,
        },
      ],
    );
    expect(preview.toApply.size).toBe(0);
    expect(preview.counts.updated).toBe(1);
  });

  it('takes the last price when one catalogue row appears twice', async () => {
    // Two sheet rows, one product: the operator typed the second on purpose.
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['FFT74622', 'TH64075', 1.5],
        ['FFT74622', 'TH64075', 1.8],
      ]),
      index,
    );
    expect(preview.toApply.size).toBe(1);
    expect([...preview.toApply.values()]).toEqual([180]);
  });

  it('names the row number so the operator can find it in the sheet', async () => {
    const preview = await readSpreadsheet(
      await sheet([
        ['Code', 'Description', 'Your price'],
        ['NOPE', 'Widget', 9],
      ]),
      index,
    );
    expect(preview.rows[0].sheetRow).toBe(2);
  });

  it('refuses a sheet with no price column', async () => {
    await expect(
      readSpreadsheet(await sheet([['Code', 'Description'], ['FFT74622', 'TH64075']]), index),
    ).rejects.toThrow(/price column/i);
  });

  it('refuses a sheet with neither a code nor a description', async () => {
    await expect(
      readSpreadsheet(await sheet([['Unit', 'Your price'], ['m', 1.5]]), index),
    ).rejects.toThrow(/Code or Description/i);
  });
});

describe('buildTemplate', () => {
  it('lists every catalogue row with an empty price column', async () => {
    const index = book();
    const buffer = await buildTemplate(index);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const prices = workbook.getWorksheet('Prices');
    expect(prices).toBeDefined();
    // Header plus one row per catalogue row.
    expect(prices!.rowCount).toBe(index.rows.length + 1);

    const header = prices!.getRow(1);
    const headers: string[] = [];
    for (let column = 1; column <= header.cellCount; column++) {
      headers.push(String(header.getCell(column).value));
    }
    expect(headers).toContain('Your price');

    // The company's column is empty on every row: the template is a form, not a
    // copy of the book's prices pretending to be an override.
    const yourPriceColumn = headers.indexOf('Your price') + 1;
    for (let rowNumber = 2; rowNumber <= prices!.rowCount; rowNumber++) {
      expect(prices!.getRow(rowNumber).getCell(yourPriceColumn).value ?? '').toBe('');
    }
  });

  it('carries a sheet that explains the columns', async () => {
    const buffer = await buildTemplate(book());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const help = workbook.getWorksheet('How to use');
    expect(help).toBeDefined();
    const text = help!
      .getColumn(1)
      .values.filter((value): value is string => typeof value === 'string')
      .join(' ');
    expect(text).toMatch(/Your price/);
    expect(text).toMatch(/partial sheet is fine/i);
  });

  it('produces a template the importer reads back unchanged', async () => {
    // The round trip is the contract: a customer downloads this file, types a
    // price, and uploads it. If the template's own columns did not match, the
    // feature would fail on the one file we control.
    //
    // A book whose codes are unique, because that is the case the template has to
    // get right: the ambiguous-code book is covered above by its own test.
    const uniqueDir = mkdtempSync(join(tmpdir(), 'sq-excel-roundtrip-'));
    writeFileSync(
      join(uniqueDir, 'cost_frame.json'),
      JSON.stringify([
        { id: 1, description: 'C15024', code: 'FP52139', cost: 15.2084, mass: 5.6665 },
        { id: 2, description: 'C20015', code: 'FP52155', cost: 12.3215, mass: 4.4957 },
      ]),
    );
    const uniqueDb = openPriceDb(':memory:');
    importPriceBook(uniqueDb, uniqueDir);
    const uniqueIndex = indexBook(uniqueDb);
    uniqueDb.close();
    rmSync(uniqueDir, { recursive: true, force: true });

    const buffer = await buildTemplate(uniqueIndex);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const prices = workbook.getWorksheet('Prices')!;

    const header = prices.getRow(1);
    const headers: string[] = [];
    for (let column = 1; column <= header.cellCount; column++) {
      headers.push(String(header.getCell(column).value));
    }
    const priceColumn = headers.indexOf('Your price') + 1;
    const codeColumn = headers.indexOf('Code') + 1;
    prices.getRow(2).getCell(priceColumn).value = 1.35;
    const code = prices.getRow(2).getCell(codeColumn).value;

    const reloaded = Buffer.from(await workbook.xlsx.writeBuffer());
    const preview = await readSpreadsheet(reloaded, uniqueIndex);

    expect(preview.counts.total).toBe(2);
    expect(preview.counts.applied).toBe(1);
    expect([...preview.toApply.values()]).toEqual([135]);
    // The row that was filled in is the one that applied.
    const applied = preview.rows.find((row) => row.outcome.kind === 'matched');
    expect(applied?.code).toBe(String(code));
  });
});
