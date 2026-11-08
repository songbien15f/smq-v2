import { expect, test as teardown } from '@playwright/test';

/**
 * End of run: sign out, so the suite costs no seat.
 *
 * ## Why nothing is deleted any more
 *
 * This used to soft-delete the quote the create flow made, one per run. That looked tidy and was a
 * leak: a **revision** cannot be deleted — the append-only trigger refuses, by design, and it is
 * right to — so every run left a quote row plus its revision behind as `deleted`. By 2026-11-08 the
 * demo company carried **21 deleted `E2E Smoke` quotes**, all of them visible in the Deleted chip and
 * enough to move the counts on the list.
 *
 * The smoke suite now **reuses one quote** instead of creating a new one per run (`smoke.spec.ts`
 * flow 1 finds it or creates it once), so there is nothing to clean up: the database ends every run
 * the way it started it, and no delete path is needed for a record the product deliberately keeps.
 *
 * A seat belongs to a **session**, not a person: five seats and six tests was six seats, and the
 * suite blocked itself on the second run. Signing out is what makes it repeatable.
 */

teardown('sign out and release the seat', async ({ page }) => {
  await page.goto('/quotes');
  await page.getByRole('button', { name: /sign out/i }).click();

  // Back at the sign-in screen: the session is gone, so its seat is free.
  await expect(page.locator('#companyCode')).toBeVisible({ timeout: 20_000 });
});
