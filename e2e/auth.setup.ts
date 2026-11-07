import { expect, test as setup } from '@playwright/test';

/**
 * Sign in once, and let every other flow reuse the session.
 *
 * ## Why this is a setup project rather than the first test
 *
 * A seat is claimed by a **session**, not by a person (`apps/api/scripts/release-seats.ts` says so,
 * and a five-seat company answers 403 once they are gone). Playwright gives every test its own
 * browser context, so six tests that each signed in would take six seats — the suite would fill the
 * licence by its second run and then fail with "every seat in this company is in use", which is what
 * happened on the first attempt.
 *
 * Signing in here and saving the cookies costs one seat for the whole run, and it still exercises the
 * form: this is the real three-field sign-in, not a shortcut through the API.
 */

const COMPANY = process.env.E2E_COMPANY_CODE ?? 'DEMOSHEDS';
const USERNAME = process.env.E2E_USERNAME ?? 'owner';
const PASSWORD = process.env.E2E_PASSWORD ?? 'a-long-enough-password';

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
