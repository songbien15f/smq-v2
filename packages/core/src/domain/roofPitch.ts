/**
 * Which roof pitches the book offers **for this span**.
 *
 * ## The rule, and where it comes from
 *
 * The desktop rebuilds the roof-pitch dropdown on every span change: `GetHintListRoofPitch(configs,
 * span, out default)` (`ShedConfigCombo.cs:66-102`) keeps the `config_shed` rows whose span band
 * contains the current span and offers the union of their hints.
 *
 * On the reference book the answer is the same for every span in range — all six rows are
 * `span_min 1800 / span_max 15000`, three offering 7.5/10/15° and three offering 20/25/30°, so the
 * offered list is all six angles whatever the span. It is kept as a range query because the table is
 * structured that way and a supplier's bands can differ; hard-coding one list would then be wrong for
 * every other book.
 *
 * ## The desktop's bug, deliberately not reproduced
 *
 * That function reads `min = cfg.BayMin; max = cfg.BayMax;` and compares the **span** against them —
 * bay limits used as span limits, corrected in only one branch. The result is a wrong *suggestion*
 * list, never a wrong price, because the dropdown is editable. Reproduced here against the span band
 * the row actually states, which is what the code meant.
 *
 * Pure TypeScript: no React, no price-book import.
 */

/** One `config_shed` group: the span band it covers and the angles it sells. */
export interface RoofPitchGroup {
  spanMin: number;
  spanMax: number;
  pitchMin: number;
  pitchMax: number;
  hints: number[];
}

/**
 * The angles on offer at `spanMm`, ascending and unique.
 *
 * A span outside every band returns **every** angle rather than none: an empty list would leave the
 * slider at whatever it was with no explanation, and a span nobody states a band for is a gap in the
 * book, not a building with no roof.
 */
export function roofPitchHintsForSpan(
  groups: readonly RoofPitchGroup[],
  spanMm: number,
): number[] {
  if (groups.length === 0) return [];
  const inside = groups.filter((group) => spanMm >= group.spanMin && spanMm <= group.spanMax);
  const chosen = inside.length > 0 ? inside : groups;
  const hints = new Set<number>();
  for (const group of chosen) for (const hint of group.hints) hints.add(hint);
  return [...hints].sort((a, b) => a - b);
}

/**
 * The steepness bounds for `spanMm`, which is what a slider should be limited to.
 *
 * Wider than any single group's `pitch_min`/`pitch_max`, because a span can fall in more than one
 * band and narrowing below the union would refuse an angle the book sells. When no band covers the
 * span the union of all bands is used, matching `roofPitchHintsForSpan`.
 */
export function roofPitchBoundsForSpan(
  groups: readonly RoofPitchGroup[],
  spanMm: number,
): { min: number; max: number } | null {
  if (groups.length === 0) return null;
  const inside = groups.filter((group) => spanMm >= group.spanMin && spanMm <= group.spanMax);
  const chosen = inside.length > 0 ? inside : groups;
  return {
    min: Math.min(...chosen.map((group) => group.pitchMin)),
    max: Math.max(...chosen.map((group) => group.pitchMax)),
  };
}

/**
 * True when the current pitch is not one the book states for this span.
 *
 * Reported rather than corrected: a quote may legitimately carry an angle that is between two listed
 * ones (the desktop's dropdown is editable), and silently snapping it would change a roof the customer
 * has already seen. What the screen owes the operator is the fact that the book does not list it.
 */
export function pitchOutsideBookSpan(
  groups: readonly RoofPitchGroup[],
  spanMm: number,
  pitchDeg: number,
): boolean {
  const hints = roofPitchHintsForSpan(groups, spanMm);
  if (hints.length === 0) return false;
  return !hints.some((hint) => Math.abs(hint - pitchDeg) < 0.05);
}
