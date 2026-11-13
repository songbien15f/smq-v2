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
import { CommitNumberInput } from '../CommitNumberInput';
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


export function CustomerGroup({
  issuesByPath,
  placesConfigured,
  setPlacesConfigured,
}: {
  issuesByPath: Map<string, DraftIssue>;
  /** Whether the address picker can fill the parts, which makes them read-only. */
  placesConfigured: boolean;
  setPlacesConfigured: (configured: boolean) => void;
}) {
  const customer = useDraftStore((state) => state.customer);
  const quoteNumber = useDraftStore((state) => state.quoteNumber);
  const setCustomer = useDraftStore((state) => state.setCustomer);
  const pricing = useDraftStore((state) => state.pricing);
  const setPricing = useDraftStore((state) => state.setPricing);
  /** The named tier the current figure matches, or `null` for a rate somebody typed. */
  const rateTier = rateTierFor(pricing.quoteRatePct);
  /** Why the last typed quote rate was refused. */
  const [rateRefusal, setRateRefusal] = useState<string | null>(null);
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.short;
  const countIn = (paths: string[]): number =>
    paths.filter((path) => issuesByPath.has(path)).length;

  return (
      <Group
        id="group-customer"
        title="Quote & client"
        issueCount={countIn(['customer-firstName', 'customer-lastName', 'customer-email', 'customer-address'])}
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
            className="sq-numeric min-h-11 rounded-md border border-sq-line bg-sq-ground/40 px-sq-2 py-sq-1 text-sq-body text-sq-ink"
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
        {/*
          Quote rate: the desktop's five **named tiers**, plus a free figure.

          ## Why a select that does not lock the number

          `MAllSetting.cs:27-58` lists `None` 0 %, `Diamond` 10, `Gold` 12, `Silver` 14, `Bronze` 16,
          and the desktop filled a dropdown from it. But the quote stores only `CustomerRateValue`
          (`CustomerData.cs:430`) — never the code — and the desktop's own model carries `IsCustom`
          for a rate somebody typed. So the tier is a **shortcut**, not an enum: choosing one writes
          its percentage, and any other figure can still be entered.

          A first version of this screen had the bare number box, which meant an operator had to
          remember that Gold is 12 %. The label below says which tier the current figure is, so a
          typed 12 reads as "Gold" without being forced back into the list.
        */}
        <label className="flex flex-col gap-sq-1">
          <span className="text-sq-micro font-medium text-sq-ink">Quote rate</span>
          <div className="flex items-center gap-sq-2">
            <select
              id="customer-quoteRateTier"
              value={rateTier?.code ?? 'custom'}
              onChange={(event) => {
                const tier = QUOTE_RATE_TIERS.find((entry: QuoteRateTier) => entry.code === event.target.value);
                if (tier !== undefined) setPricing({ quoteRatePct: tier.pct });
              }}
              aria-describedby="customer-quoteRatePct-hint"
              className="min-h-11 flex-1 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-sq-body"
            >
              {QUOTE_RATE_TIERS.map((tier: QuoteRateTier) => (
                <option key={tier.code} value={tier.code}>
                  {tier.label} — {tier.pct}%
                </option>
              ))}
              {/* Present only when the figure is not a tier, so the select can show what it is. */}
              {rateTier === null && <option value="custom">Custom — {pricing.quoteRatePct}%</option>}
            </select>
            <CommitNumberInput
              id="customer-quoteRatePct"
              kind="decimal"
              min={0}
              max={100}
              unit="%"
              value={pricing.quoteRatePct}
              onRefusal={setRateRefusal}
              onCommit={(next) => {
                setPricing({ quoteRatePct: next });
              }}
              aria-label="Quote rate percent"
              className="sq-numeric min-h-11 w-24 rounded-md border border-sq-line bg-sq-surface px-sq-2 text-right text-sq-body outline-none"
            />
          </div>
          <span id="customer-quoteRatePct-hint" className="text-sq-micro text-sq-ink-muted">
            An uplift on the whole job; 0 for none.{' '}
            {rateTier === null
              ? 'This figure is not one of the named tiers — it is used exactly as typed.'
              : `${rateTier.label} is the ${rateTier.pct}% tier.`}
          </span>
          {rateRefusal !== null && (
            <span role="alert" className="text-sq-micro text-sq-danger">
              {rateRefusal}
            </span>
          )}
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
          required
          error={errorAt('customer-address')}
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
          onConfiguredChange={setPlacesConfigured}
          hint={
            placesConfigured
              ? 'Start typing and pick the address — the suburb, state and postcode fill in.'
              : 'Type the full address, including the suburb, state and postcode.'
          }
        />
        {/*
          The three parts are **read-only**, filled by Places.

          `MQuoteDetailView.cs:246-320` sets `Enable = false` **and** `Visibility = Hidden` on
          `SuburbName`, `State` and `Postcode` for all three address blocks: they exist to be written
          by the address picker, never typed. Two facts make that right rather than fussy — the state
          selects the price table, so a typed "QLD " or "Queensland" is a pricing bug; and a suburb
          that disagrees with the street line is an address nobody can deliver to.

          `readOnly` rather than `disabled`, deliberately: a disabled input is skipped by assistive
          technology and cannot be selected or copied, and an operator checking what the picker
          resolved needs to read these. The value is still submitted either way.
        */}
        <div className="grid grid-cols-3 gap-sq-2">
          <Field
            id="customer-suburb"
            label="Suburb"
            autoComplete="address-level2"
            value={customer.suburb}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setCustomer({ suburb: event.target.value })}
            hint={placesConfigured ? 'From the address' : undefined}
          />
          <Field
            id="customer-state"
            label="State"
            autoComplete="address-level1"
            maxLength={3}
            value={customer.state}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setCustomer({ state: event.target.value.toUpperCase() })}
            hint={placesConfigured ? 'Sets the prices' : undefined}
          />
          <Field
            id="customer-postcode"
            label="Postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            value={customer.postcode}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setCustomer({ postcode: event.target.value })}
            hint={placesConfigured ? 'From the address' : undefined}
          />
        </div>
      </Group>
  );
}
