/**
 * The Guest page's "Design check": what a person should know about this design before it is sent.
 *
 * ## Why this is rules and not a model (Q7)
 *
 * The customer asked for "AI assessment". Half of that is a **model** (the assistant, slice G-g S10)
 * and half is a **rule set** that must be right every time, even with the assistant switched off:
 * is the design inside what the book prices, is a door jammed against a corner, is this a cyclonic
 * region. A model is the wrong tool for those: it can be unavailable, it can be talked out of an
 * answer, and it would have to be paid for on every keystroke. So the check is arithmetic over the
 * same numbers the quote is built from, and the assistant only *talks about* its findings.
 *
 * ## What it will not do
 *
 * - **No price.** A guest never sees one (D-T3). The check says "an estimator will confirm", never
 *   "this costs more".
 * - **No new engineering rules.** Every item below is a fact the price book states, a limit this
 *   module already enforces, or a flag `guestReviewFlags` already raises. Nothing is invented here;
 *   where the answer is an engineer's (a footing, bracing), the item says so.
 *
 * Pure TypeScript: no React, Next.js, database or HTTP.
 */

import {
  BOOK_BAY_MM,
  BOOK_HEIGHT_MM,
  BOOK_MAX_BAY_MM,
  BOOK_MIN_SKILLION_PITCH_DEG,
  BOOK_SPAN_MM,
  guestReviewFlags,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
  type GuestSiteEstimate,
} from './guest';
import { WIND_REGION_EXTENT } from './windRegionData';

/** How the page should present an item. `review` is the only one that asks for a decision. */
export type AssessmentLevel = 'ok' | 'note' | 'review';

export interface AssessmentItem {
  level: AssessmentLevel;
  title: string;
  detail: string;
  /**
   * Where to send a person who taps the item, as a CSS selector on the Guest page.
   *
   * Omitted when there is nothing to change — "this is a cyclonic region" is information, not a
   * control.
   */
  focus?: string;
}

/**
 * Every finding for `design`, in the order the page shows them: what is wrong first (`review`), then
 * what is worth knowing (`note`), then the confirmations (`ok`).
 *
 * `estimate` comes from the address (Q3) and may be `null` — an enquiry type, or an address that
 * could not be placed. Its absence removes the wind item rather than guessing a region.
 */
