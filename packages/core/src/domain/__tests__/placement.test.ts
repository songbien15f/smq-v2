import { describe, it, expect } from 'vitest';
import { resolveOpeningPlacement, wallLength, placementToPlanRect, planPointToWallU, constrainOpeningU, openingAtPlanPoint, moveOpeningTo, displacementToDu, wallDisplacement, nearestWall, dragGuide, pointInFootprint, openingGrabRect, optionAtPlanPoint, constrainOptionDrag, moveOptionTo } from '../placement';
import { buildPlanGeometry } from '../plan';
import { resolveOption } from '../options';
import { DEFAULT_SHED } from '../defaults';
import type { Opening, ShedOption } from '../types';

const base: Opening = {
  id: 'o1', type: 'pa_door', width: 900, height: 2100, sill: 0,
  wall: 'front', align: 'center', offset: null, swing: 'outward', track: null,
};

describe('wallLength', () => {
  it('uses span for front/back and length for left/right', () => {
    expect(wallLength(DEFAULT_SHED, 'front')).toBe(12000);
    expect(wallLength(DEFAULT_SHED, 'back')).toBe(12000);
    expect(wallLength(DEFAULT_SHED, 'left')).toBe(24000);
    expect(wallLength(DEFAULT_SHED, 'right')).toBe(24000);
  });
});

describe('resolveOpeningPlacement', () => {
  it('centres the opening', () => {
    const p = resolveOpeningPlacement({ ...base, width: 4200, align: 'center' }, DEFAULT_SHED);
    expect(p.u).toBe(3900);
    expect(p.valid).toBe(true);
  });
  it('aligns left and right', () => {
    expect(resolveOpeningPlacement({ ...base, align: 'left' }, DEFAULT_SHED).u).toBe(0);
    expect(resolveOpeningPlacement({ ...base, align: 'right' }, DEFAULT_SHED).u).toBe(11100);
  });
  it('uses the explicit offset for custom alignment', () => {
    const p = resolveOpeningPlacement({ ...base, align: 'custom', offset: 500 }, DEFAULT_SHED);
    expect(p.u).toBe(500);
    expect(p.valid).toBe(true);
  });
  it('treats a null custom offset as zero', () => {
    expect(resolveOpeningPlacement({ ...base, align: 'custom', offset: null }, DEFAULT_SHED).u).toBe(0);
  });
  it('flags an opening wider than its wall instead of dropping it', () => {
    const p = resolveOpeningPlacement({ ...base, width: 13000, align: 'center' }, DEFAULT_SHED);
    expect(p.valid).toBe(false);
    expect(p.reason).toBeTruthy();
  });
  it('flags an opening taller than the wall', () => {
    const p = resolveOpeningPlacement({ ...base, height: 5000 }, DEFAULT_SHED);
    expect(p.valid).toBe(false);
  });
  it('flags a custom offset that pushes the opening past the wall end', () => {
    const p = resolveOpeningPlacement({ ...base, align: 'custom', offset: 11500 }, DEFAULT_SHED);
    expect(p.valid).toBe(false);
  });
});

describe('placementToPlanRect', () => {
  it('places a centred front opening on the y=0 edge', () => {
    const r = placementToPlanRect({ ...base, width: 4200, align: 'center' }, DEFAULT_SHED);
    expect(r).toEqual({ x: 3900, y: 0, width: 4200, height: 0 });
  });
  it('mirrors the offset on the back wall (outside view)', () => {
    const r = placementToPlanRect({ ...base, wall: 'back', align: 'custom', offset: 500 }, DEFAULT_SHED);
    expect(r.x).toBe(12000 - 500 - 900);
    expect(r.y).toBe(24000);
  });
  it('mirrors the offset on the left wall (outside view)', () => {
    const r = placementToPlanRect({ ...base, wall: 'left', align: 'custom', offset: 500 }, DEFAULT_SHED);
    expect(r.y).toBe(24000 - 500 - 900);
    expect(r.x).toBe(0);
  });
  it('places a right-wall opening from the front corner', () => {
    const r = placementToPlanRect({ ...base, wall: 'right', align: 'custom', offset: 500 }, DEFAULT_SHED);
    expect(r.y).toBe(500);
    expect(r.x).toBe(12000);
  });
  it('puts a front/back opening extent in width and a side-wall extent in height', () => {
    const front = placementToPlanRect({ ...base, width: 4200, align: 'center' }, DEFAULT_SHED);
    expect(front.width).toBe(4200);
    expect(front.height).toBe(0);
    const left = placementToPlanRect({ ...base, wall: 'left', width: 900, align: 'custom', offset: 500 }, DEFAULT_SHED);
    expect(left.width).toBe(0);
    expect(left.height).toBe(900);
  });
});

