import { expect, test as teardown } from '@playwright/test';

/**
 * End of run: delete the test's own quote, then sign out.
 *
 * ## Why the quote is deleted
 *
 * The suite creates one quote every run and every earlier run left it behind: by 2026-11-08 the demo
 * company's list carried six `E2E Smoke` rows among real ones, and its "On the books" figure included
 * their contract value. A test that changes the data a person reads is a test that has to put it back.
 *
 * **Soft delete, through the API, exactly as the app does it.** The revision keeps the record of what
 * was sent — that is the product's rule and this file has no business breaking it — and the row leaves
 * the working list, which is what "back to how it was found" means here.
 *
 * Only quotes the *test* created are touched: matched on the customer first name the create flow writes
 * (`E2E`), so a real quote a person typed can never be caught by this.
 */

const TEST_CUSTOMER = 'E2E';

teardown('delete the test quote, then sign out and release the seat', async ({ page }) => {
  await page.goto('/quotes');

  /*
   * Find the quotes this suite made and delete each one through the same endpoint the Delete button
   * uses. The list is read from the bridge rather than scraped: the row markup carries a `deleted`
   * status once removed, and parsing a table to decide what to delete is how a teardown deletes the
   * wrong thing.
   */
  const cleaned = await page.evaluate(async (customer) => {
    const listResponse = await fetch('/api/sq/quotes?limit=50');
    if (!listResponse.ok) return { deleted: 0, reason: `list answered ${listResponse.status}` };
    const body = (await listResponse.json()) as {
      data?: { items?: { id: string; customerName?: string | null; status: string }[] };
    };
    const items = body.data?.items ?? [];
    const mine = items.filter(
      (item) => item.status !== 'deleted' && (item.customerName ?? '').trim().startsWith(customer),
    );

    let deleted = 0;
    for (const item of mine) {
      const response = await fetch(`/api/sq/quotes/${item.id}`, { method: 'DELETE' });
      if (response.ok) deleted += 1;
    }
    return { deleted, found: mine.length };
  }, TEST_CUSTOMER);

  // Reported rather than asserted: a quote left behind is untidy, and failing here would hide the
  // result of the flows that already ran. The number is what a reader needs to know it happened.
  if (cleaned.deleted > 0) {
    console.log(`e2e teardown: soft-deleted ${cleaned.deleted} test quote(s)`);
  }

  /*
   * Then sign out, so the run costs no seat. A seat belongs to a session and a five-seat company
   * answers 403 once they are gone — a suite that signs in and walks away fills the licence in a
   * handful of runs, and then fails with a message about seats rather than about the product.
   */
  await page.goto('/quotes');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.locator('#companyCode')).toBeVisible({ timeout: 20_000 });
});
