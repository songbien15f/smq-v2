/**
 * Admin (licence vendor) contracts.
 *
 * This is where the old licence *server* becomes a feature set rather than a
 * separate application: companies take the place of an `Account` row, seats take
 * the place of a hardware-key count, a published price book takes the place of the
 * `Version` / `Db` / `DbApp` triple, and the template catalogue is the same idea
 * with a cleaner data model.
 *
 * Three things the old server did that this deliberately does not:
 *
 * - **No replayable signature.** Seats were granted by POSTing
 *   `HMAC("{CompanyCode}-{Key}")` with no timestamp or nonce, so a captured request
 *   worked forever. Access here is a session.
 * - **No seat race.** The old allocation counted enabled keys and then inserted,
 *   with no transaction and no unique index, so two simultaneous logins could
 *   exceed the seat count. Allocation here happens inside a transaction against a
 *   unique constraint.
 * - **No `systemctl` endpoint.** Publishing a version is an admin action recorded
 *   in the audit log; restarting a service is a deployment concern.
 */

import { z } from 'zod';

/** A paying customer: one shed company. */
export const createCompanyRequest = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(200),
  /**
   * The business code a person types to reach this company — `VGG`, `SSA`.
   *
   * Separate from `slug`: the slug is the URL key and must stay URL-safe, while the code is what
   * appears on a quote and is read down a phone line. Stored upper-cased by the API.
   */
  code: z
    .string()
    .trim()
    .min(1, 'Enter a company code')
    .max(16, 'A company code is at most 16 characters')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
  /** A short, URL-safe identifier. Lowercase letters, digits and dashes. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Use lowercase letters, digits and dashes'),
  /** Australian Business Number, optional at creation. */
  abn: z.string().trim().max(20).optional(),
  /** Seats, i.e. how many people may hold a session at once. */
  seats: z.number().int().min(1).max(500),
  /** ISO date the subscription ends. Null means no end date. */
  subscriptionEndsAt: z.string().datetime().nullable(),
  /** The administrator's sign-in address. They set their own password. */
  adminEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  adminDisplayName: z.string().trim().min(1).max(120),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequest>;

/** A company as the admin list renders it. */
export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  /** The business code a person types at sign-in. */
  code: string | null;
  status: 'active' | 'suspended';
  seats: number;
  /** Sessions active in the last few minutes. Compared against `seats`. */
  seatsInUse: number;
  subscriptionEndsAt: string | null;
  memberCount: number;
  quoteCount: number;
  createdAt: string;
}

/** Suspend or reinstate a company. */
export const companyStatusRequest = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().max(500).optional(),
});
export type CompanyStatusRequest = z.infer<typeof companyStatusRequest>;

/** Change the seat count or the subscription end. */
export const companyLimitsRequest = z.object({
  seats: z.number().int().min(1).max(500).optional(),
  subscriptionEndsAt: z.string().datetime().nullable().optional(),
});
export type CompanyLimitsRequest = z.infer<typeof companyLimitsRequest>;

/**
 * A published price book.
 *
 * Content-addressed: publishing the same dump twice produces the same hash and
 * reuses the file, so "which book priced this quote" is answerable from the hash
 * alone. `kind` is a claim that is checked rather than trusted — a book labelled
 * `sample` that still contains supplier codes is refused.
 */
export interface PriceBookRow {
  hash: string;
  kind: 'sample' | 'licensed';
  publishedAt: string;
  publishedByEmail: string;
  active: boolean;
  tableCount: number;
  rowCount: number;
  /** Supplier codes found by scanning every column of every table. 0 for a
   *  genuinely scrambled sample. */
  supplierCodeCount: number;
  note: string | null;
}

/** Pin a company to a specific book, optionally forcing an update. */
export const pinPriceBookRequest = z.object({
  tenantId: z.string().uuid(),
  bookHash: z.string().length(64),
  /** When true, the company's next sign-in is refused until they reload prices. */
  forceUpdate: z.boolean(),
});
export type PinPriceBookRequest = z.infer<typeof pinPriceBookRequest>;

/**
 * A quote template in the cloud catalogue.
 *
 * Clone semantics are the whole feature: a template copies **structure and
 * options**, never the customer's identity, and it drops the SiteCheck building id
 * so a new quote cannot inherit another site's wind certificate.
 */
export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  typeId: string;
  typeName: string;
  status: 'draft' | 'active' | 'archived';
  /** Current file revision, and the label a customer sees. */
  versionLabel: string;
  fileSizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Publish a new file revision for an existing template. */
export const publishTemplateRequest = z.object({
  templateId: z.string().uuid(),
  versionLabel: z.string().trim().min(1).max(40),
  note: z.string().trim().max(500).optional(),
});
export type PublishTemplateRequest = z.infer<typeof publishTemplateRequest>;

/** A contact enquiry, from the end-customer site. */
export interface EnquiryRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  /** Where it came from: the site's contact form, or a quote share. */
  source: 'contact' | 'share' | 'demo';
  handled: boolean;
  createdAt: string;
}

/** One entry in the audit log. Append-only; there is no edit or delete route. */
export interface AuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  /** A short human summary, already resolved — not a raw JSON blob. */
  summary: string;
}
