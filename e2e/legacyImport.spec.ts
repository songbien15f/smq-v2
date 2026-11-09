import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * A quote from the old desktop app opens into the editor, and can be worked on.
 *
 * ## Why this file exists
 *
 * The question it answers is the operator's own: *"quote cũ tôi muốn mở ra để chỉnh sửa có được
 * chưa? tôi cần có thể mở ra để xem/edit 3 step"*. That is not three separate claims (the file reads,
 * the editor opens, the steps work) — it is one path, and testing the pieces separately is what let a
 * unit-tested conversion and a unit-tested editor ship with a broken wire between them.
 *
 * ## Real files, uploaded through the real input
 *
 * Playwright can drive a file input, which the in-app browser cannot — so the earlier verification of
 * this feature had to skip the picker and post to the API by hand. These use the actual `setInputFiles`
 * on the actual `<input type="file">`, in the three formats a real `.sqd` is found in:
 *
 * | file | format | why it is here |
 * |---|---|---|
 * | `mock-test.sqd` | plaintext JSON | one window, 4 bays — the shape the desktop writes today |
 * | `template-files/2/1.sqd` | AES-256-CBC | proves the legacy key still decrypts in the running app |
 *
 * They live in the **legacy repos beside this one**, not in this repo: they are the old product's
 * sample data. The tests skip — loudly, by name — when those repos are not checked out, so a clone
 * without them reports a skip rather than a green tick over an untested path.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

const FILES = {
  json: resolve(REPO_ROOT, 'smq-code-smartquote', 'App', 'SmartQuote', 'mock-test.sqd'),
  aes: resolve(REPO_ROOT, 'smq-code-license', 'Web', 'SmartQuoteMgmt', 'SmartQuote.LicenseMgmt', 'App_Data', 'template-files', '2', '1.sqd'),
};

