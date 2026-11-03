import { describe, it, expect } from 'vitest';
import {
  chargeAmountCents,
  chargesSubtotalCents,
  formatMoney,
  newCharge,
  normaliseCharge,
} from '@/domain/charges';
import type { Charge } from '@/domain/types';

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'ch-1', label: 'Engineering', quantity: 1, unit: 'ea', unitPriceCents: 45000, ...over,
});

describe('chargeAmountCents', () => {
  it('multiplies quantity by unit price', () => {
    expect(chargeAmountCents(charge({ quantity: 2, unitPriceCents: 9500 }))).toBe(19000);
  });

  it('rounds a fractional quantity to whole cents', () => {
    // 2.5 hours at $95.00 is $237.50 — not $237 and not $237.4999.
    expect(chargeAmountCents(charge({ quantity: 2.5, unitPriceCents: 9500 }))).toBe(23750);
  });

  it('handles a third of a unit without drifting', () => {
    expect(chargeAmountCents(charge({ quantity: 1 / 3, unitPriceCents: 30000 }))).toBe(10000);
  });
});

describe('chargesSubtotalCents', () => {
  it('sums every line', () => {
    expect(
      chargesSubtotalCents([
        charge({ unitPriceCents: 45000 }),
        charge({ id: 'ch-2', quantity: 2, unitPriceCents: 9500 }),
      ]),
    ).toBe(64000);
  });

  it('does not drift across many small lines', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it must be exactly 30.
    const many = Array.from({ length: 3 }, (_, i) =>
      charge({ id: `ch-${i}`, quantity: 1, unitPriceCents: 10 }),
    );
    expect(chargesSubtotalCents(many)).toBe(30);
  });

  it('is zero for an empty list', () => {
    expect(chargesSubtotalCents([])).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats cents with two decimals and thousands separators', () => {
    expect(formatMoney(123450)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
  });
});

describe('newCharge', () => {
  it('starts at one unit at zero price with a usable label', () => {
    const fresh = newCharge();
    expect(fresh).toMatchObject({ label: 'New charge', quantity: 1, unit: 'ea', unitPriceCents: 0 });
    expect(fresh.id).toMatch(/^ch-/);
  });
});

describe('normaliseCharge', () => {
  it('drops a non-object', () => {
    expect(normaliseCharge('nope', 'ch-1')).toBeUndefined();
    expect(normaliseCharge(null, 'ch-1')).toBeUndefined();
  });

  it('falls back for a blank label and unit', () => {
    const out = normaliseCharge({ label: '  ', unit: '' }, 'ch-1')!;
    expect(out.label).toBe('Charge');
    expect(out.unit).toBe('ea');
  });

  it('clamps a negative quantity and price to zero', () => {
    const out = normaliseCharge({ quantity: -3, unitPriceCents: -500 }, 'ch-1')!;
    expect(out.quantity).toBe(0);
    expect(out.unitPriceCents).toBe(0);
  });

  it('rounds a price to whole cents', () => {
    expect(normaliseCharge({ unitPriceCents: 450.7 }, 'ch-1')!.unitPriceCents).toBe(451);
  });

  it('uses the fallback id when none is given', () => {
    expect(normaliseCharge({ label: 'Delivery' }, 'ch-7')!.id).toBe('ch-7');
  });

  it('rounds a quantity to two decimals', () => {
    expect(normaliseCharge({ quantity: 2.567 }, 'ch-1')!.quantity).toBe(2.57);
  });

  it('accepts a dollar price at the AI boundary and converts to cents', () => {
    // A model answers in dollars; the internal form is cents.
    const out = normaliseCharge({ label: 'Delivery', unitPrice: 280 }, 'ch-1')!;
    expect(out.unitPriceCents).toBe(28000);
  });
});
