/**
 * The sheeting group: roof and wall sheets.
 *
 * A sheet covers a fixed width, so the count comes from dividing the run by the
 * cover. Three details decide the answer:
 *
 *   - **The cover is millimetres.** The price book states it as 762, not 0.762.
 *   - **A run that is not a whole multiple needs one more sheet.** A 10.1 m run
 *     over a 1 m cover needs 11 sheets, not 10 and a sliver.
 *   - **A roof has one run per slope.** A gable has two, a skillion one.
 *
 * **The price is per linear metre, not per sheet.** The desktop treats a roof and
 * wall spec as `LENGTH_MATERIAL` and extends it as `Length/1000 × quantity ×
 * price` (`RoofSpec.cs`, `WallSpec.cs`), and the book's figure is a per-metre
 * rate: $10.23 for a 0.42 Corro sheet is a metre of that coil, not a 6 m sheet.
 * Charging a per-sheet count at a per-metre price understates a roof by the
 * sheet's length — nearly three times on a 6 m roof sheet. The extension is
 * therefore driven by the evidence contract, not by a constant here.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop's
 * side-wall path casts the cover with `(int)`, which turns a metre-valued 0.762
 * into 0; this build uses the millimetres the book states.
 */

import type { ShedConfig, DimensionedShed } from '@/domain/types';
import type { PriceLookup, SheetingRow } from '@/lib/pricing/types';
import type { MaterialUnitContract } from '@/lib/pricing/catalogueManifest';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { parseSheeting } from '@/domain/sheeting';
import { extendMaterial } from '../materialUnits';
import type { EstimateIssue, MaterialEvidence } from '@/lib/estimating/types';
import { safeCall } from '../safe';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';

/*
 * The sheet end allowances are **factory rules**: how far a supplier's sheets run
 * past the eave, the ridge, and the top and bottom of a wall. They arrive with the
 * building's rule set.
 */
/**
 * The profile and thickness a shed is quoted in when the config does not say.
 *
 * Kept as the last resort — a config that predates `wallBmt` or an empty profile string — but no
 * longer the value used for every shed. The operator chooses the profile and the book prices the
 * thickness; hard-coding `Corro` at `0.42` here meant the choice never reached a price, and a
 * `Lo-Rib` shed was quoted at Corro's 762 mm cover instead of 817 (measured 2026-11-11).
 */
export const FALLBACK_PROFILE = 'Corro';
export const FALLBACK_BMT = 0.42;

/** The roof sheet this shed is clad in, profile and thickness. */
export function roofSheetingOf(shed: DimensionedShed): { profile: string; bmtMm: number } {
  const parsed = parseSheeting(shed.roofProfile ?? '', shed.roofBmt);
  return { profile: parsed.profile === '' ? FALLBACK_PROFILE : parsed.profile, bmtMm: parsed.bmtMm };
}

/** The wall sheet this shed is clad in, profile and thickness. */
export function wallSheetingOf(shed: DimensionedShed): { profile: string; bmtMm: number } {
  const parsed = parseSheeting(shed.wallProfile ?? '', shed.wallBmt);
  return { profile: parsed.profile === '' ? FALLBACK_PROFILE : parsed.profile, bmtMm: parsed.bmtMm };
}

/** The issue and evidence a group returns alongside its lines. */
export interface GroupResult {
  lines: BomLine[];
  issues: EstimateIssue[];
  materials: MaterialEvidence[];
}

/**
 * True when the structure has no walls.
 *
 * A carport is a roof on columns: it has no wall sheeting, no wall girts, no
 * gutter and no wall screws. Treating it as a shed produced a quote identical to
 * an enclosed garage of the same size, which is a quote for a building the
 * customer did not ask for.
 */
export function isOpenStructure(shed: DimensionedShed): boolean {
  return shed.structureType === 'gable_carport' || shed.structureType === 'skillion_carport';
}

/** True when the roof falls along the length, so it has one slope. */
function fallsAlongLength(shed: DimensionedShed): boolean {
  return shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
}

