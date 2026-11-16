import { expect, test as setup } from '@playwright/test';

/**
 * Sign in once, and let every other flow reuse the session.
 *
 * ## Why this is a setup project rather than the first test
 *
 * A seat belongs to a **device** — one browser profile, for one user, in one company (DECISIONS D3).
 * Playwright gives every test its own browser context, and each context is a new device, so six tests
 * that each signed in would take six seats and fill a small licence. (Under the older rule the seat
 * was held by a session, which produced the same failure by a different route: the suite filled the
 * licence on its second run.) Signing in once and reusing the cookies costs one seat for the run.
 *
 * Signing in here and saving the cookies costs one seat for the whole run, and it still exercises the
 * form: this is the real three-field sign-in, not a shortcut through the API.
 */

/**
 * A tenant that exists **only** for this suite.
 *
 * These used to default to `DEMOSHEDS` / `owner`, the demo company `seed.ts` created. That stopped
 * being safe on 2026-11-10, when the demo accounts were replaced by real ones imported from ShedSafe:
 * the demo owner is no longer a ShedSafe salesman, so it is suspended and cannot sign in — and the
 * suite would be testing a login that the product now deliberately refuses.
 *
 * A suite must not depend on a tenant a person uses. `E2ESHEDS` is created by `seed.ts` with
 * `SEED_COMPANY_CODE=E2ESHEDS`, holds no real data, and can be wiped without consequence.
 */
const COMPANY = process.env.E2E_COMPANY_CODE ?? 'E2ESHEDS';
const USERNAME = process.env.E2E_USERNAME ?? 'owner';
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-long-password-2026';

/** Where the cookies are written. Git-ignored: it is a live session. */
export const STATE = 'e2e/.auth/state.json';

setup('sign in with a company code, a username and a password', async ({ page }) => {
  await page.goto('/');

  // Three fields, in the order a person reads them out: company first, because a username is only
  // unique inside one company.
  await page.locator('#companyCode').fill(COMPANY);
  await page.locator('#username').fill(USERNAME);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/quotes$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Quotes', level: 1 })).toBeVisible();

  /*
   * A refusal that is not a wrong password. A full licence answers 403 with its own sentence, and
   * reporting it as "sign-in failed" sends somebody to reset a password that is fine.
   */
  const error = page.locator('[role="alert"]');
  if (await error.count()) {
    const message = (await error.first().textContent()) ?? '';
    expect(message, `sign-in refused: ${message.trim()}`).not.toMatch(/seat/i);
  }

  await page.context().storageState({ path: STATE });
});
