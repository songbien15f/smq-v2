'use client';

/**
 * Step 1 — the six groups the desktop's Quote Details panel has, in the same order:
 * Quote & client · Site · Delivery · Design · Shed · Colours.
 *
 * ## The three decisions in this screen worth stating
 *
 * **1. Collapsible groups, not tabs.** All six are on one page, so a person can see what a quote
 * needs at a glance and fix a dimension without losing the customer's name. Tabs hide four sixths
 * of the form and make "what is missing" a memory exercise.
 *
 * **2. Colours are names, not hex.** An Australian shed customer says "Shale Grey"; `#bdbfba` is
 * a value only a screen needs. The swatch grid shows the name and the colour together, because
 * either alone is ambiguous — two Colorbond names can be a shade apart.
 *
 * **3. The state picks the prices.** `stateCode` is the reason a quote in Queensland costs
 * differently from the same shed in Victoria, so it sits in Design next to the wind region rather
 * than being buried with the address.
 */

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
import { downpipePalette, reconcileDownpipeColour } from '@sq/core/domain';
import { defaultOptionsFor } from '@sq/core/domain';
import {
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
import type { DisplayUnit, ShedColors, ShedConfig, StructureType } from '@sq/core/domain';
import { Field, StatusPill } from '@sq/ui';
import { AddressField } from './AddressField';
import { DimensionField } from './DimensionField';
import type { DraftIssue } from './validation';
import { useDraftStore } from '@/store/useDraftStore';
import { useSiteCheck } from './siteCheckState';
import { useShedStore } from '@/store/useShedStore';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useCompanyPricing } from '@/hooks/useCompanyPricing';

/** A group that can be collapsed, remembering nothing between visits on purpose. */
export function Group({
  title,
  count,
  issueCount,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** A short right-aligned note, e.g. "3 of 4 required". */
  count?: string;
  issueCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="border-b border-sq-line last:border-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          /*
           * An explicit accessible name rather than letting the browser concatenate the parts.
           *
           * Without it the computed name is `Delivery1 to fix` — the visible pill runs into the
           * title with no separator, so a screen reader announces "Delivery one to fix" as one
           * word. The pill stays for the eye; this states the same fact in words for the ear.
           */
          aria-label={
            issueCount > 0
              ? `${title}, ${issueCount} ${issueCount === 1 ? 'item needs' : 'items need'} attention`
              : title
          }
          className="flex min-h-11 w-full cursor-pointer items-center gap-sq-2 px-sq-3 text-left transition-colors duration-sq-fast hover:bg-sq-ground/70"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
            className={`shrink-0 text-sq-ink-muted transition-transform duration-sq-fast ${open ? 'rotate-90' : ''}`}
          >
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sq-body font-semibold text-sq-ink">{title}</span>
          {issueCount > 0 && <StatusPill tone="attention" label={`${issueCount} to fix`} />}
          {count !== undefined && (
            <span className="ml-auto text-sq-micro text-sq-ink-muted">{count}</span>
          )}
        </button>
      </h3>
      {open && (
        <div id={panelId} className="flex flex-col gap-sq-3 px-sq-3 pb-sq-3">
          {children}
        </div>
      )}
    </section>
  );
}

export interface QuoteDetailsPanelProps {
  /** Issues addressed to this panel's fields, by path. */
  issuesByPath: Map<string, DraftIssue>;
  unit: DisplayUnit;
  onUnitChange: (unit: DisplayUnit) => void;
  /**
   * The ShedSafe site check, dropped in **after Delivery and before Design**.
   *
   * A slot rather than importing the panel here, because the panel needs the quote id, the session and
   * the import callback — all of which live in `QuoteEditor`. Passing them down would give this file a
   * second copy of props it does not otherwise use, and the panel would be rendered from two places.
   *
   * ## Why exactly here
   *
   * The desktop puts PIN inside the Site Address field, so "type the address, pin the site" is one
   * motion. The panel used to sit below the whole form — measured 2026-11-10: the site address at
   * `top 916`, the pin button at `top 3572`. A person filled three address groups, then had to scroll
   * past the entire design section to find the one thing those addresses were for.
   *
   * Between Delivery and Design is where the *result* is needed too: the six values it returns are
   * read by the Design group immediately below, so pin → import → Design fills in is one downward
   * scroll with nothing else in between.
   */
  siteCheck?: React.ReactNode;
  /**
   * The knee brace the frame design names, from the evaluated cut list.
   *
   * `null` for "not known": no evaluation yet, or a book without a section table. The desktop's field
   * is read-only and cannot be anything else — the new line is `.catch(() => '—')` on purpose.
   */
  kneeBrace?: string | null;
}

