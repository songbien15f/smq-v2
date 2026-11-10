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
    () => ({ check, configured, loading, state, reload, replace }),
    [check, configured, loading, state, reload, replace],
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
