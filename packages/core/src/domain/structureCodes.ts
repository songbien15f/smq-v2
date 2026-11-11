/**
 * The book's stable name for a structure, by shape.
 *
 * ## Why this lives in `domain/` and not beside the pricing code that reads it
 *
 * It used to be in `lib/pricing/structure.ts`, and the editor imported it from `@sq/core/pricing` to
 * decide whether a building is non-standard. That barrel also exports `publish.ts`, which imports
 * `node:fs` — so a client component importing one pure string map pulled the filesystem into the
 * browser bundle and the editor rendered "Module not found: Can't resolve 'fs'". Measured 2026-11-11:
 * every Step 1 test failed with that overlay.
 *
 * The map is a vocabulary bridge — shape to the book's product line — with no dependency on a price
 * file or a database handle, so it belongs with the other pure domain facts. `lib/pricing/structure.ts`
 * re-exports it, so nothing that reads it there had to change.
 *
 * ## What the codes are, and why not the display names
 *
 * `structure_sub_code` is the stable column. The display names are marketing labels that change
 * between book revisions (`CROSSOVER GABLE - SERIES 4` today, something else next year), and the
 * desktop's habit of matching on them breaks the day a row is renamed. The codes below are what the
 * book states, quoted from `structure_type` on the reference book:
 *
 * | sub-code | product line | `is_nonstandard` | margin |
 * |---|---|---|---|
 * | `GB_TH64` | Crossover Gable — Series 4 | 0 | 1.48 |
 * | `GB_TH96` | Crossover Gable — Series 5 | 0 | 1.48 |
 * | `GB_Z100` | Crossover Gable — Cyclonic Series 4 | 0 | 1.48 |
 * | `GB_Z150` | Crossover Gable — Series 6 | 0 | 1.48 |
 * | `SB_TH64` | Crossover Skillion — Series 4 | 0 | 1.48 |
 * | `GB_AH` | Crossover Aircraft Hangar — Series 6 | 0 | 1.48 |
 * | `GC` | Crossover Gable — Carport Series | 0 | **1.69** |
 * | `SC` | Crossover Skillion — Carport Series | 0 | 1.48 |
 * | `CGB` | Custom Crossover Gable Building | **1** | 1.48 |
 * | `CSB` | Custom Crossover Skillion Building | **1** | 1.48 |
 *
 * Only the two carport/gable families differ in margin, which is why `lib/pricing/structure.ts` reads
 * the multiplier from `setting_price_coeffcient` rather than carrying it here.
 */

import type { StructureType } from './types';

/**
 * The book's `structure_sub_code` for each structure this build models.
 *
 * A structure with no entry has no margin row, and the pricing layer's `margin()` returns its own
 * fallback of 1 — the same answer the book gives for an unlisted combination.
 */
const SUB_CODE: Record<StructureType, string> = {
  // Gable, TH64 frame: `CROSSOVER GABLE - SERIES 4` (structure_id 1, 1.48).
  gable: 'GB_TH64',
  // Skillion, TH64 frame: `CROSSOVER SKILLION - SERIES 4` (structure_id 5, 1.48).
  skillion: 'SB_TH64',
  // The carport series is priced apart from the shed series, and the **gable**
  // carport carries the higher multiplier (id 8, 1.69) while the skillion
  // carport does not (id 9, 1.48). These two are why the multiplier is read from
  // the book rather than written into the code.
  gable_carport: 'GC',
  skillion_carport: 'SC',
  // A TopHat frame is named by its thickness: 64 mm is series 4, 96 mm series 5.
  tophot_64: 'GB_TH64',
  tophot_96: 'GB_TH96',
  // A Zed frame is `CROSSOVER GABLE - SERIES 6`, whose sub-code names Z150.
  zed_shed: 'GB_Z150',
  aircraft_hangar: 'GB_AH',
  // A cyclonic building is its own series, framed in Z100 (id 3, 1.48).
  cyclonic: 'GB_Z100',
  /*
   * The two custom families (ids 10 and 11, `is_nonstandard = 1`, margin 1.48 like every other
   * family). They are here for the **margin** and for the non-standard flag; the book states no
   * frame schedule for either (`structure_lookup_code = 0`), so the frame is priced from an
   * assumption and `optimise.ts` says so through the same path it uses for any structure with no
   * row.
   */
  custom_gable: 'CGB',
  custom_skillion: 'CSB',
};

/** The book's stable sub-code for a structure type. */
export function subCodeFor(structure: StructureType): string {
  return SUB_CODE[structure];
}

/** Every structure this build can name, for a test to enumerate. */
export const MAPPED_STRUCTURES = Object.keys(SUB_CODE) as StructureType[];

/**
 * True when the book flags this structure `is_nonstandard`.
 *
 * Read through the same sub-code the frame and margin lookups use, so the flag cannot disagree with
 * the row it was bought from. A book that has not shipped the flag (or an empty list, which is a book
 * without the table) reports `false`: "not known to be custom" must not silently buy the exemption.
 */
export function isNonStandardStructure(
  structure: StructureType,
  nonStandardSubCodes: readonly string[],
): boolean {
  return nonStandardSubCodes.includes(subCodeFor(structure));
}
