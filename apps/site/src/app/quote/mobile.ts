/**
 * The Guest page's one reading of an Australian mobile number.
 *
 * ## Why it lives here
 *
 * Three screens need the same answer and used to carry their own copy: the step lock (`store.ts`), the
 * review step (`SendPanel`), and the box that rewrites itself on blur (`StartPanel`). Two copies of a
 * rule is one copy that will drift; the prefix-aware reading below was written twice before this file
 * existed.
 *
 * ## Why the prefix is handled here
 *
 * The mobile box shows a fixed `+61` label, so the value inside it may be `0412 345 678`,
 * `412 345 678`, `+61 412 345 678` or `61412345678` — the same number four ways.
 * `normaliseAuMobile` accepts all but the bare `412…` form, which is exactly what the box holds after
 * it rewrites itself on blur. So the missing country code is added before asking it again.
 */

import { normaliseAuMobile } from '@sq/contracts';

/** The number as E.164 (`+61412345678`), or `null` when it is not an Australian mobile. */
export function mobileE164(raw: string): string | null {
  return normaliseAuMobile(raw) ?? normaliseAuMobile(`+61${raw.replace(/^\s*\+?/, '')}`);
}

/** `412 345 678` — the digits the box holds, behind its fixed `+61` label. */
export function nationalMobile(raw: string): string | null {
  const e164 = mobileE164(raw);
  if (e164 === null) return null;
  const national = e164.slice(3);
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/** `+61 412 345 678` — how a person reads it, for the review step. */
export function formatAuMobile(raw: string): string | null {
  const national = nationalMobile(raw);
  return national === null ? null : `+61 ${national}`;
}
