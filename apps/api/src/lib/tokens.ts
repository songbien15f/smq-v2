/**
 * Opaque tokens: session tokens, invitation tokens, share tokens.
 *
 * One rule, and it is the reason sessions survive a database leak: **only the hash
 * is stored.** A row that says `sha256(token)` cannot be replayed, and a leaked dump
 * yields no usable session, no usable invitation and no usable customer link.
 *
 * sha256 rather than scrypt here on purpose. These tokens are 256 bits of
 * cryptographic randomness, not passwords: there is nothing to brute-force, so a
 * slow hash would only cost a lookup on every request.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A new token, URL-safe, 256 bits. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The hash stored in the database for a token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** True when a token hashes to the stored hash, compared in constant time. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * The hash stored for an IP address.
 *
 * An address is stored so abuse is diagnosable, hashed so the database is not a
 * list of who visited. Keyed on a per-deployment salt in principle; a plain hash is
 * used here because an IPv4 address is small enough to enumerate, so the salt would
 * have to be secret to mean anything.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip, 'utf8').digest('hex').slice(0, 32);
}
