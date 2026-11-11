'use client';

import { COLOUR_ROLES } from '@sq/core/domain';
import { baySpacingMismatch, optionsThatNoLongerFit } from '@sq/core/domain';
// From `domain`, not `pricing`: the pricing barrel re-exports `publish.ts`, whose `node:fs`
// import breaks the browser bundle (`Module not found: Can't resolve 'fs'`, measured 2026-11-11).
import { isNonStandardStructure } from '@sq/core/domain';
import type { ShedColors, ShedConfig, StructureType } from '@sq/core/domain';

/**
 * Validation for the quote draft.
 *
 * ## One source for three consumers
 *
 * The gate on SAVE & NEXT, the error summary at the top of the form, and the message under each
 * field all read this list. They were three separate implementations in the desktop, which is how
 * a Save button ends up disabled with nothing on screen explaining why.
 *
 * ## What "valid" means here
 *
 * A rule exists only where a wrong value produces a building that cannot be made, or a quote that
 * cannot be sent. A missing phone number is not an error; a site address is, because a shed
 * cannot be delivered to "unspecified". The distinction matters: a form that refuses to save for a
 * cosmetic reason teaches people to fill fields with nonsense.
 *
 * ## Why the messages are sentences
 *
 * Every message says what is wrong **and** what to do. "Invalid" is not a message.
 */

/** A problem with the draft, addressed to a field so the summary can link to it. */
export interface DraftIssue {
  /** The field's DOM id, so the summary can link to it and move focus. */
  path: string;
  /** A sentence for a person. */
  message: string;
}

/** The parts of a draft this module inspects. Loose on purpose: the store owns the shape. */
export interface DraftForValidation {
  config: {
    structureType: string;
    span: number;
    length: number;
    height: number;
    roofPitchDeg: number;
    bays: number;
    /**
     * The stored nominal bay spacing, which the desktop lets a person type.
     *
     * Read here because the desktop reports a length its bays do not sum to, and that check had been
     * written in core with nothing calling it. See `baySpacingMismatch`.
     */
    nomBaySpacing: number;
    windRegion: string;
    terrainCategory: number | string;
    importanceLevel: number;
    stateCode: string;
    /**
     * The options already placed, so one that no longer fits the building can be reported.
     *
     * `unknown[]` rather than `ShedOption[]`: this module only hands them back to
     * `optionsThatNoLongerFit`, which takes the whole config and owns the shape. Naming the type
     * here would be a second declaration to keep in step.
     */
    options: readonly unknown[];
    /**
     * The colour roles, as the domain types them.
     *
     * `Record<string, string>` would be a lie about `ShedColors` — a closed type with ten named
     * roles and no index signature — and TypeScript refuses the assignment rather than letting the
     * validator see a shape the domain does not have. Naming the roles keeps the check honest: a
     * new role added to the domain is a compile error here, not a rule that quietly stops running.
     */
    colors: ShedColors;
  };
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    address: string;
  };
  site: {
    address: string;
    deliveryAcknowledged: boolean;
  };
}

/** The colour roles a quote must have. Spelled out because `ShedColors` is a closed type, and a
 *  validator that iterated it loosely would silently stop checking when a role is added. */
export const REQUIRED_COLOUR_ROLES = COLOUR_ROLES;

/** Limits taken from the desktop's own accepted ranges, so a valid desktop quote stays valid. */
/** The desktop's own limit for a cantilever on a standard structure (`Error.cs:320`). */
const CANTILEVER_LIMIT_MM = 1400;

const LIMITS = {
  span: { min: 2000, max: 30000 },
  length: { min: 2000, max: 120000 },
  height: { min: 2000, max: 12000 },
  bays: { min: 2, max: 30 },
  pitch: { min: 0, max: 45 },
} as const;

/** True when `email` looks like an address. Deliberately permissive: the API is authoritative. */
function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Everything wrong with the draft, in the order the form presents it.
 *
 * Ordered rather than a set, because the summary leads with the first problem and a person fixes
 * them top-down.
 */
