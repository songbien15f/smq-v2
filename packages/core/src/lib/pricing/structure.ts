/**
 * Which row of the price book a structure type is.
 *
 * The book's margin table (`setting_price_coeffcient`) is keyed by
 * `structure_id`, an integer naming one of the thirteen building families in
 * `structure_type`. This build's `StructureType` is a different vocabulary — it
 * names the *shape* (`gable`, `skillion`, `gable_carport`, …) while the book
 * names the *product line* (`CROSSOVER GABLE - SERIES 4`, `CROSSOVER GABLE -
 * CARPORT SERIES`, …). The two have to meet somewhere, and this is that place.
 *
 * ## Why the sub-code and not the display name
 *
 * The display names are marketing labels that change between book revisions. The
 * `structure_sub_code` column is the stable part — `GB_TH64`, `SB_TH64`, `GC`,
 * `SC`, `GB_AH`, `GB_Z100`, `GB_Z150` — and each names a frame family this build
 * also models. Matching on the sub-code means a renamed product line still finds
 * its margin.
 *
 * ## What the numbers actually are
 *
 * On the book shipped with this build every family is 1.48 **except** two the
 * factory prices differently: `CROSSOVER GABLE - AWARD SERIES` (id 6) and
 * `CROSSOVER GABLE - CARPORT SERIES` (id 8), both 1.69. A gable carport quoted
 * at the gable rate comes out 14% light, which is why the margin is read from the
 * book rather than written into the code.
 */

import type { ShedConfig, StructureType } from '@/domain/types';
import type { FrameScheduleQuery } from './types';

/**
 * The sub-code map moved to `domain/structureCodes.ts`, and is re-exported here.
 *
 * It is a vocabulary bridge between this build's shape names and the book's product lines — no
 * database handle, no file access — but the editor needs it to decide whether a building is
 * non-standard, and this module's barrel reaches `node:fs`, which a browser component cannot import.
 * Keeping one implementation and two entry points is the fix; see the note in `structureCodes.ts`.
 */
export { subCodeFor, MAPPED_STRUCTURES, isNonStandardStructure } from '@/domain/structureCodes';

/** The spans the structure table lists, mm. */
const SPAN_STEPS = [6000, 7500, 9000, 10_500, 12_000, 13_500, 15_000] as const;
/** The wall heights the structure table lists, mm. */
const HEIGHT_STEPS = [2500, 3000, 3500, 3600, 4200, 4800, 6000] as const;

/** The listed value nearest to `value`, preferring the larger on a tie. */
function nearestOf(value: number, steps: readonly number[]): number {
  let best = steps[0];
  let bestDistance = Math.abs(value - best);
  for (const step of steps) {
    const distance = Math.abs(value - step);
    // `<=` prefers the later (larger) step on a tie: an under-sized design is
    // the failure that cannot be built, so the heavier neighbour wins.
    if (distance <= bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The structure table's own key for a building, or `undefined` when the book
 * cannot name the family.
 *
 * **One function, because two callers must agree.** The optimiser asks this to
 * decide whether the quote rests on a fixed section, and the frame group asks it
 * to choose the sections. If the two rounded differently — one on the raw span
 * and one on the nearest listed span — the quote would say "no assumption" while
 * the frame was priced from a fallback, or the reverse. They share this.
 *
 * The table is indexed by **listed** values, not exact ones: a 3.4 m bay is
 * priced from the 3.5 m row and a 3 700 mm wall from the 3 600 mm row. Rounding
 * is what makes the table usable at all; the alternative is no row, which is the
 * state this build was in.
 */
export function frameScheduleQuery(
  shed: ShedConfig,
  bayStandard: number,
  structureCode: number,
): FrameScheduleQuery {
  return {
    structureCode,
    windRegion: shed.windRegion,
    terrainCategory: shed.terrainCategory,
    importanceLevel: shed.importanceLevel,
    internalPressure: shed.internalPressure,
    span: nearestOf(shed.span, SPAN_STEPS),
    bay: bayStandard,
    height: nearestOf(shed.height, HEIGHT_STEPS),
  };
}
