/**
 * Evaluation contracts — the price preview between "the browser shows a number" and "the
 * operator presses Save".
 *
 * ## Why an evaluation exists at all
 *
 * Three things can change between the moment a price appears on screen and the moment it is
 * saved: the price book can be republished, a per-company override can be edited, and the
 * browser can send a different config from the one on screen. Without a server-side evaluation,
 * all three save silently and the customer receives a figure nobody looked at.
 *
 * So the preview is **stored**: it carries the config hash and the result hash, it names the
 * price book and the override version it used, and it expires. Save re-reads it and refuses with
 * a conflict if any of those moved. The operator then sees the new number and decides again.
 */

import { z } from 'zod';
import { shedConfigSchema } from '@sq/core/domain';

/** How long a preview stays valid. Long enough to type a customer's details. */
export const EVALUATION_TTL_MS = 30 * 60 * 1000;

/**
 * The money the operator controls, in one shape used by **both** routes.
 *
 * One schema, not two. These were duplicated until a real defect appeared: the evaluation
 * accepted a contract override and the save did not, so the override validated on screen and
 * then vanished at the moment of saving — the price the operator typed was silently replaced by
 * the computed one. A single schema is what makes "the price shown is the price saved" a
 * property rather than a coincidence.
 *
 * ## The three editable figures, and why only three
 *
 * The desktop lets an operator change exactly three things on a cost screen: the contract price,
 * the deposit, and the progress payment. That is a business rule, not a UI simplification — a
 * salesperson negotiates a total, then agrees a deposit and a stage payment. Everything else
 * (material cost, margin, GST) is derived, and letting it be typed would let a quote be
 * presented at a loss without anybody deciding to.
 *
 * The balance is never typed: it is the remainder, so the three stages always sum to the
 * contract. Fifty percent of an odd number of cents would otherwise produce a −1 cent balance.
 */
export const pricingInput = z.object({
  /** Percentage uplift applied to the whole job. 0–100. */
  quoteRatePct: z.number().min(0).max(100),
  /** Deposit as a percentage of the contract. Used when `depositOverrideCents` is null. */
  depositPct: z.number().min(0).max(100),
  /** Progress payment as a percentage. Used when `progressOverrideCents` is null. */
  progressPct: z.number().min(0).max(100),
  /** Delivery, engineering and extra charges, in cents, GST-inclusive. */
  deliveryCents: z.number().int().min(0),
  engineeringCents: z.number().int().min(0),
  extraCents: z.number().int().min(0),
  /** Additions (crane hire, permits…) added once to the contract, not to material cost. */
  additionsCents: z.number().int().min(0),
  /**
   * The itemised additions, when the operator built them up line by line.
   *
   * Optional so a revision written before this field existed still parses. The engine
   * prices `additionsCents`; the lines explain where that figure came from and let the
   * screen rebuild it when the quote is reopened.
   */
  additionLines: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        taxable: z.boolean(),
        enabled: z.boolean(),
        quantity: z.number().min(0),
        unitPriceCents: z.number().int().min(0),
      }),
    )
    .optional(),

  /**
   * The operator's own contract price, or `null` to use the computed one.
   *
   * `null` rather than absent-with-a-default, because the type says which of the two states it
   * is: "the operator typed this" versus "the engine worked it out". Rendering those the same
   * way is how a screen ends up showing a computed figure as though somebody had checked it.
   */
  contractOverrideCents: z.number().int().min(0).nullable().default(null),
  /** A typed deposit. When set, the percentage is ignored for this quote. */
  depositOverrideCents: z.number().int().min(0).nullable().default(null),
  /** A typed progress payment. When set, the percentage is ignored for this quote. */
  progressOverrideCents: z.number().int().min(0).nullable().default(null),
});
export type PricingInput = z.infer<typeof pricingInput>;

/** Ask the server to price a config. */
export const evaluateRequest = z.object({
  config: shedConfigSchema,
  pricing: pricingInput,
});
export type EvaluateRequest = z.infer<typeof evaluateRequest>;

/** One BOM line, as a screen renders it. */
export interface BomLineView {
  group: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  /** Cut length in mm for a per-metre material, null for a per-piece item. */
  lengthMm: number | null;
  unitCostCents: number;
  amountCents: number;
  massKg: number;
  /** True when no price row was found: the line is a placeholder, not an offer. */
  mocked: boolean;
}

/** An issue the engine raised. `code` is stable; `message` is for a person. */
export interface IssueView {
  code: string;
  severity: 'blocker' | 'assumption' | 'warning';
  message: string;
  group?: string;
  /** True when this issue may be shown to a customer, in customer-facing words. */
  customerVisible: boolean;
}

