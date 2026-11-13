/**
 * The named quote-rate tiers, as the desktop offered them.
 *
 * ## Why this is in `domain/` and not beside the pricing code that uses it
 *
 * It is a list of names and percentages — no price file, no database handle — and a **client
 * component** renders it as a picker. `lib/pricing`'s barrel exports `publish.ts`, which imports
 * `node:fs`, so a browser component importing from there breaks the bundle: measured 2026-11-11 as
 * `Module not found: Can't resolve 'fs'` across every Step 1 test. `lib/pricing/price.ts` re-exports
 * this module, so nothing that reads it there changed.
 *
 * ## What it is, and what it is not
 *
 * `MAllSetting.HARD_DEFAULT_SETTING.CustomerRates` (`MAllSetting.cs:27-58`) lists five —
 * `None` 0 %, `Diamond` 10 %, `Gold` 12 %, `Silver` 14 %, `Bronze` 16 % — and the desktop filled a
 * dropdown from it. But a quote stores **only** `CustomerRateValue` (`CustomerData.cs:79,382,430`),
 * never the code or the name, and the desktop's own model carries `IsCustom` for a rate somebody
 * typed. So this is a **shortcut**, not an enum, and it must never validate: a rate that matches no
 * tier is used exactly as typed.
 */

/** One named rate: the desktop's `RateCode`, its label, and the percentage it applies. */
export interface QuoteRateTier {
  code: string;
  label: string;
  pct: number;
}

/** The five tiers, in the desktop's own order. */
export const QUOTE_RATE_TIERS: readonly QuoteRateTier[] = [
  { code: 'None', label: 'None', pct: 0 },
  { code: 'Diamond', label: 'Diamond', pct: 10 },
  { code: 'Gold', label: 'Gold', pct: 12 },
  { code: 'Silver', label: 'Silver', pct: 14 },
  { code: 'Bronze', label: 'Bronze', pct: 16 },
];

/** The tier a percentage matches exactly, or `null` for a rate somebody typed. */
export function rateTierFor(pct: number): QuoteRateTier | null {
  return QUOTE_RATE_TIERS.find((tier) => tier.pct === pct) ?? null;
}
