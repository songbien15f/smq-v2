import { describe, it, expect } from 'vitest';
import {
  NO_MINIMUMS,
  belowFreightMinimum,
  deliveryForScope,
  freightScope,
  minimumFreightCents,
  type FreightMinimums,
} from '../delivery';
import type { DeliveryScope } from '@/lib/pricing/catalogues';

/**
 * Freight from the chosen scope, and the minimum the company agreed with its distributor.
 *
 * The numbers here are the desktop's own shape: its formula is
 * `round50( jobValue × (1 + rate%) × percent/100 )`, compared against a dollar minimum, and the larger
 * taken (`Quotation.cs:2183`). Each case below is arithmetic a person can check by hand, because the
 * alternative — asserting whatever the function happens to return — is how a percentage gets moved by
 * a factor of ten and stays green.
 */

/** The book's delivery table, abridged to the rows these tests need. */
const SCOPES: DeliveryScope[] = [
  { name: 'ex Works', value: 0, indexOrder: 1, stateValues: { QLD: 0, NSW: 0 } },
  { name: 'Delivered to site 0-100km', value: 250, indexOrder: 2, stateValues: { QLD: 250 } },
  { name: 'Delivered to site 301-400km', value: 650, indexOrder: 4, stateValues: null },
  { name: 'Delivered to site 401-500km', value: 1500, indexOrder: 5, stateValues: { QLD: 1750 } },
  { name: 'Delivered to Distributor', value: 0, indexOrder: 6, stateValues: null },
  { name: 'Delivered to Nominated Carrier', value: 0, indexOrder: 7, stateValues: null },
];

const MINIMUMS: FreightMinimums = {
  distributorDollarCents: 30_000,
  distributorPercent: 10,
  carrierDollarCents: 50_000,
  carrierPercent: 5,
};

describe('freightScope', () => {
  it('recognises the two scopes the desktop computes rather than reads', () => {
    expect(freightScope('Delivered to Distributor')).toBe('distributor');
    expect(freightScope('Delivered to Nominated Carrier')).toBe('carrier');
  });

  it('reads through a renamed scope rather than treating it as an ordinary one', () => {
    // The desktop compared two exact strings. A book that says "Delivered to distributor depot" would
    // then fall through to the book's own figure — which is 0 for these two — and quote freight free.
    expect(freightScope('Delivered to distributor depot')).toBe('distributor');
    expect(freightScope('  DELIVERED TO NOMINATED CARRIER ')).toBe('carrier');
  });

  it('leaves the ordinary distance scopes alone', () => {
    expect(freightScope('Delivered to site 0-100km')).toBeNull();
    expect(freightScope('ex Works')).toBeNull();
    expect(freightScope('')).toBeNull();
  });
});

describe('minimumFreightCents', () => {
  it('takes the percentage when it is the larger figure', () => {
    // $10 000 job × 10% = $1 000, above the $300 minimum.
    expect(
      minimumFreightCents({ scope: 'distributor', minimums: MINIMUMS, baseCents: 1_000_000, quoteRatePct: 0 }),
    ).toBe(100_000);
  });

  it('takes the dollar minimum when the percentage is smaller', () => {
    // $1 000 job × 10% = $100, below the $300 minimum.
    expect(
      minimumFreightCents({ scope: 'distributor', minimums: MINIMUMS, baseCents: 100_000, quoteRatePct: 0 }),
    ).toBe(30_000);
  });

  it('rounds to the nearest fifty dollars, as the desktop did', () => {
    // $12 345.67 × 7.5% = $925.9250… → $950.
    expect(
      minimumFreightCents({
        scope: 'distributor',
        minimums: { ...NO_MINIMUMS, distributorPercent: 7.5 },
        baseCents: 1_234_567,
        quoteRatePct: 0,
      }),
    ).toBe(95_000);
  });

  it('applies the quote rate, because a 10% uplift lifts the fee with it', () => {
    // $10 000 × 1.10 × 10% = $1 100.
    expect(
      minimumFreightCents({ scope: 'distributor', minimums: MINIMUMS, baseCents: 1_000_000, quoteRatePct: 10 }),
    ).toBe(110_000);
  });

  it('uses the carrier’s own numbers, not the distributor’s', () => {
    // $10 000 × 5% = $500, above the carrier's $500 minimum → exactly $500.
    expect(
      minimumFreightCents({ scope: 'carrier', minimums: MINIMUMS, baseCents: 1_000_000, quoteRatePct: 0 }),
    ).toBe(50_000);
  });

  it('is zero when nothing has been agreed', () => {
    expect(
      minimumFreightCents({ scope: 'carrier', minimums: NO_MINIMUMS, baseCents: 1_000_000, quoteRatePct: 0 }),
    ).toBe(0);
  });
});

