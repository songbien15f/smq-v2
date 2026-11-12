import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '../defaults';
import type { Charge, ShedOption } from '../types';

describe('TEST_SHED', () => {
  it('is a gable shed with no openings and metre input units', () => {
    expect(TEST_SHED.structureType).toBe('gable');
    expect(TEST_SHED.span).toBe(12000);
    expect(TEST_SHED.length).toBe(24000);
    expect(TEST_SHED.height).toBe(4200);
    expect(TEST_SHED.bays).toBe(4);
    expect(TEST_SHED.openings).toEqual([]);
    // Stored values are millimetres, but the form enters and shows metres, so a
    // user types "12" for 12 m and "1.5" for 1500 mm.
    expect(TEST_SHED.displayUnit).toBe('m');
  });

  it('defaults to an empty options array', () => {
    expect(TEST_SHED.options).toEqual([]);
  });

  it('defaults to no charges and a closed internal pressure', () => {
    expect(TEST_SHED.charges).toEqual([]);
    expect(TEST_SHED.internalPressure).toBe('closed');
  });
});

describe('ShedOption', () => {
  it('accepts all eleven option kinds', () => {
    const all: ShedOption[] = [
      { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
      { id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400 },
      { id: 'aw-1', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
      { id: 'og-1', kind: 'outrigger', wall: 'front', bay: 0, length: 1900 },
      { id: 'dw-1', kind: 'dividing_wall', axis: 'x', at: 12000, height: 4200 },
      { id: 'gi-1', kind: 'gable_infill', end: 'front' },
      { id: 'st-1', kind: 'stable', wall: 'left', align: 'center', offset: null,
        width: 3000, depth: 2400, height: 2400,
        panels: { left: true, right: true, front: true, back: true } },
      { id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: null },
      { id: 'hc-1', kind: 'horizontal_cladding', wall: 'front', from: 0, to: 4200 },
      { id: 'oh-1', kind: 'overhang', wall: 'front', depth: 600 },
      { id: 'cl-1', kind: 'cantilever', wall: 'front', bay: 0, length: 1200 },
    ];
    expect(all.map((option) => option.kind)).toHaveLength(11);
  });
});

describe('Charge', () => {
  it('carries its price in whole cents', () => {
    const charge: Charge = { id: 'ch-1', label: 'Engineering', quantity: 1, unit: 'ea', unitPriceCents: 45000 };
    expect(charge.unitPriceCents).toBe(45000);
  });
});
