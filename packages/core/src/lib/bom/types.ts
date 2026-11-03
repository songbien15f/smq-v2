/**
 * Types the BOM produces.
 *
 * A `BomLine` is one row a buyer would recognise on a materials list: a product
 * code, a description, a quantity in its own unit, and an amount. A `BomResult`
 * is the whole list, grouped the way the desktop groups it, with the two totals
 * the pricing layer needs.
 *
 * Money is whole cents. `amount` is `quantity × unitCost` rounded once, so
 * summing a group cannot drift from the sum of its lines.
 */

/** The ten material groups, plus the two that are not material. */
export type BomGroupId =
  | 'frame'
  | 'purlin'
  | 'sheeting'
  | 'gutter'
  | 'flashing'
  | 'bracket'
  | 'flatfly'
  | 'bracing'
  | 'bolt'
  | 'screw'
  | 'option'
  | 'misc';

/** How a line's quantity is counted. */
export type BomUnit = 'm' | 'sqm' | 'ea' | 'pack' | 'roll';

export interface BomLine {
  group: BomGroupId;
  /** The price book's product code, or `'MOCK'` when there is no price row. */
  code: string;
  description: string;
  unit: BomUnit;
  quantity: number;
  /** Whole cents per unit. */
  unitCost: number;
  /** Whole cents: `round(quantity × unitCost)`. */
  amount: number;
  massKg: number;
  /** Set when the price book had no row, so the amount is not a real price. */
  mocked?: boolean;
  /**
   * Set when the price is a real catalogue figure for **something else**.
   *
   * The difference from `mocked` matters and is the reason both exist. `mocked` means
   * no price was found, so the amount is a placeholder and sending is refused. `assumed`
   * means a price was found and deliberately substituted — a wall girt priced from the
   * purlin row, because the book lists no girt material — so the amount is a figure
   * somebody would charge for a similar thing, and the quote reads as *indicative*
   * rather than firm. Collapsing the two would either block a sendable quote or send an
   * approximation as if it were exact.
   */
  assumed?: boolean;
  /** Set when the operator overrode the computed quantity. */
  overridden?: boolean;
}

export interface BomGroup {
  id: BomGroupId;
  label: string;
  lines: BomLine[];
}

export interface BomResult {
  groups: BomGroup[];
  /** Whole cents; excludes `misc`, matching the desktop's `BuildingCost`. */
  buildingCost: number;
  /** Whole cents; includes `misc`. This is what pricing uses. */
  totalCost: number;
  totalMassKg: number;
  /** How many lines carry no real price. A non-zero count means "incomplete". */
  mockedLines: number;
}

/**
 * The frame dimensions the optimisation settles on.
 *
 * Everything downstream — purlin counts, sheeting lengths, gutter runs — reads
 * these, which is why the optimisation runs before any group is built.
 */
export interface OptimisedFrame {
  purlinMaterial: string;
  purlinRows: number;
  purlinInternalSpan: number;
  purlinEndSpan: number;
  girtMaterial: string;
  /**
   * True when the book gives a girt material of its own.
   *
   * False means the purlin material was used for the walls — which is what the old
   * engine did unconditionally, and what the reference book forces by listing no girt
   * material at all. A girt and a purlin are different sections carrying different
   * loads, so the quote says which it is rather than presenting the purlin's price as
   * the girt's.
   */
  girtMaterialSeparate: boolean;
  girtRows: number;
  girtInternalSpan: number;
  girtEndSpan: number;
  /** The roof run the purlins span, in millimetres. */
  roofSpan: number;
  /** The standard bay length the span table was chosen for, in millimetres. */
  bayStandard: number;
  /** True when the price book had no usable span row and defaults were used. */
  mocked: boolean;
  /**
   * True when the book carries no structure-to-section table, so every frame
   * member is priced from one fixed section.
   *
   * It is the difference between "the frame is priced from the book's own design
   * for this span" and "the frame is priced as if a 15 m portal were light
   * steel". A quote has to say which.
   */
  scheduleMissing: boolean;
}

/** The group order a quote document shows. */
export const BOM_GROUP_ORDER: { id: BomGroupId; label: string }[] = [
  { id: 'frame', label: 'Frame' },
  { id: 'purlin', label: 'Purlin & girt' },
  { id: 'sheeting', label: 'Sheeting' },
  { id: 'gutter', label: 'Gutter & downpipe' },
  { id: 'flashing', label: 'Flashing' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'flatfly', label: 'Flat fly' },
  { id: 'bracing', label: 'Wind bracing' },
  { id: 'bolt', label: 'Bolts' },
  { id: 'screw', label: 'Screws' },
  { id: 'option', label: 'Options' },
  { id: 'misc', label: 'Miscellaneous' },
];

/**
 * Build one line, rounding its amount once.
 *
 * Every group uses this rather than computing `quantity * unitCost` itself, so
 * the rounding rule cannot differ between groups.
 */
export function bomLine(input: {
  group: BomGroupId;
  code: string;
  description: string;
  unit: BomUnit;
  quantity: number;
  unitCost: number;
  massKg: number;
  mocked?: boolean;
  assumed?: boolean;
}): BomLine {
  const quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  return {
    group: input.group,
    code: input.code,
    description: input.description,
    unit: input.unit,
    quantity,
    unitCost: input.unitCost,
    amount: Math.round(quantity * input.unitCost),
    massKg: Number.isFinite(input.massKg) ? input.massKg : 0,
    ...(input.mocked === true ? { mocked: true } : {}),
    ...(input.assumed === true ? { assumed: true } : {}),
  };
}

/** A line for something the price book cannot price. */
export function mockedLine(input: {
  group: BomGroupId;
  description: string;
  unit: BomUnit;
  quantity: number;
}): BomLine {
  return bomLine({ ...input, code: 'MOCK', unitCost: 0, massKg: 0, mocked: true });
}
