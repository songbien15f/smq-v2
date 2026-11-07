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
 *
 * ## Why it is shared rather than fetched per component
 *
 * Two components on the editor need it — the Cost step (labour rates, freight minimum) and the
 * Details step (which delivery scopes exist) — so a plain `useEffect` per component fetched the same
 * row twice on every screen. The cache below is reference-counted instead of time-based: while any
 * consumer is mounted there is one request, and when the last one unmounts the cache is **dropped**.
 *
 * Dropping it matters. A permanent module cache would keep serving the rates from before the operator
 * opened Settings and changed them, and the Cost step would prefill the old hourly rate into a fresh
 * quote. Reference counting gets one request per screen without ever serving a value older than the
 * screen it is on.
 */

import { useEffect, useState } from 'react';
import { NO_MINIMUMS, type FreightMinimums } from '@sq/core/domain';
import { api } from '@/lib/sq';

export interface CompanyRates {
  labour: { concreter: number; electrician: number; labourer1: number; labourer2: number };
  defaultCosts: { council: number; engineering: number; rubbish: number; delivery: number; concrete: number };
}

/** What the endpoint answers, and what the hook hands out. */
export interface CompanyPricing {
  rates: CompanyRates | null;
  minimumFees: FreightMinimums;
}

const EMPTY: CompanyPricing = { rates: null, minimumFees: NO_MINIMUMS };

/** The shared read: the last answer, the request in flight, and how many components are using it. */
let cache: CompanyPricing | null = null;
let inflight: Promise<CompanyPricing> | null = null;
let consumers = 0;

/** Everyone waiting for the current answer. */
const listeners = new Set<(value: CompanyPricing) => void>();

function publish(value: CompanyPricing): void {
  cache = value;
  for (const listener of listeners) listener(value);
}

function load(): Promise<CompanyPricing> {
  if (inflight !== null) return inflight;
  inflight = api<CompanyPricing>('settings/rates')
    .then((result) => {
      if (!result.ok) return EMPTY;
      return {
        rates: result.data.rates ?? null,
        minimumFees: result.data.minimumFees ?? NO_MINIMUMS,
      };
    })
    .catch(() => EMPTY)
    .then((value) => {
      inflight = null;
      publish(value);
      return value;
    });
  return inflight;
}

/**
 * The company's rates and freight minimums, read once per editor screen.
 *
 * Answers `EMPTY` until the read lands, which is what the callers already handle: no rates means no
 * prefill, and no minimums means nothing is held to a floor.
 */
export function useCompanyPricing(): CompanyPricing {
  const [pricing, setPricing] = useState<CompanyPricing>(cache ?? EMPTY);

  useEffect(() => {
    consumers += 1;
    listeners.add(setPricing);

    // A value already in hand needs no second request; otherwise wait for the one in flight.
    if (cache !== null) {
      setPricing(cache);
    } else {
      void load();
    }

    return () => {
      listeners.delete(setPricing);
      consumers -= 1;
      // The last consumer left: forget the value, so the next screen reads it fresh.
      if (consumers <= 0) {
        consumers = 0;
        cache = null;
      }
    };
  }, []);

  return pricing;
}
