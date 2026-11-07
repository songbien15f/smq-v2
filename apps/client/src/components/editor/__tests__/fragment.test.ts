import { describe, it, expect, beforeEach } from 'vitest';
import { customerFromFragment, templateFromFragment } from '../fragment';

/**
 * What a link into the editor carries.
 *
 * The editor is reached three ways: a blank quote, a template link, and a building converted from a
 * legacy `.sqd`. The first two already existed; the third adds a customer. Both payloads arrive in
 * the URL fragment, which is untrusted input typed into an address bar, so every branch here answers
 * `null` or a fully-populated object — never a partially-applied state.
 */

/** Put a fragment on the current jsdom location, encoded as the sender encodes it. */
function fragment(parts: Record<string, unknown>): void {
  const params = new URLSearchParams(
    Object.entries(parts).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
  window.location.hash = params.toString();
}

beforeEach(() => {
  window.location.hash = '';
});

describe('templateFromFragment', () => {
  it('reads a building', () => {
    fragment({ template: { span: 9000, bays: 3 } });
    expect(templateFromFragment()).toEqual({ span: 9000, bays: 3 });
  });

  it('answers null for a malformed payload', () => {
    window.location.hash = 'template=%7Bnot-json';
    expect(templateFromFragment()).toBeNull();
  });

  it('answers null when the fragment carries no template', () => {
    window.location.hash = '';
    expect(templateFromFragment()).toBeNull();
  });
});

describe('customerFromFragment', () => {
  it('reads the customer and the site the importer sent', () => {
    fragment({
      customer: {
        customer: {
          firstName: 'TBA',
          lastName: 'TBA',
          email: 'tba@example.com',
          phone: 'TBA',
          mobile: '',
          address: '222 Margaret St',
          suburb: 'Brisbane City',
          state: 'QLD',
          postcode: '4000',
        },
        site: { address: '9 Site Rd', suburb: 'Ipswich', state: 'QLD', postcode: '4305' },
      },
    });

    expect(customerFromFragment()).toEqual({
      customer: {
        firstName: 'TBA',
        lastName: 'TBA',
        email: 'tba@example.com',
        phone: 'TBA',
        mobile: '',
        fax: '',
        address: '222 Margaret St',
        suburb: 'Brisbane City',
        state: 'QLD',
        postcode: '4000',
      },
      site: {
        address: '9 Site Rd',
        suburb: 'Ipswich',
        state: 'QLD',
        postcode: '4305',
        deliveryAddress: '',
        deliveryScope: '',
        deliveryAcknowledged: false,
      },
    });
  });

  it('drops keys this build does not have', () => {
    fragment({ customer: { customer: { firstName: 'Ann', Rate: 'Gold', Height: 3000 } } });
    const seeded = customerFromFragment();
    expect(seeded?.customer.firstName).toBe('Ann');
    expect(JSON.stringify(seeded)).not.toContain('Gold');
    expect(JSON.stringify(seeded)).not.toContain('Height');
  });

  it('keeps the site apart from the customer', () => {
    fragment({
      customer: {
        customer: { address: '1 Customer St' },
        site: { address: '2 Site St', postcode: '4305' },
      },
    });
    const seeded = customerFromFragment();
    expect(seeded?.customer.address).toBe('1 Customer St');
    expect(seeded?.site.address).toBe('2 Site St');
  });

  it('fills a missing block from the blank draft rather than leaving it undefined', () => {
    fragment({ customer: { customer: { firstName: 'Ann' } } });
    const seeded = customerFromFragment();
    expect(seeded?.customer.email).toBe('');
    expect(seeded?.site.postcode).toBe('');
    expect(seeded?.site.deliveryAcknowledged).toBe(false);
  });

  it('ignores a non-string field instead of putting it in the draft', () => {
    fragment({ customer: { customer: { firstName: 42, email: 'ok@example.com' } } });
    const seeded = customerFromFragment();
    expect(seeded?.customer.firstName).toBe('');
    expect(seeded?.customer.email).toBe('ok@example.com');
  });

  it('answers null for a malformed payload', () => {
    window.location.hash = 'customer=%7Bnot-json';
    expect(customerFromFragment()).toBeNull();
  });

  it('answers null when the payload is not an object', () => {
    fragment({ customer: 'a string' });
    expect(customerFromFragment()).toBeNull();
  });

  it('answers null when there is no customer in the fragment', () => {
    fragment({ template: { span: 6000 } });
    expect(customerFromFragment()).toBeNull();
  });
});
