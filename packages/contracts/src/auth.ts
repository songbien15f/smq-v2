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

/** Sign in. The email is normalised (trimmed, lowercased) server-side. */
export const signInRequest = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type SignInRequest = z.infer<typeof signInRequest>;

/** The company a person belongs to, as the shell needs it. */
export interface MembershipView {
  tenantId: string;
  tenantName: string;
  role: (typeof COMPANY_ROLES)[number];
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
