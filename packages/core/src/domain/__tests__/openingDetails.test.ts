import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { normaliseShedConfig } from '../schema';

function roller(patch: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    type: 'roller_door',
    width: 3000,
    height: 2400,
    sill: 0,
    wall: 'front',
    align: 'center',
    offset: null,
    swing: null,
    track: null,
    ...patch,
  };
}

describe('opening details', () => {
  it('turns windlocks on by default in wind regions C and D, and off in A', () => {
    const c = normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'C', openings: [roller()] });
    expect(c.openings[0]?.windlock).toBe(true);

    const a = normaliseShedConfig({ ...DEFAULT_SHED, windRegion: 'A', openings: [roller()] });
    expect(a.openings[0]?.windlock).toBe(false);
  });

  it('keeps an explicit windlock choice', () => {
    const c = normaliseShedConfig({
      ...DEFAULT_SHED,
      windRegion: 'D',
      openings: [roller({ windlock: false })],
    });
    expect(c.openings[0]?.windlock).toBe(false);
  });

  it('clears series and windlocks from a non-roller opening', () => {
    const c = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [roller({ type: 'window', series: 'B', windlock: true })],
    });
    expect(c.openings[0]?.series).toBeNull();
    expect(c.openings[0]?.windlock).toBe(false);
  });

  it('round-trips the catalogue SKU, series and Opening Only flag', () => {
    const c = normaliseShedConfig({
      ...DEFAULT_SHED,
      openings: [roller({ sku: 'RD-B-4800', series: 'B', prepOnly: true })],
    });
    expect(c.openings[0]).toMatchObject({ sku: 'RD-B-4800', series: 'B', prepOnly: true });
  });
});
