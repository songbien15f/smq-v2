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
import type { ShedConfig } from '@/domain/types';
import { assumptionsFor, type AssumptionNote } from './assumptions';
import { colourLabel } from './colours';
import { customerNoteFor } from './customerNotes';
import type { FrozenRevision } from './types';

/** What a customer document may contain. Nothing else exists in this type. */
export interface CustomerDocument {
  quoteNumber: string;
  revision: number;
  issuedAt: string;
  validUntil: string;
  company: {
    name: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
    logoText: string;
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
    colours: { wall: string; roof: string; trim: string; door: string };
  };
  inclusions: string[];
  price: {
    contractCents: number;
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
const STRUCTURE_LABEL: Record<string, string> = {
  gable: 'Gable',
  skillion: 'Skillion',
  carports: 'Carport',
  tophot: 'TopHat',
  zed: 'Zed shed',
  hangar: 'Aircraft hangar',
  cyclonic: 'Cyclonic',
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
function inclusions(config: ShedConfig): string[] {
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
function planOpenings(config: ShedConfig): CustomerDocument['plan']['openings'] {
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
    issuedAt: revision.createdAt.slice(0, 10),
    validUntil: revision.validUntil,
    company: {
      name: company.name,
      abn: company.abn ?? '',
      address: company.address ?? '',
      phone: company.phone ?? '',
      email: company.email ?? '',
      logoText: company.logoText,
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
      colours: {
        wall: colourLabel(config.colors.wall),
        roof: colourLabel(config.colors.roof),
        trim: colourLabel(config.colors.trim),
        door: colourLabel(config.colors.door),
      },
    },
    inclusions: inclusions(config),
    price: {
      contractCents: price.contractCents,
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
