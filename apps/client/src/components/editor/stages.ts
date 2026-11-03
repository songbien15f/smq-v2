/**
 * The payment stages, from a contract and whatever the operator typed.
 *
 * ## Why this is a function and not three lines in each component
 *
 * Two components show the same three figures: the price panel, which is always visible, and the
 * Cost step, where they are edited. A second copy of the arithmetic produced two answers for one
 * quote — the panel reading the evaluation's deposit while the field showed a re-derived one — and
 * the number a salesperson reads aloud is the one on the panel.
 *
 * ## The rules, which match the server's
 *
 * 1. A typed figure wins over a computed one.
 * 2. A negotiated **contract** re-derives the deposit and progress, because "10% of what we agreed"
 *    moves when the agreement moves.
 * 3. When the two percentages mean to cover the contract, the progress payment absorbs the rounding
 *    so nothing is left over. Fifty percent of an odd number of cents would otherwise leave a
 *    one-cent balance.
 * 4. The balance is **always** the remainder — never typed, never rounded — so the three stages sum
 *    to the contract exactly.
 */

import type { PricingInput } from '@sq/contracts';

/** The three figures, in cents. */
export interface PaymentStages {
  contractCents: number;
  depositCents: number;
  progressCents: number;
  balanceCents: number;
  /** Which of them the operator typed, so a screen can say so. */
  overridden: { contract: boolean; deposit: boolean; progress: boolean };
}

/** Derive the stages from the computed price and the operator's figures. */
export function deriveStages(
  computed: { contractCents: number; depositCents: number; progressCents: number },
  pricing: PricingInput,
): PaymentStages {
  const contractOverridden = pricing.contractOverrideCents !== null;
  const contractCents = pricing.contractOverrideCents ?? computed.contractCents;

  const stagesAreWhole = Math.abs(pricing.depositPct + pricing.progressPct - 100) <= 0.5;

  const depositCents =
    pricing.depositOverrideCents ??
    (contractOverridden
      ? Math.round((contractCents * pricing.depositPct) / 100)
      : computed.depositCents);

  const progressCents =
    pricing.progressOverrideCents ??
    (contractOverridden
      ? stagesAreWhole
        ? contractCents - depositCents
        : Math.round((contractCents * pricing.progressPct) / 100)
      : computed.progressCents);

  return {
    contractCents,
    depositCents,
    progressCents,
    balanceCents: contractCents - depositCents - progressCents,
    overridden: {
      contract: contractOverridden,
      deposit: pricing.depositOverrideCents !== null,
      progress: pricing.progressOverrideCents !== null,
    },
  };
}

/** GST inside a GST-inclusive total. Extracted, never added. */
export function gstWithin(contractCents: number, rate = 0.1): number {
  return contractCents - Math.round(contractCents / (1 + rate));
}
