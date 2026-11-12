/**
 * The bracket and flat-fly groups.
 *
 * A bracket is the steel that ties a column to its footing or a purlin to the
 * frame; a flat fly is the plate that ties a rafter or column to the member it
 * crosses. Both are counted per member, so both read the frame's own member
 * counts rather than recomputing them.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop builds
 * a bracket's name by concatenating the prefix with the column's web depth and
 * gives up when the book has no exact match. The book's names are irregular
 * (`BP65A`, `ABP65`, `EPHB15-TH64`), so an exact concatenation misses rows that
 * exist. Here the bracket is chosen as the smallest row of the prefix that will
 * take the web — a bracket that is slightly too large is what a factory supplies;
 * an undersized one cannot be fitted at all.
 */

import type { ShedConfig, DimensionedShed } from '@/domain/types';
import type { PriceLookup, PriceRow } from '@/lib/pricing/types';
import { bomLine, mockedLine, type BomLine } from '../types';
import type { OptimisedFrame } from '../types';
import { frameCounts } from './frame';
import { safeCall } from '../safe';
import { isOpenStructure } from './sheeting';
import type { BomRules } from '../rules';

/** The bracket families the frame uses. */
const MAIN_BASE_PREFIX = 'BP';
const EAVE_PREFIX = 'EPHB';
/** The knee brace connector pair, by book name. */
const KNEE_CONNECTOR = 'KBC20-7.5L';
const KNEE_RIDGE_CONNECTOR = 'KBR20-7.5L';
/** A carry beam removes one eave bracket per bay line it spans. */
const WEB_FALLBACK = 64;

/**
 * An each line, or a mocked one when the book has no row.
 *
 * `unitCost` is the per-piece price. A bracket is sold singly, so unlike a
 * fixing there is no pack to round to.
 */
function eachLine(
  group: 'bracket' | 'flatfly',
  description: string,
  count: number,
  row: PriceRow | undefined,
): BomLine[] {
  if (count <= 0) return [];
  if (row === undefined) {
    return [mockedLine({ group, description, unit: 'ea', quantity: count })];
  }
  return [
    bomLine({
      group,
      code: row.code,
      description: `${description} — ${row.description}`,
      unit: 'ea',
      quantity: count,
      unitCost: row.unitCost,
      massKg: row.massKg * count,
    }),
  ];
}

/**
 * The purlin's web depth, which selects the bracket size.
 *
 * `cost_purlin.depth` states it (Z150 → 150, TH64075 → 64). The fallback keeps a
 * book without that column producing a bracket at all rather than none.
 *
 * **Deviation from the desktop (recorded at `/deviations`):** the desktop sizes a
 * flat fly from the *frame section's* web, which it reads from `cost_frame.web`.
 * This build's frame is a fixed `100 × 100 SHS` (web 100), and the book's flat-fly
 * ladder stops at 40, so no rung fits. The lookup returns the largest rung there
 * is and the line is priced; the desktop would emit no line at all. The operator
 * sees a fitting sized for the smallest frame the book carries, which is a number
 * to confirm rather than a number to trust.
 */
function webDepth(frame: OptimisedFrame, lookup: PriceLookup): number {
  const depth = safeCall(() => lookup.purlinDepth(frame.purlinMaterial)) ?? 0;
  return depth > 0 ? depth : WEB_FALLBACK;
}

/** Carry beams on the two long walls, each of which removes an eave bracket. */
function carryBeamCount(shed: DimensionedShed): number {
  return shed.options.filter(
    (option) => option.kind === 'carry_beam' && (option.wall === 'front' || option.wall === 'back'),
  ).length;
}

/**
 * The bracket lines.
 *
 * Three sets: a base plate under every column, an eave purlin bracket at every
 * grid line on both long walls, and the knee brace connectors at every portal
 * frame's two knees.
 */
