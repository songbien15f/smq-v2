'use client';

/**
 * The company's rate table and freight minimums, for whoever is pricing.
 *
 * Read from `/settings/rates` rather than `/settings`: an estimator holds `quote:write` but not
 * `settings:manage`, and these are exactly what they need — the labour rates to turn hours into money,
 * and the freight minimums to know what a distributor delivery is held to — without being able to
 * change the company's terms.
 *
 * The two travel together because the Cost step needs both, and a second endpoint for four numbers
 * would be a second thing to keep in step with the settings schema.
 */

import { useEffect, useState } from 'react';
import { NO_MINIMUMS, type FreightMinimums } from '@sq/core/domain';
import { api } from '@/lib/sq';

export interface CompanyRates {
  labour: { concreter: number; electrician: number; labourer1: number; labourer2: number };
  defaultCosts: { council: number; engineering: number; rubbish: number; delivery: number; concrete: number };
}

/** What the endpoint answers, and what the hooks below hand out. */
export interface CompanyPricing {
  rates: CompanyRates | null;
  minimumFees: FreightMinimums;
}

const EMPTY: CompanyPricing = { rates: null, minimumFees: NO_MINIMUMS };

/** Fetch once per mount; the values are small and settings can change between quotes. */
export function useCompanyPricing(): CompanyPricing {
  const [pricing, setPricing] = useState<CompanyPricing>(EMPTY);

  useEffect(() => {
    let alive = true;
    void api<CompanyPricing>('settings/rates').then((result) => {
      if (!alive || !result.ok) return;
      setPricing({ rates: result.data.rates ?? null, minimumFees: result.data.minimumFees ?? NO_MINIMUMS });
    });
    return () => {
      alive = false;
    };
  }, []);

  return pricing;
}
