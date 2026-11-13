import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import type { DimensionedShed } from '../types';
import {
  EAVE,
  frameParts,
  gableEndParts,
  gutterParts,
  hasEndWalls,
  hasRidge,
  purlinAndGirtParts,
  roofGeometry,
  roofParts,
  structureParts,
} from '../structure3d';

/**
 * The shell: roof, trim, gutters, gable ends and frame.
 *
 * The rule these tests defend is the one the 3D view is easiest to get wrong on: **draw only what
 * the quote includes**. Roof, ridge, barge, gutter, downpipe, columns, rafters, purlins and girts are
 * all always in the bill; the gable triangle is the one piece that is drawn but not yet priced, and
 * that is recorded as a deviation rather than hidden here.
 */

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

describe('ridge', () => {
  it('gives a gable two slopes and a ridge cap', () => {
    const kinds = roofParts(shed(), roofGeometry(shed())).map((part) => part.kind);
    expect(kinds).toEqual(expect.arrayContaining(['roof-left', 'roof-right', 'ridge-cap']));
  });

  it('gives a skillion one slope and no ridge cap', () => {
    const skillion = shed({ structureType: 'skillion' });
    const kinds = roofParts(skillion, roofGeometry(skillion)).map((part) => part.kind);
    expect(kinds).toContain('roof-single');
    expect(kinds).not.toContain('ridge-cap');
  });

  it('agrees with the domain about which structures have a ridge', () => {
    expect(hasRidge(shed())).toBe(true);
    expect(hasRidge(shed({ structureType: 'skillion_carport' }))).toBe(false);
  });

  it('puts the ridge at wall height plus the pitch rise', () => {
    const roof = roofGeometry(shed({ span: 12000, height: 4200, roofPitchDeg: 15 }));
    // tan(15°) × 6000 ≈ 1607.7, so the ridge is about 5807.7 mm up.
    expect(roof.ridgeY).toBeCloseTo(4200 + Math.tan((15 * Math.PI) / 180) * 6000, 3);
  });
});

describe('gable ends', () => {
  it('closes both ends of a building with end walls', () => {
    const s = shed();
    const roof = roofGeometry(s);
    expect(gableEndParts(s, roof, 'front')).toHaveLength(1);
    expect(gableEndParts(s, roof, 'back')).toHaveLength(1);
  });

  it('closes nothing on a carport, which has no end walls', () => {
    const carport = shed({ structureType: 'gable_carport' });
    expect(hasEndWalls(carport)).toBe(false);
    expect(gableEndParts(carport, roofGeometry(carport), 'front')).toEqual([]);
  });

  it('describes the triangle rather than making a renderer guess it', () => {
    const s = shed();
    const [end] = gableEndParts(s, roofGeometry(s), 'front');
    expect(end?.triangle).toEqual({ base: s.span, rise: roofGeometry(s).ridgeY - s.height });
  });

  it('leaves an end alone when the customer already bought a gable infill there', () => {
    // The option is a real object with its own geometry; drawing the automatic triangle too would
    // put two surfaces in the same place, and the joint shows as flicker.
    const withInfill = shed({
      options: [{ id: 'gi-1', kind: 'gable_infill', end: 'front' }],
    });
    const roof = roofGeometry(withInfill);
    expect(gableEndParts(withInfill, roof, 'front')).toEqual([]);
    expect(gableEndParts(withInfill, roof, 'back')).toHaveLength(1);
  });
});

describe('gutters', () => {
  it('runs one gutter along each eave with a downpipe at each end', () => {
    const s = shed();
    const parts = gutterParts(s, roofGeometry(s));
    expect(parts.filter((part) => part.kind.startsWith('gutter-'))).toHaveLength(2);
    expect(parts.filter((part) => part.kind.startsWith('downpipe-'))).toHaveLength(4);
  });

  it('places the gutters outside the walls, under the eave overhang', () => {
    const s = shed();
    const parts = gutterParts(s, roofGeometry(s));
    const gutters = parts.filter((part) => part.kind.startsWith('gutter-'));
    expect(gutters[0]?.position[0]).toBeLessThan(0);
    expect(gutters[1]?.position[0]).toBeGreaterThan(s.span);
  });
});