describe('planPointToWallU is the inverse of placementToPlanRect', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000 };
  const walls = ['front', 'back', 'left', 'right'] as const;

  it('round-trips for all four walls', () => {
    for (const wall of walls) {
      const op: Opening = { id: 'x', type: 'pa_door', width: 900, height: 2100, sill: 0,
        wall, align: 'custom', offset: 500, swing: null, track: null };
      const r = placementToPlanRect(op, shed);
      // The point at the opening's u=0 corner, expressed in plan coordinates.
      const corner =
        wall === 'front' ? { x: r.x, y: r.y } :
        wall === 'back'  ? { x: r.x + r.width, y: r.y } :
        wall === 'left'  ? { x: r.x, y: r.y + r.height } :
                           { x: r.x, y: r.y };
      expect(planPointToWallU(shed, wall, corner)).toBeCloseTo(500, 6);
    }
  });

  it('returns an out-of-range u for a point beyond the wall, for the caller to clamp', () => {
    expect(planPointToWallU(shed, 'front', { x: -200, y: 0 })).toBe(-200);
  });
});

describe('constrainOpeningU', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000 };
  const door: Opening = { id: 'd', type: 'pa_door', width: 900, height: 2100, sill: 0,
    wall: 'front', align: 'custom', offset: 0, swing: null, track: null };

  it('clamps at both ends of the wall', () => {
    expect(constrainOpeningU(shed, door, -500)).toBe(0);
    expect(constrainOpeningU(shed, door, 99999)).toBe(11100); // 12000 - 900
  });
  it('returns an in-range u unchanged', () => {
    expect(constrainOpeningU(shed, door, 4000)).toBe(4000);
  });
  it('pins to 0 when the opening is wider than its wall', () => {
    const wide: Opening = { ...door, width: 20000 };
    expect(constrainOpeningU(shed, wide, 5000)).toBe(0);
  });
});

