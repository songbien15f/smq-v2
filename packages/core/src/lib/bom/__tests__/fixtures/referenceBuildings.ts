/**
 * Reference buildings with hand-calculated answers.
 *
 * Every number here is derived on paper from the building's dimensions and the
 * contract of a synthetic price book — not from running the engine. That is the
 * point: a test that asserts what the code already does proves only that the
 * code has not changed. A test that asserts 61.6 metres of sheet for a 10 m run
 * at a 1 m cover proves the geometry.
 *
 * The synthetic book is deliberately simple: 1 m cover, $10 per linear metre,
 * 2 kg per linear metre. A mistake in metres, sheets or square metres shows up
 * as an order-of-magnitude difference rather than a rounding argument.
 */

import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, ShedOption, DimensionedShed } from '@/domain/types';
import type { MaterialUnitContract } from '@/lib/pricing/catalogueManifest';
import type { PriceLookup } from '@/lib/pricing/types';
import type { MaterialKind } from '@/lib/bom/materialUnits';

/**
 * A described building for BOM tests.
 *
 * `TEST_SHED` rather than `DEFAULT_SHED`: since dimensions became nullable, `DEFAULT_SHED` has none,
 * and a BOM test that cannot name a span has nothing to build. The type is `DimensionedShed` so the
 * compiler knows the fixture is complete.
 */
export const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({
  ...TEST_SHED,
  ...patch,
});

/** The synthetic book: one metre of cover, ten dollars and two kilos per metre. */
export const SYNTHETIC_CONTRACTS: Record<MaterialKind, MaterialUnitContract> = {
  sheeting: {
    sourceKey: 'test_sheeting.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: $10 and 2 kg per linear metre of sheet.',
  },
  frame: {
    sourceKey: 'test_frame.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: $16.96 and 5.64 kg per metre of section.',
  },
  purlin: {
    sourceKey: 'test_purlin.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: $12.18 and 4.5 kg per metre.',
  },
  fixings: {
    sourceKey: 'test_fixings.mass',
    priceBasis: 'pack',
    massBasis: 'ea',
    status: 'supported',
    note: 'Test book: pack price, per-piece mass.',
  },
  gutter: {
    sourceKey: 'test_gutter.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: per metre.',
  },
  flashing: {
    sourceKey: 'test_flashing.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: per metre.',
  },
  downpipe: {
    sourceKey: 'test_downpipe.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Test book: per metre.',
  },
  opening: {
    sourceKey: 'test_opening.mass',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'supported',
    note: 'Test book: per item.',
  },
  option: {
    sourceKey: 'test_option.mass',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'supported',
    note: 'Test book: per item.',
  },
  bracket: {
    sourceKey: 'test_bracket.mass',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'supported',
    note: 'Test book: per plate.',
  },
  bracing: {
    sourceKey: 'test_bracing.mass',
    priceBasis: 'roll',
    massBasis: 'roll',
    status: 'supported',
    note: 'Test book: per roll.',
  },
};

/**
 * A synthetic priced row.
 *
 * `rowKey` is required on every `PriceRow` now, because a company's price names
 * one catalogue row. The fixture builds a key in the same shape the real book
 * does (`<source>:<field>=<value>`), so a test that sets a price for this row
 * exercises the same matching the production lookup uses.
 */
const row = (
  code: string,
  description: string,
  unitCost: number,
  massKg: number,
  source = 'cost_frame',
) => ({
  code,
  description,
  unitCost,
  massKg,
  rowKey: `${source}:code=${encodeURIComponent(code)}&description=${encodeURIComponent(description)}`,
});

export const syntheticLookup = (over: Partial<Record<string, unknown>> = {}): PriceLookup =>
  ({
    frame: () => row('FR-1', '100 x 100 SHS', 1696, 5.64),
    purlin: (code: string) => row(`PU-${code}`, code, 1218, 4.5),
    purlinDepth: () => 150,
    sheeting: () => ({
      ...row('SH-1', '0.42 Corro', 1000, 2),
      profile: 'Corro',
      bmt: 0.42,
      coverageMm: 1000,
      roofInternalSpanMm: 100_000,
      roofEndSpanMm: 100_000,
      wallInternalSpanMm: 100_000,
      wallEndSpanMm: 100_000,
      wallSideSpanMm: 100_000,
    }),
    door: () => row('DR-1', 'PA door', 51_167, 25),
    window: () => row('WN-1', 'Window', 16_312, 8),
    colour: () => undefined,
    colourName: () => undefined,
    margin: () => 1,
    // No margin table in a synthetic book: a structure resolves to no id, so the
    // evaluator falls back to the common rate rather than pricing at cost.
    structureId: () => undefined,
    devided: () => [
      {
        code: 'A2',
        standardSpan: 6000,
        purlinSpan: 900,
        girtSpan: 900,
        openDesign: true,
        purlinMaterial: 'TH64075',
      },
    ],
    windSpeed: () => 41,
    delivery: () => 0,
    gutter: () => row('GU-1', '115 Quad', 410, 0),
    gutterBracket: () => row('GB-1', '115 Quad bracket', 122, 0),
    downpipe: () => row('DP-1', '90mm RND', 1097, 1.4),
    flashing: (type: string) => row(`FL-${type}`, type, 686, 0),
    bracket: () => row('BR-1', 'BP89A', 2619, 2),
    bracketExact: () => row('BR-K', 'KBC20-7.5L', 1985, 1),
    bracketForPurlin: () => row('BR-F', 'EPHB15-Z150', 430, 0.47),
    bracing: () => ({ ...row('BS-1', '30x1.2mm', 1873, 10), rollMetres: 30 }),
    bolt: () => ({ ...row('BO-1', 'M16x40-8.8', 534, 0.125), qtyPerPack: 20 }),
    screw: () => ({ ...row('SC-1', 'ZIPxx', 2103, 1.16), qtyPerPack: 100 }),
    ...over,
  }) as never;

/** A building with no openings, so only the geometry under test contributes. */
export const plainShed = (patch: Partial<DimensionedShed> = {}): DimensionedShed =>
  shed({ span: 6000, length: 10_000, height: 2400, roofPitchDeg: 0, bays: 2, openings: [], ...patch });

export const option = (patch: Partial<ShedOption>): ShedOption => patch as ShedOption;
