/**
 * The `Integrity` block: a digest a `.sqd` carries of its own contents.
 *
 * ## What question this answers, and what it does not
 *
 * The file store (`apps/api/src/lib/templateFiles.ts`) hashes the **bytes** of a stored file, which
 * proves nothing changed on disk. This is a different question: *a `.sqd` that arrived by email —
 * was it edited after it was written?* The bytes of an emailed file are not what any server stored,
 * so a byte hash proves nothing there. What can be checked is the **document**: hash its contents in
 * a canonical form and put that digest inside it. Any edit to a field changes the digest.
 *
 * ## Why canonical JSON and not the raw text
 *
 * The same document can be written with different whitespace, key order or number formatting, and
 * all of those are the same quote. Hashing the text would make a file that was merely reformatted
 * look tampered with. So the digest is taken over a **canonical** serialisation — keys sorted, no
 * whitespace — which is what RFC 8785 specifies and what `apps/api/src/lib/priceBook.ts`'s
 * `canonicalHash` already does for config comparison.
 *
 * The block is **removed before hashing** and re-added afterwards. Otherwise the digest would have
 * to include itself, which is impossible.
 *
 * ## Why it is optional on read
 *
 * A `.sqd` written by the old desktop has no block, and neither does one written before this
 * existed. `absent` is therefore a normal answer, not a failure: the file is readable, it simply
 * makes no claim about its own integrity. `invalid` is the answer that matters — the file claims a
 * digest and does not match it, which means something changed it.
 */

import { createHash } from 'node:crypto';

/** What a `.sqd` claims about itself. */
export interface IntegrityBlock {
  /** Always `SHA-256` — stated so a future algorithm is distinguishable. */
  Algorithm: 'SHA-256';
  /** Always `RFC8785`; the reader checks it before trusting the digest. */
  Canonicalisation: 'RFC8785';
  /** Lowercase hex, 64 characters. */
  Digest: string;
  /** When the digest was made. Informational: it is inside the hash, so it cannot be forged alone. */
  IssuedAt: string;
  /** Who wrote it: a company code, or `unknown`. */
  Issuer: string;
}

/** How a file's integrity claim came out. */
export type IntegrityVerdict =
  /** A block is present and the digest matches. */
  | 'valid'
  /** A block is present and the digest does not match — the file was changed. */
  | 'invalid'
  /** No block: a file from the old app, or one written before this existed. Not an error. */
  | 'absent'
  /** A block is present but not one this build can check (unknown algorithm or canonicalisation). */
  | 'unsupported';

/**
 * A canonical JSON string: keys sorted, no whitespace.
 *
 * `undefined` properties are dropped rather than written as `undefined`, matching what
 * `JSON.stringify` does — otherwise a round trip through a store that admits `undefined` would
 * change the digest without changing the meaning.
 */
export function canonicalJson(value: unknown): string {
  const stable = (input: unknown): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'null';
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
    return `{${entries.join(',')}}`;
  };
  return stable(value);
}

/** The digest of a document **with any `Integrity` member removed**. */
export function integrityDigest(document: Record<string, unknown>): string {
  const { Integrity: _ignored, ...rest } = document;
  return createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

/** Build the block for a document that does not have one yet. */
export function integrityBlock(
  document: Record<string, unknown>,
  issuedAt: string,
  issuer: string,
): IntegrityBlock {
  return {
    Algorithm: 'SHA-256',
    Canonicalisation: 'RFC8785',
    Digest: integrityDigest(document),
    IssuedAt: issuedAt,
    Issuer: issuer === '' ? 'unknown' : issuer,
  };
}

/**
 * Check a parsed document's integrity claim.
 *
 * Returns the verdict **and** the two digests when they differ, because "the file is corrupt" with
 * no values gives a person nothing to compare against a copy they trust.
 */
export function checkIntegrity(document: Record<string, unknown>): {
  verdict: IntegrityVerdict;
  expected?: string;
  actual?: string;
} {
  const block = document.Integrity;
  if (block === undefined || block === null) return { verdict: 'absent' };
  if (typeof block !== 'object') return { verdict: 'unsupported' };

  const claim = block as Partial<IntegrityBlock>;
  // A digest from an algorithm or canonicalisation this build does not implement cannot be
  // checked — saying "invalid" would call a file corrupt because we cannot read its claim.
  if (claim.Algorithm !== 'SHA-256' || claim.Canonicalisation !== 'RFC8785') {
    return { verdict: 'unsupported' };
  }
  if (typeof claim.Digest !== 'string' || !/^[0-9a-f]{64}$/.test(claim.Digest)) {
    return { verdict: 'unsupported' };
  }

  const actual = integrityDigest(document);
  return {
    verdict: actual === claim.Digest ? 'valid' : 'invalid',
    expected: claim.Digest,
    actual,
  };
}
