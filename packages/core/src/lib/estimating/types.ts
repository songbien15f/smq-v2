/**
 * Types shared by the estimating layer.
 *
 * The estimating layer answers a question the BOM alone cannot: **how much of
 * this quote is known, and how much is assumed?** A bill of materials can be
 * fully priced and still be an estimate built on a fixed frame section and a
 * substituted span table. Those two facts must reach the person quoting and, in
 * a different form, the customer reading the document.
 *
 * `status` is the whole vocabulary:
 *
 * - `blocked` — a required figure is missing or invalid. The operator can save a
 *   draft, because a draft is useful, but no customer document leaves the
 *   building.
 * - `indicative` — the arithmetic is complete but rests on at least one stated
 *   assumption. It can be sent, watermarked, and only with an explicit
 *   acknowledgement recorded against the revision.
 * - `priced` — every required commercial quantity and rate is supported and no
 *   assumption is active. **This is not engineering approval.** A priced quote
 *   still says engineering review applies; nothing in this vocabulary certifies
 *   a structure.
 */

import type { ShedConfig } from '@/domain/types';
import type { BomResult } from '@/lib/bom/types';
import type { FrameMember } from '@/lib/bom/groups/frame';
import type { PriceLookup } from '@/lib/pricing/types';
import type { QuotePrice } from '@/lib/pricing/price';
import type { BomPolicy } from '@/lib/bom/rules';

export type EstimateStatus = 'blocked' | 'indicative' | 'priced';

/**
 * How badly an issue affects a quote.
 *
 * `blocker` prevents a customer document; `assumption` makes the estimate
 * indicative; `warning` is information that changes nothing about status.
 */
export type IssueSeverity = 'blocker' | 'assumption' | 'warning';

/** One thing the operator must be able to see about a quote. */
export interface EstimateIssue {
  /** Stable machine code, so a UI can group and a test can assert. */
  code: string;
  severity: IssueSeverity;
  /** Plain English, safe to show the operator. */
  message: string;
  /** The BOM line it concerns, when it concerns one. */
  lineId?: string;
  /** The config field it concerns, when it concerns one. */
  field?: string;
}

/**
 * Which versions produced a price.
 *
 * A saved revision stores this, so a number can be explained years later: the
 * formulas (`engineVersion`), the imported book (`baseBookHash`), the tenant's
 * own overrides (`overrideVersion`) and the pricing policy (`policyVersion`).
 */
export interface Provenance {
  engineVersion: string;
  baseBookHash: string;
  overrideVersion: number;
  policyVersion: number;
}

/** How a material's quantity and mass are measured, and how well that is known. */
export interface MaterialEvidence {
  /** Stable identity of the line this describes. */
  lineId: string;
  /** The price-book key the line came from. */
  sourceKey: string;
  /** What the unit price is per. */
  priceBasis: 'm' | 'sqm' | 'ea' | 'pack' | 'roll';
  /** What the unit mass is per; `unknown` when the book does not say. */
  massBasis: 'm' | 'sqm' | 'ea' | 'pack' | 'roll' | 'unknown';
  status: 'supported' | 'assumed' | 'missing';
}

/** Everything a workspace needs to price, with the versions it was priced under. */
export interface PricingContext {
  lookup: PriceLookup;
  provenance: Provenance;
  policy: {
    margin: number;
    /**
     * The margin for **this building**, when the book prices families apart.
     *
     * `setting_price_coeffcient` is keyed by `structure_id` and state, and on the
     * book shipped with this build it is 1.48 everywhere except the gable carport
     * (1.69). A single `margin` cannot express that, so a context that can read
     * the book supplies this and the evaluator prefers it. Absent, `margin` is
     * used — which is what a test fixture and a book without the table get.
     */
    marginFor?: (config: ShedConfig) => number;
    currency: 'AUD';
    /**
     * How `ShedConfig.charges` are read: operator-entered selling charges that
     * already include GST, added once to the contract rather than to material
     * cost.
     */
    chargeBasis: 'selling-gst-inclusive';
    /**
     * The factory method this building is quoted under.
     *
     * Beside the margin, and for the same reason: a saved revision has to be able
     * to say which rules produced its quantities. Absent, the engine uses its
     * defaults — which is what a test fixture and a company that chose no profile
     * get.
     */
    bom?: BomPolicy;
  };
}

/** A complete, explainable estimate. */
export interface Evaluation {
  config: ShedConfig;
  bom: BomResult;
  price: QuotePrice;
  issues: EstimateIssue[];
  materials: MaterialEvidence[];
  status: EstimateStatus;
  provenance: Provenance;
  /**
   * The frame cut list, frozen with the revision.
   *
   * The desktop prints it as the Steelwork Schedule. It travels with the
   * evaluation rather than being recomputed on demand because the factory profile
   * that chose the sections can change, and a cut list that followed the new
   * profile would disagree with the order it sits beside.
   */
  members: FrameMember[];
}
