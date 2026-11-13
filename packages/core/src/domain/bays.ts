/**
 * Bay maths: how a shed's length is divided into structural bays.
 *
 * Bay counts are always integers in `[1, 30]` — the desktop's own bounds. Nominal bay spacing is
 * `floor(length / bays)`; the final bay absorbs any remainder so the grid lines
 * always end exactly at `length`. All values are millimetres, integers.
 *
 * This mirrors the desktop rule (spec §4.4): the number of internal frame lines
 * is `Bays.Count - 1`.
 *
 * ## Bays are an array, not a division
 *
 * The desktop keeps `BayUnits` — one length per bay — and lets a person edit them
 * individually (`UcAdjustBaySize`). Equal division is only the **starting point**
 * (`ResetBayUnitsToNomBay`), not the invariant: after one bay is edited the array
 * can be 4 000, 4 000, 6 000, and that is a valid building.
 *
 * The difference is not cosmetic. The frame table is keyed by the **largest bay**
 * (`GetMainShedLookupData` passes `sD.BayLargest`), so 4 000/4 000/6 000 selects a
 * different member size from 4 666/4 666/4 666 even though the length is the same.
 * Pricing by the average under-sizes the frame on the long bay.
 *
 * `bayWidthsFor()` is therefore the single place that answers "what are this
 * building's bays", and it honours a stored array when the quote has one.
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

/**
 * The bay lengths a building is divided into, summing exactly to its length.
 *
 * A stored array wins when it is usable — positive whole millimetres, the right
 * count, summing to the length. Anything else falls back to equal division with the
 * remainder in the last bay, which is what `ResetBayUnitsToNomBay` does and what a
 * quote that predates editable bays already means. Falling back rather than
 * rejecting matters: a stale revision whose bays and length disagree must still
 * draw and price, and equal division is the shape it was priced in.
 */
export function bayWidthsFor(shed: {
  length: number;
  bays: number;
  bayWidths?: readonly number[] | undefined;
}): number[] {
  const count = clampBays(shed.bays);
  const length = Number.isFinite(shed.length) ? Math.max(0, Math.round(shed.length)) : 0;
  const stored = shed.bayWidths;
  if (
    Array.isArray(stored) &&
    stored.length === count &&
    stored.every((width) => Number.isFinite(width) && width > 0) &&
    stored.reduce((sum, width) => sum + Math.round(width), 0) === length
  ) {
    return stored.map((width) => Math.round(width));
  }
  return computeBayWidths(length, count);
}

/** Grid-line positions from an explicit list of bay lengths. */
export function positionsFromWidths(widths: readonly number[]): number[] {
  const positions = [0];
  let running = 0;
  for (const width of widths) {
    running += Math.round(width);
    positions.push(running);
  }
  return positions;
}

/**
 * Clamp a requested bay count to an integer in `[1, 30]`.
 *
 * The lower bound is the desktop's: `DDesign.MaxNoOfBays` is 30 and the No. of Bays field is
 * `min 1, default 2` (`trace §3.6`, field #50). A one-bay shed is a real building — four columns and
 * a single span of roof — and refusing it made the smallest shed this product could quote one bay
 * longer than the factory's.
 *
 * `2` remains what a *new* quote starts from (`DEFAULT_SHED.bays`), which is where the desktop's
 * "default 2" belongs: a default, not a limit.
 */
export function clampBays(bays: number): number {
  const n = Math.round(bays);
  if (!Number.isFinite(n)) return 2;
  return Math.min(30, Math.max(1, n));
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
