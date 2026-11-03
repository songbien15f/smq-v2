/**
 * A company's prices arriving as a spreadsheet.
 *
 * ## The problem this solves
 *
 * Every shed company already has a price list. It is a spreadsheet — sometimes a
 * clean one, often forty tabs of a supplier's export with the prices typed over.
 * Until now the only way into this product was a Windows tool that reads a
 * licensed database, which no customer has. So "send me your price list" was a
 * promise the product could not keep.
 *
 * ## Why this writes *overrides*, not a price book
 *
 * A supplier's book is fourteen tables and 3,250 rows of engineering — sections,
 * spans, brackets, colours. A customer's spreadsheet is a list of things and what
 * they charge for them. They are not the same artefact and pretending otherwise
 * would mean asking a customer to reproduce a database.
 *
 * So a spreadsheet does two things, and never touches the book:
 *
 *   1. For a catalogue row the book already has, it sets **this company's price**
 *      (`price_row_overrides`, the same table the price editor writes).
 *   2. For a row the book does **not** have, it adds an item to the company's own
 *      catalogue (`company_catalogue_rows`), quoting the sheet's own description
 *      and unit.
 *
 * The second half is what makes a different factory usable. Every shed company
 * buys from its own supplier, so its codes and its items are its own; a product
 * that only understood one supplier's list was a demo, not something a customer
 * could run. The book still decides *what a shed needs* and the geometry that
 * follows from it — an import can add a price or an item, but it cannot change
 * how a building is measured.
 *
 * ## The matching rule, and why it is not one rule
 *
 * A customer's row has to find a catalogue row. The template's own rows match
 * exactly — they carry the `Source` and `Code` the book uses. A customer's own
 * sheet usually does not: it has their description and their price, and their
 * codes are their own.
 *
 * So matching is tried in order, strongest first, and **stops at the first
 * ambiguity**:
 *
 *   1. `Source` + `Code` — exact, from our template.
 *   2. `Code` alone, when exactly one row in the book carries it.
 *   3. `Description` alone, normalised (case, spacing, punctuation), when exactly
 *      one row matches.
 *
 * A row that matches nothing is **not** a failure. It is taken as an item this
 * company buys that the book does not list, and added to its own catalogue — but
 * only when the sheet names a `Source` group the bill of materials asks for and
 * gives the item a **description**.
 *
 * The description, not the code, is the identity, because the engine asks for an
 * item by name: it calls `frame('C15024')` and the book answers by matching that
 * against a description. A customer's own code is kept and printed on their
 * materials list, but a row identified only by `ABC-001` could never be found when
 * the engine asks for `C15024`.
 *
 * A description that matches two rows is **not** guessed at: `C15024` and
 * `C15024 Duragal` are different products at different prices, and picking one
 * would silently misprice half a building. The row is reported as ambiguous with
 * the candidates named, so the operator can disambiguate with a code.
 */

import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { DatabaseSync } from 'node:sqlite';
import {
  CATALOGUE_SOURCES,
  parseRowKey,
  rowKeyOf,
  type CatalogueSource,
} from './rowKeys';
import { CUSTOM_SOURCES, unitFor, type OwnItem } from '@/lib/pricing/ownItems';
import { normaliseDescription } from './normalise';
import type { BomUnit } from '@/lib/bom/types';

