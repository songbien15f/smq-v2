/**
 * The punching detail: where the holes go in each frame member.
 *
 * This is the desktop's `PunchingDetailForm` — the sheet the workshop sets the
 * punch to before a member goes to the welder. For each member it states, in
 * millimetres from each end, where the holes for the knee, the haunch and the
 * apex sit, plus the hole size and the centre to set.
 *
 * ## Where the numbers come from
 *
 * Nothing here is invented. Every offset is read from the price book's own
 * connector tables, the same ones the desktop reads:
 *
 * | What | Book table | Column |
 * |---|---|---|
 * | Eave hole below the top of a column | `kneeedge` | `knee_edge_code` |
 * | Rafter allowance at the knee / apex | `kneeedge` | `haunch` / `apex` |
 * | Apex connector holes | `cost_apex` | `d1`, `d2` |
 * | Haunch connector holes | `cost_haunch` | `d1`, `d2`, `d3` |
 * | Which connector a section takes | `cost_frame` | `web` |
 *
 * The connector is chosen **by web and pitch**: `HP20-10` is the haunch for a
 * 20 mm web at 10°. That is why `FrameMember` carries `web`: without it there is
 * no way to name the right plate, and a sheet that guesses is worse than none.
 *
 * ## The two hole groups
 *
 * The desktop's `createColumn` walks the **top** list downward from the member's
 * far end and the **bottom** list upward from its near end, so a hole's spacing
 * is cumulative and its position is a distance from one specific end. Read the
 * other way round, every haunch connection lands at the base of the column. The
 * `remainingMm` is what is left between the two groups — the run a shear cuts
 * through, and the number a fabricator checks first.
 *
 * Pure TypeScript: no DB, no HTTP, no React.
 */

import type { FrameMember } from './groups/frame';

/** One hole, in the terms the workshop reads. */
export interface PunchHole {
  /** Distance from the member's near end (a bottom hole) or far end (a top hole), mm. */
  positionMm: number;
  /** Distance from the previous hole in the same group, mm. The first is from the end. */
  spacingMm: number;
  /**
   * Which of the three screw lines this hole is punched on.
   *
   * The desktop punches the two outer lines (`[1, 3]`) on a portal member; the
   * middle line is used by the gable-end infill columns.
   */
  screwLines: number[];
}

/** One member as the punching sheet shows it. */
export interface PunchColumn {
  /** `C1`, `R1`, `C2`, `R2`, `M`, `DM`, `DH` — the desktop's mark. */
  mark: string;
  /** The desktop's heading above the member: `Top`, `Eaves`, `Bottom`, `Apex`. */
  titleTop: string;
  titleBottom: string;
  /** The section, e.g. `C20015`. */
  section: string;
  /** How many of this member the building has. */
  quantity: number;
  /** Cut length, mm. */
  lengthMm: number;
  /** The hole size, as the desktop states it. */
  holeSize: string;
  /** The punch centre to set, mm. 60 for a 10 mm web, 90 for anything wider. */
  centreMm: number;
  /** Holes measured from the far end, in the order they are punched. */
  top: PunchHole[];
  /** Holes measured from the near end. */
  bottom: PunchHole[];
  /** The uncut run between the two hole groups, mm. */
  remainingMm: number;
}

/** One sheet: two members, the ones that meet at a connection. */
export interface PunchPage {
  left: PunchColumn | null;
  right: PunchColumn | null;
}

/**
 * The book rows the sheet needs.
 *
 * Passed in as an interface rather than the whole `PriceLookup` so the sheet's
 * decisions can be tested without a database — which is the only way to test a
 * number this specific.
 */
export interface PunchSource {
  kneeEdge(pitchDeg: number): { kneeEdgeCode: number; apex: number; haunch: number } | undefined;
  apex(web: number, pitchDeg: number): { r1: number; r2: number } | undefined;
  haunch(web: number, pitchDeg: number): { e1: number; e2: number; e3: number } | undefined;
}

/** The hole size the desktop prints on every sheet. */
const HOLE_SIZE = '18x22';
/** Screw lines a portal member is punched on. */
const PORTAL_SCREW_LINES = [1, 3];

