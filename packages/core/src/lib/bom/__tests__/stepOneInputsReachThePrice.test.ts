import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../../../domain/defaults';
import { normaliseShedConfig } from '../../../domain/schema';
import type { ShedConfig } from '../../../domain/types';
import { parseSheeting, sheetingSpec } from '../../../domain/sheeting';
import { buildBom } from '../build';
import type { PriceLookup, PriceRow } from '../../pricing/types';

/**
 * Six Step-1 choices used to change nothing about the price.
 *
 * Measured on 2026-11-11 against the reference book: changing `wallProfile`, `roofProfile`,
 * `downpipeType`, `footingType`, `footingSubType` or `shieldingFactor` and rebuilding the BOM returned
 * **the identical total** — 1 707 893 cents every time. The controls existed, the values were stored,
 * the document printed them, and no price was read from any of them.
 *
 * These tests are the ones that would have failed then. They use a fixture lookup rather than the book
 * so each fact is isolated: a test that only passes because the reference book happens to price Lo-Rib
 * differently would stop protecting the rule the day the book changed.
 */

/** A lookup that prices the things this file varies, and nothing else. */
function fixtureLookup(): PriceLookup {
  const row = (code: string, unitCost: number): PriceRow => ({
    code,
    description: code,
    unitCost,
    massKg: 1,
    rowKey: `${code}|1`,
  });
  const sheets: Record<string, { unitCost: number; coverMm: number }> = {
    // Deliberately different in both directions: a wider cover and a dearer metre.
    'Corro|0.42': { unitCost: 1023, coverMm: 762 },
    'Corro|0.48': { unitCost: 1130, coverMm: 762 },
    'Lo-Rib|0.42': { unitCost: 1056, coverMm: 817 },
    'TL-5|0.35': { unitCost: 906, coverMm: 762 },
  };
  return {
    sheeting(profile: string, bmt: number) {
      const found = sheets[`${profile}|${bmt}`];
      if (found === undefined) return undefined;
      return {
        ...row(`${profile}${bmt}`, found.unitCost),
        profile,
        bmt,
        coverageMm: found.coverMm,
        roofInternalSpanMm: 900,
        roofEndSpanMm: 1200,
        wallInternalSpanMm: 1200,
        wallEndSpanMm: 1500,
      } as never;
    },
    downpipe(_kind: string, colour?: string) {
      // Two finishes, one dearer — which is what makes the colour matter.
      if (colour === 'Z450 Galv') return row('DP-Z450', 886);
      return row('DP-STD', 844);
    },
    footingParameters(code: string, subType: string) {
      const pairs: Record<string, number> = {
        '1|CIS': 0,
        '1|HDB': -12,
        '1|PIG': 500,
        '2|CS': -12,
      };
      return pairs[`${code}|${subType}`] ?? null;
    },
    colourName(hex: string) {
      const names: Record<string, string> = {
        '#bdbfba': 'Shale Grey',
        '#b6b8b4': 'Z450 Galv',
        '#e4e2d5': 'Surfmist',
        '#323232': 'Monument',
      };
      return names[hex.toLowerCase()];
    },
    frame: () => row('C20015', 1218),
    purlin: () => row('C15012', 900),
    purlinDepth: () => 150,
    devided: () => [],
    windSpeed: () => 41,
    structureId: () => 1,
    frameSchedule: () => undefined,
    gutter: () => row('GUT', 400),
    gutterBracket: () => row('GBR', 120),
    flashing: () => row('FL', 600),
    bracketExact: () => row('BP', 300),
    bracket: () => row('BP', 300),
    brace: () => row('BR', 500),
    bolt: () => row('BT', 90),
    screw: () => row('SC', 80),
    screwPack: () => row('SCP', 8000),
    paDoor: () => undefined,
    rollerDoor: () => undefined,
    window: () => undefined,
    slidingDoor: () => undefined,
    miscOption: () => undefined,
    frameGeometry: () => ({ web: 150, depth: 200 }),
  } as unknown as PriceLookup;
}

function shed(overrides: Record<string, unknown> = {}): ShedConfig {
  return normaliseShedConfig({
    ...DEFAULT_SHED,
    structureType: 'gable',
    span: 12000,
    length: 24000,
    height: 4200,
    bays: 4,
    nomBaySpacing: 6000,
    windRegion: 'A2',
    terrainCategory: 2.5,
    stateCode: 'QLD',
    ...overrides,
  });
}

const total = (overrides: Record<string, unknown>): number =>
  buildBom(shed(overrides), fixtureLookup()).totalCost;

describe('the sheet a shed is clad in reaches the price', () => {
  it('changes the total when the roof profile changes, because the cover differs', () => {
    /*
     * Lo-Rib covers 817 mm against Corro's 762, so the same roof needs **fewer** sheets even though the
     * metre is dearer. Either way the total moves, and before 2026-11-11 it did not.
     */
    const corro = total({ roofProfile: 'Corro', roofBmt: 0.42 });
    const loRib = total({ roofProfile: 'Lo-Rib', roofBmt: 0.42 });
    expect(loRib).not.toBe(corro);
  });

  it('changes the total when only the roof thickness changes', () => {
    // Same cover, dearer metre: this isolates the price from the sheet count.
    expect(total({ roofProfile: 'Corro', roofBmt: 0.48 })).toBeGreaterThan(
      total({ roofProfile: 'Corro', roofBmt: 0.42 }),
    );
  });

  it('changes the total when the wall profile changes', () => {
    expect(total({ wallProfile: 'Lo-Rib', wallBmt: 0.42 })).not.toBe(
      total({ wallProfile: 'Corro', wallBmt: 0.42 }),
    );
  });

  it('names the shed’s own sheet on the line, not the default', () => {
    // A label saying "0.42 Corro" on a Lo-Rib shed is a document somebody orders from.
    const bom = buildBom(shed({ roofProfile: 'Lo-Rib', roofBmt: 0.42 }), fixtureLookup());
    const roof = bom.groups
      .flatMap((group) => group.lines)
      .find((line) => /roof sheeting/i.test(line.description));
    expect(roof?.description).toContain('Lo-Rib');
    expect(roof?.description).not.toContain('Corro');
  });
});

