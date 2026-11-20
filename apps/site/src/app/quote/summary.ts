/**
 * The design in words: the summary bar's line, the "Design summary" popover and step ③'s "What you're
 * sending" table all read from here, so the three never disagree.
 *
 * Also what is still missing before the request can go: the same rule the step dots, the summary
 * bar's Send button and the form's Send button follow. Validity is core's (`validateGuestDesign`,
 * A13) — the page asks, it does not decide.
 */

import {
  guestLengthMm,
  guestReviewFlags,
  validateGuestDesign,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
  type GuestOpeningKind,
  type GuestReviewFlag,
} from '@sq/core/domain';
import { OPENING_SHORT, WALL_NAMES, metresLabel, sizeLabel } from './designOps';
import { contactValid, type ContactDraft, type GuestStep } from './store';

const KIND_ORDER: readonly GuestOpeningKind[] = ['roller_door', 'sliding_door', 'pa_door', 'window'];
const KIND_COUNT: Record<GuestOpeningKind, [string, string]> = {
  roller_door: ['roller door', 'roller doors'],
  sliding_door: ['sliding door', 'sliding doors'],
  pa_door: ['PA door', 'PA doors'],
  window: ['window', 'windows'],
};

/** `6.00 × 6.00 m` — width by length, two decimals (the customer writes sizes that way). */
export function footprintLabel(design: GuestDesignInput): string {
  return `${(design.building.span / 1000).toFixed(2)} × ${(guestLengthMm(design.building) / 1000).toFixed(2)} m`;
}

/** `6.00 × 6.00 × 3.00 m` — width × length × eave height. */
export function sizeWithHeightLabel(design: GuestDesignInput): string {
  return `${footprintLabel(design)} × ${(design.building.height / 1000).toFixed(2)} m`;
}

export function typeName(design: GuestDesignInput, type: GuestBuildingTypeSpec | undefined): string {
  return type?.name ?? design.typeId;
}

/** `2 roller doors, 1 window`, or `null` with none. */
export function openingCounts(design: GuestDesignInput): string | null {
  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    const n = design.openings.filter((o) => o.type === kind).length;
    if (n > 0) parts.push(`${n} ${KIND_COUNT[kind][n === 1 ? 0 : 1]}`);
  }
  return parts.length === 0 ? null : parts.join(', ');
}

const ROOF_LABEL = { gable: 'Gable', skillion: 'Skillion' } as const;

/** `Gable 10°` — the roof and its pitch as one phrase. */
export function roofLabel(design: GuestDesignInput): string {
  return `${ROOF_LABEL[design.building.roof]} ${design.building.pitchDeg}°`;
}

/** The bar's line: `Garage · 6.00 × 6.00 m · Gable 10° · 2 bays`. */
export function summaryLine(design: GuestDesignInput, type: GuestBuildingTypeSpec | undefined): string {
  return [
    typeName(design, type),
    footprintLabel(design),
    roofLabel(design),
    `${design.building.bayWidths.length} ${design.building.bayWidths.length === 1 ? 'bay' : 'bays'}`,
  ].join(' · ');
}

/** The phone bar's line: `Garage · 6.00 × 6.00 m`. */
export function shortLine(design: GuestDesignInput, type: GuestBuildingTypeSpec | undefined): string {
  return `${typeName(design, type)} · ${footprintLabel(design)}`;
}

export function addressLines(design: GuestDesignInput): string | null {
  const site = design.site;
  if (site === undefined) return null;
  const place = `${site.suburb} ${site.state} ${site.postcode}`;
  return site.street === undefined || site.street === '' ? place : `${site.street}, ${place}`;
}

/** One line for the flags: `Roof pitch below the book`, or `null` when there are none (Q4, Q6). */
export function reviewNote(flags: readonly GuestReviewFlag[]): string | null {
  if (flags.length === 0) return null;
  const what = flags.map((f) =>
    f === 'pitch' ? 'roof pitch below the book' : f === 'bay' ? 'a bay wider than the book' : 'a span above the book',
  );
  return `Needs estimator check: ${what.join('; ')}`;
}

/** Does this type get a designer at all? A Class 1 House is an enquiry (Q1). */
export function needsDesign(type: GuestBuildingTypeSpec | undefined): boolean {
  return type === undefined || type.config.mode !== 'enquiry';
}

export interface SummaryRow {
  key: 'type' | 'size' | 'roof' | 'structure' | 'address' | 'openings' | 'colours' | 'sizes' | 'bayWidths' | 'request';
  label: string;
  /** One or more lines; an empty list is shown as "None". */
  value: string[];
  /** Where "Edit" goes, and what it focuses there (a CSS selector; the first match wins). */
  step: GuestStep;
  focus: string;
  missing?: boolean;
}

