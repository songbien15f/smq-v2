'use client';

/**
 * Everything a SiteCheck control can *do*, in one provider: the gates, pin, import, drift, the status
 * line and whether the Building parameters popover is open.
 *
 * ## Why a provider and not the panel
 *
 * Four places read this now — the PIN button beside the site address, the Building parameters popover,
 * the Design group (the single home of the certified values) and the Shed group (one-line drift). Each
 * used to be a local `const` inside `SiteCheckPanel`, so only that panel could answer "is the pin
 * blocked" or "has the building drifted". One provider means the four cannot disagree.
 *
 * `siteCheckState.tsx` still owns the fetch and the Auto Calc watch; this file only acts on it.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { averageHeightMm } from '@sq/core/domain';
import { api } from '@/lib/sq';
import { useDraftStore } from '@/store/useDraftStore';
import { useShedStore } from '@/store/useShedStore';
import {
  useShedSafeIdentity,
  useSiteCheck,
  type SiteCheck,
  type SiteCheckState,
  type SiteCheckValues,
} from './siteCheckState';
import {
  blockedBy as blockedByOf,
  driftOf,
  isRatingUnverified,
  missingForPin as missingForPinOf,
  missingParams as missingParamsOf,
  paramsBelowFloor as paramsBelowFloorOf,
  siteCheckStatus,
  type BlockedBy,
  type DriftEntry,
  type StatusTone,
} from './siteCheckGates';

type Site = { address: string; suburb: string; state: string; postcode: string };
type Client = { firstName: string; lastName: string; email: string };
type ShedSafeIdentityValue = ReturnType<typeof useShedSafeIdentity>;

export interface SiteCheckActionsProps {
  quoteId: string | null;
  site: Site;
  client: Client;
  /** The roof pitches the book sells for the current span, for the popover's pitch select. */
  roofPitchHints: number[];
  /**
   * The signed-in email — the ShedSafe salesman key, and not editable.
   *
   * Measured against the live API 2026-11-10: a display name, the API login name and an unregistered
   * email are all refused; a registered salesman's email is accepted. Letting the operator type here
   * would either fail or issue a certificate in somebody else's name.
   */
  defaultSalesman: string;
  canWrite: boolean;
  /** Called when a rating is imported, so the design fields take the certified values. */
  onImported?: (values: SiteCheckValues) => void;
  children: React.ReactNode;
}

export interface SiteCheckActions {
  configured: boolean;
  canWrite: boolean;
  check: SiteCheck | null;
  state: SiteCheckState;
  watching: boolean;
  stopWatching(): void;
  waitingError: string | null;
  salesman: string;
  identity: ShedSafeIdentityValue;
  notASalesman: boolean;
  missingForPin: string[];
  missingParams: string[];
  paramsBelowFloor: string[];
  blockedBy: BlockedBy;
  drift: DriftEntry[];
  unverified: boolean;
  status: { tone: StatusTone; label: string };
  averageHeight: number | null;
  roofPitchHints: number[];
  busy: 'pinning' | 'importing' | null;
  message: { tone: 'ok' | 'danger'; text: string } | null;
  pin(): Promise<void>;
  importRating(): Promise<void>;
  popoverOpen: boolean;
  openPopover(): void;
  closePopover(): void;
  pinButtonRef: React.RefObject<HTMLButtonElement | null>;
  focusPin(): void;
}

const ActionsContext = createContext<SiteCheckActions | null>(null);

