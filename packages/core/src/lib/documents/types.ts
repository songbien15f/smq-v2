/**
 * What a document is built from: a **frozen** revision, as plain data.
 *
 * ## Why this shape exists rather than reading the database
 *
 * `@sq/core` may not import the database, the API or the contracts package — the contracts package
 * already imports core, so the other direction is a cycle. So the document layer takes a plain
 * object and the API assembles it from a row. That keeps two useful properties: the renderer can be
 * tested without a database, and the same function serves the download, the email attachment and
 * the customer's share link.
 *
 * ## Why every field is required here, when the row may be missing it
 *
 * A revision is a frozen snapshot, and snapshots age: a quote saved before the company had an ABN
 * has no `abn` in its `company_json`. The **projection** is where that is tolerated (it prints
 * blank), not this type. A document layer that accepted `undefined` everywhere would push the same
 * decision into every renderer.
 */

import type { ShedConfig } from '@/domain/types';

/** The money, as frozen in the revision. GST is inside the contract, never added to it. */
export interface FrozenPrice {
  contractCents: number;
  gstCents: number;
  depositCents: number;
  progressCents: number;
  balanceCents: number;
  depositPct: number;
  progressPct: number;
}

/** One issue the engine raised, as stored. */
export interface FrozenIssue {
  code: string;
  severity: 'blocker' | 'assumption' | 'warning';
  message: string;
}

/** The company as it stood when the revision was saved. */
export interface FrozenCompany {
  name: string;
  abn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** What to print where a logo would go, when no image is configured. */
  logoText: string;
  terms: string[];
  /**
   * The company's scope notes.
   *
   * `null` for a revision saved before this field existed, which is legitimate history and must
   * still render — see `projection.ts`.
   */
  assumptions: { title: string; body: string }[] | null;
}

/** The customer as they stood when the revision was saved. */
export interface FrozenCustomer {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  deliveryAddress: string | null;
}

/** A saved revision, complete enough to render a customer document. */
export interface FrozenRevision {
  quoteNumber: string;
  revision: number;
  /** ISO-8601. */
  createdAt: string;
  /** ISO date the quote stops being an offer. */
  validUntil: string;
  config: ShedConfig;
  price: FrozenPrice;
  issues: FrozenIssue[];
  company: FrozenCompany;
  customer: FrozenCustomer;
}
