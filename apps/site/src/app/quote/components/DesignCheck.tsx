'use client';

import { useMemo } from 'react';
import { assessGuestDesign, guestSiteEstimate, type AssessmentItem, type GuestBuildingTypeSpec, type GuestDesignInput } from '@sq/core/domain';
import { useGuest } from '../store';
import { focusSelector } from '../store';

/**
 * "Design check" on step ② (plan G-g S9, Q7).
 *
 * The rules are `assessGuestDesign` in `@sq/core/domain`: arithmetic over the same numbers the quote
 * is built from, so the card is right every time and works with no model, no network and no quota.
 * The assistant (`G-g` S10) explains these items; it does not produce them.
 *
 * ## No price, ever
 *
 * Nothing here says a design costs more. A guest never sees a price (D-T3), and an estimate offered
 * as a warning is still a price. Where the answer matters, the item says an estimator will confirm it.
 */

const LEVEL_LABEL = { ok: 'Fine', note: 'Note', review: 'Check' } as const;

export function DesignCheck({ design, type }: { design: GuestDesignInput; type: GuestBuildingTypeSpec }) {
  const region = useGuest((s) => s.estimate);

  const items = useMemo(
    () =>
      assessGuestDesign(
        design,
        type,
        guestSiteEstimate({ region, enclosure: type.config.enclosure, mode: type.config.mode }),
      ),
    [design, type, region],
  );

  const reviews = items.filter((i) => i.level === 'review').length;

  return (
    <section className="g-check" aria-labelledby="g-check-title">
      <header className="g-check-head">
        <h3 id="g-check-title" className="g-card-title">
          Design check
        </h3>
        <span className={`g-check-badge${reviews > 0 ? ' g-check-badge-review' : ''}`}>
          {reviews === 0 ? 'Nothing to flag' : reviews === 1 ? '1 to check' : `${reviews} to check`}
        </span>
      </header>
      <ul className="g-check-list">
        {items.map((item) => (
          <CheckItem key={`${item.level}:${item.title}`} item={item} />
        ))}
      </ul>
      <p className="g-hint">Rules, not a guess. An estimator checks every design before quoting.</p>
    </section>
  );
}

function CheckItem({ item }: { item: AssessmentItem }) {
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
      {/* Tapping a finding takes the guest to the control that decides it; the panel opens the
          `<details>` group the target sits in (see `focusSelector`). */}
      <button type="button" className="g-check-btn" onClick={() => focusSelector(item.focus ?? null)}>
        {body}
      </button>
    </li>
  );
}
