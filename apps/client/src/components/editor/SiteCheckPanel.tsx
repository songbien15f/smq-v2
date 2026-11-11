'use client';

/**
 * The ShedSafe site check, on the design step.
 *
 * ## What this screen is honest about
 *
 * A ShedSafe **certificate** is issued by the manufacturer through their own ShedSafe account. This
 * product cannot issue one and does not pretend to. What it does is what the desktop did: create the
 * building at ShedSafe, hand the operator a link to finish the check there, then read the six
 * certified numbers back so the quote is priced against a real rating.
 *
 * That is why the button says "Open ShedSafe" and not "Get certified", and why the panel says the
 * certificate is theirs.
 *
 * ## Why the six fields are shown even when empty
 *
 * An empty field is information: it says the check has not been calculated yet. Hiding the panel
 * until it has values would make a pinned-but-uncalculated site look like a site with no check at
 * all, and the operator would pin a second building.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, StatusPill } from '@sq/ui';
import { averageHeightMm } from '@sq/core/domain';
import { Group } from './QuoteDetailsPanel';
import { api } from '@/lib/sq';
import { useDraftStore } from '@/store/useDraftStore';
import {
  numberOf,
  stringOf,
  useShedSafeIdentity,
  useSiteCheck,
  type SiteCheck,
  type SiteCheckValues,
} from './siteCheckState';

export interface SiteCheckPanelProps {
  quoteId: string | null;
  /** What to pin. Absent when the quote has not been saved — a check belongs to a quote. */
  site: { address: string; suburb: string; state: string; postcode: string };
  client: { firstName: string; lastName: string; email: string };
  /**
   * The building as the quote currently stands, used **only** for two things:
   *
   * 1. the "Copy from Shed" offer, which a person presses, and
   * 2. telling the operator when the panel and the quote disagree.
   *
   * It never seeds the panel. The desktop's Building Parameters panel opens with its fields empty and
   * the customer types the dimensions the factory will rate; seeding them from the quote made the one
   * input the certificate depends on a value nobody chose (`SiteCheckPanel` sent `spanMm` etc. straight
   * through, so a default 12 000 × 24 000 × 4 200 building was pinned without a keystroke).
   */
  shed: {
    spanMm: number;
    heightMm: number;
    lengthMm: number;
    importanceLevel: number;
    roofPitchDeg: number;
    structureType: string;
  };
  /** The roof pitches the book sells for a span, for the pitch select. */
  roofPitchHints: number[];
  /**
   * Who is signed in, as the default salesperson.
   *
   * ShedSafe **requires** a salesman and refuses an empty one — "The Salesman field is required",
   * measured against the live API. The desktop sent a literal empty string, so its own site check
   * cannot have worked against the API as it stands today; copying that would have shipped the same
   * failure. The person at the keyboard is the honest default, and they can still type somebody
   * else's name.
   */
  defaultSalesman: string;
  canWrite: boolean;
  /** Called when a rating is imported, so the design fields can take the certified values. */
  onImported?: (values: SiteCheckValues) => void;
}

/** One certified value: what to print, and what it is. */
type Entry = { text: string; state: 'certified' | 'provisional' | 'unchecked'; value: string | number | null };

/** How one of the six fields reads. A null is "not calculated", never a zero. */
function value(value: number | string | null, suffix = ''): string {
  if (value === null) return 'Not calculated yet';
  return `${value}${suffix}`;
}