export function bracketLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  // Brackets are counted per member and sized from the purlin's web; no factory
  // rule applies, so the parameter exists only so every group takes the same
  // shape. Keeping the signature uniform is what lets `buildBom` pass the rule
  // set to all of them without a table of exceptions.
  _rules?: BomRules,
): BomLine[] {
  const counts = frameCounts(shed);
  const web = webDepth(frame, lookup);

  const baseBracket = safeCall(() => lookup.bracket(MAIN_BASE_PREFIX, web));
  const eaveBracket = safeCall(() => lookup.bracketForPurlin(EAVE_PREFIX, frame.purlinMaterial));
  const kneeBracket = safeCall(() => lookup.bracketExact(KNEE_CONNECTOR));
  const kneeRidge = safeCall(() => lookup.bracketExact(KNEE_RIDGE_CONNECTOR));

  // `(bays + 1)` grid lines, two long walls, less one per carry beam. A carport
  // has an eave beam at every column instead of a wall, so the count is the same.
  const eaveCount = Math.max(0, (shed.bays + 1) * 2 - carryBeamCount(shed));
  // One connector of each kind per knee, and one knee at each end of every main
  // portal frame's rafter — so two knees per portal, not four. `counts.main`
  // already counts both columns of a portal, so multiplying by two again ordered
  // double the connectors.
  const kneeCount = counts.main;

  return [
    ...eachLine('bracket', 'Base plate bracket', counts.main + counts.end, baseBracket),
    ...eachLine('bracket', 'Eave purlin bracket', eaveCount, eaveBracket),
    ...eachLine('bracket', 'Knee brace connector, left', kneeCount, kneeBracket),
    ...eachLine('bracket', 'Knee brace connector, ridge', kneeCount, kneeRidge),
  ];
}

/**
 * How many flat flies a rafter needs for a given purlin row count.
 *
 * From the desktop's own table: a rafter crossing one or two rows needs one fly,
 * three to five needs two, and the count keeps stepping up. The plate ties the
 * rafter to each row it crosses, so the count follows the rows.
 */
export function fliesForRafter(purlinRows: number): number {
  if (purlinRows <= 2) return 1;
  if (purlinRows <= 5) return 2;
  if (purlinRows <= 7) return 3;
  if (purlinRows === 8) return 4;
  return 5;
}

/** How many flat flies a column needs for a given girt row count. */
export function fliesForColumn(girtRows: number): number {
  return girtRows <= 3 ? 1 : 2;
}

/**
 * The flat fly lines: one set on the rafters, one on the columns.
 *
 * The rafter fly is counted per rafter, so the rafter count comes from the frame
 * counts. The column fly is counted per column, and an end-wall column takes a
 * different plate (`HFB`) from a main column (`PFB`), because the end column is
 * a different section.
 */
export function flatFlyLines(
  shed: DimensionedShed,
  frame: OptimisedFrame,
  lookup: PriceLookup,
  _rules?: BomRules,
): BomLine[] {
  const counts = frameCounts(shed);
  const web = webDepth(frame, lookup);

  // A Z purlin takes the `ZFFB` plate, a TopHat takes `FFB`; they are different
  // fittings, not different sizes of one.
  const flyFamily = frame.purlinMaterial.startsWith('Z') ? 'ZFFB' : 'FFB';
  const rafterFly = safeCall(() => lookup.bracketForPurlin(flyFamily, frame.purlinMaterial));
  // The column fly is the `HFB` family, named for the girt it fits.
  const columnFly = safeCall(() => lookup.bracketForPurlin('HFB', frame.girtMaterial));

  const perRafter = fliesForRafter(frame.purlinRows);
  const perColumn = fliesForColumn(frame.girtRows);

  return [
    ...eachLine('flatfly', 'Flat fly, rafter', perRafter * counts.main, rafterFly),
    ...eachLine('flatfly', 'Flat fly, main column', perColumn * counts.main, columnFly),
    ...eachLine('flatfly', 'Flat fly, end column', perColumn * counts.end, columnFly),
  ];
}
