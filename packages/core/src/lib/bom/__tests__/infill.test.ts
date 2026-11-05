import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { ShedConfig } from '@/domain/types';
import {
  buildInfillColumns,
  infillLength,
  infillPositions,
  infillSetback,
  type InfillGeometry,
} from '../infill';

const shed = (patch: Partial<ShedConfig> = {}): ShedConfig => ({ ...DEFAULT_SHED, ...patch });

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

  it('withholds the columns when a gable end has an opening in it', () => {
    // Where a column goes around a door depends on the door's style and its exact
    // position — the desktop's `computeInfillPosition`. This build has no door model
    // to answer that, so it says so rather than guessing a position.
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
        },
      ],
    });
    const result = buildInfillColumns(withDoor, geometry());
    expect(result.columns).toEqual([]);
    expect(result.withheld).toMatch(/withheld/i);
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
