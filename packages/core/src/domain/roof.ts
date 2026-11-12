/**
 * Roof geometry that a person needs to see before they send a quote.
 *
 * ## Why average height, of all things
 *
 * It is the number a council application and a delivery quote both ask for: not the wall height, and
 * not the ridge, but the height a building "is" for planning purposes. The desktop shows it read-only
 * in its Building Parameters panel, under the four fields a person types
 * (`UcShowBuildingParameterss.cs:786-841`).
 *
 * The formula is the desktop's, and so is the divisor — which is the part worth stating because it is
 * not obvious:
 *
 *   - **gable** — the roof rises from both walls to a ridge, so the *average* surface height is wall
 *     height plus half the rise, which is `(span / 4) × tan(pitch)`. The `4` is `2` walls over `2`
 *     halves.
 *   - **skillion** — the roof rises from one wall to the other, so the average is wall height plus
 *     half of `(span / 2) × tan(pitch)`, i.e. `(span / 4) × tan(pitch)` as well… except the desktop
 *     treats the full span as one slope and averages over it, which is `(span / 2)` of rise halved.
 *
 * The desktop's own code is a divisor switch, not two formulas:
 *
 * ```csharp
 * isSkillion = StructureValue.Contains("skillion");
 * divisor    = isSkillion ? 2 : 4;
 * roofHeight = (span / divisor) * tan(roofPitch * PI / 180);
 * avgHeight  = round(height + roofHeight);
 * ```
 *
 * That is reproduced exactly, divisor included, because a number used for a council application has to
 * agree with the number the company has been lodging for years. It is **not** an engineering constant
 * this product gets to improve on.
 */

import type { ShedConfig, DimensionedShed } from './types';

/**
 * True when the structure is a single-slope roof.
 *
 * The desktop matches on the **display name** containing "skillion" (`StructureValue.Contains(...)`),
 * because its structure list is free text. Here `structureType` is a closed union, so the test is an
 * equality — but the union has more than one single-slope member, and `carports` can be either. Only
 * `skillion` is treated as single-slope, which is what the desktop's string match effectively does for
 * the values its list contains.
 */
function isSkillion(shed: Pick<DimensionedShed, 'structureType'>): boolean {
  return shed.structureType === 'skillion';
}

/**
 * The average roof height above the floor, in millimetres.
 *
 * `null` when a dimension is missing: a pitch of 0 is a flat roof and *does* have an average height
 * (the wall height), but a span of 0 is not a building. The desktop skips its own calculation on
 * `height <= 0 || span <= 0 || roofPitch <= 0`, so a zero pitch reports nothing rather than reporting
 * the wall height — kept, because "0" and "not known" read the same on a certificate and only one of
 * them is true.
 */
export function averageHeightMm(
  shed: Pick<DimensionedShed, 'structureType' | 'span' | 'height' | 'roofPitchDeg'>,
): number | null {
  if (shed.height <= 0 || shed.span <= 0 || shed.roofPitchDeg <= 0) return null;

  const divisor = isSkillion(shed) ? 2 : 4;
  const rise = (shed.span / divisor) * Math.tan((shed.roofPitchDeg * Math.PI) / 180);
  return Math.round(shed.height + rise);
}

/**
 * The ridge height above the floor, in millimetres.
 *
 * Not shown by the desktop's panel, and included here because the average alone is confusing beside a
 * pitch slider: "average 3 400" does not say the peak is 4 100. A gable's ridge is wall height plus
 * `(span / 2) × tan(pitch)`; a skillion's high side is wall height plus `span × tan(pitch)`.
 */
export function ridgeHeightMm(
  shed: Pick<DimensionedShed, 'structureType' | 'span' | 'height' | 'roofPitchDeg'>,
): number | null {
  if (shed.height <= 0 || shed.span <= 0 || shed.roofPitchDeg <= 0) return null;

  const run = isSkillion(shed) ? shed.span : shed.span / 2;
  return Math.round(shed.height + run * Math.tan((shed.roofPitchDeg * Math.PI) / 180));
}