export function SiteCheckPanel({
  quoteId,
  site,
  client,
  shed,
  roofPitchHints,
  defaultSalesman,
  canWrite,
  onImported,
}: SiteCheckPanelProps) {
  /*
   * The check comes from the provider, not from a fetch here.
   *
   * The Design group renders the same six values read-only, a few hundred pixels above this panel.
   * Two independent fetches would let them disagree — the panel could say "Rating imported" while the
   * fields still showed the pre-import numbers. One provider, one fetch, and an import publishes its
   * result through `replace()` so both update in the same commit.
   */
  const { check, configured, replace, watching, stopWatching, waitingError } = useSiteCheck();
  const identity = useShedSafeIdentity();
  const [busy, setBusy] = useState<'pinning' | 'importing' | null>(null);
  /**
   * The Building Parameters the pin will send — **null until the customer types them**.
   *
   * ## Why this is not seeded from the quote
   *
   * The desktop opens this panel empty and requires it (`ValidateBuildingParametersForButton`,
   * trace §5.3). That is not a UI preference: the four numbers decide what ShedSafe rates, and the
   * rating is the certificate the whole quote is priced against. Seeding them from the Shed group made
   * a value nobody chose into a certified one — the customer's brief is that these inputs are theirs
   * to enter.
   *
   * `null` is a real state here, distinct from `0`: an empty field means "not entered yet", which is
   * why every check below is `=== null` rather than a falsiness test.
   */
  const [params, setParams] = useState<{
    importanceLevel: number | null;
    spanMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    roofPitchDeg: number | null;
  }>({
    importanceLevel: null,
    spanMm: null,
    heightMm: null,
    lengthMm: null,
    roofPitchDeg: null,
  });
  /** The panel is opened by PIN, as the desktop's flyout is — not always expanded. */
  const [paramsOpen, setParamsOpen] = useState(false);
  /**
   * True once a pin has been made from this panel, so re-opening it shows what was sent.
   *
   * Kept separate from `params` so "the field is empty because nobody typed" and "the field is empty
   * because a previous pin used it and the quote changed" cannot be confused.
   */
  const [pinnedParams, setPinnedParams] = useState<typeof params | null>(null);
  /**
   * The salesman is the **signed-in person's email**, and it is not editable.
   *
   * ## What ShedSafe actually accepts
   *
   * Measured against the live API on 2026-11-10, by trying each shape:
   *
   * ```
   * "Dana Nguyen"                     → "The salesman provided is not a valid salesman username."
   * "wdsapi1"        (API login name) → same rejection
   * ""                                → 400 "The Salesman field is required."
   * "owner@demo-sheds.local"          → same rejection (not registered)
   * "songbien15f@gmail.com"           → ACCEPTED, real building id
   * "hoangduy7617@gmail.com"          → ACCEPTED, real building id
   * ```
   *
   * So `Salesman` is an email that must belong to a salesman in the company's own ShedSafe account.
   * A person registered as a salesman is created by an administrator — the old licence server did it
   * through `SalesmanController`, keyed on `Email` — and that same email is this product's user email.
   * One login, one salesman.
   *
   * ## Why it is read-only now
   *
   * It used to be a free-text box defaulting to the display name ("Company Administrator"), which
   * could never work: a display name is not a ShedSafe login, so **every** pin failed with a message
   * about a field the operator had not been shown. Typing somebody else's email would also issue a
   * certificate in their name, which is the one thing site-check attribution exists to prevent.
   *
   * The value is still sent from state so the pin path did not change; the difference is that the
   * operator cannot edit it.
   */
  const salesman = defaultSalesman;
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const setSiteCheckId = useDraftStore((state) => state.setSiteCheckId);

  /**
   * Everything ShedSafe needs before it will create a building, named in this screen's own words.
   *
   * ## The five fields, and why the button is gated on all of them
   *
   * The desktop's PIN button requires First Name, Last Name, Email, Customer Address **and** Site
   * Address (`QuoteDetailsView.Events.cs:2157`, `ValidateMapButtonRequiredFields`). Its own comment on
   * the wider list is the reason: ShedSafe's refusal names a **wire field** ("The SuburbName field is
   * required"), which is a sentence about JSON, not about the form in front of the operator.
   *
   * Two of those five are measured rather than copied: ShedSafe answers an empty `Salesman` with
   * *"The Salesman field is required"* and an empty `SuburbName` with *"The SuburbName field is
   * required"* — measured against the live API on 2026-11-06.
   *
   * ## Deliberately different from the desktop
   *
   * The desktop has two lists that disagree: the button's enable check falls back to a legacy
   * `SiteAddressItem`, while the click handler does not — so a button can look ready, be pressed, and
   * be refused (§4.3 of the trace). Here there is **one** list, used by both the gate and the click,
   * so "enabled" and "will work" cannot drift apart.
   */
  const missingForPin = ((): string[] => {
    const missing: string[] = [];
    if (client.firstName.trim() === '') missing.push('the customer’s first name');
    if (client.lastName.trim() === '') missing.push('the customer’s last name');
    if (client.email.trim() === '') missing.push('the customer’s email');
    if (site.address.trim() === '') missing.push('the site address');
    if (site.suburb.trim() === '') missing.push('the site suburb');
    if (salesman.trim() === '') missing.push('who is doing the check');
    return missing;
  })();

  /**
   * The Building Parameters ShedSafe will be asked to rate — the desktop's own four gates.
   *
   * `ValidateBuildingParametersForButton` (`UcShowBuildingParameterss.cs:1757-1843`) requires each of
   * span, height and length to be at least 100 and the pitch to be greater than zero. The desktop
   * implemented the 100 floor with `MinValue = 100` plus a `Text == "0"` hack, which the trace marks
   * as **not to be ported** — here the field is simply empty (`null`) until somebody types, and the
   * floor is checked as a number.
   */
  const missingParams = ((): string[] => {
    const missing: string[] = [];
    if (params.spanMm === null) missing.push('Span / Width');
    if (params.heightMm === null) missing.push('Height');
    if (params.lengthMm === null) missing.push('Overall Length');
    if (params.roofPitchDeg === null) missing.push('Roof Pitch');
    return missing;
  })();

  /** True when a number is present but below the floor the desktop enforces. */
  const paramsBelowFloor = ((): string[] => {
    const below: string[] = [];
    if (params.spanMm !== null && params.spanMm < 100) below.push('Span / Width');
    if (params.heightMm !== null && params.heightMm < 100) below.push('Height');
    if (params.lengthMm !== null && params.lengthMm < 100) below.push('Overall Length');
    if (params.roofPitchDeg !== null && params.roofPitchDeg <= 0) below.push('Roof Pitch');
    return below;
  })();

  /**
   * The average height the desktop shows read-only, from the panel's own numbers.
   *
   * Computed by the same `averageHeightMm` the Shed group uses, so the two cannot disagree about what
   * an average height is. `null` while the inputs are incomplete — a number computed from two of three
   * inputs is worse than no number.
   */
  const averageHeight =
    params.spanMm === null || params.heightMm === null || params.roofPitchDeg === null
      ? null
      : averageHeightMm({
          structureType: shed.structureType as never,
          span: params.spanMm,
          height: params.heightMm,
          roofPitchDeg: params.roofPitchDeg,
        });

  /** What the panel and the quote disagree about, in words. Empty when they agree. */
  const drifts: string[] = [];
  if (params.spanMm !== null && params.spanMm !== shed.spanMm) {
    drifts.push(`span ${shed.spanMm.toLocaleString('en-AU')} → ${params.spanMm.toLocaleString('en-AU')} mm`);
  }
  if (params.heightMm !== null && params.heightMm !== shed.heightMm) {
    drifts.push(`height ${shed.heightMm.toLocaleString('en-AU')} → ${params.heightMm.toLocaleString('en-AU')} mm`);
  }
  if (params.lengthMm !== null && params.lengthMm !== shed.lengthMm) {
    drifts.push(`length ${shed.lengthMm.toLocaleString('en-AU')} → ${params.lengthMm.toLocaleString('en-AU')} mm`);
  }

  /**
   * Whether this login may pin at all, asked **before** the button is pressed.
   *
   * `identity.you === null` means the answer is unknown — ShedSafe unconfigured, unreachable, or
   * nobody signed in. Unknown does **not** block: a pre-flight check that failed must not stop an
   * action that would work, and the pin has its own error message.
   *
   * `isSalesman === false` does block, because it is a fact about the account rather than a transient
   * failure: ShedSafe measured 2026-11-10 refuses every email not on its list, with a sentence about
   * a field nobody on this screen can see.
   */
  const notASalesman = identity.you !== null && !identity.you.isSalesman;
  /**
   * Three gates now, in the order a person can act on them.
   *
   * `fields` is the quote's own contact/address data, `params` is the Building Parameters panel, and
   * `salesman` is the account — the only one this screen cannot fix. Each is reported separately so
   * the operator is never told to fix something that is not theirs to fix, and never left with a grey
   * button that explains nothing.
   */
  const blockedBy = notASalesman
    ? ('salesman' as const)
    : missingForPin.length > 0
      ? ('fields' as const)
      : missingParams.length > 0 || paramsBelowFloor.length > 0
        ? ('params' as const)
        : null;

  const pin = async (): Promise<void> => {
    /*
     * The salesman check first, because it cannot be fixed from this screen.
     *
     * A disabled button already stops the click, but this handler is also reachable from a keyboard
     * activation of an element that re-enables between renders, and ShedSafe's own refusal is a
     * sentence about a wire field. Answering with the account-level fact is the difference between
     * "something is wrong" and "ask an administrator to add your email".
     */
    if (notASalesman) {
      setMessage({
        tone: 'danger',
        text: `ShedSafe does not know ${salesman} as a salesman, so it will refuse this pin. Ask an administrator to add this email as a salesman in your ShedSafe account.`,
      });
      return;
    }

    /*
     * The same list the button is gated on, reported all at once.
     *
     * The desktop gathers its errors and shows one message; this keeps that. Naming one missing field
     * at a time turns a two-minute setup into a guessing game, because the operator fixes what it says
     * and is told about the next one.
     */
    if (missingForPin.length > 0) {
      setMessage({
        tone: 'danger',
        text:
          missingForPin.length === 1
            ? `ShedSafe needs ${missingForPin[0]}. Fill it in above, then pin the site.`
            : `ShedSafe needs ${missingForPin.slice(0, -1).join(', ')} and ${missingForPin[missingForPin.length - 1]}. Fill them in above, then pin the site.`,
      });
      return;
    }

    /*
     * The Building Parameters, checked here as well as in the button's gate.
     *
     * The desktop validates three times before it opens the browser (trace §5.4) because the button's
     * state can be stale: a value cleared between render and click leaves an enabled button. Doing the
     * same check in the handler is what makes "enabled" and "works" the same fact rather than two.
     */
    if (missingParams.length > 0 || paramsBelowFloor.length > 0 || params.spanMm === null || params.heightMm === null || params.lengthMm === null || params.roofPitchDeg === null) {
      setParamsOpen(true);
      setMessage({
        tone: 'danger',
        text:
          paramsBelowFloor.length > 0
            ? `ShedSafe needs each dimension to be at least 100 mm, and a roof pitch above zero. Check ${paramsBelowFloor.join(', ')} in Building parameters.`
            : `Fill in Building parameters first: ${missingParams.join(', ')}. ShedSafe rates the building those numbers describe.`,
      });
      return;
    }

    setBusy('pinning');
    setMessage(null);

    /*
     * Before the quote exists the check is pinned against the company and linked on the
     * first save. That is the desktop's order, and it is the only one that lets a
     * salesperson finish Step 1 without saving a throwaway revision first.
     */
    const path = quoteId === null ? 'site-checks/pin' : `quotes/${quoteId}/site-check/pin`;
    const result = await api<{ check: SiteCheck | null; locked: boolean }>(path, {
      method: 'POST',
      body: {
        siteAddress: {
          addressLine1: site.address,
          suburb: site.suburb,
          state: site.state,
          postcode: site.postcode,
        },
        client,
        /*
         * The numbers from **this panel**, never the quote's.
         *
         * This is the whole point of the change: ShedSafe rates what the customer entered here, and
         * the quote is then priced against that rating. Sending the Shed group's values meant a
         * default building was certified without anybody choosing its dimensions.
         */
        heightMm: params.heightMm,
        spanMm: params.spanMm,
        lengthMm: params.lengthMm,
        importanceLevel: params.importanceLevel ?? shed.importanceLevel,
        // Who is doing the check. Empty is what the desktop sent; a name is what ShedSafe shows.
        salesman,
      },
    });

    setBusy(null);
    if (result.ok) {
      // Remember what this pin sent, so re-opening the panel shows the rated building rather than
      // five empty boxes that look like the pin never happened.
      setPinnedParams({ ...params });
      replace(result.data.check);
      if (quoteId === null && result.data.check !== null) {
        setSiteCheckId(result.data.check.id);
      }

      /*
       * Open ShedSafe straight away, as the desktop does.
       *
       * The desktop's "GO TO SITECHECK" pins and then calls `Process.Start(mapUrl)` — one action,
       * because the operator's next step is always the same and making them find a link afterwards
       * is a step that gets missed. `window.open` is the browser's equivalent; it is called
       * synchronously inside the click's async continuation, which is what keeps it from being
       * treated as a popup.
       *
       * A blocked popup is not an error: the link stays on the panel, and the message says so.
       */
      const link = result.data.check?.siteLink ?? null;
      const opened = link === null || link === '' ? false : window.open(link, '_blank', 'noopener') !== null;

      setMessage({
        tone: 'ok',
        text:
          link === null || link === ''
            ? 'Pinned. ShedSafe did not return a site link — pin again, or open ShedSafe yourself.'
            : opened
              ? 'Pinned, and ShedSafe is open in a new tab. Pin the location, run Auto Calc, then come back and check the rating.'
              : 'Pinned. Your browser blocked the new tab — use “Open ShedSafe” above, then come back and check the rating.',
      });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const importRating = async (): Promise<void> => {
    const path =
      quoteId === null
        ? check === null
          ? null
          : `site-checks/${check.id}/import`
        : `quotes/${quoteId}/site-check/import`;
    if (path === null) return;

    setBusy('importing');
    setMessage(null);

    const result = await api<{ check: SiteCheck }>(path, { method: 'POST' });

    setBusy(null);
    if (result.ok) {
      const next = result.data.check;
      replace(next);
      if (next.calculated) {
        setMessage({ tone: 'ok', text: 'The certified rating was imported.' });
        onImported?.(next.values);
      } else {
        /*
         * Read, but not calculated. The readings on screen are ShedSafe's current values for a
         * building it has not finished, so they are **shown and not applied** — the design fields
         * keep whatever they had. Saying "imported" here would be the lie this whole guard exists to
         * prevent, and the panel below explains what to do next.
         */
        setMessage(null);
      }
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
  };

  const failed = check !== null && check.status === 'failed';

  /*
   * Whether the building has changed since ShedSafe rated it.
   *
   * ## Why this is not `check.calculated`
   *
   * `calculated` answers "did ShedSafe issue a rating", and it stays true forever once it does. The
   * separate question is "is that rating still about **this** building" — and a shed widened from
   * 12 m to 15 m after the pin keeps its green "Rating imported" while describing a different
   * building. Measured 2026-11-10: nothing in the panel or the API compared the two.
   *
   * A certificate is for a specific span, height, length and importance level. Getting those from
   * ShedSafe and then letting them drift is the same class of error as pricing from a raw
   * `topographicFactor` — the number looks certified and is not.
   *
   * `null` (a check pinned before this was recorded) is **not** reported as stale: it would be a
   * claim the data cannot support. It is reported as unverified, and the sentence says so.
   */
  const pinned = check?.pinnedFor ?? null;
  const drift =
    check !== null && check.calculated && pinned !== null
      ? [
          pinned.spanMm !== null && pinned.spanMm !== shed.spanMm
            ? `span ${pinned.spanMm} → ${shed.spanMm} mm`
            : null,
          pinned.heightMm !== null && pinned.heightMm !== shed.heightMm
            ? `wall height ${pinned.heightMm} → ${shed.heightMm} mm`
            : null,
          pinned.lengthMm !== null && pinned.lengthMm !== shed.lengthMm
            ? `length ${pinned.lengthMm} → ${shed.lengthMm} mm`
            : null,
          pinned.importanceLevel !== null && pinned.importanceLevel !== shed.importanceLevel
            ? `importance level ${pinned.importanceLevel} → ${shed.importanceLevel}`
            : null,
        ].filter((entry): entry is string => entry !== null)
      : [];

  const ratingStale = drift.length > 0;
  /** A rating exists and nothing recorded what it was for — so nothing can vouch for it. */
  const ratingUnverified = check !== null && check.calculated && pinned === null;

  /**
   * One certified value, with what it *is*.
   *
   * Three sources, in this order of trust: a certified import, the raw readings ShedSafe holds, and
   * nothing. `text` is what a person reads; `state` is what the styling and the "provisional" tag key
   * off, so the same markup cannot present an uncertified number as a certified one.
   */
  const entryOf = (
    read: (values: SiteCheckValues) => string | number | null,
    rawKey: string,
    readRaw: (raw: unknown) => string | number | null,
    suffix = '',
  ): Entry => {
    if (check !== null && check.calculated) {
      const v = read(check.values);
      return { text: v === null ? 'Not calculated yet' : `${v}${suffix}`, state: 'certified', value: v };
    }
    if (check !== null && check.provisional !== null) {
      const v = readRaw(check.provisional[rawKey]);
      if (v !== null) return { text: `${v}${suffix}`, state: 'provisional', value: v };
    }
    return { text: '— not from a site check', state: 'unchecked', value: null };
  };

  const importanceShown = entryOf((v) => v.importanceLevel, 'importanceLevel', numberOf);
  const windShown = entryOf((v) => v.windRegion, 'windRegion', stringOf);
  const terrainShown = entryOf((v) => v.terrainCategory, 'terrainCategory', numberOf);
  const buildingClassShown = entryOf((v) => v.buildingClass, 'buildingClass', stringOf);
  const snowShown = entryOf((v) => v.snowLoad, 'snowLoad', numberOf, ' kPa');
  const windSpeedShown = entryOf((v) => v.designWindSpeed, 'designWindSpeed', numberOf, ' m/s');

  /*
   * The same collapsible shell as the other six groups on this step, not a floating card.
   *
   * It reads as the seventh group of Step 1 because that is what it is: the part of the form that
   * answers "what does the certificate say". A `Panel` here made it look like a side feature.
   *
   * Open by default while the site is unchecked, because until a rating exists this is the only thing
   * on the step with work left in it. Collapsed once certified, so a finished step is quiet.
   */
  return (
    <Group
      title="ShedSafe site check"
      issueCount={check === null || !check.calculated ? 1 : 0}
      defaultOpen={check === null || !check.calculated}
    >
      <div className="flex flex-col gap-sq-3">
        <p className="text-sq-micro text-sq-ink-muted">
          The wind rating this quote is priced against. The certificate is issued in your own ShedSafe
          account.
        </p>
        {!configured && (
          <p className="text-sq-body text-sq-ink-muted">
            ShedSafe is not configured on this server, so the wind fields below are typed by hand.
            Set <code>SHEDSAFE_USERNAME</code> and <code>SHEDSAFE_PASSWORD</code> to enable the check.
          </p>
        )}

        {check !== null && (
          <div className="flex flex-wrap items-center gap-sq-2">
            {/*
              Four states, in descending order of "can this be trusted":

                failed      the last attempt errored
                stale       a rating exists but describes a different building
                unverified  a rating exists and nothing recorded what it was for
                ok          a rating exists and matches this building

              `check.calculated` alone is not enough for the first two: it stays true once ShedSafe
              has issued a rating, whether or not the building has since changed underneath it.
            */}
            <StatusPill
              tone={
                failed ? 'danger' : ratingStale ? 'danger' : ratingUnverified ? 'attention' : check.calculated ? 'ok' : 'attention'
              }
              label={
                failed
                  ? 'Last attempt failed'
                  : ratingStale
                    ? 'Rating is for a different building'
                    : ratingUnverified
                      ? 'Rating imported — building not recorded'
                      : check.calculated
                        ? 'Rating imported'
                        : 'Pinned — not Auto Calculated yet'
              }
            />
            <span className="text-sq-micro text-sq-ink-muted">Reference {check.reference}</span>
            {check.siteLink !== null && check.siteLink !== '' && (
              <a
                href={check.siteLink}
                target="_blank"
                rel="noreferrer"
                className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
              >
                Open ShedSafe
              </a>
            )}
          </div>
        )}

        {/*
          The warning for a rating that no longer describes this building.

          `role="alert"`, unlike the not-calculated banner: this appears while the operator is
          editing, not as the result of pressing a button here, so it must interrupt. The list of
          what moved is the whole message — "the rating is out of date" sends a person hunting,
          "span 12 000 → 15 000 mm" tells them what to change back or what to re-rate.
        */}
        {ratingStale && (
          <div role="alert" className="rounded-lg border border-sq-danger/40 bg-sq-danger/5 p-sq-3">
            <p className="text-sq-body font-semibold text-sq-danger">
              The rating is for a different building
            </p>
            <p className="mt-sq-1 text-sq-body text-sq-ink">
              ShedSafe rated this site when the building was:
            </p>
            <ul className="mt-sq-1 flex list-disc flex-col gap-0.5 pl-sq-4 text-sq-body text-sq-ink">
              {drift.map((entry) => (
                <li key={entry} className="sq-numeric">
                  {entry}
                </li>
              ))}
            </ul>
            <p className="mt-sq-2 text-sq-body text-sq-ink">
              The six values below are still the certificate&apos;s, and they are still applied — but
              they were issued for the old size. Pin again and re-run Auto Calc, or change the building
              back.
            </p>
          </div>
        )}

        {/*
          A rating with no record of what it was for.

          Not an error: the check was pinned before this product started recording the parameters, and
          the rating may well be correct. What it cannot be is **verified**, and saying "Rating
          imported" in green would be a claim nothing on this screen supports.
        */}
        {ratingUnverified && (
          <p role="status" className="text-sq-body text-sq-ink-muted">
            This rating was imported before the building&apos;s dimensions were recorded on the check,
            so it cannot be confirmed against the building as it is now. Pin again to be certain.
          </p>
        )}

        {/*
          The warning, when the site has been read but not calculated.

          It is a **banner, not a line of red text**, because this is the state an operator lands in
          every time they pin a site and come back too early — and the consequence of ignoring it is
          a quote priced against a rating nobody issued. The three steps are numbered because "run
          Auto Calc" alone does not say where, and the last one is the step people forget: coming
          back here.

          `role="status"` rather than `alert`: it appears as the result of the operator's own action,
          so it should be announced without interrupting.
        */}
        {check !== null && !check.calculated && (
          <div
            role="status"
            className="rounded-lg border border-sq-attention/40 bg-sq-attention/5 p-sq-3"
          >
            <p className="text-sq-body font-semibold text-sq-attention">
              This site has not been Auto Calculated yet
            </p>
            <p className="mt-sq-1 text-sq-body text-sq-ink">
              ShedSafe has the building, but its wind rating is not issued until Auto Calc runs. The
              figures below are what ShedSafe currently holds — <strong>they are not used to price
              this quote</strong>.
            </p>
            <ol className="mt-sq-2 flex list-decimal flex-col gap-sq-1 pl-sq-4 text-sq-body text-sq-ink">
              <li>
                Open the site in ShedSafe
                {check.siteLink !== null && check.siteLink !== '' ? (
                  <>
                    {' '}
                    —{' '}
                    <a
                      href={check.siteLink}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-sq-brand underline underline-offset-2"
                    >
                      open it now
                    </a>
                  </>
                ) : null}
                .
              </li>
              <li>Pin the location on the map.</li>
              <li>
                Press <strong>Auto Calc</strong> and wait for it to finish.
              </li>
              <li>
                {watching
                  ? 'Come back to this tab — the rating is picked up automatically.'
                  : 'Come back here and press “Check and import the rating”.'}
              </li>
            </ol>
            {check.lastError !== null && check.lastError !== '' && (
              <p className="mt-sq-2 text-sq-body text-sq-danger">{check.lastError}</p>
            )}

            {/*
              The watch, said out loud.

              Auto Calc happens on ShedSafe's own tab and there is no API to trigger or stream it — so
              this panel asks again every ten seconds. Saying so is not decoration: a page quietly
              calling a partner's API on a timer is exactly the behaviour a person should be able to
              see and stop. `aria-live="polite"` because it changes state on its own, so it must be
              announced without stealing focus.
            */}
            <div className="mt-sq-2 flex flex-wrap items-center gap-sq-2 border-t border-sq-attention/30 pt-sq-2">
              {waitingError === null ? (
                <>
                  <span role="status" aria-live="polite" className="text-sq-micro text-sq-ink-muted">
                    {watching
                      ? 'Watching ShedSafe for Auto Calc — checking every 10 seconds. Nothing is saved until it finishes.'
                      : 'Not watching. Press “Check again after Auto Calc” when you are ready.'}
                  </span>
                  {watching && (
                    <Button variant="ghost" onClick={stopWatching}>
                      Stop watching
                    </Button>
                  )}
                </>
              ) : (
                <p role="alert" className="text-sq-micro text-sq-danger">
                  ShedSafe reported a problem: {waitingError}
                </p>
              )}
            </div>
          </div>
        )}

        {check !== null && check.calculated && check.lastError !== null && (
          <p role="alert" className="text-sq-body text-sq-danger">
            {check.lastError}
          </p>
        )}

        {/*
          The provisional block is gone as a separate disclosure.

          It existed because the six-value table only rendered when certified, so there was nowhere to
          show what ShedSafe held in the meantime. The table below renders in all three states now and
          tags the provisional rows itself — one place to look, not two.
        */}

        {/*
          The six values, **always on screen**, in three states.

          Before 2026-11-10 this block only rendered when `calculated === true`, so a quote with no
          site check showed nothing at all — and the operator could not tell "ShedSafe was never
          asked" from "it answered and was empty". A blank area where a table should be is not a
          neutral fact; it reads as a broken panel.

          So each row always renders, and its state says what it is:

            required but unchecked   `—` with "not from a site check"
            pinned, not calculated   the raw value, marked provisional, warned not to price from
            certified                the value, plainly

          `Importance level` behaves differently on purpose: it is editable-by-policy (a certificate
          can say 3 or 4, and this build records what the certificate says; see KNOWN-DEVIATIONS 31),
          so this table shows it as the *rating's* answer rather than duplicating the control.
        */}
        <dl className="grid gap-sq-2 sm:grid-cols-2" aria-label="Certified site values">
          {(
            [
              ['Importance level', importanceShown],
              ['Wind region', windShown],
              ['Terrain category', terrainShown],
              ['Building class', buildingClassShown],
              ['Ground snow load', snowShown],
              ['Design wind speed', windSpeedShown],
            ] as [string, Entry][]
          ).map(([label, entry]) => (
            <div
              key={String(label)}
              className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1"
            >
              <dt className="text-sq-body text-sq-ink-muted">
                {String(label)}
                {entry.state === 'provisional' && (
                  <span className="ml-1 text-sq-micro text-sq-attention">provisional</span>
                )}
              </dt>
              <dd
                className={[
                  'sq-numeric text-sq-body',
                  entry.state === 'certified' ? 'text-sq-ink' : 'text-sq-ink-muted',
                ].join(' ')}
              >
                {entry.text}
              </dd>
            </div>
          ))}
        </dl>

        {/*
          The site's geographic readings, in their own group.

          They are separate from the six above because they answer a different question: the six are
          what the engine priced from, and these are what the certificate says about the *place*.
          Mixing them would suggest the elevation moves the price, which it does not — but an
          engineer checking a quote against its rating needs them, and the desktop showed them under
          "show more parameters".
        */}
        {/*
          Only when the check is calculated. Before that ShedSafe has no readings for the place —
          the provisional block above shows what it holds, and printing a list of "not calculated"
          rows beside it would say the same thing twice.
        */}
        {check !== null && (check.calculated ? check.site !== null : check.provisional !== null) && (
          <details className="rounded-md border border-sq-line px-sq-2 py-sq-2" open>
            <summary className="cursor-pointer text-sq-micro font-medium text-sq-ink">
              Site readings — shielding, topography, elevation and rainfall
            </summary>
            <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
              These describe the place, not the price: nothing here is used to cost the shed.
            </p>
            <dl className="mt-sq-2 grid gap-sq-2 sm:grid-cols-2">
              {[
                ['Shielding', value(check.calculated ? (check.site?.shielding ?? null) : numberOf(check.provisional?.shielding))],
                [
                  'Topographic factor',
                  value(check.calculated ? (check.site?.topographicFactor ?? null) : numberOf(check.provisional?.topographicFactor)),
                ],
                [
                  'Snow region',
                  value(check.calculated ? (check.site?.snowLoadRegion ?? null) : stringOf(check.provisional?.snowLoadRegion)),
                ],
                [
                  'Earthquake hazard factor',
                  value(
                    check.calculated
                      ? (check.site?.earthquakeHazardFactor ?? null)
                      : numberOf(check.provisional?.earthquakeHazardFactor),
                  ),
                ],
                ['Elevation', value(check.calculated ? (check.site?.elevation ?? null) : numberOf(check.provisional?.elevation), ' m')],
                [
                  'Coordinates',
                  (() => {
                    const lat = check.calculated ? (check.site?.latitude ?? null) : numberOf(check.provisional?.latitude);
                    const lng = check.calculated ? (check.site?.longitude ?? null) : numberOf(check.provisional?.longitude);
                    return lat === null || lng === null ? 'Not calculated yet' : `${lat}, ${lng}`;
                  })(),
                ],
                [
                  'Rainfall 100 / 20 year',
                  (() => {
                    const y100 = check.calculated
                      ? (check.site?.rainfallIntensity100Years ?? null)
                      : numberOf(check.provisional?.rainfallIntensity100Years);
                    const y20 = check.calculated
                      ? (check.site?.rainfallIntensity20Years ?? null)
                      : numberOf(check.provisional?.rainfallIntensity20Years);
                    return y100 === null || y20 === null ? 'Not calculated yet' : `${y100} / ${y20} mm/h`;
                  })(),
                ],
                [
                  'Rainfall town',
                  value(
                    check.calculated
                      ? (check.site?.rainfallIntensityTown ?? null)
                      : stringOf(check.provisional?.rainfallIntensityTown),
                  ),
                ],
              ].map(([label, shown]) => (
                <div
                  key={String(label)}
                  className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1"
                >
                  <dt className="text-sq-body text-sq-ink">{String(label)}</dt>
                  <dd className="sq-numeric text-sq-body text-sq-ink">{String(shown)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {message !== null && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={message.tone === 'danger' ? 'text-sq-body text-sq-danger' : 'text-sq-body text-sq-ink'}
          >
            {message.text}
          </p>
        )}

        {configured && canWrite && (
          <div className="flex flex-wrap items-end gap-sq-2">
            {/*
              The salesman, shown but not editable.

              It is the signed-in email because that is what ShedSafe matches against its own list of
              registered salesmen — a display name is rejected, and so is any email the account does
              not hold. Letting the operator type here would either fail (a name) or issue a
              certificate under somebody else's name, which is exactly what attribution is for.

              Rendered as text rather than a disabled input: a disabled field looks like something
              that could be enabled, and this one cannot. The sentence beneath says why.
            */}
            {/*
              ------------------------------------------------ Building parameters

              The desktop's `ShowBuildingParameters` flyout (trace §5), inline rather than floating.

              ## Why it opens empty, and why the pin cannot happen without it

              These four numbers are what ShedSafe rates, and the rating is the certificate the quote is
              priced against. Filling them from the quote made the certificate describe a building nobody
              entered — the reported defect. So each field starts `null`, the pin button is gated on them,
              and "Copy from the quote" is an offer a person presses rather than a default.

              ## Why the average height is here and read-only

              `Avg. Height` is the one row the desktop disables (`Enable = false`): it follows from span,
              height and pitch, and it is the figure a council application asks for. Typing over it would
              print a number the drawing does not show.
            */}
            {paramsOpen && (
              <section
                aria-labelledby="sitecheck-params-title"
                className="flex flex-col gap-sq-2 rounded-md border border-sq-brand/30 bg-sq-brand/[0.03] p-sq-2"
              >
                <div className="flex items-start justify-between gap-sq-2">
                  <div className="flex flex-col">
                    <h4 id="sitecheck-params-title" className="text-sq-body font-medium text-sq-ink">
                      Building parameters
                    </h4>
                    <p className="text-sq-micro text-sq-ink-muted">
                      {missingParams.length === 0 && paramsBelowFloor.length === 0
                        ? 'Complete. ShedSafe will rate the building these numbers describe.'
                        : `${missingParams.length + paramsBelowFloor.length} to fill in. ShedSafe rates the building these numbers describe, so they are entered here rather than taken from the quote.`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-sq-1">
                    {/*
                      The offer the desktop does not have, and the reason it is a button: the four
                      numbers usually *are* the quote's, and typing them again is friction. What must
                      not happen is them being filled without anybody deciding.
                    */}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setParams({
                          importanceLevel: shed.importanceLevel,
                          spanMm: shed.spanMm,
                          heightMm: shed.heightMm,
                          lengthMm: shed.lengthMm,
                          roofPitchDeg: shed.roofPitchDeg > 0 ? shed.roofPitchDeg : null,
                        })
                      }
                    >
                      Copy from the quote
                    </Button>
                    <Button variant="ghost" onClick={() => setParamsOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-sq-2">
                  <label className="flex flex-col gap-sq-1">
                    <span className="text-sq-micro font-medium text-sq-ink">Importance level</span>
                    <select
                      id="sitecheck-params-importanceLevel"
                      value={params.importanceLevel === null ? '' : String(params.importanceLevel)}
                      onChange={(event) =>
                        setParams({
                          ...params,
                          importanceLevel: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                      className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                    >
                      <option value="">Choose a level</option>
                      <option value="1">1 — normal</option>
                      <option value="2">2 — high consequence</option>
                      <option value="3">3 — substantial</option>
                      <option value="4">4 — exceptional</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-sq-1">
                    <span className="text-sq-micro font-medium text-sq-ink">Roof pitch (deg)</span>
                    <select
                      id="sitecheck-params-roofPitchDeg"
                      value={params.roofPitchDeg === null ? '' : String(params.roofPitchDeg)}
                      onChange={(event) =>
                        setParams({
                          ...params,
                          roofPitchDeg: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                      aria-invalid={
                        params.roofPitchDeg !== null && params.roofPitchDeg <= 0 ? true : undefined
                      }
                      className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
                    >
                      <option value="">Choose a pitch</option>
                      {roofPitchHints.map((pitch) => (
                        <option key={pitch} value={pitch}>
                          {pitch}°
                        </option>
                      ))}
                    </select>
                    <span className="text-sq-micro text-sq-ink-muted">
                      {roofPitchHints.length === 0
                        ? 'The price book lists no pitches yet.'
                        : `The book sells ${roofPitchHints.join(', ')}°.`}
                    </span>
                  </label>

                  {(
                    [
                      ['spanMm', 'Span / Width (mm)'],
                      ['heightMm', 'Height (mm)'],
                      ['lengthMm', 'Overall Length (mm)'],
                    ] as const
                  ).map(([key, label]) => {
                    const shown = params[key];
                    const below = shown !== null && shown < 100;
                    return (
                      <label key={key} className="flex flex-col gap-sq-1">
                        <span className="text-sq-micro font-medium text-sq-ink">{label}</span>
                        <input
                          id={`sitecheck-params-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={100}
                          step={50}
                          /*
                           * Empty, not zero: a `0` in this box would be a dimension somebody entered,
                           * and the panel could not tell it from "not filled in yet".
                           */
                          value={shown === null ? '' : shown}
                          onChange={(event) =>
                            setParams({
                              ...params,
                              [key]:
                                event.target.value === ''
                                  ? null
                                  : Math.round(Number(event.target.value)),
                            })
                          }
                          aria-invalid={below || undefined}
                          aria-describedby={below ? `sitecheck-params-${key}-error` : undefined}
                          className={[
                            'min-h-[38px] rounded-md border bg-sq-surface px-sq-2 text-sq-body outline-none',
                            below ? 'border-sq-danger' : 'border-sq-line',
                          ].join(' ')}
                        />
                        {below && (
                          <span
                            id={`sitecheck-params-${key}-error`}
                            role="alert"
                            className="text-sq-micro text-sq-danger"
                          >
                            Must be at least 100 mm.
                          </span>
                        )}
                      </label>
                    );
                  })}

                  <div className="flex flex-col gap-sq-1">
                    <span className="text-sq-micro font-medium text-sq-ink">Avg. height</span>
                    <output
                      id="sitecheck-params-averageHeight"
                      className="sq-numeric min-h-[38px] rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
                    >
                      {averageHeight === null ? '—' : `${averageHeight.toLocaleString('en-AU')} mm`}
                    </output>
                    <span className="text-sq-micro text-sq-ink-muted">
                      Worked out from span, wall height and pitch. It is not typed.
                    </span>
                  </div>
                </div>

                {drifts.length > 0 && (
                  <p role="status" className="text-sq-micro text-sq-attention">
                    The quote is {drifts.join('; ')}. ShedSafe will rate the numbers above, so the price
                    will still come from the quote — change one of the two, or expect a rating for a
                    different building.
                  </p>
                )}

                {(missingParams.length > 0 || paramsBelowFloor.length > 0) && (
                  <p id="sitecheck-params-missing" className="text-sq-micro text-sq-attention">
                    Fill in{' '}
                    {[...missingParams, ...paramsBelowFloor.filter((f) => !missingParams.includes(f))].join(
                      ', ',
                    )}{' '}
                    before ShedSafe can rate this building.
                  </p>
                )}

                {/*
                  The desktop's `GO TO SITECHECK`, inside the panel because that is where it lives
                  (`UcShowBuildingParameterss`): the button is the panel's submit, not a second action
                  beside the site address.

                  Gated on the panel's own completeness **and** the account, so "enabled" and "will
                  work" stay one fact. The reason is written beside it either way.
                */}
                <div className="flex flex-wrap items-center gap-sq-2">
                  <Button
                    variant="primary"
                    loading={busy === 'pinning'}
                    disabled={blockedBy !== null}
                    onClick={() => void pin()}
                  >
                    {check === null ? 'Go to ShedSafe' : 'Pin again and open ShedSafe'}
                  </Button>
                  {blockedBy === 'params' && (
                    <span className="text-sq-micro text-sq-attention">
                      {missingParams.length > 0
                        ? `Still needed: ${missingParams.join(', ')}.`
                        : `Out of range: ${paramsBelowFloor.join(', ')} — each must be at least 100 mm, and the pitch above zero.`}
                    </span>
                  )}
                  {blockedBy === 'salesman' && (
                    <span className="text-sq-micro text-sq-danger">
                      ShedSafe will refuse this login — see the reason beside the salesperson below.
                    </span>
                  )}
                  {blockedBy === null && (
                    <span className="text-sq-micro text-sq-ink-muted">
                      Creates the building on ShedSafe with the numbers above, then opens it.
                    </span>
                  )}
                </div>
              </section>
            )}

            <div className="flex flex-col gap-sq-1">
              <span className="text-sq-micro font-medium text-sq-ink">Salesperson</span>
              <output
                id="sitecheck-salesman"
                className={[
                  'sq-numeric min-h-[38px] rounded-md border px-sq-2 py-sq-1 text-sq-body',
                  notASalesman
                    ? 'border-sq-danger/50 bg-sq-danger/5 text-sq-ink'
                    : 'border-sq-line bg-sq-ground/40 text-sq-ink',
                ].join(' ')}
              >
                {salesman === '' ? '— nobody signed in' : salesman}
              </output>
              {/*
                The state of this login on ShedSafe, said plainly.

                Three answers and three sentences, because "could not check" is not "not a salesman":
                the first must not block anything, the second must. A person who is not on the list is
                told what to do about it — an administrator adds them — instead of being left with a
                refusal that names a JSON field.
              */}
              {notASalesman ? (
                <span id="sitecheck-salesman-state" className="text-sq-micro text-sq-danger">
                  This login is not a registered ShedSafe salesman, so ShedSafe will refuse the pin. Ask
                  an administrator to add <strong>{salesman}</strong> as a salesman in your ShedSafe
                  account.
                  {identity.salesmen.length > 0 && (
                    <>
                      {' '}
                      Registered on this account: {identity.salesmen.map((s) => s.email).join(', ')}.
                    </>
                  )}
                </span>
              ) : identity.you !== null && identity.you.isSalesman ? (
                <span id="sitecheck-salesman-state" className="text-sq-micro text-sq-ink-muted">
                  Registered ShedSafe salesman
                  {identity.you.formattedName === null ? '' : ` — ${identity.you.formattedName}`}
                  {identity.you.franchiseName === null ? '' : `, ${identity.you.franchiseName}`}.
                </span>
              ) : identity.listingError !== null ? (
                <span id="sitecheck-salesman-state" className="text-sq-micro text-sq-attention">
                  Could not confirm this login with ShedSafe ({identity.listingError}). The pin is still
                  worth trying.
                </span>
              ) : (
                <span id="sitecheck-salesman-state" className="text-sq-micro text-sq-ink-muted">
                  The site check is issued under this login. ShedSafe only accepts an email registered as
                  a salesman in your account.
                </span>
              )}
            </div>
            {/*
              Gated on the same list the click handler checks, so "enabled" and "will work" are the
              same fact. The desktop had two lists that disagreed — a button could look ready, be
              pressed, and be refused (trace §4.3).

              The button is **not** disabled with no explanation. When something is missing the reason
              is written beside it, naming every missing field, because a grey button that does not
              say why sends the operator hunting through a form that is 5 800 px tall.
            */}
            {/*
              PIN **opens the panel**; it does not pin.

              That is the desktop's order and the customer's requirement: the button beside the site
              address is the way in, and the numbers ShedSafe rates are entered by a person in the panel
              that follows. The previous behaviour sent the quote's defaults straight to ShedSafe, so a
              building nobody described was certified.
            */}
            <Button
              aria-expanded={paramsOpen}
              aria-controls="sitecheck-params-title"
              onClick={() => {
                /*
                 * Opening shows what the last pin sent, when there was one — otherwise the five empty
                 * fields would read as a bug rather than as "this is yours to fill in".
                 */
                if (pinnedParams !== null && missingParams.length > 0) setParams(pinnedParams);
                setParamsOpen(true);
              }}
            >
              {paramsOpen
                ? 'Building parameters are open'
                : check === null
                  ? 'Set the building to rate'
                  : 'Review the rated building'}
            </Button>
            {/*
              The button is a **way in**, not the action. Saying what is behind it stops the label
              reading as "this will pin", which was true in the previous version and is not any more.
            */}
            {!paramsOpen && (
              <span className="max-w-[22rem] text-sq-micro text-sq-ink-muted">
                Opens the dimensions ShedSafe has to rate. They are yours to enter — nothing is taken
                from the quote unless you press “Copy from the quote”.
              </span>
            )}
            {/*
              Both reasons, not just the one that blocks hardest.

              These were exclusive, so a login that is not a registered salesman was told only about
              the account — and the five empty fields it also had to fill were invisible. An operator
              fixes what the screen names; when the account is the blocker it is an administrator's
              job, and the fields are still this person's. Measured 2026-11-11: with the salesman list
              resolved, this panel stopped naming any missing field at all.
            */}
            {missingForPin.length > 0 && (
              <span className="max-w-[22rem] text-sq-micro text-sq-attention">
                Before pinning, fill in {missingForPin.join(', ')}.
              </span>
            )}
            {notASalesman && (
              <span className="max-w-[22rem] text-sq-micro text-sq-danger">
                ShedSafe will refuse this login — see the reason beside the salesperson above.
              </span>
            )}
            {check !== null && (
              <Button variant="primary" loading={busy === 'importing'} onClick={() => void importRating()}>
                {/* The step people forget: coming back. The label says so. */}
                {check.calculated ? 'Check and import the rating' : 'Check again after Auto Calc'}
              </Button>
            )}
          </div>
        )}

        <p className="text-sq-micro text-sq-ink-muted">
          A ShedSafe certificate is issued by the manufacturer through their own ShedSafe account.
          This panel reads the certified numbers back; it does not issue a certificate.
        </p>
      </div>
    </Group>
  );
}
