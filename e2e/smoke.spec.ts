import { expect, test, type Page } from '@playwright/test';

/**
 * Six flows, end to end, against the **running** app.
 *
 * These are not unit tests with a browser attached: each one crosses the layers a person crosses —
 * screen, same-origin bridge, API, database — and asserts what the person sees. That crossing is
 * exactly where the three defects of 2026-11-07 lived, and none of them was reachable from a
 * component test with mocked dependencies.
 *
 * The suite needs `pnpm dev` running (client 3061, API 3060). Credentials come from the documented
 * dev account (`docs/TEST-ACCESS.md`) and can be overridden:
 *
 *     E2E_COMPANY_CODE / E2E_USERNAME / E2E_PASSWORD / E2E_BASE_URL
 *
 * **It writes to the dev database.** Each run adds one quote named "E2E Smoke" and one settings
 * version. Both are deliberate: a smoke test that writes nothing cannot prove a save works.
 */

/**
 * Every flow starts on the quote list.
 *
 * The session travels in `storageState`, so this is a signed-in page — but a test's context opens on
 * `about:blank`, and a flow that assumed it was already on `/quotes` waited a full minute for a link
 * that could not exist yet. One navigation, stated once.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/quotes');
  await expect(page.getByRole('heading', { name: 'Quotes', level: 1 })).toBeVisible({ timeout: 30_000 });
});

/** The quote editor's own record of whether it would warn on the way out. */
async function dirtyState(page: Page): Promise<{ any: boolean; building: boolean }> {
  const root = page.locator('[data-dirty]');
  return {
    any: (await root.getAttribute('data-dirty')) === 'true',
    building: (await root.getAttribute('data-dirty-building')) === 'true',
  };
}

test('1 — create a quote, see a price, save it, and stay on it', async ({ page }) => {
  await page.getByRole('link', { name: 'New quote' }).click();
  await expect(page).toHaveURL(/\/quotes\/new$/);

  /*
   * Wait for the first price before touching the form.
   *
   * The editor prices the default building on mount, and when that evaluation lands React re-renders
   * the details panel. A field filled into the *first* render could be replaced by the value the
   * evaluation's render carried, so the flow ran with `firstName` empty and lost 60 s to a save gate
   * that was right to refuse. (Seen once in four runs — the kind of failure that reads as a product
   * bug and is not.)
   */
  await expect(page.getByRole('heading', { name: 'Contract price' }).first()).toBeVisible({ timeout: 40_000 });

  // Step 1: enough of a customer for the save gate.
  await page.locator('#customer-firstName').fill('E2E');
  await page.locator('#customer-lastName').fill('Smoke');
  await page.locator('#customer-email').fill('e2e.smoke@example.com');
  await page.locator('#customer-address').fill('1 Test Street');

  // Filled, not just typed: `fill` sets the value in one event, and the assertion is what breaks the
  // "the form looks done but a field is empty" failure before it reaches the save gate.
  await expect(page.locator('#customer-firstName')).toHaveValue('E2E');

  // The site address has its own block; "Copy from customer" is the button the desktop had.
  await page.getByRole('button', { name: 'Copy from customer' }).click();

  /*
   * The delivery acknowledgement lives inside the collapsed **Delivery** block — the heading itself
   * reports "1 item needs attention", which is how a person finds it. Required, not decorative: the
   * screen refuses to move on without it, and the desktop's own "I understand" tick was kept because
   * delivery terms are where a shed dispute starts.
   */
  await page.getByRole('button', { name: /^Delivery/ }).click();
  await page.locator('#site-deliveryAcknowledged').check();

  /*
   * A price appears without pressing anything — the screen's whole premise. Scoped to the panel, not
   * the page: the price renders in **two** places now (the third column above `xl`, the pinned strip
   * below it) and only one is displayed at any width, so a page-wide `.first()` matched the hidden one
   * and failed on a screen showing the price correctly.
   */
  await expect(
    page.locator('aside[aria-label="Price"]').getByText(/\$[\d,]+\.\d\d/).first(),
  ).toBeVisible();

  /*
   * The save lives on step 3, and the two buttons before it are **navigation** — a distinction the
   * screen makes in words because "Save & next" once cost an operator the whole feature. So the flow
   * walks the steps, and each "Next" is gated on the validation issues being clear.
   */
  await page.getByRole('button', { name: 'Next: the plan' }).click();
  await expect(page.getByRole('button', { name: 'Next: cost' })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Next: cost' }).click();

  typeButton: {
    await page.getByRole('button', { name: 'Save quote' }).click();
  }

  /*
   * The address bar must move to the saved quote. This is the defect of 2026-11-06: the save
   * worked, the URL stayed `/quotes/new`, and an F5 then showed a blank form — "it did not save".
   */
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
});

test('2 — reopen a saved quote: three steps, the customer, and the plan', async ({ page }) => {

  /*
   * The quote created above is the newest. The whole row is the link — its accessible name is
   * "Open Q-2026-0016 for E2E Smoke", not a generic "Open quote", so the row is where the search
   * starts and the single link inside it is the target.
   */
  const firstRow = page.getByRole('row').filter({ hasText: 'E2E Smoke' }).first();
  await firstRow.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);

  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);

  // The customer survived the round trip.
  await expect(page.locator('#customer-firstName')).toHaveValue('E2E');
  await expect(page.locator('#customer-email')).toHaveValue('e2e.smoke@example.com');



  // The plan is drawn — the defect of "2D/3D không hiện" was a canvas of 300×150.
  const plan = page.getByRole('img', { name: /Plan of a/i });
  await expect(plan).toBeVisible();

  /*
   * And the fresh page is **not** "dirty": the guard used to fire here, on a page nobody had
   * touched, which taught an operator to click through the one warning that protects their work.
   */
  const state = await dirtyState(page);
  expect(state.building, 'building is dirty on a freshly opened quote').toBe(false);
  expect(state.any, 'draft is dirty on a freshly opened quote').toBe(false);
});

