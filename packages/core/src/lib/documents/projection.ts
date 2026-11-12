/**
 * Turning a frozen revision into the document a customer receives.
 *
 * A projection, not a template: this module decides **what a customer is allowed to know**, and the
 * HTML module decides how it looks. Keeping them apart is what makes the leak check possible — this
 * module's output can be asserted to contain no cost, no margin and no internal issue code, without
 * reading a line of markup.
 *
 * The rules:
 *
 * - **The contract price and its GST.** Nothing about the kit, the margin or the material cost. A
 *   customer who can see the cost can price the job themselves.
 * - **The building, as quoted.** Dimensions, openings, options, and the assumptions that change what
 *   the number means.
 * - **Prose, not codes.** `FRAME_SECTION_ASSUMED` is a machine's name for a fact; the customer gets
 *   the fact.
 * - **Everything frozen.** The company's name and terms come from the revision's snapshot, never from
 *   live settings — a quote sent in March must read the same in December.
 */

import { buildPlanGeometry } from '@/domain/plan';
import type { ShedColors, ShedConfig, StructureType, DimensionedShed } from '@/domain/types';
import { COLOUR_ROLES } from '@/domain/colors';
import { assumptionsFor, type AssumptionNote } from './assumptions';
import { colourLabel } from './colours';
import { customerNoteFor } from './customerNotes';
import type { FrozenRevision } from './types';

/**
 * The name a customer reads for each colour role.
 *
 * "Downpipes" and "Barge and fascia" rather than the code's `downpipe`/`barge`: this sheet is read by
 * the person paying for the shed, and it is also what a supplier builds from.
 */
const COLOUR_LABEL: Record<keyof ShedColors, string> = {
  wall: 'Walls',
  roof: 'Roof',
  barge: 'Barge and fascia',
  downpipe: 'Downpipes',
  gutter: 'Gutters',
  window: 'Windows',
  paDoor: 'PA doors',
  rollerDoor: 'Roller doors',
  slidingDoor: 'Sliding doors',
  dividingWall: 'Dividing wall',
};

/**
 * The colours a customer document prints, in the order the editor shows them.
 *
 * The five surfaces a shed always has, plus each opening kind **the building actually has**, plus the
 * dividing wall when one is placed. The desktop printed all ten regardless, so a quote with no roller
 * door still read "Roller door: Monument" — a line about a door nobody is buying, in a document a
 * customer reads as the list of what they get.
 */
function colourRows(config: DimensionedShed): { label: string; colour: string }[] {
  const openings = new Set(config.openings.map((opening) => opening.type));
  const used: Record<keyof ShedColors, boolean> = {
    wall: true,
    roof: true,
    barge: true,
    downpipe: true,
    gutter: true,
    window: openings.has('window'),
    paDoor: openings.has('pa_door'),
    rollerDoor: openings.has('roller_door'),
    slidingDoor: openings.has('sliding_door'),
    dividingWall: config.options.some((option) => option.kind === 'dividing_wall'),
  };

  return COLOUR_ROLES.filter((role) => used[role]).map((role) => ({
    label: COLOUR_LABEL[role],
    colour: colourLabel(config.colors[role]),
  }));
}

