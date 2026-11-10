import { expect, test } from '@playwright/test';

/**
 * Step 1 — the behaviours from the desktop trace that a unit test cannot see.
 *
 * The trace (`docs/smartquote-analysis/2026-11-10-step1-quote-details-sitecheck-workflow.md`) describes
 * a desktop panel whose rules are mostly about *when a control is available and what a person is told*.
 * Those are exactly the facts an API test cannot reach: a disabled button and a helpful sentence render
 * the same HTML as a working one, and a silently rewritten value looks correct on screen.
 *
 * Each test here exists for a defect that was **measured** in this build on 2026-11-10, not for a
 * hypothetical.
 */

test.describe('Step 1 — quote details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
  });

  test('importance level offers 1 to 4, and a level above 2 is kept', async ({ page }) => {
    /*
     * ## The defect
     *
     * `importanceLevel` was typed `1 | 2` and the store's normaliser repairs with `.catch()` — so
     * ShedSafe's level 3 became level **1**, silently, and the quote printed "Importance level 1"
     * against a certificate saying 3. Measured: `normaliseShedConfig({ importanceLevel: 3 })` returned
     * `1`, and the select offered only two options.
     *
     * Both halves are asserted. An option list without the round trip would pass while the store still
     * rewrote what was chosen.
     */
    const select = page.locator('#design-importanceLevel');
    await expect(select).toBeVisible();

    const labels = await select.locator('option').allTextContents();
    expect(labels).toHaveLength(4);
    expect(labels[2]).toContain('3');
    expect(labels[3]).toContain('4');

    await select.selectOption('3');
    // The stored value, not the DOM's — this is where the silent downgrade happened.
    await expect(select).toHaveValue('3');

    // The book has no frame table for level 3, and says so rather than pricing it as level 1.
    await expect(page.getByText(/no frame table for level 3/i)).toBeVisible();
  });

  test('a price book that cannot price the level says so, and level 2 does not warn', async ({ page }) => {
    // The warning must be about the chosen level, not a permanent banner: level 2 is in the book.
    await page.locator('#design-importanceLevel').selectOption('2');
    await expect(page.getByText(/no frame table for level/i)).toHaveCount(0);

    await page.locator('#design-importanceLevel').selectOption('4');
    await expect(page.getByText(/no frame table for level 4/i)).toBeVisible();
  });

  test('average height and ridge height are shown, and follow the roof', async ({ page }) => {
    /*
     * A council application and a delivery quote both ask for an average height, and the desktop shows
     * it read-only in its Building Parameters panel. It was absent here entirely.
     *
     * The ridge is shown beside it because an average on its own is not self-explanatory: "average
     * 4 729" does not tell anyone the peak is 5 258, and the peak is what hits a low bridge.
     *
     * Asserted as a **relationship to the pitch**, not as fixed numbers: the default building's spans
     * are the store's business, and a test that hard-codes 4 729 breaks the day a default changes while
     * the formula stays correct.
     */
    const average = page.locator('#shed-averageHeight');
    await expect(average).toBeVisible();

    const parse = async (): Promise<number> =>
      Number(((await average.textContent()) ?? '').replace(/[^\d.]/g, ''));

    const before = await parse();
    expect(before).toBeGreaterThan(0);

    // A steeper roof raises the average; a flatter one lowers it.
    const pitch = page.locator('#shed-roofPitchDeg');
    await pitch.fill('5');
    await expect.poll(parse).toBeLessThan(before);

    await pitch.fill('25');
    await expect.poll(parse).toBeGreaterThan(before);
  });

  test('the PIN button names every field it is waiting for', async ({ page }) => {
    /*
     * ## The desktop rule, and the bug it avoids
     *
     * PIN needs five fields — first name, last name, email, customer address, site address — plus the
     * salesperson ShedSafe insists on. The desktop had **two disagreeing lists**: the button's enable
     * check fell back to a legacy address field, while the click handler did not, so a button could
     * look ready, be pressed, and be refused.
     *
     * Here there is one list. This asserts the visible consequence: on an empty quote the button is
     * disabled **and the screen says what is missing**, rather than a grey control with no reason on a
     * form 6 273 px tall.
     */
    const pin = page.getByRole('button', { name: /Go to ShedSafe|Pin again/ });
    await expect(pin).toBeDisabled();

    const reason = page.getByText(/Before pinning, fill in/i);
    await expect(reason).toBeVisible();

    for (const field of ['first name', 'last name', 'email', 'site address']) {
      await expect(reason).toContainText(new RegExp(field, 'i'));
    }
  });

  test('the PIN button enables once its fields are filled', async ({ page }) => {
    /*
     * The other half: a gate that never opens is worse than no gate. Nothing here calls ShedSafe — the
     * button becoming enabled is the whole assertion, and pressing it is deliberately not done.
     *
     * The site **suburb** is filled as well as its address, and that is not incidental: ShedSafe
     * refuses an empty `SuburbName` with *"The SuburbName field is required"*, measured against the
     * live API on 2026-11-06. A test that filled only the street line would assert a gate that opens
     * onto a call ShedSafe rejects.
     */
    await page.locator('#customer-firstName').fill('Dana');
    await page.locator('#customer-lastName').fill('Nguyen');
    await page.locator('#customer-email').fill('dana@example.com');
    await page.locator('#customer-address').fill('1 Test Road');
    await page.locator('#site-address').fill('1 Test Road');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');

    const pin = page.getByRole('button', { name: /Go to ShedSafe|Pin again/ });
    await expect(pin).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText(/Before pinning, fill in/i)).toHaveCount(0);
  });

  test('changing the delivery scope un-ticks the acknowledgement', async ({ page }) => {
    /*
     * The desktop does this (`Events.cs:573-582`) and the reason is a dispute one: the tick is a
     * statement about **one set of delivery terms**. Carried across a scope change it records an
     * acknowledgement of terms the customer never saw.
     *
     * The Delivery group is collapsed by default, so this opens it the way a person would.
     */
    const delivery = page.getByRole('button', { name: /^Delivery/ });
    if ((await delivery.getAttribute('aria-expanded')) === 'false') await delivery.click();

    const ack = page.locator('#site-deliveryAcknowledged');
    await expect(ack).toBeVisible();
    await ack.check();
    await expect(ack).toBeChecked();

    const scope = page.locator('#site-deliveryScope');
    // Pick any scope other than the current one; which one does not matter to the rule.
    const current = await scope.inputValue();
    const options = await scope
      .locator('option')
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    const target = options.find((value) => value !== current);
    expect(target, 'the book must offer more than one delivery scope').toBeDefined();

    await scope.selectOption(target as string);

    await expect(ack).not.toBeChecked({ timeout: 10_000 });
  });
});
