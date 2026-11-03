/**
 * A company's own prices, applied over the shared book.
 *
 * ## Why this exists
 *
 * The price list import writes `price_row_overrides` and `company_catalogue_rows`, and until now
 * **nothing read them back into pricing**. The evaluate route called `openBook(hash).lookup`
 * directly and hardcoded `overrideVersion: 0`. So a company could load its supplier's price list,
 * see it accepted, and every quote would still price from the shared book — the import appeared to
 * work and changed nothing.
 *
 * That is the failure this file fixes: a decorator that wraps any `PriceLookup` and replaces the
 * unit cost of a row the company has priced differently.
 *
 * ## Why a decorator and not a second lookup
 *
 * `PriceLookup` has twenty-odd methods, each returning a different row shape, and the book's schema
 * changes between publications. Reimplementing them would be a second source of prices that could
 * disagree with the first. Wrapping keeps **one** implementation of "how to find a row" and changes
 * only its price.
 *
 * ## Why every returned row is rewritten, not just the ones with an override
 *
 * A row's `unitCost` is what the BOM multiplies. If a method returned a row with the book's price and
 * the caller did not go through `apply`, the override would be silently ignored for that member — and
 * a quote would be wrong in one line, which is the hardest kind of wrong to notice. So the wrapper
 * intercepts **every** method whose result carries a `rowKey` and applies the override, rather than
 * asking each one to remember.
 *
 * ## What an override does not change
 *
 * Only the unit cost. The description, the unit and the mass stay as the book states them — a company
 * buying a different *price* for the same section is not buying a different section, and letting a
 * spreadsheet rewrite a description would let an import rename a material in the BOM.
 */

import type { PriceLookup, PriceRow } from './types';
import type { OwnItem } from './ownItems';

/** A company's price for one row of the book, keyed by the book's own natural key. */
export interface RowOverride {
  /** `source:field=value&…`, as `buildRowKey` produces. */
  rowKey: string;
  /** Whole cents. */
  unitCost: number;
}

/** A company's own material the shared book has never heard of. */
export interface CustomRow {
  source: string;
  /** The normalised name the engine asks for. */
  name: string;
  description: string;
  unit: string;
  unitCost: number;
  massKg: number;
}

/** What a lookup knows after its overrides are applied. */
export interface OverrideSet {
  overrides: RowOverride[];
  custom: CustomRow[];
  /** The version a quote records, so a revision can name the prices it was built from. */
  version: number;
}

/** True when a value looks like a priced row from the book. */
function isRow(value: unknown): value is PriceRow {
  return typeof value === 'object' && value !== null && 'rowKey' in value && 'unitCost' in value;
}

/**
 * Wrap a lookup so a company's overrides win.
 *
 * A `Proxy` rather than a hand-written class: the interface is wide and gains methods over time, and
 * a wrapper that enumerated them would silently stop overriding a new one. This applies to **any**
 * method the book exposes that returns a row, today and later.
 */
export function withOverrides(lookup: PriceLookup, set: OverrideSet): PriceLookup {
  const prices = new Map<string, number>();
  for (const override of set.overrides) prices.set(override.rowKey, override.unitCost);

  /** Replace a row's cost, leaving everything else as the book stated it. */
  const apply = (row: PriceRow): PriceRow => {
    const price = prices.get(row.rowKey);
    return price === undefined ? row : { ...row, unitCost: price };
  };

  /**
   * A company's own material, by the name the engine asks for.
   *
   * These are rows the shared book does not carry at all — a different supplier's section. The
   * lookup methods cannot find them because the book has nothing to find, so they are consulted
   * first by the same name the engine uses.
   */
  const custom = new Map<string, CustomRow>();
  for (const row of set.custom) custom.set(`${row.source}\u0000${row.name}`, row);

  /** A custom row shaped like a book row, so the BOM prices it the same way. */
  const asRow = (row: CustomRow): PriceRow => ({
    code: row.name,
    description: row.description,
    unitCost: row.unitCost,
    massKg: row.massKg,
    // The same key shape an override would use, so an own item can be re-priced by an import too.
    rowKey: `${row.source}:name=${encodeURIComponent(row.name)}`,
  });

  return new Proxy(lookup, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver) as unknown;
      if (typeof original !== 'function') return original;

      return (...args: unknown[]): unknown => {
        /*
         * Own materials first. `frame('C15024')` on a company that buys its own C15024 must return
         * that row, not the book's — that is what "a different factory" means, and the reason the
         * `company_catalogue_rows` table exists at all.
         */
        const sourceName = sourceForMethod(String(property));
        if (sourceName !== undefined && typeof args[0] === 'string') {
          const own = custom.get(`${sourceName}\u0000${args[0]}`);
          if (own !== undefined) return asRow(own);
        }

        const result = (original as (...inner: unknown[]) => unknown).apply(target, args);

        // A single row, a list of rows, or neither. Anything that carries a row key is re-priced.
        if (isRow(result)) return apply(result);
        if (Array.isArray(result)) {
          return result.map((entry) => (isRow(entry) ? apply(entry) : entry));
        }
        return result;
      };
    },
  });
}

/**
 * The `company_catalogue_rows.source` a lookup method reads from.
 *
 * A small, explicit map rather than a guess: the method name and the catalogue source are different
 * vocabularies (`frame` reads `cost_frame`, `purlin` reads `cost_purlin`), and inferring one from the
 * other would silently miss. A method not listed here simply has no own-material path, which is
 * correct for the ones keyed by a wind region or a state.
 */
function sourceForMethod(method: string): string | undefined {
  switch (method) {
    case 'frame':
      return 'cost_frame';
    case 'purlin':
      return 'cost_purlin';
    case 'sheeting':
      return 'view_cost_sheeting';
    case 'gutter':
      return 'gutter';
    case 'downpipe':
      return 'downpipe';
    case 'flashing':
      return 'flashing';
    case 'bracing':
      return 'cost_bracing';
    case 'bolt':
      return 'cost_bolt';
    case 'screw':
      return 'screws';
    case 'miscOption':
      return 'misc_option';
    default:
      return undefined;
  }
}

/** True when a set carries nothing, so the caller can skip wrapping entirely. */
export function isEmptyOverrideSet(set: OverrideSet): boolean {
  return set.overrides.length === 0 && set.custom.length === 0;
}

/** Convert the database's own-item rows to the shape the decorator wants. */
export function customRowsFromOwnItems(items: OwnItem[]): CustomRow[] {
  return items.map((item) => ({
    source: item.source,
    name: item.name,
    description: item.description,
    unit: item.unit,
    unitCost: item.unitCostCents,
    // The stored row carries no mass: an own item is a price for a name, and mass is not what the
    // company is asserting. Zero is honest — the BOM reports it as unpriced mass rather than
    // inventing a weight that would then appear in a delivery calculation.
    massKg: 0,
  }));
}
