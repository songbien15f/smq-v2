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
import { defaultOptionsFor } from '@sq/core/domain';
import { reconcileBays, shouldWipeOptions } from '@sq/core/domain';
import type { Catalogue } from '@sq/core/pricing';
import { deliveryForScope, freightScope } from '@sq/core/domain';
import type { DisplayUnit, ShedColors, ShedConfig } from '@sq/core/domain';
import { Field, StatusPill } from '@sq/ui';
import { AddressField } from './AddressField';
import { DimensionField } from './DimensionField';
import type { DraftIssue } from './validation';
import { useDraftStore } from '@/store/useDraftStore';
import { useShedStore } from '@/store/useShedStore';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useCompanyPricing } from '@/hooks/useCompanyPricing';

/** A group that can be collapsed, remembering nothing between visits on purpose. */
function Group({
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
}

export function QuoteDetailsPanel({ issuesByPath, unit, onUnitChange }: QuoteDetailsPanelProps) {
  const customer = useDraftStore((state) => state.customer);
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
                setSite({ deliveryScope: value });
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

      <DesignGroup issuesByPath={issuesByPath} />
      <ShedGroup
        issuesByPath={issuesByPath}
        unit={unit}
        onUnitChange={onUnitChange}
        catalogue={catalogue}
      />
      <ColourGroup issuesByPath={issuesByPath} />
    </div>
  );
}

/* ------------------------------------------------------------------ Design */

const STRUCTURE_TYPES: { value: string; label: string }[] = [
  { value: 'gable', label: 'Gable' },
  { value: 'skillion', label: 'Skillion' },
  { value: 'carports', label: 'Carport' },
  { value: 'tophot', label: 'TopHat' },
  { value: 'zed', label: 'Zed shed' },
  { value: 'hangar', label: 'Aircraft hangar' },
  { value: 'cyclonic', label: 'Cyclonic' },
];

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

const IMPORTANCE: { value: string; label: string }[] = [
  { value: '1', label: '1 — normal' },
  { value: '2', label: '2 — high consequence' },
];

