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

import { useState } from 'react';
import type { DisplayUnit } from '@sq/core/domain';
import type { DraftIssue } from './validation';
import { useCatalogue } from '@/hooks/useCatalogue';
import { CustomerGroup } from './details/CustomerGroup';
import { SiteGroup } from './details/SiteGroup';
import { DeliveryGroup } from './details/DeliveryGroup';
import { DesignGroup } from './details/DesignGroup';
import { ShedGroup } from './details/ShedGroup';
import { ColourGroup } from './details/ColourGroup';

export interface QuoteDetailsPanelProps {
  /** Issues addressed to this panel's fields, by path. */
  issuesByPath: Map<string, DraftIssue>;
  unit: DisplayUnit;
  onUnitChange: (unit: DisplayUnit) => void;
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
  kneeBrace = null,
}: QuoteDetailsPanelProps) {
  /**
   * Whether the picker can fill the address parts, which decides whether they are read-only.
   *
   * Starts `false`: on the first render nothing is known, and locking a field before knowing the picker
   * works would leave an address that cannot be completed. `AddressField` reports as soon as it has an
   * answer.
   */
  const [placesConfigured, setPlacesConfigured] = useState(false);
  const { catalogue } = useCatalogue();

  return (
    <div className="flex flex-col">
      {/*
        `issueCount` only. An earlier version also passed a `count` string built from the same
        number, and the heading rendered "3 to fix 3 to fix" — two labels for one fact, visible in
        the browser and invisible in the type checker.
      */}
      <CustomerGroup
        issuesByPath={issuesByPath}
        placesConfigured={placesConfigured}
        setPlacesConfigured={setPlacesConfigured}
      />
      {/* PIN lives inside the site address, as on the desktop: type the address, pin the site. The
          certified values it brings back are shown once, in Design below. */}
      <SiteGroup issuesByPath={issuesByPath} placesConfigured={placesConfigured} unit={unit} />
      <DeliveryGroup issuesByPath={issuesByPath} catalogue={catalogue} />
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
