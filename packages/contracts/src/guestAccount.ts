import { z } from 'zod';
import { guestContactSchema, guestDesignSchema, guestSourceSchema, type GuestDesign } from './guest.js';

/**
 * Optional Guest accounts (spec docs/specs/guest-accounts.md): email + password, a profile that
 * fills step ①, the requests sent while signed in, and drafts saved on the server.
 */

/** 8 to 200: long enough to mean something, short enough that scrypt is not handed a novel. */
export const guestPasswordSchema = z.string().min(8, 'Use at least 8 characters').max(200);

export const guestSignUpSchema = guestContactSchema
  .extend({ password: guestPasswordSchema })
  .strict();
export type GuestSignUp = z.infer<typeof guestSignUpSchema>;

export const guestSignInSchema = z
  .object({
    email: z.string().trim().max(254),
    password: z.string().max(200),
  })
  .strict();
export type GuestSignIn = z.infer<typeof guestSignInSchema>;

/** Email is read-only in v1, so the profile edit carries the other three fields. */
export const guestProfilePatchSchema = guestContactSchema.omit({ email: true }).strict();
export type GuestProfilePatch = z.infer<typeof guestProfilePatchSchema>;

export const guestPasswordChangeSchema = z
  .object({ current: z.string().max(200), next: guestPasswordSchema })
  .strict();
export type GuestPasswordChange = z.infer<typeof guestPasswordChangeSchema>;

export interface GuestProfileView {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  createdAt: string;
}

export const GUEST_DRAFT_STEPS = ['start', 'design', 'send'] as const;
export type GuestDraftStep = (typeof GUEST_DRAFT_STEPS)[number];

/** The same fields the page keeps in localStorage — never a contact detail. */
export const guestDraftWriteSchema = z
  .object({
    design: guestDesignSchema,
    step: z.enum(GUEST_DRAFT_STEPS),
    source: guestSourceSchema.optional(),
    revisionOf: z.string().max(20).nullable().optional(),
  })
  .strict();
export type GuestDraftWrite = z.infer<typeof guestDraftWriteSchema>;

export interface GuestDraftView {
  id: string;
  design: GuestDesign;
  step: GuestDraftStep;
  source: z.infer<typeof guestSourceSchema> | null;
  revisionOf: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuestDraftsResponse {
  items: GuestDraftView[];
}

/** What the guest sees of a request's status: the estimator's own states stay internal. */
export type GuestRequestPublicStatus = 'received' | 'being_quoted' | 'closed';

export interface GuestAccountRequestView {
  number: string;
  status: GuestRequestPublicStatus;
  design: GuestDesign;
  createdAt: string;
}

export interface GuestAccountRequestsResponse {
  items: GuestAccountRequestView[];
}

/** A draft id is the page's own uuid. */
export const GUEST_DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