/**
 * The punch centre for a section, mm.
 *
 * The desktop's `getCenter`: a 10 mm web takes 60, anything wider takes 90. It is
 * a property of the punch tooling, not of the building.
 */
function centreFor(web: number | null): number {
  return web === 10 ? 60 : 90;
}

/**
 * One group of holes, accumulated the way the desktop accumulates it.
 *
 * `from` is `'top'` for a group measured down from the far end and `'bottom'` for
 * one measured up from the near end. A zero or negative offset is **skipped**, not
 * punched at the end: the book writes 0 for "this connection does not exist", and
 * a hole at 0 mm would cut the end off the member.
 */
function holesFor(
  offsets: number[],
  from: 'top' | 'bottom',
  lengthMm: number,
  screwLines: number[] = PORTAL_SCREW_LINES,
): PunchHole[] {
  const holes: PunchHole[] = [];
  let run = 0;
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset <= 0) continue;
    run += offset;
    holes.push({
      positionMm: from === 'top' ? lengthMm - run : run,
      spacingMm: offset,
      screwLines,
    });
  }
  return holes;
}

/** A member by its item name, or `undefined` when the building has none. */
function memberOf(members: FrameMember[], item: FrameMember['item']): FrameMember | undefined {
  return members.find((member) => member.item === item);
}

/**
 * One column of the sheet.
 *
 * `undefined` when the member or its web is unknown: a sheet cannot name a
 * connector for a section the book does not describe.
 */
function punchColumn(
  member: FrameMember | undefined,
  mark: string,
  titleTop: string,
  titleBottom: string,
  topOffsets: number[],
  bottomOffsets: number[],
  screwLines: number[] = PORTAL_SCREW_LINES,
): PunchColumn | undefined {
  if (member === undefined) return undefined;
  const top = holesFor(topOffsets, 'top', member.lengthMm, screwLines);
  const bottom = holesFor(bottomOffsets, 'bottom', member.lengthMm, screwLines);
  const used = [...top, ...bottom].reduce((sum, hole) => sum + hole.spacingMm, 0);
  return {
    mark,
    titleTop,
    titleBottom,
    section: member.section,
    quantity: member.quantity,
    lengthMm: member.lengthMm,
    holeSize: HOLE_SIZE,
    centreMm: centreFor(member.web),
    top,
    bottom,
    remainingMm: Math.max(0, Math.round(member.lengthMm - used)),
  };
}

/**
 * Build the punching sheets for a building.
 *
 * Two sheets, in the desktop's order: the **gable end** first (C2 meets R2) and
 * then the **portal** (C1 meets R1). Empty when the book cannot name the
 * connectors — see `PunchSource` — because a sheet with guessed offsets would be
 * cut and welded, and an empty sheet is sent back for a price book.
 */
