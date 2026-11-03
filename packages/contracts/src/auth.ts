/**
 * Sign-in, session and membership contracts.
 *
 * The session answer carries the capabilities the caller holds, so a front-end can
 * hide what it must not show. It is **not** how the server decides — the server
 * re-checks the capability at each operation, because a client can send whatever it
 * likes in a cookie.
 */

import { z } from 'zod';
import { COMPANY_ROLES } from './roles.js';

/** A password rule set, in one place so the form and the server agree. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * A company user signing in.
 *
 * `username`, not `email`: the sign-in name is what the desktop app used, and it is the field a
 * person reads off a note taped to the office wall. Email stays on the account for mailing a
 * quote; it is simply not the key that opens the door.
 *
 * `companyCode` is optional **here** only because the schema must also describe a caller that has
 * not supplied one yet — the route refuses that with a 400. It is not optional in the client app,
 * and it can never be absent from a successful sign-in.
 */
export const signInRequest = z.object({
  companyCode: z.string().trim().max(16, 'A company code is at most 16 characters').optional(),
  username: z.string().trim().min(1, 'Enter your username').max(80),
  password: z.string().min(1, 'Enter your password'),
});
export type SignInRequest = z.infer<typeof signInRequest>;

/**
 * Licence-vendor staff signing in.
 *
 * They belong to no company, so they have no username and there is nothing to resolve a company
 * from. A separate schema rather than nullable fields on `signInRequest`: a shape that can express
 * "email instead of username" is a shape a caller can misuse, and this one keeps the two doors
 * visibly different.
 */
export const platformSignInRequest = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type PlatformSignInRequest = z.infer<typeof platformSignInRequest>;

/** The company a person belongs to, as the shell needs it. */
export interface MembershipView {
  tenantId: string;
  tenantName: string;
  role: (typeof COMPANY_ROLES)[number];
  /** The name this person signs in with inside this company. */
  username: string;
}

/**
 * Who the caller is.
 *
 * `capabilities` is derived from `role` by the server and never trusted from a
 * client. `mustChangePassword` is read live from the database on every request,
 * because a forced change that only applies at next login is a forced change that
 * can be skipped by keeping the tab open.
 */
export interface SessionView {
  userId: string;
  email: string;
  displayName: string;
  /** Companies this person may enter. Empty for platform-only staff. */
  memberships: MembershipView[];
  /**
   * The company this session is open in, and the single source of truth for it.
   *
   * A screen that needs to know "which company am I in" reads these three and nothing else. The
   * client used to read `memberships[0]`, which is a different question — "which company sorts
   * first" — and answers it wrongly the moment a person holds two memberships.
   *
   * All three are `null` for platform staff, who belong to no company.
   */
  currentTenantId: string | null;
  currentTenantCode: string | null;
  currentTenantName: string | null;
  /** Set when the caller is licence-vendor staff rather than a customer's staff. */
  platformRole: 'platform_admin' | 'platform_support' | null;
  capabilities: string[];
  mustChangePassword: boolean;
  /** Absolute expiry, ISO-8601. The client shows it; the server enforces it. */
  expiresAt: string;
}

/** Set or change a password. Used for the first sign-in and for a voluntary change. */
export const changePasswordRequest = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(200, 'That password is too long'),
    confirmPassword: z.string(),
  })
  .refine((body) => body.newPassword === body.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;

/** Invite someone into a company. */
export const inviteRequest = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(COMPANY_ROLES),
  displayName: z.string().trim().min(1, 'Enter a name').max(120),
});
export type InviteRequest = z.infer<typeof inviteRequest>;
