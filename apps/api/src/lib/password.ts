/**
 * Password hashing, with `scrypt` from Node's standard library.
 *
 * ## Why not argon2
 *
 * Argon2 is the better primitive, but every implementation of it is a native addon,
 * and a native addon is a build step that fails on a machine without a compiler —
 * which is most Windows machines and every fresh CI image. `scrypt` is in
 * `node:crypto`, has no build step, and is acceptable: memory-hard, and with
 * N=2^15, r=8, p=1 above the OWASP minimum.
 *
 * ## The stored format
 *
 * `scrypt$N$r$p$<salt b64>$<hash b64>`, self-describing. The parameters travel with
 * the hash, so the cost can be raised later and old hashes still verify — a hash
 * format that assumes today's parameters is a hash format that cannot be improved
 * without a mass reset.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. `N` is CPU/memory cost; 2^15 is the OWASP floor for scrypt. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
/** scrypt needs ~128·N·r bytes; the default 32 MB cap would refuse 2^15·8. */
const MAX_MEM = 128 * PARAMS.N * PARAMS.r * 2;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Hash a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns `false` for a malformed hash rather than throwing: a corrupt row must read
 * as "wrong password", never as a 500 that tells an attacker the account exists with
 * a damaged record.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null || stored === '') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64 as string, 'base64');
  const expected = Buffer.from(hashB64 as string, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 128 * N * r * 2),
    });
  } catch {
    return false;
  }

  // Constant-time. A length mismatch would make `timingSafeEqual` throw, so the
  // lengths are compared first — which leaks only the length, and the length is the
  // same for every hash this function produced.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * A hash of a password nobody knows, verified against when the account does not
 * exist.
 *
 * Without this, a missing account answers in microseconds and a wrong password in
 * ~50 ms, and the timing difference is an account-enumeration oracle. The decoy is
 * computed once per process.
 */
let decoyHash: Promise<string> | null = null;

/** Burn the same time as a real verification, for an account that does not exist. */
export async function burnVerificationTime(candidate: string): Promise<void> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(candidate, await decoyHash);
}
