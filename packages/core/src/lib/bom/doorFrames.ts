/**
 * The steel frame around a roller door: two posts and a beam.
 *
 * ## Why this exists
 *
 * A roller door is a hole in a wall, and a hole needs a frame — two **mullion posts** at
 * the jambs and a **header** across the top, carrying the wall above the opening. The
 * price book states both sections in the same structure row as C1/R1 (`DM` and `DH`).
 *
 * This build priced neither. It emitted an assumption saying mullions were included in
 * the door's catalogue price, which is not true: the roller door row in `roller_door` is
 * the curtain and its drum, and the steel that frames the opening is separate. So a shed
 * with a 3.6 m roller door was quoted **without its header**, which is a beam somebody has
 * to buy.
 *
 * ## What is ported, and from where
 *
 * | Function | Desktop |
 * |---|---|
 * | `rollerDoorColumnCount` | `checkRDoorColumnQuantity` (`BOMQuoteUtil.cs:766`) |
 * | `headerLengthMm` | `computeLengthRDoorHeaderBetween2Infill` (`OptionQuote.cs:305`) and the plain branch at `:444` |
 * | `mullionLengthMm` | `computeLengthRDoorColumn_INFILL` (`OptionQuote.cs:312`) and the plain branch |
 * | `dropperRequired` | `OptionQuote.cs:388` — a door 5.1 m or wider takes a 1 m `C15012` drop |
 *
 * ## The three door styles
 *
 * `series` on the opening is the desktop's `Style`, and it changes two numbers:
 *
 * | Series | Header beams | Post length over the door |
 * |---|---|---|
 * | `A` | 1 | head + 150 |
 * | `AA` | **2** | head + 150 |
 * | `B` | 1 | head + **290** |
 *
 * A style-B roller has a deeper drum, so its posts run higher above the opening before the
 * header lands. Getting this wrong makes the header sit 140 mm low, which is a door that
 * does not open.
 *
 * ## What this is not
 *
 * It is the **steel only**. Bolts, bearing plates, screws and flashing around the opening
 * are still assumed into the door price, and `DOOR_ACCESSORIES_ASSUMED` still says so —
 * with the word "mullions" removed, because that part is now real.
 *
 * Pure TypeScript: no DB, no HTTP, no React.
 */

import type { Opening, ShedConfig } from '@/domain/types';

/** Which of the frame members this describes. */
export type DoorFrameItem = 'door_header' | 'door_column' | 'door_dropper';

/** One run of steel around a door opening. */
export interface DoorFrameMember {
  item: DoorFrameItem;
  /** The desktop's label, so a workshop sheet reads the same. */
  label: string;
  /** The section from the book's `DH`/`DM` columns. */
  section: string;
  /** Cut length, mm. A zero-length member is not emitted. */
  lengthMm: number;
  /** How many of this member the opening takes. */
  quantity: number;
  /** The opening it frames, so the UI can group them. */
  openingId: string;
}

/** The parts of the design these formulas read. */
export interface DoorFrameGeometry {
  /** The book's `DH`, the header's section. `null` when the book names none. */
  headerSection: string | null;
  /** The book's `DM`, the mullion post's section. */
  mullionSection: string | null;
  /** The door mullion's depth, mm — used to shorten the header's span. */
  mullionDepth: number | null;
  /** The end-wall column's depth, mm. */
  endColumnDepth: number | null;
  /** The girt depth, mm — the other thing the setback is built from. */
  girtDepth: number | null;
  /** The punch centre for the end column's web, mm. */
  centreMm: number;
  /** The knee-edge hole offset for this pitch, mm. */
  kneeEdgeCode: number | null;
  /** The end-wall rafter's depth, mm — the post stops under it. */
  endRafterDepth: number | null;
  /** The footing allowance, mm, added when the post is cast into the ground. */
  footingAllowanceMm: number;
  /** True when the posts are cast in the ground and take the allowance. */
  postInGround: boolean;
}

/** The header sits on the posts; the packer between them, mm. */
const HEADER_PACKER_MM = 10;
/** How far a post runs past the door head before the header lands, by series. */
const POST_ABOVE_DOOR: Record<string, number> = { A: 150, AA: 150, B: 290 };
/** A door at or above this width takes a dropper, mm. */
const DROPPER_FROM_WIDTH_MM = 5100;
/** The dropper's length, mm — the desktop's fixed 1 m of `C15012`. */
const DROPPER_LENGTH_MM = 1000;
/** The section a dropper is cut from. The desktop hard-codes it. */
const DROPPER_SECTION = 'C15012';

/** The curtain allowance the desktop takes off a door's clear width, mm. */
function curtainMm(series: Opening['series']): number {
  return series === 'A' ? 50 : 100;
}