export function assessGuestDesign(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
  estimate: GuestSiteEstimate | null,
): AssessmentItem[] {
  if (type.config.mode === 'enquiry') {
    return [
      {
        level: 'note',
        title: 'Nothing to check yet',
        detail: 'A Class 1 House is quoted by a person, not designed here. Send your details and we will be in touch.',
      },
    ];
  }

  const items: AssessmentItem[] = [];
  const { building } = design;
  const flags = guestReviewFlags(design, type);
  const bays = building.bayWidths;

  // ---------------------------------------------------------------- reviews

  if (flags.includes('pitch')) {
    items.push({
      level: 'review',
      title: `The ${building.pitchDeg}° roof is below the book's minimum`,
      detail: `The price book states ${BOOK_MIN_SKILLION_PITCH_DEG}° as the lowest skillion pitch. An estimator will confirm a ${building.pitchDeg}° roof before it is quoted.`,
      // The pitch chips, not the roof switch: the roof is already the one the guest wants.
      focus: '#g-pitch input:checked',
    });
  }

  const wideBay = bays.findIndex((w) => w > BOOK_MAX_BAY_MM);
  if (wideBay !== -1) {
    items.push({
      level: 'review',
      title: `Bay ${wideBay + 1} is wider than the book prices`,
      detail: `The book prices bays up to ${metres(BOOK_MAX_BAY_MM)}. Bay ${wideBay + 1} is ${metres(bays[wideBay]!)}; an estimator will confirm the frame.`,
      focus: `#g-bay-${wideBay}`,
    });
  }

  if (building.span > BOOK_SPAN_MM.max) {
    items.push({
      level: 'review',
      title: 'The width is beyond the book',
      detail: `The book states widths up to ${metres(BOOK_SPAN_MM.max)}. An estimator will confirm this span.`,
      focus: '#g-span',
    });
  }

  if (building.slab === 'footing_only') {
    items.push({
      level: 'review',
      title: 'Footing Only needs the estimator',
      detail:
        'The book sells In Slab and On Slab. Footing Only is recorded for the estimator, who decides the footing on your quote.',
      focus: '#g-slab input:checked',
    });
  }

  /*
   * Positional problems (overlapping, running off the wall) are `validateGuestDesign`'s sentence and
   * the page already shows them next to the door. What is *not* an error is an opening sitting hard
   * against a corner: it needs a frame post there, which is a note for the estimator.
   */
  const tight = openingsNearCorners(design);
  if (tight.length > 0) {
    items.push({
      level: 'note',
      title: tight.length === 1 ? 'One opening is close to a corner' : `${tight.length} openings are close to a corner`,
      detail: 'A door or window hard against a corner needs a frame post there. The estimator will confirm it fits.',
      focus: '#g-group-doors',
    });
  }

  // ---------------------------------------------------------------- notes

  if (building.kneeBrace === 'none_if_possible') {
    items.push({
      level: 'note',
      title: 'You asked to avoid knee bracing',
      detail: `Engineering may still require bracing at this span and height (${metres(building.span)} wide, ${metres(building.height)} high). It is recorded as your preference.`,
      focus: '#g-knee input:checked',
    });
  }

  if (type.config.enclosure === 'roof_only') {
    items.push({
      level: 'ok',
      title: 'Open-sided building',
      detail: 'A carport is Roof Only, so its frame is designed for an open building with no walls.',
    });
  }

  if (estimate !== null && (estimate.region === 'C' || estimate.region === 'D')) {
    items.push({
      level: 'note',
      title: `Cyclonic region (${estimate.region})`,
      detail:
        'A cyclonic-rated frame will be quoted for this address. That is a different structure from the one the book prices for the rest of Australia, and the estimator selects it.',
    });
  }

  // ---------------------------------------------------------------- confirmations

  if (insideBook(building.span, BOOK_SPAN_MM) && insideBook(building.height, BOOK_HEIGHT_MM)) {
    items.push({
      level: 'ok',
      title: 'Size is inside the book',
      detail: `Width ${metres(building.span)} and height ${metres(building.height)} are within what the book prices.`,
    });
  }
  if (bays.every((w) => insideBook(w, BOOK_BAY_MM))) {
    items.push({ level: 'ok', title: 'Bays are inside the book', detail: 'Every bay is between 1.00 m and 4.00 m.' });
  }

  if (items.length === 0) {
    items.push({
      level: 'ok',
      title: 'Nothing to flag',
      detail: 'This design is inside everything the book states. An estimator still checks it before quoting.',
    });
  }

  return items;
}

function insideBook(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

function metres(mm: number): string {
  return `${Number((mm / 1000).toFixed(2))} m`;
}

/** Openings closer than this to the end of their wall get a frame post, which is a note not a block. */
const CORNER_PROXIMITY_MM = 150;

/**
 * Openings that sit within {@link CORNER_PROXIMITY_MM} of a wall end.
 *
 * The wall's own length is not known here (it depends on the openings already placed), so this uses
 * the *offset* side — an opening at `offset < 150` is against the left corner. The right corner is
 * covered by `placeOpening`, which refuses an opening that runs past the wall.
 */
function openingsNearCorners(design: GuestDesignInput): number[] {
  return design.openings.flatMap((opening, index) => (opening.offset < CORNER_PROXIMITY_MM ? [index] : []));
}

/** Kept for callers that want to know whether a coordinate is inside the wind-region map at all. */
export { WIND_REGION_EXTENT };
