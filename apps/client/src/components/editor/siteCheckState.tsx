'use client';

/**
 * The site check, held once for the whole Details step.
 *
 * ## Why a provider rather than a hook called twice
 *
 * Two places on this screen need the same answer: the **ShedSafe panel** (which pins and imports) and
 * the **Design group** (which shows the six certified values read-only). If each fetched
 * `GET /quotes/:id/site-check` itself, the two would race — the panel could show "Rating imported"
 * while the fields beside it still read the values from before the import. One object, one fetch, one
 * truth.
 *
 * It also lets the panel *write* and the group *see*: `replace()` is how an import publishes its result,
 * so the read-only fields update in the same commit as the panel's own status pill.
 *
 * ## Why the type lives here
 *
 * `SiteCheck` was declared inside `SiteCheckPanel.tsx`. The Design group needs it too, so it moved
 * here — the provider owns both the fetch and the shape of what it fetches.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/sq';

/** The six certified fields, as ShedSafe names them. */
export interface SiteCheckValues {
  importanceLevel: number | null;
  windRegion: string | null;
  terrainCategory: number | null;
  buildingClass: string | null;
  snowLoad: number | null;
  designWindSpeed: number | null;
}

/** What a screen gets back for one check. */
export interface SiteCheck {
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
   * The **one** property that answers "is there a rating". `windRegion` is populated before Auto Calc,
   * so a screen that inferred this from a non-empty wind region would be wrong on exactly the sites
   * that matter. Matches `data.AutoCalc && noError` in the desktop.
   */
  calculated: boolean;
  /** The raw readings before Auto Calc. Shown, never priced. */
  provisional: Record<string, unknown> | null;
  values: SiteCheckValues;
  /** The site's geographic readings, or `null` for a check imported before they were stored. */
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
   * A rating is about a building, not a site. `null` for a check pinned before this was recorded —
   * unknown is not "matches", so the panel says it cannot verify rather than claiming agreement.
   */
  pinnedFor: {
    spanMm: number | null;
    heightMm: number | null;
    lengthMm: number | null;
    importanceLevel: number | null;
  } | null;
}

/**
 * How a certified value relates to the quote in front of the operator.
 *
 * Three states, and the third is what the operator acts on:
 *
 * - `unchecked` — no site has been pinned, so there is no certificate. The fields still hold their
 *   defaults, and a quote may be priced from them; it is just not priced from a rating.
 * - `provisional` — ShedSafe holds readings for a pinned building that has **not** been Auto
 *   Calculated. The numbers exist and are **not** a rating; ShedSafe itself says so.
 * - `certified` — Auto Calc ran and the values were imported. This is the only state that answers
 *   "what does the certificate say".
 */
export type SiteCheckState = 'unchecked' | 'provisional' | 'certified';

interface SiteCheckContextValue {
  check: SiteCheck | null;
  /** False when the server has no ShedSafe credentials — then the fields are typed by hand. */
  configured: boolean;
  loading: boolean;
  state: SiteCheckState;
  /** Re-read from the API. Called after pin and import. */
  reload: () => Promise<void>;
  /** Adopt a check the panel just received, so the read-only fields follow in the same commit. */
  replace: (next: SiteCheck | null) => void;
  /**
   * True while the panel is watching ShedSafe for Auto Calc to finish.
   *
   * Shown, not implied: something checking a third-party API every ten seconds has to say so, or the
   * first person to notice it in a network tab will not trust it.
   */
  watching: boolean;
  /** Stop watching. The manual "check and import" button keeps working. */
  stopWatching: () => void;
  /**
   * Why the rating did not arrive: an Auto Calc that failed on ShedSafe's side, or a request that did
   * not come back. `null` while everything is merely slow.
   */
  waitingError: string | null;
}

/**
 * Who the signed-in person is, as ShedSafe knows them.
 *
 * ## Why this is fetched before anything is pinned
 *
 * ShedSafe accepts `Salesman` only if it is an email on **its own** salesman list. Measured
 * 2026-11-10: a display name, the API login name, and an email that had been deleted from the list
 * all fail with *"The salesman provided is not a valid salesman username."* — a sentence that names
 * a wire field and arrives after a press.
 *
 * Asking first turns that into a sentence on screen **before** the operator acts: *"this login is not
 * a registered ShedSafe salesman — ask an administrator to add it"*.
 *
 * ## `null` means "could not tell", not "not a salesman"
 *
 * When ShedSafe cannot be reached the answer is `null` and the panel does **not** block the pin: a
 * failed pre-flight check must not stop an action that might still work. The three states are
 * deliberately distinct — unknown, is one, is not one.
 */
