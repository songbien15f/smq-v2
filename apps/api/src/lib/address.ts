/**
 * Reading an address back, for the one page that shows it.
 *
 * ## Why the address is encrypted rather than hashed
 *
 * The first version stored only a salted digest, because the dashboard's question was "how many
 * different visitors" — and a digest answers that without recording where anybody is. That was the
 * wrong trade for this product: the operator has to be able to answer **"is this a real customer on a
 * real connection, or am I looking at my own test traffic"**, and a digest cannot. A vendor debugged a
 * "nobody is using it" worry against a table of eight-character handles is not debugging.
 *
 * So the address is **encrypted with AES-256-GCM** and stored as `iv:tag:ciphertext`, hex. Three
 * properties, and all three are the reason it is encryption and not a column of plain text:
 *
 * - a database dump, a backup, or a support export does not contain anybody's address in the clear;
 * - the key lives in `SESSION_SECRET`, so **rotating it makes every stored address unreadable** — the
 *   data ages out by itself rather than needing a deletion job;
 * - GCM authenticates, so a tampered row fails to decrypt rather than returning a plausible wrong
 *   address.
 *
 * ## What is still shown on screen
 *
 * Eight characters of the **digest**, as a stable handle that survives a key rotation — and the last
 * four digits of the plain address, masked, until somebody clicks. The handle is for following one
 * visitor through the log; the readable address is for the operator's own debugging.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** 32 bytes from the session secret, so there is no second thing to configure. */
function keyFrom(salt: string): Buffer {
  const secret = process.env.SESSION_SECRET ?? 'smartquote-usage';
  return createHash('sha256').update(`${secret}|${salt}`, 'utf8').digest();
}

/**
 * The address, encrypted for storage, or `null` when there is no address.
 *
 * `iv:tag:ciphertext`, all hex. The IV is random per row: reusing one with GCM is the mistake that
 * breaks the whole mode, so it is generated here and never derived from the plaintext.
 */
export function encryptAddress(address: string | undefined): string | null {
  if (address === undefined || address.trim() === '') return null;

  const normalised = normaliseAddress(address);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom('address'), iv);
  const ciphertext = Buffer.concat([cipher.update(normalised, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** The address back, or `null` when it cannot be read (a rotated key, or a tampered row). */
export function decryptAddress(stored: string | null): string | null {
  if (stored === null || stored === '') return null;

  const [ivHex, tagHex, bodyHex] = stored.split(':');
  if (ivHex === undefined || tagHex === undefined || bodyHex === undefined) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom('address'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(bodyHex, 'hex')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // A different key, or a row somebody edited. Both are "cannot read", not an error to surface:
    // the page shows the handle and says the address is unreadable.
    return null;
  }
}

/**
 * A stable handle for a visitor, independent of the encryption key.
 *
 * Kept separate from `encryptAddress` on purpose: the handle is what the log groups by, and it must
 * **not** change when the key is rotated — otherwise one visitor becomes a different visitor overnight
 * and the history stops making sense.
 */
export function addressHandle(address: string | undefined): string | null {
  if (address === undefined || address.trim() === '') return null;
  return createHash('sha256')
    .update(`handle|${normaliseAddress(address)}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

/** Strip the IPv4-mapped prefix, so a dual-stack listener is one visitor and not two. */
export function normaliseAddress(address: string): string {
  return address.trim().replace(/^::ffff:/i, '');
}

/**
 * The address with its **last part** hidden, so the column shows a network without showing a person.
 *
 * ## What was wrong with the first version
 *
 * It hid four *characters*, unconditionally. For `203.0.113.7` that reads `203.0.1••••`, which is fine.
 * For `::1` — loopback over IPv6, three characters — four characters is the whole string, so the
 * column rendered `••••••`: **no address at all**, on every row, which is exactly what it must not do.
 *
 * ## The rule now
 *
 * Mask the last **part**, because that is the part that identifies a host:
 *
 * | | |
 * |---|---|
 * | IPv4 `203.0.113.7` | `203.0.113.•••` — the /24 is visible, the host is not |
 * | IPv6, long | the first four groups, then `:••••` |
 * | Loopback or anything short | **shown in full** — there is no host part to hide, and hiding three characters of three tells the operator nothing |
 *
 * A short address is not private in the way a customer's is: `::1` is this machine, and the operator
 * *needs* to see that, because "every visitor is ::1" is the answer to a question they will ask.
 */
export function maskAddress(address: string): string {
  const normalised = normaliseAddress(address);

  // IPv4: hide the last octet.
  const ipv4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/.exec(normalised);
  if (ipv4 !== null) return `${ipv4[1] as string}.•••`;

  // IPv6 with enough groups to hide something: keep four, mask the rest.
  const groups = normalised.split(':').filter((group) => group !== '');
  if (normalised.includes(':') && groups.length >= 5) {
    return `${groups.slice(0, 4).join(':')}:••••`;
  }

  /*
   * Everything else — `::1`, a container hostname, an already-short string.
   *
   * Shown as it is. The alternative is a row of bullets that hides the only information the column has,
   * which is how this looked broken. Nothing is leaked: these are addresses with no customer behind
   * them, and the full value is one click away for the rest.
   */
  return normalised;
}
