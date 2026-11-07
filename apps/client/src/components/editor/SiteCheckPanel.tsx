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

  const pin = async (): Promise<void> => {
    /*
     * What ShedSafe will refuse, refused here first.
     *
     * Both requirements were measured against the live API on 2026-11-06 rather than assumed: it
     * answers an empty salesperson with *"The Salesman field is required"* and an empty suburb with
     * *"The SuburbName field is required"*. Those sentences name wire fields, and the second names
     * one that does not appear on this screen at all — so the check happens before the call, in the
     * form's own words.
     */
    const missing: string[] = [];
    if (salesman.trim() === '') missing.push('who is doing the check');
    if (site.suburb.trim() === '') missing.push('the site suburb');
    if (missing.length > 0) {
      setMessage({
        tone: 'danger',
        text: `ShedSafe needs ${missing.join(' and ')}. Fill it in above, then pin the site again.`,
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

  const stale = check !== null && check.status === 'failed';

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
            <StatusPill
              tone={check.calculated ? 'ok' : stale ? 'danger' : 'attention'}
              label={
                check.calculated
                  ? 'Rating imported'
                  : stale
                    ? 'Last attempt failed'
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
              Disabled while empty, with the reason beside it. ShedSafe refuses an empty salesman, so
              a working button here would only produce a rejection in somebody else's words.
            */}
            <Button
              loading={busy === 'pinning'}
              disabled={salesman.trim() === ''}
              onClick={() => void pin()}
            >
              {check === null ? 'Go to ShedSafe' : 'Pin again and open ShedSafe'}
            </Button>
            {salesman.trim() === '' && (
              <span className="text-sq-micro text-sq-attention">
                ShedSafe requires a salesperson name.
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
