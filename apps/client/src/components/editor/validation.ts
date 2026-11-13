'use client';

import { COLOUR_ROLES } from '@sq/core/domain';
import { baySpacingMismatch, openingsThatNoLongerFit, optionsThatNoLongerFit } from '@sq/core/domain';
// From `domain`, not `pricing`: the pricing barrel re-exports `publish.ts`, whose `node:fs`
// import breaks the browser bundle (`Module not found: Can't resolve 'fs'`, measured 2026-11-11).
import { isNonStandardStructure } from '@sq/core/domain';
import type { DimensionedShed, ShedColors, ShedConfig, StructureType } from '@sq/core/domain';
import { bookBounds, largestBay } from './bookBounds';
import type { BookBounds } from './bookBounds';

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
 * ## Two texts per issue
 *
 * `short` is the line under the field: the label is right beside it, so "Required" or "2000–30000 mm"
 * is enough, and a five-line paragraph under every box is what made Step 1 unreadable. `message` is
 * the sentence the error summary lists, read away from the field, so it names the field — and, where
 * the fix is not obvious, says what to do. "Invalid" is never either.
 */

/** A problem with the draft, addressed to a field so the summary can link to it. */
export interface DraftIssue {
  /** The field's DOM id, so the summary can link to it and move focus. */
  path: string;
  /** The one-line form shown under the field, e.g. `Required`. */
  short: string;
  /** A sentence naming the field, for the error summary. */
  message: string;
}