describe('openingAtPlanPoint', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000, openings: [
    { id: 'd1', type: 'roller_door' as const, width: 4200, height: 3600, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    { id: 'd2', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
      wall: 'left' as const, align: 'custom' as const, offset: 500, swing: 'outward' as const, track: null },
  ]};
  const g = buildPlanGeometry(shed);

  it('hits a front opening on its own line', () => {
    expect(openingAtPlanPoint(g, { x: 6000, y: 0 })!.id).toBe('d1');
  });
  it('hits a side opening on its own line', () => {
    // left wall, u=500..1400 measured from y=24000 downward -> y 22600..23500
    expect(openingAtPlanPoint(g, { x: 0, y: 23000 })!.id).toBe('d2');
  });
  it('misses a point far from every opening', () => {
    expect(openingAtPlanPoint(g, { x: 6000, y: 12000 })).toBeNull();
  });
  it('honours the tolerance halo', () => {
    // 100mm off the front opening line is inside the default 150mm halo
    expect(openingAtPlanPoint(g, { x: 6000, y: 100 })!.id).toBe('d1');
    // 400mm off is outside it
    expect(openingAtPlanPoint(g, { x: 6000, y: 400 })).toBeNull();
  });
  it('gives a wider tolerance to a fingertip', () => {
    expect(openingAtPlanPoint(g, { x: 6000, y: 400 }, 500)!.id).toBe('d1');
  });

  it('hits a back-wall opening', () => {
    const s = { ...DEFAULT_SHED, span: 12000, length: 24000, openings: [
      { id: 'b1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'back' as const, align: 'center' as const, offset: null, swing: null, track: null },
    ]};
    const g = buildPlanGeometry(s);
    // centred on a 12000 wall: u = 5550, so the rect spans x = 12000-5550-900 .. 12000-5550
    expect(openingAtPlanPoint(g, { x: 6000, y: 24000 })!.id).toBe('b1');
  });

  it('hits a right-wall opening', () => {
    const s = { ...DEFAULT_SHED, span: 12000, length: 24000, openings: [
      { id: 'r1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'right' as const, align: 'custom' as const, offset: 1000, swing: null, track: null },
    ]};
    const g = buildPlanGeometry(s);
    // right wall: u measured from y = 0 upward, so the rect spans y = 1000 .. 1900
    expect(openingAtPlanPoint(g, { x: 12000, y: 1450 })!.id).toBe('r1');
  });

  it('gives the later opening priority when two overlap', () => {
    const door = (id: string) => ({ id, type: 'pa_door' as const, width: 2000, height: 2100, sill: 0,
      wall: 'front' as const, align: 'custom' as const, offset: 500, swing: null, track: null });
    const g = buildPlanGeometry({ ...DEFAULT_SHED, openings: [door('first'), door('second')] });
    // Both sit at the same offset and overlap entirely; the last drawn wins.
    expect(openingAtPlanPoint(g, { x: 1500, y: 0 })!.id).toBe('second');
  });
});

describe('pointInFootprint', () => {
  const g = buildPlanGeometry(DEFAULT_SHED); // span 12000, length 24000, origin front-left

  it('is true inside the footprint', () => {
    expect(pointInFootprint(g, { x: 6000, y: 12000 })).toBe(true);
  });
  it('is true on the outline edges and corners', () => {
    expect(pointInFootprint(g, { x: 0, y: 0 })).toBe(true);
    expect(pointInFootprint(g, { x: 12000, y: 24000 })).toBe(true);
    expect(pointInFootprint(g, { x: 0, y: 24000 })).toBe(true);
  });
  it('is false outside every edge', () => {
    expect(pointInFootprint(g, { x: -1, y: 12000 })).toBe(false);
    expect(pointInFootprint(g, { x: 12001, y: 12000 })).toBe(false);
    expect(pointInFootprint(g, { x: 6000, y: -1 })).toBe(false);
    expect(pointInFootprint(g, { x: 6000, y: 24001 })).toBe(false);
  });
  it('does not grow with the opening hit tolerance (unlike openingAtPlanPoint)', () => {
    // 100 mm outside the front edge is outside the building, even though it is
    // within a door's hit halo — this is what makes an outside click deselect.
    expect(pointInFootprint(g, { x: 6000, y: -100 })).toBe(false);
  });
});

describe('openingGrabRect', () => {
  it('expands a front-wall segment into a grabbable band', () => {
    // A front/back opening is a line segment (height 0). Expanded by the
    // tolerance it becomes a band with a positive height, so the hollow middle
    // of a door is draggable, not just its thin strokes.
    const grab = openingGrabRect({ x: 5550, y: 0, width: 900, height: 0 });
    expect(grab.width).toBe(900 + 2 * 150);
    expect(grab.height).toBe(2 * 150);
    expect(grab.x).toBe(5550 - 150);
    expect(grab.y).toBe(-150);
  });
  it('expands a side-wall segment into a grabbable band too', () => {
    const grab = openingGrabRect({ x: 0, y: 1000, width: 0, height: 900 });
    expect(grab.width).toBe(2 * 150);
    expect(grab.height).toBe(900 + 2 * 150);
  });
  it('honours a custom tolerance', () => {
    const grab = openingGrabRect({ x: 0, y: 0, width: 100, height: 0 }, 50);
    expect(grab.width).toBe(200);
    expect(grab.height).toBe(100);
  });
  it('agrees with openingAtPlanPoint about what the halo is', () => {
    // The grab rect is the *same* expansion the click hit-test applies, so a
    // point the click path calls a hit is inside the grab rect and vice versa.
    const rect = { x: 5550, y: 0, width: 900, height: 0 };
    const grab = openingGrabRect(rect);
    const inside = (p: { x: number; y: number }) =>
      p.x >= grab.x && p.x <= grab.x + grab.width && p.y >= grab.y && p.y <= grab.y + grab.height;
    const shed = { ...DEFAULT_SHED, openings: [
      { id: 'd1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    ]};
    const g = buildPlanGeometry(shed);
    for (const p of [{ x: 6000, y: 0 }, { x: 6000, y: 140 }, { x: 6000, y: 160 }, { x: 6000, y: -140 }]) {
      expect(openingAtPlanPoint(g, p) !== null).toBe(inside(p));
    }
  });
});

describe('moveOpeningTo', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000, openings: [
    { id: 'd1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
      wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
  ]};

  it('forces custom alignment and returns a clamped offset', () => {
    expect(moveOpeningTo(shed, 'd1', 3000)).toEqual({ id: 'd1', patch: { align: 'custom', offset: 3000 } });
  });
  it('clamps an out-of-range target', () => {
    expect(moveOpeningTo(shed, 'd1', 99999)).toEqual({ id: 'd1', patch: { align: 'custom', offset: 11100 } });
  });
  it('returns null for an unknown id', () => {
    expect(moveOpeningTo(shed, 'nope', 1000)).toBeNull();
  });
});

describe('wall displacement helpers (spec R4)', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000 };
  const walls = ['front', 'back', 'left', 'right'] as const;

  it('round-trips displacement to a u change for all four walls', () => {
    for (const wall of walls) {
      const d = wallDisplacement(shed, wall, 1000); // move +1000 mm along the wall
      const back = displacementToDu(shed, wall, d); // convert that displacement back
      expect(back).toBeCloseTo(1000, 6); // the sign must survive the round trip
    }
  });

  it('flips the sign of the u change on the back wall', () => {
    // A +x displacement is a -u change on the back wall, whose u runs opposite x.
    const d = wallDisplacement(shed, 'back', 1000);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBe(0);
    expect(displacementToDu(shed, 'back', { x: 1000, y: 0 })).toBeCloseTo(-1000, 6);
  });

  it('moves along y on the side walls', () => {
    expect(wallDisplacement(shed, 'right', 1000).y).toBeGreaterThan(0);
    expect(wallDisplacement(shed, 'right', 1000).x).toBe(0);
    expect(wallDisplacement(shed, 'left', 1000).y).toBeLessThan(0);
    expect(wallDisplacement(shed, 'left', 1000).x).toBe(0);
  });

  it('pins the cross axis to 0 so a drag cannot leave the wall line', () => {
    // front/back are horizontal (x only); left/right are vertical (y only).
    expect(wallDisplacement(shed, 'front', 1000)).toEqual({ x: 1000, y: 0 });
    expect(wallDisplacement(shed, 'back', 1000)).toEqual({ x: -1000, y: 0 });
    expect(wallDisplacement(shed, 'right', 1000)).toEqual({ x: 0, y: 1000 });
    expect(wallDisplacement(shed, 'left', 1000)).toEqual({ x: 0, y: -1000 });
  });

  it('is the exact inverse of a front/right u increase', () => {
    // The sign table of planPointToWallU: front +x, back -x, left -y, right +y.
    expect(displacementToDu(shed, 'front', { x: 1000, y: 0 })).toBeCloseTo(1000, 6);
    expect(displacementToDu(shed, 'back', { x: 1000, y: 0 })).toBeCloseTo(-1000, 6);
    expect(displacementToDu(shed, 'left', { x: 0, y: 1000 })).toBeCloseTo(-1000, 6);
    expect(displacementToDu(shed, 'right', { x: 0, y: 1000 })).toBeCloseTo(1000, 6);
  });
});

describe('nearestWall', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000 };

  it('picks the front wall for a point near y = 0', () => {
    expect(nearestWall(shed, { x: 6000, y: 500 })).toBe('front');
  });
  it('picks the back wall for a point near y = length', () => {
    expect(nearestWall(shed, { x: 6000, y: 23500 })).toBe('back');
  });
  it('picks the left wall for a point near x = 0', () => {
    expect(nearestWall(shed, { x: 500, y: 12000 })).toBe('left');
  });
  it('picks the right wall for a point near x = span', () => {
    expect(nearestWall(shed, { x: 11500, y: 12000 })).toBe('right');
  });

  it('measures each wall against the shed it is given, not a fixed size', () => {
    // A narrow, long shed: x = 1000 is nearer the left edge (1000) than the
    // right (span − x = 3000), while the front/back lines are 10000 mm away.
    const narrow = { ...DEFAULT_SHED, span: 4000, length: 20000 };
    expect(nearestWall(narrow, { x: 1000, y: 10000 })).toBe('left');
    expect(nearestWall(narrow, { x: 3000, y: 10000 })).toBe('right');
  });

  it('uses the absolute distance, so a point outside the shed still resolves', () => {
    expect(nearestWall(shed, { x: 6000, y: -500 })).toBe('front');
    expect(nearestWall(shed, { x: -500, y: 12000 })).toBe('left');
  });
});

