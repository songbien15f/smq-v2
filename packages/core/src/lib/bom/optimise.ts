/**
 * The purlin/girt optimisation.
 *
 * This is the load-bearing step of the whole BOM: it decides how many purlin rows
 * run over the roof and how many girt rows run up the walls, and every sheeting,
 * flashing and fixing quantity downstream depends on that answer. It also picks
 * the purlin material, which changes the rafter length, which changes the sheeting
 * length.
 *
 * The rule comes from the desktop's `BOMFactory.optimalPurlinGirt`: for each row
 * of the `devided` span table, compute how many purlins it would take and what
 * they would cost, then keep the cheapest. The cost is
 * `rows × materialPrice × baySize × bays`.
 *
 * Two details are deliberate:
 *
 *   - the row count is rounded **up** only when the fractional part exceeds 0.1,
 *     because a sliver of leftover span is not worth an extra row; and
 *   - the internal span is raised to the end span when it is smaller, because an
 *     internal purlin may not be spaced closer than an end one.
 */

import { bayWidthsFor } from '@/domain/bays';
import type { ShedConfig } from '@/domain/types';
import { windRegionCode } from '@/domain/wind';
import type { PriceLookup } from '@/lib/pricing/types';
import { frameScheduleQuery, subCodeFor } from '@/lib/pricing/structure';
import { DEFAULT_BOM_RULES, type BomRules } from './rules';
import type { OptimisedFrame } from './types';
import { safeCall } from './safe';

/** The standard bay lengths the span table is indexed by. */
const STANDARD_BAYS = [3000, 3250, 3500, 3750, 4000, 4500, 5000, 5500, 6000] as const;

/*
 * The four numbers this step needs — edge clearance, floor clearance, the
 * fractional-row threshold and the minimum row count — are **factory rules**, not
 * geometry, so they live in `rules.ts` and arrive as an argument. The values this
 * build has always used are that module's defaults, so an unstored rule set prices
 * exactly as before.
 */

/** The next standard bay length at or above `bayMax`, clamped to the table. */
export function standardBayLength(bayMax: number): number {
  for (const bay of STANDARD_BAYS) {
    if (bay >= bayMax) return bay;
  }
  return STANDARD_BAYS[STANDARD_BAYS.length - 1];
}

/** Rows from a span, an internal spacing, an end spacing and the factory's rules. */
function rowsFor(
  span: number,
  internalSpan: number,
  endSpan: number,
  clearance: number,
  rules: BomRules,
): number {
  const internal = internalSpan < endSpan ? endSpan : internalSpan;
  if (!(internal > 0)) return rules.minRows;

  const exact = (span - clearance - 2 * endSpan) / internal + 2;
  if (!Number.isFinite(exact)) return rules.minRows;

  const fraction = exact - Math.floor(exact);
  const rows = fraction > rules.rowFractionThreshold ? Math.ceil(exact) : Math.floor(exact);
  return Math.max(rules.minRows, rows);
}

/** How many purlin rows a roof of `roofSpan` needs at these spacings. */
export function purlinRows(
  roofSpan: number,
  internalSpan: number,
  endSpan: number,
  rules: BomRules = DEFAULT_BOM_RULES,
): number {
  return rowsFor(roofSpan, internalSpan, endSpan, rules.purlinEdgeClearance, rules);
}

/** How many girt rows a wall of `height` needs at these spacings. */
export function girtRows(
  height: number,
  internalSpan: number,
  endSpan: number,
  rules: BomRules = DEFAULT_BOM_RULES,
): number {
  return rowsFor(height, internalSpan, endSpan, rules.girtFloorClearance, rules);
}

/** The roof run the purlins span: full for a skillion, half for a gable. */
function roofSpanFor(shed: ShedConfig): number {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const slope = shed.span / Math.cos(pitch);
  const fallsAlongLength =
    shed.structureType === 'skillion' || shed.structureType === 'skillion_carport';
  return fallsAlongLength ? slope : slope / 2;
}

/**
 * The **largest** bay in the shed, which is the key the frame table is chosen by.
 *
 * ## Why the maximum, and not the average
 *
 * The desktop passes `sD.BayLargest` to `GetMainShedLookupData`
 * (`ServiceStructureData.cs:382-386`, `ServiceLookupData.cs:33-49`), and that is one of the eleven
 * keys selecting the frame row. On an evenly divided building the average and the maximum agree, so
 * the two are indistinguishable — until a bay is edited. 4 000/4 000/6 000 takes the 6 000 row,
 * because the widest span between columns is what the member has to carry.
 *
 * This used to be `Math.ceil(length / bays)`, which is the average rounded **up**: for
 * 4 000/4 000/6 000 that is 4 667, so the frame was chosen for a bay shorter than the longest one in
 * the building. With editable bays that is an under-sized frame; before them the two answers differed
 * only by the rounding.
 */
function maxBay(shed: ShedConfig): number {
  return Math.max(...bayWidthsFor(shed));
}

/**
 * The wind code the span table is keyed by.
 *
 * ## What this used to do, and why it was wrong
 *
 * It concatenated the stored region with `Math.floor(terrain)`. That is only sound when the stored
 * region is a **bare letter**. ShedSafe does not answer with a bare letter: across the 47 real
 * buildings in the legacy database it returned `A1`, `A2`, `A5`, `B1`. Concatenation then produced
 * `"A52"`, which matched nothing, so the frame fell back to a mocked section on real certificates.
 *
 * ## What it does now
 *
 * `windRegionCode` decides. A specific code the certificate already carries (`A5`) is used **as it
 * is**, because that is what the book is indexed by — and the codes are not interchangeable: on the
 * reference book `A2` gives purlin_span 720, `A5` gives 830, `A6` gives 1 300. A bare letter is
 * combined with the desktop's terrain digit. Anything else is returned unchanged and misses, which
 * the caller turns into a labelled assumption rather than a substitute price.
 *
 * The book's own codes are passed in so `A` on a book that lists only `A` stays `A`, while the same
 * `A` on a book with `A2` rows becomes `A2`.
 */