export interface ShedSafeIdentity {
  email: string;
  isSalesman: boolean;
  formattedName: string | null;
  franchiseName: string | null;
  restricted: boolean;
}

interface ShedSafeIdentityValue {
  /** `null` when ShedSafe is unconfigured, unreachable, or nobody is signed in. */
  you: ShedSafeIdentity | null;
  /** Every salesman in the account, for the administrator-facing message. */
  salesmen: ShedSafeIdentity[];
  /** True when the list could not be read — shown, so a blocked pin is not mysterious. */
  listingError: string | null;
  loading: boolean;
}

/**
 * How often the panel asks ShedSafe whether Auto Calc has finished.
 *
 * **Ten seconds, deliberately not five.** One read is ~1 361 bytes and ~300 ms on ShedSafe's side, and
 * a five-second timer is 720 requests an hour for one open panel — the shape of traffic that gets a
 * partner API to rate-limit a company. Ten seconds still feels live to a person who has just pressed a
 * button on another tab, and it halves the traffic.
 *
 * There is no long-poll or webhook to use instead: ShedSafe offers neither, and `autoCalc` is only
 * visible by reading the building.
 */
const AUTO_CALC_POLL_MS = 10_000;

const SiteCheckContext = createContext<SiteCheckContextValue | null>(null);
const IdentityContext = createContext<ShedSafeIdentityValue | null>(null);

