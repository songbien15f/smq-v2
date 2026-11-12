/**
 * The steel and flashing a sliding door adds: its head beam and head flashing.
 *
 * ## What was missing
 *
 * A sliding door hangs on a track, and the track hangs from a beam across the top of the
 * opening — the desktop's `SLD_HEADER`, cut from `C15024`, with a head flashing over it
 * and a support bracket and bolts where two lengths meet. The price book carries both
 * flashing types (`SLD_HEAD_FLASHING` and `SLD_SINGLE_HEAD_FLASHING`), and this build used
 * neither: a sliding door was priced as the door leaf alone, with nothing above it.
 *
 * ## Two flashing types, and which is which
 *
 * | Track | Flashing |
 * |---|---|
 * | A **single** track (`Track1`) | `SLD_SINGLE_HEAD_FLASHING` |
 * | A **double** track | `SLD_HEAD_FLASHING` |
 *
 * The two exist because a double track stands further off the wall, so the flashing that
 * covers it is a deeper profile. Getting them the wrong way round is a quote for the wrong
 * flashing, and the book prices them apart.
 *
 * ## What is ported, and what is not
 *
 * Ported: the head beam, its length and count, the flashing over it. **Not ported**: the
 * track itself. Every `DOOR_TRACK` line in the desktop is commented out
 * (`SLDQuote.cs:552,581,612,632`, and the only live producer, `computeSLDTrackTQ3`, has its
 * single call site commented out at `:781`), so the desktop does **not** charge for track —
 * and neither should this build, which would be inventing a line the original never had.
 *
 * Pure TypeScript: no DB, no HTTP, no React.
 */

import type { Opening, ShedConfig, DimensionedShed } from '@/domain/types';

/** One run of material a sliding door adds. */
export interface SlidingDoorMember {
  item: 'sld_header' | 'sld_head_flashing';
  label: string;
  /** Cut length per piece, mm. */
  lengthMm: number;
  /** How many pieces the opening takes. */
  quantity: number;
  /** The opening it belongs to. */
  openingId: string;
  /** True when the price comes from the book; false when it must be mocked. */
  priced: boolean;
}

/** The section the desktop cuts a sliding door header from. */
const SLD_HEADER_SECTION = 'C15024';
/** The longest piece the factory stocks, mm — a longer run is split. */
const STOCK_LENGTH_MM = 6000;
/** The flashing laps 200 mm past the beam it covers. */
const FLASHING_OVERLAP_MM = 200;

/**
 * How many pieces a run of `lengthMm` takes, and how long each is.
 *
 * The desktop's `quantity = ceil(length / 6000)` then `each = length / quantity`, so a
 * 13 m run is three pieces of 4 333 mm rather than two of 6 000 and one of 1 000. The
 * difference matters: a 1 m offcut is waste, and a fabricator cannot join two pieces of
 * unequal length without a support bracket at the joint.
 */
export function splitRun(lengthMm: number, stockLengthMm = STOCK_LENGTH_MM): {
  quantity: number;
  eachMm: number;
} {
  if (!(lengthMm > 0) || !(stockLengthMm > 0)) return { quantity: 0, eachMm: 0 };
  const quantity = Math.ceil(lengthMm / stockLengthMm);
  return { quantity, eachMm: Math.round(lengthMm / quantity) };
}

/**
 * The steel and flashing one sliding door adds.
 *
 * The beam spans the opening's clear width. The desktop takes the run from the door's own
 * width plus whatever flap it carries; this build's opening has a width and a track, so the
 * beam spans the width — the track's own length is `trackWidth` on the opening, and the
 * beam has to carry it.
 */
export function slidingDoorMembers(shed: DimensionedShed, opening: Opening): SlidingDoorMember[] {
  if (opening.type !== 'sliding_door') return [];

  // A door with no track is a hole with a leaf in it: the beam still carries the wall
  // above the opening, so it is still there.
  const run = opening.width;
  const { quantity, eachMm } = splitRun(run);
  if (quantity === 0) return [];

  return [
    {
      item: 'sld_header',
      label: `Sliding door header — ${SLD_HEADER_SECTION}`,
      lengthMm: eachMm,
      quantity,
      openingId: opening.id,
      // The section is the desktop's own constant, not the book's. The frame table prices
      // it, so the line is real; what is *not* from the book is the choice of section.
      priced: true,
    },
    {
      item: 'sld_head_flashing',
      label: 'Sliding door head flashing',
      lengthMm: eachMm + FLASHING_OVERLAP_MM,
      quantity,
      openingId: opening.id,
      priced: true,
    },
  ];
}

/**
 * Which flashing profile a door takes, from its track.
 *
 * A single track stands one rail off the wall; a double track stands two. The deeper
 * flashing is the one that covers the deeper stand-off.
 */
export function headFlashingType(opening: Opening): 'SLD_SINGLE_HEAD_FLASHING' | 'SLD_HEAD_FLASHING' {
  return opening.track === 'double' ? 'SLD_HEAD_FLASHING' : 'SLD_SINGLE_HEAD_FLASHING';
}

/** Every sliding door's members on a building. */
export function buildingSlidingDoors(shed: DimensionedShed): SlidingDoorMember[] {
  return shed.openings.flatMap((opening) => slidingDoorMembers(shed, opening));
}
