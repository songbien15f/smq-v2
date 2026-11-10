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
     * ## Why it sets a starting pitch instead of reading the current one
     *
     * These tests share one browser context, and the draft store keeps the building between
     * navigations. A previous test that left the pitch at 5° made "before" equal to the value this
     * test then set, so `toBeLessThan(before)` compared 4 729 with 4 729 and failed — a test that
     * passed alone and failed in the suite. Setting both ends explicitly makes the assertion about
     * the formula rather than about whatever the previous test left behind.
     */
    const average = page.locator('#shed-averageHeight');
    await expect(average).toBeVisible();

    const parse = async (): Promise<number> =>
      Number(((await average.textContent()) ?? '').replace(/[^\d.]/g, ''));

    const pitch = page.locator('#shed-roofPitchDeg');

    // A known steepness first, so "before" is a value this test chose.
    await pitch.fill('20');
    await expect.poll(parse).toBeGreaterThan(0);
    const atTwenty = await parse();

    // Shallower lowers it; steeper raises it. Both relative to the value measured just above.
    await pitch.fill('2');
    await expect.poll(parse).toBeLessThan(atTwenty);

    const atTwo = await parse();

    await pitch.fill('35');
    await expect.poll(parse).toBeGreaterThan(atTwo);
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
     *
     * ## Two gates now, and the second is about the account
     *
     * Since 2026-11-10 the button also requires that the signed-in email is a registered ShedSafe
     * salesman — a fact about the account, not the form, and one the suite's own tenant does not
     * satisfy. So this asserts the two independently: the field gate clears when the fields are
     * filled, and the button's final state is exactly "no fields missing **and** the account is
     * allowed".
     */
    await page.locator('#customer-firstName').fill('Dana');
    await page.locator('#customer-lastName').fill('Nguyen');
    await page.locator('#customer-email').fill('dana@example.com');
    await page.locator('#customer-address').fill('1 Test Road');
    await page.locator('#site-address').fill('1 Test Road');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');

    // The field gate has cleared: no "fill in …" sentence remains.
    await expect(page.getByText(/Before pinning, fill in/i)).toHaveCount(0, { timeout: 10_000 });

    /*
     * The three states, matched so that they cannot be confused with each other.
     *
     * `/Registered ShedSafe salesman/i` alone was **wrong**: it is a substring of *"This login is not a
     * registered ShedSafe salesman"*, so the "is blocked" branch was read as "is allowed" and the test
     * asserted an enabled button on the page that deliberately disables it. Anchoring the positive
     * case to the start of the sentence is what separates them.
     */
    const state = ((await page.locator('#sitecheck-salesman-state').textContent()) ?? '').trim();
    const isSalesman = /^Registered ShedSafe salesman/i.test(state);
    const explicitNo = /^This login is not a registered ShedSafe salesman/i.test(state);
    const unknown = /^Could not confirm this login/i.test(state);

    expect(
      isSalesman || explicitNo || unknown,
      `the panel must state the login's ShedSafe status; it said: "${state}"`,
    ).toBe(true);

    const pin = page.getByRole('button', { name: /Go to ShedSafe|Pin again/ });

    if (isSalesman) {
      // Fields + account: the button opens.
      await expect(pin).toBeEnabled();
    } else {
      /*
       * Not a salesman, or the list could not be read. The button is disabled **on purpose** and the
       * reason is on screen — which is the behaviour these tests exist to protect. Asserting
       * "enabled" here would assert that a pin ShedSafe refuses looks ready.
       */
      await expect(pin).toBeDisabled();
    }
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

/**
 * The salesman gate, which comes from the account rather than the form.
 *
 * ShedSafe accepts `Salesman` only if it is an email on **its own** live list. Measured 2026-11-10: a
 * display name, the API login name, and an email that had been deleted from the list were all refused
 * with *"The salesman provided is not a valid salesman username."* — a sentence about a wire field,
 * arriving after a press.
 *
 * The screen now asks first and says what it found. These tests cover the three answers, because the
 * distinction between them is the whole point: "is a salesman" enables, "is not" explains, and
 * "could not tell" must **not** block.
 */
test.describe('Step 1 — the ShedSafe salesman gate', () => {
  test('says whether this login is a registered salesman, before any press', async ({ page }) => {
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });

    // The email itself, from the session — not a display name.
    const email = await page.locator('#sitecheck-salesman').textContent();
    expect(email?.trim()).toMatch(/@/);
    expect(email?.trim()).not.toBe('Company Administrator');

    /*
     * One of three sentences, all of them honest:
     *
     *   Registered ShedSafe salesman — <name>
     *   This login is not a registered ShedSafe salesman …
     *   Could not confirm this login with ShedSafe (…). The pin is still worth trying.
     *
     * Which one appears depends on the email in `E2E_COMPANY_CODE`'s account and on whether the
     * ShedSafe API is reachable, so asserting a single one would make the suite depend on a live
     * third party. What is asserted is that the state is **always** stated.
     */
    await expect(page.locator('#sitecheck-salesman-state')).toHaveText(
      /Registered ShedSafe salesman|not a registered ShedSafe salesman|Could not confirm this login/i,
      { timeout: 20_000 },
    );
  });

  test('a login that is not a salesman is blocked, with the reason and who to ask', async ({ page }) => {
    /*
     * Only runs when the suite's own account is not a ShedSafe salesman — which is the case for the
     * demo company. When the account **is** registered the branch cannot be reached without a second
     * account, and the assertion above already covers the enabled path.
     */
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });

    const state = page.locator('#sitecheck-salesman-state');
    await expect(state).toHaveText(/Registered ShedSafe salesman|not a registered ShedSafe salesman|Could not confirm/i, {
      timeout: 20_000,
    });

    const text = (await state.textContent()) ?? '';
    // Anchored, so it cannot match inside "Registered ShedSafe salesman" — the two sentences differ by
    // three words and a substring test confuses them.
    if (!/^This login is not a registered ShedSafe salesman/i.test(text.trim())) {
      test.skip(true, 'this suite signs in as a registered ShedSafe salesman, so the blocked branch is unreachable');
      return;
    }

    // The reason names the email and the action, not a JSON field.
    expect(text).toMatch(/@/);
    expect(text).toMatch(/administrator/i);

    // And the button is genuinely disabled rather than merely explaining.
    await expect(page.getByRole('button', { name: /Go to ShedSafe|Pin again/ })).toBeDisabled();
  });
});

