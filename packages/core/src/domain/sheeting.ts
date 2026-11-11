/**
 * Which sheeting a shed is clad in, as the price book names it.
 *
 * ## The two facts, and why they travel separately now
 *
 * A sheet is a **profile** and a **thickness**. The book prices them together
 * (`view_cost_sheeting` is keyed by `profile` + `bmt`), and the difference is not
 * cosmetic:
 *
 * | profile | bmt | cover mm | cost / m |
 * |---|---|---|---|
 * | Corro | 0.42 | 762 | 10.42 avg |
 * | Lo-Rib | 0.42 | **817** | **10.56** avg |
 * | Corro | 0.48 | 762 | 11.71 avg |
 *
 * A thicker sheet costs more per metre and a wider cover needs fewer sheets, so both
 * change the total. Until 2026-11-11 the BOM hard-coded `Corro` at `0.42` in five
 * places and the operator's choice of profile never reached a price.
 *
 * ## Why one string is still accepted
 *
 * The desktop's `.sqd` stores them **joined**: `RoofSheeting: '0.42 TL-5'`,
 * `WallSheeting: '0.35 TL-5'`. A reader that expects a bare profile finds no row and
 * every imported quote prices from a mocked line. `parseSheeting` splits the joined
 * form, and `sheetingSpec` puts one back for the export.
 *
 * Pure TypeScript: no React, no price-book import.
 */

/** A profile and the thickness it is ordered in, mm. */
export interface SheetingSpec {
  profile: string;
  bmtMm: number;
}

/** The thickness a shed is quoted in when the config does not say. */
export const DEFAULT_BMT_MM = 0.42;

/**
 * Split a stored sheeting value into profile and thickness.
 *
 * Accepts the three forms that exist in real data:
 *
 * - `'0.42 TL-5'` — the desktop's joined form, thickness first;
 * - `'TL-5'` — a bare profile, thickness taken from `bmtMm` or the default;
 * - `'TL-5 0.35'` — profile first, which nothing writes but which costs one branch.
 *
 * A value that names nothing returns the fallback profile rather than an empty string:
 * an empty profile finds no price row and turns every sheet into a mocked line.
 */
export function parseSheeting(
  value: string,
  bmtMm?: number,
): { profile: string; bmtMm: number } {
  const text = value.trim();
  const joined = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(text);
  if (joined !== null) {
    return { profile: joined[2]!.trim(), bmtMm: Number(joined[1]) };
  }
  const trailing = /^(.+?)\s+(\d+(?:\.\d+)?)$/.exec(text);
  if (trailing !== null) {
    return { profile: trailing[1]!.trim(), bmtMm: Number(trailing[2]) };
  }
  return { profile: text === '' ? 'Corro' : text, bmtMm: bmtMm ?? DEFAULT_BMT_MM };
}

/** The joined form the desktop's `.sqd` carries (`'0.42 TL-5'`). */
export function sheetingSpec(profile: string, bmtMm: number): string {
  return `${bmtMm} ${profile}`;
}
