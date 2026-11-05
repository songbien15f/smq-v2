import { describe, expect, it } from 'vitest';
import { contractFromTotal, stagesFromContract } from '../price';

describe('contractFromTotal', () => {
  it('applies the quote rate before the additions', () => {
    // The desktop's own figure: TotalPrice 299.42, rate 2%, no additions → 305.41.
    expect(contractFromTotal(29942, 2, 0)).toBe(30541);
  });

  it('adds additions after the rate, not before it', () => {
    expect(contractFromTotal(10000, 0, 500)).toBe(10500);
    // 10% of 100.00 is 10.00; additions are not marked up by the rate.
    expect(contractFromTotal(10000, 10, 500)).toBe(11500);
  });
});

describe('stagesFromContract', () => {
  it('splits the contract with the balance as the remainder', () => {
    const stages = stagesFromContract(30541, 20, 40);
    expect(stages.depositCents).toBe(6108);
    expect(stages.progressCents).toBe(12216);
    expect(stages.balanceCents).toBe(12217);
    expect(stages.depositCents + stages.progressCents + stages.balanceCents).toBe(30541);
  });

  it('lets the progress payment absorb the rounding when the two stages are whole', () => {
    const stages = stagesFromContract(10001, 50, 50);
    expect(stages.balanceCents).toBe(0);
    expect(stages.depositCents + stages.progressCents + stages.balanceCents).toBe(10001);
  });
});
