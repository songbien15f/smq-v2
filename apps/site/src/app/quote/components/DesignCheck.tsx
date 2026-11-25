'use client';

import { useMemo } from 'react';
import {
  assessGuestDesign,
  guestSiteEstimate,
  type AssessmentItem,
  type GuestBuildingTypeSpec,
  type GuestDesignInput,
} from '@sq/core/domain';
import { useGuest, focusSelector } from '../store';
import type { ToolsGroupId } from '../panels';

/**
 * "Design check" on step ② (plan G-g S9, Q7) — the parts the chip and the rail share.
 *
 * The rules are `assessGuestDesign` in `@sq/core/domain`: arithmetic over the same numbers the quote is
 * built from, so the list is right every time and works with no model, no network and no quota. The
 * assistant (`G-g` S10) explains these items; it does not produce them. Since 2026-11-25 the list lives
 * behind a chip on the stage rather than in a block inside the controls card, because the items belong to
 * different groups and the card now shows one group at a time.
 *
 * ## No price, ever
 *
 * Nothing here says a design costs more. A guest never sees a price (D-T3), and an estimate offered as a
 * warning is still a price. Where the answer matters, the item says an estimator will confirm it.
 */

const LEVEL_LABEL = { ok: 'Fine', note: 'Note', review: 'Check' } as const;

/** The assessment for the design on screen, memoised on the design, the type and the estimated region. */
export function useAssessment(
  design: GuestDesignInput,
  type: GuestBuildingTypeSpec,
): readonly AssessmentItem[] {
  const region = useGuest((s) => s.estimate);
  return useMemo(
    () =>
      assessGuestDesign(
        design,
        type,
        guestSiteEstimate({ region, enclosure: type.config.enclosure, mode: type.config.mode }),
      ),
    [design, type, region],
  );
}

/**
 * Which group a finding's control belongs to.
 *
 * Found from the DOM — the panel for every group is present (hidden when not selected), so the element a
 * `focus` selector names can be asked which `data-group` it sits in. A selector that matches nothing
 * (an item whose control has gone, such as a bay that was removed) is **not** guessed: the caller then
 * shows no dot for it, which is honest about what it could not place.
 */
export function groupForFocus(selector: string | undefined): ToolsGroupId | null {
  if (selector === undefined || typeof document === 'undefined') return null;
  const element = document.querySelector(selector);
  const group = element?.closest('[data-group]')?.getAttribute('data-group');
  return group === 'g-group-size' || group === 'g-group-colours' || group === 'g-group-doors'
    ? group
    : null;
}

/** Findings at `review` level per group, for the rail and drawer dots. */
export function reviewCountsByGroup(items: readonly AssessmentItem[]): Record<ToolsGroupId, number> {
  const counts: Record<ToolsGroupId, number> = { 'g-group-size': 0, 'g-group-colours': 0, 'g-group-doors': 0 };
  for (const item of items) {
    if (item.level !== 'review') continue;
    const group = groupForFocus(item.focus);
    if (group !== null) counts[group] += 1;
  }
  return counts;
}

/** One finding. A finding with a control is a button that takes the guest to it. */
export function CheckItem({ item, onGo }: { item: AssessmentItem; onGo?: () => void }) {
  const body = (
    <>
      <span className={`g-check-dot g-check-dot-${item.level}`} aria-hidden="true" />
      <span className="g-check-text">
        <span className="g-check-title">
          {item.title}
          <span className="g-sr-only"> — {LEVEL_LABEL[item.level]}</span>
        </span>
        <span className="g-check-detail">{item.detail}</span>
      </span>
    </>
  );

  if (item.focus === undefined) {
    return <li className={`g-check-item g-check-${item.level}`}>{body}</li>;
  }
  return (
    <li className={`g-check-item g-check-${item.level}`}>
      {/* Tapping a finding takes the guest to the control that decides it; `focusSelector` opens the
          right group of the card and puts the cursor in it. */}
      <button
        type="button"
        className="g-check-btn"
        onClick={() => {
          onGo?.();
          focusSelector(item.focus ?? null);
        }}
      >
        {body}
      </button>
    </li>
  );
}