/** "a", "a and b", "a, b and c" — a list as a person says it. */
function spoken(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function SiteCheckActionsProvider({
  quoteId,
  site,
  client,
  roofPitchHints,
  defaultSalesman,
  canWrite,
  onImported,
  children,
}: SiteCheckActionsProps) {
  const { check, configured, replace, watching, stopWatching, waitingError, state } = useSiteCheck();
  const identity = useShedSafeIdentity();
  /*
   * The building ShedSafe rates is the quote's own record — the Shed group and the popover both read
   * `config` and write through `applyPartial`, as the desktop's panel writes into the same
   * `BlocStructureData` (`UcShowBuildingParameterss.cs:1235`). No private copy, so no second number.
   */
  const config = useShedStore((s) => s.config);
  const setSiteCheckId = useDraftStore((s) => s.setSiteCheckId);

  const [busy, setBusy] = useState<'pinning' | 'importing' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const pinButtonRef = useRef<HTMLButtonElement | null>(null);

  const salesman = defaultSalesman;
  const missingForPin = missingForPinOf(client, site, salesman);
  const missingParams = missingParamsOf(config);
  const paramsBelowFloor = paramsBelowFloorOf(config);
  /*
   * Unknown (`identity.you === null`) does **not** block: a pre-flight check that failed must not stop
   * an action that would work. `isSalesman === false` does, because it is a fact about the account.
   */
  const notASalesman = identity.you !== null && !identity.you.isSalesman;
  const blockedBy = blockedByOf({ notASalesman, missingForPin, missingParams, paramsBelowFloor });

  const drift = driftOf(check, config);
  const unverified = isRatingUnverified(check);
  const status = siteCheckStatus({ check, drift, unverified, watching, waitingError });

  /** The desktop's read-only Avg. Height; `null` while an input is missing. */
  const pitch = config.roofPitchDeg > 0 ? config.roofPitchDeg : null;
  const averageHeight =
    config.span === null || config.height === null || pitch === null
      ? null
      : averageHeightMm({
          structureType: config.structureType as never,
          span: config.span,
          height: config.height,
          roofPitchDeg: pitch,
        });

  const openPopover = useCallback(() => setPopoverOpen(true), []);
  const closePopover = useCallback(() => setPopoverOpen(false), []);
  const focusPin = useCallback(() => {
    const button = pinButtonRef.current;
    if (button === null) return;
    button.scrollIntoView({ block: 'center' });
    button.focus();
  }, []);

  const pin = async (): Promise<void> => {
    /*
     * The gates again, inside the handler: a value cleared between render and click leaves an
     * enabled button (the desktop validates three times for the same reason, trace §5.4).
     */
    if (notASalesman) {
      setMessage({
        tone: 'danger',
        text: `${salesman} isn't a ShedSafe salesman. Ask an admin to add this email.`,
      });
      return;
    }
    if (missingForPin.length > 0) {
      setMessage({ tone: 'danger', text: `Needs ${spoken(missingForPin)} first.` });
      return;
    }
    if (
      missingParams.length > 0 ||
      paramsBelowFloor.length > 0 ||
      config.span === null ||
      config.height === null ||
      config.length === null ||
      pitch === null
    ) {
      setPopoverOpen(true);
      setMessage({
        tone: 'danger',
        text:
          paramsBelowFloor.length > 0
            ? 'Dimensions must be at least 100 mm and pitch above 0.'
            : `Fill in ${missingParams.join(', ')}.`,
      });
      return;
    }

    setBusy('pinning');
    setMessage(null);

    /*
     * Before the quote exists the check is pinned against the company and linked on the first save —
     * the desktop's order, and the only one that lets Step 1 finish without a throwaway revision.
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
        heightMm: config.height,
        spanMm: config.span,
        lengthMm: config.length,
        importanceLevel: config.importanceLevel,
        salesman,
      },
    });

    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    replace(result.data.check);
    if (quoteId === null && result.data.check !== null) {
      setSiteCheckId(result.data.check.id);
    }

    /*
     * Open ShedSafe straight away, as the desktop's GO TO SITECHECK does (`Process.Start(mapUrl)`).
     * A blocked popup is not an error: the link stays in the popover and the message says so.
     */
    const link = result.data.check?.siteLink ?? null;
    const opened = link === null || link === '' ? false : window.open(link, '_blank', 'noopener') !== null;
    setMessage({
      tone: 'ok',
      text:
        link === null || link === ''
          ? 'Pinned, but ShedSafe sent no link. Pin again.'
          : opened
            ? 'Pinned — ShedSafe opened in a new tab. Run Auto Calc there, then come back.'
            : 'Pinned — your browser blocked the tab. Use “Open again ↗”.',
    });
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

    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message });
      return;
    }
    const next = result.data.check;
    replace(next);
    if (next.calculated) {
      setMessage({ tone: 'ok', text: 'Rating imported.' });
      onImported?.(next.values);
    } else {
      /*
       * Read, but not calculated: the readings are shown and **not applied**. Saying "imported" here
       * would be the lie this guard exists to prevent; the status line already says what to do.
       */
      setMessage(null);
    }
  };

  const value: SiteCheckActions = {
    configured,
    canWrite,
    check,
    state,
    watching,
    stopWatching,
    waitingError,
    salesman,
    identity,
    notASalesman,
    missingForPin,
    missingParams,
    paramsBelowFloor,
    blockedBy,
    drift,
    unverified,
    status,
    averageHeight,
    roofPitchHints,
    busy,
    message,
    pin,
    importRating,
    popoverOpen,
    openPopover,
    closePopover,
    pinButtonRef,
    focusPin,
  };

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export function useSiteCheckActions(): SiteCheckActions {
  const value = useContext(ActionsContext);
  if (value === null) {
    throw new Error('useSiteCheckActions must be used inside <SiteCheckActionsProvider>');
  }
  return value;
}
