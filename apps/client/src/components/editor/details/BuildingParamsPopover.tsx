'use client';

/**
 * The desktop's "Building Parameters" panel (`UcShowBuildingParameterss`), as a popover under the site
 * address: the five numbers ShedSafe rates, the read-only Avg. Height, who the check is issued under,
 * and GO TO SHEDSAFE.
 *
 * ## One record, not a copy
 *
 * Every field reads `config` and writes through the same writers as the Shed group
 * (`useShedDimensions`), so a span typed here asks the same "removes every option" question and a length
 * reconciles the bays the same way. The popover has no state of its own beyond "open".
 *
 * ## Why it only closes on ✕ or Escape
 *
 * The flow sends the operator to another tab (ShedSafe) and back. A popover that closed on blur, an
 * outside click or a scroll would be gone exactly when they return to read what to do next.
 */

import { useEffect, useRef } from 'react';
import type { DisplayUnit } from '@sq/core/domain';
import { Button, ExternalLinkIcon } from '@sq/ui';
import { DimensionField } from '../DimensionField';
import { PitchCombobox } from '../PitchCombobox';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useSiteCheckActions } from '../siteCheckActions';
import { useApplyBuilding, useShedStoreConfig } from './shared';
import { IMPORTANCE } from './constants';
import { SideFlyout } from './SideFlyout';
import { useShedDimensions } from './useShedDimensions';

const SELECT =
  'min-h-11 w-full cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none disabled:cursor-not-allowed disabled:opacity-70';

