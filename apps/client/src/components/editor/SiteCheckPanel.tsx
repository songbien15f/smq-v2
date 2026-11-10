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
import { Button, Panel, StatusPill } from '@sq/ui';
import { api } from '@/lib/sq';
import { useDraftStore } from '@/store/useDraftStore';

/** The six certified fields, as ShedSafe names them. */
interface SiteCheckValues {
  importanceLevel: number | null;
  windRegion: string | null;
  terrainCategory: number | null;
  buildingClass: string | null;
  snowLoad: number | null;
  designWindSpeed: number | null;
}

interface SiteCheck {
  id: string;
  buildingId: string | null;
  reference: string;
  siteLink: string | null;
  status: string;
  lastError: string | null;
  pinnedAt: string;
  importedAt: string | null;
  /**
   * True only when ShedSafe has Auto Calculated the building and reported no error.
   *
   * The **one** property that answers "is there a rating". `windRegion` is populated before Auto
   * Calc, so a screen that inferred this from a non-empty wind region would be wrong on exactly the
   * sites that matter. Matches `data.AutoCalc && noError` in the desktop.
   */
  calculated: boolean;
  /**
   * The raw readings ShedSafe returns before Auto Calc.
   *
   * Shown, never priced: the six `values` stay null until the site is calculated, because a quote
   * priced from a raw `topographicFactor` is a quote against a rating nobody issued.
   */
  provisional: Record<string, unknown> | null;
  values: SiteCheckValues;
  /**
   * The site's geographic readings, or `null` for a check imported before they were stored.
   *
   * Separate from `values` on purpose: those six price the building, these describe the place.
   * `null` means "never fetched", which is different from a site at sea level with no rain.
   */
  site: {
    shielding: number | null;
    topographicFactor: number | null;
    snowLoadRegion: string | null;
    earthquakeHazardFactor: number | null;
    elevation: number | null;
    latitude: number | null;
    longitude: number | null;
    rainfallIntensity100Years: number | null;
    rainfallIntensity20Years: number | null;
    rainfallIntensityTown: string | null;
  } | null;
  /**
   * What the building was when ShedSafe was asked to rate it.
   *
   * The rating is about a **building**, not a site. A shed widened from 12 m to 15 m after the pin is
   * not the shed the certificate describes, and `calculated` alone cannot say so — it only knows that
   * a rating exists.
   *
   * `null` for a check pinned before this was recorded. Unknown is not "matches": the panel says it
   * cannot tell, rather than showing green agreement it has not verified.
   */
  pinnedFor: {
    spanMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    importanceLevel: number | null;
  } | null;
}

