/**
 * What each price-book column measures, and how well that is known.
 *
 * The book is a supplier's export, and its column names do not state units:
 * `cost_sheeting.mass` is kilograms per square metre while `cost_frame.mass` is
 * kilograms per metre, and `cost_bolt.mass` is per piece. Reading one as another
 * understates a delivery by a factor of four or overstates it by twenty.
 *
 * So each source that the BOM multiplies by a quantity has an entry here saying
 * what its unit is and whether that reading is **supported** by the data, merely
 * **assumed**, or **missing**. The estimating layer turns an `assumed` entry into
 * an `indicative` quote, so a guess can never quietly become a firm price.
 *
 * A source with no entry returns `missing` rather than a default, because a
 * default is a guess wearing a number.
 */

import type { MaterialEvidence } from '@/lib/estimating/types';
import type { MaterialKind } from '@/lib/bom/materialUnits';

/** The unit contract for one price-book column. */
export interface MaterialUnitContract {
  sourceKey: string;
  priceBasis: MaterialEvidence['priceBasis'];
  massBasis: MaterialEvidence['massBasis'];
  status: MaterialEvidence['status'];
  /** The evidence for the reading, in a sentence. */
  note: string;
}

const CONTRACTS: MaterialUnitContract[] = [
  {
    sourceKey: 'cost_frame.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'A frame row costs and weighs per metre: 5.64 kg for 100 x 100 x 2.0 SHS is 1 m of that section.',
  },
  {
    sourceKey: 'cost_purlin.mass',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'A purlin row costs and weighs per metre: 4.509 kg for Z15019 is 1 m of that section.',
  },
  {
    sourceKey: 'cost_sheeting.mass',
    priceBasis: 'm',
    massBasis: 'sqm',
    status: 'supported',
    note: 'A sheeting row costs per **linear metre** of sheet — the desktop treats it as a LENGTH_MATERIAL and extends Length/1000 x quantity x price (RoofSpec.cs, WallSpec.cs) — and weighs per square metre: 3.26 kg at 0.42 BMT matches 0.42 mm of steel at 7850 kg/m3.',
  },
  {
    sourceKey: 'cost_bracing.mass',
    priceBasis: 'roll',
    massBasis: 'roll',
    status: 'supported',
    note: 'A bracing row costs per roll, and unit_length states the roll: 30 m of 30x1.2mm weighs 10 kg.',
  },
  {
    sourceKey: 'cost_bolt.mass',
    priceBasis: 'pack',
    massBasis: 'ea',
    status: 'assumed',
    note: 'The pack price is stated, but the mass column could be per piece or per pack. 0.125 kg for an M16x40 bolt reads as a piece; nothing in the book says so.',
  },
  {
    sourceKey: 'screws.screws_mass',
    priceBasis: 'pack',
    massBasis: 'ea',
    status: 'assumed',
    note: 'As with bolts: 1.16 kg for a coloured roof screw reads as a piece, not a pack of 100.',
  },
  {
    sourceKey: 'gutter.gutter_price',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Gutter is priced per metre; the mass column is zero in this book, so the line carries no weight.',
  },
  {
    sourceKey: 'flashing.flashing_price',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'supported',
    note: 'Flashing is priced per metre; the mass column is zero in this book, so the line carries no weight.',
  },
  {
    sourceKey: 'downpipe.downpipe_price',
    priceBasis: 'm',
    massBasis: 'm',
    status: 'assumed',
    note: 'Priced per metre, but the stock length and the number of joints are not modelled, so a wall-height run is an assumption.',
  },
  {
    sourceKey: 'material_window.cost',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'supported',
    note: 'A window row is a catalogue item priced and weighed whole.',
  },
  {
    sourceKey: 'skylight.price',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'assumed',
    note: 'No polycarbonate rate is imported, so a skylight is priced as a steel roof sheet.',
  },
  {
    sourceKey: 'misc_option.price',
    priceBasis: 'ea',
    massBasis: 'ea',
    status: 'supported',
    note: 'A misc option states its own unit column; the row is priced whole.',
  },
];

/**
 * The real book's contract for each kind of material.
 *
 * A group asks for a **kind** (`'sheeting'`), not a table and column, so the
 * synthetic book in a test can state a different but equally explicit contract
 * without the group knowing which book it is reading.
 */
export const DEFAULT_CONTRACTS: Record<MaterialKind, MaterialUnitContract> = {
  frame: CONTRACTS[0],
  purlin: CONTRACTS[1],
  sheeting: CONTRACTS[2],
  gutter: CONTRACTS[6],
  flashing: CONTRACTS[7],
  downpipe: CONTRACTS[8],
  fixings: CONTRACTS[4],
  opening: CONTRACTS[9],
  // `option` names `misc_option.price`, a table this build never reads. It stays
  // in the map because `MaterialKind` still has the member, but no BOM group is
  // labelled with it any more — see `kindByGroup` in `bom/build.ts`.
  option: CONTRACTS[11],
  bracket: CONTRACTS[10],
  bracing: CONTRACTS[3],
};

/** The contract for a source, or a `missing` one when nothing is known. */
export function describeMaterial(sourceKey: string): MaterialUnitContract {
  const found = CONTRACTS.find((contract) => contract.sourceKey === sourceKey);
  if (found !== undefined) return found;
  return {
    sourceKey,
    priceBasis: 'ea',
    massBasis: 'unknown',
    status: 'missing',
    note: 'No unit evidence for this source; a quote using it must not read as priced.',
  };
}