/** Upload a file on the import screen and wait for the report. */
async function upload(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto('/quotes/import');
  await expect(page.getByRole('heading', { name: 'Open a quote file', level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(path);

  // The report, not a spinner: the heading is the panel that lists what the file contained.
  await expect(page.getByRole('heading', { name: 'What the file contains', level: 2 })).toBeVisible({ timeout: 30_000 });
}

test.describe('opening a legacy .sqd quote', () => {
  test.skip(
    !existsSync(FILES.json) || !existsSync(FILES.aes),
    `needs the legacy sample files at ${FILES.json} — the sibling repos are not checked out`,
  );

  test('reads a plaintext file, reports what it carries, and opens it', async ({ page }) => {
    await upload(page, FILES.json);

    // The report names what came across and what did not. "Nothing listed" is not the same as "nothing
    // dropped", so the panel must be present even when a group is empty.
    await expect(page.getByText(/Carried across/i)).toBeVisible();
    await expect(page.getByText(/6000 mm/).first()).toBeVisible();

    // An opening in the file becomes an opening in the building — the assertion the panel makes.
    await expect(page.getByText(/1 × window/)).toBeVisible();

    // And the way in.
    await page.getByRole('button', { name: /Open in the editor/i }).click();
    await expect(page).toHaveURL(/\/quotes\/new#/, { timeout: 20_000 });
  });

  test('a converted quote is editable across all three steps', async ({ page }) => {
    await upload(page, FILES.json);
    await page.getByRole('button', { name: /Open in the editor/i }).click();
    await expect(page).toHaveURL(/\/quotes\/new#/, { timeout: 20_000 });

    /*
     * Step 1: the building the file described, not the default shed. These are the four numbers a
     * conversion can get wrong while still "opening", so they are the ones checked.
     */
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('#shed-span')).toHaveValue('6000');
    await expect(page.locator('#shed-height')).toHaveValue('3000');
    await expect(page.locator('#shed-length')).toHaveValue('15000');
    await expect(page.locator('#shed-bays')).toHaveValue('4');

    // The 2D plan draws from the converted geometry — an opening the file had is on the drawing.
    await expect(page.getByRole('img', { name: /Plan of a 6000 by 15000/i })).toBeVisible({ timeout: 30_000 });

    // A price, because the building was converted completely enough to count materials from — and
    // **not** marked out of date, which is the defect this assertion caught: the auto-price used to
    // run against the previous render's building, so an imported quote opened with a stale figure.
    await expect(page.getByRole('heading', { name: 'Contract price' }).first()).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('aside[aria-label="Price summary"]')).not.toContainText('out of date');

    /*
     * The file carried a customer, so the only required field left is the delivery acknowledgement —
     * which the conversion cannot invent. Filling it is part of the path, not a workaround.
     */
    await page.getByRole('button', { name: /^Delivery/ }).click();
    await page.locator('#site-deliveryAcknowledged').check();

    /*
     * Step 2: the options step is a working surface. Reachable once the required fields are answered
     * and a price exists, which is the gate the screen enforces.
     */
    await page.getByRole('button', { name: 'Next: the plan' }).click();
    await expect(page.getByRole('heading', { name: 'Options on the plan', level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Next: cost' })).toBeEnabled({ timeout: 20_000 });

    // Step 3: the money, and the gate that freezes it.
    await page.getByRole('button', { name: 'Next: cost' }).click();
    await expect(page.getByRole('heading', { name: 'Cost and price', level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#cost-delivery')).toBeVisible();
  });

  test('an AES-encrypted file is decrypted by the running app', async ({ page }) => {
    /*
     * The legacy key is hardcoded in the old desktop and reproduced in `sqd.ts` to read existing
     * files. This is the only test that proves the **deployed** reader still has it: the unit test
     * builds its own fixture with the same key, so both could drift from the real file together.
     */
    await upload(page, FILES.aes);

    // 24 000 mm over 6 bays is this file's building — different from the JSON fixture above, so a
    // report that merely looked plausible cannot pass.
    await expect(page.getByText(/24000 mm|24,000 mm/).first()).toBeVisible();
    await expect(page.getByText(/6 bays at 4000 mm/)).toBeVisible();

    await page.getByRole('button', { name: /Open in the editor/i }).click();
    await expect(page).toHaveURL(/\/quotes\/new#/, { timeout: 20_000 });
    await expect(page.locator('#shed-span')).toHaveValue('6000', { timeout: 40_000 });
    await expect(page.locator('#shed-length')).toHaveValue('24000');
    await expect(page.locator('#shed-bays')).toHaveValue('6');
  });

  test('saving a converted quote keeps the building it came from', async ({ page }) => {
    /*
     * The end of the path: edit, save, reopen. Without this the previous tests prove the editor
     * *displayed* the building; they do not prove the building survived a round trip through the
     * save — which is the only thing that makes the imported quote a quote rather than a preview.
     */
    await upload(page, FILES.json);
    await page.getByRole('button', { name: /Open in the editor/i }).click();
    await expect(page.locator('#shed-span')).toHaveValue('6000', { timeout: 40_000 });

    // Enough of a customer for the save gate, and a name the teardown recognises.
    await page.locator('#customer-firstName').fill('E2E');
    await page.locator('#customer-lastName').fill('Legacy');
    await page.locator('#customer-email').fill('e2e.legacy@example.com');
    await page.locator('#customer-address').fill('9 Legacy Rd');
    await page.getByRole('button', { name: 'Copy from customer' }).click();
    await page.getByRole('button', { name: /^Delivery/ }).click();
    await page.locator('#site-deliveryAcknowledged').check();

    // A change, so the save is a save and not a duplicate revision.
    await page.locator('#customer-phone').fill('07 3000 9911');

    await page.getByRole('button', { name: 'Next: the plan' }).click();
    await expect(page.getByRole('button', { name: 'Next: cost' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Next: cost' }).click();

    const save = page.getByRole('button', { name: /^Save (quote|revision)$/ });
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });

    // Reopened from the database: the converted dimensions are what was saved.
    const url = page.url();
    await page.goto(url);
    await expect(page.locator('#shed-span')).toHaveValue('6000', { timeout: 40_000 });
    await expect(page.locator('#shed-length')).toHaveValue('15000');
    await expect(page.locator('#shed-bays')).toHaveValue('4');
    // And the window the file had is still on the plan.
    await expect(page.getByRole('img', { name: /Plan of a 6000 by 15000/i })).toBeVisible({ timeout: 30_000 });
  });
});