export function QuoteDetailsPanel({
  issuesByPath,
  unit,
  onUnitChange,
  siteCheck,
  kneeBrace = null,
}: QuoteDetailsPanelProps) {
  const customer = useDraftStore((state) => state.customer);
  const quoteNumber = useDraftStore((state) => state.quoteNumber);
  const site = useDraftStore((state) => state.site);
  const setCustomer = useDraftStore((state) => state.setCustomer);
  const setSite = useDraftStore((state) => state.setSite);
  const pricing = useDraftStore((state) => state.pricing);
  const setPricing = useDraftStore((state) => state.setPricing);
  const { catalogue } = useCatalogue();
  const deliveryScopes = catalogue?.deliveryScopes ?? [];
  const { minimumFees } = useCompanyPricing();
  /* The state selects this state's freight figure from the book; read it reactively, not once. */
  const stateCode = useShedStore((state) => state.config.stateCode);

  /*
   * Picking a delivery scope fills the freight the book states for it.
   *
   * This is the half of the desktop's behaviour that was missing entirely: the book lists a figure per
   * scope ("Delivered to site 301-400 km" is $650), and choosing the scope changed nothing, so the
   * operator had to go and look the number up.
   *
   * The two minimum-fee scopes are **skipped on purpose** — their figure is a percentage of the job,
   * and the job's value is not known on this step. `baseCents: 0` would compute a minimum of zero, so
   * the suggestion is only applied when it came from the book. Those two are handled on the Cost step,
   * where the price is in hand, and the sentence below the select says so.
   */
  const chooseDeliveryScope = (value: string): void => {
    const suggestion = deliveryForScope({
      scope: value,
      stateCode,
      scopes: deliveryScopes,
      minimums: minimumFees,
      baseCents: 0,
      quoteRatePct: pricing.quoteRatePct,
    });
    if (suggestion !== null && suggestion.kind === 'book') {
      setPricing({ deliveryCents: suggestion.cents });
    }
  };

  const scopeFreightKind = freightScope(site.deliveryScope);
  const minimumsConfigured =
    minimumFees.distributorDollarCents > 0 ||
    minimumFees.distributorPercent > 0 ||
    minimumFees.carrierDollarCents > 0 ||
    minimumFees.carrierPercent > 0;
  const minimumHeld = scopeFreightKind !== null && minimumsConfigured;

  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;
  const countIn = (paths: string[]): number =>
    paths.filter((path) => issuesByPath.has(path)).length;

  return (
    <div className="flex flex-col">
      {/*
        `issueCount` only. An earlier version also passed a `count` string built from the same
        number, and the heading rendered "3 to fix 3 to fix" — two labels for one fact, visible in
        the browser and invisible in the type checker.
      */}
      <Group
        title="Quote & client"
        issueCount={countIn(['customer-firstName', 'customer-lastName', 'customer-email'])}
      >
        {/*
          Quote No. — the desktop's first field (#1), read-only.

          It is generated when the quote is first saved, so a new quote has none yet; that is the
          `—` case and the hint says so. Showing it here rather than only in the header matters when
          a customer quotes the number back on the phone: the operator is on this screen, and the
          number belongs with the quote's own details.
        */}
        <div className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Quote no.</span>
          <span
            id="customer-quoteNumber"
            className="sq-numeric min-h-[38px] rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
          >
            {quoteNumber ?? '—'}
          </span>
          <span className="text-sq-micro text-sq-ink-muted">
            {quoteNumber === null
              ? 'Assigned when the quote is first saved.'
              : 'Assigned by the system. It is not typed.'}
          </span>
        </div>

        {/*
          Quote rate sits in this group because the desktop puts it here: it is a
          property of the sale, agreed with the customer, not a figure discovered at
          the cost step. It moves the total on every quote, so it must be visible
          before anyone reaches the price.
        */}
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Quote rate (%)</span>
          <input
            id="customer-quoteRatePct"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.5}
            value={pricing.quoteRatePct}
            onChange={(event) => setPricing({ quoteRatePct: Number(event.target.value) })}
            className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body outline-none"
          />
          <span className="text-sq-micro text-sq-ink-muted">
            An uplift on the whole job; 0 for none.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-sq-2">
          <Field
            id="customer-firstName"
            label="First name"
            required
            autoComplete="given-name"
            value={customer.firstName}
            onChange={(event) => setCustomer({ firstName: event.target.value })}
            error={errorAt('customer-firstName')}
          />
          <Field
            id="customer-lastName"
            label="Last name"
            required
            autoComplete="family-name"
            value={customer.lastName}
            onChange={(event) => setCustomer({ lastName: event.target.value })}
            error={errorAt('customer-lastName')}
          />
        </div>
        <Field
          id="customer-email"
          label="Email"
          type="email"
          inputMode="email"
          required
          autoComplete="email"
          hint="The quote is emailed here."
          value={customer.email}
          onChange={(event) => setCustomer({ email: event.target.value })}
          error={errorAt('customer-email')}
        />
        <div className="grid grid-cols-2 gap-sq-2">
          <Field
            id="customer-phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={customer.phone}
            onChange={(event) => setCustomer({ phone: event.target.value })}
          />
          <Field
            id="customer-mobile"
            label="Mobile"
            type="tel"
            inputMode="tel"
            value={customer.mobile}
            onChange={(event) => setCustomer({ mobile: event.target.value })}
          />
        </div>
        {/*
          The desktop's Fax column. Lowercase because it is now the least-used field on
          the form and should not compete with phone and mobile — but it is a field the
          quote document prints, so it stays.
        */}
        <Field
          id="customer-fax"
          label="Fax"
          type="tel"
          inputMode="tel"
          value={customer.fax}
          onChange={(event) => setCustomer({ fax: event.target.value })}
        />
        {/*
          The address, with suggestions. Picking one fills the street line **and** the suburb, state
          and postcode below — because the state selects the price table, and a suggestion that
          filled only the street would leave the one field a typo makes expensive.
        */}
        <AddressField
          id="customer-address"
          label="Customer address"
          value={customer.address}
          onChange={(address) => setCustomer({ address })}
          onResolved={(parts) =>
            setCustomer({
              address: parts.address,
              ...(parts.suburb === '' ? {} : { suburb: parts.suburb }),
              ...(parts.state === '' ? {} : { state: parts.state }),
              ...(parts.postcode === '' ? {} : { postcode: parts.postcode }),
            })
          }
          hint="Start typing and pick the address — the suburb, state and postcode fill in."
        />
        <div className="grid grid-cols-3 gap-sq-2">
          <Field
            id="customer-suburb"
            label="Suburb"
            autoComplete="address-level2"
            value={customer.suburb}
            onChange={(event) => setCustomer({ suburb: event.target.value })}
          />
          <Field
            id="customer-state"
            label="State"
            autoComplete="address-level1"
            maxLength={3}
            value={customer.state}
            onChange={(event) => setCustomer({ state: event.target.value.toUpperCase() })}
          />
          <Field
            id="customer-postcode"
            label="Postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            value={customer.postcode}
            onChange={(event) => setCustomer({ postcode: event.target.value })}
          />
        </div>
      </Group>

      <Group title="Site address" issueCount={countIn(['site-address'])}>
        <div className="flex items-center justify-between gap-sq-2">
          <p className="text-sq-micro text-sq-ink-muted">
            Where the shed is built. Often not the customer&apos;s address.
          </p>
          <button
            type="button"
            onClick={() =>
              setSite({
                address: customer.address,
                suburb: customer.suburb,
                state: customer.state,
                postcode: customer.postcode,
              })
            }
            className="min-h-9 shrink-0 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Copy from customer
          </button>
        </div>
        <Field
          id="site-address"
          label="Site address"
          required
          value={site.address}
          onChange={(event) => setSite({ address: event.target.value })}
          error={errorAt('site-address')}
        />
        <div className="grid grid-cols-3 gap-sq-2">
          <Field
            id="site-suburb"
            label="Suburb"
            value={site.suburb}
            onChange={(event) => setSite({ suburb: event.target.value })}
          />
          <Field
            id="site-state"
            label="State"
            maxLength={3}
            value={site.state}
            onChange={(event) => setSite({ state: event.target.value.toUpperCase() })}
          />
          <Field
            id="site-postcode"
            label="Postcode"
            inputMode="numeric"
            maxLength={4}
            value={site.postcode}
            onChange={(event) => setSite({ postcode: event.target.value })}
          />
        </div>
      </Group>

      <Group
        title="Delivery"
        issueCount={countIn(['site-deliveryAcknowledged'])}
        defaultOpen={false}
      >
        <div className="flex items-start justify-between gap-sq-2">
          <p className="text-sq-micro text-sq-ink-muted">
            Where the materials are delivered. Often the site itself.
          </p>
          <button
            type="button"
            onClick={() =>
              setSite({
                deliveryAddress: [site.address, site.suburb, site.state, site.postcode]
                  .map((part) => part.trim())
                  .filter((part) => part !== '')
                  .join(', '),
              })
            }
            className="min-h-9 shrink-0 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Copy from above
          </button>
        </div>
        <Field
          id="site-deliveryAddress"
          label="Delivery address"
          hint="Leave blank to deliver to the site."
          value={site.deliveryAddress}
          onChange={(event) => setSite({ deliveryAddress: event.target.value })}
        />
        {deliveryScopes.length > 0 ? (
          <>
            <SelectField
              id="site-deliveryScope"
              label="Delivery scope"
              value={site.deliveryScope}
              options={deliveryScopes.map((scope) => ({ value: scope.name, label: scope.name }))}
              onChange={(value) => {
                /*
                 * Changing the scope un-ticks the acknowledgement.
                 *
                 * The desktop does exactly this (`Events.cs:573-582`), and the reason is that the tick
                 * is not a property of the quote — it is a statement about **one specific set of
                 * delivery terms**. Leaving it ticked across a scope change records an acknowledgement
                 * of terms the customer never saw, which is the opposite of what a delivery-dispute
                 * record is for. Only reset when the value actually moves: re-selecting the same scope
                 * is not a new set of terms.
                 */
                if (value !== site.deliveryScope) {
                  setSite({ deliveryScope: value, deliveryAcknowledged: false });
                }
                chooseDeliveryScope(value);
              }}
              hint="From this company's price book."
            />
            {/*
              The two minimum-fee scopes carry no figure of their own in the book, so picking one
              changes nothing here — the freight is computed from the agreed minimum on the Cost step.
              Saying so is the difference between "the select is broken" and "the number is over there".
            */}
            {minimumHeld && (
              <p className="text-sq-micro text-sq-ink-muted">
                Freight for this scope is the minimum agreed with your{' '}
                {freightScope(site.deliveryScope) === 'carrier' ? 'nominated carrier' : 'distributor'}. It is
                set on the Cost step.
              </p>
            )}
          </>
        ) : (
          <Field
            id="site-deliveryScope"
            label="Delivery scope"
            hint="What is included — for example “delivered to site, customer unloads”."
            value={site.deliveryScope}
            onChange={(event) => setSite({ deliveryScope: event.target.value })}
          />
        )}

        {/*
          A checkbox with an explicit acknowledgement, because delivery terms are where a shed
          dispute starts. This is the desktop's own "I understand" tick, kept.
        */}
        <label className="flex min-h-11 cursor-pointer items-start gap-sq-2">
          <input
            id="site-deliveryAcknowledged"
            type="checkbox"
            checked={site.deliveryAcknowledged}
            onChange={(event) => setSite({ deliveryAcknowledged: event.target.checked })}
            aria-invalid={errorAt('site-deliveryAcknowledged') !== undefined || undefined}
            aria-describedby={
              errorAt('site-deliveryAcknowledged') !== undefined
                ? 'site-deliveryAcknowledged-error'
                : undefined
            }
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-sq-brand)]"
          />
          <span className="text-sq-body text-sq-ink">
            I have read the delivery terms shown to the customer.
            {errorAt('site-deliveryAcknowledged') !== undefined && (
              <span
                id="site-deliveryAcknowledged-error"
                className="mt-1 block text-sq-micro text-sq-danger"
              >
                {errorAt('site-deliveryAcknowledged')}
              </span>
            )}
          </span>
        </label>
      </Group>

      {/* The site check: the addresses above are what it pins, the Design group below reads it back. */}
      {siteCheck}

      <DesignGroup issuesByPath={issuesByPath} catalogue={catalogue} />
      <ShedGroup
        issuesByPath={issuesByPath}
        unit={unit}
        onUnitChange={onUnitChange}
        catalogue={catalogue}
        kneeBrace={kneeBrace}
      />
      <ColourGroup issuesByPath={issuesByPath} />
    </div>
  );
}

