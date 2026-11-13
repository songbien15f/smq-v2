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
import { Field, StatusPill } from '@sq/ui';
import { AddressField } from '../AddressField';
import { DimensionField } from '../DimensionField';
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

export function ColourGroup({ issuesByPath }: { issuesByPath: Map<string, DraftIssue> }) {
  const config = useShedStoreConfig();
  /** The switch creates an option, and an option needs a building to sit on. */
  const building = withDimensions(config);
  const applyPartial = useApplyBuilding();
  const { catalogue } = useCatalogue();
  /*
   * The swatches, from the **book**, falling back to the built-in Colorbond map.
   *
   * ## Why the constant was wrong
   *
   * `COLORBOND` in `domain/defaults.ts` is a hand-kept list of 30 standard Colorbond names, and on
   * 2026-11-11 it disagreed with the book in five names: it lacked `White`, `Colour TBA`,
   * `Pale Eucalypt` and `Cottage Green`, and carried `Bushland`, `Headland`, `Loft`, `Sandbank` and
   * `Wilderness`, which the reference book does not stock. Measured consequence: choosing PVC showed
   * an **empty** swatch grid, because the only PVC colour is White and White was not in the constant.
   *
   * The book is the source of truth for what the factory sells (decision D4), so the grid reads
   * `system_colour` through the catalogue. The constant stays as the fallback for a book that has not
   * loaded yet, so the grid is never empty while the fetch is in flight.
   */
  const entries: [string, string][] =
    catalogue !== null && catalogue.colours.length > 0
      ? catalogue.colours.map((colour) => [colour.name, colour.hex])
      : (Object.entries(COLORBOND) as [string, string][]);
  /*
   * The palette a role may be picked from, which for one role is **not** the whole Colorbond range.
   *
   * The downpipe is painted in whatever colours its material is stocked in, so with PVC chosen the
   * only swatch on offer is White. This filter is the whole of the cross-section rule on this side:
   * the Shed group creates the legality, this grid enforces it. Demo it the other way round and a
   * quote carries a Monument PVC pipe that no `downpipe` row prices.
   *
   * Every other role keeps the whole list: the book sells each of them in every finish.
   */
  const downpipeNames =
    config.downpipeType.trim() === ''
      ? null
      : catalogue?.downpipeMaterials.find(
          (material) => material.kind.toLowerCase() === config.downpipeType.trim().toLowerCase(),
        )?.colourNames ?? null;
  /*
   * Filtered by **name**, because three book colours share the white hex (`White`, `Colour TBA`,
   * `Not Applicable`). Filtering the swatches by hex showed all three for PVC and marked all three as
   * the chosen colour — measured 2026-11-11. The book's list is names, so the list is what is applied;
   * the hex comparison is kept only for "is the stored colour legal", where a hex is all there is.
   */
  const downpipeHexes = downpipePalette(catalogue?.colours ?? [], downpipeNames ?? undefined);
  const entriesFor = (key: keyof ShedColors): [string, string][] => {
    if (key !== 'downpipe' || downpipeNames === null || downpipeNames.length === 0) return entries;
    const allowed = new Set(downpipeNames.map((name) => name.trim().toLowerCase()));
    return entries.filter(([name]) => allowed.has(name.trim().toLowerCase()));
  };
  /**
   * Which role's palette is open, or `null` for none.
   *
   * One at a time: walls and roof are two decisions, and ten open palettes is what made this block
   * 1 992 px tall. Kept in the component rather than in `Group` so collapsing the whole Colours group
   * and reopening it starts from the summary rows again.
   */
  const [paletteOpen, setPaletteOpen] = useState<keyof ShedColors | null>(null);
  /** True when the building carries any horizontal-cladding band. */
  const claddingOn = config.options.some((option) => option.kind === 'horizontal_cladding');

  /** The Colorbond name for a hex, so the field can show the name rather than the code. */
  const nameOf = (hex: string): string =>
    entries.find(([, value]) => value.toLowerCase() === hex.toLowerCase())?.[0] ?? '';

  const setColour = (key: keyof ShedColors, hex: string): void => {
    applyPartial({ colors: { ...config.colors, [key]: hex } as never });
  };

  return (
    <Group
      id="group-colour"
      title="Colours"
      issueCount={COLOUR_ROLES.filter((key) => issuesByPath.has(`colours-${key}`)).length}
    >
      <div className="flex flex-col gap-sq-3">
        {/*
          The desktop's "Assign Wall Colour for All": most sheds are one colour, and
          choosing it ten times is ten chances to leave one surface in the old colour.
        */}
        <button
          type="button"
          onClick={() => {
            const wall = config.colors.wall;
            applyPartial({
              colors: Object.fromEntries(COLOUR_ROLES.map((role) => [role, wall])) as never,
            });
          }}
          className="min-h-11 self-start cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
        >
          Assign wall colour to all
        </button>
        {COLOUR_ROLES.map((key) => {
          const label = COLOUR_LABELS[key];
          const hex = config.colors[key];
          const name = nameOf(hex);
          const editing = paletteOpen === key;
          const palette = entriesFor(key);
          /*
           * True when the stored colour is not in the palette this role now offers.
           *
           * Reachable only by loading a quote made under a different material — the write paths keep
           * the pair legal — and saying so is better than drawing a swatch that cannot be re-picked.
           */
          const offPalette =
            key === 'downpipe' &&
            downpipeHexes != null &&
            downpipeHexes.length > 0 &&
            !downpipeHexes.some((allowed) => allowed.toLowerCase() === hex.toLowerCase());
          return (
            // `data-issue-path`: the row's button and palette swatches have their own ids, so leaving
            // either marks the role's issue path touched (QuoteEditor `markTouched`).
            <fieldset key={key} className="flex flex-col gap-sq-1" data-issue-path={`colours-${key}`}>
              {/*
                A row that opens its palette, not ten palettes at once.

                Ten radio groups of 30 swatches each is 1 992 px of this screen — 26% of a phone's
                whole scroll (measured 2026-08-11-style, 2026-11-08: 7 722 px page, 1 992 px of
                colour). Most sheds use one colour for everything, so nine of those ten groups are
                information nobody reads, sitting between the operator and the price.

                The row still **shows** the chosen colour: a 32 px swatch, its name, and the role.
                Tapping it opens that one palette. One open at a time, because picking a colour for
                the walls and one for the roof is two decisions, not one.
              */}
              <button
                type="button"
                aria-expanded={editing}
                aria-controls={`colours-${key}-palette`}
                aria-label={`${label}: ${name === '' ? hex : name}. Change colour`}
                aria-invalid={issuesByPath.has(`colours-${key}`) || undefined}
                onClick={() => setPaletteOpen(editing ? null : key)}
                className={[
                  'flex min-h-11 w-full items-center gap-sq-2 rounded-md px-sq-1 text-left transition-colors duration-sq-fast hover:bg-sq-ground',
                  issuesByPath.has(`colours-${key}`) ? 'ring-1 ring-sq-danger' : '',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-8 shrink-0 rounded-md border border-sq-line"
                  style={{ backgroundColor: hex }}
                />
                <span className="min-w-0 flex-1 truncate text-sq-body text-sq-ink">{label}</span>
                <span className="sq-numeric shrink-0 text-sq-micro text-sq-ink-muted">
                  {name === '' ? hex : name}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className={`shrink-0 text-sq-ink-muted transition-transform duration-sq-fast ${editing ? 'rotate-90' : ''}`}
                >
                  <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {editing && (
                /*
                  A radio group in a scrollable grid rather than a `<select>`: a colour is chosen by
                  looking at it, and a dropdown showing 30 names and no colours makes the operator
                  read. The swatch is the information — which is why this stays a grid of swatches and
                  only its *visibility* changed.
                */
                <div
                  id={`colours-${key}-palette`}
                  role="radiogroup"
                  aria-label={`${label} colour`}
                  aria-invalid={issuesByPath.has(`colours-${key}`) || undefined}
                  aria-describedby={
                    issuesByPath.has(`colours-${key}`) ? `colours-${key}-error` : undefined
                  }
                  className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto rounded-md border border-sq-line p-sq-2"
                >
                  {palette.map(([colourName, colourHex], index) => {
                    /*
                     * One selected swatch, not every swatch that shares the hex.
                     *
                     * `Z450 Galv` and `Z600 Galv` are the same grey in the book, so an equality test
                     * on hex marks both — the screen then claims the downpipe is two colours. The
                     * stored value cannot say which of them was picked, so the first match is shown as
                     * chosen and the rest are ordinary options.
                     */
                    const selected =
                      hex.toLowerCase() === colourHex.toLowerCase() &&
                      palette.findIndex(([, other]) => other.toLowerCase() === hex.toLowerCase()) ===
                        index;
                    return (
                      <button
                        key={colourName}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={colourName}
                        title={colourName}
                        onClick={() => {
                          setColour(key, colourHex);
                          // Pick and close: the row above now shows the answer, so an open palette
                          // would be asking the same question again.
                          setPaletteOpen(null);
                        }}
                        className={[
                          'grid h-8 w-8 cursor-pointer place-items-center rounded-md border transition-transform duration-sq-fast',
                          selected
                            ? 'border-sq-brand ring-2 ring-sq-brand ring-offset-1'
                            : 'border-sq-line hover:scale-105',
                        ].join(' ')}
                        style={{ backgroundColor: colourHex }}
                      >
                        {selected && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="3.5"
                            aria-hidden="true"
                          >
                            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {offPalette && (
                <p className="text-sq-micro text-sq-danger">
                  {name === '' ? hex : name} is not sold on a {config.downpipeType} downpipe. Pick one
                  of the colours above.
                </p>
              )}
              {issuesByPath.has(`colours-${key}`) && (
                <p id={`colours-${key}-error`} className="text-sq-micro text-sq-danger">
                  {issuesByPath.get(`colours-${key}`)?.short}
                </p>
              )}
            </fieldset>
          );
        })}

        {/*
          Horizontal cladding — the desktop's one **child control inside Colours** (`#61`, a boolean
          directly under Wall, not a category in the Options dock).

          ## Why it is a switch here rather than a dock entry

          It is a property of the wall's finish: `HorizontalCladdingItem` sits under `ColorWallItem` in
          the desktop's property grid, and the BOM charges a batten row behind each band
          (`claddingLines`). The dock has no such category either — this build's `CATEGORY_DOCK` is the
          book's 21 categories minus this one, because the book places it here.

          ## What it creates, and why a default band

          On, it creates one `horizontal_cladding` option spanning the full wall height — the sensible
          first band, which the operator then narrows on the plan. Off, every cladding option is
          removed: a quote whose colour block says "no cladding" while a priced option exists is two
          answers to one question.

          The band's `from`/`to` and wall are editable in the object editor like any other option, so
          this switch decides **whether**, and the plan decides **where**.
        */}
        <label className="flex items-start justify-between gap-sq-2 pt-sq-1">
          <span className="flex flex-col">
            <span className="text-sq-micro font-medium text-sq-ink">Horizontal cladding</span>
            <span className="text-sq-micro text-sq-ink-muted">
              A band of wall cladding with its own batten row. The band is set on the plan.
            </span>
          </span>
          <input
            id="colours-horizontalCladding"
            type="checkbox"
            checked={claddingOn}
            onChange={(event) => {
              if (event.target.checked) {
                if (building === null) return;
                const base = defaultOptionsFor('horizontal_cladding', building).find(
                  (option) => option.kind === 'horizontal_cladding',
                );
                if (base === undefined) return;
                applyPartial({ options: [...config.options, base] });
                return;
              }
              applyPartial({
                options: config.options.filter((option) => option.kind !== 'horizontal_cladding'),
              });
            }}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-sq-brand)]"
          />
        </label>
      </div>
    </Group>
  );
}