export function validateDraft(
  draft: DraftForValidation,
  /**
   * Book facts needed for two rules that are about the **book**, not the form.
   *
   * Optional so a caller without a loaded catalogue still validates everything else — but when it is
   * absent, the cantilever limit cannot be checked, and that rule silently does not run. Passed by the
   * editor, which always has it.
   */
  book?: { nonStandardStructureCodes: readonly string[] },
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const { config, customer, site } = draft;

  // ---------------------------------------------------------------- 1. Quote & client
  if (customer.firstName.trim() === '') {
    issues.push({ path: 'customer-firstName', message: 'Enter the customer’s first name.' });
  }
  if (customer.lastName.trim() === '') {
    issues.push({ path: 'customer-lastName', message: 'Enter the customer’s last name.' });
  }
  if (customer.email.trim() === '') {
    issues.push({ path: 'customer-email', message: 'Enter the customer’s email address.' });
  } else if (!looksLikeEmail(customer.email)) {
    issues.push({
      path: 'customer-email',
      message: 'That email address is missing an @ or a domain. Check it before the quote is sent.',
    });
  }
  /*
   * The customer's address is required, and the server requires it too.
   *
   * It was missing here and present in the API contract, so a form that looked complete was refused
   * with "Some fields need attention" and nothing marked — the operator had no way to find the
   * field. A rule that exists on one side of a boundary has to exist on both, or the screen lies
   * about being ready.
   */
  if (customer.address.trim() === '') {
    issues.push({
      path: 'customer-address',
      message: 'Enter the customer’s address. It appears on the quote and on the contract.',
    });
  }

  // ---------------------------------------------------------------- 2. Site
  if (site.address.trim() === '') {
    issues.push({
      path: 'site-address',
      message: 'Enter the site address. A shed cannot be delivered without the address it is going to.',
    });
  }
  if (!site.deliveryAcknowledged) {
    issues.push({
      path: 'site-deliveryAcknowledged',
      message: 'Tick that the delivery terms have been read. It is the customer’s acknowledgement, not a formality.',
    });
  }

  // ---------------------------------------------------------------- 3. Design & 4. Shed
  //
  // The one cross-field rule the desktop enforces, and it is a structural one: a wide portal with
  // low walls has no room for the knee of the frame. The desktop shows both fields in error; so
  // does this, because either could move.
  if (config.span >= 12000 && config.height < 3000) {
    const message =
      'A span of 12 m or more needs walls of at least 3 m. Raise the wall height or reduce the span.';
    issues.push({ path: 'shed-span', message });
    issues.push({ path: 'shed-height', message });
  }

  if (config.span < LIMITS.span.min || config.span > LIMITS.span.max) {
    issues.push({
      path: 'shed-span',
      message: `Span must be between ${LIMITS.span.min} mm and ${LIMITS.span.max} mm. This is the clear width, measured inside the columns.`,
    });
  }
  if (config.length < LIMITS.length.min || config.length > LIMITS.length.max) {
    issues.push({
      path: 'shed-length',
      message: `Overall length must be between ${LIMITS.length.min} mm and ${LIMITS.length.max} mm.`,
    });
  }
  if (config.height < LIMITS.height.min || config.height > LIMITS.height.max) {
    issues.push({
      path: 'shed-height',
      message: `Wall height must be between ${LIMITS.height.min} mm and ${LIMITS.height.max} mm.`,
    });
  }
  if (config.roofPitchDeg < LIMITS.pitch.min || config.roofPitchDeg > LIMITS.pitch.max) {
    issues.push({
      path: 'shed-roofPitchDeg',
      message: `Roof pitch must be between ${LIMITS.pitch.min}° and ${LIMITS.pitch.max}°.`,
    });
  }
  if (config.bays < LIMITS.bays.min || config.bays > LIMITS.bays.max) {
    issues.push({
      path: 'shed-bays',
      message: `Number of bays must be between ${LIMITS.bays.min} and ${LIMITS.bays.max}.`,
    });
  }

  /**
   * The bays must divide the length exactly.
   *
   * The desktop recomputes the bay count from the length and refuses a length that does not
   * divide; here the operator may set either, so the check is that the two agree. A remainder
   * means one bay is a different length from the rest, which changes the purlin run and therefore
   * the price — it must not be silently rounded.
   */
  if (config.bays > 0) {
    const perBay = config.length / config.bays;
    if (!Number.isInteger(perBay)) {
      issues.push({
        path: 'shed-bays',
        message:
          `${config.length} mm does not divide into ${config.bays} equal bays (${perBay.toFixed(1)} mm each). ` +
          'Adjust the length or the bay count so the bays are equal, or the purlin quantities will be wrong.',
      });
    }
  }

  /*
   * The stored nominal spacing and the bay count must agree with the length.
   *
   * `reconcileBays` keeps them consistent when a person edits them, so this only fires for a
   * building that arrived some other way — a template, an imported file, a hand-edited row. It is
   * the desktop's own message ("Total bay length is not equal to overall length"): a remainder means
   * one bay is a different length from the rest, which moves the purlin run and therefore the price.
   *
   * Found unwired — `baySpacingMismatch` had been written and tested in core with **no caller**, so
   * a check the desktop performs was absent here.
   */
  if (baySpacingMismatch(config)) {
    issues.push({
      path: 'shed-nomBaySpacing',
      message:
        `${config.nomBaySpacing} mm × ${config.bays} bays is ${config.nomBaySpacing * config.bays} mm, ` +
        `but the building is ${config.length} mm long. Change the spacing or the bay count so they agree.`,
    });
  }

  /*
   * Options that no longer fit the building it now is.
   *
   * `normaliseOption` clamps every option into the new bounds, so nothing is ever drawn outside the
   * shed — but a clamped option can be a **different thing** from what was placed: a mezzanine whose
   * level dropped under the new ceiling is no longer a mezzanine anyone can stand on, and an option
   * whose footprint resolved to zero is one the geometry could not place at all.
   *
   * The function reported them and **nothing called it**, so a person could lower the walls out from
   * under a mezzanine, watch the plan redraw, and save a quote for a building that cannot be built.
   * Same class as the R9 rule: refuse rather than warn, because a warning is what a person clicks past.
   */
  for (const problem of optionsThatNoLongerFit(config as unknown as ShedConfig)) {
    issues.push({ path: `options-${problem.id}`, message: problem.reason });
  }

  /*
   * ## Cantilever over 1 400 mm on a standard building
   *
   * The desktop refuses this (`ValidateDesignInfoBlock`, `Error.cs:320`) and skips the check when the
   * structure is non-standard. A cantilever is a bracket hanging past the last column: over 1 400 mm it
   * needs a design the standard series does not carry, which is why the factory sells one.
   *
   * Reproduced as a **blocking** issue rather than the warning this build had, because the desktop
   * blocks and because the quote is otherwise priced from a frame the book does not describe.
   *
   * The non-standard flag comes from the book's `is_nonstandard` column, read through the structure's
   * sub-code — not from comparing display names, which is how the desktop does it and which breaks the
   * day somebody renames a row.
   */
  if (book !== undefined) {
    const isNonStandard = isNonStandardStructure(
      config.structureType as StructureType,
      book.nonStandardStructureCodes,
    );
    const overLimit = config.options.filter(
      (option): option is { kind: 'cantilever'; wall: 'front' | 'back'; bay: number; length: number } =>
        typeof option === 'object' &&
        option !== null &&
        (option as { kind?: unknown }).kind === 'cantilever' &&
        typeof (option as { length?: unknown }).length === 'number' &&
        (option as { length: number }).length > CANTILEVER_LIMIT_MM,
    );
    if (!isNonStandard) {
      for (const cantilever of overLimit) {
        issues.push({
          path: 'design-cantilever',
          message:
            `The ${cantilever.wall} cantilever is ${cantilever.length} mm; a standard building is limited to ` +
            `${CANTILEVER_LIMIT_MM} mm. Shorten it, or choose a custom (non-standard) structure — a longer ` +
            'bracket needs a design the standard series does not carry.',
        });
      }
    }
  }

  // ---------------------------------------------------------------- 5. Site conditions
  /*
   * Wind region is **not** a blocking issue any more, and that is a deliberate reversal.
   *
   * It became read-only on 2026-11-10 (it is a certified value, not a design choice), so a check here
   * would have produced a red field nobody can edit and a Save button nobody can unblock — the exact
   * shape of the desktop's `ValidateSiteInfoBlock`, which is why the desktop cannot quote before a site
   * check has run.
   *
   * The decision on record is to keep a quick quote possible: an unchecked quote is priced from the
   * defaults this state ships with, and both the screen and the printed document say so. Requiring the
   * certificate would turn "customer is on the phone" into "come back after the site visit".
   *
   * What still blocks is `stateCode`, which is editable and selects the material price coefficient —
   * an empty one is not a default, it is a missing table.
   */
  if (config.stateCode === '') {
    issues.push({ path: 'design-stateCode', message: 'Choose the state. It selects this state’s prices.' });
  }

  // ---------------------------------------------------------------- 6. Colours
  for (const role of REQUIRED_COLOUR_ROLES) {
    const colour = config.colors[role];
    if (colour === undefined || colour.trim() === '') {
      issues.push({ path: `colours-${role}`, message: `Choose a colour for the ${role}.` });
    }
  }

  return issues;
}

