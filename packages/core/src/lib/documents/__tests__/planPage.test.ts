import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseShedConfig } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { renderPlanPageHtml } from '../planPage';

function document() {
  return toCustomerDocument({
    quoteNumber: 'Q-2026-0042',
    revision: 1,
    createdAt: '2026-11-01T02:03:04.000Z',
    validUntil: '2026-12-01',
    config: normaliseShedConfig({
      ...DEFAULT_SHED,
      span: 9000,
      length: 18000,
      bays: 3,
      openings: [
        { id: 'o1', type: 'roller_door', wall: 'front', width: 3000, height: 2400, sill: 0, align: 'center', offset: null, swing: null, track: null },
      ],
    }),
    price: {
      contractCents: 2_750_000,
      gstCents: 250_000,
      depositCents: 275_000,
      progressCents: 1_925_000,
      balanceCents: 550_000,
      depositPct: 10,
      progressPct: 70,
    },
    issues: [],
    company: {
      name: 'Test Sheds',
      email: 'sales@test.example',
      phone: '07 0000 0000',
      address: '1 Test St',
      terms: [],
      assumptions: null,
    } as never,
    customer: {
      firstName: 'Jane',
      lastName: 'Citizen',
      email: 'jane@example.com',
      phone: null,
      mobile: null,
      address: '1 Test St',
      suburb: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
      deliveryAddress: null,
    },
    status: 'priced',
  } as never);
}

describe('the plan page', () => {
  it('draws the building and its openings', () => {
    const html = renderPlanPageHtml(document());
    expect(html).toContain('<svg');
    expect(html).toContain('9,000 × 18,000 mm');
    expect(html).toMatch(/<rect[^>]*fill="#111"/); // the roller door, filled
  });

  it('carries no price and no customer block', () => {
    const html = renderPlanPageHtml(document());
    // A drawing sheet a workshop pins up — money on it is a leak, not decoration.
    expect(html).not.toContain('$27,500.00');
    expect(html).not.toContain('Contract price');
    expect(html).not.toContain('jane@example.com');
  });

  it('lands in landscape, because a shed is longer than it is wide', () => {
    expect(renderPlanPageHtml(document())).toContain('size: A4 landscape');
  });
});
