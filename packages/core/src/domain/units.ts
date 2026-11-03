/**
 * Unit parsing, normalisation, and display rounding.
 *
 * Canonical stored values are always millimetres, integers. `parseDimension`
 * and `normaliseToMm` are the only places a non-mm value may enter the domain;
 * `formatDimension` is the only place a stored value is turned into text.
 *
 * `roundUpTo50` / `roundDownTo50` apply to *displayed dimension text* only.
 * Geometry never rounds to 50 mm (see Global Constraints in the plan).
 *
 * Pure TypeScript: no React, Next.js, Zustand, Konva, or three.
 */

import type { DisplayUnit } from './types';

/** Matches an optional sign, a decimal number, and an optional unit suffix. */
const DIMENSION_RE = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|millimet(?:re|er)s?|m|metres?|meters?)?\s*$/i;

/** Multiply factor to convert a value in `unit` into millimetres. */
function unitFactor(unit: DisplayUnit): number {
  return unit === 'm' ? 1000 : 1;
}

/**
 * Convert a value expressed in `unit` into integer millimetres.
 * No suffix is involved here; the unit is stated explicitly.
 */
export function normaliseToMm(value: number, unit: DisplayUnit): number {
  return Math.round(value * unitFactor(unit));
}

/**
 * Parse a user-entered dimension into integer millimetres.
 *
 * An explicit suffix in the string (`mm`, `m`, or a spelled-out form) wins;
 * otherwise `fallbackUnit` applies. Bare numbers are treated as already being
 * in `fallbackUnit`. Throws when the input cannot be read as a dimension.
 */
export function parseDimension(raw: string | number, fallbackUnit: DisplayUnit): number {
  const text = typeof raw === 'number' ? String(raw) : raw;
  const match = DIMENSION_RE.exec(text);
  if (!match) {
    throw new Error(`Cannot parse dimension: ${JSON.stringify(raw)}`);
  }

  const magnitude = Number.parseFloat(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (suffix === undefined) {
    return normaliseToMm(magnitude, fallbackUnit);
  }
  const suffixUnit: DisplayUnit = suffix === 'mm' || suffix.startsWith('milli') ? 'mm' : 'm';
  return normaliseToMm(magnitude, suffixUnit);
}

/** Round up to the nearest 50 mm boundary. Display text only. */
export function roundUpTo50(mm: number): number {
  return Math.ceil(mm / 50) * 50;
}

/** Round down to the nearest 50 mm boundary. Display text only. */
export function roundDownTo50(mm: number): number {
  return Math.floor(mm / 50) * 50;
}

/**
 * Render a stored millimetre value as display text. Does not round the stored
 * value; metres are shown to two decimal places.
 */
export function formatDimension(mm: number, unit: DisplayUnit): string {
  if (unit === 'm') {
    return (mm / 1000).toFixed(2);
  }
  return String(mm);
}

/**
 * Convert a stored millimetre quantity into the display unit as a *number* (not
 * text). Used for bounds such as a field's `min`/`max`/`step`, which must be
 * expressed in the same unit the user types in — a 1000 mm minimum is "1" in
 * metres, not 1000.
 */
export function toDisplayUnit(mm: number, unit: DisplayUnit): number {
  return unit === 'm' ? mm / 1000 : mm;
}
