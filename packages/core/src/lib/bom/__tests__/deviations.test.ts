import { describe, it, expect } from 'vitest';
import { DEVIATIONS } from '@/lib/bom/deviations';

describe('DEVIATIONS', () => {
  it('numbers every entry once, in order', () => {
    expect(DEVIATIONS.map((d) => d.id)).toEqual(DEVIATIONS.map((_, index) => index + 1));
  });

  it('covers at least the five the plan named', () => {
    // The plan named five; execution against the real price book found more. An
    // omissions-only list implies the rest of the numbers agree, so the floor is
    // the plan's five and the real count is higher.
    expect(DEVIATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every deviation a non-empty reason and price effect', () => {
    for (const deviation of DEVIATIONS) {
      expect(deviation.area.length).toBeGreaterThan(2);
      expect(deviation.prior.length).toBeGreaterThan(10);
      expect(deviation.here.length).toBeGreaterThan(10);
      expect(deviation.why.length).toBeGreaterThan(10);
      expect(deviation.priceEffect.length).toBeGreaterThan(5);
    }
  });

  it('states a direction for every price effect rather than a bare number', () => {
    // A deviation whose cost depends on the building cannot honestly quote one
    // figure, so every entry says which way the total moves.
    for (const deviation of DEVIATIONS) {
      expect(deviation.priceEffect.toLowerCase()).toMatch(/material|none|neutral/);
    }
  });

  it('names the five the plan listed, by area', () => {
    const areas = DEVIATIONS.map((d) => d.area.toLowerCase()).join(' ');
    expect(areas).toMatch(/girt/);
    expect(areas).toMatch(/sheeting/);
    expect(areas).toMatch(/gutter/);
    expect(areas).toMatch(/screw/);
    expect(areas).toMatch(/delivery weight/);
  });
});
