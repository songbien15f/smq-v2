import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, ShedOption, DimensionedShed } from '@/domain/types';
import {
  canDuplicate,
  carryBeamSpan,
  defaultOptionsFor,
  normaliseOption,
  resolveOption,
  resolveOptions,
} from '@/domain/options';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

type Skylight = Extract<ShedOption, { kind: 'skylight' }>;
type Mezzanine = Extract<ShedOption, { kind: 'mezzanine' }>;
type DividingWall = Extract<ShedOption, { kind: 'dividing_wall' }>;

describe('defaultOptionsFor', () => {
  it('puts a skylight in the middle bay at the centre of the span', () => {
    const [option] = defaultOptionsFor('skylight', shed({ bays: 4 }));
    expect(option.kind).toBe('skylight');
    expect((option as Skylight).bay).toBe(2);
    expect((option as Skylight).alongBay).toBe(0.5);
  });

  it('creates both gable ends in one call', () => {
    const ends = defaultOptionsFor('gable_infill', shed());
    expect(ends).toHaveLength(2);
    expect(
      ends.map((option) => (option as Extract<ShedOption, { kind: 'gable_infill' }>).end),
    ).toEqual(['front', 'back']);
  });

  it('gives every kind a kind-specific id prefix', () => {
    expect(defaultOptionsFor('skylight', shed())[0].id).toMatch(/^sk-/);
    expect(defaultOptionsFor('mezzanine', shed())[0].id).toMatch(/^mz-/);
    expect(defaultOptionsFor('awning', shed())[0].id).toMatch(/^aw-/);
    expect(defaultOptionsFor('outrigger', shed())[0].id).toMatch(/^og-/);
    expect(defaultOptionsFor('dividing_wall', shed())[0].id).toMatch(/^dw-/);
    expect(defaultOptionsFor('gable_infill', shed())[0].id).toMatch(/^gi-/);
  });

  it('defaults a dividing wall to mid-length across the span', () => {
    const [option] = defaultOptionsFor('dividing_wall', shed({ length: 24000, height: 4200 }));
    expect((option as DividingWall).axis).toBe('x');
    expect((option as DividingWall).at).toBe(12000);
    expect((option as DividingWall).height).toBe(4200);
  });
});

describe('normaliseOption', () => {
  it('clamps a skylight bay into range when bays shrank', () => {
    const option: ShedOption = { id: 'sk-1', kind: 'skylight', bay: 9, alongBay: 0.5, width: 900, height: 900 };
    const out = normaliseOption(option, shed({ bays: 3 })) as Skylight;
    expect(out.bay).toBe(2);
  });

  it('clamps a mezzanine to the footprint when the shed shrank', () => {
    const option: ShedOption = {
      id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 9000, depth: 9000, level: 2400,
    };
    const out = normaliseOption(option, shed({ span: 6000, length: 8000 })) as Mezzanine;
    expect(out.width).toBeLessThanOrEqual(6000);
    expect(out.depth).toBeLessThanOrEqual(8000);
  });

  it('clamps a dividing wall away from the walls by 300 mm', () => {
    const option: ShedOption = { id: 'dw-1', kind: 'dividing_wall', axis: 'x', at: 0, height: 4200 };
    const out = normaliseOption(option, shed({ length: 24000 })) as DividingWall;
    expect(out.at).toBe(300);
  });

  it('clamps a dividing wall to the far margin too', () => {
    const option: ShedOption = { id: 'dw-1', kind: 'dividing_wall', axis: 'x', at: 999999, height: 4200 };
    const out = normaliseOption(option, shed({ length: 24000 })) as DividingWall;
    expect(out.at).toBe(24000 - 300);
  });

  it('keeps a mezzanine level below the eaves', () => {
    const option: ShedOption = {
      id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 99999,
    };
    const out = normaliseOption(option, shed({ height: 4200 })) as Mezzanine;
    expect(out.level).toBe(4200 - 300);
  });

  it('rounds every numeric field to whole millimetres', () => {
    const option: ShedOption = {
      id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null,
      width: 2999.6, depth: 999.4,
    };
    const out = normaliseOption(option, shed());
    expect(out).toMatchObject({ width: 3000, depth: 999 });
  });
});

