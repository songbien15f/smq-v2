import { describe, it, expect } from 'vitest';
import { withOverrides, isEmptyOverrideSet, customRowsFromOwnItems } from '../overrides';
import type { PriceLookup, PriceRow } from '../types';

/**
 * Applying a company's prices over the shared book.
 *
 * ## Why these tests matter more than most
 *
 * The tables existed and were written by the import, and **nothing read them** — a company could load
 * its supplier's price list and every quote would still price from the shared book. These tests are
 * what prove the decorator actually changes a number, because a decorator that silently returned the
 * book's price would look correct in every other way.
 */

/** A minimal lookup with the two row-returning shapes that matter. */
function fakeLookup(rows: Record<string, PriceRow>): PriceLookup {
  return {
    frame: (size: string) => rows[`frame:${size}`],
    purlin: (code: string) => rows[`purlin:${code}`],
    sheeting: () => undefined,
    door: () => undefined,
    window: () => undefined,
    colour: () => undefined,
    colourName: () => undefined,
    margin: () => 1,
    structureId: () => undefined,
    frameSchedule: () => undefined,
    devided: () => [],
    windSpeed: () => 0,
    delivery: () => 0,
    gutter: () => undefined,
    gutterBracket: () => undefined,
    miscOption: () => undefined,
    downpipe: () => undefined,
    flashing: () => undefined,
    purlinDepth: () => 0,
    bracketExact: () => undefined,
    bracket: () => undefined,
    bracketForPurlin: () => undefined,
    bracing: () => undefined,
    bolt: () => undefined,
    screw: () => undefined,
  } as unknown as PriceLookup;
}

const frameRow: PriceRow = {
  code: 'C15024',
  description: '150 x 24 C-section',
  unitCost: 1000,
  massKg: 4.2,
  rowKey: 'cost_frame:code=C15024&description=150%20x%2024%20C-section',
};

describe('withOverrides', () => {
  it('replaces the unit cost of an overridden row', () => {
    const wrapped = withOverrides(fakeLookup({ 'frame:C15024': frameRow }), {
      overrides: [{ rowKey: frameRow.rowKey, unitCost: 1234 }],
      custom: [],
      version: 1,
    });

    expect(wrapped.frame('C15024')?.unitCost).toBe(1234);
  });

  it('leaves everything else about the row as the book stated it', () => {
    const wrapped = withOverrides(fakeLookup({ 'frame:C15024': frameRow }), {
      overrides: [{ rowKey: frameRow.rowKey, unitCost: 1234 }],
      custom: [],
      version: 1,
    });

    const row = wrapped.frame('C15024');
    // A company buying a different price is not buying a different section: a spreadsheet must not
    // be able to rename a material in the BOM.
    expect(row?.description).toBe(frameRow.description);
    expect(row?.massKg).toBe(frameRow.massKg);
    expect(row?.code).toBe(frameRow.code);
  });

  it('leaves a row the company has not priced alone', () => {
    const other: PriceRow = { ...frameRow, code: 'C20024', rowKey: 'cost_frame:code=C20024' };
    const wrapped = withOverrides(fakeLookup({ 'frame:C20024': other }), {
      overrides: [{ rowKey: frameRow.rowKey, unitCost: 1234 }],
      custom: [],
      version: 1,
    });

    expect(wrapped.frame('C20024')?.unitCost).toBe(other.unitCost);
  });

  it('overrides every method that returns a row, not only the ones it knows about', () => {
    // The decorator works by intercepting results, so a method the author never considered is still
    // covered. This is the property that makes adding a lookup method safe.
    const purlinRow: PriceRow = {
      code: 'TH64075',
      description: 'TH64 purlin',
      unitCost: 2000,
      massKg: 3,
      rowKey: 'cost_purlin:code=TH64075',
    };

    const wrapped = withOverrides(fakeLookup({ 'purlin:TH64075': purlinRow }), {
      overrides: [{ rowKey: purlinRow.rowKey, unitCost: 2500 }],
      custom: [],
      version: 1,
    });

    expect(wrapped.purlin('TH64075')?.unitCost).toBe(2500);
  });

  it('serves a company’s own material the book has never heard of', () => {
    // A row the shared book does not carry at all: the whole point of `company_catalogue_rows`.
    const wrapped = withOverrides(fakeLookup({}), {
      overrides: [],
      custom: [
        {
          source: 'cost_frame',
          name: 'C15024',
          description: 'Our own 150x24',
          unit: 'm',
          unitCost: 1500,
          massKg: 0,
        },
      ],
      version: 1,
    });

    const row = wrapped.frame('C15024');
    expect(row?.unitCost).toBe(1500);
    expect(row?.description).toBe('Our own 150x24');
  });

  it('prefers the company’s own material over the book’s', () => {
    const wrapped = withOverrides(fakeLookup({ 'frame:C15024': frameRow }), {
      overrides: [],
      custom: [
        {
          source: 'cost_frame',
          name: 'C15024',
          description: 'Ours',
          unit: 'm',
          unitCost: 1500,
          massKg: 0,
        },
      ],
      version: 1,
    });

    // "A different factory" means their material wins, or the own-item table is pointless.
    expect(wrapped.frame('C15024')?.unitCost).toBe(1500);
  });

  it('passes through values that are not rows', () => {
    const wrapped = withOverrides(fakeLookup({}), { overrides: [], custom: [], version: 1 });

    expect(wrapped.margin(1, 'QLD')).toBe(1);
    expect(wrapped.windSpeed('A')).toBe(0);
    expect(wrapped.devided('A', 3000)).toEqual([]);
  });
});

describe('isEmptyOverrideSet', () => {
  it('is true only when nothing is priced', () => {
    expect(isEmptyOverrideSet({ overrides: [], custom: [], version: 0 })).toBe(true);
    expect(isEmptyOverrideSet({ overrides: [{ rowKey: 'k', unitCost: 1 }], custom: [], version: 1 })).toBe(false);
  });
});

describe('customRowsFromOwnItems', () => {
  it('converts the stored own items to the decorator shape', () => {
    const rows = customRowsFromOwnItems([
      { source: 'cost_frame', name: 'c15024', code: 'C15024', description: 'Our section', unit: 'm', unitCostCents: 1500 },
    ]);

    expect(rows[0]).toEqual({
      source: 'cost_frame',
      name: 'c15024',
      description: 'Our section',
      unit: 'm',
      unitCost: 1500,
      // No mass is stored, and inventing one would put a made-up weight into a delivery figure.
      massKg: 0,
    });
  });
});
