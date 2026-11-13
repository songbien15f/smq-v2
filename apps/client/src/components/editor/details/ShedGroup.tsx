'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  baysToFit,
  computeBayWidths,
  pitchOutsideBookSpan,
  reconcileBays,
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
import { Field, StatusPill, WarningIcon } from '@sq/ui';
import { AddressField } from '../AddressField';
import { DimensionField } from '../DimensionField';
import { CommitNumberInput } from '../CommitNumberInput';
import { PitchCombobox } from '../PitchCombobox';
import type { DraftIssue } from '../validation';
import { useDraftStore } from '@/store/useDraftStore';
import { useSiteCheck } from '../siteCheckState';
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
import { useShedDimensions } from './useShedDimensions';
import { bookBounds, largestBay } from '../bookBounds';
import { useSiteCheckActions } from '../siteCheckActions';
import { SideFlyout } from './SideFlyout';
import type { DriftEntry } from '../siteCheckGates';

/**
 * One line under a dimension the certificate no longer matches.
 *
 * Only the field's own entry: the full list lives in Design, where the certified values are. Here
 * the person is looking at the number they just changed, so the line says what it was certified at
 * and how to get a certificate for the new one.
 */
function DriftLine({ entry, onPin }: { entry: DriftEntry | undefined; onPin(): void }) {
  if (entry === undefined) return null;
  return (
    <p role="status" className="mt-1 text-sq-micro text-sq-attention">
      <WarningIcon size={14} className="mr-1 inline align-[-2px]" />
      Differs from the certified dimensions ({entry.from} → {entry.to === null ? 'not entered' : `${entry.to} mm`}).{' '}
      <button type="button" onClick={onPin} className="cursor-pointer font-medium underline underline-offset-2">
        Pin again at Site address
      </button>
      .
    </p>
  );
}