describe('resolveOption', () => {
  it('places a skylight inside the roof rectangle', () => {
    const option: ShedOption = {
      id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
    };
    const out = resolveOption(option, shed({ span: 12000, length: 24000, bays: 4, height: 4200 }));
    expect(out.rect.x).toBeGreaterThanOrEqual(0);
    expect(out.rect.x + out.rect.width).toBeLessThanOrEqual(12000);
    expect(out.rect.y).toBeGreaterThanOrEqual(0);
    expect(out.rect.y + out.rect.height).toBeLessThanOrEqual(24000);
  });

  it('puts a skylight at roof height', () => {
    const option: ShedOption = {
      id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
    };
    const out = resolveOption(option, shed({ height: 4200, roofPitchDeg: 10 }));
    expect(out.zLow).toBeGreaterThanOrEqual(4200);
    expect(out.zHigh).toBe(out.zLow);
  });

  it('gives a mezzanine a floor level and a slab top', () => {
    const option: ShedOption = {
      id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400,
    };
    const out = resolveOption(option, shed());
    expect(out.zLow).toBe(2400);
    expect(out.zHigh).toBeGreaterThan(2400);
  });

  it('anchors a mezzanine at the corner it names', () => {
    const back = resolveOption(
      { id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400 },
      shed({ span: 12000, length: 24000 }),
    );
    expect(back.rect.x).toBe(0);
    expect(back.rect.y).toBe(24000 - 3000);

    const frontRight = resolveOption(
      { id: 'mz-2', kind: 'mezzanine', corner: 'front_right', width: 3000, depth: 3000, level: 2400 },
      shed({ span: 12000, length: 24000 }),
    );
    expect(frontRight.rect.x).toBe(12000 - 3000);
    expect(frontRight.rect.y).toBe(0);
  });

  it('resolves a gable infill to a triangle whose rise matches the pitch', () => {
    const option: ShedOption = { id: 'gi-1', kind: 'gable_infill', end: 'front' };
    const out = resolveOption(option, shed({ span: 12000, roofPitchDeg: 10 }));
    const rise = Math.tan((10 * Math.PI) / 180) * 6000;
    expect(out.triangle?.base).toBe(12000);
    expect(out.triangle?.rise).toBeCloseTo(rise, 3);
  });

  it('puts the gable infill triangle above wall height', () => {
    const out = resolveOption({ id: 'gi-1', kind: 'gable_infill', end: 'back' }, shed({ height: 4200 }));
    expect(out.zLow).toBe(4200);
    expect(out.zHigh).toBeGreaterThan(4200);
  });

  it('returns one resolved entry per stored option', () => {
    const config = shed({
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
        { id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
      ],
    });
    expect(resolveOptions(config)).toHaveLength(2);
  });

  it('returns an empty list for a shed with no options', () => {
    expect(resolveOptions(shed())).toEqual([]);
  });
});

