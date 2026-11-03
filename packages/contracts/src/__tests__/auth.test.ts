import { describe, it, expect } from 'vitest';
import { platformSignInRequest, signInRequest } from '../auth';

/**
 * The sign-in contract.
 *
 * A company user signs in with a username, not an email — that is the desktop behaviour this
 * replaces, and it is why `email` is absent from `signInRequest`. Platform staff have no company
 * and therefore no username, so they get their own schema rather than a nullable field on this one.
 */

describe('signInRequest', () => {
  it('requires a username and a password', () => {
    expect(signInRequest.safeParse({ username: 'jo', password: 'x' }).success).toBe(true);
  });

  it('accepts a company code when one is supplied', () => {
    const parsed = signInRequest.safeParse({ companyCode: 'vgg', username: 'jo', password: 'x' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.companyCode).toBe('vgg');
  });

  it('does not accept an email in place of a username', () => {
    // The sign-in key is the username. Accepting an email here would let a caller past the
    // company-first lookup, which is the whole mechanism that keeps two `jo`s apart.
    expect(signInRequest.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(false);
  });

  it('refuses a blank username', () => {
    expect(signInRequest.safeParse({ username: '   ', password: 'x' }).success).toBe(false);
  });

  it('refuses a company code longer than the column it lands in', () => {
    expect(signInRequest.safeParse({ companyCode: 'X'.repeat(17), username: 'jo', password: 'x' }).success).toBe(false);
  });
});

describe('platformSignInRequest', () => {
  it('signs vendor staff in by email, because they belong to no company', () => {
    expect(platformSignInRequest.safeParse({ email: 'ops@vendor.test', password: 'x' }).success).toBe(true);
  });

  it('still requires a real email address', () => {
    expect(platformSignInRequest.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});