export function buildPunchingPages(
  members: FrameMember[],
  source: PunchSource,
  pitchDeg: number,
): PunchPage[] {
  const knee = source.kneeEdge(pitchDeg);
  if (knee === undefined) return [];

  const mainColumn = memberOf(members, 'main_column');
  const mainRafter = memberOf(members, 'main_rafter');
  const endColumn = memberOf(members, 'end_column');
  const endRafter = memberOf(members, 'end_rafter');

  // Without a section to look the connector up by, there is no sheet to draw.
  if (
    mainColumn?.web === null ||
    mainColumn === undefined ||
    mainRafter?.web === null ||
    mainRafter === undefined ||
    endColumn?.web === null ||
    endColumn === undefined ||
    endRafter?.web === null ||
    endRafter === undefined
  ) {
    return [];
  }

  const mainHaunch = source.haunch(mainColumn.web, pitchDeg);
  const mainApex = source.apex(mainRafter.web, pitchDeg);
  const endApex = source.apex(endRafter.web, pitchDeg);

  /*
   * **All three connector rows are required, or there is no sheet.**
   *
   * A missing row means the book does not sell the plate this member bolts to —
   * which is what happens when the section is one this build *assumed* rather than
   * read from the structure table (a 100 × 100 SHS has no `HP100-10`). Printing
   * the sheet anyway would show the knee hole and silently omit the haunch, and a
   * workshop reads "two holes" as the complete instruction: the members come back
   * undrilled at the connection that carries the most load. Withholding the sheet
   * sends somebody to the price book instead.
   */
  if (mainHaunch === undefined || mainApex === undefined || endApex === undefined) return [];

  /*
   * **The end wall takes the internal column's haunch.** This is not an oversight
   * copied by accident: the desktop reads one `haunch` from
   * `basicData.InternalColumn` and uses it for C1 *and* C2
   * (`PunchingDetailForm.cs:100,139`), while the apex is looked up per rafter
   * (`apex1` for R1, `apex2` for R2, lines 105 and 108). The haunch plate spans
   * the knee of the portal, so one plate serves both members it bolts to; the
   * apex is a different plate because R1 and R2 are different sections.
   *
   * So R2 takes its **own** apex offsets and the **portal's** haunch offset.
   * Reading it the other way is how a gable end gets punched with a plate it does
   * not carry.
   */
  const endTop = [knee.kneeEdgeCode, mainHaunch.e1];
  // 45 mm from the bottom on a gable-end column. The desktop uses 40 for an `AW2`
  // structure, which is the price book's *Award Series*; this build has no such
  // structure type, so every building it can express takes 45.
  const endBottomColumn = [45, 60];
  const endTopRafter = [knee.apex, mainHaunch.e1];
  const endBottomRafter = [knee.apex, endApex.r1, endApex.r2];

  const mainTop = [knee.kneeEdgeCode, mainHaunch.e1, mainHaunch.e2, mainHaunch.e3];
  const mainBottomColumn = [40, 60];
  const mainTopRafter = [knee.haunch, mainHaunch.e1, mainHaunch.e2, mainHaunch.e3];
  const mainBottomRafter = [knee.apex, mainApex.r1, mainApex.r2];

  const endPage: PunchPage = {
    left: punchColumn(endColumn, 'C2', 'Top', 'Bottom', endTop, endBottomColumn) ?? null,
    right: punchColumn(endRafter, 'R2', 'Eaves', 'Apex', endTopRafter, endBottomRafter) ?? null,
  };
  const portalPage: PunchPage = {
    left: punchColumn(mainColumn, 'C1', 'Top', 'Bottom', mainTop, mainBottomColumn) ?? null,
    right: punchColumn(mainRafter, 'R1', 'Eaves', 'Apex', mainTopRafter, mainBottomRafter) ?? null,
  };

  const pages: PunchPage[] = [endPage, portalPage];

  /*
   * The infill columns, two to a sheet.
   *
   * The desktop punches them in pairs on one page (`PunchingDetailForm.cs:167-208`),
   * one per side, and the section's **depth** decides which screw line is used: under
   * 145 mm deep is punched on the middle line, at or over it on the outer two. That
   * 145 is the desktop's own threshold and it is a fit question — a plate that goes
   * through the middle of a shallow C clears the flanges, and one that does not has
   * to straddle them.
   *
   * Their holes are two: one near the top and one near the bottom, with the offsets
   * chosen the same way by depth. Every infill column on a symmetric gable is the
   * same member, so one `FrameMember` with a quantity covers them all.
   */
  const infill = memberOf(members, 'infill_column');
  if (infill !== undefined) {
    const deep = (infill.depth ?? 0) >= 145;
    const topOffset = deep ? 100 : 35;
    const bottomOffset = deep ? 100 : 45;
    const screwLines = deep ? PORTAL_SCREW_LINES : [2];
    const sheet = (): PunchColumn | undefined =>
      punchColumn(infill, 'M', 'Top', 'Bottom', [topOffset], [bottomOffset], screwLines);

    for (let index = 0; index < infill.quantity; index += 2) {
      pages.push({
        left: sheet() ?? null,
        right: index + 1 < infill.quantity ? (sheet() ?? null) : null,
      });
    }
  }

  return pages.filter((page) => page.left !== null || page.right !== null);
}
