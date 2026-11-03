/**
 * The quote price chain.
 *
 * Six figures, in this order, and the order is the whole design:
 *
 *     kit      = totalCost × margin × (1 + GST)
 *     total    = kit + delivery + engineering + extra
 *     contract = total × (1 + quoteRate%) + additions
 *     gst      = contract − contract / (1 + GST)
 *     deposit  = contract × depositPct%
 *     progress = contract × progressPct%
 *     balance  = contract − deposit − progress
 *
 * **GST is a constant, not a field.** It is law: 10% in Australia, and the
 * desktop hardcodes it too (`CommonConstants.cs:9`). Letting it be edited per
 * quote is how a quote ends up illegal.
 *
 * **The contract price is GST-inclusive.** An Australian buyer reads the headline
 * number as what they pay, so the tax is *extracted* from it rather than added to
 * it. `gstCents` is therefore a reporting figure, never a component: adding it to
 * `contractCents` would double-charge the tax.
 *
 * **The charges are GST-inclusive, like the kit.** `deliveryCents`,
 * `engineeringCents` and `extraCents` are added as given, with no GST loading on
 * top. This is what the desktop actually does, and it was checked against a real
 * quote file rather than the prose spec: in `mock-test.sqd` the desktop's own
 * fields are `KitOnly 24.42`, `DeliveryCost 275`, `EngineerCharge 110`,
 * `TotalPrice 409.42` — and 24.42 + 275 + 110 is 409.42 exactly. Loading GST onto
 * the charges would have produced 447.92 and overstated every quote by the tax on
 * its delivery and engineering.
 *
 * The consequence for a caller: pass the figure as it will appear on the invoice,
 * tax included. `lookup.delivery()` returns the book's figure, which is the
 * GST-inclusive one the desktop stores.
 *
 * **The deposit percentage is policy, so it is a field.** Ten percent is the
 * common case and the default, but a repeat customer or a council job may differ,
 * and that is the operator's call.
 *
 * **The balance is always the remainder.** Two percentages that sum to 90 leave
 * 10% as the balance. Every figure is rounded **once**, from an integer-cents
 * expression, so the three stages add up exactly.
 *
 * **When the two percentages sum to 100, the progress payment absorbs the
 * rounding.** A 50/50 split of an odd number of cents rounds both halves up, and
 * the balance comes out at −1 cent. The desktop guards this exact case
 * (`isRoundingConflict`); here the rule is general: if deposit + progress is meant
 * to be the whole contract, progress is the remainder. Otherwise the balance is,
 * and a pair of percentages that deliberately overdraw shows a negative balance
 * rather than silently disagreeing with the contract total.
 */

import type { BomResult } from '@/lib/bom/types';
import { validatePriceInput } from '@/lib/estimating/validate';

/** Australia's GST rate. Law, not configuration. */
export const GST_RATE = 0.1;

/** Everything the operator can set on a quote. */
export interface PriceInput {
  /** The structure-and-state multiplier from `setting_price_coeffcient`. */
  margin: number;
  deliveryCents: number;
  engineeringCents: number;
  /** Anything else the operator adds, such as a crane or a permit. */
  extraCents: number;
  /** Optional extras quoted alongside the shed, already priced. */
  additionsCents: number;
  /** An uplift on the whole job, in percent; 0 for none. */
  quoteRatePct: number;
  /** Deposit as a percentage of the contract; 10 by default. */
  depositPct: number;
  /** Progress payment as a percentage; 70 by default. */
  progressPct: number;
}

/** The priced quote: the inputs kept for audit, and every figure a document needs. */
export interface QuotePrice extends PriceInput {
  gstRate: number;
  /** `totalCost × margin × (1 + GST)`, whole cents. */
  kitCents: number;
  /** `kit + delivery + engineering + extra`. */
  totalCents: number;
  /** GST-inclusive: what the buyer pays. */
  contractCents: number;
  /** The GST already inside `contractCents`. Reporting only. */
  gstCents: number;
  depositCents: number;
  progressCents: number;
  /** The remainder, so the three stages always sum to the contract. */
  balanceCents: number;
}

/** Default percentages: the Australian shed norm, and what the desktop used. */
export const DEFAULT_DEPOSIT_PCT = 10;
export const DEFAULT_PROGRESS_PCT = 70;

/**
 * Price a bill of materials.
 *
 * `bom.totalCost` is used, not `bom.buildingCost`: the total includes
 * miscellaneous items, and pricing the building without them would leave that
 * cost unrecovered at the margin step.
 */
export function priceQuote(bom: BomResult, input: PriceInput): QuotePrice {
  // Validation throws rather than coercing. A NaN margin coerced to 1 quietly
  // removes the profit from a quote; a NaN delivery coerced to 0 gives away the
  // freight. Both produce a number that looks like a price.
  const {
    margin,
    deliveryCents,
    engineeringCents,
    extraCents,
    additionsCents,
    quoteRatePct,
    depositPct,
    progressPct,
  } = validatePriceInput(input);

  const kitCents = Math.round(bom.totalCost * margin * (1 + GST_RATE));
  // The charges are GST-inclusive, as the desktop stores them: added as given,
  // never loaded again. See the module comment for the quote file that proves it.
  const totalCents = kitCents + deliveryCents + engineeringCents + extraCents;
  const contractCents = Math.round(totalCents * (1 + quoteRatePct / 100)) + additionsCents;

  // Extracted, not added: the contract already includes the tax.
  const gstCents = contractCents - Math.round(contractCents / (1 + GST_RATE));

  const depositCents = Math.round((contractCents * depositPct) / 100);
  // A pair that means to cover the contract leaves no balance, so the progress
  // payment absorbs the rounding. `Math.abs` rather than `Math.round` on the sum:
  // 49.8 + 49.8 is a legitimate pair that does not reach 100, and rounding the
  // sum to 100 would then hide its real balance.
  const stagesAreWhole = Math.abs(depositPct + progressPct - 100) <= 0.5;
  const progressCents = stagesAreWhole
    ? contractCents - depositCents
    : Math.round((contractCents * progressPct) / 100);
  const balanceCents = contractCents - depositCents - progressCents;

  return {
    margin,
    gstRate: GST_RATE,
    deliveryCents,
    engineeringCents,
    extraCents,
    additionsCents,
    quoteRatePct,
    depositPct,
    progressPct,
    kitCents,
    totalCents,
    contractCents,
    gstCents,
    depositCents,
    progressCents,
    balanceCents,
  };
}