/* ------------------------------------------------------------------ Design */

/**
 * The structures the domain models, with the words a customer reads.
 *
 * ## Four of these values used to be rejected by the schema
 *
 * `carports`, `tophot`, `zed` and `hangar` are not members of `StructureType`, so choosing one went
 * through `applyPartial`, hit `structureTypeSchema.catch(DEFAULT_SHED.structureType)`, and came back
 * as **`gable`** — measured 2026-11-11 with a probe. The dropdown offered seven structures and
 * silently delivered two families, which is the same shape of defect as the importance level that
 * became 1: a select where the value shown is not the value stored.
 *
 * The list is now keyed to the union, with `satisfies` so a member added to `StructureType` without
 * a label here is a compile error rather than a missing option.
 */
const STRUCTURE_TYPES: readonly { value: StructureType; label: string }[] = [
  { value: 'gable', label: 'Gable' },
  { value: 'skillion', label: 'Skillion' },
  { value: 'gable_carport', label: 'Gable carport' },
  { value: 'skillion_carport', label: 'Skillion carport' },
  { value: 'tophot_64', label: 'TopHat (64 mm)' },
  { value: 'tophot_96', label: 'TopHat (96 mm)' },
  { value: 'zed_shed', label: 'Zed shed' },
  { value: 'aircraft_hangar', label: 'Aircraft hangar' },
  { value: 'cyclonic', label: 'Cyclonic' },
  { value: 'custom_gable', label: 'Custom gable (non-standard)' },
  { value: 'custom_skillion', label: 'Custom skillion (non-standard)' },
] as const satisfies readonly { value: StructureType; label: string }[];