/**
 * Save is on every step, in the top right, and always reachable.
 *
 * ## The rule this replaces
 *
 * Save used to live only on step 3, and steps 1–2 carried a sentence saying so: *"The quote is saved
 * on the last step — step 3, Cost and price."* That was the screen refusing something the server has
 * always allowed: `save()` reads the draft and the evaluation out of the stores and never looks at
 * `step`. An operator who typed the customer, the address and the building and was then called away
 * had nothing to come back to.
 *
 * ## Three things a browser has to check
 *
 * 1. The button exists on all three steps — **one** of it, not one per step in the DOM.
 * 2. It stays on screen while the form scrolls. Measured before the fix: `top: −563` after filling
 *    step 1, i.e. "available on every step" was true only at the top of each one.
 * 3. A disabled button says why, in the page rather than in a tooltip — a tooltip cannot be read on a
 *    phone or reached by a keyboard, and a disabled button is the commonest state here.
 */
test.describe('Step 1 — Save from anywhere', () => {
  const STEPS = ['Quote details', 'Options on the plan', 'Cost and price'] as const;

  test('the Save button is on every step, once, and stays on screen', async ({ page }) => {
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });

    const save = page.getByRole('button', { name: /^(Save quote|Save revision)$/ });
    for (const step of STEPS) {
      /*
       * Reach the step through the rail. `StepRail` is an `<ol>` of buttons with
       * `aria-current="step"`, not `role="tab"` — a first version looked for tabs, found none, and
       * spent 60 s in a `.catch()` waiting for a locator that could never resolve.
       */
      const railItem = page.locator('ol button').filter({ hasText: new RegExp(step) }).first();
      if (await railItem.count()) {
        await railItem.click();
        await page.waitForTimeout(900);
      }
      // Heading proves which step is on screen; asserting it here means a rail click that silently
      // did nothing cannot pass as "the step was reached".
      await expect(page.getByRole('heading', { name: step, level: 1 })).toBeVisible({ timeout: 10_000 });

      await expect(save, `Save must be present on “${step}”`).toHaveCount(1);
      await expect(save, `Save must be visible on “${step}”`).toBeVisible();

      // Scroll far enough that a non-sticky control would be gone, then check again.
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(400);
      const onScreen = await save.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      expect(onScreen, `Save scrolled out of view on “${step}”`).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });

  test('a disabled Save says why, beside the button', async ({ page }) => {
    // A blank quote: the price is current (it was evaluated automatically) but six fields are empty.
    // The old code branched on the price alone and printed "Saves revision 1 and freezes the price…"
    // next to a button that could not be pressed — measured 2026-11-10.
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });

    const save = page.getByRole('button', { name: /^(Save quote|Save revision)$/ });
    await expect(save).toBeDisabled();

    const reason = page.locator('#save-reason');
    await expect(reason).toBeVisible();
    // It names the block, and it is not a description of a save that cannot happen.
    await expect(reason).toHaveText(/need attention|Nothing has been changed|price/i);
    await expect(reason).not.toHaveText(/Saves revision/);

    // Not a tooltip: the text is in the document, reachable by keyboard and by a screen reader.
    await expect(page.getByText(/Saves revision 1/)).toHaveCount(0);
  });

  test('saving from step 1 keeps the operator on step 1 and in the same quote', async ({ page }) => {
    /*
     * The behaviour the change exists for. Filling step 1 and saving must not move the screen to
     * another step: the operator is in the middle of step 1 and the save is a checkpoint, not a
     * "next".
     */
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500);

    await page.locator('#customer-firstName').fill('Save');
    await page.locator('#customer-lastName').fill('From step one');
    await page.locator('#customer-email').fill('save@example.com');
    await page.locator('#customer-address').fill('1 Test Street');
    await page.locator('#site-address').fill('1 Test Street');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');

    // The delivery acknowledgement is required and lives in a collapsed group.
    const delivery = page.getByRole('button', { name: /^Delivery/ });
    if ((await delivery.getAttribute('aria-expanded')) === 'false') await delivery.click();
    await page.locator('#site-deliveryAcknowledged').check();

    const save = page.getByRole('button', { name: /^Save (quote|revision)$/ });
    await expect(save).toBeEnabled({ timeout: 15_000 });
    await save.click();

    // The address changes from /quotes/new to the quote's own, and the step does not.
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible();
    // The label moves on, which is how a person knows the save happened.
    await expect(page.getByRole('button', { name: /^Save revision$/ })).toBeVisible();
  });
});