function DesignGroup({ issuesByPath }: { issuesByPath: Map<string, DraftIssue> }) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;

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
        ['design-windRegion', 'design-stateCode'].filter((path) => issuesByPath.has(path)).length
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
          applyPartial({ structureType: value as never });
        }}
        hint="Changing this resets the building’s geometry and any openings."
      />

      <div className="grid grid-cols-2 gap-sq-2">
        <SelectField
          id="design-windRegion"
          label="Wind region"
          value={config.windRegion}
          options={WIND_REGIONS}
          required
          error={errorAt('design-windRegion')}
          onChange={(value) => applyPartial({ windRegion: value as never })}
          hint="Selects the purlin span table."
        />
        <SelectField
          id="design-terrainCategory"
          label="Terrain category"
          value={String(config.terrainCategory)}
          options={TERRAIN}
          onChange={(value) => applyPartial({ terrainCategory: Number(value) as never })}
        />
      </div>

      <div className="grid grid-cols-2 gap-sq-2">
        <SelectField
          id="design-importanceLevel"
          label="Importance level"
          value={String(config.importanceLevel)}
          options={IMPORTANCE}
          onChange={(value) => applyPartial({ importanceLevel: Number(value) as never })}
        />
        <SelectField
          id="design-stateCode"
          label="State"
          value={config.stateCode}
          options={STATES.map((state) => ({ value: state, label: state }))}
          required
          error={errorAt('design-stateCode')}
          onChange={(value) => applyPartial({ stateCode: value as never })}
          hint="Selects this state’s prices."
        />
      </div>

      <SelectField
        id="design-internalPressure"
        label="Internal pressure"
        value={config.internalPressure}
        options={[
          { value: 'closed', label: 'Closed — walls on all sides' },
          { value: 'open', label: 'Open — one side open to the weather' },
        ]}
        onChange={(value) => applyPartial({ internalPressure: value as never })}
        hint="A closed building pushes on the frame from inside as well as outside."
      />

      {/*
        The certified values the site check returned. Read-only here because they are
        not a design choice: ShedSafe computed them, and typing over one would produce
        a quote priced against a rating the certificate does not carry.
      */}
      <dl className="grid grid-cols-3 gap-sq-2 rounded-md border border-sq-line bg-sq-ground/40 p-sq-2">
        {[
          ['Building class', config.buildingClass ?? '—'],
          ['Ground snow', config.snowLoad === null ? '—' : `${config.snowLoad} kPa`],
          ['Wind speed', config.designWindSpeed === null ? '—' : `${config.designWindSpeed} m/s`],
        ].map(([label, shown]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-sq-micro text-sq-ink-muted">{label}</dt>
            <dd className="sq-numeric text-sq-body text-sq-ink">{shown}</dd>
          </div>
        ))}
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
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={3000}
                  step={100}
                  value={length}
                  onChange={(event) => setCantilever(wall, Number(event.target.value))}
                  className="min-h-[38px] rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body outline-none"
                />
              </label>
            );
          })}
        </div>
        <p className="text-sq-micro text-sq-ink-muted">
          0 removes the cantilever. Over 1400 mm is flagged on a standard building.
        </p>
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
}: {
  issuesByPath: Map<string, DraftIssue>;
  unit: DisplayUnit;
  onUnitChange: (unit: DisplayUnit) => void;
  catalogue: Catalogue | null;
}) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;

  const perBay = config.bays > 0 ? config.length / config.bays : 0;

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

  /** Apply a reconciled bay triple, so the three fields can never disagree. */
  const applyBays = (input: { length: number; bays: number; nomBaySpacing: number }): void => {
    const next = reconcileBays(input);
    applyDimension({ length: next.length, bays: next.bays, nomBaySpacing: next.nomBaySpacing });
  };

  const wallProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isWall);
  const roofProfiles = (catalogue?.profiles ?? []).filter((profile) => profile.isRoof);

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
          minMm={2000}
          maxMm={30000}
          required
          hint="Clear width, inside the columns."
          error={errorAt('shed-span')}
          onCommit={(mm) => applyDimension({ span: mm })}
        />
        <DimensionField
          id="shed-height"
          label="Wall height"
          valueMm={config.height}
          unit={unit}
          minMm={2000}
          maxMm={12000}
          required
          error={errorAt('shed-height')}
          onCommit={(mm) => applyDimension({ height: mm })}
        />
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
              {perBay === 0 ? '—' : `${Math.round(perBay)} mm per bay`}
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

      <div className="grid grid-cols-2 gap-sq-2">
        {wallProfiles.length > 0 && (
          <SelectField
            id="shed-wallProfile"
            label="Wall profile"
            value={config.wallProfile}
            options={wallProfiles.map((profile) => ({ value: profile.profile, label: profile.profile }))}
            onChange={(value) => applyPartial({ wallProfile: value })}
          />
        )}
        {roofProfiles.length > 0 && (
          <SelectField
            id="shed-roofProfile"
            label="Roof profile"
            value={config.roofProfile}
            options={roofProfiles.map((profile) => ({ value: profile.profile, label: profile.profile }))}
            onChange={(value) => applyPartial({ roofProfile: value })}
          />
        )}
      </div>

      <Field
        id="shed-downpipeType"
        label="Downpipe type"
        value={config.downpipeType}
        onChange={(event) => applyPartial({ downpipeType: event.target.value })}
      />

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
            min={0}
            max={45}
            step={0.5}
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
        {errorAt('shed-roofPitchDeg') !== undefined && (
          <span className="text-sq-micro text-sq-danger">{errorAt('shed-roofPitchDeg')}</span>
        )}
      </label>
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
  const entries = Object.entries(COLORBOND) as [string, string][];
  /**
   * Which role's palette is open, or `null` for none.
   *
   * One at a time: walls and roof are two decisions, and ten open palettes is what made this block
   * 1 992 px tall. Kept in the component rather than in `Group` so collapsing the whole Colours group
   * and reopening it starts from the summary rows again.
   */
  const [paletteOpen, setPaletteOpen] = useState<keyof ShedColors | null>(null);

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
                  {entries.map(([colourName, colourHex]) => {
                    const selected = hex.toLowerCase() === colourHex.toLowerCase();
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
              {issuesByPath.has(`colours-${key}`) && (
                <p id={`colours-${key}-error`} className="text-sq-micro text-sq-danger">
                  {issuesByPath.get(`colours-${key}`)?.message}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
    </Group>
  );
}

/* ------------------------------------------------------------------ Shared */

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
  options: { value: string; label: string }[];
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