describe('dragGuide', () => {
  const shed = { ...DEFAULT_SHED, span: 12000, length: 24000 };
  const door: Opening = { id: 'd', type: 'pa_door', width: 900, height: 2100, sill: 0,
    wall: 'front', align: 'custom', offset: 0, swing: null, track: null };

  it('measures the offset from the wall corner and labels it in millimetres', () => {
    const g = dragGuide(shed, door, 1200);
    expect(g.offsetMm).toBe(1200);
    expect(g.label).toBe('1200 mm');
  });

  it('runs the guide line along the wall from the u = 0 corner', () => {
    const g = dragGuide(shed, door, 1200);
    // front wall runs along x at y = 0, u measured from x = 0
    expect(g.line[1]).toBe(g.line[3]);          // horizontal
    expect(Math.min(g.line[0], g.line[2])).toBe(0);
    expect(Math.max(g.line[0], g.line[2])).toBeCloseTo(1200, 6);
  });

  it('follows the wall on a side wall', () => {
    const left = { ...door, wall: 'left' as const };
    const g = dragGuide(shed, left, 800);
    expect(g.line[0]).toBe(g.line[2]);          // vertical
    // left wall u is measured from y = length going down
    expect(Math.max(g.line[1], g.line[3])).toBeCloseTo(24000, 6);
    expect(Math.min(g.line[1], g.line[3])).toBeCloseTo(24000 - 800, 6);
  });

  it('rounds the readout to whole millimetres', () => {
    expect(dragGuide(shed, door, 1200.4).offsetMm).toBe(1200);
    expect(dragGuide(shed, door, 1200.6).label).toBe('1201 mm');
  });

  // The guide must follow its own wall on all four sides, never drawn sideways.
  // `placementToPlanRect` of a zero-width opening at offset `u` is the independent
  // oracle for the point at wall-local `u` on the wall's line.
  const walls = ['front', 'back', 'left', 'right'] as const;
  it.each(walls)('runs the line along the %s wall from its u = 0 corner', (wall) => {
    const u = 1200;
    const g = dragGuide(shed, { ...door, wall }, u);
    const near = placementToPlanRect({ ...door, wall, align: 'custom', offset: u, width: 0 }, shed);
    const corner = placementToPlanRect({ ...door, wall, align: 'custom', offset: 0, width: 0 }, shed);
    // One end is the wall's u = 0 corner; the other is the point at offset u.
    const ends = [
      { x: g.line[0], y: g.line[1] },
      { x: g.line[2], y: g.line[3] },
    ];
    expect(ends).toContainEqual({ x: corner.x, y: corner.y });
    expect(ends).toContainEqual({ x: near.x, y: near.y });
    // The line lies on the wall's own axis, so it is never drawn across the plan.
    expect(g.line[0] === g.line[2] || g.line[1] === g.line[3]).toBe(true);
    // The readout is pushed off the wall, clear of the outline.
    const onWall = wall === 'front' || wall === 'back' ? g.textAt.y === near.y : g.textAt.x === near.x;
    expect(onWall).toBe(false);
  });
});

