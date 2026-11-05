import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseOption } from '@/domain/options';
import type { MezzanineOption } from '@/domain/types';
import { mezzanineRateCentsPerM2 } from '../options';

const mezzanine = (patch: Partial<MezzanineOption> = {}): MezzanineOption => ({
  id: 'mz-1',
  kind: 'mezzanine',
  corner: 'back_left',
  width: 3000,
  depth: 3000,
  level: 2400,
  ...patch,
});

describe('mezzanine floor load', () => {
  it('defaults to the lightest storage load, so an old quote keeps its price', () => {
    const option = normaliseOption(mezzanine(), DEFAULT_SHED);
    expect(option.kind === 'mezzanine' && option.floorLoad).toBe(1.5);
  });

  it('snaps a load the catalogue does not sell to the nearest one above', () => {
    const option = normaliseOption(mezzanine({ floorLoad: 4 as never }), DEFAULT_SHED);
    expect(option.kind === 'mezzanine' && option.floorLoad).toBe(5);
  });

  it('snaps an out-of-range load into the set rather than pricing it at zero', () => {
    const high = normaliseOption(mezzanine({ floorLoad: 9 as never }), DEFAULT_SHED);
    expect(high.kind === 'mezzanine' && high.floorLoad).toBe(7.5);
  });

  it('charges more for a heavier floor, and the QLD factor applies', () => {
    expect(mezzanineRateCentsPerM2(1.5, 'NSW')).toBe(4000);
    expect(mezzanineRateCentsPerM2(3, 'NSW')).toBe(4500);
    expect(mezzanineRateCentsPerM2(5, 'NSW')).toBe(6000);
    expect(mezzanineRateCentsPerM2(7.5, 'NSW')).toBe(8000);
    expect(mezzanineRateCentsPerM2(1.5, 'QLD')).toBe(5600);
  });
});
