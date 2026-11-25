'use client';

import type { GuestEnclosure } from '@sq/core/domain';
import { useGuest } from '../store';
import { IconWind } from './icons';

/**
 * The wind/hazard line under the address (plan G-a2 S4, Q3).
 *
 * "Region B · 10a Enclosed · Importance Level 2", with **"Indicative — an estimator confirms these"**
 * always beneath it. The customer asked for exactly this line; the disclaimer is what keeps it honest.
 *
 * ## What is deliberately absent
 *
 * - **No wind speed.** The Standard's Table 3.1 could not be sourced in this session, and printing a
 *   number carries far more liability than printing a region name
 *   (`docs/research/wind-regions-as1170-2.md` §4).
 * - **No line at all for a Class 1 House.** A dwelling is not a Class 10a building, and the page has
 *   no estimate to give it (`guestSiteEstimate` answers `null` for an `enquiry` type).
 * - **No guessed region.** `region === null` means "near a boundary, or we could not place the
 *   address"; the component then says "Wind region" and lists the building facts without a letter.
 */

const ENCLOSURE: Record<GuestEnclosure, string> = {
  enclosed: 'Enclosed',
  roof_only: 'Roof Only',
};

export function SiteEstimate({
  enclosure,
  mode,
}: {
  enclosure: GuestEnclosure;
  /** `enquiry` shows nothing: a Class 1 House is not a 10a building (Q1). */
  mode: 'design' | 'enquiry';
}) {
  const region = useGuest((s) => s.estimate);
  if (mode === 'enquiry') return null;

  /*
   * One message, one direction: "this is our reading; an estimator confirms it".
   *
   * "Wind region confirmed in your quote" was ambiguous — it could read as "already confirmed" or as
   * "will be". With no region letter there is nothing to confirm yet, so the line simply drops the
   * letter and keeps the building facts.
   */
  const facts = `10a ${ENCLOSURE[enclosure]} · Importance Level 2`;

  return (
    <aside className="g-wind" aria-labelledby="g-wind-title">
      <span className="g-wind-icon">
        <IconWind />
      </span>
      <div>
        <h3 id="g-wind-title" className="g-wind-title">
          {region === null ? 'Wind region' : `Region ${region}`}
        </h3>
        <p className="g-wind-line">
          {region === null ? null : `Region ${region} · `}
          {/* `title` alone is hover-only; the line under it says the same thing on a phone. */}
          <abbr title="Class 10a: a non-habitable building such as a shed, garage or carport">10a</abbr>{' '}
          {ENCLOSURE[enclosure]} · Importance Level 2
        </p>
        <p className="g-wind-note">Indicative — an estimator confirms these in your quote.</p>
        <p className="g-wind-note">Class 10a = shed, garage or carport (non-habitable).</p>
      </div>
    </aside>
  );
}
