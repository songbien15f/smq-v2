import { describe, it, expect } from 'vitest';
import { buildWallGeometries } from '../walls';
import { placementToPlanRect, resolveOpeningPlacement, wallLength } from '../placement';
import { TEST_SHED } from '../defaults';
import type { DimensionedShed, Opening, WallSide } from '../types';

const shed = {
  ...TEST_SHED,
  openings: [
    { id: 'd1', type: 'roller_door' as const, width: 4200, height: 3600, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    { id: 'd2', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
      wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
  ],
};

describe('buildWallGeometries', () => {
  it('returns exactly four walls', () => {
    const w = buildWallGeometries(shed);
    expect(w.map((x) => x.side).sort()).toEqual(['back', 'front', 'left', 'right']);
  });
  it('gives front/back the span as width and left/right the length', () => {
    const w = buildWallGeometries(shed);
    expect(w.find((x) => x.side === 'front')!.width).toBe(12000);
    expect(w.find((x) => x.side === 'left')!.width).toBe(24000);
  });
  it('attaches each opening as a hole on its own wall only', () => {
    const w = buildWallGeometries(shed);
    expect(w.find((x) => x.side === 'front')!.holes).toHaveLength(1);
    expect(w.find((x) => x.side === 'left')!.holes).toHaveLength(1);
    expect(w.find((x) => x.side === 'back')!.holes).toHaveLength(0);
    expect(w.find((x) => x.side === 'right')!.holes).toHaveLength(0);
  });
  it('expresses the hole in wall-local coordinates', () => {
    const front = buildWallGeometries(shed).find((x) => x.side === 'front')!;
    expect(front.holes[0]).toEqual({ u: 3900, sill: 0, width: 4200, height: 3600 });
  });
  it('keeps holes inside the wall bounds', () => {
    const bad = { ...TEST_SHED, openings: [{ ...shed.openings[0], width: 13000 }] };
    const front = buildWallGeometries(bad).find((x) => x.side === 'front')!;
    for (const h of front.holes) {
      expect(h.u).toBeGreaterThanOrEqual(0);
      expect(h.u + h.width).toBeLessThanOrEqual(front.width);
    }
  });
  it('keeps holes inside the wall bounds vertically for an over-height opening', () => {
    // A 3600-tall opening on a 2400 wall: without a vertical clamp the hole
    // leaves the counter-clockwise outline and ExtrudeGeometry has no defined
    // result. `sill + height` must never exceed the wall height.
    const lowWall = {
      ...TEST_SHED,
      height: 2400,
      openings: [{ ...shed.openings[0], height: 3600, sill: 0 }],
    };
    const front = buildWallGeometries(lowWall).find((x) => x.side === 'front')!;
    expect(front.height).toBe(2400);
    for (const h of front.holes) {
      expect(h.sill).toBeGreaterThanOrEqual(0);
      expect(h.height).toBeGreaterThanOrEqual(0);
      expect(h.sill + h.height).toBeLessThanOrEqual(front.height);
    }
    expect(front.holes[0].sill + front.holes[0].height).toBe(2400);
  });
  it('clamps a sill that is already at or above the wall height', () => {
    const lowWall = {
      ...TEST_SHED,
      height: 2400,
      openings: [{ ...shed.openings[0], sill: 3000, height: 900 }],
    };
    const front = buildWallGeometries(lowWall).find((x) => x.side === 'front')!;
    expect(front.holes[0].sill).toBeLessThanOrEqual(front.height);
    expect(front.holes[0].sill + front.holes[0].height).toBeLessThanOrEqual(front.height);
  });
  it('positions the four walls around the shed footprint', () => {
    const w = buildWallGeometries(shed);
    expect(w.find((x) => x.side === 'front')!.transform.position).toEqual([0, 0, 0]);
    expect(w.find((x) => x.side === 'back')!.transform.position).toEqual([12000, 0, 24000]);
    expect(w.find((x) => x.side === 'left')!.transform.position).toEqual([0, 0, 24000]);
    expect(w.find((x) => x.side === 'right')!.transform.position).toEqual([12000, 0, 0]);
  });
  it('places each wall so its local x=0 corner is the corner u is measured from', () => {
    const w = buildWallGeometries(shed);
    const corner = (wall: (typeof w)[number], x: number) => {
      const a = wall.transform.rotationY;
      return {
        X: x * Math.cos(a) + wall.transform.position[0],
        Z: -x * Math.sin(a) + wall.transform.position[2],
      };
    };
    const front = w.find((x) => x.side === 'front')!;
    expect(corner(front, 0)).toEqual({ X: 0, Z: 0 });
    expect(corner(front, front.width).X).toBeCloseTo(12000);
    const back = w.find((x) => x.side === 'back')!;
    expect(corner(back, 0).X).toBeCloseTo(12000);
    expect(corner(back, back.width).X).toBeCloseTo(0);
    const left = w.find((x) => x.side === 'left')!;
    expect(corner(left, 0).Z).toBeCloseTo(24000);
    expect(corner(left, left.width).Z).toBeCloseTo(0);
    const right = w.find((x) => x.side === 'right')!;
    expect(corner(right, 0).Z).toBeCloseTo(0);
    expect(corner(right, right.width).Z).toBeCloseTo(24000);
  });
  it('lands each wall opening where the 2D plan draws it', () => {
    const cross = {
      ...TEST_SHED,
      openings: [
        { id: 'b1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
          wall: 'back' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
        { id: 'l1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
          wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
      ],
    };
    const w = buildWallGeometries(cross);
    const project = (wall: (typeof w)[number], x: number) => {
      const a = wall.transform.rotationY;
      return {
        X: x * Math.cos(a) + wall.transform.position[0],
        Z: -x * Math.sin(a) + wall.transform.position[2],
      };
    };
    // A hole spans local x in [u, u + width]; projected onto the wall's axis its
    // two edges must bracket the plan rect the 2D layer draws for the same
    // opening (the rect carries the near edge, so u + width lands on rect.x).
    const back = w.find((x) => x.side === 'back')!;
    const backRect = placementToPlanRect(cross.openings[0], cross);
    expect(project(back, back.holes[0].u).X).toBeCloseTo(backRect.x + backRect.width);
    expect(project(back, back.holes[0].u + back.holes[0].width).X).toBeCloseTo(backRect.x);

    const left = w.find((x) => x.side === 'left')!;
    const leftRect = placementToPlanRect(cross.openings[1], cross);
    expect(project(left, left.holes[0].u).Z).toBeCloseTo(leftRect.y + leftRect.height);
    expect(project(left, left.holes[0].u + left.holes[0].width).Z).toBeCloseTo(leftRect.y);
  });
});

/**
 * Proves the 2026-11-25 refactor of `buildWallGeometries` changed **nothing**: the function now calls
 * `wallHolesFor`, which is the old inline loop moved out. This rebuilds the old algorithm verbatim
 * from `HEAD~` and compares both outputs for a spread of buildings, including ones whose openings are
 * clamped, oversized or negative.
 */
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** The old `buildWallGeometries`, copied from git HEAD before the extraction. */
function oldBuild(shed: DimensionedShed) {
  const SIDES: WallSide[] = ['front', 'back', 'left', 'right'];
  const wallTransform = (side: WallSide) => {
    const { span, length } = shed;
    switch (side) {
      case 'back':
        return { position: [span, 0, length] as [number, number, number], rotationY: Math.PI };
      case 'left':
        return { position: [0, 0, length] as [number, number, number], rotationY: Math.PI / 2 };
      case 'right':
        return { position: [span, 0, 0] as [number, number, number], rotationY: -Math.PI / 2 };
      default:
        return { position: [0, 0, 0] as [number, number, number], rotationY: 0 };
    }
  };
  return SIDES.map((side) => {
    const width = wallLength(shed, side);
    const holes: { u: number; sill: number; width: number; height: number }[] = [];
    for (const opening of shed.openings) {
      if (opening.wall !== side) continue;
      const { u } = resolveOpeningPlacement(opening, shed);
      const holeWidth = clamp(opening.width, 0, width);
      const sill = clamp(opening.sill, 0, shed.height);
      const holeHeight = clamp(opening.height, 0, shed.height - sill);
      holes.push({ u: clamp(u, 0, width - holeWidth), sill, width: holeWidth, height: holeHeight });
    }
    const height =
      side === 'right'
        ? shed.height +
          (shed.structureType === 'gable' || shed.structureType === 'gable_carport'
            ? 0
            : Math.tan((shed.roofPitchDeg * Math.PI) / 180) * shed.span)
        : shed.height;
    return { side, width, height, holes, transform: wallTransform(side) };
  });
}

const op = (patch: Partial<Opening> & Pick<Opening, 'type' | 'wall'>): Opening => ({
  id: 'x',
  width: 900,
  height: 900,
  sill: 0,
  align: 'custom',
  offset: 0,
  swing: null,
  track: null,
  ...patch,
});

const cases: { name: string; shed: DimensionedShed }[] = [
  { name: 'plain', shed: TEST_SHED },
  {
    name: 'oversized opening (clamped)',
    shed: { ...TEST_SHED, openings: [op({ type: 'roller_door', wall: 'front', width: 30000 })] },
  },
  {
    name: 'negative sill',
    shed: { ...TEST_SHED, openings: [op({ type: 'window', wall: 'left', sill: -500 })] },
  },
  {
    name: 'tall opening',
    shed: { ...TEST_SHED, openings: [op({ type: 'window', wall: 'right', height: 99999, sill: 0 })] },
  },
  {
    name: 'aligned, no offset',
    shed: { ...TEST_SHED, openings: [op({ type: 'pa_door', wall: 'back', align: 'center' })] },
  },
  {
    name: 'skillion',
    shed: {
      ...TEST_SHED,
      structureType: 'skillion',
      openings: [op({ type: 'window', wall: 'up' as WallSide })].filter(() => false),
    },
  },
];

describe('buildWallGeometries: refactor is behaviour-preserving', () => {
  for (const { name, shed } of cases) {
    it(name, () => {
      expect(buildWallGeometries(shed)).toEqual(oldBuild(shed));
    });
  }
});
