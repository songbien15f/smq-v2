/**
 * Bay maths: how a shed's length is divided into structural bays.
 *
 * Bay counts are always integers in `[2, 30]`. Nominal bay spacing is
 * `floor(length / bays)`; the final bay absorbs any remainder so the grid lines
 * always end exactly at `length`. All values are millimetres, integers.
 *
 * This mirrors the desktop rule (spec §4.4): the number of internal frame lines
 * is `Bays.Count - 1`.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

/** Clamp a requested bay count to an integer in `[2, 30]`. */
export function clampBays(bays: number): number {
  const n = Math.round(bays);
  if (!Number.isFinite(n)) return 2;
  return Math.min(30, Math.max(2, n));
}

/**
 * Grid-line positions along the bay direction, in millimetres.
 *
 * Returns `n + 1` positions for `n` bays; the first is `0` and the last is
 * exactly `length`, so any remainder is absorbed by the last bay.
 */
export function computeBayPositions(length: number, bays: number): number[] {
  const n = clampBays(bays);
  const nominal = Math.floor(length / n);
  const positions = Array.from({ length: n }, (_, i) => nominal * i);
  positions.push(length); // last grid line is the true end
  return positions; // n + 1 lines, n bays
}

/**
 * Consecutive bay widths, in millimetres. Always `n` values that sum exactly to
 * `length`; the last width carries the remainder.
 */
export function computeBayWidths(length: number, bays: number): number[] {
  const positions = computeBayPositions(length, bays);
  const widths: number[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    widths.push(positions[i + 1] - positions[i]);
  }
  return widths;
}

/**
 * Reconcile the three bay fields the desktop lets a person edit.
 *
 * The desktop form has `Overall Length`, `No. of Bays` and `Nom. Bay Spacing`, and
 * editing any one of them drives the other two: a spacing and a bay count give a
 * length, a length and a bay count give a spacing. Keeping all three as typed by
 * the user would let a quote claim a length no bay grid sums to, so this function
 * decides which pair wins.
 *
 * A spacing that is set (positive) wins: `length = spacing × bays`. Otherwise the
 * spacing is derived as `floor(length / bays)`, and the final bay absorbs the
 * remainder — the desktop's own rule.
 */
export function reconcileBays(input: {
  length: number;
  bays: number;
  nomBaySpacing: number;
}): { length: number; bays: number; nomBaySpacing: number } {
  const bays = clampBays(input.bays);

  if (Number.isFinite(input.nomBaySpacing) && input.nomBaySpacing > 0) {
    const spacing = Math.round(input.nomBaySpacing);
    return { length: spacing * bays, bays, nomBaySpacing: spacing };
  }

  const length = Number.isFinite(input.length) ? Math.max(0, Math.round(input.length)) : 0;
  return { length, bays, nomBaySpacing: Math.floor(length / bays) };
}

/**
 * True when the stored spacing and bay count do not add up to the length.
 *
 * The desktop's message is "Total bay length is not equal to overall length."
 * A remainder means one bay is a different length from the rest, which changes
 * the purlin run and therefore the price, so it is reported rather than rounded.
 */
export function baySpacingMismatch(config: {
  length: number;
  bays: number;
  nomBaySpacing: number;
}): boolean {
  return config.nomBaySpacing > 0 && config.nomBaySpacing * config.bays !== config.length;
}