/** What a customer document may contain. Nothing else exists in this type. */
export interface CustomerDocument {
  quoteNumber: string;
  revision: number;
  /**
   * The frozen building, kept whole.
   *
   * The customer page reads the projected `building` block, but a drawing sheet needs the real
   * geometry — walls, opening positions, sills — and re-deriving that from labels is how a drawing
   * drifts from the quote.
   */
  config: DimensionedShed;
  issuedAt: string;
  validUntil: string;
  company: {
    name: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
    logoText: string;
    /** Which logo this document may use, or `null`. See `FrozenCompany.logoHash`. */
    logoHash: string | null;
  };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    deliveryAddress: string | null;
  };
  building: {
    structure: string;
    spanMm: number;
    lengthMm: number;
    heightMm: number;
    pitchDeg: number;
    bays: number;
    windRegion: string;
    terrainCategory: number;
    importanceLevel: number;
    stateCode: string;
    /** The surfaces this building has, in the order the editor shows them. */
    colourRows: { label: string; colour: string }[];
  };
  inclusions: string[];
  price: {
    contractCents: number;
    /**
     * Labour, fees and other charged items, already inside `contractCents`.
     *
     * Zero on an ordinary supply-only quote, which is when the document shows one total and nothing
     * else — see the price table in `html.ts`.
     */
    additionsCents: number;
    /** `contractCents − additionsCents`: what the building itself came to. */
    beforeAdditionsCents: number;
    gstCents: number;
    depositCents: number;
    progressCents: number;
    balanceCents: number;
    depositPct: number;
    progressPct: number;
  };
  terms: string[];
  /**
   * What the estimate covers, as the company wrote it.
   *
   * Two kinds of thing share this section on the page: these scope notes in the company's voice, and
   * the engine's own caveats for this building — a fact about *this* quote that cannot be written in
   * advance.
   */
  assumptions: AssumptionNote[];
  /** Engine caveats specific to this building, in prose. */
  caveats: string[];
  /** "Indicative" when an allowance is present, "firm" when every line is a real price. */
  estimateLabel: string;
  status: 'blocked' | 'indicative' | 'priced';
  /** A plan, drawn from the revision's own dimensions so it is the building that was quoted. */
  plan: {
    widthMm: number;
    lengthMm: number;
    outline: string;
    openings: {
      label: string;
      lines: [number, number, number, number][];
      rects: { x: number; y: number; width: number; height: number; filled: boolean }[];
    }[];
  };
}

