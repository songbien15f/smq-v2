import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { ShedConfig } from '@/domain/types';
import type { BomResult } from '@/lib/bom/types';
import { priceQuote, type PriceInput } from '@/lib/pricing/price';
import { sellingChargesCents, validatePriceInput } from '@/lib/estimating/validate';

const bom = (totalCost: number): BomResult => ({
  groups: [],
  buildingCost: totalCost,
  totalCost,
  totalMassKg: 0,
  mockedLines: 0,
});

const input = (patch: Partial<PriceInput> = {}): PriceInput => ({
  margin: 1,
  deliveryCents: 0,
  engineeringCents: 0,
  extraCents: 0,
  additionsCents: 0,
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
  ...patch,
});

const shed = (patch: Partial<ShedConfig> = {}): ShedConfig => ({ ...DEFAULT_SHED, ...patch });

describe('validatePriceInput', () => {
  it('accepts the defaults', () => {
    expect(validatePriceInput(input())).toEqual(input());
  });

  it('rejects a deposit and progress that together exceed the contract', () => {
    // 60 + 60 leaves the balance at −20%: the three stages no longer describe
    // one price.
    expect(() => validatePriceInput(input({ depositPct: 60, progressPct: 60 }))).toThrow();
  });

  it('accepts percentages that leave a balance', () => {
    expect(() => validatePriceInput(input({ depositPct: 10, progressPct: 80 }))).not.toThrow();
    expect(() => validatePriceInput(input({ depositPct: 40, progressPct: 40 }))).not.toThrow();
  });

  it('allows half a percent of slack, and no more', () => {
    // A pair may round to slightly over 100; it may not overdraw the contract.
    expect(() => validatePriceInput(input({ depositPct: 50.2, progressPct: 50.2 }))).not.toThrow();
    expect(() => validatePriceInput(input({ depositPct: 50.4, progressPct: 50.4 }))).toThrow();
  });

  it('rejects a percentage outside 0 to 100', () => {
    expect(() => validatePriceInput(input({ depositPct: -1 }))).toThrow();
    expect(() => validatePriceInput(input({ progressPct: 101 }))).toThrow();
  });

  it('allows a zero deposit', () => {
    expect(() => validatePriceInput(input({ depositPct: 0, progressPct: 100 }))).not.toThrow();
  });

  it('rejects a non-finite or non-integer cents value', () => {
    expect(() => validatePriceInput(input({ deliveryCents: Number.NaN }))).toThrow();
    expect(() => validatePriceInput(input({ deliveryCents: 12.5 }))).toThrow();
    expect(() => validatePriceInput(input({ engineeringCents: Number.POSITIVE_INFINITY }))).toThrow();
  });

  it('rejects a negative charge', () => {
    expect(() => validatePriceInput(input({ extraCents: -100 }))).toThrow();
  });

  it('rejects a margin that is not a positive finite multiplier', () => {
    expect(() => validatePriceInput(input({ margin: Number.NaN }))).toThrow();
    expect(() => validatePriceInput(input({ margin: 0 }))).toThrow();
  });

  it('allows a discount through a negative quote rate, but not one that goes below zero', () => {
    expect(() => validatePriceInput(input({ quoteRatePct: -10 }))).not.toThrow();
    expect(() => validatePriceInput(input({ quoteRatePct: -100 }))).toThrow();
  });

  it('rejects a discount that would make the contract negative', () => {
    expect(() =>
      priceQuote(bom(1_000_000), input({ quoteRatePct: -99, additionsCents: 0 })),
    ).not.toThrow();
    expect(() =>
      priceQuote(bom(1_000_000), input({ quoteRatePct: -99.9, extraCents: 0 })),
    ).not.toThrow();
  });
});

describe('priceQuote rejects invalid input instead of coercing it', () => {
  it('throws on a NaN margin rather than silently using 1', () => {
    // Coercing to 1 is how a quote quietly loses its margin.
    expect(() => priceQuote(bom(1_000_000), input({ margin: Number.NaN }))).toThrow();
  });

  it('throws on a NaN delivery rather than treating it as free', () => {
    expect(() => priceQuote(bom(1_000_000), input({ deliveryCents: Number.NaN }))).toThrow();
  });
});

describe('payment stages reconcile exactly', () => {
  it('leaves a zero balance when the two stages are the whole contract', () => {
    const price = priceQuote(bom(1_000_001), input({ depositPct: 50, progressPct: 50 }));
    expect(price.balanceCents).toBe(0);
  });

  it('leaves a positive balance for a pair that does not reach the contract', () => {
    const price = priceQuote(bom(1_000_000), input({ depositPct: 40, progressPct: 40 }));
    expect(price.balanceCents).toBeGreaterThan(0);
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(
      price.contractCents,
    );
  });

  it('keeps the desktop fixture arithmetic unchanged', () => {
    const price = priceQuote(
      bom(1_500),
      input({
        margin: 1.48,
        deliveryCents: 27_500,
        engineeringCents: 11_000,
        quoteRatePct: 11,
        depositPct: 20,
        progressPct: 40,
      }),
    );
    expect(price.kitCents).toBe(2_442);
    expect(price.totalCents).toBe(40_942);
    expect(price.contractCents).toBe(45_446);
    expect(price.depositCents).toBe(9_089);
    expect(price.progressCents).toBe(18_178);
    expect(price.balanceCents).toBe(18_179);
  });
});

describe('sellingChargesCents', () => {
  it('sums the Charges tab as a GST-inclusive selling amount', () => {
    const config = shed({
      charges: [
        { id: 'c1', label: 'Crane hire', quantity: 1, unit: 'ea', unitPriceCents: 150_000 },
        { id: 'c2', label: 'Permit', quantity: 1, unit: 'ea', unitPriceCents: 45_000 },
      ],
    });
    expect(sellingChargesCents(config)).toBe(195_000);
  });

  it('is zero for a shed with no charges', () => {
    expect(sellingChargesCents(shed())).toBe(0);
  });

  it('multiplies a charge by its quantity', () => {
    const config = shed({
      charges: [{ id: 'c1', label: 'Crane', quantity: 3, unit: 'hr', unitPriceCents: 20_000 }],
    });
    expect(sellingChargesCents(config)).toBe(60_000);
  });
});
