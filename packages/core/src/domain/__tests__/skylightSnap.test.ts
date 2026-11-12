import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import type { ShedConfig, SkylightOption, DimensionedShed } from '../types';
import {
  roofSheets,
  skylightCollision,
  skylightOnSheet,
  skylightsOverlap,
  snapSkylightToSheet,
} from '../skylightSnap';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

const skylight = (patch: Partial<SkylightOption> = {}): SkylightOption => ({
  id: 'sk-1',
  kind: 'skylight',
  bay: 2,
  alongBay: 0.5,
  width: 762,
  height: 762,
  ...patch,
});

/** The reference book's roof cover. */
const COVER = 762;

describe('roofSheets', () => {
  it('lays sheets along the building length, from the front eave', () => {
    // 24 000 / 762 = 31.5, so 32 sheets and the last is an offcut.
    const sheets = roofSheets(shed({ length: 24000 }), COVER);
    expect(sheets).toHaveLength(32);
    expect(sheets[0]).toEqual({ index: 0, startMm: 0, coverMm: 762 });
    expect(sheets[1]?.startMm).toBe(762);
  });

  it('gives the last sheet its real width, not the nominal cover', () => {
    // 24 000 − 31 × 762 = 378 mm left. A skylight snapped to the nominal 762 here would
    // hang 384 mm past the end of the roof.
    const sheets = roofSheets(shed({ length: 24000 }), COVER);
    expect(sheets.at(-1)?.coverMm).toBe(24000 - 31 * 762);
    expect(sheets.at(-1)?.coverMm).toBe(378);
  });

  it('gives exactly the sheets when the length divides evenly', () => {
    const sheets = roofSheets(shed({ length: 762 * 20 }), COVER);
    expect(sheets).toHaveLength(20);
    expect(sheets.every((sheet) => sheet.coverMm === 762)).toBe(true);
  });

  it('gives nothing without a usable cover', () => {
    expect(roofSheets(shed(), 0)).toEqual([]);
    expect(roofSheets(shed({ length: 0 }), COVER)).toEqual([]);
  });
});

describe('snapSkylightToSheet', () => {
  it('snaps a skylight to the middle of the sheet it lands on', () => {
    const building = shed({ length: 24000, bays: 4 });
    // Bay 2 of 4 on a 24 m building runs 12 000..18 000; halfway is 15 000.
    // 15 000 / 762 = 19.68 → sheet 19, which starts at 14 478.
    const snap = snapSkylightToSheet(building, skylight({ alongBay: 0.5 }), COVER);
    expect(snap.sheet?.index).toBe(19);
    expect(snap.snappedCentreMm).toBe(14478 + 381);
  });

  it('reports a pane that straddles a sheet boundary as unaligned', () => {
    // Sheet 19 spans 14 478..15 240. A 900 mm pane centred at 15 000 runs 14 550..15 450,
    // so its right edge is 210 mm onto sheet 20.
    const building = shed({ length: 24000 });
    const snap = snapSkylightToSheet(building, skylight({ width: 900, height: 900 }), COVER);
    expect(snap.aligned).toBe(false);
  });

  it('reports a pane that sits inside one sheet as aligned', () => {
    // Centre it deliberately on a sheet's midpoint: sheet 17 spans 12 954..13 716, so a
    // 762 mm pane centred at 13 335 fills it exactly.
    const building = shed({ length: 24000, bays: 4 });
    const centreMm = 17 * 762 + 381;
    // Bay 2 spans 12 000..18 000, so the centre is 0.2225 along it.
    const alongBay = (centreMm - 12000) / 6000;
    const snap = snapSkylightToSheet(building, skylight({ bay: 2, alongBay }), COVER);
    expect(snap.sheet?.index).toBe(17);
    expect(snap.aligned).toBe(true);
  });

  it('refuses a pane wider than the narrow last sheet', () => {
    // The last sheet is 378 mm; a 762 mm pane cannot replace it, and letting it overhang
    // would put glass off the end of the roof.
    const building = shed({ length: 24000, bays: 32 });
    // Bay 31 spans 23 250..24 000; halfway is 23 625 — sheet 31, the 378 mm offcut.
    const snap = snapSkylightToSheet(building, skylight({ bay: 31, alongBay: 0.5 }), COVER);
    expect(snap.sheet?.index).toBe(31);
    expect(snap.refusal).toMatch(/378/);
  });

  it('names the narrow last sheet as narrow, not as a short pane', () => {
    // Two different reasons a sheet is too small, and the wrong sentence sends somebody
    // hunting for "a full sheet" that is the same width as the one they are on.
    const narrowLast = snapSkylightToSheet(
      shed({ length: 24000, bays: 32 }),
      skylight({ bay: 31, alongBay: 0.5 }),
      COVER,
    );
    expect(narrowLast.refusal).toMatch(/last sheet/);

    const tooWide = snapSkylightToSheet(
      shed({ length: 24000 }),
      skylight({ bay: 0, alongBay: 0.5, width: 1200, height: 900 }),
      COVER,
    );
    expect(tooWide.refusal).toMatch(/cut sheet on each side/);
    expect(tooWide.refusal).not.toMatch(/last sheet/);
  });

  it('accepts a pane exactly one sheet wide — the desktop’s own skylight size', () => {
    // `Skylight.Width` *is* `Plan.RoofSheetingSize` in the desktop (`Skylight.cs:38`), so a
    // skylight is by definition one sheet wide. This is the case the 900 mm default broke.
    const building = shed({ length: 24000, bays: 4 });
    const centreMm = 17 * 762 + 381;
    const alongBay = (centreMm - 12000) / 6000;
    const snap = snapSkylightToSheet(
      building,
      skylight({ bay: 2, alongBay, width: 762, height: 762 }),
      COVER,
    );
    expect(snap.refusal).toBeNull();
    expect(snap.aligned).toBe(true);
  });

  it('refuses when the book gives no cover', () => {
    const snap = snapSkylightToSheet(shed(), skylight(), 0);
    expect(snap.sheet).toBeNull();
    expect(snap.refusal).toMatch(/cover/i);
  });
});