const WIND_REGIONS: { value: string; label: string }[] = [
  { value: 'A', label: 'A — northern' },
  { value: 'B', label: 'B — southern' },
  { value: 'C', label: 'C — coastal, cyclonic' },
  { value: 'D', label: 'D — severe cyclonic' },
];

const TERRAIN: { value: string; label: string }[] = [
  { value: '2', label: '2 — open country' },
  { value: '2.5', label: '2.5 — scattered obstructions' },
  { value: '3', label: '3 — suburban' },
];

const STATES: string[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

/**
 * BCA importance levels, all four, with the meaning a person is choosing between.
 *
 * Not read from the price book on purpose. The book lists only the levels it has frame tables for
 * (today 1 and 2), but the **certificate** may say 3 or 4 — and an importance level that quietly
 * becomes 1 is the defect this list exists to prevent. The book's own list is used separately, to
 * say when it cannot price the level that was chosen.
 */
const IMPORTANCE: { value: string; label: string }[] = [
  { value: '1', label: '1 — normal' },
  { value: '2', label: '2 — high consequence' },
  { value: '3', label: '3 — substantial' },
  { value: '4', label: '4 — exceptional' },
];

function DesignGroup({
  issuesByPath,
  catalogue,
}: {
  issuesByPath: Map<string, DraftIssue>;
  catalogue: Catalogue | null;
}) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;

  /**
   * The six certified values, read from the **same** check the ShedSafe panel pins and imports.
   *
   * `useSiteCheck` rather than a second `GET`: two fetches on one screen would let the panel say
   * "Rating imported" while these fields still showed the values from before the import.
   */
  const { check, state: siteState } = useSiteCheck();

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
  const toggleGable = (end: 'front' | 'back'): void => {
    const next = hasGable(end)
      ? options.filter((option) => !(option.kind === 'gable_infill' && option.end === end))
      : [
          ...options,
          ...defaultOptionsFor('gable_infill', config).filter(
            (option) => option.kind === 'gable_infill' && option.end === end,
          ),
        ];
    applyPartial({ options: next });
  };

  const cantileverFor = (wall: 'front' | 'back') =>
    options.find((option) => option.kind === 'cantilever' && option.wall === wall);
  const setCantilever = (wall: 'front' | 'back', length: number): void => {
    const existing = cantileverFor(wall);
    let next;
    if (length <= 0) {
      next = options.filter((option) => !(option.kind === 'cantilever' && option.wall === wall));
    } else if (existing !== undefined) {
      next = options.map((option) => (option === existing ? { ...option, length } : option));
    } else {
      const base = defaultOptionsFor('cantilever', config).find(
        (option) => option.kind === 'cantilever',
      );
      if (base === undefined || base.kind !== 'cantilever') return;
      next = [...options, { ...base, wall, length }];
    }
    applyPartial({ options: next });
  };

  return (
    <Group
      title="Design"
      issueCount={
        // Wind region is no longer among these: it is read-only now, so an issue there would be a red
        // mark on a field nobody can fix. See `validation.ts` §5.
        ['design-stateCode', 'design-cantilever'].filter((path) => issuesByPath.has(path)).length
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
      <fieldset className="flex flex-col gap-sq-2 rounded-md border border-sq-line p-sq-2">
        <legend className="px-1 text-sq-micro font-medium text-sq-ink">
          From the site check{siteState === 'certified' ? '' : ' — not yet a rating'}
        </legend>

        <div className="grid grid-cols-2 gap-sq-2">
          <DesignValue
            id="design-importanceLevel"
            label="Importance level"
            entry={siteValue('importanceLevel')}
          />
          <DesignValue id="design-windRegion" label="Wind region" entry={siteValue('windRegion')} />
          <DesignValue id="design-terrainCategory" label="Terrain category" entry={siteValue('terrainCategory')} />
          <DesignValue id="design-buildingClass" label="Building class" entry={siteValue('buildingClass')} />
          <DesignValue id="design-snowLoad" label="Ground snow load" entry={siteValue('snowLoad')} />
          <DesignValue id="design-windSpeed" label="Design wind speed" entry={siteValue('designWindSpeed')} />
        </div>


        {/*
          The book's own warning, kept where the level is read: it has no frame table above level 2, so
          the frame falls back to one assumed section. The value itself still comes from the
          certificate — see KNOWN-DEVIATIONS 31.
        */}
        {bookCannotPrice && (
          <p className="text-sq-micro text-sq-attention">
            This price book has no frame table for importance level {config.importanceLevel}. The frame
            will be priced from one assumed section — the certificate is what matters, so keep the
            level it states and read the assumption on the BOM.
          </p>
        )}

        {siteState === 'unchecked' && (
          <p className="text-sq-micro text-sq-ink-muted">
            Run the site check above to fill these in. Until then the quote is priced from this state’s
            defaults, and the document says so.
          </p>
        )}
      </fieldset>

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
          className="sq-numeric min-h-[38px] rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
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
                <input
                  id={`design-cantilever-${wall}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={3000}
                  step={100}
                  aria-invalid={errorAt('design-cantilever') !== undefined || undefined}
                  aria-describedby={
                    errorAt('design-cantilever') !== undefined ? 'design-cantilever-error' : undefined
                  }
                  value={length}
                  onChange={(event) => setCantilever(wall, Number(event.target.value))}
                  className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
                />
              </label>
            );
          })}
        </div>
        <p className="text-sq-micro text-sq-ink-muted">
          0 removes the cantilever. A standard building is limited to 1400 mm; a custom structure can
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

/* -------------------------------------------------------------------- Shed */

function ShedGroup({
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
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;
  /*
   * The same check the Design group reads, from the same provider.
   *
   * The awnings live here now (the desktop's own position), and they are certified values: reading
   * them from a second fetch would let this group show a width the Design group does not.
   */
  const { check } = useSiteCheck();

  /*
   * The bays this building actually has, which is an array once somebody edits one.
   *
   * `perBay` is shown beside the bay count, and it used to be a division. On an edited building that
   * number describes no bay in the shed — the panel lists the real ones below.
   */
  const bayWidths = bayWidthsFor(config);
  const perBay = bayWidths.reduce((sum, width) => sum + width, 0) / Math.max(1, bayWidths.length);
  const unevenBays = new Set(bayWidths).size > 1;
  const [baysOpen, setBaysOpen] = useState(false);

  /*
   * The heights a person has to state on a council application and a delivery quote.
   *
   * Computed from the same three inputs the drawing uses, by a pure function in core so the number is
   * testable without a browser. `null` means the roof cannot be described yet — a zero pitch is a flat
   * roof, and reporting the wall height as an "average" would be a number nobody measured.
   */
  const averageHeight = averageHeightMm(config);
  const ridgeHeight = ridgeHeightMm(config);

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

  /*
   * The bounds the price book states, which replace hard-coded constants.
   *
   * The editor bounded span at 2 000–30 000 mm and height at 2 000–12 000 — numbers with no source.
   * The book's rows cap span at **15 000**, so a 24 000 mm span was accepted here and then had no
   * frame row to price from, surfacing two steps later as a BOM assumption. Its numbers are the valid
   * range; a building outside them is one this book cannot price.
   *
   * The fallbacks are the old constants, used only for a book that states no bounds. `||` rather than
   * `??` on purpose: a `0` from the book means "not stated", and a `min` of 0 would make every field
   * report "below the minimum".
   */
  const spanBounds = {
    min: catalogue?.dimensions.span.min || 1800,
    max: catalogue?.dimensions.span.max || 15000,
  };
  const heightBounds = {
    min: catalogue?.dimensions.height.min || 2200,
    max: catalogue?.dimensions.height.max || 6000,
  };

  /*
   * The roof pitches the book sells **for this span**.
   *
   * The desktop rebuilds this list on every span change (`GetHintListRoofPitch`), and while the
   * reference book offers the same six angles at every span, the table is organised into span bands —
   * so the query is about the book's shape rather than about today's numbers.
   *
   * The bounds widen the slider, they do not narrow it: a pitch between two listed angles is a roof an
   * operator may legitimately quote (the desktop's dropdown is editable), so the field says the book
   * does not list it instead of snapping the roof to something the customer did not agree to.
   */
  const pitchGroups = catalogue?.roofPitchGroups ?? [];
  const pitchHints = roofPitchHintsForSpan(pitchGroups, config.span);
  const pitchBounds = roofPitchBoundsForSpan(pitchGroups, config.span);
  const pitchUnlisted = pitchOutsideBookSpan(pitchGroups, config.span, config.roofPitchDeg);

  /**
   * Apply a dimension change, asking first when it invalidates placed options.
   *
   * The desktop wiped options on a span/height/pitch/bay change and asked first. Doing
   * it silently would delete work; never doing it would leave a door on a wall that no
   * longer exists. The confirm is that middle ground, and it only appears when there is
   * something to lose.
   */
  const applyDimension = (patch: Partial<ShedConfig>): void => {
    const next = { ...config, ...patch };
    const wipes = shouldWipeOptions(config, next);
    if (
      wipes &&
      !window.confirm(
        'Changing this size removes every option placed on the building. Continue?',
      )
    ) {
      return;
    }
    applyPartial(wipes ? { ...patch, options: [] } : patch);
  };

  /**
   * Apply a reconciled bay triple, so the three fields can never disagree.
   *
   * Changing any of the three **discards a per-bay array**, which is what the desktop does too: editing
   * the length or the count resets the array from the new nominal spacing
   * (`ResetBayUnitsToNomBay`), because an array for a different building is not a set of bays. The
   * array comes back the moment somebody edits one bay in the panel below.
   */
  const applyBays = (input: { length: number; bays: number; nomBaySpacing: number }): void => {
    const next = reconcileBays(input);
    applyDimension({
      length: next.length,
      bays: next.bays,
      nomBaySpacing: next.nomBaySpacing,
      bayWidths: undefined,
    });
  };

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
  const applyBayWidths = (widths: number[]): void => {
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
    applyDimension({ bayWidths: differs ? rounded : undefined, length: total });
  };

  const wallProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isWall);
  const roofProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isRoof);
  const downpipeMaterials = catalogue?.downpipeMaterials ?? [];

  return (
    <Group
      title="Shed"
      issueCount={
        ['shed-span', 'shed-length', 'shed-height', 'shed-bays', 'shed-roofPitchDeg'].filter((path) =>
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
            className="min-h-9 self-start cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
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
                'min-h-9 cursor-pointer px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast',
                unit === option ? 'bg-sq-brand text-white' : 'bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
              ].join(' ')}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-sq-2">
        <DimensionField
          id="shed-span"
          label="Span (width)"
          valueMm={config.span}
          unit={unit}
          minMm={spanBounds.min}
          maxMm={spanBounds.max}
          required
          hint={
            outsideBookBounds(config.span, spanBounds) === null
              ? 'Clear width, inside the columns.'
              : outOfBookMessage('Span', config.span, spanBounds)
          }
          error={errorAt('shed-span')}
          onCommit={(mm) => applyDimension({ span: mm })}
        />
        <DimensionField
          id="shed-height"
          label="Wall height"
          valueMm={config.height}
          unit={unit}
          minMm={heightBounds.min}
          maxMm={heightBounds.max}
          required
          hint={
            outsideBookBounds(config.height, heightBounds) === null
              ? undefined
              : outOfBookMessage('Wall height', config.height, heightBounds)
          }
          error={errorAt('shed-height')}
          onCommit={(mm) => applyDimension({ height: mm })}
        />
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
                      const base = defaultOptionsFor('awning', config).find(
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
                    className="mt-sq-1 min-h-9 cursor-pointer self-start rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
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
          className="sq-numeric min-h-[38px] rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
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
        <DimensionField
          id="shed-length"
          label="Overall length"
          valueMm={config.length}
          unit={unit}
          minMm={2000}
          maxMm={120000}
          required
          error={errorAt('shed-length')}
          onCommit={(mm) => applyBays({ length: mm, bays: config.bays, nomBaySpacing: 0 })}
        />
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">
            Bays
            <span className="ml-1 text-sq-danger" aria-hidden="true">
              *
            </span>
          </span>
          <input
            id="shed-bays"
            type="number"
            inputMode="numeric"
            min={2}
            max={30}
            step={1}
            value={config.bays}
            aria-invalid={errorAt('shed-bays') !== undefined || undefined}
            aria-describedby={errorAt('shed-bays') !== undefined ? 'shed-bays-error' : 'shed-bays-hint'}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                applyBays({ length: config.length, bays: next, nomBaySpacing: 0 });
              }
            }}
            className={[
              'min-h-[38px] rounded-md border bg-sq-surface px-sq-2 py-sq-1 text-sq-body outline-none',
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
        </label>
      </div>

      <label className="flex flex-col gap-sq-1">
        <span className="text-sq-micro font-medium text-sq-ink">Nominal bay spacing</span>
        <span className="flex items-center gap-sq-2">
          <input
            id="shed-nomBaySpacing"
            type="number"
            inputMode="numeric"
            min={1000}
            max={20000}
            step={100}
            value={config.nomBaySpacing}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                applyBays({ length: config.length, bays: config.bays, nomBaySpacing: next });
              }
            }}
            className="min-h-[38px] w-32 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
          />
          <span className="text-sq-micro text-sq-ink-muted">
            mm — changing this sets the overall length
          </span>
        </span>
      </label>

      {/*
        Adjust bay spacing — the desktop's `UcAdjustBaySize` flyout, inline.

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
      <div className="flex flex-col gap-sq-2 rounded-md border border-sq-line p-sq-2">
        <div className="flex items-center justify-between gap-sq-2">
          <div className="flex flex-col">
            <span className="text-sq-micro font-medium text-sq-ink">Bay spacing</span>
            <span className="sq-numeric text-sq-micro text-sq-ink-muted">
              {config.length.toLocaleString('en-AU')} mm overall · {config.bays} bays
              {unevenBays ? ' · uneven' : ''}
            </span>
          </div>
          <button
            type="button"
            aria-expanded={baysOpen}
            aria-controls="shed-bayWidths"
            onClick={() => setBaysOpen((open) => !open)}
            className="min-h-9 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            {baysOpen ? 'Hide bays' : 'Adjust bay spacing'}
          </button>
        </div>
        {baysOpen && (
          <div id="shed-bayWidths" className="grid grid-cols-2 gap-sq-2">
            {bayWidths.map((width, index) => (
              <label key={index} className="flex flex-col gap-sq-1">
                <span className="text-sq-micro text-sq-ink">
                  Bay {String(index + 1).padStart(2, '0')} (mm)
                </span>
                <input
                  id={`shed-bayWidth-${index}`}
                  type="number"
                  inputMode="numeric"
                  min={1000}
                  max={20000}
                  step={100}
                  value={width}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next) || next <= 0) return;
                    const widths = [...bayWidths];
                    widths[index] = next;
                    applyBayWidths(widths);
                  }}
                  aria-label={`Bay ${index + 1} length in millimetres`}
                  className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
                />
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
                onClick={() => applyBays({ length: config.length, bays: config.bays, nomBaySpacing: 0 })}
                className="col-span-2 min-h-9 self-start cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
              >
                Divide equally again
              </button>
            )}
          </div>
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

      <label className="flex flex-col gap-sq-1">
        <span className="text-sq-micro font-medium text-sq-ink">Roof pitch</span>
        {/*
          The track is 8 px and the thumb is whatever the platform draws — too small to grab with a
          thumb, and `range` is the one control where that matters on a phone. `py-sq-2` grows the
          touchable box to 44 px without changing the drawn track; `accent-*` keeps the brand colour.
          Measured before: the whole input was 8 px tall.
        */}
        <span className="flex min-h-11 items-center gap-sq-2">
          <input
            id="shed-roofPitchDeg"
            type="range"
            /*
             * The book's own range for this span, widened by the caller's 0–45 slider when the book
             * states none. `pitchBounds` comes from the span band the row covers, so a book whose bands
             * differ limits the slider to what it can actually price.
             */
            min={pitchBounds?.min ?? 0}
            max={pitchBounds?.max ?? 45}
            step={0.5}
            list={pitchHints.length > 0 ? 'shed-roofPitchDeg-hints' : undefined}
            value={config.roofPitchDeg}
            aria-describedby="shed-roofPitchDeg-value"
            onChange={(event) =>
              applyDimension({ roofPitchDeg: Number(event.target.value) })
            }
            className="min-h-11 flex-1 cursor-pointer py-sq-2 accent-[var(--color-sq-brand)]"
          />
          <output
            id="shed-roofPitchDeg-value"
            htmlFor="shed-roofPitchDeg"
            className="sq-numeric w-14 text-right text-sq-body tabular-nums"
          >
            {config.roofPitchDeg.toFixed(1)}°
          </output>
        </span>
        {pitchHints.length > 0 && (
          // The angles the book lists for this span, as tick marks on the slider.
          <datalist id="shed-roofPitchDeg-hints">
            {pitchHints.map((hint) => (
              <option key={hint} value={hint} />
            ))}
          </datalist>
        )}
        {pitchUnlisted ? (
          <span className="text-sq-micro text-sq-attention">
            {config.roofPitchDeg}° is between the pitches this book lists for a{' '}
            {(config.span / 1000).toFixed(1)} m span ({pitchHints.join(', ')}°). It prices as an
            assumption.
          </span>
        ) : pitchHints.length > 0 ? (
          <span className="text-sq-micro text-sq-ink-muted">
            The book sells {pitchHints.join(', ')}° at this span.
          </span>
        ) : null}
        {errorAt('shed-roofPitchDeg') !== undefined && (
          <span className="text-sq-micro text-sq-danger">{errorAt('shed-roofPitchDeg')}</span>
        )}
      </label>

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

/* ---------------------------------------------------------------- Colours */

/**
 * What each colour role is called in the trade, so the label is not a code name.
 *
 * Keyed by `keyof ShedColors`: adding a role to the domain is a compile error here,
 * not a role that silently has no swatch grid.
 */
const COLOUR_LABELS: Record<keyof ShedColors, string> = {
  wall: 'Wall',
  roof: 'Roof',
  barge: 'Barge and fascia',
  downpipe: 'Downpipe',
  gutter: 'Gutter',
  window: 'Window',
  paDoor: 'PA door',
  rollerDoor: 'Roller door',
  slidingDoor: 'Sliding door',
  dividingWall: 'Dividing wall',
};

function ColourGroup({ issuesByPath }: { issuesByPath: Map<string, DraftIssue> }) {
  const config = useShedStoreConfig();
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
          className="min-h-9 self-start cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
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
            <fieldset key={key} className="flex flex-col gap-sq-1">
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
                  {issuesByPath.get(`colours-${key}`)?.message}
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
                const base = defaultOptionsFor('horizontal_cladding', config).find(
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

/* ------------------------------------------------------------------ Shared */

/**
 * Snap a thickness to one the chosen profile is sold in.
 *
 * A profile is not sold in every thickness: on the reference book `Lo-Rib` has 0.35 and 0.42 but no
 * 0.48. Asking the book for a pair it does not carry returns no row, and the whole sheeting group
 * becomes one mocked line — the failure mode is silent, so the snap happens at the moment of choosing
 * rather than being detected later.
 *
 * The nearest stocked thickness wins, and a tie goes to the thicker sheet: an under-specified roof is
 * the failure that cannot be built.
 */
function snapBmt(
  profiles: readonly { profile: string; bmtValues: number[] }[],
  profile: string,
  wanted: number | undefined,
): number {
  const values = profiles.find((entry) => entry.profile === profile)?.bmtValues ?? [];
  if (values.length === 0) return wanted ?? 0.42;
  if (wanted !== undefined && values.includes(wanted)) return wanted;
  const target = wanted ?? 0.42;
  let best = values[0]!;
  let bestDistance = Math.abs(target - best);
  for (const value of values) {
    const distance = Math.abs(target - value);
    if (distance < bestDistance || (distance === bestDistance && value > best)) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/** The thickness options a profile offers, as `value`/`label` pairs. */
function bmtOptions(
  profiles: readonly { profile: string; bmtValues: number[] }[],
  profile: string,
): { value: string; label: string }[] {
  const values = profiles.find((entry) => entry.profile === profile)?.bmtValues ?? [];
  return values.map((bmt) => ({ value: String(bmt), label: `${bmt} BMT` }));
}

/**
 * The sentence for a value the price book cannot price.
 *
 * It names the book's range rather than saying "invalid", because the useful fact is **which** range
 * this company's book covers — a dealer who sees "1 800–15 000 mm" learns something; one who sees
 * "invalid" learns to guess.
 */
function outOfBookMessage(label: string, value: number, bounds: { min: number; max: number }): string {
  const where = outsideBookBounds(value, bounds);
  const range = `${bounds.min.toLocaleString('en-AU')}–${bounds.max.toLocaleString('en-AU')} mm`;
  return where === 'below'
    ? `${label} of ${value.toLocaleString('en-AU')} mm is below what this price book covers (${range}). The frame will be priced from an assumed section.`
    : `${label} of ${value.toLocaleString('en-AU')} mm is above what this price book covers (${range}). The frame will be priced from an assumed section.`;
}

/**
 * One read-only value that came from a site check.
 *
 * ## Why a component and not six copies of a `<div>`
 *
 * The three states have to be decided **once**. Six hand-written rows is six chances for one of them
 * to print a provisional reading in the same colour as a certified one — and a number in the normal
 * ink colour is a number somebody quotes from.
 *
 * `aria-describedby` points at the state sentence, so the distinction reaches a screen reader too,
 * where colour and a small grey word do not exist.
 */
function DesignValue({
  id,
  label,
  entry,
}: {
  id: string;
  label: string;
  entry: { text: string; state: 'certified' | 'provisional' | 'unchecked' };
}) {
  const note =
    entry.state === 'certified'
      ? 'from the site check'
      : entry.state === 'provisional'
        ? 'provisional — not auto calculated'
        : 'not from a site check yet';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sq-micro font-medium text-sq-ink">{label}</span>
      <output
        id={id}
        aria-describedby={`${id}-source`}
        className={[
          'sq-numeric min-h-[38px] rounded-md border px-sq-2 py-sq-1 text-sq-body',
          entry.state === 'unchecked'
            ? 'border-dashed border-sq-line bg-sq-ground/40 text-sq-ink-muted'
            : entry.state === 'provisional'
              ? 'border-sq-attention/40 bg-sq-attention/5 text-sq-ink'
              : 'border-sq-line bg-sq-ground/40 text-sq-ink',
        ].join(' ')}
      >
        {entry.text}
      </output>
      <span
        id={`${id}-source`}
        className={[
          'text-sq-micro',
          entry.state === 'provisional' ? 'text-sq-attention' : 'text-sq-ink-muted',
        ].join(' ')}
      >
        {note}
      </span>
    </div>
  );
}

/** A labelled checkbox, sized to the same touch target as the other controls. */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-sq-2 text-sq-body text-sq-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[var(--color-sq-brand)]"
      />
      {label}
    </label>
  );
}

/** A labelled select, with the error plumbing the other fields have. */
function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  hint,
  error,
  required,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  const invalid = error !== undefined;
  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
        {required === true && (
          <span className="ml-1 text-sq-danger" aria-hidden="true">
            *
          </span>
        )}
        {required === true && <span className="sr-only"> (required)</span>}
      </label>
      <select
        id={id}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined}
        aria-required={required === true || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={[
          'min-h-[38px] cursor-pointer rounded-md border bg-sq-surface px-sq-2 text-sq-body outline-none',
          invalid ? 'border-sq-danger' : 'border-sq-line',
        ].join(' ')}
      >
        {/*
          A stored value the list does not offer gets its own entry.
          
          Two ways that happens: a building converted from a legacy `.sqd`, whose sheeting is
          `0.35 TL-5` where this book lists `TL-5`; and a book revision that dropped a code an old
          quote still stores. Without this the browser selects the first option, so the screen shows
          a profile the quote does not have — and the `.vqu` export, which writes the stored string,
          disagrees with what the operator read here.
        */}
        {value !== '' && !options.some((option) => option.value === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {invalid ? (
        <p id={`${id}-error`} className="text-sq-micro text-sq-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${id}-hint`} className="text-sq-micro text-sq-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The building, from the geometry store. */
function useShedStoreConfig() {
  return useShedStore((state) => state.config);
}

/** Applying a partial change to the building. */
function useApplyBuilding() {
  return useShedStore((state) => state.applyPartial);
}

