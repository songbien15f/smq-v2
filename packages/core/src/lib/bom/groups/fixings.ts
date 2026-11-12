/**
 * The bolt and screw groups.
 *
 * Bolts and screws are the only items sold in packs, so they carry the one rule
 * this module exists to get right:
 *
 *     needed   = count × (1 + allowance)      // 10% for screws, 0 for bolts
 *     packs    = ceil(needed / qtyPerPack)
 *     quantity = packs                        // the unit is 'pack'
 *     massKg   = massPerPiece × needed        // NOT × packs
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop rounds
 * three times — add 10%, round up to a multiple of ten, then round up to a pack —
 * so a run needing 101 screws is billed as 110 then as 2 packs of 50. Here there
 * is one rounding, to packs. The mass follows the true count rather than the pack
 * count, because a pack's carton is not steel in the building; the desktop's
 * `TotalMass` multiplies by the pack count and overstates the delivery weight.
 *
 * Counts come from the members that are actually fixed:
 *
 * - **Roof screws**: `(purlinRows + 1) × roofSheets × 4` — the ridge line takes a
 *   row of screws too, which is where the `+ 1` comes from.
 * - **Wall screws**: `(girtRows + 1) × 4 × wallSheets`.
 * - **Flashing screws**: two per metre of flashing, plus a bracket line.
 * - **Bolts**: four per column, which is the pinned-footing case.
 */

import type { ShedConfig, DimensionedShed } from '@/domain/types';
import type { PackRow, PriceLookup } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { frameCounts } from './frame';
import { sheetCounts } from './sheeting';
import { safeCall } from '../safe';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';

/*
 * Bolts per column, screws per crossing, the screw over-run allowance and the
 * flashing screw rate are **factory rules** — a supplier states them, and two
 * suppliers do not agree. They arrive with the building's rule set.
 */
/** The screw types the book names. */
const SCREW_ROOF = 'ROOF_SCREW';
const SCREW_WALL = 'WALL_SCREW';
const SCREW_FLASHING = 'SCREW_LAP';
/** The bolt that fixes a column to its base plate. */
const COLUMN_BOLT = 'M16x40-8.8';

/**
 * The smallest number of packs that covers `needed` pieces.
 *
 * Exported so the one-rounding rule can be tested directly, and so no other group
 * grows its own version of it.
 */
export function packCount(needed: number, qtyPerPack: number): number {
  if (!(qtyPerPack > 0) || !Number.isFinite(needed) || needed <= 0) return 0;
  return Math.ceil(needed / qtyPerPack);
}

/**
 * One pack line: the pack count as the quantity, the true count as the mass.
 *
 * `needed` is the number of pieces the building actually uses; the mass is that
 * count times the per-piece mass, not the pack count times anything.
 */
function packLine(
  group: 'bolt' | 'screw',
  description: string,
  needed: number,
  row: PackRow | undefined,
): BomLine[] {
  if (needed <= 0) return [];
  const quantity = row === undefined ? Math.ceil(needed) : packCount(needed, row.qtyPerPack);

  if (row === undefined) {
    return [mockedLine({ group, description, unit: 'pack', quantity })];
  }
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${row.description}, pack of ${row.qtyPerPack}`,
      unit: 'pack',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * needed,
    }),
  ];
}

/** Flashing metres, which the flashing screw count needs. */
function flashingMetres(shed: DimensionedShed): number {
  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
  const barge = (shed.span / 1000) * (fallsAlongLength ? 1 : 2);
  const eave = (shed.length / 1000) * (fallsAlongLength ? 1 : 2);
  // Four corners at roughly a wall height each.
  const corners = (4 * shed.height) / 1000;
  return barge + eave + corners;
}

/** The bolt and screw lines. */
export function fixingLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomLine[] {
  const counts = frameCounts(shed);
  const sheets = sheetCounts(shed, lookup);

  // Columns: four bolts each, with no allowance — a bolt is not lost to a cut.
  const bolts = (counts.main + counts.end) * rules.boltsPerColumn;

  // Roof: a screw row at every purlin plus the ridge, four screws per crossing.
  const roofScrews = (frame.purlinRows + 1) * sheets.roof * rules.screwsPerCrossing;
  // Walls: the same shape, over both long walls and both ends.
  const wallScrews = (frame.girtRows + 1) * rules.screwsPerCrossing * (sheets.side + sheets.end);
  // Flashing: two a metre, plus the 10% allowance for cut ends.
  const flashingScrews = Math.ceil(flashingMetres(shed) * rules.flashingScrewsPerMetre);

  const withAllowance = (count: number) => Math.ceil(count * (1 + rules.screwAllowance));

  // A roof or wall screw is colour-matched to the sheet it goes through: an
  // unpainted head on a Colorbond roof is a callback. The flashing screw is a
  // plain tek, so it takes no colour.
  const roofColour = safeCall(() => lookup.colourName(shed.colors.roof));
  const wallColour = safeCall(() => lookup.colourName(shed.colors.wall));

  const boltRow = safeCall(() => lookup.bolt(COLUMN_BOLT));
  const roofRow = safeCall(() => lookup.screw(SCREW_ROOF, roofColour));
  const wallRow = safeCall(() => lookup.screw(SCREW_WALL, wallColour));
  const flashingRow = safeCall(() => lookup.screw(SCREW_FLASHING));

  return [
    ...packLine('bolt', 'Column bolt', bolts, boltRow),
    ...packLine('screw', 'Roof screw', withAllowance(roofScrews), roofRow),
    ...packLine('screw', 'Wall screw', withAllowance(wallScrews), wallRow),
    ...packLine('screw', 'Flashing screw', withAllowance(flashingScrews), flashingRow),
  ];
}
