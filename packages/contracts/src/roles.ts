/**
 * Roles and capabilities — the one table that decides who may do what.
 *
 * This file is the **only** definition of the policy. The API imports it to
 * refuse an operation; the front-ends import it to hide a control. Two copies
 * would drift, and the drift always resolves the same way: the UI hides a button
 * that the server still allows.
 *
 * Two rules are load-bearing:
 *
 * 1. **A role is never checked in the UI.** Hiding a button is a courtesy. The
 *    server checks the capability at the operation, because every hidden control
 *    is still one URL away.
 * 2. **A company name is not a credential.** Nothing about entering a workspace
 *    grants administration; administration arrives only by an explicit grant.
 */

/** What a person is inside one company. */
export const COMPANY_ROLES = ['company_admin', 'estimator', 'viewer'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** What a person is across the whole platform (the licence vendor's own staff). */
export const PLATFORM_ROLES = ['platform_admin', 'platform_support'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Every capability the product checks.
 *
 * Deliberately fine-grained: `cost:read` is separate from `quote:read` because a
 * viewer reads a quote without seeing the margin, and `price:manage` is separate
 * from `settings:manage` because an estimator may re-price without being able to
 * change who is on the team.
 */
export const CAPABILITIES = [
  'quote:read',
  'quote:write',
  'quote:send',
  'cost:read',
  /*
   * The internal cost breakdown: material cost, the margin multiplier, the kit price
   * and the additions. The desktop showed these to a SuperAdmin only — an estimator
   * quotes from the sell price, not from what the company paid.
   */
  'cost:margin',
  'price:manage',
  'members:manage',
  'settings:manage',
  'usage:read',
  'platform:companies',
  'platform:seats',
  'platform:versions',
  'platform:templates',
  'platform:pricebooks',
  'platform:enquiries',
  'platform:audit',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A company role's capabilities. Anything absent is refused. */
const COMPANY_POLICY: Record<CompanyRole, readonly Capability[]> = {
  company_admin: [
    'quote:read',
    'quote:write',
    'quote:send',
    'cost:read',
    'cost:margin',
    'price:manage',
    'members:manage',
    'settings:manage',
    'usage:read',
  ],
  // An estimator prices and sends. They do not manage people or the company
  // profile — that is the difference between an employee and the owner.
  estimator: ['quote:read', 'quote:write', 'quote:send', 'cost:read', 'price:manage'],
  // A viewer reads quotes and nothing else: no cost, no margin, no internal BOM.
  viewer: ['quote:read'],
};

/**
 * A platform role's capabilities.
 *
 * `platform_support` deliberately cannot publish a price book or a version: those
 * change every customer's numbers at once, and a support call is not the place to
 * make that decision.
 */
const PLATFORM_POLICY: Record<PlatformRole, readonly Capability[]> = {
  platform_admin: [
    'platform:companies',
    'platform:seats',
    'platform:versions',
    'platform:templates',
    'platform:pricebooks',
    'platform:enquiries',
    'platform:audit',
  ],
  platform_support: ['platform:companies', 'platform:enquiries', 'platform:audit'],
};

/** True when a company role may perform `capability`. */
export function companyCan(role: CompanyRole, capability: Capability): boolean {
  return COMPANY_POLICY[role].includes(capability);
}

/** True when a platform role may perform `capability`. */
export function platformCan(role: PlatformRole, capability: Capability): boolean {
  return PLATFORM_POLICY[role].includes(capability);
}

/** Every capability a company role holds. Useful for building a client's UI. */
export function capabilitiesFor(role: CompanyRole): readonly Capability[] {
  return COMPANY_POLICY[role];
}

/** Every capability a platform role holds. */
export function platformCapabilitiesFor(role: PlatformRole): readonly Capability[] {
  return PLATFORM_POLICY[role];
}

/** Narrowing guard for a value that arrived from a cookie or a request body. */
export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === 'string' && (COMPANY_ROLES as readonly string[]).includes(value);
}

/** Narrowing guard for a platform role. */
export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}