/**
 * The reasons SAVE & NEXT is disabled.
 *
 * Three independent reasons, and the button says which one applies rather than sitting grey with
 * no explanation:
 *
 * 1. nothing has changed — saving an unchanged draft makes a revision that says nothing;
 * 2. the draft is invalid;
 * 3. a price has not been calculated, so there is no figure to freeze.
 */
export interface GateState {
  /** False when the operator may proceed. */
  blocked: boolean;
  /** Why, in the order the screen should present it. */
  reasons: string[];
}

export function evaluateGate(input: {
  dirty: boolean;
  issues: readonly DraftIssue[];
  pricedAt: 'none' | 'stale' | 'current';
  saving: boolean;
}): GateState {
  const reasons: string[] = [];

  /**
   * Order matters, and it is the order a person would fix things in.
   *
   * An empty form is both "nothing has changed" and "five fields need attention". Reporting the
   * first is technically true and uselessly passive: the operator has not pressed anything yet, and
   * telling them so describes their own state back to them. The actionable fact is that the form
   * needs filling — so the issue count leads, and "nothing has changed" is said only when the form
   * is complete and genuinely untouched.
   */
  if (input.issues.length > 0) {
    reasons.push(
      input.issues.length === 1
        ? 'One field needs attention.'
        : `${input.issues.length} fields need attention.`,
    );
  } else if (!input.dirty) {
    reasons.push(
      'Nothing has been changed yet. Fill in the details, and this button saves the first revision.',
    );
  }

  if (input.pricedAt === 'none') {
    reasons.push('No price has been calculated for this building yet.');
  }
  if (input.pricedAt === 'stale') {
    reasons.push('The building changed after the price was calculated — calculate it again.');
  }

  return { blocked: reasons.length > 0 || input.saving, reasons };
}
