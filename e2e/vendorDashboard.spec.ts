import { expect, test } from '@playwright/test';

/**
 * The vendor dashboard's door, in a browser.
 *
 * ## What only a browser can check
 *
 * The API test proves the route refuses a wrong key. It cannot see the thing this file exists for:
 * **the cookie**. A `Set-Cookie` that is dropped (a `secure` flag on plain HTTP), a redirect that loops,
 * or a guard that reads the cookie but never issues it — all of those pass an API test and leave a
 * person staring at a login form that does not work.
 *
 * ## The password comes from the environment
 *
 * `VENDOR_DASHBOARD_PASSWORD` is set in both processes; this file reads the same variable. Absent, the
 * suite skips by name rather than testing a login nobody can perform.
 */

const PASSWORD = process.env.VENDOR_DASHBOARD_PASSWORD ?? '';

test.describe('vendor dashboard', () => {
  test.skip(PASSWORD === '', 'needs VENDOR_DASHBOARD_PASSWORD in the environment (both processes)');

  test('refuses a wrong password and stays on the form', async ({ page }) => {
    await page.goto('/dashboard/login');
    await expect(page.locator('#companyCode')).toHaveCount(0); // not the product's sign-in
    await expect(page.getByRole('heading', { name: 'Usage dashboard', level: 1 })).toBeVisible();

    await page.locator('#vendor-password').fill('definitely-not-it');
    await page.getByRole('button', { name: /Open the dashboard/ }).click();

    /*
     * Scoped to the message, not `getByRole('alert')`.
     *
     * Next injects its own `role="alert"` route announcer (`__next-route-announcer__`), so the bare
     * role matches two elements and the assertion fails on the empty one. The announcer is framework
     * furniture, not something this test is about.
     */
    await expect(page.getByText('That password is not right.')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/login$/);
  });

  test('signs in, reads the figures, and signs out', async ({ page }) => {
    await page.goto('/dashboard/login');
    await page.locator('#vendor-password').fill(PASSWORD);
    await page.getByRole('button', { name: /Open the dashboard/ }).click();

    // The cookie was issued and the guard accepted it — this is the assertion an API test cannot make.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Usage dashboard', level: 1 })).toBeVisible();

    // The two tables this page exists for.
    await expect(page.getByRole('heading', { name: 'What is happening' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Which screens are opened' })).toBeVisible();

    /*
     * No identifier survives into a route label.
     *
     * The first version substituted identifiers while rendering, so three quotes' editors appeared as
     * three rows all reading `/quotes/:id/edit`. Grouping happens in the API now, and this asserts the
     * visible result: a label is a route, and a route has no hex id in it.
     */
    const labels = await page.locator('section:nth-of-type(2) tbody tr td:first-child').allTextContents();
    expect(labels.every((label) => !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(label))).toBe(true);

    // Sign out clears the cookie: the guard sends the next visit back to the form.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/dashboard\/login$/, { timeout: 20_000 });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard\/login$/, { timeout: 20_000 });
  });

  test('shows how pricing works, without a chart library', async ({ page }) => {
    await page.goto('/dashboard/login');
    await page.locator('#vendor-password').fill(PASSWORD);
    await page.getByRole('button', { name: /Open the dashboard/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    await page.getByRole('link', { name: /How pricing works/ }).click();
    await expect(page.getByRole('heading', { name: 'How a quote becomes a price', level: 1 })).toBeVisible();

    // The four sections, and the two facts a reader must be able to find.
    for (const heading of ['① The ten steps', '② The formulas', '③ Where the data comes from', '④ An assumption is not an error']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await expect(page.getByText(/contract = round\(total × \(1 \+ quoteRate%\)\)/)).toBeVisible();
    await expect(page.getByText(/GIRT_PRICE_FROM_PURLIN/)).toBeVisible();
  });
});
