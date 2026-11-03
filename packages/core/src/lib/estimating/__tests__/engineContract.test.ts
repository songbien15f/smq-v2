import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { PRESETS } from '@/domain/presets';
import type { ShedOption } from '@/domain/types';
import { evaluateQuote } from '@/lib/estimating/evaluate';
import { ENGINE_VERSION } from '@/lib/estimating/versions';
import type { PricingContext } from '@/lib/estimating/types';
import { syntheticLookup } from '@/lib/bom/__tests__/fixtures/referenceBuildings';

const book: PricingContext = {
  lookup: syntheticLookup(),
  provenance: {
    engineVersion: ENGINE_VERSION,
    baseBookHash: 'a'.repeat(64),
    overrideVersion: 0,
    policyVersion: 1,
  },
  policy: { margin: 1.48, currency: 'AUD', chargeBasis: 'selling-gst-inclusive' },
};

const input = {
  deliveryCents: 120_000,
  engineeringCents: 85_000,
  extraCents: 0,
  additionsCents: 0,
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
};

/** Every option kind, so no branch goes unexercised. */
const EVERY_OPTION: ShedOption[] = [
  { id: '1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
  { id: '2', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400 },
  { id: '3', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
  { id: '4', kind: 'outrigger', wall: 'front', bay: 0, length: 1900 },
  { id: '5', kind: 'dividing_wall', axis: 'x', at: 6000, height: 3000 },
  { id: '6', kind: 'gable_infill', end: 'front' },
  { id: '7', kind: 'stable', wall: 'left', align: 'center', offset: null, width: 3000,
    depth: 3000, height: 2400, panels: { left: true, right: true, front: true, back: false } },
  { id: '8', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null },
  { id: '9', kind: 'horizontal_cladding', wall: 'left', from: 0, to: 2400 },
  { id: '10', kind: 'overhang', wall: 'front', depth: 600 },
  { id: '11', kind: 'cantilever', wall: 'front', bay: 1, length: 2000 },
];

describe('the engine contract', () => {
  it('prices every preset, and every result is calculable or explicitly blocked', () => {
    for (const preset of PRESETS) {
      const result = evaluateQuote(preset.config, input, book);
      expect(['priced', 'indicative', 'blocked']).toContain(result.status);
      // A result that is not blocked must have a price and a reason for its
      // status; there is no "silently fine" state.
      if (result.status !== 'blocked') {
        expect(result.price.contractCents).toBeGreaterThan(0);
      }
    }
  });

  it('prices a building with every option kind', () => {
    const result = evaluateQuote({ ...DEFAULT_SHED, options: EVERY_OPTION }, input, book);
    expect(result.bom.groups.find((g) => g.id === 'option')!.lines.length).toBeGreaterThan(5);
    expect(['priced', 'indicative', 'blocked']).toContain(result.status);
  });

  it('gives every issue a code, a severity and a message', () => {
    for (const preset of PRESETS) {
      for (const issue of evaluateQuote(preset.config, input, book).issues) {
        expect(issue.code.length).toBeGreaterThan(2);
        expect(['blocker', 'assumption', 'warning']).toContain(issue.severity);
        expect(issue.message.length).toBeGreaterThan(10);
      }
    }
  });

  it('has no issue it cannot explain', () => {
    // Every issue must be one the ledger names. An unexplained issue is a guess
    // wearing a warning label.
    const known = new Set([
      'FRAME_SECTION_ASSUMED',
      'FOOTING_ASSUMED',
      'GIRT_PRICE_FROM_PURLIN',
      'TERRAIN_SUBSTITUTED',
      'SHEETING_COVER_MISSING',
      'SHEETING_PRICE_MISSING',
      'MOCKED_LINES',
      'SKYLIGHT_ASSUMED',
      'MEZZANINE_RATE_ASSUMED',
      'DOOR_ACCESSORIES_ASSUMED',
      'UNIT_ASSUMED_FRAME',
      'UNIT_ASSUMED_PURLIN',
      'UNIT_ASSUMED_GUTTER',
      'UNIT_ASSUMED_FLASHING',
      'UNIT_ASSUMED_BRACKET',
      'UNIT_ASSUMED_FLATFLY',
      'UNIT_ASSUMED_BRACING',
      'UNIT_ASSUMED_BOLT',
      'UNIT_ASSUMED_SCREW',
      'UNIT_ASSUMED_OPTION',
    ]);
    for (const preset of PRESETS) {
      for (const issue of evaluateQuote(preset.config, input, book).issues) {
        expect(known.has(issue.code), `unexplained issue ${issue.code}`).toBe(true);
      }
    }
  });

  it('reconciles the payment stages for every preset', () => {
    for (const preset of PRESETS) {
      const { price } = evaluateQuote(preset.config, input, book);
      expect(price.depositCents + price.progressCents + price.balanceCents).toBe(
        price.contractCents,
      );
    }
  });

  it('stamps its provenance on every result', () => {
    const result = evaluateQuote(DEFAULT_SHED, input, book);
    expect(result.provenance.engineVersion).toBe(ENGINE_VERSION);
    expect(result.provenance.baseBookHash).toBe(book.provenance.baseBookHash);
  });

  it('never claims a status better than its issues allow', () => {
    for (const preset of PRESETS) {
      const result = evaluateQuote(preset.config, input, book);
      const hasBlocker = result.issues.some((issue) => issue.severity === 'blocker');
      const hasAssumption = result.issues.some((issue) => issue.severity === 'assumption');
      if (hasBlocker) expect(result.status).toBe('blocked');
      else if (hasAssumption) expect(result.status).toBe('indicative');
      else expect(result.status).toBe('priced');
    }
  });
});
