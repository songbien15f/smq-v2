import { describe, it, expect } from 'vitest';
import {
  BOUNDARY_MARGIN_DEG,
  estimateWindRegion,
  inWindRegionExtent,
} from '../windRegion';

/**
 * The expectations below are what a point-in-polygon test on the **full** Geoscience Australia
 * shapefile (1.67 million vertices) answered for the same coordinates — measured 2026-11-19. The
 * simplified table this module ships agrees with all of them, which is the claim worth pinning:
 * reducing 1.67 m vertices to 1 980 must not move a city.
 */
const CITIES: [name: string, lat: number, lng: number, expected: 'A' | 'B' | 'C' | 'D'][] = [
  ['Brisbane CBD', -27.4698, 153.0251, 'B'],
  ['Sydney CBD', -33.8688, 151.2093, 'A'],
  ['Melbourne CBD', -37.8136, 144.9631, 'A'],
  ['Perth CBD', -31.9523, 115.8613, 'A'],
  ['Darwin', -12.4634, 130.8456, 'C'],
  ['Cairns', -16.9186, 145.7781, 'C'],
  ['Hobart', -42.8821, 147.3272, 'A'],
  ['Adelaide', -34.9285, 138.6007, 'A'],
  ['Alice Springs', -23.698, 133.8807, 'A'],
  ['Townsville', -19.2589, 146.8169, 'C'],
  ['Port Hedland', -20.3107, 118.6018, 'D'],
  ['Toowoomba', -27.5598, 151.9507, 'B'],
  ['Bundaberg', -24.8661, 152.3489, 'C'],
  ['Rockhampton', -23.3791, 150.51, 'C'],
  ['Canberra', -35.2809, 149.13, 'A'],
  ['Bathurst', -33.4193, 149.5775, 'A'],
  ['Wagga Wagga', -35.1082, 147.3598, 'A'],
  ['Ballarat', -37.5622, 143.8503, 'A'],
  ['Kalgoorlie', -30.749, 121.466, 'A'],
  ['Broken Hill', -31.9505, 141.469, 'A'],
];

describe('estimateWindRegion', () => {
  it('answers the same letter as the full dataset for 20 real towns', () => {
    for (const [name, lat, lng, expected] of CITIES) {
      expect(estimateWindRegion(lat, lng), name).toBe(expected);
    }
  });

  it('puts the far interior in A and the far north coast in C', () => {
    expect(estimateWindRegion(-25.0, 140.0)).toBe('A');
    expect(estimateWindRegion(-16.9, 145.8)).toBe('C');
  });

  it('refuses an answer near the boundary between two regions', () => {
    // 149.0 E at 23°S is 5.4 km from the B ring: inside the margin, so the answer is `null`
    // rather than a letter that 6 km would change.
    expect(estimateWindRegion(-23.0, 149.0)).toBeNull();
    expect(estimateWindRegion(-23.0, 149.3)).toBe('B');
    expect(estimateWindRegion(-27.5, 151.1)).toBeNull();
    expect(estimateWindRegion(-27.5, 151.2)).toBe('B');
    expect(estimateWindRegion(-27.5, 151.0)).toBe('A');
  });

  it('answers null outside Australia rather than guessing a region', () => {
    expect(estimateWindRegion(51.5, -0.12)).toBeNull();
    expect(estimateWindRegion(-40.0, 100.0)).toBeNull();
    expect(inWindRegionExtent(-0.12, 51.5)).toBe(false);
    expect(inWindRegionExtent(153.02, -27.47)).toBe(true);
  });

  it('answers null for a coordinate that is not a finite number', () => {
    expect(estimateWindRegion(Number.NaN, 153)).toBeNull();
    expect(estimateWindRegion(-27, Number.POSITIVE_INFINITY)).toBeNull();
    expect(estimateWindRegion(-27, Number.NaN)).toBeNull();
  });

  it('takes the nearest strip for a point just off a simplified coastline', () => {
    // ~20 km east of Brisbane: past the drawn edge, inside the fallback window.
    expect(estimateWindRegion(-27.2, 153.5)).toBe('B');
    // 100 km offshore is not the same place by any reading.
    expect(estimateWindRegion(-27.0, 154.5)).toBeNull();
  });

  it('publishes a margin at least as wide as the simplification tolerance', () => {
    // 0.05° is the Douglas–Peucker tolerance used to build the table; a narrower margin could
    // answer the wrong side of a boundary that was moved by that much.
    expect(BOUNDARY_MARGIN_DEG).toBeGreaterThanOrEqual(0.05);
  });
});
