/**
 * The rules around adding an option: what may be placed, and why not.
 *
 * ## What this is, and what it is not
 *
 * The desktop had a `ProposeAdd` layer — fourteen `IProposeAdd*` interfaces, each bound to its own IoC
 * container and DTO model — that could refuse a placement, adjust its size to fit, or offer to remove
 * something in the way. That layer **cannot be ported**: it depends on a plan model this build does
 * not have, and reproducing it would mean reproducing the desktop's object graph.
 *
 * What is here instead is the part that matters and can be stated plainly: **a placement is checked
 * against the building, and a refusal says why.** Every rule below is one a person can read and
 * disagree with, which is the test of whether a rule belongs in code at all.
 *
 * ## Why a refusal is a sentence
 *
 * "Cannot add" with no reason is how a button comes to look broken. Each refusal names the thing that
 * is in the way and what to do about it, because the operator's next action is the point of the
 * message.
 *
 * ## What is deliberately not here
 *
 * - **No automatic resizing.** The desktop shrank a mezzanine to fit; silently placing something
 *   smaller than asked is a quote for a building nobody designed. A refusal is honest, and the
 *   operator can adjust the shed or the option.
 * - **No cascade on removal.** The desktop restored a column when a carry beam was removed. That is a
 *   second object appearing because a first one went, and it belongs with a proper undo, which this
 *   build already has — `removeOption` is one history entry, and Undo puts everything back.
 * - **No interaction rules between options** (two awnings on one wall, a dividing wall through a
 *   door). Those need a plan model to test against; until then they are the operator's judgement, and
 *   a rule that guesses is worse than no rule.
 */

import type { OptionKind, ShedConfig, ShedOption } from './types';
import { resolveOption } from './options';

/** Why a placement was refused, addressed to a person. */
export interface PlacementRefusal {
  kind: OptionKind;
  /** A sentence: what is in the way, and what to do. */
  reason: string;
}

/** The clear space a mezzanine needs above its slab, mm. Mirrors `MEZZ_HEADROOM` in `options.ts`. */
const MEZZ_HEADROOM = 300;

/** The smallest shed a dividing wall can sit inside, mm — two margins plus a wall. */
const DIVIDING_MIN_RUN = 900;

/**
 * Whether `kind` may be added to `shed`, and why not.
 *
 * Returns `null` when the placement is allowed. The check is **read-only**: it never changes the
 * config, so a caller can ask before it acts.
 */
