import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import type { Opening, ShedConfig } from '../types';
import {
  carryBeamRefusal,
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
    const result = placeOpening(opening(), DEFAULT_SHED);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.opening.offset).toBe(100);
  });

  it('offers the nearest legal position when it is inside the 100 mm margin', () => {
    const result = placeOpening(opening({ offset: 40 }), DEFAULT_SHED);
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.map((p) => p.opening.offset)).toContain(100);
    }
  });

  it('refuses an opening wider than the wall allows', () => {
    const result = placeOpening(opening({ width: 11900 }), DEFAULT_SHED);
    expect(result.ok).toBe(false);
    if (!result.ok && 'reason' in result) expect(result.reason).toMatch(/wider/i);
  });

  it('offers a position beside an opening it would overlap', () => {
    const shed: ShedConfig = { ...DEFAULT_SHED, openings: [opening({ id: 'existing', offset: 100 })] };
    const result = placeOpening(opening({ id: 'new', width: 1000, offset: 500 }), shed);
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.some((p) => p.opening.offset === 1300)).toBe(true);
    }
  });

  it('offers a taller roller door when one is asked for below the catalogue minimum', () => {
    const result = placeOpening(
      opening({ type: 'roller_door', width: 3000, height: 1800, sill: 0 }),
      DEFAULT_SHED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.some((p) => p.opening.height === 2000)).toBe(true);
    }
  });
});

describe('carryBeamRefusal', () => {
  it('refuses a span over 15 m and accepts one under it', () => {
    expect(carryBeamRefusal({ ...DEFAULT_SHED, span: 16000 })).toMatch(/15/);
    expect(carryBeamRefusal({ ...DEFAULT_SHED, span: 12000 })).toBeNull();
  });
});

describe('removal cascade', () => {
  it('clears a carry beam that pointed at a removed opening', () => {
    const shed: ShedConfig = {
      ...DEFAULT_SHED,
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
    const shed: ShedConfig = {
      ...DEFAULT_SHED,
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
    const shed: ShedConfig = {
      ...DEFAULT_SHED,
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
      ...DEFAULT_SHED,
      options: [{ id: 'mo-1', kind: 'misc_option', name: 'Insulation', quantity: 1, unit: 'ea' }],
    };
    expect(shouldWipeOptions(withOption, { ...withOption, span: 13000 })).toBe(true);
    expect(shouldWipeOptions(withOption, { ...withOption, stateCode: 'NSW' })).toBe(false);
    expect(shouldWipeOptions(DEFAULT_SHED, { ...DEFAULT_SHED, span: 13000 })).toBe(false);
  });
});