/** A dimension in metres, as a customer reads it. */
function metres(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/** The structure, in words rather than the internal code. */
const STRUCTURE_LABEL: Record<StructureType, string> = {
  gable: 'Gable',
  skillion: 'Skillion',
  gable_carport: 'Gable carport',
  skillion_carport: 'Skillion carport',
  tophot_64: 'TopHat',
  tophot_96: 'TopHat',
  zed_shed: 'Zed shed',
  aircraft_hangar: 'Aircraft hangar',
  cyclonic: 'Cyclonic',
  custom_gable: 'Custom gable',
  custom_skillion: 'Custom skillion',
};

/** How a door or window is named on the plan. */
const OPENING_LABEL: Record<string, string> = {
  roller_door: 'Roller door',
  pa_door: 'PA door',
  sliding_door: 'Sliding door',
  window: 'Window',
  opening: 'Opening',
};

/** What the customer is getting, in their words. */
function inclusions(config: DimensionedShed): string[] {
  const items = [
    `Steel frame, ${metres(config.span)} span × ${metres(config.length)} long`,
    `Wall height ${metres(config.height)}`,
    config.roofPitchDeg > 0 ? `Roof pitch ${config.roofPitchDeg}°` : 'Flat roof',
    'Colorbond roof and wall cladding',
    'Guttering, downpipes and flashing',
    'All structural bolts, brackets and fixings',
  ];

  for (const opening of config.openings) {
    const label = OPENING_LABEL[opening.type] ?? 'Opening';
    items.push(`${label}, ${opening.width} × ${opening.height} mm`);
  }

  for (const option of config.options) {
    if (option.kind === 'misc_option') {
      const name = option.name.trim() === '' ? 'Catalogue item' : option.name;
      items.push(option.quantity > 1 ? `${name} × ${option.quantity}` : name);
      continue;
    }
    items.push(option.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
  }

  return items;
}

/**
 * The notes a customer may read about this building.
 *
 * Each issue goes through `customerNoteFor`, which either supplies wording written for a customer or
 * says the issue is internal. Nothing the engine wrote for an operator reaches this list — see
 * `customerNotes.ts` for why that distinction is the whole point.
 *
 * Warnings are excluded as well: they describe how a price-book row was interpreted, which is a data
 * quality note for the operator and means nothing to a buyer.
 */
function caveats(revision: FrozenRevision): string[] {
  const notes = revision.issues
    .filter((issue) => issue.severity !== 'warning')
    .map((issue) => customerNoteFor(issue.code))
    .filter((note): note is string => note !== null);

  // De-duplicated: four bracket lines raise four `UNIT_ASSUMED_BRACKET` issues and the customer
  // needs the sentence once.
  return [...new Set(notes)];
}

/** The estimate status, from the issues rather than stored separately. */
function statusOf(revision: FrozenRevision): 'blocked' | 'indicative' | 'priced' {
  if (revision.issues.some((issue) => issue.severity === 'blocker')) return 'blocked';
  if (revision.issues.some((issue) => issue.severity === 'assumption')) return 'indicative';
  return 'priced';
}

/**
 * The customer-facing label for the status.
 *
 * "Indicative" is not a hedge: it tells a buyer that at least one figure is an allowance and will be
 * confirmed. "Firm" is the claim that everything on the page is a real price.
 */
function estimateLabelFor(status: 'blocked' | 'indicative' | 'priced'): string {
  if (status === 'priced') return 'Firm quotation';
  if (status === 'indicative') return 'Indicative quotation — allowances apply';
  return 'Quotation not available — the price is not yet final';
}

/** An outline path for the plan, in millimetres, so the SVG scales itself. */
function planOutline(spanMm: number, lengthMm: number): string {
  return `M0,0 L${spanMm},0 L${spanMm},${lengthMm} L0,${lengthMm} Z`;
}

/**
 * The openings as shapes in plan space.
 *
 * `buildPlanGeometry` is the editor's own geometry, so a door drawn here is in the same place as the
 * door on screen. Two views of one building that disagree about where a door is would be worse than
 * no drawing at all.
 *
 * A geometry failure must not take down the document: a quote without a plan is worse than one with
 * a plan that omits a door, but a quote that will not render is worse than both.
 */
function planOpenings(config: DimensionedShed): CustomerDocument['plan']['openings'] {
  try {
    const geometry = buildPlanGeometry(config);
    return geometry.openings.map((opening) => ({
      label: OPENING_LABEL[opening.type] ?? 'Opening',
      lines: opening.symbol.lines,
      rects: opening.symbol.rects.map((rect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        filled: rect.filled,
      })),
    }));
  } catch {
    return [];
  }
}

/** A name from its parts, skipping the ones that are absent. */
function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/** One line address from the parts a form collects. */
function addressLine(customer: FrozenRevision['customer']): string | null {
  const parts = [customer.address, customer.suburb, customer.state, customer.postcode].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(', ');
}

/** Project a frozen revision into the customer's view of it. */
export function toCustomerDocument(revision: FrozenRevision): CustomerDocument {
  const { config, price, company, customer } = revision;
  const status = statusOf(revision);

  return {
    quoteNumber: revision.quoteNumber,
    revision: revision.revision,
    config,
    issuedAt: revision.createdAt.slice(0, 10),
    validUntil: revision.validUntil,
    company: {
      name: company.name,
      abn: company.abn ?? '',
      address: company.address ?? '',
      phone: company.phone ?? '',
      email: company.email ?? '',
      logoText: company.logoText,
      logoHash: company.logoHash ?? null,
    },
    customer: {
      name: fullName(customer.firstName, customer.lastName),
      email: customer.email,
      phone: customer.mobile ?? customer.phone,
      address: addressLine(customer),
      deliveryAddress: customer.deliveryAddress,
    },
    building: {
      structure: STRUCTURE_LABEL[config.structureType] ?? config.structureType,
      spanMm: config.span,
      lengthMm: config.length,
      heightMm: config.height,
      pitchDeg: config.roofPitchDeg,
      bays: config.bays,
      windRegion: config.windRegion,
      terrainCategory: config.terrainCategory,
      importanceLevel: config.importanceLevel,
      stateCode: config.stateCode,
      colourRows: colourRows(config),
    },
    inclusions: inclusions(config),
    price: {
      contractCents: price.contractCents,
      /*
       * What the contract is made of, for a customer reading a total they did not add up.
       *
       * `additionsCents` is labour, fees and other charged items, and it is **already inside**
       * `contractCents` — so a page that shows only the total quotes a figure the customer cannot
       * account for, and a salesperson spends the phone call explaining it. Subtracting rather than
       * recomputing keeps the three rows summing to the penny whatever the quote rate did.
       */
      additionsCents: price.additionsCents ?? 0,
      beforeAdditionsCents: price.contractCents - (price.additionsCents ?? 0),
      gstCents: price.gstCents,
      depositCents: price.depositCents,
      progressCents: price.progressCents,
      balanceCents: price.balanceCents,
      depositPct: price.depositPct,
      progressPct: price.progressPct,
    },
    terms: company.terms,
    assumptions: assumptionsFor(company.assumptions),
    caveats: caveats(revision),
    estimateLabel: estimateLabelFor(status),
    status,
    plan: {
      widthMm: config.span,
      lengthMm: config.length,
      outline: planOutline(config.span, config.length),
      openings: planOpenings(config),
    },
  };
}