/** Sheets needed to cover `runMm` at `coverMm`, rounded up. */
function sheetCount(runMm: number, coverMm: number): number {
  if (!(coverMm > 0) || !(runMm > 0)) return 0;
  return Math.ceil(runMm / coverMm);
}

/**
 * A roof sheet's length: the slope run plus the end allowance.
 *
 * Which dimension is the run depends on where the water goes:
 *
 * - **Gable** — falls across the span, so a sheet runs from an eave to the ridge:
 *   half the span.
 * - **Skillion** — falls **along the length**, so a sheet runs the whole length
 *   from the low wall to the high wall. The renderer agrees: the 3D roof drops
 *   `tan(pitch) × length` across `length`, not across `span`.
 *
 * Getting this backwards makes every skillion's sheets the wrong dimension — the
 * length instead of half the span, which on a long narrow skillion is several
 * times the steel.
 */
function roofSheetLength(shed: DimensionedShed, rules: BomRules): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const run = fallsAlongLength(shed) ? shed.length : shed.span / 2;
  return Math.round(run / Math.cos(pitch) + rules.roofEndAllowance);
}

/** A wall sheet's length: the wall height plus the end allowance. */
function wallSheetLength(shed: DimensionedShed, rules: BomRules): number {
  return shed.height + rules.wallEndAllowance;
}

/** How many skylights sit on the roof, each replacing a sheet. */
function skylightCount(shed: DimensionedShed): number {
  return shed.options.filter((option) => option.kind === 'skylight').length;
}

/**
 * How many sheets of each kind the shed takes.
 *
 * Exported because the fixing group counts screws per sheet: a roof screw count
 * is `(rows + 1) × roofSheets × 4`, so the sheet count has to come from the same
 * place that emits the sheets.
 */
export function sheetCounts(
  shed: DimensionedShed,
  lookup: PriceLookup,
): { roof: number; side: number; end: number; coverMm: number; wallCoverMm: number } {
  /*
   * Two covers, because a shed is clad in two profiles.
   *
   * The cover is the sheet's own width, and the book disagrees between profiles: `Corro` covers
   * 762 mm and `Lo-Rib` 817 mm, so a `Lo-Rib` roof needs 7% fewer sheets across the same run. One
   * cover used for roof and wall alike was the hard-coded default's second consequence.
   *
   * `coverMm` (the roof's) is what the skylight snap and the screw count read — a skylight replaces
   * one **roof** sheet — so the roof value keeps that name rather than growing a third.
   */
  const roofSheet = roofSheetingOf(shed);
  const wallSheet = wallSheetingOf(shed);
  const cover = safeCall(() => lookup.sheeting(roofSheet.profile, roofSheet.bmtMm))?.coverageMm ?? 0;
  const wallCover =
    safeCall(() => lookup.sheeting(wallSheet.profile, wallSheet.bmtMm))?.coverageMm ?? cover;

  // Sheets are counted across the run, not along it. A gable's sheets span from
  // eave to ridge and are counted along the length; a skillion's sheets run the
  // length and are counted across the span.
  const acrossRun = fallsAlongLength(shed) ? shed.span : shed.length;
  const roofRuns = fallsAlongLength(shed) ? 1 : 2;
  const walls = isOpenStructure(shed) ? 0 : 1;

  return {
    // Roof: one run of sheets per slope, less one sheet per skylight.
    roof: Math.max(0, sheetCount(acrossRun, cover) * roofRuns - skylightCount(shed)),
    // Side walls: two long runs of the wall sheet length.
    side: sheetCount(shed.length, wallCover) * 2 * walls,
    // End walls: two runs across the span.
    end: sheetCount(shed.span, wallCover) * 2 * walls,
    coverMm: cover,
    wallCoverMm: wallCover,
  };
}

/**
 * Emit one sheeting line, extended by its evidence contract.
 *
 * A per-metre price is multiplied by the total linear metres the sheets need; a
 * per-sheet price by the count. The contract decides, so the group has no unit
 * constant of its own.
 */
