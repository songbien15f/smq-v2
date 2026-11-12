import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, DimensionedShed } from '@/domain/types';
import {
  buildInfillColumns,
  infillLength,
  infillPositions,
  infillSetback,
  respaceAroundDoors,
  type InfillGeometry,
} from '../infill';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

/** The default shed's frame: C15012 end columns (depth 152), TH64075 purlins (64). */
const geometry = (patch: Partial<InfillGeometry> = {}): InfillGeometry => ({
  count: 2,
  section: 'C20024',
  endColumnDepth: 152,
  purlinDepth: 64,
  centreMm: 90,
  kneeEdgeCode: 92,
  footingAllowanceMm: 450,
  postInGround: true,
  ...patch,
});

describe('infillPositions', () => {
  it('spreads two columns across a 12 m span, mirrored about the ridge', () => {
    // step = (12000 − 2×50) / 3 = 3966.67; positions 4017 and 7983.
    const positions = infillPositions(12000, 2, 50);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toBe(4017);
    expect(positions[1]).toBe(7983);
    // Mirrored: the two add up to the span.
    expect(positions[0]! + positions[1]!).toBe(12000);
  });

  it('puts a single column on the ridge', () => {
    const positions = infillPositions(12000, 1, 50);
    expect(positions).toEqual([6000]);
  });

  it('gives three columns for a count of three, the middle one on the ridge', () => {
    // span − 2×50 = 11900, / 4 = 2975 → 3025 and 8975; the pair meets at index 2,
    // so the middle column takes 6000 rather than two columns at the same place.
    const positions = infillPositions(12000, 3, 50);
    expect(positions).toEqual([3025, 6000, 8975]);
  });

  it('declines a span under 3 m, where the corner columns carry the gable', () => {
    // The desktop's guard, and the same threshold the spec's R3 uses.
    expect(infillPositions(2900, 2, 50)).toEqual([]);
    expect(infillPositions(3000, 2, 50).length).toBeGreaterThan(0);
  });

  it('gives nothing when the design names no infill', () => {
    expect(infillPositions(12000, 0, 50)).toEqual([]);
  });

  it('never emits a duplicate position', () => {
    // A narrow span with a large setback can round two positions onto one
    // millimetre. Two entries would price two columns and build one.
    const positions = infillPositions(6000, 3, 400);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('infillSetback', () => {
  it('sets the column in by half the frame depth less the punch centre', () => {
    // (2 × 64 + 152 − 90) / 2 = 95.
    expect(infillSetback(geometry())).toBe(95);
  });

  it('truncates rather than rounding, because a clash is a clash', () => {
    // (2 × 63 + 151 − 90) / 2 = 93.5 → 93.
    expect(infillSetback(geometry({ purlinDepth: 63, endColumnDepth: 151 }))).toBe(93);
  });
});

describe('infillLength', () => {
  it('runs from the eave up the pitch, and a column near the ridge is taller', () => {
    const inner = infillLength(shed(), 6000, geometry(), 95);
    const outer = infillLength(shed(), 4017, geometry(), 95);
    expect(inner).toBeGreaterThan(outer);
  });

  it('measures to the nearer corner, so both sides of the ridge agree', () => {
    // A column at 4017 and one at 7983 are the same distance from their corners and
    // must be cut the same length, or the building is asymmetric.
    const left = infillLength(shed(), 4017, geometry(), 95);
    const right = infillLength(shed(), 7983, geometry(), 95);
    expect(left).toBe(right);
  });

  it('adds the footing only for a column cast in the ground', () => {
    const inGround = infillLength(shed(), 6000, geometry(), 95);
    const onSlab = infillLength(shed(), 6000, geometry({ postInGround: false }), 95);
    expect(inGround - onSlab).toBe(450);
  });

  it('drops the knee edge off the top, as the desktop does', () => {
    const withKnee = infillLength(shed(), 6000, geometry(), 95);
    const noKnee = infillLength(shed(), 6000, geometry({ kneeEdgeCode: 0 }), 95);
    expect(noKnee - withKnee).toBe(92);
  });
});

describe('buildInfillColumns', () => {
  it('gives both ends the same columns', () => {
    const { columns } = buildInfillColumns(shed(), geometry());
    expect(columns).toHaveLength(4);
    const front = columns.filter((column) => column.end === 'front');
    const back = columns.filter((column) => column.end === 'back');
    expect(front).toHaveLength(2);
    expect(back).toHaveLength(2);
    expect(front.map((column) => column.positionMm)).toEqual(
      back.map((column) => column.positionMm),
    );
    expect(front.map((column) => column.lengthMm)).toEqual(back.map((column) => column.lengthMm));
  });

  it('gives an open gable end no columns, because there is no wall to carry', () => {
    const open = shed({ endOpening: { left: true, right: false } });
    const { columns } = buildInfillColumns(open, geometry());
    expect(columns).toHaveLength(2);
    expect(columns.every((column) => column.end === 'back')).toBe(true);
  });

  it('gives no columns when both gable ends are open', () => {
    const open = shed({ endOpening: { left: true, right: true } });
    expect(buildInfillColumns(open, geometry()).columns).toEqual([]);
  });

  it('re-spaces the columns around a roller door instead of withholding them', () => {
    // R5. The desktop never leaves the gable unbraced: it moves, splits or drops the
    // column the door would cut through. Withholding them was my earlier stopgap.
    const withDoor = shed({
      openings: [
        {
          id: 'd1',
          type: 'roller_door',
          width: 3000,
          height: 2400,
          sill: 0,
          wall: 'front',
          align: 'center',
          offset: null,
          swing: null,
          track: null,
          series: 'B',
        },
      ],
    });
    const result = buildInfillColumns(withDoor, geometry());
    // The front end still has columns — re-spaced, not removed — and the back end is
    // untouched because it has no door.
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.withheld).toBeNull();
    expect(result.columns.some((column) => column.end === 'back')).toBe(true);
    // No column may stand inside the door's opening.
    const doorLeft = (12000 - 3000) / 2;
    for (const column of result.columns.filter((entry) => entry.end === 'front')) {
      expect(column.positionMm <= doorLeft || column.positionMm >= doorLeft + 3000).toBe(true);
    }
  });

  it('re-spaces a narrow gable and leaves the far end alone', () => {
    // The two answers are mutually exclusive, and this is the narrow one: the factory
    // moves the column, so the gable is still built — just not where the drawing shows.
    const narrow = shed({
      span: 3900,
      openings: [
        {
          id: 'd1',
          type: 'roller_door',
          width: 1800,
          height: 2400,
          sill: 0,
          wall: 'front',
          align: 'custom',
          offset: 1050,
          swing: null,
          track: null,
          series: 'A',
        },
      ],
    });
    const result = buildInfillColumns(narrow, geometry());
    expect(result.respacedEnds).toEqual(['front']);
    // The back end keeps the design's positions untouched.
    const back = result.columns.filter((column) => column.end === 'back');
    expect(back.map((column) => column.positionMm)).toEqual(result.designPositionsMm);
  });

  it('leaves a wide gable’s columns where the design put them', () => {
    // Over 4 000 mm the desktop refuses the door rather than moving the column, so the
    // BOM must not move it either — otherwise a quote reports a blocker and an
    // assumption for the same door.
    const wide = shed({
      openings: [
        {
          id: 'd1',
          type: 'roller_door',
          width: 2400,
          height: 2400,
          sill: 0,
          wall: 'front',
          align: 'custom',
          offset: 3000,
          swing: null,
          track: null,
          series: 'A',
        },
      ],
    });
    const result = buildInfillColumns(wide, geometry());
    expect(result.respacedEnds).toEqual([]);
    const front = result.columns.filter((column) => column.end === 'front');
    expect(front.map((column) => column.positionMm)).toEqual(result.designPositionsMm);
  });

  it('keeps the plain layout when the gable end has no door', () => {
    const result = buildInfillColumns(shed(), geometry());
    expect(result.columns).toHaveLength(4);
    expect(result.withheld).toBeNull();
  });

  it('says nothing when the design genuinely has no infill', () => {
    // `withheld` is for "a rule I cannot apply stopped this"; a narrow gable needs
    // no columns and that is not a refusal.
    const result = buildInfillColumns(shed(), geometry({ count: null, section: null }));
    expect(result.columns).toEqual([]);
    expect(result.withheld).toBeNull();
  });

  it('keeps the columns on a narrow gable out of the way of the corner ones', () => {
    // A 3 m gable with two columns: the positions must still sit inside the span
    // and clear of both corners.
    const { columns } = buildInfillColumns(shed({ span: 3000 }), geometry());
    for (const column of columns) {
      expect(column.positionMm).toBeGreaterThan(0);
      expect(column.positionMm).toBeLessThan(3000);
    }
  });
});

/**
 * R5 — the desktop's `computeInfillPosition` re-spacing branch.
 *
 * Three cases, and each one is a column the workshop would otherwise cut through:
 * remove it (no room either side), split it in two (room both sides), move it (room
 * on one). The `500` and `250` thresholds are the desktop's own.
 */
describe('respaceAroundDoors (R5)', () => {
  /** A style-B roller door, whose curtain takes 100 mm. */
  const door = (leftMm: number, widthMm: number, curtainMm = 100) => ({
    leftMm,
    widthMm,
    curtainMm,
  });

  it('removes a column with less than 500 mm clear either side', () => {
    // Door 2 000..4 000. The column at 3 000 sits inside it, and the neighbours at
    // 1 800 and 4 400 are 250 and 450 away — neither run is worth a column.
    const positions = respaceAroundDoors([0, 1800, 3000, 4400, 6000], [door(2000, 2000)]);
    expect(positions).not.toContain(3000);
    expect(positions).toEqual([0, 1800, 4400, 6000]);
  });

  it('splits a column into two when there is room either side', () => {
    // Same door, but the neighbours are 1 000 + away on both sides, so the column
    // becomes two: 250 mm clear of each jamb, less half the 100 mm curtain.
    const positions = respaceAroundDoors([0, 1000, 3000, 5000, 6000], [door(2000, 2000)]);
    expect(positions).not.toContain(3000);
    expect(positions).toContain(2000 - 250 + 50);
    expect(positions).toContain(4000 + 250 - 50);
  });

  it('moves a column to the side that has room', () => {
    // Close on the left (100 mm), roomy on the right (850 mm): the column moves off
    // the right jamb rather than being dropped.
    const positions = respaceAroundDoors([0, 1950, 3000, 4800, 6000], [door(2000, 2000)]);
    expect(positions).not.toContain(3000);
    expect(positions).toContain(4000 + 250 - 50);
  });

  it('leaves a column outside the door alone, however close', () => {
    // A column 100 mm before the jamb is not inside the opening, so nothing happens to
    // it — the clearance rules only govern columns the door actually cuts through.
    const positions = respaceAroundDoors([0, 1900, 3000, 5000, 6000], [door(2000, 2000)]);
    expect(positions).toContain(1900);
  });

  it('leaves the columns alone when the door misses them all', () => {
    const positions = [0, 2000, 8000, 10000];
    expect(respaceAroundDoors(positions, [door(4000, 2000)])).toEqual(positions);
  });

  it('never puts a column inside the door', () => {
    // The invariant the whole function exists for.
    const positions = [0, 1000, 3000, 5000, 7000, 9000];
    for (const style of [50, 100]) {
      const out = respaceAroundDoors(positions, [door(2200, 2600, style)]);
      for (const position of out) {
        expect(position <= 2200 || position >= 4800).toBe(true);
      }
    }
  });

  it('never moves a corner column, which is the end wall’s own', () => {
    // A door hard against the left corner: the 0 must stay, because it is the corner
    // column and removing it leaves the wall unsupported at its very edge. The span is
    // what tells this function which positions are corners — without it, the first and
    // last of a list are ordinary columns, which is how the interior-one bug happened.
    const positions = respaceAroundDoors([0, 1000, 4000, 6000], [door(0, 4000)], 6000);
    expect(positions).toContain(0);
  });

  it('re-spaces the first and last interior column, which an index test would exempt', () => {
    // `infillPositions` returns interior positions only, so the ends of its list are
    // ordinary columns. Treating them as corners — as the desktop's list-based rule
    // does, because its list includes both — left a column standing inside the door.
    const interior = [4032, 7968];
    const out = respaceAroundDoors(interior, [door(3000, 2400, 50)], 12000);
    expect(out).not.toContain(4032);
    for (const position of out) expect(position <= 3000 || position >= 5400).toBe(true);
  });

  it('gives every output in sorted order with no duplicates', () => {
    const out = respaceAroundDoors([0, 2000, 2001, 4000, 6000], [door(1500, 2000), door(3500, 1000)]);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(new Set(out).size).toBe(out.length);
  });
});