/** How far a post stands off the jamb before the header spans, mm. */
function postAboveDoor(series: Opening['series']): number {
  return POST_ABOVE_DOOR[series ?? 'B'] ?? POST_ABOVE_DOOR.B!;
}

/**
 * The setback that keeps the posts clear of the corner columns, mm.
 *
 * The desktop's `infillDecreamentDevided`: `(2 × girtDepth + columnDepth − centre) / 2`,
 * truncated. It is the same number `infill.ts` uses, and the two are stated separately
 * because a door frame and an infill column can sit on different walls of the same
 * building with different sections.
 */
export function doorFrameSetback(geometry: DoorFrameGeometry): number {
  const girt = geometry.girtDepth ?? 0;
  const column = geometry.endColumnDepth ?? 0;
  return Math.trunc((2 * girt + column - geometry.centreMm) / 2);
}

/**
 * How many mullion posts the opening takes: 0, 1 or 2.
 *
 * The desktop's `checkRDoorColumnQuantity`. Its three answers are worth stating because
 * none of them is obvious:
 *
 * - **0** — one door, centred between equal gaps, with exactly 215 + half a curtain of
 *   wall either side. The jamb columns of the building already stand where the posts
 *   would, so the door needs none.
 * - **1** — a pair of doors whose gap lands on 150 − half a curtain: one shared post
 *   between them serves as both.
 * - **2** — everything else, which is the ordinary case.
 *
 * The desktop also returns 0 for a pair of exactly-halved doors on a building under
 * 6 m, which needs the two-door division rule (`rollerDoorDevided`) this build does not
 * port; see `mullionCount` below for what happens instead.
 */
export function rollerDoorColumnCount(
  shed: ShedConfig,
  opening: Opening,
  infillPositionsMm: readonly number[],
): number {
  /*
   * The doors on this wall, **including the one being asked about even when it is not in
   * the config yet** — a preview, or an add-mode ghost, passes an opening that has no
   * place in `shed.openings` and the count must still describe the wall it would join.
   */
  const onWall = shed.openings.filter(
    (other) => other.wall === opening.wall && other.type === 'roller_door',
  );
  const doors = onWall.some((other) => other.id === opening.id) ? onWall : [...onWall, opening];

  if (doors.length === 1) {
    const curtain = curtainMm(opening.series);
    const left = openingOffset(shed, opening);
    const right = shed.span - (left + opening.width);
    // Symmetric on the wall and standing 215 mm plus half a curtain in: the corner
    // columns are already the posts.
    return left === right && left + curtain / 2 === 215 ? 0 : 2;
  }

  if (doors.length === 2) {
    // The desktop compares the two doors' widths against the halved span and needs
    // `rollerDoorDevided` for the rest. Without that rule the safe answer is two posts
    // per door — an over-count of one post, never an under-count, so the quote carries
    // the steel rather than omitting it.
    return 2;
  }

  // More than two doors on one wall: each takes its own pair.
  return 2;
}

/**
 * The header's length, mm.
 *
 * `computeLengthRDoorHeaderBetween2Infill` is the general answer: the distance from the
 * infill column **before** the door to the one **after** it, plus 45 mm when the far
 * column is the first or last of the run, because the header laps the corner. When no
 * infill column exists — a narrow gable — the desktop uses the door's own clear width
 * instead, and so does this.
 */
export function headerLengthMm(
  shed: ShedConfig,
  opening: Opening,
  infillPositionsMm: readonly number[],
): number {
  const curtain = curtainMm(opening.series);
  const left = openingOffset(shed, opening);
  const right = left + opening.width;

  // The first column at or past the door's far edge, and the last one before its near edge.
  const afterIndex = infillPositionsMm.findIndex((position) => position >= right);
  const beforeIndex = afterIndex === -1 ? -1 : afterIndex - 1;

  if (afterIndex === -1 || beforeIndex === -1) {
    // No spanning pair: the header covers the clear opening, minus the curtain.
    return Math.max(0, opening.width - curtain);
  }

  const after = infillPositionsMm[afterIndex]!;
  const before = infillPositionsMm[beforeIndex]!;
  // The desktop laps the header 45 mm when the far column is the run's first or last.
  const lap = afterIndex === 1 || afterIndex === infillPositionsMm.length - 1 ? 45 : 0;
  return Math.max(0, after - before + lap);
}

/**
 * A mullion post's length, mm.
 *
 * Two shapes, and the desktop picks by whether the post lands under an infill column:
 *
 * - **Under a column** (`computeLengthRDoorColumn_INFILL`): the post runs from the footing
 *   up the pitch to meet the roof, shortened by the rafter's half-depth over the cosine of
 *   the pitch. It is a rafter-side member, so the further from the ridge the shorter.
 * - **Free-standing**: the door's own height plus the packer above it and the footing. It
 *   stops at the header, which the header's own length then bridges.
 */