function windCode(shed: ShedConfig, bookCodes?: readonly string[]): string {
  return windRegionCode(shed.windRegion, shed.terrainCategory ?? 2.5, bookCodes);
}

/**
 * Choose the purlin and girt material and row counts for `shed`.
 *
 * When the price book has no span rows for this wind code and bay length, the
 * result is marked `mocked` with a minimum frame: the BOM can still be produced,
 * and the quote is marked incomplete rather than silently priced as if it had a
 * real frame.
 */
export function optimise(
  shed: ShedConfig,
  lookup: PriceLookup,
  rules: BomRules = DEFAULT_BOM_RULES,
): OptimisedFrame {
  const roofSpan = roofSpanFor(shed);
  const bayStandard = standardBayLength(maxBay(shed));
  const openDesign = true;

  // Whether the book can name a section per member at all. Asked once here
  // because this is the step that knows the building's dimensions, and every
  // group downstream needs the answer to decide what it may assume. The query is
  // built by `frameScheduleQuery` so the frame group asks exactly the same
  // question — two roundings of the same span would let the quote claim no
  // assumption while the frame was priced from a fallback.
  const structureCode = safeCall(() => lookup.structureId(subCodeFor(shed.structureType)));
  const scheduleMissing =
    structureCode === undefined ||
    safeCall(() => lookup.frameSchedule(frameScheduleQuery(shed, bayStandard, structureCode))) ===
      undefined;

  // A partial book — a dump without the span table — must fall through to the
  // mocked frame, not throw: the quote can still be produced and marked
  // incomplete, which is far more useful than a crash on a demo.
  const rows = safeCall(() => lookup.devided(windCode(shed, safeCall(() => lookup.windCodes?.())), bayStandard, openDesign)) ?? [];
  if (rows.length === 0) {
    return {
      purlinMaterial: 'MOCK',
      purlinRows: rules.minRows,
      purlinInternalSpan: 0,
      purlinEndSpan: 0,
      girtMaterial: 'MOCK',
      girtMaterialSeparate: false,
      girtRows: rules.minRows,
      girtInternalSpan: 0,
      girtEndSpan: 0,
      roofSpan,
      bayStandard,
      mocked: true,
      scheduleMissing,
    };
  }

  const baySize = maxBay(shed);
  let best: OptimisedFrame | null = null;

  // The sheeting's own structural spans cap the purlin spacing: a roof sheet that
  // spans 900 mm cannot be supported at 1490 mm. The desktop does the same
  // (`Math.Min(dlookup.PurlinSpan, roof.InternalSpan)`), and the lookup has been
  // carrying these spans unused.
  const roofRow = safeCall(() => lookup.sheeting('Corro', 0.42));
  const roofCap = roofRow !== undefined && roofRow.roofInternalSpanMm > 0
    ? roofRow.roofInternalSpanMm
    : Number.POSITIVE_INFINITY;
  const wallCap = roofRow !== undefined && roofRow.wallInternalSpanMm > 0
    ? roofRow.wallInternalSpanMm
    : Number.POSITIVE_INFINITY;

  for (const row of rows) {
    // The girt material is the book's own when the span table names one, and the
    // purlin's otherwise. The reference book names only the purlin material, so the
    // fallback is the normal case there — which is exactly why the flag travels with
    // the frame and becomes a caveat on the quote instead of staying silent.
    const girtMaterial = row.girtMaterial ?? row.purlinMaterial;
    const girtMaterialSeparate = row.girtMaterial !== undefined;

    const material = safeCall(() => lookup.purlin(row.purlinMaterial));
    const unitCost = material?.unitCost ?? 0;
    const mocked = material === undefined;

    // The span the member actually carries is whichever is smaller: what the
    // table allows, or what the sheet above it allows.
    const purlinSpan = Math.min(row.purlinSpan, roofCap);
    const girtSpan = Math.min(row.girtSpan, wallCap);

    const purlins = purlinRows(roofSpan, purlinSpan, purlinSpan, rules);
    const purlinCost = purlins * unitCost * baySize * shed.bays;

    const girts = girtRows(shed.height, girtSpan, girtSpan, rules);
    const girtCost = girts * unitCost * baySize * shed.bays;

    const total = purlinCost + girtCost;
    if (best === null || total < (best as OptimisedFrame & { cost: number }).cost) {
      best = {
        purlinMaterial: row.purlinMaterial,
        purlinRows: purlins,
        purlinInternalSpan: purlinSpan,
        purlinEndSpan: purlinSpan,
        girtMaterial,
        girtMaterialSeparate,
        girtRows: girts,
        girtInternalSpan: girtSpan,
        girtEndSpan: girtSpan,
        roofSpan,
        bayStandard,
        mocked,
        scheduleMissing,
        // Carried for the comparison only; stripped below.
        ...({ cost: total } as object),
      } as OptimisedFrame;
    }
  }

  const chosen = best as OptimisedFrame & { cost?: number };
  delete chosen.cost;
  return chosen;
}