/** Dollars → whole cents, the same conversion the lookup and catalogue use. */
function cents(dollars: unknown): number {
  const value = typeof dollars === 'number' ? dollars : Number(dollars);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** A database value as display text, with `null` as the empty string. */
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Re-exported so the importer's callers keep one import, but the definition lives
 * in `normalise.ts`: the company catalogue needs the same function, and `excel.ts`
 * already imports the catalogue.
 */
export { normaliseDescription } from './normalise';

/** One catalogue row, as the matcher sees it. */
interface BookRow {
  rowKey: string;
  source: string;
  code: string;
  description: string;
  unit: string;
  baseCents: number;
}

/** Every catalogue row the book holds, indexed for matching. */
export interface BookIndex {
  rows: BookRow[];
  /**
   * `source\u0000code\u0000description` → rows, normalised.
   *
   * This is the **exact** identity for every source whose declared key is code
   * and description (`cost_frame`, `cost_purlin`), and the reason a template row
   * can be matched back: `cost_frame` carries one code twice — two Duragal
   * variants of the same section at different prices — so code alone is not the
   * identity and matching on it would report every one of those as ambiguous.
   */
  bySourceCodeDescription: Map<string, BookRow[]>;
  /** `source\u0000code` → rows. */
  bySourceCode: Map<string, BookRow[]>;
  /** code (lower case) → rows, across every source. */
  byCode: Map<string, BookRow[]>;
  /** normalised description → rows, across every source. */
  byDescription: Map<string, BookRow[]>;
}

/** Read every catalogue row out of a published book and index it. */
export function indexBook(db: DatabaseSync): BookIndex {
  const rows: BookRow[] = [];

  for (const source of CATALOGUE_SOURCES) {
    const where = source.filter === undefined ? '' : ` WHERE ${source.filter}`;
    const identity = source.identity.join(', ');
    const code = source.codeColumn === null ? "'' AS code" : `${source.codeColumn} AS code`;
    // A book may lack a source entirely — a partial dump, or a customer's book
    // that never had that table. A missing table means "nothing to price here",
    // not a failed import, so it is skipped rather than thrown.
    let raw: Record<string, unknown>[];
    try {
      raw = db
        .prepare(
          `SELECT ${identity}, ${code}, ${source.descriptionColumn} AS description,
                  ${source.priceColumn} AS price
           FROM ${source.source}${where}`,
        )
        .all() as Record<string, unknown>[];
    } catch {
      continue;
    }

    for (const row of raw) {
      rows.push({
        rowKey: rowKeyOf(source.source, row),
        source: source.source,
        code: text(row.code),
        description: text(row.description),
        unit: source.unit,
        baseCents: cents(row.price),
      });
    }
  }

  const bySourceCodeDescription = new Map<string, BookRow[]>();
  const bySourceCode = new Map<string, BookRow[]>();
  const byCode = new Map<string, BookRow[]>();
  const byDescription = new Map<string, BookRow[]>();
  const push = (map: Map<string, BookRow[]>, key: string, row: BookRow): void => {
    if (key === '') return;
    const list = map.get(key);
    if (list === undefined) map.set(key, [row]);
    else list.push(row);
  };

  for (const row of rows) {
    push(
      bySourceCodeDescription,
      `${row.source}\u0000${row.code.toLowerCase()}\u0000${normaliseDescription(row.description)}`,
      row,
    );
    push(bySourceCode, `${row.source}\u0000${row.code.toLowerCase()}`, row);
    push(byCode, row.code.toLowerCase(), row);
    push(byDescription, normaliseDescription(row.description), row);
  }

  return { rows, bySourceCodeDescription, bySourceCode, byCode, byDescription };
}

/** What a spreadsheet row became. */
export type ImportOutcome =
  | { kind: 'matched'; rowKey: string; how: 'source+code' | 'code' | 'description' }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unmatched' }
  /**
   * Adds to, or re-prices, an item in the company's own catalogue.
   *
   * `mine` says which: a row naming an item the company already has is an update,
   * and one the book does not have is new. The operator reads the difference —
   * "updated" is not the same news as "added".
   */
  | { kind: 'created'; source: string; code: string; mine: boolean }
  /** One of the company's own items, with its price cleared, so it goes. */
  | { kind: 'removed'; source: string; name: string }
  | { kind: 'invalid'; reason: string }
  /** A row with no price typed: nothing to do, and not a problem. */
  | { kind: 'blank' };

/** One spreadsheet row, with what happened to it. */
export interface ImportRow {
  /** 1-based row number in the sheet, so the operator can find it. */
  sheetRow: number;
  source: string;
  code: string;
  description: string;
  /** The price as the sheet stated it, in whole cents; `null` when blank. */
  priceCents: number | null;
  outcome: ImportOutcome;
}

/** A parsed spreadsheet, before anything is written. */
export interface ImportPreview {
  rows: ImportRow[];
  /** Rows that will set a price on an existing catalogue row, keyed by row key. */
  toApply: Map<string, number>;
  /**
   * Rows that add to, or re-price, the company's **own** catalogue items.
   *
   * A row the shared book does not contain is no longer dropped. It is taken as an
   * item this company buys from its own supplier, with the description and unit the
   * sheet states — which is what "a different factory" actually means. Until this
   * existed, a customer on another factory could not use the product at all: their
   * whole price list imported as "not matched" and vanished.
   *
   * This is an **upsert**, not a replacement: an item the sheet does not mention is
   * left alone. Uploading a sheet that carried one new item once wiped every item
   * the company had added before.
   */
  toCreate: NewItem[];
  /** Items the sheet asks to take out, by name: a row for one of them with no price. */
  toRemove: { source: string; name: string }[];
  counts: {
    total: number;
    applied: number;
    blank: number;
    ambiguous: number;
    invalid: number;
    /** Rows that will add a new item to the company's own catalogue. */
    created: number;
    /** Rows that re-price an item the company already had. */
    updated: number;
    /** Own items the sheet asks to remove, by leaving their price empty. */
    removed: number;
  };
}

/** One row the sheet wants to add to the company's own catalogue. */
export interface NewItem {
  source: string;
  code: string;
  description: string;
  /** The group's unit, never the sheet's — see `unitFor`. */
  unit: BomUnit;
  unitCostCents: number;
  massKg: number;
  /** The sheet row it came from, so an error can name it. */
  sheetRow: number;
}

/** The columns the importer reads, by header name. */
const HEADER = {
  source: 'source',
  code: 'code',
  description: 'description',
  unit: 'unit',
  price: 'your price',
} as const;

/** A header cell reduced to what it means, so case and spacing do not matter. */
function headerKey(value: unknown): string {
  return normaliseDescription(text(value));
}

/**
 * Which column holds each field, from the sheet's own header row.
 *
 * Read from the header rather than assumed by position: a customer will reorder
 * columns, add one, or paste their sheet into ours, and an importer that assumes
 * column C is the price would read their unit column and multiply a quote by 90.
 */
export function mapHeaders(headerRow: (string | undefined)[]): {
  source: number | null;
  code: number | null;
  description: number | null;
  unit: number | null;
  price: number | null;
} {
  const found: Record<string, number | null> = {
    source: null,
    code: null,
    description: null,
    unit: null,
    price: null,
  };
  headerRow.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key === HEADER.source && found.source === null) found.source = index;
    else if (key === HEADER.code && found.code === null) found.code = index;
    else if (key === HEADER.description && found.description === null) found.description = index;
    else if (key === HEADER.unit && found.unit === null) found.unit = index;
    // "Your price" is what the template calls it; "Price" is what a customer's
    // own sheet usually says. Both are accepted, and the longer one wins when a
    // sheet has both.
    else if ((key === HEADER.price || key === 'price') && found.price === null) {
      found.price = index;
    }
  });
  return {
    source: found.source,
    code: found.code,
    description: found.description,
    unit: found.unit,
    price: found.price,
  };
}

