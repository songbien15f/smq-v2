import { describe, it, expect } from 'vitest';
import type { BomResult } from '@/lib/bom/types';
import {
  DEFAULT_DEPOSIT_PCT,
  DEFAULT_PROGRESS_PCT,
  GST_RATE,
  priceQuote,
  type PriceInput,
} from '@/lib/pricing/price';

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
  depositPct: DEFAULT_DEPOSIT_PCT,
  progressPct: DEFAULT_PROGRESS_PCT,
  ...patch,
});

describe('priceQuote', () => {
  it('applies the desktop price chain', () => {
    const price = priceQuote(
      bom(1_000_000),
      input({ margin: 1.48, deliveryCents: 120_000, engineeringCents: 85_000 }),
    );
    // kit = 1.48 × 1,000,000 × 1.1 = 1,628,000
    expect(price.kitCents).toBe(1_628_000);
    // total = kit + delivery + engineering = 1,833,000. The charges are added as
    // given because they are already GST-inclusive, which a real desktop quote
    // file confirmed (see the calibration test below).
    expect(price.totalCents).toBe(1_833_000);
    expect(price.contractCents).toBe(1_833_000);
  });

  it('treats the contract price as GST-inclusive and extracts the tax', () => {
    const price = priceQuote(bom(1_000_000), input());
    // The kit already carries GST: 1,000,000 × 1.1.
    expect(price.contractCents).toBe(1_100_000);
    // Tax = 1,100,000 − 1,100,000/1.1 = 100,000.
    expect(price.gstCents).toBe(100_000);
  });

  it('adds the charges as given, without loading GST on them again', () => {
    const withoutCharges = priceQuote(bom(1_000_000), input());
    const withCharges = priceQuote(bom(1_000_000), input({ deliveryCents: 100_000 }));
    // A $1,000 delivery adds $1,000. Loading GST here would overstate every quote
    // by the tax on its delivery; the desktop does not, and neither does this.
    expect(withCharges.totalCents - withoutCharges.totalCents).toBe(100_000);
  });

  it('does not double-charge the tax: contract + gst is not the buyer total', () => {
    const price = priceQuote(bom(1_000_000), input());
    // A common mistake is to treat `gstCents` as a component and add it on. The
    // contract is what the buyer pays; the tax is a slice of it.
    expect(price.contractCents - price.gstCents).toBe(1_000_000);
    expect(price.contractCents + price.gstCents).not.toBe(price.contractCents);
  });

  it('splits the three payment stages so they sum to the contract', () => {
    const price = priceQuote(bom(1_000_000), input());
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(
      price.contractCents,
    );
    expect(price.depositCents).toBe(110_000);
    expect(price.progressCents).toBe(770_000);
    expect(price.balanceCents).toBe(220_000);
  });

  it('makes the balance absorb percentages that do not sum to 100', () => {
    const price = priceQuote(bom(1_000_000), input({ depositPct: 10, progressPct: 80 }));
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(
      price.contractCents,
    );
    expect(price.balanceCents).toBe(
      price.contractCents - price.depositCents - price.progressCents,
    );
  });

  it('absorbs rounding in the progress payment when the two stages are the whole contract', () => {
    // A 50/50 split of an odd contract rounds both halves up and leaves −1 cent.
    // The desktop guards this exact case; here progress absorbs the remainder.
    const odd = priceQuote(bom(1_000_001), input({ depositPct: 50, progressPct: 50 }));
    expect(odd.balanceCents).toBe(0);
    expect(odd.depositCents + odd.progressCents).toBe(odd.contractCents);
  });

  it('refuses stages that overdraw the contract rather than showing a negative balance', () => {
    // 60 + 60 is 120: the stages no longer describe one price. A quote that tells
    // a buyer to pay 120% of the total is wrong, so the input is rejected.
    expect(() => priceQuote(bom(1_000_000), input({ depositPct: 60, progressPct: 60 }))).toThrow();
  });

  it('applies the quote rate and additions on top of the contract', () => {
    const price = priceQuote(bom(1_000_000), input({ quoteRatePct: 10, additionsCents: 50_000 }));
    // 1,100,000 × 1.10 + 50,000 = 1,260,000
    expect(price.contractCents).toBe(1_260_000);
  });

  it('handles a zero-deposit quote', () => {
    const price = priceQuote(bom(1_000_000), input({ depositPct: 0, progressPct: 100 }));
    expect(price.depositCents).toBe(0);
    expect(price.balanceCents).toBe(0);
  });

  it('handles a zero-cost quote without dividing by anything', () => {
    const price = priceQuote(bom(0), input());
    expect(price.kitCents).toBe(0);
    expect(price.contractCents).toBe(0);
    expect(price.gstCents).toBe(0);
    expect(price.balanceCents).toBe(0);
  });

  it('prices totalCost, not buildingCost, so misc is recovered at the margin', () => {
    const withMisc: BomResult = { ...bom(1_000_000), totalCost: 1_100_000 };
    const price = priceQuote(withMisc, input());
    expect(price.kitCents).toBe(1_210_000);
  });

  it('keeps the GST rate as a constant on the result', () => {
    expect(priceQuote(bom(1_000_000), input()).gstRate).toBe(GST_RATE);
    expect(GST_RATE).toBe(0.1);
  });

  it('is deterministic for the same input', () => {
    const same = input({ margin: 1.48, deliveryCents: 120_000, engineeringCents: 85_000 });
    expect(priceQuote(bom(1_000_000), same)).toEqual(priceQuote(bom(1_000_000), same));
  });

  it('rejects a NaN in an input rather than quietly substituting a default', () => {
    expect(() => priceQuote(bom(1_000_000), input({ margin: Number.NaN }))).toThrow();
    expect(() => priceQuote(bom(1_000_000), input({ deliveryCents: Number.NaN }))).toThrow();
  });

  it('rounds each figure once, so the stages add up exactly', () => {
    // A cost that does not divide evenly at any step.
    const price = priceQuote(bom(1_234_567), input({ margin: 1.37, depositPct: 33, progressPct: 33 }));
    expect(Number.isInteger(price.kitCents)).toBe(true);
    expect(Number.isInteger(price.contractCents)).toBe(true);
    expect(Number.isInteger(price.depositCents)).toBe(true);
    expect(price.depositCents + price.progressCents + price.balanceCents).toBe(
      price.contractCents,
    );
  });
});

