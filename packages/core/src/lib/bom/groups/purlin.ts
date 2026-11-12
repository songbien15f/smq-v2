/**
 * The purlin and girt group.
 *
 * Purlins run across the roof slopes at the row spacing the optimisation chose;
 * girts run around the walls at their own spacing. Both are length material, so
 * their quantity is metres.
 *
 * A run is not one piece: the stock comes in fixed lengths, so consecutive bays
 * are grouped into runs and each run gets a **lap allowance** where one piece
 * meets the next. The allowance is 10% of the bay normally, and 15% on a TopHat
 * frame in wind region C, where the overlap is specified larger.
 *
 * **Deviation from the desktop (recorded in `../../deviations.ts`, entry 1):** the
 * desktop prices every girt from the *purlin* row unconditionally, so a girt and a
 * purlin always cost the same per metre and the quote says nothing about it. Here a
 * girt is priced from the girt material when the book states one, and from the purlin
 * row with the line marked `assumed` when it does not — so the quote reads as
 * indicative rather than firm, and a reader can see which number is a substitution.
 *
 * The reference book names no girt material at all, so the fallback is the normal case
 * there. That is not a reason to hide it; it is the reason the caveat exists. A girt is
 * a wall member and a purlin is a roof member: different sections, different loads.
 */

import { bayWidthsFor } from '@/domain/bays';
import type { ShedConfig, DimensionedShed } from '@/domain/types';
import { windRegionLetter } from '@/domain/wind';
import type { PriceLookup, PriceRow } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { safeCall } from '../safe';
import { isOpenStructure } from './sheeting';
import { DEFAULT_BOM_RULES, type BomRules } from '../rules';

/*
 * The lap allowances and the run end inset are **factory rules**: how much stock a
 * supplier's purlins need where two lengths meet, and how far a run stops from the
 * corner. They arrive with the building's rule set — see `../rules.ts`.
 */

/**
 * The largest bay, which sets the run grouping.
 *
 * The longest run between supports, for the same reason `optimise.ts` keys the frame table by it: a
 * purlin has to carry its longest span. See the note there.
 */
function maxBay(shed: DimensionedShed): number {
  return Math.max(...bayWidthsFor(shed));
}

/** The lap fraction for this shed. */
function lapFraction(shed: DimensionedShed, rules: BomRules): number {
  const topHat = shed.structureType === 'gable' || shed.structureType === 'skillion';
  /*
   * Region C by **letter**, not by exact string.
   *
   * The stored value is a certificate code — `C2`, `C3`, `C4` — so an equality test against `'C'`
   * stopped applying the heavier lap the moment the field began holding what ShedSafe returns. The
   * heavier lap is a physical requirement, not a label: missing it under-states the purlin metres.
   */
  return topHat && windRegionLetter(shed.windRegion) === 'C' ? rules.lapWindCToHat : rules.lapNormal;
}

/**
 * The metres of purlin or girt one run needs.
 *
 * `runs` is how many separate runs there are (roof slopes, or walls), `runLength`
 * is how long each is, and `rows` is how many members per run.
 */
function runMetres(
  runLength: number,
  rows: number,
  runs: number,
  lap: number,
  rules: BomRules,
): number {
  const withLap = runLength * (1 + lap) - rules.runEndInset * 2;
  return Math.max(0, (withLap / 1000) * rows * runs);
}

/** One purlin line, or a mocked one when the material has no price. */
function purlinLine(
  description: string,
  metres: number,
  material: string,
  lookup: PriceLookup,
): BomLine[] {
  if (metres <= 0) return [];
  const row: PriceRow | undefined = safeCall(() => lookup.purlin(material));
  const quantity = Math.round(metres * 100) / 100;

  if (row === undefined) {
    return [mockedLine({ group: 'purlin', description: `${description} — ${material}`, unit: 'm', quantity })];
  }
  return [
    bomLine({
      group: 'purlin',
      code: row.code,
      description: `${description} — ${material}`,
      unit: 'm',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * quantity,
    }),
  ];
}

/**
 * One girt line.
 *
 * Two differences from `purlinLine`, and both are the point of this group:
 *
 * - the price comes from the **girt** material, so a book that sells a different
 *   section for walls is priced from it;
 * - when the price is the purlin's because the book has no girt material, the line is
 *   marked `assumed` — a real catalogue figure for a *different member*. The code and
 *   description say purlin, so a reader of the materials list is not told a wall girt
 *   was ordered when the workshop will pull a roof purlin.
 */
function girtLine(
  description: string,
  metres: number,
  material: string,
  lookup: PriceLookup,
): BomLine[] {
  if (metres <= 0) return [];
  const quantity = Math.round(metres * 100) / 100;

  // A book that sells girts apart answers `girt()`. One that does not — the reference
  // book, and any lookup that predates girt pricing — is priced from the purlin row.
  // The fallback lives here rather than in the lookup so that a lookup which simply
  // omits `girt` still prices the wall instead of returning no price at all.
  const priced = safeCall(() => lookup.girt?.(material));
  const fallback = priced === undefined ? safeCall(() => lookup.purlin(material)) : undefined;
  const row: PriceRow | undefined = priced?.row ?? fallback;

  if (row === undefined) {
    return [mockedLine({ group: 'purlin', description: `${description} — ${material}`, unit: 'm', quantity })];
  }

  const separate = priced?.separate === true;

  return [
    bomLine({
      group: 'purlin',
      code: row.code,
      description: `${description} — ${material}`,
      unit: 'm',
      quantity,
      unitCost: row.unitCost,
      massKg: row.massKg * quantity,
      // Not `mocked`: a price was found and it is real. It is simply not the girt's own,
      // so the line is a documented substitution rather than a placeholder.
      ...(separate ? {} : { assumed: true }),
    }),
  ];
}

/** The purlin and girt lines. */
export function purlinLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): BomLine[] {
  const lap = lapFraction(shed, rules);
  const lines: BomLine[] = [];

  // Roof purlins: one run per slope. A gable has two, a skillion one.
  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
  const roofRuns = fallsAlongLength ? 1 : 2;
  lines.push(
    ...purlinLine(
      'Roof purlin',
      runMetres(shed.length, frame.purlinRows, roofRuns, lap, rules),
      frame.purlinMaterial,
      lookup,
    ),
  );

  // A carport has no walls to girt. Emitting girts for one prices a shed the
  // customer did not ask for.
  if (!isOpenStructure(shed)) {
    // Side-wall girts run along the length on both long walls.
    lines.push(
      ...girtLine(
        'Side wall girt',
        runMetres(shed.length, frame.girtRows, 2, lap, rules),
        frame.girtMaterial,
        lookup,
      ),
    );

    // End-wall girts run across the span on both gable ends.
    lines.push(
      ...girtLine(
        'End wall girt',
        runMetres(shed.span, frame.girtRows, 2, lap, rules),
        frame.girtMaterial,
        lookup,
      ),
    );
  }

  return lines;
}

/** The largest bay, exported for the groups that need the same grouping. */
export { maxBay as largestBay };
