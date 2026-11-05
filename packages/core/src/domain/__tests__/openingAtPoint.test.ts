import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { openingAtPoint } from '../placementRules';

const roller = { type: 'roller_door' as const, width: 3000, height: 2400, sill: 0, swing: null, track: null };

describe('openingAtPoint', () => {
  it('picks the front wall for a point on it and centres the door on the pointer', () => {
    const { wall, outcome } = openingAtPoint(DEFAULT_SHED, roller, { x: 6000, y: 0 });
    expect(wall).toBe('front');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.opening.wall).toBe('front');
      expect(outcome.opening.offset).toBe(4500);
    }
  });

  it('picks the right wall and maps the pointer along the length', () => {
    const { wall, outcome } = openingAtPoint(DEFAULT_SHED, roller, { x: 12000, y: 12000 });
    expect(wall).toBe('right');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.opening.offset).toBe(10500);
  });

  it('offers a legal position when the pointer is in a corner', () => {
    const { wall, outcome } = openingAtPoint(DEFAULT_SHED, roller, { x: 50, y: 0 });
    expect(wall).toBe('front');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && 'proposals' in outcome) {
      expect(outcome.proposals[0]?.opening.offset).toBe(100);
    }
  });

  it('resolves a point outside the building to the nearest edge', () => {
    expect(openingAtPoint(DEFAULT_SHED, roller, { x: 6000, y: -800 }).wall).toBe('front');
    expect(openingAtPoint(DEFAULT_SHED, roller, { x: 13000, y: 6000 }).wall).toBe('right');
  });

  it('returns the candidate it tested, so the ghost can be drawn where the click was', () => {
    // The overlay draws the candidate (what the pointer asked for) and the outcome (what
    // the rules allow) as two positions. Rebuilding the candidate in the renderer would be
    // a second implementation of "where the pointer means", which is how a ghost and a
    // write drift apart.
    const { candidate, outcome } = openingAtPoint(DEFAULT_SHED, roller, { x: 6000, y: 0 });
    expect(candidate.offset).toBe(4500);
    expect(candidate.wall).toBe('front');
    expect(outcome.ok).toBe(true);
  });

  it('accepts a request without swing or track, which do not decide whether it fits', () => {
    const { outcome } = openingAtPoint(
      DEFAULT_SHED,
      { type: 'pa_door', width: 820, height: 2040, sill: 0 },
      { x: 6000, y: 0 },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.opening.swing).toBeNull();
      expect(outcome.opening.track).toBeNull();
    }
  });
});
