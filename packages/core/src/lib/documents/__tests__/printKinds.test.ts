import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseShedConfig } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { isSupplierPrint, renderQuoteHtml } from '../html';

function document(priceOverrides: Record<string, number> = {}) {
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
      ...priceOverrides,
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

describe('what the contract price is made of', () => {
  /*
   * A contract price already includes labour, fees and other charged items. A customer quoted one
   * figure cannot account for it, and a salesperson spends the call explaining — so the page names
   * the two parts when there is more than the building in the total.
   */
  it('shows the building and the additions, summing to the contract', () => {
    const html = renderQuoteHtml(
      document({ contractCents: 2_750_000, additionsCents: 250_000 }),
      { printKind: 'quotation' },
    );

    expect(html).toContain('Building, delivered');
    expect(html).toContain('$25,000.00');
    expect(html).toContain('Additions — labour, fees and other items');
    expect(html).toContain('$2,500.00');
    expect(html).toContain('$27,500.00');
  });

  it('shows one total when the quote is supply only', () => {
    // An ordinary quote must read exactly as it did before this existed.
    const html = renderQuoteHtml(document({ additionsCents: 0 }), { printKind: 'quotation' });
    expect(html).not.toContain('Building, delivered');
    expect(html).not.toContain('Additions');
  });

  it('shows one total for a revision frozen before additions were recorded', () => {
    /*
     * `additionsCents` arrived after revisions already existed. Absent is not zero: printing
     * "Additions $0.00" on an old quote would be a claim about that quote's contents that nobody
     * recorded, so an absent field prints the single total it was sent with.
     */
    const html = renderQuoteHtml(document(), { printKind: 'quotation' });
    expect(html).not.toContain('Building, delivered');
  });

  it('never shows the split on a supplier copy, where the money is hidden entirely', () => {
    const html = renderQuoteHtml(
      document({ contractCents: 2_750_000, additionsCents: 250_000 }),
      { printKind: 'order' },
    );
    expect(html).not.toContain('Building, delivered');
    expect(html).not.toContain('Additions');
  });
});