/** Match one spreadsheet row against the book. */
export function matchRow(
  index: BookIndex,
  input: { source: string; code: string; description: string },
): ImportOutcome {
  const code = input.code.trim();
  const description = input.description.trim();
  const source = input.source.trim();

  // 1. Source, code **and** description together. This is the strongest match and
  //    the one the template's own rows satisfy: `cost_frame` carries the code
  //    `FP52139` on both `C15024` and `C15024 Duragal`, so the description is part
  //    of the identity there rather than decoration.
  if (source !== '' && code !== '' && description !== '') {
    const exact = index.bySourceCodeDescription.get(
      `${source}\u0000${code.toLowerCase()}\u0000${normaliseDescription(description)}`,
    );
    if (exact !== undefined && exact.length === 1) {
      return { kind: 'matched', rowKey: exact[0].rowKey, how: 'source+code' };
    }
  }

  // 2. Source and code alone, when that pair is unique in the book.
  if (source !== '' && code !== '') {
    const exact = index.bySourceCode.get(`${source}\u0000${code.toLowerCase()}`);
    if (exact !== undefined && exact.length === 1) {
      return { kind: 'matched', rowKey: exact[0].rowKey, how: 'source+code' };
    }
    if (exact !== undefined && exact.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: exact.map((row) => `${row.source} ${row.code} — ${row.description}`),
      };
    }
  }

  // 3. Code alone, when the book has exactly one row with it. A code that appears
  //    in several sources is not resolved: `CO35` is a sheeting code and a code
  //    somewhere else may be a different product.
  if (code !== '') {
    const byCode = index.byCode.get(code.toLowerCase());
    if (byCode !== undefined && byCode.length === 1) {
      return { kind: 'matched', rowKey: byCode[0].rowKey, how: 'code' };
    }
    if (byCode !== undefined && byCode.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: byCode.map((row) => `${row.source} ${row.code} — ${row.description}`),
      };
    }
  }

  // 4. Description alone, when it is exactly one row.
  if (description !== '') {
    const byDescription = index.byDescription.get(normaliseDescription(description));
    if (byDescription !== undefined && byDescription.length === 1) {
      return { kind: 'matched', rowKey: byDescription[0].rowKey, how: 'description' };
    }
    if (byDescription !== undefined && byDescription.length > 1) {
      return {
        kind: 'ambiguous',
        candidates: byDescription.map((row) => `${row.source} ${row.code} — ${row.description}`),
      };
    }
  }

  return { kind: 'unmatched' };
}

