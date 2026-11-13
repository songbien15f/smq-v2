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
import { useSiteCheckActions } from '../siteCheckActions';
import { SiteCheckPin, SiteCheckStatusLine } from './SiteCheckPin';
import { BuildingParamsPopover } from './BuildingParamsPopover';


export function SiteGroup({
  issuesByPath,
  placesConfigured,
  unit,
}: {
  issuesByPath: Map<string, DraftIssue>;
  placesConfigured: boolean;
  unit: DisplayUnit;
}) {
  const { configured } = useSiteCheckActions();
  const customer = useDraftStore((state) => state.customer);
  const site = useDraftStore((state) => state.site);
  const setSite = useDraftStore((state) => state.setSite);
  const errorAt = (path: string): string | undefined => issuesByPath.get(path)?.short;
  const countIn = (paths: string[]): number =>
    paths.filter((path) => issuesByPath.has(path)).length;

  return (
      <Group id="group-site" title="Site address" issueCount={countIn(['site-address'])}>
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
            className="min-h-11 shrink-0 cursor-pointer rounded-md border border-sq-line px-sq-2 text-sq-micro font-medium transition-colors duration-sq-fast hover:bg-sq-ground"
          >
            Copy from customer
          </button>
        </div>
        {/* PIN rides in the field's suffix slot so it stays level with the input under an error; the
            popover hangs from this wrapper. Without ShedSafe configured the field is unchanged. */}
        <div className="relative">
          <Field
            id="site-address"
            label="Site address"
            required
            value={site.address}
            onChange={(event) => setSite({ address: event.target.value })}
            error={errorAt('site-address')}
            suffix={configured ? <SiteCheckPin /> : undefined}
          />
          {configured && <BuildingParamsPopover unit={unit} />}
        </div>
        {configured && <SiteCheckStatusLine />}
        <div className="grid grid-cols-3 gap-sq-2">
          {/* Read-only for the same reason as the customer's: the picker fills them, and the state
              selects the price table. See the note on the customer block. */}
          <Field
            id="site-suburb"
            label="Suburb"
            value={site.suburb}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setSite({ suburb: event.target.value })}
            hint={placesConfigured ? 'From the address' : undefined}
          />
          <Field
            id="site-state"
            label="State"
            maxLength={3}
            value={site.state}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setSite({ state: event.target.value.toUpperCase() })}
            hint={placesConfigured ? 'Sets the prices' : undefined}
          />
          <Field
            id="site-postcode"
            label="Postcode"
            inputMode="numeric"
            maxLength={4}
            value={site.postcode}
            readOnly={placesConfigured}
            aria-readonly={placesConfigured ? 'true' : undefined}
            onChange={(event) => setSite({ postcode: event.target.value })}
            hint={placesConfigured ? 'From the address' : undefined}
          />
        </div>
      </Group>
  );
}
