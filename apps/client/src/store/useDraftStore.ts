'use client';

/**
 * The draft: everything that is not the building.
 *
 * The building lives in `useShedStore`, which is the geometry editor's own store and knows
 * nothing about customers or prices. This store holds the rest — who the quote is for, where the
 * site is, the money — and the two compose at the screen.
 *
 * ## Why a separate store rather than one big one
 *
 * The building store is on the undo stack: dragging a door, changing a span. A customer's email
 * is not an undoable geometry change, and putting it on the same history means Ctrl+Z after a
 * typo reverts an unrelated wall. Two stores, two histories, one screen.
 *
 * ## Dirty tracking, without the desktop's three booleans
 *
 * The desktop kept three hand-managed flags to keep a panel, a grid and an engine in step, and a
 * stuck flag silently dropped edits. Here a snapshot of the draft is taken when the quote is
 * opened or saved, and "dirty" is a **comparison** — a derived fact rather than a maintained one.
 * It cannot stick, because nothing has to remember to clear it.
 */

import { create } from 'zustand';
import { DEFAULT_ADDITION_LINES } from '@sq/core/domain';
import { DEFAULT_SHED, normaliseShedConfig } from '@sq/core/domain';
import type { PricingInput } from '@sq/contracts';

/** The customer, as the form holds it. Empty strings, not nulls: an input has a value. */
export interface DraftCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  fax: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
}

/** The site the shed goes on. Separate from the customer on purpose: dealers quote a house on a
 *  block often enough that copying the address silently would put the shed in the wrong place. */
export interface DraftSite {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  deliveryAddress: string;
  deliveryScope: string;
  deliveryAcknowledged: boolean;
}

/** Where the price stands, which is what the SAVE gate reads. */
export type PricedState =
  | { kind: 'none' }
  | { kind: 'stale' }
  | {
      kind: 'current';
      evaluationId: string;
      contractCents: number;
      expiresAt: string;
      /**
       * A fingerprint of the inputs this price was calculated from — the **building and the money**,
       * not the customer.
       *
       * The distinction is load-bearing and was wrong at first: staleness keyed on "the draft is
       * dirty" made typing a customer's name mark the price out of date, so the screen told a
       * salesperson "the building changed" when only a text field had. A price is a fact about a
       * building and a set of figures; nothing else may invalidate it.
       */
      inputs: string;
    };

export interface DraftState {
  customer: DraftCustomer;
  site: DraftSite;
  pricing: PricingInput;
  /** The price's state relative to the building and the money. */
  priced: PricedState;
  /** A frozen copy of everything, for dirty comparison. Set on open and after a save. */
  snapshot: string;
  /** The revision being edited; `null` for a quote that has not been saved. */
  quoteId: string | null;
  quoteNumber: string | null;
  /** The revision number the quote is on, so a save can name the one it appends after. */
  expectedRev: number;
  /**
   * A site check pinned before the quote was saved.
   *
   * The desktop pins while Step 1 is still open, so the check exists before the quote.
   * The first save sends this id and the server links it.
   */
  siteCheckId: string | null;

  setSiteCheckId: (id: string | null) => void;

  setCustomer: (patch: Partial<DraftCustomer>) => void;
  setSite: (patch: Partial<DraftSite>) => void;
  setPricing: (patch: Partial<PricingInput>) => void;
  /** Mark the price as no longer matching the draft. */
  invalidatePrice: () => void;
  /** Record a fresh evaluation. */
  setPriced: (priced: Extract<PricedState, { kind: 'current' }>) => void;
  /**
   * True when the price on screen no longer describes the building and the money.
   *
   * A comparison rather than a flag, for the same reason the draft's dirty state is: a flag has to
   * be cleared by every code path that changes an input, and one that forgets produces a screen
   * showing a price for a building that no longer exists.
   */
  priceIsStale: (priceInputs: string) => boolean;
  /** Replace the whole draft, as opening a saved quote does. */
  load: (input: {
    customer: DraftCustomer;
    site: DraftSite;
    pricing: PricingInput;
    quoteId: string | null;
    quoteNumber: string | null;
    expectedRev: number;
  }) => void;
  /** Take a new baseline after a save, so the next edit is what counts as dirty. */
  markClean: (input: { quoteId: string; quoteNumber: string; revision: number }) => void;
  /** A fingerprint of everything the draft controls. */
  fingerprint: () => string;
  /** True when the draft differs from the baseline. */
  isDirty: () => boolean;
}

