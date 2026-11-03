import { describe, it, expect } from 'vitest';
import { PRESETS } from '../presets';
import { normaliseShedConfig } from '../schema';

describe('PRESETS', () => {
  it('offers at least three presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
  });
  it('every preset is a valid config', () => {
    for (const p of PRESETS) expect(() => normaliseShedConfig(p.config)).not.toThrow();
  });
  it('every preset has in-range bays and positive dimensions', () => {
    for (const p of PRESETS) {
      expect(p.config.bays).toBeGreaterThanOrEqual(2);
      expect(p.config.bays).toBeLessThanOrEqual(30);
      expect(p.config.span).toBeGreaterThan(0);
      expect(p.config.length).toBeGreaterThan(0);
      expect(p.config.height).toBeGreaterThan(0);
    }
  });

  it('survives normalisation unchanged in its key fields', () => {
    for (const p of PRESETS) {
      const n = normaliseShedConfig(p.config);
      expect(n.structureType).toBe(p.config.structureType);
      expect(n.span).toBe(p.config.span);
      expect(n.length).toBe(p.config.length);
      expect(n.height).toBe(p.config.height);
      expect(n.roofPitchDeg).toBe(p.config.roofPitchDeg);
      expect(n.bays).toBe(p.config.bays);
      expect(n.openings).toHaveLength(p.config.openings.length);
      for (let i = 0; i < n.openings.length; i++) {
        expect(n.openings[i].type).toBe(p.config.openings[i].type);
        expect(n.openings[i].width).toBe(p.config.openings[i].width);
        expect(n.openings[i].height).toBe(p.config.openings[i].height);
        expect(n.openings[i].wall).toBe(p.config.openings[i].wall);
        expect(n.openings[i].align).toBe(p.config.openings[i].align);
      }
    }
  });

  it('matches the four specified templates in millimetres', () => {
    const byName = new Map(PRESETS.map((p) => [p.name, p.config]));

    const garage = byName.get('Domestic Garage');
    expect(garage).toBeDefined();
    expect(garage).toMatchObject({
      structureType: 'gable',
      span: 6000,
      length: 6000,
      height: 2400,
      bays: 2,
    });
    expect(garage!.openings).toHaveLength(1);
    expect(garage!.openings[0]).toMatchObject({ type: 'roller_door', wall: 'front', align: 'center' });

    const farm = byName.get('Farm Machinery');
    expect(farm).toBeDefined();
    expect(farm).toMatchObject({
      structureType: 'gable',
      span: 12000,
      length: 24000,
      height: 4200,
      bays: 4,
    });
    expect(farm!.openings.map((o) => o.type).sort()).toEqual(['pa_door', 'roller_door']);
    expect(farm!.openings[0]).toMatchObject({ type: 'roller_door', wall: 'front', align: 'center' });

    const workshop = byName.get('Skillion Workshop');
    expect(workshop).toBeDefined();
    expect(workshop).toMatchObject({
      structureType: 'skillion',
      span: 9000,
      length: 15000,
      height: 3600,
      bays: 3,
    });
    expect(workshop!.openings).toHaveLength(1);
    expect(workshop!.openings[0].type).toBe('roller_door');

    const carport = byName.get('Open Carport');
    expect(carport).toBeDefined();
    expect(carport).toMatchObject({
      structureType: 'gable_carport',
      span: 6000,
      length: 6000,
      height: 2400,
      bays: 2,
      openings: [],
    });
  });
});