export function SiteCheckProvider({
  quoteId,
  children,
}: {
  /** `null` before the first save — a check can still be pinned against the company. */
  quoteId: string | null;
  children: React.ReactNode;
}) {
  const [check, setCheck] = useState<SiteCheck | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [identity, setIdentity] = useState<ShedSafeIdentityValue>({
    you: null,
    salesmen: [],
    listingError: null,
    loading: true,
  });

  /*
   * Read once per step, not per render: the salesman list changes when an administrator adds
   * somebody, which is not while a form is open.
   */
  useEffect(() => {
    let alive = true;
    void api<{
      configured: boolean;
      salesmen: Array<{ email: string; formattedName: string | null; franchiseName: string | null; restricted: boolean }>;
      you: ShedSafeIdentity | null;
      listingError?: string;
    }>('shedsafe/salesmen').then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setIdentity({ you: null, salesmen: [], listingError: result.message, loading: false });
        return;
      }
      setIdentity({
        you: result.data.you,
        salesmen: result.data.salesmen.map((entry) => ({
          email: entry.email,
          isSalesman: true,
          formattedName: entry.formattedName,
          franchiseName: entry.franchiseName,
          restricted: entry.restricted,
        })),
        listingError: result.data.listingError ?? null,
        loading: false,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (quoteId === null) return;
    setLoading(true);
    const result = await api<{ configured: boolean; check: SiteCheck | null }>(`quotes/${quoteId}/site-check`);
    setLoading(false);
    if (result.ok) {
      setConfigured(result.data.configured);
      setCheck(result.data.check);
    }
  }, [quoteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const replace = useCallback((next: SiteCheck | null): void => {
    setCheck(next);
  }, []);

  /*
   * ## Watching for Auto Calc
   *
   * Auto Calc lives in ShedSafe's own web app and there is no API for it — measured, not assumed: the
   * fifteen plausible endpoint names all answer "no such route". So the pin opens a tab we do not
   * control, and the operator finishes the check over there.
   *
   * What makes this watchable is that `autoCalc` sits on the same building record `read()` already
   * fetches, and it flips the instant they finish. One read costs 1 361 bytes and ~300 ms.
   *
   * Three rules, each for a specific reason:
   *
   * 1. **Every 10 seconds, not 5.** Frequent enough to feel live, far enough apart to look like a
   *    person checking rather than a scraper. The operator said so explicitly.
   * 2. **Not while the tab is hidden.** They are on ShedSafe's tab; asking from a background tab is
   *    traffic nobody is looking at.
   * 3. **Immediately on return.** `visibilitychange` is the cheapest and most accurate signal there
   *    is — they just came back from doing the thing, so check then rather than wait out the interval.
   */
  const [watching, setWatching] = useState(true);
  const [waitingError, setWaitingError] = useState<string | null>(null);
  const stopWatching = useCallback((): void => {
    setWatching(false);
  }, []);

  useEffect(() => {
    if (quoteId === null || check === null || check.calculated || !watching) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const checkOnce = async (): Promise<void> => {
      const result = await api<{
        configured: boolean;
        calculated: boolean;
        missing: boolean;
        errorMessage: string | null;
        transientError?: string;
      }>(`site-checks/${check.id}/status`);
      if (!alive) return;

      if (!result.ok) {
        setWaitingError(result.message);
        return;
      }
      setWaitingError(null);

      /*
       * A failed Auto Calc on their side is reported once and stops the watch: `errorMessage` means
       * ShedSafe answered something other than success, and polling it again will say the same thing.
       * Waiting silently would look like the check was still running.
       */
      if (!result.data.missing && result.data.errorMessage !== null && result.data.errorMessage !== '') {
        setWaitingError(result.data.errorMessage);
        setWatching(false);
        return;
      }

      if (result.data.calculated) {
        /*
         * ## Import, then reload — in that order
         *
         * The operator asked for this by pressing Auto Calc; making them come back and press a second
         * button for the same decision is a step that gets missed. So the rating is applied, and the
         * panel says so — a change that happens on its own must never be silent.
         *
         * **`reload()` alone does nothing here, and that was a real defect.** It reads
         * `GET /quotes/:id/site-check`, which answers from the `site_checks` **columns** — and those
         * stay null until an import writes them. So the poll correctly saw `calculated: true`, called
         * `reload()`, got `calculated: false` back from our own database, and the panel went on saying
         * "not Auto Calculated yet" while `still watching` stayed true forever. Measured in the
         * browser: the status route said `true` and the pill never changed.
         *
         * The import is what copies ShedSafe's values into the row; the reload then reads what it
         * wrote. Skipping the first step makes the second a no-op.
         */
        const path =
          quoteId === null ? `site-checks/${check.id}/import` : `quotes/${quoteId}/site-check/import`;
        const imported = await api<{ check: SiteCheck }>(path, { method: 'POST' });
        if (!alive) return;
        setWatching(false);

        if (!imported.ok) {
          // The import is the step that can fail in a way the operator must see; a silent stop would
          // leave the panel reading "not calculated" with no explanation.
          setWaitingError(imported.message);
          return;
        }
        replace(imported.data.check);
        return;
      }

      timer = setTimeout(() => void checkOnce(), AUTO_CALC_POLL_MS);
    };

    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      // Came back from the other tab: ask now rather than wait out the interval.
      if (timer !== null) clearTimeout(timer);
      void checkOnce();
    };

    // The first read waits one interval: the operator has only just left for the other tab.
    timer = setTimeout(() => void checkOnce(), AUTO_CALC_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [quoteId, check, watching, reload]);

  /*
   * The state a field labels itself with.
   *
   * `provisional` needs the check to **have readings**, not merely to exist: a check that was pinned
   * and whose read failed holds nothing, and calling that "provisional" would name a number that is
   * not there. It falls back to `unchecked`, which is the honest description.
   */
  const state: SiteCheckState =
    check === null
      ? 'unchecked'
      : check.calculated
        ? 'certified'
        : check.provisional === null
          ? 'unchecked'
          : 'provisional';

  const value = useMemo(
    () => ({
      check,
      configured,
      loading,
      state,
      reload,
      replace,
      watching: watching && check !== null && !check.calculated,
      stopWatching,
      waitingError,
    }),
    [check, configured, loading, state, reload, replace, watching, stopWatching, waitingError],
  );

  return (
    <SiteCheckContext.Provider value={value}>
      <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>
    </SiteCheckContext.Provider>
  );
}

/**
 * Whether the signed-in person may pin a site check.
 *
 * Must be inside a `SiteCheckProvider`. Returns `you: null` when the answer is unknown, which callers
 * treat as "do not block" — a failed pre-flight check must not stop an action that would work.
 */
export function useShedSafeIdentity(): ShedSafeIdentityValue {
  const value = useContext(IdentityContext);
  if (value === null) {
    throw new Error('useShedSafeIdentity must be used inside <SiteCheckProvider>');
  }
  return value;
}

/** The check for the quote on screen. Must be inside a `SiteCheckProvider`. */
export function useSiteCheck(): SiteCheckContextValue {
  const value = useContext(SiteCheckContext);
  if (value === null) {
    throw new Error('useSiteCheck must be used inside <SiteCheckProvider>');
  }
  return value;
}

/** A number out of a raw block, or `null`. */
export function numberOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** A string out of a raw block, or `null`. */
export function stringOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}