describe('deliveryForScope', () => {
  const base = { scopes: SCOPES, minimums: MINIMUMS, baseCents: 1_000_000, quoteRatePct: 0 };

  it('reads the book’s figure for a distance scope', () => {
    expect(deliveryForScope({ ...base, scope: 'Delivered to site 301-400km', stateCode: 'QLD' })).toEqual({
      cents: 65_000,
      kind: 'book',
    });
  });

  it('prefers the state’s figure when the book states one', () => {
    // 401–500 km is $1 500 nationally and $1 750 in Queensland.
    expect(
      deliveryForScope({ ...base, scope: 'Delivered to site 401-500km', stateCode: 'QLD' })?.cents,
    ).toBe(175_000);
    expect(
      deliveryForScope({ ...base, scope: 'Delivered to site 401-500km', stateCode: 'NSW' })?.cents,
    ).toBe(150_000);
  });

  it('reads a zero as zero — “ex Works” means the freight is not included', () => {
    expect(deliveryForScope({ ...base, scope: 'ex Works', stateCode: 'QLD' })).toEqual({
      cents: 0,
      kind: 'book',
    });
  });

  it('computes the minimum-fee scopes instead of reading their placeholder zero', () => {
    // The book stores 0 for these two; that is a placeholder, not a free delivery.
    expect(deliveryForScope({ ...base, scope: 'Delivered to Distributor', stateCode: 'QLD' })).toEqual({
      cents: 100_000,
      kind: 'minimum',
      minimumCents: 100_000,
    });
  });

  it('answers null for a minimum-fee scope with nothing agreed, so a typed figure survives', () => {
    // This is the case that matters: picking the scope must not wipe the freight the operator typed.
    expect(
      deliveryForScope({
        ...base,
        minimums: NO_MINIMUMS,
        scope: 'Delivered to Distributor',
        stateCode: 'QLD',
      }),
    ).toBeNull();
  });

  it('answers null for a scope the book does not list', () => {
    expect(deliveryForScope({ ...base, scope: 'Picked up by the customer', stateCode: 'QLD' })).toBeNull();
    expect(deliveryForScope({ ...base, scope: '', stateCode: 'QLD' })).toBeNull();
  });

  it('matches the scope name without regard to case or padding', () => {
    expect(
      deliveryForScope({ ...base, scope: '  delivered to site 301-400KM ', stateCode: 'QLD' })?.cents,
    ).toBe(65_000);
  });
});

describe('belowFreightMinimum', () => {
  const base = { minimums: MINIMUMS, baseCents: 1_000_000, quoteRatePct: 0 };

  it('names the minimum when the quote is under it', () => {
    // $1 000 computed; $250 typed. The difference is freight the company absorbs.
    expect(belowFreightMinimum({ ...base, scope: 'Delivered to Distributor', deliveryCents: 25_000 })).toBe(
      100_000,
    );
  });

  it('says nothing when the quote meets it', () => {
    expect(belowFreightMinimum({ ...base, scope: 'Delivered to Distributor', deliveryCents: 100_000 })).toBeNull();
    expect(belowFreightMinimum({ ...base, scope: 'Delivered to Distributor', deliveryCents: 150_000 })).toBeNull();
  });

  it('says nothing for a scope with no minimum, however low the figure', () => {
    expect(belowFreightMinimum({ ...base, scope: 'ex Works', deliveryCents: 0 })).toBeNull();
    expect(
      belowFreightMinimum({ ...base, minimums: NO_MINIMUMS, scope: 'Delivered to Distributor', deliveryCents: 0 }),
    ).toBeNull();
  });
});