function sheetLine(
  description: string,
  count: number,
  lengthMm: number,
  coverMm: number,
  sheet: { profile: string; bmtMm: number },
  contract: MaterialUnitContract,
  lookup: PriceLookup,
): { lines: BomLine[]; issues: EstimateIssue[]; materials: MaterialEvidence[] } {
  if (count <= 0) return { lines: [], issues: [], materials: [] };

  /*
   * The **shed's** sheet, not a default.
   *
   * A line label reading "0.42 Corro" on a Lo-Rib shed is worse than a wrong number: it is a
   * document the customer keeps, and an order placed from it buys the wrong coil.
   */
  const row: SheetingRow | undefined = safeCall(() => lookup.sheeting(sheet.profile, sheet.bmtMm));
  const label = `${description} — ${row?.description ?? `${sheet.bmtMm} ${sheet.profile}`}, ${lengthMm} mm`;

  if (row === undefined) {
    return {
      lines: [mockedLine({ group: 'sheeting', description: label, unit: 'ea', quantity: count })],
      issues: [
        {
          code: 'SHEETING_PRICE_MISSING',
          severity: 'blocker',
          message: `No price for ${sheet.bmtMm} ${sheet.profile} sheeting, so ${description.toLowerCase()} cannot be priced.`,
        },
      ],
      materials: [],
    };
  }

  const extended = extendMaterial({
    count,
    lengthMm,
    coverMm,
    unitCost: row.unitCost,
    massPerUnit: row.massKg,
    priceBasis: contract.priceBasis,
    massBasis: contract.massBasis,
  });

  if (extended === null) {
    return {
      lines: [mockedLine({ group: 'sheeting', description: label, unit: 'ea', quantity: count })],
      issues: [
        {
          code: 'SHEETING_COVER_MISSING',
          severity: 'blocker',
          message: `The price book gives no usable sheet cover, so ${description.toLowerCase()} cannot be measured.`,
        },
      ],
      materials: [],
    };
  }

  return {
    lines: [
      bomLine({
        group: 'sheeting',
        code: row.code,
        description: label,
        unit: extended.unit,
        quantity: extended.quantity,
        unitCost: row.unitCost,
        massKg: extended.massKg,
      }),
    ],
    issues: [],
    materials: [
      {
        lineId: `sheeting|${row.code}|${lengthMm}`,
        sourceKey: contract.sourceKey,
        priceBasis: contract.priceBasis,
        massBasis: contract.massBasis,
        status: contract.status,
      },
    ],
  };
}

/** The sheeting lines, with the issues and evidence they produced. */
export function sheetingGroup(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  contract: MaterialUnitContract,
  rules: BomRules = DEFAULT_BOM_RULES,
): GroupResult {
  const counts = sheetCounts(shed, lookup);

  if (!(counts.coverMm > 0)) {
    return {
      lines: [],
      issues: [
        {
          code: 'SHEETING_COVER_MISSING',
          severity: 'blocker',
          message: 'The price book gives no usable sheet cover, so no sheet can be counted.',
        },
      ],
      materials: [],
    };
  }

  const roofSheet = roofSheetingOf(shed);
  const wallSheet = wallSheetingOf(shed);
  const parts = [
    sheetLine(
      'Roof sheeting',
      counts.roof,
      roofSheetLength(shed, rules),
      counts.coverMm,
      roofSheet,
      contract,
      lookup,
    ),
    sheetLine(
      'Side wall sheeting',
      counts.side,
      wallSheetLength(shed, rules),
      counts.wallCoverMm,
      wallSheet,
      contract,
      lookup,
    ),
    sheetLine(
      'End wall sheeting',
      counts.end,
      wallSheetLength(shed, rules),
      counts.wallCoverMm,
      wallSheet,
      contract,
      lookup,
    ),
  ];

  return {
    lines: parts.flatMap((part) => part.lines),
    issues: parts.flatMap((part) => part.issues),
    materials: parts.flatMap((part) => part.materials),
  };
}

/** The sheeting lines. Kept for callers that only need the materials. */
export function sheetingLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  contract: MaterialUnitContract,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomLine[] {
  return sheetingGroup(shed, frame, lookup, contract, rules).lines;
}
