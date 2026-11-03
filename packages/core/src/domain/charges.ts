/**
 * Charge lines: the arithmetic behind the Charges tab.
 *
 * A charge is a line on a quote that is not a physical object — an engineering
 * fee, delivery, site preparation. It has no geometry, so it is deliberately not
 * a `ShedOption`; it lives here with its own arithmetic.
 *
 * **Money is whole cents.** Storing dollars as floats would make a subtotal
 * depend on how many lines it summed: `0.1 + 0.2` is `0.30000000000000004`, and
 * over a long quote the error becomes visible in the total. Multiplying and
 * rounding once per line keeps every figure exact.
 *
 * This module has no imports beyond the domain types: it is safe to use from a
 * test, a component, or the AI boundary.
 */

import type { Charge } from './types';

/** The label a **new** line starts with, so the user knows what to type over. */
const NEW_CHARGE_LABEL = 'New charge';
/**
 * The label an existing line falls back to when its label is blank.
 *
 * Different from `NEW_CHARGE_LABEL` on purpose: "New charge" invites editing,
 * while "Charge" is what a repaired, deliberately-unnamed line should read as.
 */
const DEFAULT_LABEL = 'Charge';
/** The unit a charge falls back to. */
const DEFAULT_UNIT = 'ea';

/** A fresh, empty charge line. */
export function newCharge(): Charge {
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    id: `ch-${unique}`,
    label: NEW_CHARGE_LABEL,
    quantity: 1,
    unit: DEFAULT_UNIT,
    unitPriceCents: 0,
  };
}

/**
 * What one line is worth, in cents.
 *
 * Rounded once, after the multiplication: a quantity of 2.5 at $95.00 is
 * $237.50, and rounding the quantity first would be a different (and wrong)
 * answer for a fractional hour.
 */
export function chargeAmountCents(charge: Charge): number {
  return Math.round(charge.quantity * charge.unitPriceCents);
}

/** The sum of every line, in cents. */
export function chargesSubtotalCents(charges: Charge[]): number {
  return charges.reduce((total, charge) => total + chargeAmountCents(charge), 0);
}

/** `$1,234.50` — cents in, display string out. */
export function formatMoney(cents: number): string {
  const value = cents / 100;
  return `$${value.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** True for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number from a number or numeric string, or `undefined`. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Parse one raw charge into a usable record, or `undefined` when the input is
 * not an object at all.
 *
 * Every field is repaired rather than rejected, matching how the rest of the
 * normaliser treats untrusted input: a blank label becomes "Charge", a negative
 * quantity becomes 0, a fractional price rounds to whole cents.
 *
 * `unitPrice` (dollars) is accepted as well as `unitPriceCents`: the AI boundary
 * asks a model for a price in dollars, because that is what a person says, and
 * converting here keeps the cents form an internal detail.
 */
export function normaliseCharge(input: unknown, fallbackId: string): Charge | undefined {
  if (!isPlainObject(input)) return undefined;

  const label =
    typeof input.label === 'string' && input.label.trim() !== '' ? input.label.trim() : DEFAULT_LABEL;

  const unit =
    typeof input.unit === 'string' && input.unit.trim() !== '' ? input.unit.trim() : DEFAULT_UNIT;

  const rawQuantity = toNumber(input.quantity);
  const quantity =
    rawQuantity === undefined ? 1 : Math.max(0, Math.round(rawQuantity * 100) / 100);

  const centsFromCents = toNumber(input.unitPriceCents);
  const centsFromDollars = toNumber(input.unitPrice);
  const unitPriceCents =
    centsFromCents !== undefined
      ? Math.max(0, Math.round(centsFromCents))
      : centsFromDollars !== undefined
        ? Math.max(0, Math.round(centsFromDollars * 100))
        : 0;

  const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : fallbackId;

  return { id, label, quantity, unit, unitPriceCents };
}