/** The parts of a draft this module inspects. Loose on purpose: the store owns the shape. */
export interface DraftForValidation {
  config: {
    structureType: string;
    /**
     * The three dimensions, **`null` until stated**.
     *
     * A new quote has no building. Validation is where that becomes visible to the operator: an
     * absent span is a field to fill in, not a `0` to silently accept, so this module reports it like
     * any other missing required value.
     */
    span: number | null;
    length: number | null;
    height: number | null;
    roofPitchDeg: number;
    bays: number;
    /**
     * One length per bay when a person edited them, absent when they are equal.
     *
     * Present means the bays legitimately differ, which turns off two rules below — see the note on
     * the equal-bays check.
     */
    bayWidths?: readonly number[];
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

/** The desktop's own limit for a cantilever on a standard structure (`Error.cs:320`). */
const CANTILEVER_LIMIT_MM = 1400;

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
  /**
   * The size limits — the price book's when the editor has its catalogue (`bookBounds`).
   *
   * The book's numbers decide validity, because the desktop's shed-config lookup keeps only rows whose
   * span, height, bay and pitch bands contain the building (`ShedConfigCache.cs:47-54`): a building
   * outside them has no row to price from. Defaults to the loose fallbacks, under which no bay size is
   * checked.
   */
  bounds: BookBounds = bookBounds(null, draft.config.span),
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const { config, customer, site } = draft;
  const forBook = (fromBook: boolean): string => (fromBook ? ' for this price book' : '');

  // ---------------------------------------------------------------- 1. Quote & client
  if (customer.firstName.trim() === '') {
    issues.push({ path: 'customer-firstName', short: 'Required', message: 'Enter the customer’s first name.' });
  }
  if (customer.lastName.trim() === '') {
    issues.push({ path: 'customer-lastName', short: 'Required', message: 'Enter the customer’s last name.' });
  }
  if (customer.email.trim() === '') {
    issues.push({ path: 'customer-email', short: 'Required', message: 'Enter the customer’s email address.' });
  } else if (!looksLikeEmail(customer.email)) {
    issues.push({
      path: 'customer-email',
      short: 'Missing @ or domain',
      message: 'That email address is missing an @ or a domain.',
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
      short: 'Required',
      message: 'Enter the customer’s address.',
    });
  }

  // ---------------------------------------------------------------- 2. Site
  if (site.address.trim() === '') {
    issues.push({
      path: 'site-address',
      short: 'Required',
      message: 'Enter the site address.',
    });
  }
  if (!site.deliveryAcknowledged) {
    issues.push({
      path: 'site-deliveryAcknowledged',
      short: 'Tick to confirm',
      message: 'Tick that the delivery terms have been read.',
    });
  }

  // ---------------------------------------------------------------- 3. Design & 4. Shed
  /*
   * ## The three dimensions are required, and their absence is the first thing said
   *
   * A quote is a price for a building. Before the operator states a span, a length and a wall height
   * there is no building: no frame to size, no sheets to count, nothing ShedSafe could rate. The old
   * `DEFAULT_SHED` filled these in, so a quote could be saved and sent against a shed nobody had
   * described — the reported defect.
   *
   * Under the field the line is just "Required"; the summary sentence names which dimension.
   */
  for (const [field, label, path] of [
    ['span', 'span', 'shed-span'],
    ['length', 'overall length', 'shed-length'],
    ['height', 'wall height', 'shed-height'],
  ] as const) {
    if (config[field] === null) {
      issues.push({
        path,
        short: 'Required',
        message: `Enter the ${label}.`,
      });
    }
  }

  /*
   * The one cross-field rule the desktop enforces, and it is a structural one: a wide portal with
   * low walls has no room for the knee of the frame. The desktop shows both fields in error; so
   * does this, because either could move.
   *
   * Only when both are stated — a null is already reported above, and repeating it here would put
   * two messages on one field.
   */
  if (config.span !== null && config.height !== null && config.span >= 12000 && config.height < 3000) {
    const message =
      'A span of 12 m or more needs walls of at least 3 m. Raise the wall height or reduce the span.';
    const short = 'Span ≥ 12 m needs walls ≥ 3 m';
    issues.push({ path: 'shed-span', short, message });
    issues.push({ path: 'shed-height', short, message });
  }

  const { span: spanR, length: lengthR, height: heightR, pitch: pitchR, bays: baysR } = bounds;
  if (config.span !== null && (config.span < spanR.min || config.span > spanR.max)) {
    issues.push({
      path: 'shed-span',
      short: `${spanR.min}–${spanR.max} mm`,
      message: `Span must be between ${spanR.min} mm and ${spanR.max} mm${forBook(bounds.fromBook.span)}.`,
    });
  }
  if (config.length !== null && (config.length < lengthR.min || config.length > lengthR.max)) {
    issues.push({
      path: 'shed-length',
      short: `${lengthR.min}–${lengthR.max} mm`,
      message: `Overall length must be between ${lengthR.min} mm and ${lengthR.max} mm.`,
    });
  }
  if (config.height !== null && (config.height < heightR.min || config.height > heightR.max)) {
    issues.push({
      path: 'shed-height',
      short: `${heightR.min}–${heightR.max} mm`,
      message: `Wall height must be between ${heightR.min} mm and ${heightR.max} mm${forBook(bounds.fromBook.height)}.`,
    });
  }
  if (config.roofPitchDeg < pitchR.min || config.roofPitchDeg > pitchR.max) {
    issues.push({
      path: 'shed-roofPitchDeg',
      short: `${pitchR.min}–${pitchR.max}°`,
      message: `Roof pitch must be between ${pitchR.min}° and ${pitchR.max}°${forBook(bounds.fromBook.pitch)}.`,
    });
  }
  if (config.bays < baysR.min || config.bays > baysR.max) {
    issues.push({
      path: 'shed-bays',
      short: `${baysR.min}–${baysR.max}`,
      message: `Number of bays must be between ${baysR.min} and ${baysR.max}.`,
    });
  }

  /**
   * Unequal bays are only a problem when nobody asked for them.
   *
   * This rule used to fire whenever the length did not divide evenly by the bay count — correct while
   * equal division was the only way to describe a building, and **wrong** the moment a person can edit
   * one bay: 4 000/4 000/5 000 is 13 000 in three bays with no integer average, and the desktop's
   * `Adjust Bay Spacing` panel exists precisely to produce it. (Whether each bay is one the book sells
   * is a separate rule, below.)
   *
   * So the array decides. With a stored array the length is the sum of the bays by construction
   * (`applyBayWidths` sets it), and a remainder is not a defect. Without one, an uneven division still
   * means one bay ended up a different length from the rest by arithmetic rather than by choice, which
   * moves the purlin run and the frame row — and that is worth saying.
   */
  const hasUnevenBays = Array.isArray(config.bayWidths) && config.bayWidths.length === config.bays;
  // A building with no length yet has nothing to divide; the missing-length message is above.
  if (!hasUnevenBays && config.bays > 0 && config.length !== null) {
    const perBay = config.length / config.bays;
    if (!Number.isInteger(perBay)) {
      issues.push({
        path: 'shed-bays',
        short: 'Bays don’t divide equally',
        message:
          `${config.length} mm does not divide into ${config.bays} equal bays (${perBay.toFixed(1)} mm each). ` +
          'Adjust the length or the bay count so the bays are equal, or edit each bay individually.',
      });
    }
  }

  /*
   * Every bay must be one the book sells.
   *
   * The book's bay band filters the shed-config rows exactly as span and height do
   * (`ShedConfigCache.cs:51-52`), so a bay outside it has no frame row to price from. When the bays
   * differ, each offending bay is marked on its own field; when they are equal, the nominal spacing
   * carries it — ahead of the spacing-mismatch message on the same field, because a size the book
   * cannot price is the bigger problem.
   */
  if (bounds.baySpacing !== null) {
    const { min, max } = bounds.baySpacing;
    const range = `${min}–${max} mm`;
    if (hasUnevenBays) {
      (config.bayWidths ?? []).forEach((width, index) => {
        if (width < min || width > max) {
          issues.push({
            path: `shed-bayWidth-${index}`,
            short: range,
            message: `Bay ${index + 1} is ${width} mm; this price book sells bays of ${range}.`,
          });
        }
      });
    } else {
      const largest = largestBay(config);
      if (largest !== null && (largest.mm < min || largest.mm > max)) {
        issues.push({
          path: 'shed-nomBaySpacing',
          short: range,
          message: `Each bay is ${Math.round(largest.mm)} mm; this price book sells bays of ${range}.`,
        });
      }
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
  /*
   * Skipped when the bays differ, because then the nominal spacing describes no bay: the desktop
   * leaves `Bay` untouched when a bay is edited (`OnBayUnitsChange`), so a mismatch is the expected
   * state rather than a mistake.
   */
  if (
    !hasUnevenBays &&
    config.length !== null &&
    baySpacingMismatch({ length: config.length, bays: config.bays, nomBaySpacing: config.nomBaySpacing })
  ) {
    issues.push({
      path: 'shed-nomBaySpacing',
      short: 'Spacing × bays ≠ length',
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
  /*
   * Options can only "no longer fit" a building that exists. With no dimensions there is no bound to
   * have fallen outside of, and the missing-dimension messages above already say what to do.
   */
  if (config.span !== null && config.length !== null && config.height !== null) {
    for (const problem of optionsThatNoLongerFit(config as unknown as DimensionedShed)) {
      issues.push({ path: `options-${problem.id}`, short: problem.reason, message: problem.reason });
    }
    /*
     * Doors and windows, by the same reasoning: a wall that moved can leave a door hanging past its
     * end or taller than the wall. Under the `options-` prefix on purpose — the fix is on the Options
     * step, so the issue blocks Save but not Next, and does not pull the person back to Quote details.
     */
    for (const problem of openingsThatNoLongerFit(config as unknown as DimensionedShed)) {
      issues.push({ path: `options-opening-${problem.id}`, short: problem.reason, message: problem.reason });
    }
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
          short: `Max ${CANTILEVER_LIMIT_MM} mm on a standard building`,
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
    issues.push({ path: 'design-stateCode', short: 'Required', message: 'Choose the state.' });
  }

  // ---------------------------------------------------------------- 6. Colours
  for (const role of REQUIRED_COLOUR_ROLES) {
    const colour = config.colors[role];
    if (colour === undefined || colour.trim() === '') {
      issues.push({ path: `colours-${role}`, short: 'Required', message: `Choose a colour for the ${role}.` });
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

/**
 * True for an issue with the **building** — its dimensions, bays, pitch or design rules.
 *
 * Only these stop the operator moving to Options and Cost: a plan and a price are facts about the
 * building, and a salesperson often draws the shed before they have the customer's email. Customer,
 * site, colour and option issues block **Save** only.
 */
export function isBuildingIssue(path: string): boolean {
  return path.startsWith('shed-') || path.startsWith('design-');
}

export function evaluateGate(input: {
  dirty: boolean;
  issues: readonly DraftIssue[];
  pricedAt: 'none' | 'stale' | 'current';
  saving: boolean;
  /** A price the editor fetched on its own is on the way — the stale price is being replaced. */
  refreshing?: boolean;
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
  if (input.refreshing === true) {
    // The editor is already replacing the price (a building or money change, or after a save):
    // "calculate it again" would ask for a press that is happening anyway, and a refresh that blocks
    // on its own still needs a sentence, or the line under a disabled button is empty.
    if (input.pricedAt !== 'none') reasons.push('Updating the price…');
  } else if (input.pricedAt === 'stale') {
    reasons.push('The building changed after the price was calculated — calculate it again.');
  }

  return { blocked: reasons.length > 0 || input.saving || input.refreshing === true, reasons };
}
