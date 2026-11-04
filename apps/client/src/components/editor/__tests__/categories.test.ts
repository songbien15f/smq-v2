import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@sq/core/domain';
import { CATEGORY_DOCK, categoryCount } from '../categories';

describe('CATEGORY_DOCK', () => {
  it('offers the desktop dock order, all fifteen', () => {
    expect(CATEGORY_DOCK.map((category) => category.label)).toEqual([
      'Window',
      'PA Door',
      'Roller Door',
      'Track',
      'Outrigger',
      'Sliding Door',
      'Dividing Wall',
      'Skylight',
      'Opening',
      'Mezzanine',
      'Awning',
      'Carry Beam',
      'Misc. Options',
      'Extra Charges or Notes',
      'Engineering Charges',
    ]);
  });

  it('has one unique id per category', () => {
    const ids = CATEGORY_DOCK.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts the objects of each category on a shed', () => {
    const shed = {
      ...DEFAULT_SHED,
      openings: [
        { id: 'o1', type: 'window' as const, width: 1200, height: 900, sill: 1200, wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: null },
        { id: 'o2', type: 'sliding_door' as const, width: 3000, height: 2400, sill: 0, wall: 'front' as const, align: 'center' as const, offset: null, swing: null, track: 'single' as const },
      ],
      options: [{ id: 'sk-1', kind: 'skylight' as const, bay: 0, alongBay: 0.5, width: 900, height: 900 }],
      charges: [{ id: 'ch-1', label: 'Crane', quantity: 1, unit: 'ea', unitPriceCents: 100 }],
    };

    const byLabel = (label: string) => CATEGORY_DOCK.find((category) => category.label === label)!;
    expect(categoryCount(shed, byLabel('Window'))).toBe(1);
    expect(categoryCount(shed, byLabel('Sliding Door'))).toBe(1);
    expect(categoryCount(shed, byLabel('Track'))).toBe(1);
    expect(categoryCount(shed, byLabel('Skylight'))).toBe(1);
    expect(categoryCount(shed, byLabel('Extra Charges or Notes'))).toBe(1);
    expect(categoryCount(shed, byLabel('Mezzanine'))).toBe(0);
  });
});
