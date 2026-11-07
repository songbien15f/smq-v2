import { expect, test as teardown } from '@playwright/test';

/**
 * Sign out at the end of the run, so the suite costs no seat.
 *
 * A seat is claimed by a session and a five-seat company answers 403 once they are gone — so a smoke
 * suite that signs in and walks away fills the licence in a handful of runs, and then fails with a
 * message about seats rather than about the product. Signing out is not tidiness; it is what makes
 * the suite repeatable on a licence with room for the people using it.
 *
 * The signed-out state is asserted, not assumed: a teardown that silently failed would leave the
 * seat behind and the next run would report a licence problem.
 */

teardown('sign out and release the seat', async ({ page }) => {
  await page.goto('/quotes');
  await page.getByRole('button', { name: /sign out/i }).click();

  // Back at the sign-in screen: the session is gone, so its seat is free.
  await expect(page.locator('#companyCode')).toBeVisible({ timeout: 20_000 });
});