export function refusePlacement(kind: OptionKind, shed: ShedConfig): PlacementRefusal | null {
  switch (kind) {
    case 'gable_infill': {
      // A gable end is closed or open; both being filled is the finished state.
      const filled = new Set(
        shed.options
          .filter((option): option is Extract<ShedOption, { kind: 'gable_infill' }> => option.kind === 'gable_infill')
          .map((option) => option.end),
      );
      if (filled.has('front') && filled.has('back')) {
        return { kind, reason: 'Both gable ends are already closed. Remove one to change it.' };
      }
      return null;
    }

    case 'mezzanine': {
      /*
       * A mezzanine needs room above its slab, and `normaliseOption` clamps the level to
       * `height - 300`. When the walls are lower than the minimum level plus that clearance, the
       * clamp has nowhere to go and the option would be placed at a level a person cannot stand on.
       */
      const minimumLevel = 2100;
      if (shed.height < minimumLevel + MEZZ_HEADROOM) {
        return {
          kind,
          reason: `A mezzanine needs walls of at least ${minimumLevel + MEZZ_HEADROOM} mm to stand on at ${minimumLevel} mm. This shed's walls are ${shed.height} mm — raise them, or use a different option.`,
        };
      }
      return null;
    }

    case 'dividing_wall': {
      // `normaliseOption` clamps `at` between two 300 mm margins; a shed shorter than both has no
      // legal interior position, so the wall would be drawn through an end.
      const run = Math.min(shed.span, shed.length);
      if (run < DIVIDING_MIN_RUN) {
        return {
          kind,
          reason: `A dividing wall needs at least ${DIVIDING_MIN_RUN} mm of interior to sit in. This shed is ${run} mm across its narrow side.`,
        };
      }
      return null;
    }

    case 'stable': {
      // A stable is a shelter attached to a wall; it needs a wall long enough to sit on.
      const shortestWall = Math.min(shed.span, shed.length);
      if (shortestWall < 1500) {
        return {
          kind,
          reason: `A stable needs a wall of at least 1500 mm. This shed's shortest wall is ${shortestWall} mm.`,
        };
      }
      return null;
    }

    case 'skylight': {
      // The roof has to have room for the pane between the eaves.
      const smallest = Math.min(shed.span, shed.length);
      if (smallest < 900) {
        return { kind, reason: 'A skylight needs a roof at least 900 mm across.' };
      }
      return null;
    }

    case 'overhang':
    case 'horizontal_cladding': {
      /*
       * These span their whole wall, so a second one is a duplicate drawn on top of the first —
       * `canDuplicate` already says so. Adding one when one exists is the same mistake by another
       * route, and the desktop silently stacked them.
       */
      if (shed.options.some((option) => option.kind === kind)) {
        return {
          kind,
          reason:
            kind === 'overhang'
              ? 'There is already an overhang. It spans a whole wall, so a second one would sit exactly on top. Change the existing one instead.'
              : 'There is already a cladding band. It spans a whole wall, so a second one would sit exactly on top. Change the existing one instead.',
        };
      }
      return null;
    }

    // Every other kind has a position along its wall or across the bays, so a second instance is
    // visibly somewhere else and there is nothing to refuse.
    default:
      return null;
  }
}

/**
 * Every refusal for every kind, for a screen that wants to explain the catalogue.
 *
 * A place-button that is disabled needs a reason next to it, and asking `refusePlacement` per kind is
 * the same answer in one call.
 */
export function placementRefusals(shed: ShedConfig, kinds: readonly OptionKind[]): PlacementRefusal[] {
  return kinds.flatMap((kind) => {
    const refusal = refusePlacement(kind, shed);
    return refusal === null ? [] : [refusal];
  });
}

/**
 * Options that no longer fit the building after it changed.
 *
 * Called when a dimension moves. `normaliseOption` clamps every option into the new bounds, so nothing
 * is ever drawn outside the shed — but a clamped option can be a **different thing** from what the
 * operator placed: a mezzanine whose level dropped to the new ceiling is no longer a mezzanine anyone
 * can stand on.
 *
 * This reports them rather than removing them. Removing an object because a wall moved is a silent
 * edit to a quote, and the operator is the only one who knows whether the mezzanine should go or the
 * wall should come back.
 */
export function optionsThatNoLongerFit(shed: ShedConfig): { id: string; kind: OptionKind; reason: string }[] {
  const problems: { id: string; kind: OptionKind; reason: string }[] = [];

  for (const option of shed.options) {
    if (option.kind === 'mezzanine' && shed.height < 2100 + MEZZ_HEADROOM) {
      problems.push({
        id: option.id,
        kind: option.kind,
        reason: `The walls are now ${shed.height} mm, too low for a mezzanine at 2100 mm.`,
      });
      continue;
    }

    if (option.kind === 'dividing_wall' && Math.min(shed.span, shed.length) < DIVIDING_MIN_RUN) {
      problems.push({
        id: option.id,
        kind: option.kind,
        reason: 'The shed is now too narrow for a dividing wall.',
      });
      continue;
    }

    /*
     * A resolved option whose footprint is zero on either axis is one the geometry could not place —
     * a skylight wider than the roof, an awning longer than its wall. `resolveOption` clamps rather
     * than throwing, so this is the only signal that the shape is degenerate.
     */
    const resolved = resolveOption(option, shed);
    if (resolved.rect.width <= 0 || resolved.rect.height <= 0) {
      problems.push({
        id: option.id,
        kind: option.kind,
        reason: 'This option no longer fits the building and is drawn with no size.',
      });
    }
  }

  return problems;
}