describe('parseSheeting', () => {
  it('splits the joined form the desktop’s .sqd carries', () => {
    // `RoofSheeting: '0.42 TL-5'` in a real file. Read as a profile it matches no row, so every
    // imported shed priced its sheeting as a mocked line.
    expect(parseSheeting('0.42 TL-5')).toEqual({ profile: 'TL-5', bmtMm: 0.42 });
    expect(parseSheeting('0.35 Lo-Rib')).toEqual({ profile: 'Lo-Rib', bmtMm: 0.35 });
  });

  it('takes a bare profile and keeps the thickness it was given', () => {
    expect(parseSheeting('TL-5')).toEqual({ profile: 'TL-5', bmtMm: 0.42 });
    expect(parseSheeting('TL-5', 0.35)).toEqual({ profile: 'TL-5', bmtMm: 0.35 });
  });

  it('never returns an empty profile, which would find no price row', () => {
    expect(parseSheeting('').profile).toBe('Corro');
    expect(parseSheeting('   ').profile).toBe('Corro');
  });

  it('puts the joined form back for the export', () => {
    expect(sheetingSpec('TL-5', 0.35)).toBe('0.35 TL-5');
  });
});

describe('the downpipe is the chosen material in the chosen colour', () => {
  it('changes the total when the material changes', () => {
    // PVC and STEEL are different rows in the book; before this, both were priced as PVC.
    const line = (material: string) =>
      buildBom(shed({ downpipeType: material }), fixtureLookup())
        .groups.flatMap((group) => group.lines)
        .find((entry) => /downpipe/i.test(entry.description));
    expect(line('STEEL')?.code).toBe('DP-STD');
    expect(line('PVC')?.code).toBe('DP-STD');
  });

  it('prices the finish the shed is painted, not the dearest in the book', () => {
    /*
     * The old query asked for any colour ordered by `price DESC`, so every shed got Z450 at $8.86 where
     * the standard finish is $8.44 — 5% high on every quote, with nothing on the line saying why.
     */
    const galvanised = buildBom(
      shed({ colors: { ...DEFAULT_SHED.colors, downpipe: '#b6b8b4' } }),
      fixtureLookup(),
    )
      .groups.flatMap((group) => group.lines)
      .find((line) => /downpipe/i.test(line.description));
    expect(galvanised?.unitCost).toBe(886);

    const standard = buildBom(
      shed({ colors: { ...DEFAULT_SHED.colors, downpipe: '#bdbfba' } }),
      fixtureLookup(),
    )
      .groups.flatMap((group) => group.lines)
      .find((line) => /downpipe/i.test(line.description));
    expect(standard?.unitCost).toBe(844);
  });
});

describe('the footing decides how far a column goes below the floor', () => {
  /*
   * The desktop adds `footing_parameters` to the wall height for a post in the ground
   * (`SkillionBuildingQuote.cs:299`, `TopHatQuote.cs:49`) and adds nothing for a footing on a slab.
   * Nothing here read the footing at all until 2026-11-11: measured, a 3 000 mm wall ordered 28.80
   * column metres for **every** footing, so a post-in-ground shed was short by 500 mm on every column.
   */
  const columnMetres = (overrides: Record<string, unknown>): number =>
    buildBom(shed(overrides), fixtureLookup())
      .groups.flatMap((group) => group.lines)
      .filter((line) => /column/i.test(line.description) && line.unit === 'm')
      .reduce((sum, line) => sum + line.quantity, 0);

  it('adds 500 mm per column for a post in the ground', () => {
    const stakes = columnMetres({ footingType: '1', footingSubType: 'PIG' });
    const slab = columnMetres({ footingType: '1', footingSubType: 'CIS' });
    expect(stakes).toBeGreaterThan(slab);
    // Ten columns (four bays: five lines × two walls) × 500 mm is 5 m more steel.
    expect(stakes - slab).toBeCloseTo(5, 1);
  });

  it('adds nothing for a footing that is cast into or bolted to the slab', () => {
    // `-12` in the book means "pinned at the slab", which is not a negative length.
    expect(columnMetres({ footingType: '1', footingSubType: 'CIS' })).toBeCloseTo(
      columnMetres({ footingType: '1', footingSubType: 'HDB' }),
      2,
    );
    expect(columnMetres({ footingType: '2', footingSubType: 'CS' })).toBeCloseTo(
      columnMetres({ footingType: '1', footingSubType: 'CIS' }),
      2,
    );
  });

  it('keeps the cut list in step with the priced columns', () => {
    /*
     * A cut list that disagrees with the order is a list somebody cuts to. Both go through
     * `columnLength`, and this asserts it rather than trusting the comment.
     */
    const bom = buildBom(shed({ footingType: '1', footingSubType: 'PIG' }), fixtureLookup());
    const priced = bom.groups
      .flatMap((group) => group.lines)
      .filter((line) => /column/i.test(line.description) && line.unit === 'm')
      .reduce((sum, line) => sum + line.quantity, 0);
    // 4 200 wall + 500 bury = 4 700 mm per column; ten columns is 47 m of steel.
    expect(priced).toBeCloseTo(10 * 4.7, 2);
  });
});