describe('option hit-testing and dragging', () => {
  const withOptions = {
    ...DEFAULT_SHED,
    openings: [
      { id: 'd1', type: 'pa_door' as const, width: 900, height: 2100, sill: 0,
        wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
    ],
    options: [
      { id: 'sk-1', kind: 'skylight' as const, bay: 0, alongBay: 0.5, width: 900, height: 900 },
      { id: 'aw-1', kind: 'awning' as const, wall: 'front' as const, align: 'center' as const,
        offset: null, width: 3000, depth: 1000 },
    ],
  };

  it('finds an option at its centre', () => {
    const geometry = buildPlanGeometry(withOptions);
    const skylight = geometry.options.find((option) => option.id === 'sk-1')!;
    const centre = {
      x: skylight.rect.x + skylight.rect.width / 2,
      y: skylight.rect.y + skylight.rect.height / 2,
    };
    expect(optionAtPlanPoint(geometry, centre)?.id).toBe('sk-1');
  });

  it('returns null away from every option', () => {
    const geometry = buildPlanGeometry(withOptions);
    expect(optionAtPlanPoint(geometry, { x: 11000, y: 23000 }, 0)).toBeNull();
  });

  it('finds both a door and an overlapping option, leaving priority to the caller', () => {
    const geometry = buildPlanGeometry(withOptions);
    // A door sits on the front wall; the awning's rect starts at the same line.
    // Both hit-tests succeed, and the canvas is what applies "openings first" —
    // keeping that rule out of the domain is what lets the tab and the canvas
    // disagree about which of two overlapping things a click meant.
    expect(openingAtPlanPoint(geometry, { x: 6000, y: 0 })).not.toBeNull();
    expect(optionAtPlanPoint(geometry, { x: 6000, y: 0 }, 0)?.id).toBe('aw-1');
  });

  it('clamps a skylight drag inside the roof', () => {
    const option: ShedOption = {
      id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
    };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: -5000, y: -5000 });
    const resolved = resolveOption(moved, DEFAULT_SHED);
    expect(resolved.rect.x).toBeGreaterThanOrEqual(0);
    expect(resolved.rect.y).toBeGreaterThanOrEqual(0);
    expect(resolved.rect.x + resolved.rect.width).toBeLessThanOrEqual(DEFAULT_SHED.span);
  });

  it('moves a skylight to the bay under the pointer', () => {
    const option: ShedOption = {
      id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
    };
    // DEFAULT_SHED is 24000 long with 4 bays of 6000; y = 15000 is bay 2.
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6000, y: 15000 });
    expect(moved).toMatchObject({ kind: 'skylight', bay: 2 });
  });

  it('snaps an outrigger to the nearest bay line', () => {
    const option: ShedOption = {
      id: 'og-1', kind: 'outrigger', wall: 'front', bay: 0, length: 1900,
    };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6100, y: 0 });
    expect(moved).toMatchObject({ kind: 'outrigger', bay: 1 });
  });

  it('moves an awning along its wall', () => {
    const option: ShedOption = {
      id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null,
      width: 3000, depth: 1000,
    };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 1000, y: 0 });
    expect(moved).toMatchObject({ kind: 'awning', align: 'custom' });
  });

  it('returns a patch that moves the option, or null for an unknown id', () => {
    const config = { ...DEFAULT_SHED, options: [
      { id: 'sk-1', kind: 'skylight' as const, bay: 0, alongBay: 0.5, width: 900, height: 900 },
    ]};
    const moved = moveOptionTo(config, 'sk-1', { x: 6000, y: 15000 });
    expect(moved?.patch).toMatchObject({ bay: 2 });
    expect(moveOptionTo(config, 'sk-9', { x: 0, y: 0 })).toBeNull();
  });

  it('leaves a gable infill where it is when dragged', () => {
    const option: ShedOption = { id: 'gi-1', kind: 'gable_infill', end: 'front' };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 100, y: 100 });
    expect(moved).toEqual(option);
  });
});

