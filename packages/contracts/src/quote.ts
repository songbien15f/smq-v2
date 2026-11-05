/**
 * Quote contracts: what a quote is, what saving one means, and what a saved
 * revision contains.
 *
 * The single most important idea here is that **a revision is frozen**. Saving
 * writes the config it was priced from, the bill of materials it produced and the
 * price that came out — not a pointer to a live calculation. A price-book update
 * next month must not change a figure a customer already signed.
 */

import { z } from 'zod';
import { shedConfigSchema } from '@sq/core/domain';
import { pricingInput as quotePricingInput } from './evaluation.js';

/**
 * Where a quote sits in its life.
 *
 * `draft` has never been priced. `issued` has a revision a customer has seen.
 * `accepted` / `declined` / `expired` are terminal for the sales conversation but
 * never delete the record: a decline is information.
 */
export const QUOTE_STATUSES = ['draft', 'issued', 'accepted', 'declined', 'expired', 'deleted'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** A quote in a list: enough to render a row, nothing more. */
export interface QuoteListItem {
  id: string;
  number: string;
  customerName: string;
  siteSuburb: string;
  status: QuoteStatus;
  /** Current revision number, 0 for a quote that has never been saved. */
  revision: number;
  /** Contract price in cents, as of the current revision. Null for a draft. */
  contractCents: number | null;
  /** True when any BOM line in the current revision had no real price. */
  incomplete: boolean;
  updatedAt: string;
}

/** The customer a quote is for. */
export const customerInput = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: z.string().trim().min(1, 'Enter a last name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().max(40).optional(),
  mobile: z.string().trim().max(40).optional(),
  /** The desktop's Fax field. Stored in `customer_json`; no column of its own. */
  fax: z.string().trim().max(40).optional(),
  /** Street address of the customer, as Places resolved it. */
  address: z.string().trim().min(1, 'Enter the customer address').max(300),
  suburb: z.string().trim().max(120).optional(),
  state: z.string().trim().max(10).optional(),
  postcode: z.string().trim().max(10).optional(),
});
export type CustomerInput = z.infer<typeof customerInput>;

/** The site a shed is going on. Separate from the customer on purpose: a dealer
 *  quotes one customer's new house on a different block often enough that copying
 *  the address silently would put the shed in the wrong place. */
export const siteInput = z.object({
  address: z.string().trim().min(1, 'Enter the site address').max(300),
  suburb: z.string().trim().max(120).optional(),
  state: z.string().trim().max(10).optional(),
  postcode: z.string().trim().max(10).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  deliveryScope: z.string().trim().max(200).optional(),
  /** The customer has acknowledged the delivery terms. Required, not decorative. */
  deliveryAcknowledged: z.boolean(),
});
export type SiteInput = z.infer<typeof siteInput>;

/**
 * The money the operator controls.
 *
 * Re-exported from the evaluation contract rather than declared again. The two were separate
 * copies until a real defect appeared: the evaluation accepted a contract override and the save
 * did not, so an operator could type a negotiated price, see it, press Save, and have it
 * silently replaced by the computed figure. One schema, imported twice, is what prevents that.
 */
export { pricingInput as quotePricingInput } from './evaluation.js';
export type { PricingInput as QuotePricingInput } from './evaluation.js';

/**
 * Save a quote.
 *
 * `evaluationId` is what makes Save honest: the server re-reads the evaluation it
 * issued, refuses if the config or the result changed under the operator, and
 * stores the price the operator actually saw rather than recomputing a new one.
 *
 * `idempotencyKey` makes a double-click one quote. `expectedRev` makes two tabs
 * appending after revision N a conflict on the second, instead of two quotes that
 * both claim to be revision N+1.
 */
export const saveQuoteRequest = z.object({
  /** Absent when creating; present when appending a revision to an existing quote. */
  quoteId: z.string().uuid().optional(),
  evaluationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(120),
  expectedRev: z.number().int().min(0),
  customer: customerInput,
  site: siteInput,
  config: shedConfigSchema,
  pricing: quotePricingInput,
  /** A name for this revision, e.g. "Option B — bigger door". */
  revisionName: z.string().trim().max(120).optional(),
  revisionDescription: z.string().trim().max(500).optional(),
  /**
   * A site check pinned **before** the quote existed.
   *
   * The desktop pins while Step 1 is still being filled, so the check is created without a
   * quote. The first save links it. A check belonging to another company is ignored.
   */
  siteCheckId: z.string().min(1).optional(),
});
export type SaveQuoteRequest = z.infer<typeof saveQuoteRequest>;

/** Renaming a revision: metadata only, the frozen content is never touched. */
export const revisionMetadataRequest = z.object({
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
});
export type RevisionMetadataRequest = z.infer<typeof revisionMetadataRequest>;

/** What a save returns. */
export interface SaveQuoteResult {
  quoteId: string;
  quoteNumber: string;
  revision: number;
  revisionId: string;
  contractCents: number;
  /** True when the revision was an idempotent replay of an earlier save. */
  replayed: boolean;
}

/** One revision, as a reader sees it. `bom` and `price` are the frozen values. */
export interface RevisionView {
  id: string;
  revision: number;
  name: string;
  description: string;
  /** ISO-8601. */
  createdAt: string;
  createdByEmail: string;
  engineVersion: number;
  contractCents: number;
  depositCents: number;
  progressCents: number;
  balanceCents: number;
  totalCostCents: number;
  totalMassKg: number;
  /** Count of BOM lines with no real price. Sending is refused while this is non-zero. */
  mockedLines: number;
  /** Content hash of the frozen BOM, so two revisions can be compared cheaply. */
  bomHash: string;
  priceBookHash: string;
}

/** Move a quote to another status. Kept explicit rather than a free-text field. */
export const transitionRequest = z.object({
  to: z.enum(QUOTE_STATUSES),
  note: z.string().trim().max(500).optional(),
});
export type TransitionRequest = z.infer<typeof transitionRequest>;

/** Mint a read-only link a customer can open without signing in. */
export const createShareRequest = z.object({
  revisionId: z.string().uuid(),
  /** Days until the link stops working. 1–90. */
  expiresInDays: z.number().int().min(1).max(90),
});
export type CreateShareRequest = z.infer<typeof createShareRequest>;

/** A share, as the issuing screen needs it. The token itself is returned once. */
export interface ShareView {
  id: string;
  /** The full URL to give the customer. Only ever returned at creation. */
  url: string;
  revisionId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
