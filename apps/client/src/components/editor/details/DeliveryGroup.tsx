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


export function DeliveryGroup({
  issuesByPath,
  catalogue,
}: {
  issuesByPath: Map<string, DraftIssue>;
  catalogue: Catalogue | null;
}) {
  const site = useDraftStore((state) => state.site);
  const setSite = useDraftStore((state) => state.setSite);
  const pricing = useDraftStore((state) => state.pricing);
  const setPricing = useDraftStore((state) => state.setPricing);
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

  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.short;
  const countIn = (paths: string[]): number =>
    paths.filter((path) => issuesByPath.has(path)).length;

  return (
      <Group
        id="group-delivery"
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
            className="min-h-11 shrink-0 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
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
  );
}
