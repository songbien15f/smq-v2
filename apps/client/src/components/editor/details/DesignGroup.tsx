'use client';

import { useId, useState } from 'react';
import { COLORBOND, COLOUR_ROLES } from '@sq/core/domain';
import {
  averageHeightMm,
  formatDimension,
  internalPressureApproximate,
  outsideBookBounds,
  ridgeHeightMm,
  suggestedValues,
} from '@sq/core/domain';
import { downpipePalette, reconcileDownpipeColour, withDimensions } from '@sq/core/domain';
import { defaultOptionsFor } from '@sq/core/domain';
import {
  QUOTE_RATE_TIERS,
  rateTierFor,
  bayWidthsFor,
  computeBayWidths,
  pitchOutsideBookSpan,
  reconcileBays,
  roofPitchBoundsForSpan,
  roofPitchHintsForSpan,
  shouldWipeOptions,
} from '@sq/core/domain';
import type { Catalogue } from '@sq/core/pricing';
import { deliveryForScope, freightScope } from '@sq/core/domain';
import type {
  DisplayUnit,
  QuoteRateTier,
  ShedColors,
  ShedConfig,
  StructureType,
} from '@sq/core/domain';
import { Button, Field, StatusPill, WarningIcon } from '@sq/ui';
import { AddressField } from '../AddressField';
import { DimensionField } from '../DimensionField';
import { CommitNumberInput } from '../CommitNumberInput';
import type { DraftIssue } from '../validation';
import { useDraftStore } from '@/store/useDraftStore';
import { numberOf, stringOf, useSiteCheck } from '../siteCheckState';
import { useSiteCheckActions } from '../siteCheckActions';
import { driftText } from '../siteCheckGates';
import { useShedStore } from '@/store/useShedStore';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useCompanyPricing } from '@/hooks/useCompanyPricing';
import {
  Group,
  DesignValue,
  Switch,
  SelectField,
  outOfBookMessage,
  snapBmt,
  bmtOptions,
  useShedStoreConfig,
  useApplyBuilding,
} from './shared';
import { STRUCTURE_TYPES, STATES, IMPORTANCE, COLOUR_LABELS } from './constants';

