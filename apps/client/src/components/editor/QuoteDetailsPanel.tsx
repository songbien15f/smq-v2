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
import { COLORBOND } from '@sq/core/domain';
import type { DisplayUnit } from '@sq/core/domain';
import { Field, StatusPill } from '@sq/ui';
import { AddressField } from './AddressField';
import { DimensionField } from './DimensionField';
import type { DraftIssue } from './validation';
import { useDraftStore } from '@/store/useDraftStore';
import { useShedStore } from '@/store/useShedStore';

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
        <Field
          id="site-deliveryAddress"
          label="Delivery address"
          hint="Leave blank to deliver to the site."
          value={site.deliveryAddress}
          onChange={(event) => setSite({ deliveryAddress: event.target.value })}
        />
        <Field
          id="site-deliveryScope"
          label="Delivery scope"
          hint="What is included — for example “delivered to site, customer unloads”."
          value={site.deliveryScope}
          onChange={(event) => setSite({ deliveryScope: event.target.value })}
        />

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
      <ShedGroup issuesByPath={issuesByPath} unit={unit} onUnitChange={onUnitChange} />
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
    </Group>
  );
}

/* -------------------------------------------------------------------- Shed */

function ShedGroup({
  issuesByPath,
  unit,
  onUnitChange,
}: {
  issuesByPath: Map<string, DraftIssue>;
  unit: DisplayUnit;
  onUnitChange: (unit: DisplayUnit) => void;
}) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.message;

  const perBay = config.bays > 0 ? config.length / config.bays : 0;

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
          onCommit={(mm) => applyPartial({ span: mm })}
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
          onCommit={(mm) => applyPartial({ height: mm })}
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
          onCommit={(mm) => applyPartial({ length: mm })}
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
              if (Number.isFinite(next)) applyPartial({ bays: next });
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
        <span className="text-sq-micro font-medium text-sq-ink">Roof pitch</span>
        <span className="flex min-h-[38px] items-center gap-sq-2">
          <input
            id="shed-roofPitchDeg"
            type="range"
            min={0}
            max={45}
            step={0.5}
            value={config.roofPitchDeg}
            aria-describedby="shed-roofPitchDeg-value"
            onChange={(event) => applyPartial({ roofPitchDeg: Number(event.target.value) })}
            className="h-2 flex-1 cursor-pointer accent-[var(--color-sq-brand)]"
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

/** What each colour role is called in the trade, so the label is not a code name. */
const COLOUR_ROLES: { key: string; label: string }[] = [
  { key: 'wall', label: 'Wall' },
  { key: 'roof', label: 'Roof' },
  { key: 'barge', label: 'Barge and fascia' },
  { key: 'downpipe', label: 'Downpipe' },
  { key: 'gutter', label: 'Gutter' },
  { key: 'window', label: 'Window' },
  { key: 'paDoor', label: 'PA door' },
  { key: 'rollerDoor', label: 'Roller door' },
  { key: 'slidingDoor', label: 'Sliding door' },
  { key: 'dividingWall', label: 'Dividing wall' },
];

function ColourGroup({ issuesByPath }: { issuesByPath: Map<string, DraftIssue> }) {
  const config = useShedStoreConfig();
  const applyPartial = useApplyBuilding();
  const entries = Object.entries(COLORBOND) as [string, string][];

  /** The Colorbond name for a hex, so the field can show the name rather than the code. */
  const nameOf = (hex: string): string =>
    entries.find(([, value]) => value.toLowerCase() === hex.toLowerCase())?.[0] ?? '';

  const setColour = (key: string, hex: string): void => {
    applyPartial({ colors: { ...config.colors, [key]: hex } as never });
  };

  return (
    <Group
      title="Colours"
      issueCount={COLOUR_ROLES.filter((role) => issuesByPath.has(`colours-${role.key}`)).length}
    >
      <div className="flex flex-col gap-sq-3">
        {COLOUR_ROLES.map((role) => {
          const hex = (config.colors as unknown as Record<string, string>)[role.key] ?? '';
          const name = nameOf(hex);
          return (
            <fieldset key={role.key} className="flex flex-col gap-sq-1">
              <legend className="flex w-full items-center justify-between text-sq-micro font-medium text-sq-ink">
                <span>{role.label}</span>
                <span className="sq-numeric text-sq-ink-muted">{name === '' ? hex : name}</span>
              </legend>
              {/*
                A radio group in a scrollable grid rather than a `<select>`.

                A colour is chosen by looking at it. A dropdown that shows 30 names and no colours
                makes the operator read, and it is the one field on this form where the swatch is
                the information.
              */}
              <div
                role="radiogroup"
                aria-label={`${role.label} colour`}
                aria-invalid={issuesByPath.has(`colours-${role.key}`) || undefined}
                aria-describedby={
                  issuesByPath.has(`colours-${role.key}`) ? `colours-${role.key}-error` : undefined
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
                      onClick={() => setColour(role.key, colourHex)}
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
              {issuesByPath.has(`colours-${role.key}`) && (
                <p id={`colours-${role.key}-error`} className="text-sq-micro text-sq-danger">
                  {issuesByPath.get(`colours-${role.key}`)?.message}
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