/** A price cell as whole cents, or `null` when it holds no price. */
function readPrice(value: unknown): { cents: number | null; invalid: boolean } {
  if (value === null || value === undefined) return { cents: null, invalid: false };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { cents: null, invalid: true };
    return { cents: Math.round(value * 100), invalid: false };
  }
  const raw = text(value).trim();
  if (raw === '') return { cents: null, invalid: false };
  // A typed price may carry a currency symbol, thousands separators or a
  // trailing note. Everything that is not part of the number is dropped, because
  // `$1,234.50` is a price and refusing it would make the importer useless on a
  // real sheet. What is left must parse, or the row is invalid rather than zero:
  // a price that cannot be read must never become "free".
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return { cents: null, invalid: true };
  const value2 = Number(cleaned);
  if (!Number.isFinite(value2)) return { cents: null, invalid: true };
  if (value2 < 0) return { cents: null, invalid: true };
  return { cents: Math.round(value2 * 100), invalid: false };
}

/**
 * Read a spreadsheet into a preview. Nothing is written here.
 *
 * The first sheet is the price list. Rows are matched against the book and each
 * one is reported, so the operator sees exactly what will land **before** any
 * quote changes price.
 */
/**
 * Read a spreadsheet into a preview. Nothing is written here.
 *
 * The first sheet is the price list. Rows are matched against the book and against
 * the company's own items, and each one is reported, so the operator sees exactly
 * what will land **before** any quote changes price.
 *
 * `own` is what the company has already brought with it. It is needed here, not
 * only at the write, because two decisions depend on it and both would otherwise
 * be silent:
 *
 *   - a row naming one of the company's own items is an **update** to it, not a
 *     price override on the book — without this, a book that later gains a matching
 *     row would quietly re-point the customer's own item at the book;
 *   - a row naming one of them with **no price** is a deletion, and a deletion the
 *     operator cannot see in the preview is the failure this whole screen is for.
 */
