/**
 * Additions: the cost lines added after the kit and after the quote rate.
 *
 * The desktop's `CalculateAdditionsPrice` (`PriceController.Calculation.cs:90`) sums two
 * kinds of line, and the difference matters to the total:
 *
 * - **Labour and equipment** are a pre-tax rate × hours or quantity, and the result is
 *   multiplied by `1 + GST`.
 * - **Fees** (council, engineering, rubbish, delivery, concrete, demolition,
 *   accommodation) are entered as the amount that appears on the invoice, so GST is
 *   already inside them and must not be added again.
 *
 * Adding GST to a fee would overstate every quote that carries one. Adding it to labour
 * twice would do the same. The `taxable` flag is the only thing that separates them, so
 * it lives on the line rather than in a formula the caller has to remember.
 *
 * `Contract = TotalPrice × (1 + QuoteRate%) + Additions` (desktop `PriceController.cs:257`).
 *
 * Pure TypeScript: no framework imports.
 */

/** Australia's GST rate. Law, not configuration; mirrors `pricing/price.ts`. */
const GST_RATE = 0.1;

/** One addition line. */
export interface AdditionLine {
  id: string;
  label: string;
  /** True for labour and equipment: the amount is pre-tax and GST is added. */
  taxable: boolean;
  /** The desktop's `Has*` flag: an unchecked line contributes nothing. */
  enabled: boolean;
  quantity: number;
  unitPriceCents: number;
}

/** The desktop's line set, all off, so a new quote starts with no additions. */
export const DEFAULT_ADDITION_LINES: AdditionLine[] = [
  { id: 'concreter', label: 'Concreter', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'electrician', label: 'Electrician', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'labourer1', label: 'Labourer 1', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'labourer2', label: 'Labourer 2', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'equipment', label: 'Equipment hire', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'distributor', label: 'Distributor misc', taxable: true, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'accommodation', label: 'Accommodation', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'council', label: 'Council fee', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'engineering', label: 'Engineering', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'rubbish', label: 'Rubbish removal', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'delivery', label: 'Delivery fee', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'concrete', label: 'Concrete footings', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
  { id: 'demolition', label: 'Demolition', taxable: false, enabled: false, quantity: 0, unitPriceCents: 0 },
];

/**
 * The additions total, in whole cents.
 *
 * Rounded once per line, after the GST multiplier, so a long list cannot accumulate a
 * cent of drift and the invoice total equals the sum of its rows.
 */
export function additionsTotalCents(lines: readonly AdditionLine[], gstRate = GST_RATE): number {
  let total = 0;
  for (const line of lines) {
    if (!line.enabled) continue;
    const amount = Math.round(line.quantity * line.unitPriceCents);
    total += line.taxable ? Math.round(amount * (1 + gstRate)) : amount;
  }
  return total;
}