export function mullionLengthMm(
  shed: ShedConfig,
  opening: Opening,
  geometry: DoorFrameGeometry,
  infillPositionsMm: readonly number[],
): number {
  const summary = mullionSummary(shed, opening, geometry, infillPositionsMm);
  return summary.lengthMm ?? 0;
}

/** Which branch the post took, so the caller can say why it is that length. */
export interface MullionSummary {
  lengthMm: number | null;
  /** `infill` when the post runs to the roof, `door` when it stops at the header. */
  branch: 'infill' | 'door';
}

function mullionSummary(
  shed: ShedConfig,
  opening: Opening,
  geometry: DoorFrameGeometry,
  infillPositionsMm: readonly number[],
): MullionSummary {
  const curtain = curtainMm(opening.series);
  const left = openingOffset(shed, opening);
  const right = left + opening.width;

  // A post standing where an infill column is: it goes up to the roof.
  const onColumn = infillPositionsMm.some(
    (position) => position > left - curtain && position < right + curtain,
  );

  if (!onColumn) {
    const footing = geometry.postInGround ? geometry.footingAllowanceMm : 0;
    return { lengthMm: opening.height + postAboveDoor(opening.series) + footing, branch: 'door' };
  }

  const setback = doorFrameSetback(geometry);
  const kneeEdge = geometry.kneeEdgeCode ?? 0;
  const footing = geometry.postInGround ? geometry.footingAllowanceMm : 0;
  // The post's distance from the nearer corner: the roof rises toward the ridge, so a post
  // further out is shorter.
  const nearer = Math.min(left + curtain / 2, shed.span - (left + curtain / 2));
  const pitchRad = (shed.roofPitchDeg * Math.PI) / 180;
  const mullionDepth = geometry.mullionDepth ?? 0;
  const rafterDrop =
    ((geometry.endRafterDepth ?? 0) + geometry.centreMm) / 2 / Math.cos(pitchRad);

  const length =
    shed.height -
    kneeEdge +
    (nearer - setback - mullionDepth) * Math.tan(pitchRad) +
    footing -
    rafterDrop -
    HEADER_PACKER_MM;

  return { lengthMm: Math.max(0, Math.round(length)), branch: 'infill' };
}

/**
 * The steel a roller door adds to the frame.
 *
 * One header (two for a style-AA door), one or two posts, and a dropper on a wide door.
 * Empty when the book names no header or mullion section — a design with no roller door
 * frame cannot be described, and inventing a section would price steel nobody sells.
 */
export function buildDoorFrameMembers(
  shed: ShedConfig,
  geometry: DoorFrameGeometry,
  infillPositionsMm: readonly number[],
): DoorFrameMember[] {
  const header = geometry.headerSection;
  const mullion = geometry.mullionSection;
  if (header === null || mullion === null) return [];

  const members: DoorFrameMember[] = [];

  for (const opening of shed.openings) {
    if (opening.type !== 'roller_door') continue;

    const headerLength = headerLengthMm(shed, opening, infillPositionsMm);
    if (headerLength > 0) {
      members.push({
        item: 'door_header',
        label: 'Roller door header',
        section: header,
        // The desktop cuts the header 10 mm short of its span so it drops between the posts.
        lengthMm: Math.max(0, headerLength - HEADER_PACKER_MM),
        quantity: opening.series === 'AA' ? 2 : 1,
        openingId: opening.id,
      });
    }

    const count = rollerDoorColumnCount(shed, opening, infillPositionsMm);
    if (count > 0) {
      const mullionLength = mullionLengthMm(shed, opening, geometry, infillPositionsMm);
      if (mullionLength > 0) {
        members.push({
          item: 'door_column',
          label: 'Roller door column',
          section: mullion,
          lengthMm: mullionLength,
          quantity: count,
          openingId: opening.id,
        });
      }
    }

    if (opening.width >= DROPPER_FROM_WIDTH_MM) {
      members.push({
        item: 'door_dropper',
        label: 'Roller door dropper',
        section: DROPPER_SECTION,
        lengthMm: DROPPER_LENGTH_MM,
        quantity: 1,
        openingId: opening.id,
      });
    }
  }

  return members;
}

/**
 * Where an opening starts along its wall, mm from the left corner seen from outside.
 *
 * Restated here for the same reason `infill.ts` restates it: this module is called from the
 * BOM, which runs without a plan.
 */
function openingOffset(shed: ShedConfig, opening: Opening): number {
  const run = shed.span;
  const max = Math.max(0, run - opening.width);
  switch (opening.align) {
    case 'left':
      return 0;
    case 'right':
      return max;
    case 'custom':
      return Math.min(Math.max(opening.offset ?? 0, 0), max);
    case 'center':
    default:
      return max / 2;
  }
}