const EMPTY_CUSTOMER: DraftCustomer = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  mobile: '',
  fax: '',
  address: '',
  suburb: '',
  state: '',
  postcode: '',
};

const EMPTY_SITE: DraftSite = {
  address: '',
  suburb: '',
  state: '',
  postcode: '',
  deliveryAddress: '',
  deliveryScope: '',
  deliveryAcknowledged: false,
};

/** The desktop's own defaults: 10% deposit, 70% progress, the rest on delivery. */
const DEFAULT_PRICING: PricingInput = {
  quoteRatePct: 0,
  depositPct: 10,
  progressPct: 70,
  deliveryCents: 0,
  engineeringCents: 0,
  extraCents: 0,
  additionsCents: 0,
  additionLines: DEFAULT_ADDITION_LINES,
  contractOverrideCents: null,
  depositOverrideCents: null,
  progressOverrideCents: null,
};

/**
 * A fingerprint of the draft's own fields.
 *
 * Deterministic key order, because `JSON.stringify` on an object literal follows insertion order
 * and two drafts built by different code paths would then fingerprint differently while being
 * equal.
 */
function fingerprintOf(customer: DraftCustomer, site: DraftSite, pricing: PricingInput): string {
  const sorted = (value: Record<string, unknown>): string =>
    `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`)
      .join(',')}}`;
  return `${sorted(customer as unknown as Record<string, unknown>)}|${sorted(
    site as unknown as Record<string, unknown>,
  )}|${sorted(pricing as unknown as Record<string, unknown>)}`;
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  customer: EMPTY_CUSTOMER,
  site: EMPTY_SITE,
  pricing: DEFAULT_PRICING,
  priced: { kind: 'none' },
  snapshot: fingerprintOf(EMPTY_CUSTOMER, EMPTY_SITE, DEFAULT_PRICING),
  quoteId: null,
  quoteNumber: null,
  expectedRev: 0,
  siteCheckId: null,

  setSiteCheckId(id) {
    set({ siteCheckId: id });
  },

  setCustomer(patch) {
    // A customer's name does not change what the shed costs, so the price stays current. Stated
    // here rather than left implicit: the obvious implementation invalidated it, and the screen then
    // claimed the building had changed when a text field had.
    set((state) => ({ customer: { ...state.customer, ...patch } }));
  },

  setSite(patch) {
    // The site does not change the price either — delivery is typed. Same reasoning as above.
    set((state) => ({ site: { ...state.site, ...patch } }));
  },

  setPricing(patch) {
    set((state) => ({
      pricing: { ...state.pricing, ...patch },
      // Money *does* change the price.
      priced: state.priced.kind === 'current' ? { kind: 'stale' } : state.priced,
    }));
  },

  invalidatePrice() {
    set((state) => (state.priced.kind === 'current' ? { priced: { kind: 'stale' } } : {}));
  },

  setPriced(priced) {
    set({ priced });
  },

  priceIsStale(priceInputs) {
    const { priced } = get();
    return priced.kind !== 'current' || priced.inputs !== priceInputs;
  },

  load(input) {
    set({
      customer: input.customer,
      site: input.site,
      pricing: input.pricing,
      quoteId: input.quoteId,
      quoteNumber: input.quoteNumber,
      expectedRev: input.expectedRev,
      siteCheckId: null,
      priced: { kind: 'none' },
      snapshot: fingerprintOf(input.customer, input.site, input.pricing),
    });
  },

  markClean(input) {
    const { customer, site, pricing } = get();
    set({
      quoteId: input.quoteId,
      quoteNumber: input.quoteNumber,
      expectedRev: input.revision,
      snapshot: fingerprintOf(customer, site, pricing),
    });
  },

  fingerprint() {
    const { customer, site, pricing } = get();
    return fingerprintOf(customer, site, pricing);
  },

  isDirty() {
    const { customer, site, pricing, snapshot } = get();
    return fingerprintOf(customer, site, pricing) !== snapshot;
  },
}));

/** The building a new quote starts from. Re-exported so a screen does not import from core. */
export const STARTING_BUILDING = normaliseShedConfig(DEFAULT_SHED);