describe('roof height and bay lines (review I4, I5)', () => {
  it('places a skylight on the skillion roof plane at its own position', () => {
    const config = shed({
      structureType: 'skillion',
      span: 9000,
      length: 15000,
      height: 4000,
      roofPitchDeg: 5,
      bays: 3,
      options: [{ id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 }],
    });
    const resolved = resolveOption(config.options[0], config);
    // The skillion roof falls along the length, so the roof height at the
    // skylight's y is what the pane must sit on.
    const fall = Math.tan((5 * Math.PI) / 180) * 15000;
    const roofAtY = 4000 + fall * (1 - (resolved.rect.y + resolved.rect.height / 2) / 15000);
    expect(resolved.zLow).toBeCloseTo(roofAtY, 0);
  });

  it('keeps a skylight on a gable roof level with the ridge slope at its x', () => {
    const config = shed({ span: 12000, height: 4200, roofPitchDeg: 10, bays: 4 });
    const option: ShedOption = {
      id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
    };
    const resolved = resolveOption(option, config);
    const rise = Math.tan((10 * Math.PI) / 180) * Math.min(
      resolved.rect.x + resolved.rect.width / 2,
      12000 - (resolved.rect.x + resolved.rect.width / 2),
    );
    expect(resolved.zLow).toBeCloseTo(4200 + rise, 0);
  });

  it('puts an outrigger on a bay line, not at the bay centre', () => {
    const config = shed({ span: 12000, length: 24000, bays: 4 });
    const option: ShedOption = { id: 'og-1', kind: 'outrigger', wall: 'front', bay: 1, length: 1900 };
    const resolved = resolveOption(option, config);
    // Bay 1 starts at 6000 along the length; on the front wall that is u = 6000,
    // which is x = 6000 in plan. The rect is centred on that line.
    expect(resolved.rect.x + resolved.rect.width / 2).toBe(6000);
  });

  it('keeps a front outrigger inside the span even in the last bay', () => {
    const config = shed({ span: 12000, length: 24000, bays: 4 });
    const option: ShedOption = { id: 'og-1', kind: 'outrigger', wall: 'front', bay: 3, length: 1900 };
    const resolved = resolveOption(option, config);
    expect(resolved.rect.x).toBeGreaterThanOrEqual(0);
    expect(resolved.rect.x + resolved.rect.width).toBeLessThanOrEqual(12000);
  });
});

describe('the five remaining kinds', () => {
  it('defaults a stable to the front wall with all panels on', () => {
    const [option] = defaultOptionsFor('stable', shed());
    expect(option).toMatchObject({
      kind: 'stable', wall: 'front', align: 'center', width: 3000, depth: 2400, height: 2400,
      panels: { left: true, right: true, front: true, back: true },
    });
    expect(option.id).toMatch(/^st-/);
  });

  it('defaults a carry beam to the first bay, open', () => {
    const [option] = defaultOptionsFor('carry_beam', shed());
    expect(option).toMatchObject({ kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: null });
    expect(option.id).toMatch(/^cb-/);
  });

  it('defaults cladding to the full wall height', () => {
    const [option] = defaultOptionsFor('horizontal_cladding', shed({ height: 4200 }));
    expect(option).toMatchObject({ kind: 'horizontal_cladding', from: 0, to: 4200 });
    expect(option.id).toMatch(/^hc-/);
  });

  it('defaults an overhang to 600 mm and a cantilever to 1200 mm', () => {
    const overhang = defaultOptionsFor('overhang', shed())[0];
    const cantilever = defaultOptionsFor('cantilever', shed())[0];
    expect(overhang).toMatchObject({ kind: 'overhang', depth: 600 });
    expect(cantilever).toMatchObject({ kind: 'cantilever', length: 1200, bay: 0 });
    expect(overhang.id).toMatch(/^oh-/);
    expect(cantilever.id).toMatch(/^cl-/);
  });

  it('clamps a cladding band that is inverted', () => {
    const option: ShedOption = {
      id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 3000, to: 1000,
    };
    const out = normaliseOption(option, shed({ height: 4200 })) as Extract<
      ShedOption, { kind: 'horizontal_cladding' }
    >;
    expect(out.from).toBeLessThan(out.to);
    expect(out.to).toBeLessThanOrEqual(4200);
  });

  it('clamps a cladding band that exceeds the wall height', () => {
    const option: ShedOption = {
      id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 0, to: 99999,
    };
    const out = normaliseOption(option, shed({ height: 4200 })) as Extract<
      ShedOption, { kind: 'horizontal_cladding' }
    >;
    expect(out.to).toBe(4200);
  });

  it('clamps a stable to the wall it sits on', () => {
    const option: ShedOption = {
      id: 'st-1', kind: 'stable', wall: 'front', align: 'custom', offset: 99999,
      width: 3000, depth: 2400, height: 2400,
      panels: { left: true, right: true, front: true, back: true },
    };
    const out = normaliseOption(option, shed({ span: 12000 })) as Extract<ShedOption, { kind: 'stable' }>;
    expect(out.offset).toBeLessThanOrEqual(12000 - 3000);
  });

  it('resolves a carry beam across the bay it names', () => {
    const config = shed({ length: 24000, bays: 4 });
    const beam: ShedOption = { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null };
    const span = carryBeamSpan(config, beam as Extract<ShedOption, { kind: 'carry_beam' }>);
    expect(span.start).toBe(6000);
    expect(span.end).toBe(12000);
  });

  it('resolves each new kind to a positive-size rect', () => {
    const config = shed({
      options: [
        { id: 'st-1', kind: 'stable', wall: 'left', align: 'center', offset: null,
          width: 3000, depth: 2400, height: 2400,
          panels: { left: true, right: true, front: true, back: true } },
        { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: null },
        { id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 0, to: 4200 },
        { id: 'oh-1', kind: 'overhang', wall: 'front', depth: 600 },
        { id: 'cl-1', kind: 'cantilever', wall: 'front', bay: 0, length: 1200 },
      ],
    });
    for (const resolved of resolveOptions(config)) {
      expect(resolved.rect.width).toBeGreaterThan(0);
      expect(resolved.rect.height).toBeGreaterThan(0);
    }
  });

  it('puts a cladding band at the heights it names', () => {
    const config = shed({
      height: 4200,
      options: [{ id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 1000, to: 2500 }],
    });
    const resolved = resolveOptions(config)[0];
    expect(resolved.zLow).toBe(1000);
    expect(resolved.zHigh).toBe(2500);
  });

  it('gives a stable a footprint that starts at the floor', () => {
    const config = shed({
      options: [{ id: 'st-1', kind: 'stable', wall: 'front', align: 'center', offset: null,
        width: 3000, depth: 2400, height: 2400,
        panels: { left: true, right: true, front: true, back: true } }],
    });
    const resolved = resolveOptions(config)[0];
    expect(resolved.zLow).toBe(0);
    expect(resolved.zHigh).toBe(2400);
  });
});

