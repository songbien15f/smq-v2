import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { placeOpening } from '../placementRules';
import { normaliseShedConfig } from '../schema';
import type { Opening } from '../types';

function sliding(patch: Partial<Opening> = {}): Opening {
  return {
    id: 'sd-1',
    type: 'sliding_door',
    width: 3000,
    height: 2400,
    sill: 0,
    wall: 'front',
    align: 'center',
    offset: null,
    swing: null,
    track: 'single',
    ...patch,
  };
}

describe('sliding-door track', () => {
  it('defaults to one segment at 3000 mm and clears the fields on another door type', () => {
    const c = normaliseShedConfig({ ...DEFAULT_SHED, openings: [sliding()] });
    expect(c.openings[0]).toMatchObject({ trackSegments: 1, trackWidth: 3000 });

    const window = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [sliding({ type: 'window', trackSegments: 4, trackWidth: 2000 })],
    });
    expect(window.openings[0]?.trackSegments).toBeUndefined();
    expect(window.openings[0]?.trackWidth).toBeUndefined();
  });

  it('clamps the segment count and the per-segment width', () => {
    const c = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [sliding({ trackSegments: 99, trackWidth: 200 })],
    });
    expect(c.openings[0]?.trackSegments).toBe(20);
    expect(c.openings[0]?.trackWidth).toBe(1000);
  });

  it('offers a legal width when the track is outside 1000–6000 mm per segment (R11)', () => {
    const result = placeOpening(sliding({ trackWidth: 800 }), DEFAULT_SHED);
    expect(result.ok).toBe(false);
    if (!result.ok && 'proposals' in result) {
      expect(result.proposals.some((proposal) => proposal.opening.trackWidth === 1000)).toBe(true);
    }
  });
});
