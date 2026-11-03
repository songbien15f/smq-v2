/**
 * Extending a material quantity into money and mass, from its stated basis.
 *
 * A price book column does not say what it is per. The same number means
 * different things for different materials: `cost_sheeting.cost` is per **linear
 * metre** of sheet (the desktop treats a roof and wall spec as `LENGTH_MATERIAL`
 * and multiplies by `Length/1000`), while `cost_bolt.cost_pack` is per pack and
 * `gutter.gutter_price` is per metre of gutter. Multiplying the wrong quantity by
 * a price is the single easiest way to be wrong by a factor of three and still
 * look plausible.
 *
 * So the basis is an input, taken from the evidence manifest, and never a
 * constant in a group. When the basis needs a dimension the caller did not
 * supply — a length for a per-metre price, a cover for a per-square-metre mass —
 * the result is `null` and the caller emits an issue rather than a zero.
 */

import type { MaterialEvidence } from '@/lib/estimating/types';

/** The kinds of material the BOM extends. */
export type MaterialKind =
  | 'frame'
  | 'purlin'
  | 'sheeting'
  | 'gutter'
  | 'flashing'
  | 'downpipe'
  | 'fixings'
  | 'opening'
  | 'option'
  /** Plate brackets, read from `cost_bracket`. */
  | 'bracket'
  /** Wind bracing rolls, read from `cost_bracing`. */
  | 'bracing';

/** What a material line is measured in. */
export type QuantityBasis = MaterialEvidence['priceBasis'] | 'unknown';

export interface ExtendInput {
  /** How many pieces the geometry produced. */
  count: number;
  /** The cut length of one piece, mm. */
  lengthMm?: number;
  /** The width one piece covers, mm. */
  coverMm?: number;
  /** How many pieces are in one pack. */
  packSize?: number;
  /** The price-book price, in the basis's unit. */
  unitCost: number;
  /** The price-book mass, in the mass basis's unit. */
  massPerUnit: number;
  priceBasis: QuantityBasis;
  massBasis: QuantityBasis;
}

export interface Extended {
  quantity: number;
  unit: 'm' | 'sqm' | 'ea' | 'pack' | 'roll';
  amount: number;
  massKg: number;
}

/** A quantity in the given basis, or `null` when a needed dimension is absent. */
export function quantityInBasis(
  input: Pick<ExtendInput, 'count' | 'lengthMm' | 'coverMm' | 'packSize'>,
  basis: QuantityBasis,
): { quantity: number; unit: Extended['unit'] } | null {
  const { count, lengthMm, coverMm, packSize } = input;
  const lengthM = lengthMm === undefined ? undefined : lengthMm / 1000;
  const coverM = coverMm === undefined ? undefined : coverMm / 1000;

  switch (basis) {
    case 'm':
      if (lengthM === undefined) return null;
      return { quantity: count * lengthM, unit: 'm' };
    case 'sqm':
      if (lengthM === undefined || coverM === undefined) return null;
      return { quantity: count * lengthM * coverM, unit: 'sqm' };
    case 'ea':
      return { quantity: count, unit: 'ea' };
    case 'pack':
      if (packSize === undefined || !(packSize > 0)) return null;
      return { quantity: Math.ceil(count / packSize), unit: 'pack' };
    case 'roll':
      return { quantity: count, unit: 'roll' };
    case 'unknown':
      return null;
  }
}

/**
 * Extend a material into its quantity, amount and mass.
 *
 * `null` means the evidence does not support an extension: the caller turns that
 * into a blocker, because a line with a guessed quantity is worse than a line
 * that says it cannot be priced.
 */
export function extendMaterial(input: ExtendInput): Extended | null {
  const priced = quantityInBasis(input, input.priceBasis);
  if (priced === null) return null;
  const mass = quantityInBasis(input, input.massBasis);
  if (mass === null) return null;

  return {
    quantity: Math.round(priced.quantity * 1000) / 1000,
    unit: priced.unit,
    amount: Math.round(priced.quantity * input.unitCost),
    massKg: mass.quantity * input.massPerUnit,
  };
}
