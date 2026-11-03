import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import { normaliseShedConfig } from '@/domain/schema';
import { toCustomerDocument } from '../projection';
import { renderQuoteHtml } from '../html';
import type { FrozenRevision } from '../types';
import type { LogoImage } from '@/lib/branding/logo';

/** A 1x1 PNG, byte for byte — enough for a data URI and nothing more. */
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

const LOGO: LogoImage = {
  mime: 'image/png',
  base64: PNG_1PX.toString('base64'),
  width: 1,
  height: 1,
  sha256: 'a'.repeat(64),
};

const OTHER_HASH = 'b'.repeat(64);

function revision(logoHash: string | null): FrozenRevision {
  return {
    quoteNumber: 'Q-2026-0042',
    revision: 3,
    createdAt: '2026-11-01T02:03:04.000Z',
    validUntil: '2026-12-01',
    config: normaliseShedConfig({ ...DEFAULT_SHED, structureType: 'gable', span: 9000, length: 18000 }),
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
      name: 'Demo Sheds Pty Ltd',
      abn: '12 345 678 901',
      address: '1 Company Street, Brisbane QLD 4000',
      phone: '(07) 3000 0000',
      email: 'quotes@demo-sheds.test',
      logoText: 'DEMO SHEDS',
      logoHash,
      terms: [],
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
  };
}

describe('the logo on a document', () => {
  it('prints the company name as text when no logo is supplied', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision(null)));
    expect(html).toContain('DEMO SHEDS');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('embeds the image as a data URI, so the PDF has no external reference', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision(LOGO.sha256)), { logo: LOGO });
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('<img');
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
    // The text logo is replaced, not shown beside the image.
    expect(html).not.toContain('DEMO SHEDS</div>');
  });

  it('prints the text when the supplied logo is not the one the revision was saved with', () => {
    const html = renderQuoteHtml(toCustomerDocument(revision(OTHER_HASH)), { logo: LOGO });
    expect(html).toContain('DEMO SHEDS');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('prints the text when the platform has no logo but the revision froze one', () => {
    // The file was deleted, or LOGO_FILE is now unset. The revision references its own logo; with
    // none to supply, text is the honest render — never a newer image.
    const html = renderQuoteHtml(toCustomerDocument(revision(LOGO.sha256)), { logo: null });
    expect(html).toContain('DEMO SHEDS');
    expect(html).not.toContain('data:image/png;base64,');
  });
});
