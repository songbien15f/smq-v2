/**
 * The SiteCheck rules as plain functions: what blocks a pin, what has drifted since the rating, and
 * the one-line status the PIN button shows.
 *
 * No React and no store, so the PIN button, the Building parameters popover, the Design group and the
 * Shed group all read the **same** answer — the reason these were lifted out of `SiteCheckPanel`, where
 * each was a local `const` only that panel could see.
 */

import type { ShedConfig } from '@sq/core/domain';
import type { SiteCheck } from './siteCheckState';

type Client = { firstName: string; lastName: string; email: string };
type Site = { address: string; suburb: string; state: string; postcode: string };

/**
 * Everything ShedSafe needs before it will create a building, named in this screen's own words.
 *
 * The desktop's PIN button requires First Name, Last Name, Email, Customer Address **and** Site
 * Address (`QuoteDetailsView.Events.cs:2157`, `ValidateMapButtonRequiredFields`). ShedSafe answers an
 * empty `Salesman` and an empty `SuburbName` with a sentence about a wire field (measured 2026-11-06),
 * so both are named here instead. One list, used by both the gate and the click, so "enabled" and
 * "will work" cannot drift apart.
 */
export function missingForPin(client: Client, site: Site, salesman: string): string[] {
  const missing: string[] = [];
  if (client.firstName.trim() === '') missing.push('the customer’s first name');
  if (client.lastName.trim() === '') missing.push('the customer’s last name');
  if (client.email.trim() === '') missing.push('the customer’s email');
  if (site.address.trim() === '') missing.push('the site address');
  if (site.suburb.trim() === '') missing.push('the site suburb');
  if (salesman.trim() === '') missing.push('who is doing the check');
  return missing;
}

/** The pitch ShedSafe is asked about: `null` until it is above zero (the desktop's `> 0` gate). */
function pitchOf(config: ShedConfig): number | null {
  return config.roofPitchDeg > 0 ? config.roofPitchDeg : null;
}

/**
 * The Building Parameters ShedSafe will be asked to rate — the desktop's own four gates
 * (`ValidateBuildingParametersForButton`, `UcShowBuildingParameterss.cs:1757-1843`).
 */
export function missingParams(config: ShedConfig): string[] {
  const missing: string[] = [];
  if (config.span === null) missing.push('Span / Width');
  if (config.height === null) missing.push('Height');
  if (config.length === null) missing.push('Overall Length');
  if (pitchOf(config) === null) missing.push('Roof Pitch');
  return missing;
}

/** A number present but below the 100 mm floor the desktop enforces. */
export function paramsBelowFloor(config: ShedConfig): string[] {
  const below: string[] = [];
  const pitch = pitchOf(config);
  if (config.span !== null && config.span < 100) below.push('Span / Width');
  if (config.height !== null && config.height < 100) below.push('Height');
  if (config.length !== null && config.length < 100) below.push('Overall Length');
  if (pitch !== null && pitch <= 0) below.push('Roof Pitch');
  return below;
}

export type BlockedBy = 'salesman' | 'fields' | 'params' | null;

/**
 * Three gates, in the order a person can act on them: the account (the only one this screen cannot
 * fix), then the quote's contact and address, then the Building parameters.
 */
export function blockedBy(a: {
  notASalesman: boolean;
  missingForPin: string[];
  missingParams: string[];
  paramsBelowFloor: string[];
}): BlockedBy {
  if (a.notASalesman) return 'salesman';
  if (a.missingForPin.length > 0) return 'fields';
  if (a.missingParams.length > 0 || a.paramsBelowFloor.length > 0) return 'params';
  return null;
}

export type DriftField = 'span' | 'height' | 'length' | 'importanceLevel';
export interface DriftEntry {
  field: DriftField;
  from: number;
  /** `null` when the quote no longer states the value. */
  to: number | null;
}

/**
 * Whether the building has changed since ShedSafe rated it.
 *
 * `calculated` answers "did ShedSafe issue a rating" and stays true forever; this answers "is that
 * rating still about **this** building". A shed widened from 12 m to 15 m after the pin would
 * otherwise keep a green rating that describes a different building.
 *
 * `pinnedFor === null` (a check pinned before this was recorded) is **not** drift — it would be a claim
 * the data cannot support; `isRatingUnverified` reports it instead.
 */
export function driftOf(check: SiteCheck | null, config: ShedConfig): DriftEntry[] {
  const pinned = check?.pinnedFor ?? null;
  if (check === null || !check.calculated || pinned === null) return [];
  const entries: DriftEntry[] = [];
  if (pinned.spanMm !== null && pinned.spanMm !== config.span) {
    entries.push({ field: 'span', from: pinned.spanMm, to: config.span });
  }
  if (pinned.heightMm !== null && pinned.heightMm !== config.height) {
    entries.push({ field: 'height', from: pinned.heightMm, to: config.height });
  }
  if (pinned.lengthMm !== null && pinned.lengthMm !== config.length) {
    entries.push({ field: 'length', from: pinned.lengthMm, to: config.length });
  }
  if (pinned.importanceLevel !== null && pinned.importanceLevel !== config.importanceLevel) {
    entries.push({
      field: 'importanceLevel',
      from: pinned.importanceLevel,
      to: config.importanceLevel as number,
    });
  }
  return entries;
}

/** The sentence fragment for one drift, exactly as the old panel worded it. */
export function driftText(entry: DriftEntry): string {
  const mm = entry.to === null ? 'not entered' : `${entry.to} mm`;
  switch (entry.field) {
    case 'span':
      return `span ${entry.from} → ${mm}`;
    case 'height':
      return `wall height ${entry.from} → ${mm}`;
    case 'length':
      return `length ${entry.from} → ${mm}`;
    case 'importanceLevel':
      return `importance level ${entry.from} → ${entry.to}`;
  }
}

/** A rating exists and nothing recorded what it was for — so nothing can vouch for it. */
export function isRatingUnverified(check: SiteCheck | null): boolean {
  return check !== null && check.calculated && check.pinnedFor === null;
}

export type StatusTone = 'neutral' | 'attention' | 'ok' | 'danger';

/** The one line beside PIN (spec §4.1), checked in the order a person needs to hear it. */
export function siteCheckStatus(a: {
  check: SiteCheck | null;
  drift: DriftEntry[];
  unverified: boolean;
  watching: boolean;
  waitingError: string | null;
}): { tone: StatusTone; label: string } {
  const { check } = a;
  if (a.waitingError !== null || (check !== null && check.status === 'failed')) {
    return { tone: 'danger', label: "ShedSafe didn't respond · try again" };
  }
  if (check === null) return { tone: 'neutral', label: 'Not pinned' };
  /*
   * The server's last read or import error, kept on the check across sessions. Before a rating it is
   * why the check is stuck, so it outranks "waiting"; after one the certificate still stands and the
   * error is shown beside it instead (popover and Design).
   */
  if (!check.calculated && check.lastError !== null && check.lastError !== '') {
    return { tone: 'danger', label: 'ShedSafe reported a problem · open for details' };
  }
  if (!check.calculated) {
    return {
      tone: 'attention',
      label: `Pinned · waiting for Auto Calc${a.watching ? ' · checking…' : ''}`,
    };
  }
  if (a.drift.length > 0) {
    return { tone: 'danger', label: 'Certified for different dimensions · pin again' };
  }
  if (a.unverified) return { tone: 'attention', label: 'Certified · dimensions not recorded' };
  return { tone: 'ok', label: `Certified · Ref ${check.reference}` };
}