/**
 * The price chain, every step named so a salesperson can explain the total.
 *
 * `contractCents` is GST-inclusive; GST is **extracted** from it for reporting, never added on
 * top. That is what an Australian buyer reads as "the price", and adding GST afterwards is how
 * a quote looks cheaper than the invoice.
 */
export interface PriceView {
  /**
   * Sum of the eleven material groups, excluding miscellaneous.
   *
   * Present only for a caller holding `cost:margin`. The desktop showed the internal
   * breakdown (material cost, margin, kit) to a SuperAdmin only, and an estimator can
   * call this API directly — hiding the rows in the UI without removing them here would
   * be a courtesy, not a rule.
   */
  buildingCostCents?: number;
  /** Building cost plus misc. This is what the margin is applied to. */
  totalCostCents?: number;
  margin?: number;
  /** Material cost × margin × (1 + GST). */
  kitCents?: number;
  deliveryCents: number;
  engineeringCents: number;
  extraCents: number;
  /** Kit + delivery + engineering + extra. */
  totalCents: number;
  quoteRatePct: number;
  additionsCents: number;
  /** GST-inclusive contract total. GST is extracted from this, never added. */
  contractCents: number;
  gstCents: number;
  depositCents: number;
  progressCents: number;
  balanceCents: number;
  totalMassKg: number;
  /**
   * Which of the three figures the operator typed rather than the engine computing.
   *
   * Sent so a screen can show "you set this" instead of presenting a negotiated number as a
   * derived one — and so a saved revision can explain, later, why its deposit is not 10%.
   */
  overridden: {
    contract: boolean;
    deposit: boolean;
    progress: boolean;
  };
}

/** One row of the steelwork schedule: a member, its section, its cut length and its count. */
export interface FrameMemberView {
  item: 'main_column' | 'end_column' | 'main_rafter' | 'end_rafter' | 'knee_brace';
  label: string;
  section: string;
  /** True when the book has no structure table and every member takes one assumed section. */
  assumed: boolean;
  lengthMm: number;
  quantity: number;
}

/** One punched hole, in the terms a workshop reads it. */
export interface PunchHoleView {
  /** Distance from the member's near end (bottom hole) or far end (top hole), mm. */
  positionMm: number;
  /** Distance from the previous hole in the same group, mm. */
  spacingMm: number;
  /** Which of the three screw lines this hole is punched on. */
  screwLines: number[];
}

/** One member on a punch sheet. */
export interface PunchColumnView {
  /** `C1`, `R1`, `C2`, `R2` — the desktop's mark for the member. */
  mark: string;
  titleTop: string;
  titleBottom: string;
  section: string;
  quantity: number;
  lengthMm: number;
  holeSize: string;
  centreMm: number;
  top: PunchHoleView[];
  bottom: PunchHoleView[];
  remainingMm: number;
}

/** One sheet: the two members that meet at a connection. */
export interface PunchPageView {
  left: PunchColumnView | null;
  right: PunchColumnView | null;
}

/** The answer to a preview request. */
export interface EvaluationView {
  evaluationId: string;
  /**
   * Hash of the **priced inputs**: the normalised config *and* the operator pricing.
   *
   * Named for the config because that is what it started as, and hashing only the building was a
   * real hole — an operator could preview, re-negotiate the total, and save, because the config
   * had not moved. Save compares this and refuses on a mismatch.
   */
  configHash: string;
  /** Hash of the priced result. Save compares this and refuses on a mismatch. */
  resultHash: string;
  status: 'blocked' | 'indicative' | 'priced';
  price: PriceView;
  lines: BomLineView[];
  /**
   * The frame cut list, when the caller may see the factory's design.
   *
   * Empty for a role without `cost:read`: the section sizes are the supplier's engineering, and a
   * viewer reads the quote, not how it is framed. The saved revision keeps the full list either
   * way, so the workshop can still build what was sold.
   */
  members: FrameMemberView[];
  /**
   * The punching sheets, when the caller may see the factory's design.
   *
   * Empty for a role without `cost:read`, and also empty when the price book cannot
   * name the connectors for this building's sections — a sheet that is not printed
   * rather than one with guessed hole positions.
   */
  punchings: PunchPageView[];
  issues: IssueView[];
  /** Content hash of the price book used. A republish invalidates the preview. */
  priceBookHash: string;
  /** Version of the per-company price overrides used. */
  overrideVersion: number;
  /** Engine version that produced this result, so a revision can name it. */
  engineVersion: number;
  expiresAt: string;
}
