/**
 * Validating money before it becomes a quote.
 *
 * The price chain used to coerce every unreadable input to a default: a `NaN`
 * margin became 1, a `NaN` delivery became 0. That is the wrong direction for a
 * quote. A missing margin quietly removes the profit; a missing delivery quietly
 * gives away the freight. Both produce a number that looks like a price.
 *
 * So validation is explicit and it throws. The operator sees what is wrong
 * instead of receiving a plausible total that is not theirs.
 *
 * The three payment stages must also describe **one** price. A deposit of 60%
 * and a progress payment of 60% add to 120%, which leaves a negative balance:
 * the stages no longer reconcile, and the quote tells a buyer to pay more than
 * the total. A tolerance allows the pairs that are meant to sum to 100
 * (49.8 + 49.8) while rejecting the ones that are meant to overdraw.
 */

import type { ShedConfig } from '@/domain/types';
import type { PriceInput } from '@/lib/pricing/price';
import { chargeAmountCents } from '@/domain/charges';

/** How far a deposit/progress pair may exceed 100 and still be accepted. */
const STAGE_TOLERANCE_PCT = 0.5;

/** A whole number of cents, or a throw. */
function wholeCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number of cents`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be whole cents, not ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} is too large to price safely`);
  }
  return value;
}

/** A percentage in `[0, 100]`, or a throw. */
function percentage(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite percentage`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`${field} must be between 0 and 100, not ${value}`);
  }
  return value;
}

/**
 * The input a price may be computed from, or a throw.
 *
 * Charges are non-negative: a negative delivery is a discount, and a discount
 * belongs in the quote rate where it can be seen and reasoned about, not hidden
 * as a negative freight line.
 */
export function validatePriceInput(input: unknown): PriceInput {
  if (typeof input !== 'object' || input === null) throw new Error('A price needs an input object');
  const raw = input as Record<string, unknown>;

  const margin = raw.margin;
  if (typeof margin !== 'number' || !Number.isFinite(margin) || margin <= 0) {
    throw new Error('The margin must be a positive multiplier');
  }

  const deliveryCents = wholeCents(raw.deliveryCents, 'Delivery');
  const engineeringCents = wholeCents(raw.engineeringCents, 'Engineering');
  const extraCents = wholeCents(raw.extraCents, 'Extra charges');
  const additionsCents = wholeCents(raw.additionsCents, 'Additions');
  for (const [value, field] of [
    [deliveryCents, 'Delivery'],
    [engineeringCents, 'Engineering'],
    [extraCents, 'Extra charges'],
    [additionsCents, 'Additions'],
  ] as const) {
    if (value < 0) throw new Error(`${field} cannot be negative; put a discount in the quote rate`);
  }

  const quoteRatePct = raw.quoteRatePct;
  if (typeof quoteRatePct !== 'number' || !Number.isFinite(quoteRatePct)) {
    throw new Error('The quote rate must be a finite percentage');
  }
  // A discount is a negative rate, but never one that takes the contract below
  // zero: a quote for a negative amount is not a quote.
  if (quoteRatePct <= -100) throw new Error('A discount cannot exceed 100%');

  const depositPct = percentage(raw.depositPct, 'Deposit');
  const progressPct = percentage(raw.progressPct, 'Progress payment');

  if (depositPct + progressPct > 100 + STAGE_TOLERANCE_PCT) {
    throw new Error(
      `Deposit ${depositPct}% and progress ${progressPct}% add to more than the contract; the balance would be negative`,
    );
  }

  return {
    margin,
    deliveryCents,
    engineeringCents,
    extraCents,
    additionsCents,
    quoteRatePct,
    depositPct,
    progressPct,
  };
}

/**
 * What the Charges tab adds to a quote, in GST-inclusive cents.
 *
 * A charge on that tab is a **selling** amount the operator typed — a crane
 * hire, a council permit — not a material cost. It therefore joins the contract
 * as an addition, once, and does not travel through the material margin or pick
 * up a second GST load. Adding it to material cost would apply the margin and
 * the tax to a figure that already includes both.
 */
export function sellingChargesCents(config: ShedConfig): number {
  return config.charges.reduce((total, charge) => total + chargeAmountCents(charge), 0);
}