export async function readSpreadsheet(
  buffer: Buffer,
  index: BookIndex,
  own: OwnItem[] = [],
): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's type for a Node buffer is `Buffer`, and the cast is only because
  // its own declaration asks for its bundled `Buffer` shim.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new Error('The file has no sheets');

  const headerRow = sheet.getRow(1);
  const headers: (string | undefined)[] = [];
  for (let column = 1; column <= Math.max(headerRow.cellCount, 1); column++) {
    headers.push(text(headerRow.getCell(column).value));
  }
  const columns = mapHeaders(headers);
  if (columns.price === null) {
    throw new Error(
      'No price column found. The sheet needs a header called "Your price" (or "Price").',
    );
  }
  if (columns.code === null && columns.description === null) {
    throw new Error(
      'No Code or Description column found. The sheet needs at least one to identify a row.',
    );
  }

  /**
   * The company's own items, indexed by group and then by name **and** code.
   *
   * `byAnyName` exists for a sheet with no `Source` column — a customer's own file
   * often has none — where the group has to be inferred. It only answers when
   * exactly one item carries the name, because guessing between two is how a sheet
   * silently re-prices the wrong thing.
   */
  const mine = new Map<string, OwnItem>();
  const byAnyName = new Map<string, OwnItem[]>();
  const remember = (key: string, item: OwnItem): void => {
    const list = byAnyName.get(key);
    if (list === undefined) byAnyName.set(key, [item]);
    else list.push(item);
  };
  for (const item of own) {
    mine.set(`${item.source}\u0000${item.name}`, item);
    const code = normaliseDescription(item.code);
    if (code !== '') mine.set(`${item.source}\u0000${code}`, item);
    remember(item.name, item);
    if (code !== '') remember(code, item);
  }

  /** The company's own item this row names, or `undefined`. */
  const myItem = (group: string, code: string, description: string): OwnItem | undefined => {
    const keys = [normaliseDescription(description), normaliseDescription(code)].filter(
      (key) => key !== '',
    );
    if (group !== '') {
      for (const key of keys) {
        const hit = mine.get(`${group}\u0000${key}`);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    for (const key of keys) {
      const candidates = byAnyName.get(key);
      if (candidates !== undefined && candidates.length === 1) return candidates[0];
    }
    return undefined;
  };

  const rows: ImportRow[] = [];
  const toApply = new Map<string, number>();
  const toCreate: NewItem[] = [];
  const toRemove: { source: string; name: string }[] = [];
  const counts = {
    total: 0,
    applied: 0,
    blank: 0,
    ambiguous: 0,
    invalid: 0,
    created: 0,
    updated: 0,
    removed: 0,
  };

  const cellText = (row: ExcelJS.Row, column: number | null): string =>
    column === null ? '' : text(row.getCell(column + 1).value).trim();

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const price = readPrice(columns.price === null ? null : row.getCell(columns.price + 1).value);
    const source = cellText(row, columns.source);
    const code = cellText(row, columns.code);
    const description = cellText(row, columns.description);

    // A row with nothing at all is the tail of a sheet that once held more, not
    // an error.
    if (source === '' && code === '' && description === '' && price.cents === null) continue;

    counts.total += 1;

    if (price.invalid) {
      counts.invalid += 1;
      rows.push({
        sheetRow: rowNumber,
        source,
        code,
        description,
        priceCents: null,
        outcome: { kind: 'invalid', reason: 'The price is not a number' },
      });
      continue;
    }

    /**
     * The company's own item, before the book.
     *
     * Once a name is the company's, it stays theirs: an item they brought with them
     * is re-priced by their sheet even if the shared book later grows a row with
     * the same name. Matching the book first would write a price override that the
     * lookup never reaches, because their own item wins there — an edit that saves
     * and does nothing.
     */
    const owned = myItem(source.trim(), code, description);
    if (owned !== undefined) {
      if (price.cents === null) {
        toRemove.push({ source: owned.source, name: owned.name });
        counts.removed = toRemove.length;
        rows.push({
          sheetRow: rowNumber,
          source,
          code,
          description,
          priceCents: null,
          outcome: { kind: 'removed', source: owned.source, name: owned.name },
        });
      } else {
        toCreate.push({
          source: owned.source,
          code: code === '' ? owned.code : code,
          description: owned.description,
          unit: owned.unit,
          unitCostCents: price.cents,
          massKg: 0,
          sheetRow: rowNumber,
        });
        counts.updated += 1;
        rows.push({
          sheetRow: rowNumber,
          source,
          code,
          description,
          priceCents: price.cents,
          outcome: { kind: 'created', source: owned.source, code, mine: true },
        });
      }
      continue;
    }

    if (price.cents === null) {
      counts.blank += 1;
      rows.push({
        sheetRow: rowNumber,
        source,
        code,
        description,
        priceCents: null,
        outcome: { kind: 'blank' },
      });
      continue;
    }

    let outcome = matchRow(index, { source, code, description });
    if (outcome.kind === 'matched') {
      // Two sheet rows naming one catalogue row: the later one wins, and the
      // count says so because `applied` counts keys, not rows.
      toApply.set(outcome.rowKey, price.cents);
      counts.applied = toApply.size;
    } else if (outcome.kind === 'ambiguous') {
      // Ambiguous is still refused: two book rows fit and picking one would price
      // the wrong item. A code disambiguates it, and the preview says so.
      counts.ambiguous += 1;
    } else {
      /**
       * Not in the book: an item for the company's own catalogue.
       *
       * It needs a **description**, because that is the name the engine asks for —
       * a row with a code and no name could never be found again. It also needs a
       * group the bill of materials actually asks for, which the sheet states in its
       * `Source` column — the same name the catalogue API uses.
       */
      const group = source.trim();
      /**
       * The unit comes from the group, not from the sheet.
       *
       * The engine asks for 12.5 metres of a section and multiplies by the unit
       * price, so a row stored as `ea` would charge 12.5 × the price of one. A
       * column a customer types into must not be able to decide that — the sheet's
       * `Unit` column is printed for the customer's benefit and read by nothing.
       */
      const unit = unitFor(group);
      if (description === '') {
        outcome = {
          kind: 'invalid',
          reason: 'No description, so the engine would never ask for this item by name',
        };
        counts.invalid += 1;
      } else if (unit === null) {
        outcome = {
          kind: 'invalid',
          reason:
            group === ''
              ? 'No Source column value, so this item has no group to belong to'
              : `${group} is not a group the bill of materials asks for`,
        };
        counts.invalid += 1;
      } else {
        toCreate.push({
          source: group,
          code,
          description,
          unit,
          unitCostCents: price.cents,
          massKg: 0,
          sheetRow: rowNumber,
        });
        counts.created += 1;
        outcome = { kind: 'created', source: group, code, mine: false };
      }
    }

    rows.push({ sheetRow: rowNumber, source, code, description, priceCents: price.cents, outcome });
  }

  return { rows, toApply, toCreate, toRemove, counts };
}

