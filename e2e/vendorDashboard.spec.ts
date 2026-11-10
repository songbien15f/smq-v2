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

    // The four tables this page exists for.
    await expect(page.getByRole('heading', { name: 'What is happening' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Which screens are opened' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Visits/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Who came/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /activity log/ })).toBeVisible();

    /*
     * A visit expands into what was done, and its address reveals on a click.
     *
     * Both are client state, and both were verified by hand before this test existed — which is exactly
     * why they need a test: a client component that stops hydrating renders the same markup and does
     * nothing when clicked, and nothing in the HTML looks wrong.
     */
    const visits = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Visits/ }) });
    /*
     * Addressed by `aria-expanded` once it has flipped, **not** by the label.
     *
     * The button's accessible name changes with its state ("Show what was done…" → "Hide what was
     * done…"), so a locator built from the opening label stops matching the moment it is pressed and
     * resolves to nothing — which reads as "the expand did not work". The row's own button is the
     * stable thing: the one in the Visits section that carries `aria-expanded`.
     */
    /*
     * Scoped to the history button by its `aria-label`, **not** `tbody button[aria-expanded]`.
     *
     * The address button carries `aria-expanded` too (it reveals the last four characters), and it sits
     * in the same row — so a bare `[aria-expanded]` matched the address cell first and the test pressed
     * the wrong control. The label is stable in *kind* even though it flips between Show and Hide, so
     * the pattern matches both states.
     */
    const expand = visits.locator('tbody button[aria-label*="what was done in the visit"]').first();
    if ((await expand.count()) > 0) {
      await expect(visits.locator('ol')).toHaveCount(0);
      await expand.click();
      // The history list appears, with at least one dated action.
      await expect(visits.locator('ol').first()).toBeVisible({ timeout: 10_000 });
      await expect(visits.locator('ol li').first()).toContainText(/\d{2}:\d{2}:\d{2}/);
      await expect(expand).toHaveAttribute('aria-expanded', 'true');
    }

    /*
     * The address: masked until clicked, then the whole value.
     *
     * Addressed by **class**, because both of its other handles change on click: the `title` moves from
     * "Show the whole address" to "Hide the last four characters" (so `[title*="address"]` stops
     * matching the moment it is pressed — which is what made this test report a working control as
     * broken), and the label is the text itself. `font-mono` is the one thing that does not move.
     *
     * The bullets are asserted rather than compared as a string: the masked form is `203.0.1••••` for a
     * long address and `••••••` for the loopback, and the test should not encode which.
     */
    const address = visits.locator('td button.font-mono').first();
    if ((await address.count()) > 0) {
      /*
       * Two shapes, both correct: a real address is masked (`203.0.113.•••`) and a short one — the
       * loopback `::1`, which is what a test run from this machine records — is shown in full, because
       * hiding four characters of three leaves a row of bullets and no information. The assertion
       * therefore checks the *reveal*, not the presence of bullets: whatever the collapsed text is, the
       * click must change it and expand the control.
       */
      const collapsed = (await address.textContent()) ?? '';
      await address.click();
      await expect(address).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
      // The title flips from "Show the whole address" to "Hide the last four characters".
      await expect(address).toHaveAttribute('title', /Hide/);
      if (collapsed.includes('•')) {
        await expect(address).not.toContainText('•', { timeout: 10_000 });
      }
    }

    /*
     * The log has an **actor** on the newest page view, because that is the question the operator
     * asked: not a total, but who. This page was opened by a signed-in person a moment ago, so the
     * newest row must name them — if the actor is not wired into `recordUsage`, every row reads "—".
     */
    const activity = page.locator('section').filter({ hasText: 'activity log' });
    await expect(activity.locator('tbody tr').first()).toContainText(/@/, { timeout: 20_000 });

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

    /*
     * The page is worked through with real figures, so the assertions are the figures: a heading per
     * stage, the four diagrams, and the numbers a newcomer has to be able to find.
     */
    for (const heading of [
      /The whole pipeline, in one picture/,
      /Where the data comes from/,
      /One steel member/,
      /That revision, line by line/,
      /The price chain, with the real figures/,
      /The wind code/,
      /What the quote honestly does not know/,
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }

    // Four diagrams, each with an accessible name — an SVG with no label is invisible to a screen reader.
    const diagrams = page.locator('svg[role="img"]');
    await expect(diagrams).toHaveCount(4);
    for (const index of [0, 1, 2, 3]) {
      await expect(diagrams.nth(index)).toHaveAttribute('aria-label', /.{20,}/);
    }

    // The facts the page exists to convey.
    await expect(page.getByText(/31 553/).first()).toBeVisible();
    await expect(page.getByText(/8,185\.68/).first()).toBeVisible();
    await expect(page.getByText(/13,326\.29/).first()).toBeVisible();
    await expect(page.getByText(/GIRT_PRICE_FROM_PURLIN/)).toBeVisible();
  });
});