describe('option drag stability (review I6, I7)', () => {
  it('keeps an awning on its wall when dragged inward past the mid-line', () => {
    const config = { ...DEFAULT_SHED, span: 12000, length: 24000 };
    const option: ShedOption = {
      id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null,
      width: 3000, depth: 1000,
    };
    const moved = constrainOptionDrag(config, option, { x: 6000, y: 12000 });
    expect(moved).toMatchObject({ kind: 'awning', wall: 'front' });
  });

  it('keeps an outrigger on its wall when dragged inward', () => {
    const config = { ...DEFAULT_SHED, span: 12000, length: 24000 };
    const option: ShedOption = { id: 'og-1', kind: 'outrigger', wall: 'front', bay: 0, length: 1900 };
    const moved = constrainOptionDrag(config, option, { x: 6000, y: 12000 });
    expect(moved).toMatchObject({ kind: 'outrigger', wall: 'front' });
  });

  it('resolves an awning dragged to where it already is to the same anchor', () => {
    const config = { ...DEFAULT_SHED, span: 12000, length: 24000 };
    const option: ShedOption = {
      id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null,
      width: 3000, depth: 1000,
    };
    // Its rest centre: centred on the front wall, projecting 1000 mm outward.
    const moved = constrainOptionDrag(config, option, { x: 6000, y: -500 });
    // A centre-aligned awning is already at u = (12000 - 3000) / 2 = 4500, and
    // the drag resolves to exactly that offset — so the option is unchanged in
    // position even though `align` becomes custom.
    const resolvedBefore = resolveOption(option, config);
    const resolvedAfter = resolveOption(moved, config);
    expect(resolvedAfter.rect).toEqual(resolvedBefore.rect);
  });
});

