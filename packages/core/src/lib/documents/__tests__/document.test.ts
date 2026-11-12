import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import {  normaliseShedConfig, normaliseDimensionedShed } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { renderQuoteHtml } from '../html';
import type { FrozenRevision } from '../types';

/**
 * The customer document, and the one property it must never lose.
 *
 * ## Why these tests exist
 *
 * A quote is the only artefact of this product that leaves the building. If a material cost, a
 * margin or an internal issue code reaches it, a customer can price the job themselves and the
 * company's numbers are on a competitor's desk.
 *
 * The leak check is written against the **rendered HTML**, not against the projection's shape,
 * because a leak is whatever actually appears on the page — including in a `<title>`, an attribute
 * or a footer.
 */

/** A revision with every field populated, so nothing is accidentally blank. */
function revision(patch: Partial<FrozenRevision> = {}): FrozenRevision {
  return {
    quoteNumber: 'Q-2026-0042',
    revision: 3,
    createdAt: '2026-11-01T02:03:04.000Z',
    validUntil: '2026-12-01',
    config: normaliseDimensionedShed({
      ...TEST_SHED,
      structureType: 'gable',
      span: 9000,
      length: 18000,
      height: 3000,
      bays: 3,
      windRegion: 'A',
      terrainCategory: 2.5,
      stateCode: 'QLD',
      openings: [
        { id: 'o1', type: 'roller_door', wall: 'front', u: 4500, width: 3000, height: 2400 },
        { id: 'o2', type: 'window', wall: 'left', u: 3000, width: 1200, height: 900 },
      ],
    })!,
    price: {
      contractCents: 2_750_000,
      gstCents: 250_000,
      depositCents: 275_000,
      progressCents: 1_925_000,
      balanceCents: 550_000,
      depositPct: 10,
      progressPct: 70,
    },
    issues: [
      { code: 'GIRT_PRICE_FROM_PURLIN', severity: 'assumption', message: 'internal wording' },
      { code: 'FRAME_SECTION_ASSUMED', severity: 'assumption', message: 'internal wording' },
      { code: 'UNIT_ASSUMED_BRACKET', severity: 'assumption', message: 'internal wording' },
      { code: 'MOCKED_LINES', severity: 'warning', message: 'internal wording' },
    ],
    company: {
      name: 'Demo Sheds Pty Ltd',
      abn: '12 345 678 901',
      address: '1 Company Street, Brisbane QLD 4000',
      phone: '(07) 3000 0000',
      email: 'quotes@demo-sheds.test',
      logoText: 'DEMO SHEDS',
      logoHash: null,
      terms: ['A deposit is required on signing.', 'Delivery is to the nearest accessible point.'],
      assumptions: null,
    },
    customer: {
      firstName: 'Jane',
      lastName: 'Citizen',
      email: 'jane@example.com',
      phone: null,
      mobile: '0400 000 000',
      address: '12 Test Road',
      suburb: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
      deliveryAddress: null,
    },
    ...patch,
  };
}

