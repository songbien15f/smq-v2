/**
 * The estimating orchestrator.
 *
 * One function answers the question a workspace actually asks: **what is this
 * shed worth, and how much of that answer is known?** It is pure — no database,
 * no clock, no randomness, no HTTP — so the same config and book always produce
 * the same result, byte for byte. A saved revision depends on that.
 *
 * The steps are the ones a reader would take:
 *
 * 1. Normalise the config, because this is the boundary a browser posts to.
 * 2. Validate the money, because a `NaN` that becomes a default is a quote that
 *    is quietly wrong.
 * 3. Build the bill of materials with its evidence, which is what makes a fully
 *    priced quote still *indicative*.
 * 4. Price it, adding the operator's selling charges **once** to the contract.
 * 5. Classify: a blocker outranks an assumption.
 *
 * The margin comes from the pricing context, never from the caller: a role that
 * may see a price is not necessarily a role that may set its own.
 */

import type { ShedConfig } from '@/domain/types';
import { normaliseShedConfig } from '@/domain/schema';
import { buildBomWithEvidence } from '@/lib/bom/build';
import { DEFAULT_CONTRACTS } from '@/lib/pricing/catalogueManifest';
import { priceQuote, type PriceInput } from '@/lib/pricing/price';
import { classifyEstimate } from './issues';
import { sellingChargesCents, validatePriceInput } from './validate';
import type { Evaluation, PricingContext } from './types';

/**
 * Price a shed under a book and a policy.
 *
 * `input` carries the operator's choices — delivery, engineering, the quote rate
 * and the payment split — but not the margin, which belongs to the workspace's
 * pricing policy.
 */
export function evaluateQuote(
  config: ShedConfig,
  input: Omit<PriceInput, 'margin'>,
  book: PricingContext,
): Evaluation {
  const normalised = normaliseShedConfig(config);
  // The book prices some building families apart — a gable carport carries a
  // higher multiplier than a gable shed of the same size — so the margin is a
  // question about *this* config, not a constant on the context.
  const margin = book.policy.marginFor?.(normalised) ?? book.policy.margin;
  const validated = validatePriceInput({ ...input, margin });

  // The factory's rules, not the module defaults: two suppliers do not agree on
  // how many purlin rows a roof needs, and a quote has to use the one its company
  // buys from.
  const built = buildBomWithEvidence(
    normalised,
    book.lookup,
    DEFAULT_CONTRACTS,
    book.policy.bom?.rules,
  );

  // A selling charge is an amount the operator typed, already inclusive of the
  // margin and tax it should carry. It joins the contract once, here, and never
  // the material cost.
  const charges = sellingChargesCents(normalised);
  const price = priceQuote(built.bom, {
    ...validated,
    additionsCents: validated.additionsCents + charges,
  });

  return {
    config: normalised,
    bom: built.bom,
    price,
    issues: built.issues,
    materials: built.materials,
    status: classifyEstimate(built.issues),
    provenance: book.provenance,
  };
}
