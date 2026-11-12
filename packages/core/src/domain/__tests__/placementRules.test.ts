import { describe, expect, it } from 'vitest';
import { TEST_SHED } from '../defaults';
import type {  Opening, ShedConfig, DimensionedShed } from '../types';
import {
  carryBeamRefusal,
  infillOverrideRefusal,
  placeOpening,
  removeOpeningWithCascade,
  removeOptionWithCascade,
  shouldWipeOptions,
  wipeOptions,
} from '../placementRules';

function opening(patch: Partial<Opening> = {}): Opening {
  return {
    id: 'op-1',
    type: 'window',
    width: 1200,
    height: 900,
    sill: 1200,
    wall: 'front',
    align: 'custom',
    offset: 100,
    swing: null,
    track: null,
    ...patch,
  };
}

describe('placeOpening', () => {
  it('accepts a door that clears both corners', () => {
    const result = placeOpening(opening(), TEST_SHED);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.opening.offset).toBe(100);
  });

  it('offers the nearest legal position when it is inside the 100 mm margin', () => {
    const result = placeOpening(opening({ offset: 40 }), TEST_SHED);
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.map((p) => p.opening.offset)).toContain(100);
    }
  });

  it('refuses an opening wider than the wall allows', () => {
    const result = placeOpening(opening({ width: 11900 }), TEST_SHED);
    expect(result.ok).toBe(false);
    if (!result.ok && 'reason' in result) expect(result.reason).toMatch(/wider/i);
  });

  it('offers a position beside an opening it would overlap', () => {
    const shed: DimensionedShed = { ...TEST_SHED, openings: [opening({ id: 'existing', offset: 100 })] };
    const result = placeOpening(opening({ id: 'new', width: 1000, offset: 500 }), shed);
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.some((p) => p.opening.offset === 1300)).toBe(true);
    }
  });

  it('offers a taller roller door when one is asked for below the catalogue minimum', () => {
    const result = placeOpening(
      opening({ type: 'roller_door', width: 3000, height: 1800, sill: 0 }),
      TEST_SHED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.some((p) => p.opening.height === 2000)).toBe(true);
    }
  });
});

describe('carryBeamRefusal', () => {
  it('refuses a span over 15 m and accepts one under it', () => {
    expect(carryBeamRefusal({ ...TEST_SHED, span: 16000 })).toMatch(/15/);
    expect(carryBeamRefusal({ ...TEST_SHED, span: 12000 })).toBeNull();
  });
});

describe('removal cascade', () => {
  it('clears a carry beam that pointed at a removed opening', () => {
    const shed: DimensionedShed = {
      ...TEST_SHED,
      openings: [opening()],
      options: [
        { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: 'op-1' },
      ],
    };
    const next = removeOpeningWithCascade('op-1', shed);
    expect(next.openings).toEqual([]);
    expect(next.options[0]).toMatchObject({ kind: 'carry_beam', openingId: null });
  });

  it('removes one option and leaves the rest', () => {
    const shed: DimensionedShed = {
      ...TEST_SHED,
      options: [
        { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
        { id: 'mo-1', kind: 'misc_option', name: 'Insulation', quantity: 1, unit: 'ea' },
      ],
    };
    const next = removeOptionWithCascade('sk-1', shed);
    expect(next.options.map((o) => o.id)).toEqual(['mo-1']);
  });
});

describe('wipe', () => {
  it('drops every option but keeps openings and charges', () => {
    const shed: DimensionedShed = {
      ...TEST_SHED,
      openings: [opening()],
      options: [{ id: 'mo-1', kind: 'misc_option', name: 'Insulation', quantity: 1, unit: 'ea' }],
      charges: [{ id: 'ch-1', label: 'Crane', quantity: 1, unit: 'ea', unitPriceCents: 100 }],
    };
    const next = wipeOptions(shed);
    expect(next.options).toEqual([]);
    expect(next.openings).toHaveLength(1);
    expect(next.charges).toHaveLength(1);
  });

  it('asks before wiping only when options exist and a dimension moved', () => {
    const withOption: ShedConfig = {
      ...TEST_SHED,
      options: [{ id: 'mo-1', kind: 'misc_option', name: 'Insulation', quantity: 1, unit: 'ea' }],
    };
    expect(shouldWipeOptions(withOption, { ...withOption, span: 13000 })).toBe(true);
    expect(shouldWipeOptions(withOption, { ...withOption, stateCode: 'NSW' })).toBe(false);
    expect(shouldWipeOptions(TEST_SHED, { ...TEST_SHED, span: 13000 })).toBe(false);
  });
});

/**
 * R3 — a gable-end door may displace an infill column only on a narrow building.
 *
 * The desktop's `AddingRuleDoor.AllowOverrideInfill` is `Wall.Plan.Width <= 4000`, and
 * the check before it is `OverrideAnyInfillColumn`: the door's rectangle, widened by the
 * door spacing, must actually contain a column. Both halves matter — refusing by wall
 * alone would ban every door in a wide gable, including the ones that fit between the
 * columns, which is the ordinary case.
 */
describe('infillOverrideRefusal (R3)', () => {
  /** Two infill columns, as the book places them on a 12 m gable. */
  const columns = [4017, 7983];

  it('allows a door between two columns, however wide the building', () => {
    // Centred on a 12 m gable: 4 500 .. 7 500, clear of both columns by more than the
    // 125 mm half-spacing.
    expect(infillOverrideRefusal(TEST_SHED, 'front', columns, 4500, 3000)).toBeNull();
  });

  it('refuses a door that lands on a column in a wide gable', () => {
    // 3 800 .. 6 800 contains the 4 017 column.
    const refusal = infillOverrideRefusal(TEST_SHED, 'front', columns, 3800, 3000);
    expect(refusal).toMatch(/infill column/);
    expect(refusal).toMatch(/4000/);
  });

  it('allows the same door on a narrow gable, where the factory re-spaces the run', () => {
    const narrow: DimensionedShed = { ...TEST_SHED, span: 3900 };
    expect(infillOverrideRefusal(narrow, 'front', [1300, 2600], 1200, 1200)).toBeNull();
  });

  it('never applies to a long wall, which has no infill columns', () => {
    expect(infillOverrideRefusal(TEST_SHED, 'left', columns, 3800, 3000)).toBeNull();
    expect(infillOverrideRefusal(TEST_SHED, 'right', columns, 3800, 3000)).toBeNull();
  });

  it('allows anything when the design has no infill columns', () => {
    expect(infillOverrideRefusal(TEST_SHED, 'front', [], 3800, 3000)).toBeNull();
  });

  it('counts a column near the jamb as displaced', () => {
    // The desktop widens the door by half the spacing: a column 50 mm outside the door
    // is still too close to leave standing.
    expect(infillOverrideRefusal(TEST_SHED, 'front', [4550], 4500, 3000)).not.toBeNull();
  });

  it('lets placeOpening skip R3 when it has no column positions', () => {
    // `placeOpening` on its own cannot read a price book, so it passes no positions and
    // R3 does not apply — the store, which has them, calls it with them.
    const door = opening({ type: 'roller_door', width: 3000, height: 2400, wall: 'front', offset: 3800 });
    expect(placeOpening(door, TEST_SHED).ok).toBe(true);
    expect(placeOpening(door, TEST_SHED, { infillPositionsMm: columns }).ok).toBe(false);
  });
});