export function BuildingParamsPopover({ unit }: { unit: DisplayUnit }) {
  const actions = useSiteCheckActions();
  const {
    check,
    canWrite,
    popoverOpen,
    closePopover,
    pinButtonRef,
    salesman,
    identity,
    notASalesman,
    missingForPin,
    missingParams,
    paramsBelowFloor,
    blockedBy,
    drift,
    averageHeight,
    roofPitchHints,
    busy,
    message,
    pin,
    importRating,
    watching,
    stopWatching,
    waitingError,
  } = actions;
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const { catalogue } = useCatalogue();
  const {
    spanBounds,
    heightBounds,
    lengthBounds,
    pitchBounds,
    commitSpan,
    commitHeight,
    commitLength,
    applyDimension,
  } = useShedDimensions(catalogue);

  /*
   * Focus in on open, back to PIN on close — the keyboard path the desktop's modal panel gave for free.
   * `wasOpen` so the first render (closed) does not steal focus to the PIN button.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (popoverOpen) {
      document.getElementById('sitecheck-params-importanceLevel')?.focus();
    } else if (wasOpen.current) {
      /* PIN is disabled when the quote's fields are incomplete, and the status line can still open
         the popover — a disabled button cannot take focus, so fall back to the line that opened it. */
      const pinButton = pinButtonRef.current;
      if (pinButton !== null && !pinButton.disabled) pinButton.focus();
      else document.getElementById('sitecheck-status')?.focus();
    }
    wasOpen.current = popoverOpen;
  }, [popoverOpen, pinButtonRef]);

  /*
   * Folding the Site group unmounts this component while the provider still says "open". Close it on
   * the way out, or unfolding would bring the popover back unasked with no Escape listener running.
   */
  useEffect(() => () => closePopover(), [closePopover]);

  if (!popoverOpen) return null;

  const pitch = config.roofPitchDeg > 0 ? config.roofPitchDeg : null;

  const goLabel = drift.length > 0 || check !== null ? 'Pin again & open ShedSafe' : 'GO TO SHEDSAFE';
  const reason =
    blockedBy === 'fields'
      ? `Needs ${missingForPin[0]}`
      : blockedBy === 'params'
        ? `Fill in ${[...missingParams, ...paramsBelowFloor][0]}`
        : blockedBy === 'salesman'
          ? 'Your email isn’t a ShedSafe salesman'
          : null;

  /* The four states of this login on ShedSafe, short; the full sentence is in the tooltip. */
  const salesmanState = notASalesman
    ? {
        tone: 'text-sq-danger',
        text: 'Not registered · ask an admin',
        title: `${salesman} is not a registered ShedSafe salesman, so ShedSafe will refuse the pin. Ask an administrator to add it.${
          identity.salesmen.length > 0
            ? ` Registered on this account: ${identity.salesmen.map((s) => s.email).join(', ')}.`
            : ''
        }`,
      }
    : identity.you !== null && identity.you.isSalesman
      ? {
          tone: 'text-sq-ok',
          text: 'Registered ShedSafe salesman',
          title: [identity.you.formattedName, identity.you.franchiseName].filter((v) => v !== null).join(', '),
        }
      : identity.listingError !== null
        ? {
            tone: 'text-sq-attention',
            text: 'Couldn’t confirm · try anyway',
            title: `Could not confirm this login with ShedSafe (${identity.listingError}).`,
          }
        : {
            tone: 'text-sq-ink-muted',
            text: 'Must be a registered salesman',
            title: 'ShedSafe only accepts an email registered as a salesman in your account.',
          };

  const pinned = check !== null && !check.calculated;
  const siteLink = check?.siteLink ?? null;

  return (
    <SideFlyout
      id="sitecheck-popover"
      titleId="sitecheck-params-title"
      title="Building parameters"
      closeLabel="Close building parameters"
      onClose={closePopover}
      arrowTargetRef={pinButtonRef}
      phone="sheet"
    >
      <fieldset disabled={!canWrite} className="grid min-w-0 grid-cols-2 gap-sq-2">
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Importance level</span>
          <select
            id="sitecheck-params-importanceLevel"
            value={String(config.importanceLevel)}
            onChange={(event) => {
              if (event.target.value !== '') {
                applyPartial({ importanceLevel: Number(event.target.value) as never });
              }
            }}
            className={SELECT}
          >
            {IMPORTANCE.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </label>

        <DimensionField
          id="sitecheck-params-spanMm"
          issuePath="shed-span"
          label="Span / width"
          valueMm={config.span}
          unit={unit}
          minMm={spanBounds.min}
          maxMm={spanBounds.max}
          required
          onCommit={commitSpan}
        />
        <DimensionField
          id="sitecheck-params-heightMm"
          issuePath="shed-height"
          label="Height"
          valueMm={config.height}
          unit={unit}
          minMm={heightBounds.min}
          maxMm={heightBounds.max}
          required
          onCommit={commitHeight}
        />
        <DimensionField
          id="sitecheck-params-lengthMm"
          issuePath="shed-length"
          label="Overall length"
          valueMm={config.length}
          unit={unit}
          minMm={lengthBounds.min}
          maxMm={lengthBounds.max}
          required
          onCommit={commitLength}
        />

        <PitchCombobox
          id="sitecheck-params-roofPitchDeg"
          issuePath="shed-roofPitchDeg"
          label="Roof pitch"
          value={pitch}
          hints={roofPitchHints}
          bounds={pitchBounds}
          // Through the Shed group's own writer, so a pitch change asks before it wipes options.
          onCommit={(deg) => applyDimension({ roofPitchDeg: deg })}
          error={pitch === null ? 'Choose a pitch.' : undefined}
          note={roofPitchHints.length === 0 ? 'No pitches in the book for this span.' : undefined}
        />

        <div className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Avg. height</span>
          <output
            id="sitecheck-params-averageHeight"
            title="Worked out from span, wall height and pitch"
            className="sq-numeric flex min-h-11 items-center rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 text-sq-body text-sq-ink"
          >
            {averageHeight === null ? '—' : `${averageHeight.toLocaleString('en-AU')} mm`}
          </output>
        </div>
      </fieldset>

      <div className="flex flex-col gap-0.5 border-t border-sq-line pt-sq-2">
        <div className="flex items-baseline justify-between gap-sq-2">
          <span className="text-sq-micro font-medium text-sq-ink">Salesperson</span>
          <span id="sitecheck-salesman-state" title={salesmanState.title} className={`text-sq-micro ${salesmanState.tone}`}>
            {salesmanState.text}
          </span>
        </div>
        <output id="sitecheck-salesman" className="sq-numeric truncate text-sq-body text-sq-ink" title={salesman}>
          {salesman === '' ? '— nobody signed in' : salesman}
        </output>
      </div>

      <div className="flex flex-col gap-1">
        <Button
          id="sitecheck-go"
          variant="primary"
          className="w-full"
          loading={busy === 'pinning'}
          disabled={blockedBy !== null || busy !== null || !canWrite}
          onClick={() => void pin()}
        >
          {goLabel}
        </Button>
        {reason !== null && <p className="text-sq-micro text-sq-ink-muted">{reason}</p>}
        {message !== null && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={`text-sq-micro ${message.tone === 'danger' ? 'text-sq-danger' : 'text-sq-ok'}`}
          >
            {message.text}
          </p>
        )}
      </div>

      {pinned && (
        <div className="flex flex-col gap-sq-2 rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-2">
          <ol className="ml-4 list-decimal text-sq-micro text-sq-ink">
            <li>Open ShedSafe</li>
            <li>Check the pinned address</li>
            <li>Press Auto Calc</li>
            <li>Come back and get the report</li>
          </ol>
          {check?.lastError !== null && check?.lastError !== undefined && check.lastError !== '' && (
            <p className="text-sq-micro text-sq-danger">{check.lastError}</p>
          )}
          {waitingError !== null ? (
            <p role="alert" className="text-sq-micro text-sq-danger">
              ShedSafe: {waitingError}
            </p>
          ) : (
            watching && (
              <div className="flex items-center justify-between gap-sq-2">
                <span role="status" aria-live="polite" className="text-sq-micro text-sq-ink-muted">
                  Checking every 10 s…
                </span>
                <Button variant="ghost" onClick={stopWatching}>
                  Stop watching
                </Button>
              </div>
            )
          )}
          <div className="flex flex-wrap items-center gap-sq-2">
            <Button
              id="sitecheck-import"
              loading={busy === 'importing'}
              disabled={busy !== null || !canWrite}
              onClick={() => void importRating()}
            >
              Get SiteCheck report
            </Button>
            {siteLink !== null && siteLink !== '' && (
              <a
                href={siteLink}
                target="_blank"
                rel="noopener"
                className="text-sq-micro font-medium text-sq-brand underline underline-offset-2"
              >
                Open again <ExternalLinkIcon size={12} className="inline align-[-1px]" />
              </a>
            )}
          </div>
        </div>
      )}

      {check !== null && check.calculated && (
        <p className="flex flex-wrap items-center gap-x-sq-2 text-sq-micro text-sq-ok">
          <span>Certified · Ref {check.reference}</span>
          <button
            type="button"
            onClick={() => {
              const target = document.getElementById('design-importanceLevel');
              target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
            className="cursor-pointer font-medium text-sq-brand underline underline-offset-2"
          >
            See Design
          </button>
        </p>
      )}
      {check !== null && check.calculated && check.lastError !== null && check.lastError !== '' && (
        <p role="alert" className="text-sq-micro text-sq-danger">
          {check.lastError}
        </p>
      )}
    </SideFlyout>
  );
}
