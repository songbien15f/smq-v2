'use client';

/**
 * The company's rate table, for whoever is pricing.
 *
 * Read from `/settings/rates` rather than `/settings`: an estimator holds `quote:write` but not
 * `settings:manage`, and the labour rates are exactly what they need to turn hours into money
 * without being able to change the company's terms.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/sq';

export interface CompanyRates {
  labour: { concreter: number; electrician: number; labourer1: number; labourer2: number };
  defaultCosts: { council: number; engineering: number; rubbish: number; delivery: number; concrete: number };
}

export function useCompanyRates(): CompanyRates | null {
  const [rates, setRates] = useState<CompanyRates | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ rates: CompanyRates | null }>('settings/rates').then((result) => {
      if (!alive) return;
      setRates(result.ok ? result.data.rates : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  return rates;
}
