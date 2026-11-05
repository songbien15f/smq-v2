import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseShedConfig } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { renderElevationsPageHtml } from '../elevationsPage';

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
        { id: 'o2', type: 'window', wall: 'left', width: 1200, height: 900, sill: 1200, align: 'center', offset: null, swing: null, track: null },
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

describe('the elevations page', () => {
  it('draws four walls, each with its openings', () => {
    const html = renderElevationsPageHtml(document());
    expect((html.match(/<figure>/g) ?? []).length).toBe(4);
    for (const label of ['Front', 'Back', 'Left end', 'Right end']) {
      expect(html).toContain(label);
    }
    // The door is a hole on the front wall; the window is a hole on the left end.
    expect((html.match(/<rect[^>]*fill="#fff"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('is a drawing: no price, no customer contact', () => {
    const html = renderElevationsPageHtml(document());
    expect(html).not.toContain('$27,500.00');
    expect(html).not.toContain('jane@example.com');
    expect(html).toContain('A4 landscape');
  });
});