describe('dragging the remaining kinds', () => {
  it('moves a stable along its wall', () => {
    const option: ShedOption = {
      id: 'st-1', kind: 'stable', wall: 'front', align: 'center', offset: null,
      width: 3000, depth: 2400, height: 2400,
      panels: { left: true, right: true, front: true, back: true },
    };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 1000, y: 0 });
    expect(moved).toMatchObject({ kind: 'stable', wall: 'front', align: 'custom' });
  });

  it('moves a carry beam between bays', () => {
    const option: ShedOption = { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: null };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6000, y: 15000 });
    expect(moved).toMatchObject({ kind: 'carry_beam', beginBay: 2 });
  });

  it('moves a cantilever between bays', () => {
    const option: ShedOption = { id: 'cl-1', kind: 'cantilever', wall: 'front', bay: 0, length: 1200 };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6000, y: 15000 });
    expect(moved).toMatchObject({ kind: 'cantilever', bay: 2 });
  });

  it('slides a cladding band without changing its heights', () => {
    const option: ShedOption = { id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 500, to: 3000 };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6000, y: 12000 });
    expect(moved).toMatchObject({ kind: 'horizontal_cladding', from: 500, to: 3000 });
  });

  it('leaves an overhang depth alone while dragging', () => {
    const option: ShedOption = { id: 'oh-1', kind: 'overhang', wall: 'front', depth: 600 };
    const moved = constrainOptionDrag(DEFAULT_SHED, option, { x: 6000, y: 12000 });
    expect(moved).toMatchObject({ kind: 'overhang', depth: 600 });
  });
});