describe('calibration against a real desktop quote', () => {
  /**
   * `smq-code-smartquote/App/SmartQuote/mock-test.sqd`, revision 1, read as plain
   * JSON. These are the desktop's own stored figures, not a reconstruction:
   *
   *   BomCost 15, Coeffcient 1.48, DeliveryCost 275, EngineerCharge 110,
   *   ExtraCharges 0, QuoteRateValue 11, AdditionsCost 0,
   *   KitOnly 24.42, TotalPrice 409.42, ContractPrice 454.46,
   *   QuoteDeposite 90.89 (20%), QuotePayment 181.78 (40%), QuoteBalance 181.79.
   *
   * Every step of the chain is reproduced from the inputs alone. This is the only
   * test in the suite that can prove the arithmetic against the old application
   * rather than against our own reading of its spec.
   */
  const desktop = {
    bomCostCents: 1_500,
    margin: 1.48,
    deliveryCents: 27_500,
    engineeringCents: 11_000,
    extraCents: 0,
    quoteRatePct: 11,
    additionsCents: 0,
    depositPct: 20,
    progressPct: 40,
  };

  it('reproduces the desktop kit figure to the cent', () => {
    const price = priceQuote(bom(desktop.bomCostCents), desktop);
    expect(price.kitCents).toBe(2_442);
  });

  it('reproduces the desktop total and contract figures to the cent', () => {
    const price = priceQuote(bom(desktop.bomCostCents), desktop);
    expect(price.totalCents).toBe(40_942);
    expect(price.contractCents).toBe(45_446);
  });

  it('reproduces the desktop payment split to the cent', () => {
    const price = priceQuote(bom(desktop.bomCostCents), desktop);
    expect(price.depositCents).toBe(9_089);
    expect(price.progressCents).toBe(18_178);
    expect(price.balanceCents).toBe(18_179);
  });
});
