import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { addressHandle, decryptAddress, encryptAddress, maskAddress } from '../lib/address.js';

/**
 * The address: encrypted for storage, masked for the column, revealed on a click.
 *
 * ## What is being defended
 *
 * Three properties, and each has a way of silently failing:
 *
 * 1. **the plain address is not in the row** — the obvious mistake is to store it "just for the
 *    dashboard", and then a backup, a support export and a database dump all contain every customer's
 *    address;
 * 2. **the ciphertext is not reversible without the key** — a rotation must make old rows unreadable
 *    rather than readable by whoever holds an old key;
 * 3. **the handle does not change when the key changes** — otherwise one visitor becomes a different
 *    visitor overnight and every history in the log breaks at the same moment.
 */

const original = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = 'a-test-session-secret-that-is-long-enough';
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = original;
});

describe('encrypted addresses', () => {
  it('round-trips an address', () => {
    const stored = encryptAddress('203.0.113.7');
    expect(stored).not.toBeNull();
    expect(decryptAddress(stored)).toBe('203.0.113.7');
  });

  it('does not contain the address in the stored value', () => {
    const stored = encryptAddress('203.0.113.7') ?? '';
    // Not the dotted form, and not the hex of it either.
    expect(stored).not.toContain('203');
    expect(stored).not.toContain(Buffer.from('203.0.113.7').toString('hex'));
    // The shape is iv:tag:body, all hex.
    expect(stored.split(':')).toHaveLength(3);
  });

  it('produces a different ciphertext for the same address twice', () => {
    // A random IV per row. Reusing one with GCM is the mistake that breaks the whole mode.
    expect(encryptAddress('203.0.113.7')).not.toBe(encryptAddress('203.0.113.7'));
  });

  it('cannot be read after the key changes', () => {
    const stored = encryptAddress('203.0.113.7');
    process.env.SESSION_SECRET = 'a-completely-different-secret-also-long';
    expect(decryptAddress(stored)).toBeNull();
  });

  it('fails rather than guessing when the row was tampered with', () => {
    const stored = encryptAddress('203.0.113.7') ?? '';
    const [iv, tag, body] = stored.split(':');
    // Flip the last byte of the ciphertext: GCM authenticates, so this must not decrypt.
    const flipped = `${(body ?? '').slice(0, -2)}${(body ?? '').slice(-2) === 'ff' ? '00' : 'ff'}`;
    expect(decryptAddress(`${iv}:${tag}:${flipped}`)).toBeNull();
  });

  it('answers null for no address, rather than an encryption of nothing', () => {
    expect(encryptAddress(undefined)).toBeNull();
    expect(encryptAddress('')).toBeNull();
    expect(decryptAddress(null)).toBeNull();
    expect(decryptAddress('')).toBeNull();
  });

  it('strips the IPv4-mapped prefix, so one visitor is not two', () => {
    expect(decryptAddress(encryptAddress('::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });
});

describe('the masked form', () => {
  it('hides the last four characters of an IPv4 address', () => {
    // `203.0.113.7` is 11 characters; the last four (`.7` plus two digits) become bullets.
    expect(maskAddress('203.0.113.7')).toBe('203.0.1••••');
  });

  it('hides a short address entirely rather than showing bullets with nothing to read', () => {
    // `::1` is localhost over IPv6; hiding four characters of three leaves nothing.
    expect(maskAddress('::1')).toBe('••••••');
  });

  it('leaves the network recognisable', () => {
    // The point of the masked column: "that is our office range", not "who is this".
    expect(maskAddress('203.0.113.7')).toContain('203.0.1');
  });
});

describe('the handle', () => {
  it('is stable across a key rotation', () => {
    /*
     * This is the property the whole design rests on: the ciphertext dies with the key, but the handle
     * the log groups by must not — otherwise every visitor becomes a new visitor on the day the secret
     * is rotated, and the history is unusable from then on.
     */
    const before = addressHandle('203.0.113.7');
    process.env.SESSION_SECRET = 'a-rotated-secret-that-is-also-long-enough';
    expect(addressHandle('203.0.113.7')).toBe(before);
  });

  it('differs between two addresses and matches a mapped duplicate', () => {
    expect(addressHandle('203.0.113.7')).not.toBe(addressHandle('203.0.113.8'));
    expect(addressHandle('::ffff:203.0.113.7')).toBe(addressHandle('203.0.113.7'));
  });

  it('is eight characters, and does not contain the address', () => {
    const handle = addressHandle('203.0.113.7');
    expect(handle).toHaveLength(8);
    expect(handle).not.toContain('203');
  });
});