describe('frame', () => {
  it('stands a column pair at every bay grid line', () => {
    const s = shed({ bays: 4 });
    const parts = frameParts(s, roofGeometry(s));
    // bays + 1 grid lines, two columns each.
    expect(parts.filter((part) => part.kind === 'column')).toHaveLength((4 + 1) * 2);
  });

  it('keeps the columns inside the sheeting line', () => {
    const s = shed();
    const parts = frameParts(s, roofGeometry(s)).filter((part) => part.kind === 'column');
    for (const column of parts) {
      expect(column.position[0]).toBeGreaterThan(0);
      expect(column.position[0]).toBeLessThan(s.span);
    }
  });

  it('draws no purlin until an evaluation says where the rows go', () => {
    // Purlin spacing comes from the price book's span table, which the client does not have.
    // Drawing a guessed row would be a drawing of a building nobody priced.
    expect(purlinAndGirtParts(shed(), null)).toEqual([]);
  });

  it('draws two purlin runs per row on a gable: one on each slope', () => {
    const s = shed();
    const parts = purlinAndGirtParts(s, { purlinRows: 4, purlinSpanMm: 900, girtRows: 3, girtSpanMm: 1200 });
    // Four rows, the top one shared at the ridge: 2 + 2 + 2 + 1 runs.
    expect(parts.filter((part) => part.kind === 'purlin')).toHaveLength(7);
  });

  it('keeps the purlins under the roof plane and stepping up with the pitch', () => {
    const s = shed();
    const roof = roofGeometry(s);
    const eaveY = s.height - roof.eaveDrop;
    const purlins = purlinAndGirtParts(s, {
      purlinRows: 3,
      purlinSpanMm: 900,
      girtRows: 0,
      girtSpanMm: 1200,
    }).filter((part) => part.kind === 'purlin');
    for (const purlin of purlins) {
      expect(purlin.position[1]).toBeLessThan(roof.ridgeY);
      expect(purlin.position[1]).toBeGreaterThan(eaveY - 200);
    }
    // The eave row is lower than the ridge row: they follow the pitch, not a flat ceiling.
    expect(purlins[0]?.position[1]).toBeLessThan(purlins[purlins.length - 1]?.position[1] ?? 0);
  });

  it('gives a girt row one run per wall face', () => {
    const parts = purlinAndGirtParts(shed(), {
      purlinRows: 0,
      purlinSpanMm: 900,
      girtRows: 2,
      girtSpanMm: 1200,
    });
    expect(parts.filter((part) => part.kind === 'girt-side')).toHaveLength(4);
    expect(parts.filter((part) => part.kind === 'girt-end')).toHaveLength(4);
  });
});

describe('structureParts', () => {
  it('omits the roof and its trim when the roof is hidden', () => {
    const withRoof = structureParts(shed(), { showRoof: true, frameRows: null }).map((p) => p.kind);
    const without = structureParts(shed(), { showRoof: false, frameRows: null }).map((p) => p.kind);
    expect(withRoof).toContain('ridge-cap');
    expect(without).not.toContain('ridge-cap');
    expect(without).not.toContain('gutter-left');
  });

  it('keeps the gable ends and the frame when the roof is hidden', () => {
    // They are walls and steel, not roofing: a person lifting the roof off still sees them.
    const kinds = structureParts(shed(), { showRoof: false, frameRows: null }).map((p) => p.kind);
    expect(kinds).toContain('gable-end-front');
    expect(kinds).toContain('column');
  });

  it('puts the eave overhang outside the walls on both sides', () => {
    const s = shed();
    const roof = roofGeometry(s);
    // `slope` is the length *down the slope*, so the horizontal reach is its cosine — measuring
    // the slab by `slope / 2` would leave the eave short by the pitch's own projection.
    const reach = (roof.slope / 2) * Math.cos(roof.slopeAngle);
    expect(roof.leftX - reach).toBeCloseTo(-EAVE, 6);
    expect(roof.rightX + reach).toBeCloseTo(s.span + EAVE, 6);
  });
});