export function ShedGroup({
  issuesByPath,
  unit,
  onUnitChange,
  catalogue,
  kneeBrace,
}: {
  issuesByPath: Map<string, DraftIssue>;
  unit: DisplayUnit;
  onUnitChange: (unit: DisplayUnit) => void;
  catalogue: Catalogue | null;
  kneeBrace: string | null;
}) {
  const config = useShedStoreConfig();
  /*
   * The building with its dimensions, or `null` while the fields are still empty.
   *
   * Everything derived — the bay grid, the average and ridge heights, the book's suggestions — is a
   * function of span, length and height. Narrowing once here means each of those uses a value the
   * compiler knows is complete, instead of spreading `?? 0` through the panel.
   */
  const building = withDimensions(config);
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.short;
  /*
   * The same check the Design group reads, from the same provider.
   *
   * The awnings live here now (the desktop's own position), and they are certified values: reading
   * them from a second fetch would let this group show a width the Design group does not.
   */
  const { check } = useSiteCheck();
  const { drift, focusPin, popoverOpen: pinOpen, closePopover: closePin } = useSiteCheckActions();
  const driftFor = (field: 'span' | 'height' | 'length') => drift.find((entry) => entry.field === field);

  /*
   * The bays this building actually has, which is an array once somebody edits one.
   *
   * `perBay` is shown beside the bay count, and it used to be a division. On an edited building that
   * number describes no bay in the shed — the panel lists the real ones below.
   */
  /*
   * The bay grid and the two heights are derived from the three dimensions, so they exist only once
   * those do. `null` here is not an error: the fields above are empty and the validation message says
   * which ones to fill in.
   */
  const bayWidths = config.length === null ? [0] : bayWidthsFor(config as never);
  const perBay = bayWidths.reduce((sum, width) => sum + width, 0) / Math.max(1, bayWidths.length);
  const unevenBays = new Set(bayWidths).size > 1;
  const [baysOpen, setBaysOpen] = useState(false);
  /*
   * A bay outside the book is an issue on `shed-bayWidth-<i>`, which exists only while the panel is
   * open — so the panel stays open while any bay has one, or the summary's link would go nowhere.
   */
  const bayWidthIssue = bayWidths.some((_, index) => issuesByPath.has(`shed-bayWidth-${index}`));
  const showBays = baysOpen || bayWidthIssue;
  const baysToggleRef = useRef<HTMLButtonElement | null>(null);
  /*
   * Two flyouts open at the same spot (right of the form column), so only one at a time: opening the
   * PIN panel puts the bay panel away, and opening this one puts the PIN panel away. A panel held open
   * by a bad bay (`bayWidthIssue`) cannot be put away — its error has to stay reachable.
   */
  useEffect(() => {
    if (pinOpen) setBaysOpen(false);
  }, [pinOpen]);
  /* Focus in on a deliberate open, back to the toggle on a deliberate close — not when it opens itself. */
  const baysWasOpen = useRef(false);
  useEffect(() => {
    if (baysOpen) document.getElementById('shed-bayWidth-0')?.focus();
    else if (baysWasOpen.current) baysToggleRef.current?.focus();
    baysWasOpen.current = baysOpen;
  }, [baysOpen]);
  /** Why the last typed entry was refused, per field — rendered under the field it belongs to. */
  const [baysRefusal, setBaysRefusal] = useState<string | null>(null);
  const [spacingRefusal, setSpacingRefusal] = useState<string | null>(null);
  const [bayWidthRefusal, setBayWidthRefusal] = useState<{ index: number; message: string } | null>(null);

  /*
   * The heights a person has to state on a council application and a delivery quote.
   *
   * Computed from the same three inputs the drawing uses, by a pure function in core so the number is
   * testable without a browser. `null` means the roof cannot be described yet — a zero pitch is a flat
   * roof, and reporting the wall height as an "average" would be a number nobody measured.
   */
  const averageHeight = building === null ? null : averageHeightMm(building);
  const ridgeHeight = building === null ? null : ridgeHeightMm(building);

  /*
   * What the price book suggests, and only where the screen differs from it.
   *
   * ## Why this is an offer and not a default
   *
   * A new quote necessarily starts with numbers in it — `config.span` is read as a number in 27 files,
   * and a `null` there would be a null check in every one. But a number sitting in a form reads as a
   * building somebody chose. `suggestedValues` returns the **difference** between what the book states
   * and what is on screen, so the button can say *"span 12 000 → 6 000"* and the operator knows where
   * the figure came from. An empty list means the screen already matches the book.
   */
  const suggestions = catalogue === null ? [] : suggestedValues(config, catalogue.dimensions);
  const suggestionLabel: Record<(typeof suggestions)[number]['field'], string> = {
    span: 'Span',
    height: 'Wall height',
    nomBaySpacing: 'Bay spacing',
    roofPitchDeg: 'Roof pitch',
  };

  /** Apply every suggestion at once. One history entry, and one confirm if it would wipe options. */
  const applySuggestions = (): void => {
    const patch: Partial<ShedConfig> = {};
    for (const entry of suggestions) patch[entry.field] = entry.value;
    applyDimension(patch);
  };

  /* Bounds and the two writers, shared with the SiteCheck popover (one record, one set of rules). */
  const {
    spanBounds,
    heightBounds,
    lengthBounds,
    applyDimension,
    applyBays,
    baySpacingBounds,
    pitchBounds,
    commitSpan,
    commitHeight,
    commitLength,
  } = useShedDimensions(catalogue);

  /*
   * A one-click split for bays wider than the book sells — the desktop's Adjust bays rule.
   *
   * A stored building can sit outside the band (saved before the rule, or a new book narrowed it), and
   * then it cannot be saved at all, not even to fix a customer's email. The fix the desktop would have
   * made is fully determined, so it is offered as one button whose label states the result. It goes
   * through `applyBays`, so it is exactly what typing that count in Bays does: length kept, per-bay
   * array dropped, and the "removes every option" confirm when options would be lost.
   *
   * Only for a bay above the max: no count of bays fixes one below the min.
   */
  const bookBayBand = bookBounds(catalogue, config.span).baySpacing;
  const widest = config.length === null ? null : largestBay(config);
  const split =
    config.length !== null && bookBayBand !== null && widest !== null && widest.mm > bookBayBand.max
      ? (() => {
          const bays = baysToFit(config.length, bookBayBand.max);
          return { bays, each: Math.floor(config.length / bays) };
        })()
      : null;

  /*
   * The roof pitches the book sells **for this span**.
   *
   * The desktop rebuilds this list on every span change (`GetHintListRoofPitch`), and while the
   * reference book offers the same six angles at every span, the table is organised into span bands —
   * so the query is about the book's shape rather than about today's numbers.
   *
   * The book's range bounds the box, the list does not narrow it: a pitch between two listed angles is a roof an
   * operator may legitimately quote (the desktop's dropdown is editable), so the field says the book
   * does not list it instead of snapping the roof to something the customer did not agree to.
   */
  /*
   * The book's pitch list is filtered by span, so it exists only once a span does.
   *
   * Before that the list is empty and the box keeps the fallback 0–45 range — which is what a
   * suggestion list absent its filter should be: no claim about the roof.
   */
  const pitchGroups = catalogue?.roofPitchGroups ?? [];
  const spanForBook = config.span;
  const pitchHints = spanForBook === null ? [] : roofPitchHintsForSpan(pitchGroups, spanForBook);
  const pitchUnlisted =
    spanForBook === null ? false : pitchOutsideBookSpan(pitchGroups, spanForBook, config.roofPitchDeg);


  /**
   * One bay, typed.
   *
   * ## What this does, in the desktop's order
   *
   * Overall length becomes the sum of the bays and **nominal spacing is left alone** — the desktop's
   * `OnBayUnitsChange` sets `OverallLength = val.Sum()` and does not touch `Bay`. So a building can
   * legitimately have a nominal spacing that no bay matches; that is the "nominal" in the name.
   *
   * The stored colours of the frame are what change here: the frame table is keyed by the **largest**
   * bay (`BayLargest`), so lengthening one bay can move every column and rafter to the next section.
   * That is correct — the widest span between columns is the one the member carries — and it is why the
   * panel says so when the largest bay changes.
   */
  const applyBayWidths = (widths: number[]): boolean => {
    const rounded = widths.map((width) => Math.round(width));
    const total = rounded.reduce((sum, width) => sum + width, 0);
    /*
     * An array that merely repeats the division is dropped.
     *
     * Storing it would be a second copy of a derived fact, and it would make the draft's fingerprint
     * differ from an identical building that never had the panel opened — so the same shed would read
     * "price out of date" on one quote and not the other. `bayWidthsFor` derives exactly these numbers
     * anyway.
     */
    const even = computeBayWidths(total, rounded.length);
    const differs = even.length !== rounded.length || even.some((width, i) => width !== rounded[i]);
    return applyDimension({ bayWidths: differs ? rounded : undefined, length: total });
  };

  const wallProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isWall);
  const roofProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isRoof);
  const downpipeMaterials = catalogue?.downpipeMaterials ?? [];

  return (
    <Group
      id="group-shed"
      title="Shed"
      issueCount={
        ['shed-span', 'shed-length', 'shed-height', 'shed-bays', 'shed-nomBaySpacing', 'shed-roofPitchDeg'].filter((path) =>
          issuesByPath.has(path),
        ).length
      }
    >
      {/*
        ## The book's suggestion, offered rather than applied

        This screen starts with numbers in it because the drawing, the BOM and the price engine all
        read `span` as a number. Those numbers came from a hard-coded constant once — 12 000 × 4 200 —
        which is inside the book's list and therefore looked like a real building.

        The desktop applied its own default silently when a quote was created. This asks instead: here
        is what the book states, here is what you have, and here is the button. A figure the operator
        did not type should be **visibly** the software's until they accept it — the same principle as
        the site-check values being labelled by source rather than shown as if certified.
      */}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-sq-2 rounded-md border border-sq-attention/40 bg-sq-attention/5 p-sq-2">
          <p className="text-sq-micro font-medium text-sq-attention">
            This price book suggests different dimensions
          </p>
          <ul className="flex flex-col gap-0.5">
            {suggestions.map((entry) => (
              <li key={entry.field} className="sq-numeric text-sq-micro text-sq-ink">
                {suggestionLabel[entry.field]}: {entry.current.toLocaleString('en-AU')} →{' '}
                <strong>{entry.value.toLocaleString('en-AU')}</strong> mm
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={applySuggestions}
            className="min-h-11 self-start cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Use the suggested values
          </button>
          <p className="text-sq-micro text-sq-ink-muted">
            Nothing changes until you press it — these are the book&apos;s defaults, not your building.
          </p>
        </div>
      )}

      {/*
        The unit switch lives with the dimensions, not in a settings screen: it is a per-person
        preference and it changes what the numbers on screen mean. The record is always mm.
      */}
      <div className="flex items-center justify-between gap-sq-2">
        <p className="text-sq-micro text-sq-ink-muted">
          Dimensions are stored in millimetres, whatever you type in.
        </p>
        <div
          role="group"
          aria-label="Dimension unit"
          className="flex shrink-0 overflow-hidden rounded-md border border-sq-line"
        >
          {(['mm', 'm'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={unit === option}
              onClick={() => onUnitChange(option)}
              className={[
                'min-h-11 cursor-pointer px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast',
                unit === option ? 'bg-sq-brand text-white' : 'bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
              ].join(' ')}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-sq-2">
        <div>
        <DimensionField
          id="shed-span"
          label="Span (width)"
          valueMm={config.span}
          unit={unit}
          minMm={spanBounds.min}
          maxMm={spanBounds.max}
          required
          hint={
            config.span === null
              ? 'Enter the clear width inside the columns.'
              : outsideBookBounds(config.span, spanBounds) === null
                ? 'Clear width, inside the columns.'
                : outOfBookMessage('Span', config.span, spanBounds)
          }
          error={errorAt('shed-span')}
          onCommit={commitSpan}
        />
        <DriftLine entry={driftFor('span')} onPin={focusPin} />
        </div>
        <div>
        <DimensionField
          id="shed-height"
          label="Wall height"
          valueMm={config.height}
          unit={unit}
          minMm={heightBounds.min}
          maxMm={heightBounds.max}
          required
          hint={
            config.height === null
              ? 'Enter the wall height, floor to eave.'
              : outsideBookBounds(config.height, heightBounds) === null
                ? undefined
                : outOfBookMessage('Wall height', config.height, heightBounds)
          }
          error={errorAt('shed-height')}
          onCommit={commitHeight}
        />
        <DriftLine entry={driftFor('height')} onPin={focusPin} />
        </div>
      </div>

        {/*
          The awnings the rated building carries, read-only — in the **Shed** group, at the desktop's
          own position (#43-44, immediately after Span).

          This block first lived in Design, next to the six certified values, on the reasoning that it
          comes from the same ShedSafe response. That was wrong about the desktop: `FrontAwningWidthItem`
          and `RearAwningWidthItem` are Shed Parameters, and a person looking for the awning width looks
          where the width is. The values still arrive with the certificate; where they are shown is a
          separate question from where they come from.
          (`FrontAwningWidthItem`, `RearAwningWidthItem`).

          ## Why zero says "no awning" and not "0 mm"

          The desktop writes `#N/A` for zero, and that is the right reading: ShedSafe returns `0.0`
          for an end with no awning, which is a fact about the building, not a zero-width awning. A
          field showing "0 mm" invites somebody to think a dimension is missing.

          ## Why this does not create the awning option by itself

          An awning is a priced object with a depth, a pitch and a wall (`ShedOption`), and the
          certificate only states its **width in metres**. Adding one silently would put a structure
          on the drawing the operator never asked for; the button below offers it, which is the same
          "customer asks for it" rule the suggestions panel follows. When the widths and the options
          disagree the panel says so, so a quote cannot quietly drop an awning the certificate has.
        */}
        <dl className="grid grid-cols-2 gap-sq-2 rounded-md border border-sq-line bg-sq-ground/40 p-sq-2">
          {(
            [
              ['left', 'Front awning', check?.site?.leftAwningLength ?? null],
              ['right', 'Rear awning', check?.site?.rightAwningLength ?? null],
            ] as const
          ).map(([end, label, metres]) => {
            const wall = end === 'left' ? 'front' : 'back';
            const current = config.options.find(
              (option): option is Extract<typeof option, { kind: 'awning' }> =>
                option.kind === 'awning' && option.wall === wall,
            );
            const widthMm = metres === null ? null : Math.round(metres * 1000);
            const missing = widthMm !== null && widthMm > 0 && current === undefined;
            const differs =
              widthMm !== null && widthMm > 0 && current !== undefined && current.width !== widthMm;
            return (
              <div key={end} className="flex flex-col">
                <dt className="text-sq-micro text-sq-ink-muted">{label}</dt>
                <dd
                  id={`design-awning-${end}`}
                  className="sq-numeric text-sq-body text-sq-ink"
                >
                  {widthMm === null
                    ? '—'
                    : widthMm === 0
                      ? 'None on the certificate'
                      : `${widthMm.toLocaleString('en-AU')} mm`}
                </dd>
                {missing && (
                  <button
                    type="button"
                    /*
                     * Adds the awning the certificate rates, at the width ShedSafe states. Depth and
                     * pitch keep the option's own defaults: the certificate does not carry them, and
                     * inventing a projection would be a design decision, not a reading.
                     */
                    onClick={() => {
                      if (building === null) return;
                      const base = defaultOptionsFor('awning', building).find(
                        (option) => option.kind === 'awning',
                      );
                      if (base === undefined || base.kind !== 'awning') return;
                      applyPartial({
                        options: [
                          ...config.options,
                          { ...base, wall, width: widthMm } as typeof base,
                        ],
                      });
                    }}
                    className="mt-sq-1 min-h-11 cursor-pointer self-start rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
                  >
                    Add this awning
                  </button>
                )}
                {differs && (
                  <span className="mt-sq-1 text-sq-micro text-sq-attention">
                    The quote has {current.width.toLocaleString('en-AU')} mm. The certificate rates{' '}
                    {widthMm.toLocaleString('en-AU')} mm.
                  </span>
                )}
              </div>
            );
          })}
        </dl>

      {/*
        Typical Design — the knee brace the frame design names, read-only.

        ## Why it belongs here, and why it is not a control

        The desktop puts it in the Shed group at #47, directly after Height, and makes it read-only.
        That is right for two reasons: the brace is chosen by the structure table for **this** span,
        bay and height (`view_system_lookup_data.KB`), so there is nothing for a person to decide; and
        a brace somebody typed would not be the one the design was calculated with.

        ## Where the value comes from

        The evaluated cut list (`members`), which reads the same `scheduleFor` the priced frame lines
        use — so the section shown is the section ordered. `null` means "not known yet": no
        evaluation has finished, or the book states no section table for this combination. Saying
        "—" is the honest answer there; showing the fallback section would be presenting an
        assumption as the design.
      */}
      <div className="flex flex-col gap-sq-1">
        <span className="text-sq-micro font-medium text-sq-ink">Typical design (knee brace)</span>
        <span
          id="shed-kneeBrace"
          className="sq-numeric min-h-11 rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
        >
          {kneeBrace === null || kneeBrace === '' ? '—' : kneeBrace}
        </span>
        <span className="text-sq-micro text-sq-ink-muted">
          {kneeBrace === null || kneeBrace === ''
            ? 'Not known yet — the price book names a brace per span, bay and height, and none has been read for this building.'
            : 'Chosen by the price book for this span, bay and height. It is not typed.'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-sq-2">
        <div>
        <DimensionField
          id="shed-length"
          label="Overall length"
          valueMm={config.length}
          unit={unit}
          minMm={lengthBounds.min}
          maxMm={lengthBounds.max}
          required
          error={errorAt('shed-length')}
          onCommit={commitLength}
        />
        <DriftLine entry={driftFor('length')} onPin={focusPin} />
        </div>
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">
            Bays
            <span className="ml-1 text-sq-danger" aria-hidden="true">
              *
            </span>
          </span>
          <CommitNumberInput
            id="shed-bays"
            min={1}
            max={30}
            value={config.bays}
            aria-invalid={errorAt('shed-bays') !== undefined || undefined}
            aria-describedby={errorAt('shed-bays') !== undefined ? 'shed-bays-error' : 'shed-bays-hint'}
            onRefusal={setBaysRefusal}
            // A bay count without a length has nothing to divide; the length field says so.
            onCommit={(next) =>
              config.length === null ? false : applyBays({ length: config.length, bays: next, nomBaySpacing: 0 })
            }
            className={[
              'min-h-11 rounded-md border bg-sq-surface px-sq-2 py-sq-1 text-sq-body outline-none',
              errorAt('shed-bays') !== undefined ? 'border-sq-danger' : 'border-sq-line',
            ].join(' ')}
          />
          {errorAt('shed-bays') !== undefined ? (
            <span id="shed-bays-error" className="text-sq-micro text-sq-danger">
              {errorAt('shed-bays')}
            </span>
          ) : (
            <span id="shed-bays-hint" className="sq-numeric text-sq-micro text-sq-ink-muted">
              {unevenBays
                ? `${Math.min(...bayWidths).toLocaleString('en-AU')}–${Math.max(...bayWidths).toLocaleString('en-AU')} mm per bay — see Adjust bay spacing`
                : perBay === 0
                  ? '—'
                  : `${Math.round(perBay)} mm per bay`}
            </span>
          )}
          {baysRefusal !== null && (
            <span role="alert" className="text-sq-micro text-sq-danger">
              {baysRefusal}
            </span>
          )}
        </label>
      </div>

      <label className="flex flex-col gap-sq-1">
        <span className="text-sq-micro font-medium text-sq-ink">Nominal bay spacing</span>
        <span className="flex items-center gap-sq-2">
          <CommitNumberInput
            id="shed-nomBaySpacing"
            min={baySpacingBounds.min}
            max={baySpacingBounds.max}
            unit="mm"
            value={config.nomBaySpacing}
            aria-invalid={errorAt('shed-nomBaySpacing') !== undefined || undefined}
            aria-describedby={errorAt('shed-nomBaySpacing') !== undefined ? 'shed-nomBaySpacing-error' : undefined}
            onRefusal={setSpacingRefusal}
            // A spacing and a bay count are enough to state a length — that is the desktop's own
            // rule, and it is how a person enters the first dimension on a blank quote.
            onCommit={(next) =>
              applyBays({ length: config.length ?? next * config.bays, bays: config.bays, nomBaySpacing: next })
            }
            className={[
              'min-h-11 w-32 rounded-md border bg-sq-surface px-sq-2 text-sq-body outline-none',
              errorAt('shed-nomBaySpacing') !== undefined ? 'border-sq-danger' : 'border-sq-line',
            ].join(' ')}
          />
          <span className="text-sq-micro text-sq-ink-muted">
            mm — changing this sets the overall length
          </span>
        </span>
        {/* Templates and imports can carry a spacing the book refuses; the summary lists it, so the field says it too. */}
        {errorAt('shed-nomBaySpacing') !== undefined && (
          <span id="shed-nomBaySpacing-error" className="text-sq-micro text-sq-danger">
            {errorAt('shed-nomBaySpacing')}
          </span>
        )}
        {spacingRefusal !== null && (
          <span role="alert" className="text-sq-micro text-sq-danger">
            {spacingRefusal}
          </span>
        )}
      </label>
      {split !== null && config.length !== null && (
        <button
          type="button"
          onClick={() => applyBays({ length: config.length as number, bays: split.bays, nomBaySpacing: 0 })}
          className="min-h-11 self-start cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Split into {split.bays} bays of {split.each} mm
        </button>
      )}

      {/*
        Adjust bay spacing — the desktop's `UcAdjustBaySize` flyout: opens to the right of the form column
        (`SideFlyout`), like the PIN panel; on a phone it stays inline under this row.

        ## Why this is not just a nicety

        The frame table is keyed by the **largest** bay (`BayLargest`), so bays of different lengths are
        a different building from the same length divided evenly: 4 000/4 000/6 000 takes the 6 000 row.
        Without this panel the only way to describe such a building was to lie about it.

        ## What the desktop locks, and why

        Overall length and bay count are read-only here (`XPropertyGridAdustBaySize.cs` sets both
        `Enable = false`): changing either is a different building, and doing it inside a per-bay editor
        would renumber the field a person is looking at. They are edited above, in the Shed group.

        ## Sum is the length, not a check on it

        Each edit sets the length to the sum, which is `OnBayUnitsChange`. The desktop also has a
        "Total bay length differs from the overall length" message, but on this path it compares the sum
        with the value it has just written, so it can never fire — noted in the analysis and not
        reproduced.
      */}
      <div className="relative flex flex-col gap-sq-2 rounded-md border border-sq-line p-sq-2">
        <div className="flex items-center justify-between gap-sq-2">
          <div className="flex flex-col">
            <span className="text-sq-micro font-medium text-sq-ink">Bay spacing</span>
            <span className="sq-numeric text-sq-micro text-sq-ink-muted">
              {config.length === null ? 'Length not entered' : `${config.length.toLocaleString('en-AU')} mm overall`}
              {' · '}
              {config.bays} bays
              {unevenBays ? ' · uneven' : ''}
            </span>
          </div>
          <button
            ref={baysToggleRef}
            type="button"
            aria-expanded={showBays}
            aria-controls="shed-bays-flyout"
            onClick={() => {
              if (!baysOpen) closePin();
              setBaysOpen((open) => !open);
            }}
            className="min-h-11 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            {showBays ? 'Hide bays' : 'Adjust bay spacing'}
          </button>
        </div>
        {showBays && (
          <SideFlyout
            id="shed-bays-flyout"
            title="Adjust bay spacing"
            closeLabel="Close bay spacing"
            onClose={() => setBaysOpen(false)}
            arrowTargetRef={baysToggleRef}
            phone="inline"
          >
          <div id="shed-bayWidths" className="grid grid-cols-2 gap-sq-2">
            {bayWidths.map((width, index) => (
              <label key={index} className="flex flex-col gap-sq-1">
                <span className="text-sq-micro text-sq-ink">
                  Bay {String(index + 1).padStart(2, '0')} (mm)
                </span>
                <CommitNumberInput
                  id={`shed-bayWidth-${index}`}
                  min={baySpacingBounds.min}
                  max={baySpacingBounds.max}
                  unit="mm"
                  value={width}
                  onRefusal={(message) => setBayWidthRefusal(message === null ? null : { index, message })}
                  onCommit={(next) => {
                    const widths = [...bayWidths];
                    widths[index] = next;
                    return applyBayWidths(widths);
                  }}
                  aria-label={`Bay ${index + 1} length in millimetres`}
                  aria-invalid={errorAt(`shed-bayWidth-${index}`) !== undefined || undefined}
                  aria-describedby={
                    errorAt(`shed-bayWidth-${index}`) !== undefined ? `shed-bayWidth-${index}-error` : undefined
                  }
                  className={[
                    'min-h-11 rounded-md border bg-sq-surface px-sq-2 text-sq-body outline-none',
                    errorAt(`shed-bayWidth-${index}`) !== undefined ? 'border-sq-danger' : 'border-sq-line',
                  ].join(' ')}
                />
                {errorAt(`shed-bayWidth-${index}`) !== undefined && (
                  <span id={`shed-bayWidth-${index}-error`} className="text-sq-micro text-sq-danger">
                    {errorAt(`shed-bayWidth-${index}`)}
                  </span>
                )}
                {bayWidthRefusal?.index === index && (
                  <span role="alert" className="text-sq-micro text-sq-danger">
                    {bayWidthRefusal.message}
                  </span>
                )}
              </label>
            ))}
            <p className="col-span-2 text-sq-micro text-sq-ink-muted">
              Each bay is its own length and the overall length is their sum. The steel frame is sized
              from the <strong>longest</strong> bay, so lengthening one bay can move every column and
              rafter to the next section.
            </p>
            {unevenBays && (
              <button
                type="button"
                onClick={() => {
                  if (config.length === null) return;
                  applyBays({ length: config.length, bays: config.bays, nomBaySpacing: 0 });
                }}
                className="col-span-2 min-h-11 self-start cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
              >
                Divide equally again
              </button>
            )}
          </div>
          </SideFlyout>
        )}
      </div>

      {/*
        Sheeting: a **profile and a thickness**, chosen together.

        ## Why the thickness is here at all

        The book prices the pair (`view_cost_sheeting` is keyed by `profile` + `bmt`), and the pair
        moves the quote twice over: a thicker sheet costs more per metre (Corro 0.42 is $8.45, 0.48 is
        $9.93) and a different profile covers a different width (Corro 762 mm, Lo-Rib 817 mm, so 7%
        fewer sheets). Measured on a 12 × 24 m shed: a Lo-Rib roof is **$273.63 lower** and a 0.48 Corro
        roof **$430.63 higher** than the 0.42 Corro default this build used to hard-code.

        ## Why the pair, not two free choices

        A thickness the chosen profile is not sold in finds **no price row**, and the whole sheeting
        group turns into a mocked line. So picking a profile snaps the thickness to one the book stocks
        for it, and the dropdown only lists those.
      */}
      <div className="grid grid-cols-2 gap-sq-2">
        {wallProfiles.length > 0 && (
          <div className="flex flex-col gap-sq-1">
            <SelectField
              id="shed-wallProfile"
              label="Wall profile"
              value={config.wallProfile}
              options={wallProfiles.map((profile) => ({ value: profile.profile, label: profile.profile }))}
              onChange={(value) => {
                const bmt = snapBmt(wallProfiles, value, config.wallBmt);
                applyPartial({ wallProfile: value, wallBmt: bmt });
              }}
            />
            <SelectField
              id="shed-wallBmt"
              label="Wall thickness"
              value={String(snapBmt(wallProfiles, config.wallProfile, config.wallBmt))}
              options={bmtOptions(wallProfiles, config.wallProfile)}
              onChange={(value) => applyPartial({ wallBmt: Number(value) })}
            />
          </div>
        )}
        {roofProfiles.length > 0 && (
          <div className="flex flex-col gap-sq-1">
            <SelectField
              id="shed-roofProfile"
              label="Roof profile"
              value={config.roofProfile}
              options={roofProfiles.map((profile) => ({ value: profile.profile, label: profile.profile }))}
              onChange={(value) => {
                const bmt = snapBmt(roofProfiles, value, config.roofBmt);
                applyPartial({ roofProfile: value, roofBmt: bmt });
              }}
            />
            <SelectField
              id="shed-roofBmt"
              label="Roof thickness"
              value={String(snapBmt(roofProfiles, config.roofProfile, config.roofBmt))}
              options={bmtOptions(roofProfiles, config.roofProfile)}
              onChange={(value) => applyPartial({ roofBmt: Number(value) })}
            />
          </div>
        )}
      </div>

      {/*
        Downpipe type, from the book rather than typed.

        The desktop's list was `SELECT DISTINCT downpipe_kind` (`RepositoryDownpipe`), so the two
        materials a shed can be quoted with are whatever the book stocks — `PVC` and `STEEL` on the
        reference book — and the free-text field here could be told `Copper`, which no row prices.

        Changing it also re-filters the downpipe colour (§5.3 of the desktop analysis): PVC is sold in
        White alone, steel in every other colour. That is a cross-section rule, sitting in the Shed
        group but changing a Colours field, and it is the reason this handler does more than one
        assignment.
      */}
      {downpipeMaterials.length > 0 && (
        <SelectField
          id="shed-downpipeType"
          label="Downpipe type"
          value={config.downpipeType}
          options={[
            // An explicit empty choice, because the material decides which colours are legal. A
            // select that silently starts on PVC would make PVC look like a decision somebody made.
            { value: '', label: 'Choose a material' },
            ...downpipeMaterials.map((material) => ({
              value: material.kind,
              label: material.kind,
            })),
          ]}
          onChange={(value) =>
            applyPartial({
              downpipeType: value,
              colors: {
                ...config.colors,
                // Kept legal on the same edit: a steel Monument downpipe that becomes PVC White is a
                // colour change the operator sees in the Colours group, not an unpriced BOM.
                downpipe:
                  reconcileDownpipeColour(
                    config.colors.downpipe,
                    value,
                    config.colors.wall,
                    downpipeMaterials,
                    catalogue?.colours ?? [],
                  ) ?? config.colors.downpipe,
              } as never,
            })
          }
          hint="PVC is sold in White only; steel is sold in the full colour range."
        />
      )}

      <div className="grid grid-cols-2 gap-sq-2">
        {catalogue !== null && catalogue.footingTypes.length > 0 && (
          <SelectField
            id="shed-footingType"
            label="Footing type"
            value={config.footingType}
            options={catalogue.footingTypes.map((footing) => ({
              value: footing.code,
              label: footing.label,
            }))}
            onChange={(value) => applyPartial({ footingType: value })}
          />
        )}
        {catalogue !== null && catalogue.footingSubTypes.length > 0 && (
          <SelectField
            id="shed-footingSubType"
            label="Footing sub-type"
            value={config.footingSubType}
            options={catalogue.footingSubTypes.map((footing) => ({
              value: footing.code,
              label: footing.label,
            }))}
            onChange={(value) => applyPartial({ footingSubType: value })}
          />
        )}
      </div>

      {/*
        A combobox, not a slider: the slider fired on every pixel and asked the "removes every option"
        confirm on each. The list is the book's pitches for this span; the box takes any pitch inside the
        book's range (the desktop's dropdown is editable), committed once.
      */}
      <PitchCombobox
        id="shed-roofPitchDeg"
        label="Roof pitch"
        value={config.roofPitchDeg > 0 ? config.roofPitchDeg : null}
        hints={pitchHints}
        bounds={pitchBounds}
        onCommit={(deg) => applyDimension({ roofPitchDeg: deg })}
        error={errorAt('shed-roofPitchDeg')}
        noteTone={pitchUnlisted ? 'attention' : 'muted'}
        note={
          pitchUnlisted ? (
            <>
              {config.roofPitchDeg}° is between the pitches this book lists for a{' '}
              {spanForBook === null ? 'this' : `${(spanForBook / 1000).toFixed(1)} m`} span (
              {pitchHints.join(', ')}°). It prices as an assumption.
            </>
          ) : pitchHints.length > 0 ? (
            <>The book sells {pitchHints.join(', ')}° at this span.</>
          ) : undefined
        }
      />

      {/*
        The two heights a person has to state elsewhere: on a council application and on a delivery
        quote. Both are **read-only** because neither is a decision — they follow from the span, the
        wall height and the pitch, and typing over one would describe a roof the drawing does not show.

        The desktop shows only the average, in its Building Parameters panel
        (`UcShowBuildingParameterss.cs:786-841`). The ridge is here as well because an average beside a
        pitch slider is not self-explanatory: "average 4 404" does not tell anyone the peak is 5 208,
        and the peak is what hits a car on a truck. The average is the number the certificate wants;
        both are labelled with which is which.
      */}
      <dl className="grid grid-cols-2 gap-sq-2 rounded-md border border-sq-line bg-sq-ground/40 p-sq-2">
        <div className="flex flex-col">
          <dt className="text-sq-micro text-sq-ink-muted">Average height</dt>
          <dd id="shed-averageHeight" className="sq-numeric text-sq-body text-sq-ink">
            {averageHeight === null ? '—' : `${formatDimension(averageHeight, unit)} ${unit}`}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-sq-micro text-sq-ink-muted">
            Ridge {config.structureType === 'skillion' ? '(high side)' : 'height'}
          </dt>
          <dd className="sq-numeric text-sq-body text-sq-ink">
            {ridgeHeight === null ? '—' : `${formatDimension(ridgeHeight, unit)} ${unit}`}
          </dd>
        </div>
      </dl>
    </Group>
  );
}