const SLAB_LABEL = { in_slab: 'In Slab', on_slab: 'On Slab', footing_only: 'Footing Only' } as const;
const KNEE_LABEL = { standard: 'Knee Brace', none_if_possible: 'No Knee Brace – If Possible' } as const;
const CLADDING_LABEL = { vertical: 'Vertical', horizontal: 'Horizontal' } as const;

/**
 * Step ③'s table and the popover's list. A `mode: 'enquiry'` type has no build rows at all: the
 * request is the contact details, the address and the free-text note.
 */
export function summaryRows(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec | undefined,
  contact?: ContactDraft,
): SummaryRow[] {
  const address = addressLines(design);
  const rows: SummaryRow[] = [
    {
      key: 'type',
      label: 'Building',
      value: [typeName(design, type)],
      step: 'start',
      focus: '.g-type-card[aria-pressed="true"]',
    },
    {
      key: 'address',
      label: 'Site address',
      value: address === null ? ['Not added yet'] : [address],
      step: 'start',
      focus: '#g-address-search, #g-street',
      missing: address === null,
    },
  ];

  if (!needsDesign(type)) {
    if (contact !== undefined) {
      const note = contact.additionalRequest.trim();
      rows.push({
        key: 'request',
        label: 'Your request',
        value: note === '' ? ['None'] : note.split('\n'),
        step: 'start',
        focus: '#g-additional-request',
      });
    }
    return rows;
  }

  const { building } = design;
  const bays = building.bayWidths;
  rows.push(
    {
      key: 'size',
      label: 'Size',
      value: [sizeWithHeightLabel(design), `${bays.length} ${bays.length === 1 ? 'bay' : 'bays'}`],
      step: 'design',
      focus: '#g-span',
    },
    {
      key: 'roof',
      label: 'Roof',
      value: [roofLabel(design)],
      step: 'design',
      focus: '#g-roof input:checked',
    },
    {
      key: 'structure',
      label: 'Base & cladding',
      value: [
        SLAB_LABEL[building.slab],
        KNEE_LABEL[building.kneeBrace],
        `${CLADDING_LABEL[building.cladding]} cladding`,
      ],
      step: 'design',
      focus: '#g-slab input:checked',
    },
    {
      key: 'openings',
      label: 'Doors & windows',
      value: design.openings.map((o) => {
        const motor = o.type === 'roller_door' && o.motorised === true ? ', motorised' : '';
        return `${OPENING_SHORT[o.type]} ${sizeLabel(o.size)} · ${WALL_NAMES[o.wall]} wall${motor}`;
      }),
      step: 'design',
      focus: '#g-group-doors',
    },
    {
      key: 'colours',
      label: 'Colours',
      value: [
        `Walls: ${design.colours.walls}`,
        `Roof: ${design.colours.roof}`,
        `Trim: ${trimLabel(design.colours.trim)}`,
      ],
      step: 'design',
      focus: '#g-group-colours',
    },
  );
  return rows;
}

function trimLabel(trim: GuestDesignInput['colours']['trim']): string {
  const { barge, gutter, downpipe } = trim;
  if (barge === gutter && gutter === downpipe) return barge;
  return `barge ${barge}, gutter ${gutter}, downpipe ${downpipe}`;
}

export interface MissingStep {
  step: GuestStep;
  /** Finishes "Your request …" for a screen reader, and the notice on ③. */
  reason: string;
}

/**
 * The steps that must be finished before Send, in step order.
 *
 * - ① when the building type, the address or the contact details are missing.
 * - ② when core finds a problem with the design — e.g. a door left where it no longer fits after
 *   the building was made narrower. Unknown until the building types have loaded (`type` undefined).
 *   Never for a `mode: 'enquiry'` type, which has nothing to design.
 */
export function missingSteps(
  design: GuestDesignInput | null,
  type: GuestBuildingTypeSpec | undefined,
  contact: ContactDraft | undefined,
): MissingStep[] {
  if (design === null) return [{ step: 'start', reason: 'needs a building type' }];
  const missing: MissingStep[] = [];
  if (design.site === undefined) missing.push({ step: 'start', reason: 'needs your address' });
  if (contact === undefined || !contactValid(contact)) missing.push({ step: 'start', reason: 'needs your contact details' });
  if (needsDesign(type) && type !== undefined && validateGuestDesign(design, type).length > 0) {
    missing.push({ step: 'design', reason: 'needs attention' });
  }
  return missing;
}

/** The flags the page shows as "Needs estimator check" (empty for an enquiry and before the type loads). */
export function reviewFlagsOf(design: GuestDesignInput, type: GuestBuildingTypeSpec | undefined): GuestReviewFlag[] {
  if (type === undefined) return [];
  return guestReviewFlags(design, type);
}

/** Height in metres, for the size row's second line. */
export { metresLabel };
