import { describe, it, expect } from 'vitest';
import {
  companyCan,
  platformCan,
  capabilitiesFor,
  COMPANY_ROLES,
  CAPABILITIES,
  isCompanyRole,
  isPlatformRole,
} from '@/roles';

/**
 * The policy table is the only thing standing between a viewer and the margin, so
 * it is pinned here rather than reviewed by eye.
 *
 * These tests state intentions, not implementation: "a viewer reads a quote and
 * nothing else" is a business sentence. If a future change adds `cost:read` to
 * `viewer`, the failure names the sentence that was broken.
 */
describe('the company permission policy', () => {
  it('gives a viewer the quote and nothing else', () => {
    expect(capabilitiesFor('viewer')).toEqual(['quote:read']);
  });

  it('never lets a viewer see cost or margin', () => {
    expect(companyCan('viewer', 'cost:read')).toBe(false);
    expect(companyCan('viewer', 'quote:write')).toBe(false);
    expect(companyCan('viewer', 'price:manage')).toBe(false);
  });

  it('lets an estimator price and send, but not manage people or the company', () => {
    expect(companyCan('estimator', 'quote:write')).toBe(true);
    expect(companyCan('estimator', 'cost:read')).toBe(true);
    expect(companyCan('estimator', 'price:manage')).toBe(true);
    expect(companyCan('estimator', 'members:manage')).toBe(false);
    expect(companyCan('estimator', 'settings:manage')).toBe(false);
  });

  it('lets a company admin do everything a company may do, and nothing platform-level', () => {
    for (const capability of CAPABILITIES.filter((c) => !c.startsWith('platform:'))) {
      expect(companyCan('company_admin', capability)).toBe(true);
    }
    for (const capability of CAPABILITIES.filter((c) => c.startsWith('platform:'))) {
      expect(companyCan('company_admin', capability)).toBe(false);
    }
  });
});

describe('the platform permission policy', () => {
  it('does not let support staff publish a price book or a version', () => {
    // A support call is not the place to change every customer's numbers at once.
    expect(platformCan('platform_support', 'platform:pricebooks')).toBe(false);
    expect(platformCan('platform_support', 'platform:versions')).toBe(false);
  });

  it('lets a platform admin publish', () => {
    expect(platformCan('platform_admin', 'platform:pricebooks')).toBe(true);
    expect(platformCan('platform_admin', 'platform:versions')).toBe(true);
  });

  it('never grants a platform role a company capability, or the reverse', () => {
    // The two role families are separate axes: being licence-vendor staff says
    // nothing about which customer's quotes a person may read.
    for (const capability of CAPABILITIES.filter((c) => c.startsWith('platform:'))) {
      for (const role of COMPANY_ROLES) {
        expect(companyCan(role, capability)).toBe(false);
      }
    }
  });
});

describe('role guards', () => {
  it('accepts a known role and refuses anything else', () => {
    expect(isCompanyRole('estimator')).toBe(true);
    expect(isCompanyRole('admin')).toBe(false);
    expect(isCompanyRole(undefined)).toBe(false);
    expect(isPlatformRole('platform_admin')).toBe(true);
    expect(isPlatformRole('company_admin')).toBe(false);
  });
});