export function DesignGroup({
  issuesByPath,
  catalogue,
}: {
  issuesByPath: Map<string, DraftIssue>;
  catalogue: Catalogue | null;
}) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.short;

  /**
   * The six certified values, read from the **same** check PIN pins and imports.
   *
   * `useSiteCheck` rather than a second `GET`: two fetches on one screen would let the popover say
   * "Certified" while these fields still showed the values from before the import. This group is the
   * **only** place the certified values are shown; the popover links here ("See Design").
   */
  const { check } = useSiteCheck();
  const { configured, canWrite, status, drift, unverified, busy, message, importRating, focusPin } =
    useSiteCheckActions();
  /*
   * "Get again" lives here, so its answer must too — the popover, where `message` also shows, is
   * usually closed when this is pressed. Without a fresh answer, the server's last error stands in.
   */
  const lastError = check?.lastError ?? null;
  const designNotice =
    message !== null
      ? message
      : lastError !== null && lastError !== ''
        ? { tone: 'danger' as const, text: lastError }
        : null;

  /**
   * The eight geographic readings, in the desktop's own order and formatting.
   *
   * `XPropertyGridShowMoreParameters.cs` is the list; `trace §5.6` records it row by row. Each row is
   * resolved the way `siteValue` resolves the six: the certified reading once Auto Calc has run, else
   * what ShedSafe holds now (provisional, amber), else an em dash rather than a zero that looks measured.
   */
  const calculated = check !== null && check.calculated;
  const certifiedSite = calculated ? check.site : null;
  const provisional = check !== null && !calculated ? check.provisional : null;
  const pNum = (key: string): number | null => numberOf(provisional?.[key]);
  const pText = (key: string): string | null => stringOf(provisional?.[key]);
  const geoNumber = (value: number | null | undefined, digits = 2): string | null =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null;
  const geoText = (value: string | null | undefined): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null;
  const withUnit = (value: string | null, unit: string): string | null => (value === null ? null : `${value}${unit}`);
  // The desktop printed "lat, lng" in that order, and rainfall as `100y/20y` with no spaces.
  const pair = (a: number | null | undefined, b: number | null | undefined, joiner: string, unit = ''): string | null =>
    a == null || b == null ? null : `${a}${joiner}${b}${unit}`;
  const geoRows: { label: string; id: string; certified: string | null; provisional: string | null }[] = [
    { label: 'Shielding', id: 'design-shielding', certified: geoNumber(certifiedSite?.shielding), provisional: geoNumber(pNum('shielding')) },
    {
      label: 'Topographic factor',
      id: 'design-topographicFactor',
      certified: geoNumber(certifiedSite?.topographicFactor),
      provisional: geoNumber(pNum('topographicFactor')),
    },
    {
      label: 'Snow load region',
      id: 'design-snowLoadRegion',
      certified: geoText(certifiedSite?.snowLoadRegion),
      provisional: geoText(pText('snowLoadRegion')),
    },
    {
      label: 'Earthquake hazard factor',
      id: 'design-earthquakeHazardFactor',
      certified: geoNumber(certifiedSite?.earthquakeHazardFactor),
      provisional: geoNumber(pNum('earthquakeHazardFactor')),
    },
    {
      label: 'Elevation',
      id: 'design-elevation',
      certified: withUnit(geoNumber(certifiedSite?.elevation), ' m'),
      provisional: withUnit(geoNumber(pNum('elevation')), ' m'),
    },
    {
      label: 'Location',
      id: 'design-location',
      certified: pair(certifiedSite?.latitude, certifiedSite?.longitude, ', '),
      provisional: pair(pNum('latitude'), pNum('longitude'), ', '),
    },
    {
      label: 'Rainfall intensity (100y/20y)',
      id: 'design-rainfall',
      certified: pair(certifiedSite?.rainfallIntensity100Years, certifiedSite?.rainfallIntensity20Years, '/', ' mm/h'),
      provisional: pair(pNum('rainfallIntensity100Years'), pNum('rainfallIntensity20Years'), '/', ' mm/h'),
    },
    {
      label: 'Rainfall town',
      id: 'design-rainfallTown',
      certified: geoText(certifiedSite?.rainfallIntensityTown),
      provisional: geoText(pText('rainfallIntensityTown')),
    },
  ];
  const certifiedCount = geoRows.filter((row) => row.certified !== null).length;

  /**
   * One certified value, resolved into what to print and what it is.
   *
   * The order of trust is the whole point: a certified import, then what ShedSafe currently holds
   * (marked provisional and muted), then nothing. A default that the quote happens to be *priced* from
   * is deliberately **not** in that chain — showing `A` because the config defaults to `A` would be
   * indistinguishable from showing the certificate's `A`, and only one of those is a fact.
   */
  const siteValue = (
    key: 'importanceLevel' | 'windRegion' | 'terrainCategory' | 'buildingClass' | 'snowLoad' | 'designWindSpeed',
  ): { text: string; state: 'certified' | 'provisional' | 'unchecked' } => {
    const suffix = key === 'snowLoad' ? ' kPa' : key === 'designWindSpeed' ? ' m/s' : '';
    if (check !== null && check.calculated) {
      const raw = check.values[key];
      return {
        text: raw === null || raw === '' ? 'Not in the rating' : `${raw}${suffix}`,
        state: 'certified',
      };
    }
    if (check !== null && check.provisional !== null) {
      const raw = check.provisional[key];
      const shown = typeof raw === 'number' || typeof raw === 'string' ? raw : null;
      if (shown !== null && shown !== '') {
        return { text: `${shown}${suffix}`, state: 'provisional' };
      }
    }
    return { text: '—', state: 'unchecked' };
  };

  /*
   * Whether this book lists the chosen importance level at all.
   *
   * Read from the catalogue the app already loaded, so the answer is about **this company's book**
   * rather than a constant. An empty list means the book never shipped the table, and then saying
   * nothing is right: the frame path reports its own assumption.
   */
  const bookLevels = catalogue?.importanceLevels ?? [];
  const bookCannotPrice =
    bookLevels.length > 0 &&
    !bookLevels.some((level) => Number(level.value) === config.importanceLevel);

  const options = config.options;
  const hasGable = (end: 'front' | 'back'): boolean =>
    options.some((option) => option.kind === 'gable_infill' && option.end === end);
  /*
   * The two helpers below add an **option**, and an option is placed on a building. With no
   * dimensions there is nothing to clamp it against, so they do nothing — the fields are still shown,
   * and the required-dimension message in the Shed group says what to fill in first.
   */
  const building = withDimensions(config);

  const toggleGable = (end: 'front' | 'back'): void => {
    if (building === null) return;
    const next = hasGable(end)
      ? options.filter((option) => !(option.kind === 'gable_infill' && option.end === end))
      : [
          ...options,
          ...defaultOptionsFor('gable_infill', building).filter(
            (option) => option.kind === 'gable_infill' && option.end === end,
          ),
        ];
    applyPartial({ options: next });
  };

  const cantileverFor = (wall: 'front' | 'back') =>
    options.find((option) => option.kind === 'cantilever' && option.wall === wall);
  /** True when the building now has this cantilever length; false when it could not be set. */
  const setCantilever = (wall: 'front' | 'back', length: number): boolean => {
    if (building === null) return false;
    const existing = cantileverFor(wall);
    let next;
    if (length <= 0) {
      next = options.filter((option) => !(option.kind === 'cantilever' && option.wall === wall));
    } else if (existing !== undefined) {
      next = options.map((option) => (option === existing ? { ...option, length } : option));
    } else {
      const base = defaultOptionsFor('cantilever', building).find(
        (option) => option.kind === 'cantilever',
      );
      if (base === undefined || base.kind !== 'cantilever') return false;
      next = [...options, { ...base, wall, length }];
    }
    applyPartial({ options: next });
    return true;
  };
  /** Why the last typed cantilever was refused, and on which wall. */
  const [cantileverRefusal, setCantileverRefusal] = useState<{ wall: 'front' | 'back'; message: string } | null>(
    null,
  );

  return (
    <Group
      id="group-design"
      title="Design"
      issueCount={
        // Wind region is no longer among these: it is read-only now, so an issue there would be a red
        // mark on a field nobody can fix. See `validation.ts` §5.
        ['design-stateCode', 'design-cantilever'].filter((path) => issuesByPath.has(path)).length
      }
      aside={
        configured ? (
          <>
            <span className="hidden text-sq-micro text-sq-ink-muted sm:inline">From ShedSafe</span>
            <StatusPill tone={status.tone} label={status.label} />
            {check !== null && canWrite && (
              <Button
                id="design-sitecheck-refetch"
                variant="ghost"
                loading={busy === 'importing'}
                disabled={busy !== null}
                onClick={() => void importRating()}
              >
                ↻ Get again
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <SelectField
        id="design-structureType"
        label="Structure type"
        value={config.structureType}
        options={STRUCTURE_TYPES}
        onChange={(value) => {
          /*
           * Changing the range resets the geometry.
           *
           * Not a convenience: a skillion has one roof slope and a gable has two, so keeping the
           * numbers across a structure change would describe a building that cannot be drawn. The
           * store's normaliser clamps the rest.
           */
          applyPartial({ structureType: value as StructureType });
        }}
        hint="Changing this resets the building’s geometry and any openings."
      />

      {/*
        The six values a site check certifies, read-only.

        ## Why they are not controls any more

        These are not design choices — ShedSafe computes them, and typing over one produces a quote
        priced against a rating the certificate does not carry. The desktop made all six
        `Enable = false` for the same reason, with the placeholder *"Autofill from shedsafe."*

        ## Three states, because a field with no value still has to say something

        A read-only box showing `—` is indistinguishable from a broken one. Each row therefore states
        where its number came from:

          not pinned          `—` + "not from a site check"
          pinned, no AutoCalc the raw reading, tagged provisional and visibly muted
          imported            the certified value

        A quote may still be **priced** from the defaults while unchecked — that is the decision on
        record (KNOWN-DEVIATIONS 31 and the "quick quote" path) — but the screen must never let a
        default look like a certificate. `DesignValue` is the one component that decides that, so the
        three states cannot drift apart between the six rows.
      */}
      <div className="flex flex-col gap-sq-2">
        <div className="grid grid-cols-2 gap-sq-2">
          <DesignValue
            compact
            id="design-importanceLevel"
            label="Importance level"
            entry={siteValue('importanceLevel')}
          />
          <DesignValue compact id="design-windRegion" label="Wind region" entry={siteValue('windRegion')} />
          <DesignValue compact id="design-terrainCategory" label="Terrain category" entry={siteValue('terrainCategory')} />
          <DesignValue compact id="design-buildingClass" label="Building class" entry={siteValue('buildingClass')} />
          <DesignValue compact id="design-snowLoad" label="Ground snow load" entry={siteValue('snowLoad')} />
          <DesignValue compact id="design-windSpeed" label="Design wind speed" entry={siteValue('designWindSpeed')} />
        </div>

        {configured && designNotice !== null && (
          <p
            role={designNotice.tone === 'danger' ? 'alert' : 'status'}
            className={`text-sq-micro ${designNotice.tone === 'danger' ? 'text-sq-danger' : 'text-sq-ok'}`}
          >
            {designNotice.text}
          </p>
        )}

        {/* The certificate no longer describes this building: one sentence, and the way back to PIN. */}
        {drift.length > 0 && (
          <p role="status" className="text-sq-micro text-sq-danger">
            <WarningIcon size={14} className="mr-1 inline align-[-2px]" />
            Differs from the certified dimensions:{drift.map(driftText).join(', ')}.{' '}
            <button type="button" onClick={focusPin} className="cursor-pointer font-medium underline underline-offset-2">
              Pin again at Site address
            </button>
            .
          </p>
        )}
        {unverified && (
          <p className="text-sq-micro text-sq-attention">
            Certified dimensions weren’t recorded — pin again to verify.
          </p>
        )}

        {/*
          The book's own warning, kept where the level is read: it has no frame table above level 2, so
          the frame falls back to one assumed section. The value itself still comes from the
          certificate — see KNOWN-DEVIATIONS 31.
        */}
        {bookCannotPrice && (
          <p className="text-sq-micro text-sq-attention">
            This book has no frame table for importance {config.importanceLevel}; the frame uses one assumed
            section.
          </p>
        )}

            {/*
              ------------------------------------------------ Show more parameters

              The desktop's `ShowMoreInfo` flyout (`XPropertyGridShowMoreParameters.cs`), inline and
              collapsed rather than floating: seven readings that describe the **site**, none of which
              prices anything. `trace §5.6` lists all seven with `Enable = false` and the placeholder
              *"Autofill from shedsafe."*

              ## Why it is here and not in the PIN popover

              In the desktop the button sits beside **Design Wind Speed**, because that is the last of
              the six certified values and these seven are the rest of the same certificate. A person
              reading "design wind speed 41.5 m/s" is the person who wants to know the elevation and the
              coordinates it came from.

              ## All eight, read-only, and empty says so

              Nothing here is typed: ShedSafe computed each figure. `—` is the honest answer rather than
              a `0` that looks measured; a provisional reading is amber; the counter counts only
              certified ones.
            */}
            <details className="rounded-md border border-sq-line">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between px-sq-2 text-sq-micro font-medium text-sq-ink">
                More parameters
                <span className="text-sq-micro font-normal text-sq-ink-muted">
                  {certifiedCount} of {geoRows.length} from the rating
                </span>
              </summary>
              <dl className="grid gap-sq-2 border-t border-sq-line p-sq-2 sm:grid-cols-2">
                {geoRows.map((row) => {
                  const shown = row.certified ?? row.provisional;
                  return (
                    <div key={row.id} className="flex items-baseline justify-between gap-sq-2">
                      <dt className="text-sq-micro text-sq-ink-muted">{row.label}</dt>
                      <dd
                        id={row.id}
                        title={row.certified === null && shown !== null ? 'Provisional — not auto calculated' : undefined}
                        className={`sq-numeric text-right text-sq-body ${
                          row.certified === null && shown !== null ? 'text-sq-attention' : 'text-sq-ink'
                        }`}
                      >
                        {shown ?? '—'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="border-t border-sq-line p-sq-2 text-sq-micro text-sq-ink-muted">
                ShedSafe calculates these; they don’t change the price.
              </p>
            </details>
      </div>

      {/*
        State stays editable, and it is not in the desktop's Design group.

        It is here because it is the **only** thing that picks the price coefficient for a bill of
        materials (`setting_price_coeffcient`, keyed by `state_code`) and the Queensland factor on a
        mezzanine. ShedSafe does not report it — a certificate is about wind, not about which price
        schedule a dealer buys from. Making it read-only would remove the only control over material
        pricing, so it sits beside the certified block with a hint saying what it does.
      */}
      <SelectField
        id="design-stateCode"
        label="State"
        value={config.stateCode}
        options={STATES.map((state) => ({ value: state, label: state }))}
        required
        error={errorAt('design-stateCode')}
        onChange={(value) => applyPartial({ stateCode: value as never })}
        hint="Selects this state’s material prices. Not part of the site check."
      />

      {/*
        Internal pressure is **read-only**, derived from the four Walls-left-open switches below.

        It was an editable select. That is worse than either extreme: the value picks which frame row
        the engine reads (`'+0.7, -0.65'` for an open building, `'+0.2, -0.3'` for a closed one — see
        `lookup.ts`), so a shop-set "closed" on a building with two open walls prices from a frame
        designed for walls that are not there. The desktop disables this field for the same reason
        (`CalcInternalPressuresValue` + `CheckAndUnlock`).

        The switches below are the control. Changing one re-derives this within the same
        `normaliseShedConfig` pass, so the two can never disagree.
      */}
      <dl className="flex flex-col gap-sq-1">
        <dt className="text-sq-micro font-medium text-sq-ink">Internal pressure</dt>
        <dd
          id="design-internalPressure"
          aria-describedby="design-internalPressure-hint"
          className="sq-numeric min-h-11 rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
        >
          {config.internalPressure === 'open'
            ? 'Open — the frame is designed for pressure from inside'
            : 'Closed — walls on all sides'}
        </dd>
        <dd id="design-internalPressure-hint" className="text-sq-micro text-sq-ink-muted">
          Worked out from the walls left open below. It selects the frame row, so it is not typed.
          {internalPressureApproximate(config) !== null && (
            <span className="mt-sq-1 block text-sq-attention">{internalPressureApproximate(config)}</span>
          )}
        </dd>
      </dl>

      <fieldset className="flex flex-col gap-sq-1">
        <legend className="text-sq-micro font-medium text-sq-ink">Walls left open</legend>
        <div className="grid grid-cols-2 gap-sq-2">
          <Switch
            label="End wall, left"
            checked={config.endOpening.left}
            onChange={(checked) =>
              applyPartial({ endOpening: { ...config.endOpening, left: checked } })
            }
          />
          <Switch
            label="End wall, right"
            checked={config.endOpening.right}
            onChange={(checked) =>
              applyPartial({ endOpening: { ...config.endOpening, right: checked } })
            }
          />
          <Switch
            label="Side wall, front"
            checked={config.sideOpening.front}
            onChange={(checked) =>
              applyPartial({ sideOpening: { ...config.sideOpening, front: checked } })
            }
          />
          <Switch
            label="Side wall, back"
            checked={config.sideOpening.back}
            onChange={(checked) =>
              applyPartial({ sideOpening: { ...config.sideOpening, back: checked } })
            }
          />
        </div>
        <p className="text-sq-micro text-sq-ink-muted">
          An open wall changes the internal pressure the frame is designed for.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-sq-1">
        <legend className="text-sq-micro font-medium text-sq-ink">Gable infill</legend>
        <div className="flex gap-sq-3">
          {(['front', 'back'] as const).map((end) => (
            <Switch
              key={end}
              label={end === 'front' ? 'Front end' : 'Back end'}
              checked={hasGable(end)}
              onChange={() => toggleGable(end)}
            />
          ))}
        </div>
        <p className="text-sq-micro text-sq-ink-muted">
          Closes the triangle above wall height at that end.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-sq-1">
        <legend className="text-sq-micro font-medium text-sq-ink">Cantilever (mm)</legend>
        <div className="grid grid-cols-2 gap-sq-2">
          {(['front', 'back'] as const).map((wall) => {
            const option = cantileverFor(wall);
            const length = option !== undefined && option.kind === 'cantilever' ? option.length : 0;
            return (
              <label key={wall} className="flex flex-col gap-sq-1">
                <span className="text-sq-micro capitalize text-sq-ink">{wall}</span>
                <CommitNumberInput
                  id={`design-cantilever-${wall}`}
                  // One issue covers both walls; leaving either marks it touched.
                  data-issue-path="design-cantilever"
                  min={0}
                  max={3000}
                  unit="mm"
                  aria-invalid={errorAt('design-cantilever') !== undefined || undefined}
                  aria-describedby={
                    errorAt('design-cantilever') !== undefined ? 'design-cantilever-error' : undefined
                  }
                  value={length}
                  onRefusal={(message) => setCantileverRefusal(message === null ? null : { wall, message })}
                  // 0 removes the cantilever — only when typed and committed; clearing the box reverts.
                  onCommit={(next) => setCantilever(wall, next)}
                  className="min-h-11 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
                />
                {cantileverRefusal?.wall === wall && (
                  <span role="alert" className="text-sq-micro text-sq-danger">
                    {cantileverRefusal.message}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <p className="text-sq-micro text-sq-ink-muted">
          Type 0 to remove the cantilever. A standard building is limited to 1400 mm; a custom structure can
          go further.
        </p>
        {errorAt('design-cantilever') !== undefined && (
          <p
            id="design-cantilever-error"
            role="alert"
            className="text-sq-micro text-sq-danger"
          >
            {errorAt('design-cantilever')}
          </p>
        )}
      </fieldset>
    </Group>
  );
}