describe('the projection', () => {
  it('carries no material cost, no margin and no kit price', () => {
    const document = toCustomerDocument(revision());

    // The type has no field for them, and that is the point — but assert the rendered page too,
    // because a leak is whatever appears on it.
    const html = renderQuoteHtml(document);

    // The material cost from the priced BOM in the browser run was $18,501.18. Nothing resembling
    // it may appear.
    expect(html).not.toContain('18,501');
    expect(html).not.toContain('18501');
    expect(html).not.toMatch(/margin/i);
    expect(html).not.toMatch(/kit price/i);
    expect(html).not.toMatch(/material cost/i);
    expect(html).not.toMatch(/BOM/i);
  });

  it('carries no internal issue code', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    // The engine's codes are for operators. `UNIT_ASSUMED_*` is excluded by family, the rest by
    // having no customer sentence.
    expect(html).not.toMatch(/UNIT_ASSUMED/);
    expect(html).not.toMatch(/FRAME_SECTION_ASSUMED/);
    expect(html).not.toMatch(/MOCKED_LINES/);
    // A warning describes how a price-book row was read; a buyer learns nothing from it.
    expect(html).not.toMatch(/price book/i);
  });

  it('prints the customer sentence for an issue that has one', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    // The girt allowance is a material difference in what is being supplied, so the buyer is told —
    // in prose, never as a code.
    expect(html).toMatch(/Wall girts are priced using the roof purlin section as an allowance/);
  });

  it('says the quote is indicative when an allowance is present', () => {
    const document = toCustomerDocument(revision());

    expect(document.status).toBe('indicative');
    expect(document.estimateLabel).toMatch(/Indicative/);
    // Fixed-position watermark, so it repeats on every printed page without JavaScript.
    expect(renderQuoteHtml(document)).toMatch(/INDICATIVE — ALLOWANCES APPLY/);
  });

  it('says firm when every line has a real price', () => {
    const document = toCustomerDocument(revision({ issues: [] }));

    expect(document.status).toBe('priced');
    expect(document.estimateLabel).toBe('Firm quotation');
    expect(renderQuoteHtml(document)).not.toMatch(/INDICATIVE/);
  });

  it('names colours rather than printing hex', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    // An Australian buyer says "Shale Grey"; `#bdbfba` is a value only a screen needs.
    expect(html).toMatch(/Shale Grey/);
    expect(html).not.toMatch(/#bdbfba/);
  });

  it('prints a colour row for every surface the building actually has', () => {
    const document = toCustomerDocument(revision());
    const labels = document.building.colourRows.map((entry) => entry.label);

    // The five surfaces a shed always has...
    expect(labels).toEqual(
      expect.arrayContaining(['Walls', 'Roof', 'Barge and fascia', 'Downpipes', 'Gutters']),
    );
    // ...plus the two opening kinds this building has.
    expect(labels).toContain('Roller doors');
    expect(labels).toContain('Windows');
  });

  it('does not print a colour for an opening the building does not have', () => {
    // The desktop printed all ten roles regardless: a quote with no sliding door still read
    // "Sliding door: Monument", which a customer reads as something they are paying for.
    const document = toCustomerDocument(revision());
    const labels = document.building.colourRows.map((entry) => entry.label);

    expect(labels).not.toContain('Sliding doors');
    expect(labels).not.toContain('PA doors');
    expect(labels).not.toContain('Dividing wall');
  });

  it('prints the dividing wall colour only when there is a dividing wall', () => {
    const base = revision();
    const document = toCustomerDocument({
      ...base,
      config: normaliseDimensionedShed({
        ...base.config,
        options: [{ id: 'dw-1', kind: 'dividing_wall', axis: 'x', at: 4000, height: 3000 }],
      })!,
    });

    expect(document.building.colourRows.map((entry) => entry.label)).toContain('Dividing wall');
  });

  it('renders the plan from the revision, with its openings', () => {
    const document = toCustomerDocument(revision());

    expect(document.plan.widthMm).toBe(9000);
    expect(document.plan.openings).toHaveLength(2);
    expect(document.plan.openings.map((opening) => opening.label)).toEqual([
      'Roller door',
      'Window',
    ]);
  });

  it('falls back to the default scope notes when the revision has none', () => {
    const document = toCustomerDocument(revision());

    // A quote with no scope notes reads as "nothing was excluded". The defaults state what was
    // allowed for, which is the safer page to send.
    expect(document.assumptions.length).toBeGreaterThan(5);
    expect(document.assumptions[0]?.title).toBe('Frame');
  });

  it('uses the company own scope notes when it wrote them', () => {
    const document = toCustomerDocument(
      revision({
        company: {
          ...revision().company,
          assumptions: [{ title: 'Ours', body: 'Only what we wrote.' }],
        },
      }),
    );

    // Never a mix, so a company that has edited them sees exactly what it wrote.
    expect(document.assumptions).toEqual([{ title: 'Ours', body: 'Only what we wrote.' }]);
  });
});

describe('the HTML', () => {
  it('escapes a customer name that contains markup', () => {
    const html = renderQuoteHtml(
      toCustomerDocument(
        revision({
          customer: { ...revision().customer, firstName: '<script>alert(1)</script>', lastName: 'X' },
        }),
      ),
    );

    // A quote is an injection surface if any free text reaches the markup unescaped.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a company term that contains markup', () => {
    const html = renderQuoteHtml(
      toCustomerDocument(
        revision({ company: { ...revision().company, terms: ['<img onerror=alert(1)>'] } }),
      ),
    );

    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('prints the payment stages and the GST inside the contract', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    expect(html).toContain('$27,500.00');
    expect(html).toContain('$2,750.00');
    expect(html).toContain('$19,250.00');
    expect(html).toContain('$5,500.00');
    expect(html).toContain('$2,500.00'); // GST, extracted not added
  });

  it('states the wind conditions a quote must show in Australia', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    // ShedSafe's own advice: a quote that does not state these is a red flag to a buyer.
    expect(html).toMatch(/Wind region/);
    expect(html).toMatch(/Terrain category/);
    expect(html).toMatch(/Importance level/);
  });

  it('carries no demo advertising', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision()));

    // The upstream project put a demo band and a "build this for you" footer on every page because
    // it was a demo. This build is the product: a shed company sending its customer a quote with
    // somebody else's advertising across it would be indefensible.
    expect(html).not.toMatch(/Demo quotation/);
    expect(html).not.toMatch(/WhatsApp/);
    expect(html).not.toMatch(/NOT FOR CONSTRUCTION/);
  });
});

describe('catalogue accessories', () => {
  it('names the accessory and its quantity, not its kind', () => {
    const config = normaliseDimensionedShed({
      ...TEST_SHED,
      options: [
        {
          kind: 'misc_option',
          id: 'mo-1',
          name: 'Insulation - Foil 1200w',
          quantity: 2,
          unit: 'roll',
        },
      ],
    })!;

    const document = toCustomerDocument(revision({ config }));
    expect(document.inclusions).toContain('Insulation - Foil 1200w × 2');
  });
});
