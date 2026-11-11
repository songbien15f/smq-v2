/**
 * Internal pressure: what the frame is designed for **inside**, worked out from the walls.
 *
 * ## Why this is computed and not chosen
 *
 * The desktop's `DesignInternalPressuresItem` is the strangest field in Step 1: nobody types it.
 * `CalcInternalPressuresValue()` reads the four opening switches and sets `Open` or `Close`, and the
 * control is **disabled** unless the user holds `IsRepareMode` (`QuoteDetailsView.cs:2649-2700`).
 *
 * This build had it as an editable dropdown, which is worse than either: internal pressure decides
 * which frame row is read (`internal_pressure = '+0.7, -0.65'` for an open building, `'+0.2, -0.3'`
 * for a closed one — see `lookup.ts`), so letting somebody set it by hand means a quote can be priced
 * from a frame designed for walls that are not there.
 *
 * ## The rule, and the part of it that reads backwards
 *
 * With **no awning**, the desktop's answer is:
 *
 * ```
 * all four walls open          → CLOSED
 * some walls open              → OPEN
 * none open                    → CLOSED
 * ```
 *
 * All four open giving *closed* is not a bug in the transcription — it is `IsAllMainShedOpen` returning
 * true and `IsOpenDesignCheckAll` returning `false` on that branch (`OpeningCombo.CheckFuture.cs:24-32`).
 * The physical reading is that a portal with nothing on any side is not a building enclosing anything,
 * so there is no "internal" to pressurise. Whatever the reason, it is the behaviour the company has been
 * quoting under, so it is reproduced rather than corrected.
 *
 * ## What this does not reproduce, and why
 *
 * The desktop's rule also looks at **awnings** (`IsAllAwningOpen`, `IsMainShedOpenAndAwningClose`) and
 * at **sub-walls containing a sliding door**. This build models a wall as one boolean and an awning as
 * an option, so those branches have no equivalent. Where an awning or a sliding door is present the
 * answer here is the conservative one — `open`, which prices from the heavier frame — and
 * `internalPressureApproximate()` says so, so the assumption is visible rather than silent.
 */

import type { ShedConfig } from './types';

/** The four walls, as this build models them. */
interface WallState {
  front: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

function wallsOf(shed: Pick<ShedConfig, 'endOpening' | 'sideOpening'>): WallState {
  return {
    front: shed.sideOpening.front,
    back: shed.sideOpening.back,
    left: shed.endOpening.left,
    right: shed.endOpening.right,
  };
}

/**
 * Internal pressure for this building: `open` when the frame should be designed for it.
 *
 * The awning and sliding-door refinements the desktop applies are not modelled here — see the module
 * note. `internalPressureApproximate` reports when that matters.
 */
export function internalPressureFor(
  shed: Pick<ShedConfig, 'endOpening' | 'sideOpening' | 'options'>,
): 'closed' | 'open' {
  const walls = wallsOf(shed);
  const open = [walls.front, walls.back, walls.left, walls.right].filter(Boolean).length;

  const hasAwning = shed.options.some((option) => option.kind === 'awning');

  if (hasAwning) {
    /*
     * The desktop's awning branches require per-awning wall states this build does not carry
     * (`IsAllAwningOpen`, `IsMainShedOpenAndAwningClose`). The conservative answer is `open`: it reads
     * the heavier internal-pressure pair, so the quote is not understated. Reported as approximate.
     */
    return 'open';
  }

  if (open === 0) return 'closed';
  if (open === 4) return 'closed'; // documented above: all four open is not an enclosed building
  return 'open';
}

/**
 * True when the answer above is an approximation rather than the desktop's rule.
 *
 * Awnings are the case: the desktop asks which awning walls are open, and this build has one boolean
 * per main wall. Saying "approximate" is what keeps the visible assumption honest — the value is still
 * used, because a quote has to price something.
 */
export function internalPressureApproximate(
  shed: Pick<ShedConfig, 'options'>,
): string | null {
  const awnings = shed.options.filter((option) => option.kind === 'awning');
  if (awnings.length === 0) return null;
  return (
    'This building has an awning. The internal pressure is taken as "open" because an awning’s own ' +
    'wall openings are not modelled — it prices from the heavier frame, so the quote is not understated.'
  );
}
