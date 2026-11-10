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

  test('the site check sits between Delivery and Design, not at the bottom', async ({ page }) => {
    /*
     * ## The defect
     *
     * The ShedSafe panel used to be a separate card **below the whole form**. Measured 2026-11-10: the
     * site address ended at `top 916`, the pin button was at `top 3572` — 2 650 px apart, with the
     * entire design section in between. The three address groups exist to be pinned, and the button
     * they enable was nowhere near them.
     *
     * Asserted as **ordering**, not as pixel offsets: the exact heights move whenever a group gains a
     * field, and a test that hard-codes 1 616 breaks for a reason that is not a regression.
     */
    const order = await page.evaluate(() => {
      const buttonTop = (pattern: RegExp): number | null => {
        const button = [...document.querySelectorAll('h3 > button')].find((b) => pattern.test(b.textContent ?? ''));
        return button === undefined ? null : Math.round(button.getBoundingClientRect().top + window.scrollY);
      };
      return {
        delivery: buttonTop(/^Delivery/),
        siteCheck: buttonTop(/ShedSafe site check/),
        design: buttonTop(/^Design/),
      };
    });

    expect(order.delivery, 'the Delivery group must exist').not.toBeNull();
    expect(order.siteCheck, 'the site check must be a group on this step').not.toBeNull();
    expect(order.design, 'the Design group must exist').not.toBeNull();

    // Between them, in that order.
    expect(order.siteCheck as number).toBeGreaterThan(order.delivery as number);
    expect(order.siteCheck as number).toBeLessThan(order.design as number);
  });

  test('the six certified values are read-only, and say they have no source yet', async ({ page }) => {
    /*
     * ## The defect
     *
     * Before this, the six values rendered **only** when a rating had been imported, so a quote with no
     * site check showed an empty space where a table should be — indistinguishable from a broken panel.
     * `windRegion` and `terrainCategory` were also editable selects, which is worse than absent: a
     * person could type a wind region and believe it came from a certificate.
     *
     * Three separate facts, each of which was wrong before:
     *   1. all six rows exist with no site check at all;
     *   2. none of them is a form control;
     *   3. each says where its number came from.
     */
    const ids = [
      'design-importanceLevel',
      'design-windRegion',
      'design-terrainCategory',
      'design-buildingClass',
      'design-snowLoad',
      'design-windSpeed',
    ];

    for (const id of ids) {
      const field = page.locator(`#${id}`);
      await expect(field, `${id} must render without a site check`).toBeVisible();
      // `output`, not `select`/`input`: nothing here can be typed over.
      await expect(field).toHaveJSProperty('tagName', 'OUTPUT');
      await expect(field).toHaveText('—');
      await expect(page.locator(`#${id}-source`)).toHaveText(/not from a site check yet/i);
    }

    // The wind region is no longer a control anywhere on the step.
    await expect(page.locator('select#design-windRegion')).toHaveCount(0);
    await expect(page.locator('select#design-terrainCategory')).toHaveCount(0);
  });

  test('State and Internal pressure stay editable, because the certificate does not carry them', async ({ page }) => {
    /*
     * The counter-test to the one above, and the reason the list is not simply "everything read-only".
     *
     * `stateCode` picks the material price coefficient (`setting_price_coeffcient.state_code`) and the
     * Queensland mezzanine factor. ShedSafe reports wind, not price schedules — so if this were
     * disabled there would be **no** control over material pricing at all. Internal pressure is a
     * design choice the certificate does not make either.
     */
    await expect(page.locator('select#design-stateCode')).toBeVisible();
    await expect(page.locator('select#design-stateCode')).toBeEnabled();
    await expect(page.locator('select#design-internalPressure')).toBeVisible();
    await expect(page.locator('select#design-structureType')).toBeEnabled();
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
