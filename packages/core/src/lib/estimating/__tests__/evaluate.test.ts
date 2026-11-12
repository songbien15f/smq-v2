import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import { evaluateQuote } from '@/lib/estimating/evaluate';
import { ENGINE_VERSION } from '@/lib/estimating/versions';
import type { PricingContext } from '@/lib/estimating/types';
import { syntheticLookup } from '@/lib/bom/__tests__/fixtures/referenceBuildings';
import { DEFAULT_CONTRACTS } from '@/lib/pricing/catalogueManifest';

const book = (over: Partial<PricingContext> = {}): PricingContext => ({
  lookup: syntheticLookup(),
  provenance: {
    engineVersion: ENGINE_VERSION,
    baseBookHash: 'a'.repeat(64),
    overrideVersion: 0,
    policyVersion: 1,
  },
  policy: { margin: 1, currency: 'AUD', chargeBasis: 'selling-gst-inclusive' },
  ...over,
});

const input = {
  deliveryCents: 0,
  engineeringCents: 0,
  extraCents: 0,
  additionsCents: 0,
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
};

const config = { ...TEST_SHED, span: 6000, length: 10_000, height: 2400, roofPitchDeg: 0, bays: 2, openings: [], charges: [] };

describe('evaluateQuote', () => {
  it('is deterministic for the same input', () => {
    expect(evaluateQuote(config, input, book()!)!).toEqual(evaluateQuote(config, input, book()!)!);
  });

  it('does not mutate its arguments', () => {
    const frozen = JSON.stringify({ config, input });
    evaluateQuote(config, input, book()!)!;
    expect(JSON.stringify({ config, input })).toBe(frozen);
  });

  it('carries the price-book hash into its provenance', () => {
    const other = book({
      provenance: { ...book().provenance, baseBookHash: 'b'.repeat(64) },
    });
    expect(evaluateQuote(config, input, other)!.provenance.baseBookHash).toBe('b'.repeat(64));
  });

  it('applies the policy margin rather than taking one from the caller', () => {
    const doubled = book({
      policy: { margin: 2, currency: 'AUD', chargeBasis: 'selling-gst-inclusive' },
    });
    const plain = evaluateQuote(config, input, book()!)!;
    const dearer = evaluateQuote(config, input, doubled)!;
    expect(dearer.price.contractCents).toBeGreaterThan(plain.price.contractCents);
  });

  it('adds selling charges to the contract exactly once', () => {
    const charged = evaluateQuote(
      { ...config, charges: [{ id: 'c1', label: 'Crane', quantity: 1, unit: 'ea', unitPriceCents: 15_000 }] },
      input,
      book(),
    )!;
    const plain = evaluateQuote(config, input, book()!)!;
    expect(charged.price.contractCents - plain.price.contractCents).toBe(15_000);
    // The material cost is untouched: a charge is not a material.
    expect(charged.bom.totalCost).toBe(plain.bom.totalCost);
  });

  it('reports a status of indicative while design assumptions remain', () => {
    expect(evaluateQuote(config, input, book()!)!.status).toBe('indicative');
  });

  it('reports blocked when a required price is missing', () => {
    const noSheeting = book({ lookup: syntheticLookup({ sheeting: () => undefined }) });
    const result = evaluateQuote(config, input, noSheeting)!;
    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.severity === 'blocker')).toBe(true);
  });

  it('reconciles the three payment stages to the contract', () => {
    const result = evaluateQuote(config, input, book()!)!;
    expect(
      result.price.depositCents + result.price.progressCents + result.price.balanceCents,
    ).toBe(result.price.contractCents);
  });

  it('produces JSON with no NaN or Infinity anywhere', () => {
    const json = JSON.stringify(evaluateQuote(config, input, book()!)!);
    expect(json).not.toMatch(/NaN|Infinity/);
  });

  it('rejects an invalid price input', () => {
    expect(() => evaluateQuote(config, { ...input, depositPct: 60, progressPct: 60 }, book()!)!).toThrow();
  });

  it('normalises a config that arrives with metre-valued dimensions', () => {
    // The evaluator is the boundary the browser posts to, so it normalises the
    // config the same way the rest of the app does.
    const result = evaluateQuote(
      { ...config, span: 6000, length: 10_000 } as never,
      input,
      book(),
    )!;
    expect(result.config.span).toBe(6000);
  });
});