test('3 — save company settings', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Company settings', level: 1 })).toBeVisible();

  // The freight minimums block exists and is editable.
  const minimum = page.getByLabel('Distributor minimum in dollars');
  await expect(minimum).toBeVisible();
  await minimum.fill('300');

  await page.getByRole('button', { name: 'Save settings' }).click();

  /*
   * A version number, not just a green tick. This flow existed to catch the defect of 2026-11-07:
   * the form posted back a `version` key the schema refuses, every save answered 422 "Unrecognized
   * key: version" pinned to `(root)`, and the screen said "some fields need attention" while
   * highlighting nothing at all.
   */
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible({ timeout: 20_000 });

  // Put the company back the way it was, so the suite leaves no invented figure behind.
  await minimum.fill('0');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/Saved as version \d+/)).toBeVisible({ timeout: 20_000 });
});

test('4 — the send dialog asks for a mode, and posts it (intercepted, no mail)', async ({ page }) => {

  const firstRow = page.getByRole('row').filter({ hasText: 'E2E Smoke' }).first();
  await firstRow.getByRole('link').first().click();

  /*
   * The send is intercepted: a smoke test must not email a real address, and the subject under test
   * is the dialog's contract — four modes, one POST, the mode inside the body.
   */
  const sent: { url: string; body: string }[] = [];
  await page.route('**/api/sq/quotes/*/send', async (route) => {
    sent.push({ url: route.request().url(), body: route.request().postData() ?? '' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { queued: true, sendId: 'e2e' } }),
    });
  });

  // The button is "Email the customer" — the domain word, not the verb the queue uses.
  await page.getByRole('button', { name: 'Email the customer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Four modes in one select, and "quote" is the default because that is what a customer gets.
  const modeSelect = dialog.getByLabel('This email is for');
  await expect(modeSelect.locator('option')).toHaveCount(4);
  await expect(modeSelect).toHaveValue('quote');

  // Addressed already — the customer's email from the quote. The field's label is "To", which also
  // matches the mode select's label ("This email is for"), so the field is addressed by its id.
  await expect(dialog.locator('#send-to')).toHaveValue('e2e.smoke@example.com');

  await modeSelect.selectOption('engineering');
  await dialog.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  expect(sent[0]?.body).toContain('"mode":"engineering"');
});

test('5 — leaving an edited quote warns; leaving an untouched one does not', async ({ page }) => {
  const firstRow = page.getByRole('row').filter({ hasText: 'E2E Smoke' }).first();
  await firstRow.getByRole('link').first().click();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);

  /*
   * Untouched: navigating away must go through silently.
   *
   * The dialog handler is installed **before** the click and stays for the test. Playwright dismisses
   * an unhandled dialog by itself, and a handler registered afterwards then throws "Cannot accept
   * dialog which is already handled" — a failure in the test, not in the product.
   */
  let asked = false;
  page.on('dialog', async (dialog) => {
    asked = true;
    await dialog.accept();
  });
  await page.getByRole('link', { name: 'Quotes' }).first().click();
  await expect(page).toHaveURL(/\/quotes$/);
  expect(asked, 'an unedited quote asked before leaving').toBe(false);

  // Edited: it must ask.
  await page.getByRole('row').filter({ hasText: 'E2E Smoke' }).first().getByRole('link').first().click();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.locator('#customer-firstName').fill('E2E Edited');
  await expect.poll(async () => (await dirtyState(page)).any).toBe(true);

  asked = false;
  await page.getByRole('link', { name: 'Quotes' }).first().click();
  await expect.poll(() => asked).toBe(true);
});