describe('review fixes: overhang height and carry beam placement', () => {
  it('puts an overhang at the eave, not at the ridge', () => {
    const config = shed({ span: 12000, roofPitchDeg: 10, height: 4200, options: [
      { id: 'oh-1', kind: 'overhang', wall: 'front', depth: 600 },
    ]});
    const resolved = resolveOptions(config)[0];
    // The overhang continues the roof past the wall, so it sits at wall height
    // at the eave — the ridge rise belongs at mid-span, not out at the wall.
    expect(resolved.zLow).toBe(4200);
  });

  it('keeps a carry beam on its wall for every bay', () => {
    const config = shed({ span: 12000, length: 24000, bays: 4 });
    for (const beginBay of [0, 1, 2, 3]) {
      const resolved = resolveOption(
        { id: 'cb', kind: 'carry_beam', wall: 'front', beginBay, openingId: null },
        config,
      );
      expect(resolved.rect.x).toBeGreaterThanOrEqual(0);
      expect(resolved.rect.x + resolved.rect.width).toBeLessThanOrEqual(12000);
    }
  });

  it('keeps a carry beam on a left wall inside the length', () => {
    const config = shed({ span: 12000, length: 24000, bays: 4 });
    const resolved = resolveOption(
      { id: 'cb', kind: 'carry_beam', wall: 'left', beginBay: 3, openingId: null },
      config,
    );
    expect(resolved.rect.y).toBeGreaterThanOrEqual(0);
    expect(resolved.rect.y + resolved.rect.height).toBeLessThanOrEqual(24000);
  });
});

describe('canDuplicate (deferred minor)', () => {
  it('does not offer a duplicate for a kind that spans its whole wall', () => {
    expect(canDuplicate({ id: 'oh-1', kind: 'overhang', wall: 'front', depth: 600 })).toBe(false);
    expect(canDuplicate({
      id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 0, to: 4200,
    })).toBe(false);
  });

  it('offers a duplicate for a kind that has a position along its wall', () => {
    expect(canDuplicate({
      id: 'st-1', kind: 'stable', wall: 'front', align: 'center', offset: null,
      width: 3000, depth: 2400, height: 2400,
      panels: { left: true, right: true, front: true, back: true },
    })).toBe(true);
    expect(canDuplicate({ id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 }))
      .toBe(true);
  });
});
