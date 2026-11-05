import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseShedConfig } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { isSupplierPrint, renderQuoteHtml } from '../html';

function document() {
  return toCustomerDocument({
    quoteNumber: 'Q-2026-0042',
    revision: 1,
    createdAt: '2026-11-01T02:03:04.000Z',
    validUntil: '2026-12-01',
    config: normaliseShedConfig({ ...DEFAULT_SHED, span: 9000, length: 18000, bays: 3 }),
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

describe('print kinds', () => {
  it('keeps the money on a document that goes to the buyer', () => {
    const html = renderQuoteHtml(document(), { printKind: 'quotation' });
    expect(html).toContain('$27,500.00');
    expect(html).toContain('<h1>Quotation</h1>');
  });

  it('omits the money from a document that goes to a supplier', () => {
    // The desktop printed the client's price on the supplier's order. That is the margin.
    for (const kind of ['order', 'supplier-quotation', 'supplier-contract'] as const) {
      const html = renderQuoteHtml(document(), { printKind: kind });
      expect(html, kind).not.toContain('$27,500.00');
      expect(html, kind).not.toContain('Contract price');
      expect(isSupplierPrint(kind)).toBe(true);
    }
  });

  it('titles each kind so a reader knows what they hold', () => {
    expect(renderQuoteHtml(document(), { printKind: 'contract' })).toContain('<h1>Contract</h1>');
    expect(renderQuoteHtml(document(), { printKind: 'order' })).toContain('<h1>Order</h1>');
  });
});