export interface SiteCheckPanelProps {
  quoteId: string | null;
  /** What to pin. Absent when the quote has not been saved — a check belongs to a quote. */
  site: { address: string; suburb: string; state: string; postcode: string };
  client: { firstName: string; lastName: string; email: string };
  heightMm: number;
  spanMm: number;
  lengthMm: number;
  importanceLevel: number;
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

/** How one of the six fields reads. A null is "not calculated", never a zero. */
function value(value: number | string | null, suffix = ''): string {
  if (value === null) return 'Not calculated yet';
  return `${value}${suffix}`;
}

/**
 * A number out of the provisional block, or `null`.
 *
 * The block is `Record<string, unknown>` because it is ShedSafe's own JSON, so every read has to be
 * checked. A cast would compile and then print `undefined` on screen the first time the upstream
 * renamed a field.
 */
function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** A string out of the provisional block, or `null`. */
function str(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

export function SiteCheckPanel({
  quoteId,
  site,
  client,
  heightMm,
  spanMm,
  lengthMm,
  importanceLevel,
  defaultSalesman,
  canWrite,
  onImported,
}: SiteCheckPanelProps) {
  const [check, setCheck] = useState<SiteCheck | null>(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState<'pinning' | 'importing' | null>(null);
  /**
   * Who is doing the check, as ShedSafe shows it on their side.
   *
   * Defaults to the signed-in person but stays editable, because the salesperson who arranged a site
   * visit is often not the person at the keyboard. It must never be **empty**: ShedSafe refuses that
   * with "The Salesman field is required", so the button is disabled until there is something to
   * send rather than letting the pin fail on their side.
   */
  const [salesman, setSalesman] = useState(defaultSalesman);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const setSiteCheckId = useDraftStore((state) => state.setSiteCheckId);

  const load = useCallback(async (): Promise<void> => {
    if (quoteId === null) return;
    const result = await api<{ configured: boolean; check: SiteCheck | null }>(`quotes/${quoteId}/site-check`);
    if (result.ok) {
      setConfigured(result.data.configured);
      setCheck(result.data.check);
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const pin = async (): Promise<void> => {
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
        heightMm,
        spanMm,
        lengthMm,
        importanceLevel,
        // Who is doing the check. Empty is what the desktop sent; a name is what ShedSafe shows.
        salesman,
      },
    });

    setBusy(null);
    if (result.ok) {
      setCheck(result.data.check);
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
      setCheck(next);
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
          pinned.spanMm !== null && pinned.spanMm !== spanMm
            ? `span ${pinned.spanMm} → ${spanMm} mm`
            : null,
          pinned.heightMm !== null && pinned.heightMm !== heightMm
            ? `wall height ${pinned.heightMm} → ${heightMm} mm`
            : null,
          pinned.lengthMm !== null && pinned.lengthMm !== lengthMm
            ? `length ${pinned.lengthMm} → ${lengthMm} mm`
            : null,
          pinned.importanceLevel !== null && pinned.importanceLevel !== importanceLevel
            ? `importance level ${pinned.importanceLevel} → ${importanceLevel}`
            : null,
        ].filter((entry): entry is string => entry !== null)
      : [];

  const ratingStale = drift.length > 0;
  /** A rating exists and nothing recorded what it was for — so nothing can vouch for it. */
  const ratingUnverified = check !== null && check.calculated && pinned === null;

  return (
    <Panel
      title="ShedSafe site check"
      description="The wind rating this quote is priced against. The certificate is issued in your own ShedSafe account."
    >
      <div className="flex flex-col gap-sq-3">
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
              <li>Come back here and press “Check and import the rating”.</li>
            </ol>
            {check.lastError !== null && check.lastError !== '' && (
              <p className="mt-sq-2 text-sq-body text-sq-danger">{check.lastError}</p>
            )}
          </div>
        )}

        {check !== null && check.calculated && check.lastError !== null && (
          <p role="alert" className="text-sq-body text-sq-danger">
            {check.lastError}
          </p>
        )}

        {/*
          The provisional readings, in their own block and visibly marked.

          Shown because "not calculated" alone leaves the operator wondering whether ShedSafe was
          even reached. Marked because a number on a screen is a number somebody will quote from.
        */}
        {check !== null && !check.calculated && check.provisional !== null && (
          <details className="rounded-md border border-sq-line px-sq-2 py-sq-2">
            <summary className="cursor-pointer text-sq-micro font-medium text-sq-ink">
              What ShedSafe currently holds (provisional — not a rating)
            </summary>
            <dl className="mt-sq-2 grid gap-sq-2 sm:grid-cols-2">
              {[
                ['Importance level', value(num(check.provisional.importanceLevel))],
                ['Wind region', value(str(check.provisional.windRegion))],
                ['Terrain category', value(num(check.provisional.terrainCategory))],
                ['Building class', value(str(check.provisional.buildingClass))],
                ['Ground snow load', value(num(check.provisional.snowLoad), ' kPa')],
                ['Design wind speed', value(num(check.provisional.designWindSpeed), ' m/s')],
              ].map(([label, shown]) => (
                <div
                  key={String(label)}
                  className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1"
                >
                  <dt className="text-sq-body text-sq-ink-muted">{String(label)}</dt>
                  <dd className="sq-numeric text-sq-body text-sq-ink-muted">{String(shown)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {check !== null && check.calculated && (
          <dl className="grid gap-sq-2 sm:grid-cols-2">
            {[
              ['Importance level', value(check.values.importanceLevel)],
              ['Wind region', value(check.values.windRegion)],
              ['Terrain category', value(check.values.terrainCategory)],
              ['Building class', value(check.values.buildingClass)],
              ['Ground snow load', value(check.values.snowLoad, ' kPa')],
              ['Design wind speed', value(check.values.designWindSpeed, ' m/s')],
            ].map(([label, shown]) => (
              <div key={String(label)} className="flex items-baseline justify-between gap-sq-2 border-b border-sq-line/60 pb-1">
                <dt className="text-sq-body text-sq-ink">{String(label)}</dt>
                <dd className="sq-numeric text-sq-body text-sq-ink">{String(shown)}</dd>
              </div>
            ))}
          </dl>
        )}

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
        {check !== null && check.calculated && check.site !== null && (
          <details className="rounded-md border border-sq-line px-sq-2 py-sq-2">
            <summary className="cursor-pointer text-sq-micro font-medium text-sq-ink">
              Site readings
            </summary>
            <dl className="mt-sq-2 grid gap-sq-2 sm:grid-cols-2">
              {[
                ['Shielding', value(check.site.shielding)],
                ['Topographic factor', value(check.site.topographicFactor)],
                ['Snow region', value(check.site.snowLoadRegion)],
                ['Earthquake hazard factor', value(check.site.earthquakeHazardFactor)],
                ['Elevation', value(check.site.elevation, ' m')],
                [
                  'Coordinates',
                  check.site.latitude === null || check.site.longitude === null
                    ? 'Not calculated yet'
                    : `${check.site.latitude}, ${check.site.longitude}`,
                ],
                [
                  'Rainfall 100 / 20 year',
                  check.site.rainfallIntensity100Years === null ||
                  check.site.rainfallIntensity20Years === null
                    ? 'Not calculated yet'
                    : `${check.site.rainfallIntensity100Years} / ${check.site.rainfallIntensity20Years} mm/h`,
                ],
                ['Rainfall town', value(check.site.rainfallIntensityTown)],
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
              Who the check is for. Sent to ShedSafe, which shows it on its own screen — so a
              franchise with several salespeople can tell whose site visit this was. Optional: the
              desktop sent an empty string and let the operator decide.
            */}
            <label className="flex flex-col gap-sq-1">
              <span className="text-sq-micro font-medium text-sq-ink">Salesperson</span>
              <input
                type="text"
                value={salesman}
                onChange={(event) => setSalesman(event.target.value.slice(0, 200))}
                placeholder="Who is doing the check"
                required
                className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body text-sq-ink"
              />
            </label>
            {/*
              Gated on the same list the click handler checks, so "enabled" and "will work" are the
              same fact. The desktop had two lists that disagreed — a button could look ready, be
              pressed, and be refused (trace §4.3).

              The button is **not** disabled with no explanation. When something is missing the reason
              is written beside it, naming every missing field, because a grey button that does not
              say why sends the operator hunting through a form that is 5 800 px tall.
            */}
            <Button
              loading={busy === 'pinning'}
              disabled={missingForPin.length > 0}
              onClick={() => void pin()}
            >
              {check === null ? 'Go to ShedSafe' : 'Pin again and open ShedSafe'}
            </Button>
            {missingForPin.length > 0 && (
              <span className="max-w-[22rem] text-sq-micro text-sq-attention">
                Before pinning, fill in {missingForPin.join(', ')}.
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
    </Panel>
  );
}