describe('skylightOnSheet', () => {
  it('moves the skylight to its sheet centre, expressed as bay and alongBay', () => {
    const building = shed({ length: 24000, bays: 4 });
    const moved = skylightOnSheet(building, skylight({ alongBay: 0.1 }), COVER);
    // Whatever it does, it must land back on the same snapped millimetre.
    const check = snapSkylightToSheet(building, moved, COVER);
    expect(check.aligned).toBe(true);
    expect(moved.alongBay).toBeGreaterThan(0);
    expect(moved.alongBay).toBeLessThan(1);
  });

  it('round-trips: snapping a snapped skylight changes nothing', () => {
    const building = shed({ length: 24000, bays: 4 });
    const once = skylightOnSheet(building, skylight(), COVER);
    const twice = skylightOnSheet(building, once, COVER);
    expect(twice.bay).toBe(once.bay);
    expect(twice.alongBay).toBeCloseTo(once.alongBay, 6);
  });
});

describe('skylightsOverlap', () => {
  it('sees two skylights on the same spot', () => {
    const building = shed({ length: 24000, bays: 4 });
    expect(skylightsOverlap(skylight({ id: 'a' }), skylight({ id: 'b' }), building)).toBe(true);
  });

  it('does not see itself', () => {
    const building = shed({ length: 24000, bays: 4 });
    expect(skylightsOverlap(skylight({ id: 'a' }), skylight({ id: 'a' }), building)).toBe(false);
  });

  it('separates two skylights a bay apart', () => {
    const building = shed({ length: 24000, bays: 4 });
    expect(
      skylightsOverlap(skylight({ id: 'a', bay: 1 }), skylight({ id: 'b', bay: 2 }), building),
    ).toBe(false);
  });

  it('sees a collision the desktop missed, because it compares footprints', () => {
    // Two 762 mm panes 400 mm apart along the same bay: their starts differ, which is all
    // `Roof.HaveSkyLight` checked, but their rects overlap.
    const building = shed({ length: 24000, bays: 4 });
    const a = skylight({ id: 'a', bay: 2, alongBay: 0.45 });
    const b = skylight({ id: 'b', bay: 2, alongBay: 0.48 });
    expect(skylightCollision(building, b)).toBeNull(); // no options yet
    const withA: DimensionedShed = { ...building, options: [a] };
    expect(skylightCollision(withA, b)?.id).toBe('a');
  });
});