/** One template row: a catalogue row, with empty columns for the company. */
function templateRow(source: CatalogueSource, row: BookRow): (string | number)[] {
  // Source, Category, Code, Description, Unit, Book price, Your code, Your price.
  // The last two are empty: this is a form, not a copy of the book's numbers
  // pretending to be an override.
  return [
    row.source,
    source.label,
    row.code,
    row.description,
    row.unit,
    row.baseCents / 100,
    '',
    '',
  ];
}

/**
 * The spreadsheet a company fills in.
 *
 * Every catalogue row is present, with the book's own price beside an empty
 * "Your price" column. A customer finds their items by filtering rather than
 * typing codes, and a row they leave empty keeps the book's price — so a partial
 * sheet is a valid sheet.
 *
 * The company's **own** items are listed at the end, with their price already
 * filled in. Two reasons, and the second is the important one:
 *
 *   - the file becomes a complete statement of what this company charges, so it can
 *     be handed round the office;
 *   - without them here, the only way to see or change an imported item is to
 *     remember it existed — and clearing its price is how it is taken out.
 *
 * Two sheets, not one: `Prices` is the data, `How to use` explains it. An
 * instruction on the same sheet would be the first thing a customer deletes.
 */
export async function buildTemplate(index: BookIndex, own: OwnItem[] = []): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shed Quoting';
  workbook.created = new Date(0);

  const prices = workbook.addWorksheet('Prices');
  prices.columns = [
    { header: 'Source', key: 'source', width: 20 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Code', key: 'code', width: 16 },
    { header: 'Description', key: 'description', width: 52 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Book price', key: 'book', width: 12 },
    /**
     * The company's own code for the item, and the reason the template has two
     * code columns.
     *
     * `Code` is the catalogue's, and it is what the importer matches on. A company
     * buying from a different distributor has its own code for the same steel —
     * `SHS1001003GA80` where the catalogue says `FBI15403` — and wants to see its
     * own code on the sheet it hands to its staff. Filling this column in changes
     * nothing about matching; leaving it blank changes nothing either. It exists
     * so the file a customer sends round their office says what their office says.
     */
    { header: 'Your code', key: 'yourCode', width: 18 },
    { header: 'Your price', key: 'yours', width: 12 },
  ];
  prices.getRow(1).font = { bold: true };
  prices.views = [{ state: 'frozen', ySplit: 1 }];

  for (const source of CATALOGUE_SOURCES) {
    for (const row of index.rows.filter((entry) => entry.source === source.source)) {
      prices.addRow(templateRow(source, row));
    }
  }

  /**
   * The company's own items, after the catalogue's.
   *
   * `Book price` is blank because there is no book row: this is the company's own
   * price, and it belongs in `Your price` where it is editable. `Code` carries their
   * code rather than ours, so the row is theirs end to end.
   */
  for (const item of own) {
    const label =
      CUSTOM_SOURCES.find((entry) => entry.source === item.source)?.label ?? item.source;
    prices.addRow([
      item.source,
      label,
      item.code,
      item.description,
      item.unit,
      '',
      '',
      item.unitCostCents / 100,
    ]);
  }

  // The "Your price" column is the only editable one, and it is styled as such:
  // a customer who types into `Book price` would expect their number to be used,
  // and it would not be.
  const yours = prices.getColumn('yours');
  yours.numFmt = '0.00';
  yours.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF3CC' },
  };
  prices.getColumn('book').numFmt = '0.00';

  const help = workbook.addWorksheet('How to use');
  help.columns = [{ width: 96 }];
  const lines = [
    'How to price your catalogue',
    '',
    '1. Go to the Prices sheet. Every item the quoting engine can use is listed there.',
    '2. Find the items you sell. Filtering on Category or Description is quicker than scrolling.',
    '3. Type your price per unit into the yellow "Your price" column.',
    '4. Leave a row empty to keep the supplier book price. A partial sheet is fine.',
    '   On a row you added yourself, an empty price takes the item out.',
    '5. Save the file and upload it in Settings > Prices > Import.',
    '',
    'About the columns',
    '',
    'Source         The catalogue group the item belongs to. Keep it: it makes the match',
    '               exact, and it is required for an item of your own.',
    'Category       The group a person sees (frame, sheeting, gutter, doors...).',
    'Code           The supplier code. Keep it: it is what identifies the row.',
    'Description    What the item is. Also used to match if a code is missing.',
    'Unit           What the price is per: m (metre), sqm, ea (each), pack or roll.',
    'Book price     The catalogue price, for reference. Changes here are ignored.',
    'Your code      Your own code for the item, if you have one. Optional: it is',
    '               never used to match, and blank is fine. Fill it in if the sheet',
    '               goes round your office and your staff know the item by your code.',
    'Your price     Your price. This is the only column that is read.',
    '',
    'If you buy from a different supplier',
    '',
    'You do not have to fit the catalogue. Add your own items at the bottom of the',
    'Prices sheet with a Source, a Code, a Description, a Unit and your price. A row',
    'that does not match anything in the catalogue is added to your own price list',
    'instead of being thrown away, and the quoting engine will use it from then on.',
    'Your own items are private to your company.',
    '',
    'Items you added before are already listed at the bottom of the Prices sheet,',
    'with your price filled in. Change a price there and it is updated. Empty the',
    '"Your price" cell on one of those rows and the item is taken out.',
    '',
    'The one thing you cannot change is which groups exist: Source must be one of the',
    'names in the Category column, because that is how the engine knows whether it is',
    'looking at a frame section, a sheet of cladding or a door.',
    '',
    'If a row is reported as "ambiguous" on upload',
    '',
    'It matched more than one catalogue item. Add the Code so it names exactly one.',
    'Nothing is guessed, because guessing could price the wrong item.',
    '',
    'You do not have to use this file',
    '',
    'If your own price list already has a code column and a price column, upload that',
    'instead. The importer reads the header row by name, so column order does not',
    'matter, and it accepts "Price" as well as "Your price".',
  ];
  for (const line of lines) help.addRow([line]);
  help.getRow(1).font = { bold: true, size: 14 };
  help.getColumn(1).alignment = { wrapText: false };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * A stable hash of what a company's prices were before an import.
 *
 * The operator is told what the import will change, and the count is what they
 * read. The hash exists so a second identical upload can be recognised rather
 * than applied twice for no reason.
 */
export function pricesFingerprint(byKey: Map<string, number>): string {
  const hash = createHash('sha256');
  for (const key of [...byKey.keys()].sort()) {
    hash.update(key);
    hash.update('\0');
    hash.update(String(byKey.get(key)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** True when `key` names a row the book contains. Exported for a caller's check. */
export function isBookKey(index: BookIndex, key: string): boolean {
  const parsed = parseRowKey(key);
  if (parsed === null) return false;
  return index.rows.some((row) => row.rowKey === key);
}
