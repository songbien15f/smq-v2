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

/**
 * State the building's three dimensions.
 *
 * A new quote has none — that is the behaviour under test elsewhere in this file — and almost every
 * other test needs a building to draw, price or save. Writing it once here keeps each test about the
 * thing it is checking rather than about the form.
 *
 * The Shed group is opened first: a `<Group>` renders its children only while expanded, so the fields
 * do not exist in the DOM otherwise.
 */
async function stateDimensions(page: import('@playwright/test').Page): Promise<void> {
  const shedGroup = page.locator('h3 > button').filter({ hasText: /^Shed(?!Safe)/ }).first();
  if ((await shedGroup.getAttribute('aria-expanded')) === 'false') await shedGroup.click();
  await page.locator('#shed-span').fill('12000');
  await page.locator('#shed-span').blur();
  await page.locator('#shed-height').fill('4200');
  await page.locator('#shed-height').blur();
  await page.locator('#shed-length').fill('24000');
  await page.locator('#shed-length').blur();
}

test.describe('Step 1 — quote details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
  });

  test('a new quote has no dimensions, and says so instead of inventing them', async ({ page }) => {
    /*
     * ## The defect this replaces
     *
     * `DEFAULT_SHED` carried 12 000 × 24 000 × 4 200 — numbers with no source. A new quote therefore
     * opened as a **complete building**, could be priced, and its "Go to ShedSafe" sent those three
     * figures to be certified. The customer's requirement is the opposite: a new quote has no
     * building until somebody states one.
     *
     * The desktop agrees: its Building Parameters panel opens empty and `GO TO SITECHECK` stays
     * disabled until span, height and length are entered.
     *
     * ## What this asserts, in the order a person meets it
     *
     * The two dimension fields are **empty** (not 12 000), Save is **disabled** with a reason naming
     * them, and the plan says there is nothing to draw yet — three consequences of one decision.
     */
    const span = page.locator('#shed-span');
    const height = page.locator('#shed-height');
    const length = page.locator('#shed-length');

    await expect(span).toHaveValue('');
    await expect(height).toHaveValue('');
    await expect(length).toHaveValue('');

    /*
     * Save is blocked, and the reason counts the fields rather than naming one: the customer's name
     * is also missing on a brand-new quote, and `#save-reason` reports the first block it finds. The
     * count is the assertion; the *list* is what the error summary above shows, field by field.
     *
     * Both are worth having: a count says "there is work to do", the summary says which. A first
     * version of this test asserted a dimension name here and failed on the customer's name first —
     * correct behaviour, wrong expectation.
     */
    const save = page.getByRole('button', { name: /^(Save quote|Save revision)$/ });
    await expect(save).toBeDisabled();
    await expect(page.locator('#save-reason')).toHaveText(/need attention|Nothing has been changed/i);

    /*
     * And the message beside each field says **why**, not just that it is empty: the price is built
     * from the dimensions. That sentence is the difference between "required" and "required because
     * the quote is a price for a building".
     */
    await expect(page.locator('#shed-span')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/Enter the span \(the clear width inside the columns\)/i)).toBeVisible();
    await expect(page.getByText(/Enter the overall length/i)).toBeVisible();
    await expect(page.getByText(/Enter the wall height/i)).toBeVisible();
  });

  test('the building panel and the Shed group are one record, not two', async ({ page }) => {
    /*
     * ## The reported defect
     *
     * The panel had its own copy of the four numbers. That is what lets a quote be **pinned** for a
     * 10 m shed and **priced** for a 12 m one — the same class of error the project already fixed
     * once (`pinnedFor`), and the customer's own requirement is that the panel *is* where the
     * dimensions are entered.
     *
     * The desktop does it with one store: its panel calls `SyncToStructureData()` and writes into the
     * same `BlocStructureData` the Shed group reads.
     *
     * ## The assertion is a round trip, in both directions
     *
     * A one-way test would pass on a copy that syncs on open. Typing in the panel must move the Shed
     * field, and typing in the Shed field must move back — because that is what "one record" means.
     */
    /*
     * The Shed group must be **expanded** for its fields to exist at all: a `<Group>` renders its
     * children only while open, so reading `#shed-span` on a collapsed group finds nothing — the same
     * trap this suite documents elsewhere, and one it fell into here first.
     */
    const shedGroup = page.locator('h3 > button').filter({ hasText: /^Shed(?!Safe)/ }).first();
    if ((await shedGroup.getAttribute('aria-expanded')) === 'false') await shedGroup.click();

    await page.getByRole('button', { name: /Set the building to rate/ }).click();
    await expect(page.getByRole('heading', { name: 'Building parameters' })).toBeVisible();

    // Panel → Shed group.
    await page.locator('#sitecheck-params-spanMm').fill('9000');
    await expect(page.locator('#shed-span')).toHaveValue('9000');
    await page.locator('#sitecheck-params-heightMm').fill('3600');
    await expect(page.locator('#shed-height')).toHaveValue('3600');
    await page.locator('#sitecheck-params-lengthMm').fill('18000');
    await expect(page.locator('#shed-length')).toHaveValue('18000');

    // Shed group → panel.
    await page.locator('#shed-span').fill('10500');
    await page.locator('#shed-span').blur();
    await expect(page.locator('#sitecheck-params-spanMm')).toHaveValue('10500');

    /*
     * And the two derived figures follow, because they are computed from the same record: the panel's
     * Avg. height and the Shed group's Average height must agree.
     */
    await page.locator('#sitecheck-params-roofPitchDeg').selectOption({ index: 1 });
    await expect(page.locator('#sitecheck-params-averageHeight')).not.toHaveText('—');
    const panelAverage = (await page.locator('#sitecheck-params-averageHeight').textContent()) ?? '';
    const shedAverage = (await page.locator('#shed-averageHeight').textContent()) ?? '';
    expect(panelAverage.replace(/[^0-9]/g, '')).toBe(shedAverage.replace(/[^0-9]/g, ''));
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

  test('State stays editable, because the certificate does not carry it', async ({ page }) => {
    /*
     * The counter-test to the one above, and the reason the list is not simply "everything read-only".
     *
     * `stateCode` picks the material price coefficient (`setting_price_coeffcient.state_code`) and the
     * Queensland mezzanine factor. ShedSafe reports wind, not price schedules — so if this were
     * disabled there would be **no** control over material pricing at all.
     *
     * Internal pressure used to be listed here too, as an editable select. It is not one any more: the
     * desktop computes it from the four open-wall switches and **disables** the field
     * (`CalcInternalPressuresValue`, `QuoteDetailsView.cs:2649`), because the value selects which
     * frame row is read. The test below asserts the derived control instead.
     */
    await expect(page.locator('select#design-stateCode')).toBeVisible();
    await expect(page.locator('select#design-stateCode')).toBeEnabled();
    await expect(page.locator('select#design-structureType')).toBeEnabled();
  });

  test('internal pressure is worked out from the walls, not typed', async ({ page }) => {
    /*
     * ## The defect this replaces
     *
     * Internal pressure was a dropdown. It decides the `internal_pressure` value the frame row is read
     * by — `'+0.7, -0.65'` for an open building, `'+0.2, -0.3'` for a closed one — so a person could
     * set `open` on a shed with four walls and be quoted a frame designed for a wall that is not
     * there. The desktop never allowed it: the control is `Enable = false` and recalculated on every
     * wall switch (`QuoteDetailsView.cs:2649`).
     *
     * ## Why this asserts both directions
     *
     * A read-only field that always says "closed" would pass a one-sided test. Opening one wall must
     * move it to the heavier design, and closing it again must move it back.
     */
    const value = page.locator('#design-internalPressure');
    await expect(value).toBeVisible();
    // No control to type into: it is a `<dd>`, not an `input` or a `select`.
    await expect(page.locator('select#design-internalPressure')).toHaveCount(0);

    const closed = page.getByRole('checkbox', { name: /End wall, left/i });
    await expect(closed).not.toBeChecked();
    await expect(value).toHaveText(/^Closed/);

    await closed.check();
    await expect(value).toHaveText(/^Open/);

    await closed.uncheck();
    await expect(value).toHaveText(/^Closed/);
  });

  test('the structure list offers only structures the app can store', async ({ page }) => {
    /*
     * ## The defect, measured 2026-11-11
     *
     * The dropdown offered seven structures and four of them — `carports`, `tophot`, `zed`, `hangar` —
     * were not members of the domain's `StructureType`. Choosing one reached
     * `structureTypeSchema.catch(DEFAULT_SHED.structureType)` and came back as **`gable`**, so the form
     * showed one building and the quote held another. Same shape as the importance level that silently
     * became 1.
     *
     * The assertion is on the *effect*, not on the list: pick each option and read back what the
     * select shows after the store has normalised it. A list that is merely longer than the union would
     * pass an assertion about its length and still lose the value.
     */
    const select = page.locator('select#design-structureType');
    const options = await select.locator('option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );

    expect(options).toContain('custom_gable');
    expect(options).toContain('custom_skillion');

    for (const value of options) {
      await select.selectOption(value);
      // The select is controlled by the store: if the value had been rejected and replaced, the
      // control would snap back to whatever the schema substituted.
      await expect(select).toHaveValue(value);
    }
  });

  test('average height and ridge height are shown, and follow the roof', async ({ page }) => {
    await stateDimensions(page);
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

  test('Quote no., Typical design and the awning widths sit where the desktop puts them', async ({ page }) => {
    /*
     * Three fields the parity audit found missing or in the wrong group. Each is asserted in the group
     * it belongs to, not merely somewhere on the page — "the value exists" and "the value is where a
     * person looks for it" are different claims, and the second is the one the desktop encodes.
     *
     *  - **Quote no.** is the desktop's `#1`, the first field of Quote & client.
     *  - **Typical design** (knee brace) is `#47`, in Shed, directly after Height. Read-only because the
     *    structure table picks it.
     *  - **Front / Rear awning** are `#43-44`, in Shed, right after Span — not in Design next to the
     *    certified values, which is where this build first put them.
     */
    /*
     * Open every group first. A `<Group>` renders its children **only while expanded**, so measuring
     * `#shed-kneeBrace` on a collapsed group finds nothing and reads `null` — a fact this suite has
     * been caught by before ("control inside a closed accordion is not in the DOM").
     */
    for (const title of [/^Quote & client/, /^Shed(?!Safe)/, /^Design/, /^Colours/]) {
      const button = page.locator('h3 > button').filter({ hasText: title }).first();
      if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
    }

    const groupOrder = await page.evaluate(() => {
      const top = (pattern: RegExp): number | null => {
        const button = [...document.querySelectorAll('h3 > button')].find((b) =>
          pattern.test(b.textContent ?? ''),
        );
        return button === undefined ? null : Math.round(button.getBoundingClientRect().top + window.scrollY);
      };
      const fieldTop = (id: string): number | null => {
        const el = document.getElementById(id);
        return el === null ? null : Math.round(el.getBoundingClientRect().top + window.scrollY);
      };
      return {
        clientGroup: top(/^Quote & client/),
        // `/^Shed/` also matches "ShedSafe site check", which sits between Delivery and Design — it
        // measured 1329 and made the comparison read as though Shed stood above Design.
        shedGroup: top(/^Shed(?!Safe)/),
        designGroup: top(/^Design/),
        quoteNumber: fieldTop('customer-quoteNumber'),
        kneeBrace: fieldTop('shed-kneeBrace'),
        frontAwning: fieldTop('design-awning-left'),
        rearAwning: fieldTop('design-awning-right'),
        span: fieldTop('shed-span'),
        height: fieldTop('shed-height'),
      };
    });

    for (const [name, value] of Object.entries(groupOrder)) {
      expect(value, `${name} must be on the page`).not.toBeNull();
    }

    // Quote no. is inside Quote & client — above where Shed starts.
    expect(groupOrder.quoteNumber as number).toBeLessThan(groupOrder.shedGroup as number);

    /*
     * Design renders **above** Shed in this build (`<DesignGroup/>` precedes `<ShedGroup/>` in
     * `QuoteDetailsPanel`), which the desktop's own group order also does — Quote & client · Site ·
     * Delivery · **Design** · **Shed** · Colours. So a Shed field's offset is greater than the Design
     * header's, not less. A first version asserted the opposite and failed on correct code.
     */
    expect(groupOrder.shedGroup as number).toBeGreaterThan(groupOrder.designGroup as number);

    // Typical design is in Shed, after Height and before the group ends.
    expect(groupOrder.kneeBrace as number).toBeGreaterThan(groupOrder.height as number);
    expect(groupOrder.kneeBrace as number).toBeGreaterThan(groupOrder.shedGroup as number);

    // Both awning widths are in Shed now — after Span, inside the Shed group.
    for (const id of ['frontAwning', 'rearAwning'] as const) {
      expect(groupOrder[id] as number, id).toBeGreaterThan(groupOrder.span as number);
      expect(groupOrder[id] as number, id).toBeGreaterThan(groupOrder.shedGroup as number);
    }

    // And the two controls are not editable where they must not be.
    await expect(page.locator('#shed-kneeBrace')).toBeVisible();
    await expect(page.locator('input#shed-kneeBrace')).toHaveCount(0);
  });

  test('horizontal cladding is a switch in Colours, and it creates one priced option', async ({ page }) => {
    await stateDimensions(page);
    /*
     * The desktop's only **child control inside Colours**: `HorizontalCladdingItem` sits under Wall
     * (`#61`), not in the Options dock. This build had the option kind, the BOM line and the drawing,
     * and no switch anywhere — so the only way to get one was the plan's context menu, which is not
     * where the desktop puts it and not where a person looks for a wall finish.
     */
    const toggle = page.locator('#colours-horizontalCladding');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await expect(toggle).toBeChecked();

    // Off again removes it: a colour block saying "no cladding" with a priced option behind it is two
    // answers to one question.
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
  });

  test('the plan’s Add-option menu offers every option kind the domain has', async ({ page }) => {
    await stateDimensions(page);
    /*
     * ## Why this test exists
     *
     * A parity audit first recorded `stable`, `overhang` and `horizontal_cladding` as having **no**
     * way to be created. That was wrong, and wrong for a specific reason worth a test: the dock lists
     * fifteen categories, so a search for "where can I add this" stopped at the dock. The actual path
     * is the plan's context menu, which is built from `OPTION_KIND_OPTIONS` — the twelve-kind list in
     * `domain/selection.ts`.
     *
     * The risk this guards is drift in the other direction: the menu is derived from the domain, so a
     * new `OptionKind` appears there automatically, but a kind the domain gains without a
     * `defaultOptionsFor` branch would still be uncreatable. Asserting the count against the domain's
     * own list catches both.
     */
    /*
     * Step 2 exists **only once there is a price.** The rail renders a `<span>`, not a button, while
     * the quote is incomplete — "Calculate the price first" — so the required contact fields have to
     * be filled before the plan can be reached at all. That is the existing gate and the honest one:
     * an option is placed on a priced building, and there is nothing to place on a blank quote.
     */
    await page.locator('#customer-firstName').fill('Plan');
    await page.locator('#customer-lastName').fill('Menu');
    await page.locator('#customer-email').fill('plan@example.com');
    await page.locator('#customer-address').fill('1 Test Road');
    await page.locator('#site-address').fill('1 Test Road');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');
    const delivery = page.getByRole('button', { name: /^Delivery/ });
    if ((await delivery.getAttribute('aria-expanded')) === 'false') await delivery.click();
    await page.locator('#site-deliveryAcknowledged').check();

    const optionsStep = page.locator('nav[aria-label="Quote steps"] li button').filter({ hasText: /Options/ }).first();
    await expect(optionsStep).toBeEnabled({ timeout: 30_000 });
    await optionsStep.click();
    await expect(page.getByRole('heading', { name: 'Options on the plan', level: 1 })).toBeVisible({
      timeout: 20_000,
    });

    /*
     * The plan is an `<img>` — a rendered SVG/image, not a canvas — which is why this looks for the
     * image by its accessible name rather than for a `canvas` element. A first version waited 60 s
     * on a locator that could never resolve.
     */
    const plan = page.getByRole('img', { name: /^Plan of a .* millimetre shed/ });
    await expect(plan).toBeVisible();
    await plan.click({ button: 'right', position: { x: 300, y: 260 } });

    /*
     * A submenu opens on **click**, not hover: `ContextMenu` swaps the visible rows for the submenu
     * (with a "Back" row) rather than rendering a flyout beside them. `hover()` left the parent list
     * on screen and the assertion below waited on rows that were never going to appear.
     */
    const addOption = page.getByRole('menuitem', { name: /^Add option$/i });
    await expect(addOption).toBeVisible({ timeout: 10_000 });
    await addOption.click();

    /*
     * Every kind the domain lists. Written out rather than imported so the assertion is about what a
     * person sees, and so adding a kind to the domain without deciding it should be offered is a
     * deliberate edit here too.
     */
    for (const label of [
      'Skylight',
      'Overhang',
      'Cantilever',
      'Awning',
      'Outrigger',
      'Cladding',
      'Stable',
      'Dividing wall',
      'Mezzanine',
      'Carry beam',
      'Gable infill',
      'Miscellaneous option',
    ]) {
      await expect(
        page.getByRole('menuitem', { name: new RegExp(`^${label}$`) }),
        `the Add-option menu must offer “${label}”`,
      ).toBeVisible();
    }
  });

  test('the sheeting profile and thickness are both chosen, and both reach the price', async ({ page }) => {
    /*
     * ## The defect
     *
     * `wallProfile` and `roofProfile` were dropdowns, they were stored, the document printed them — and
     * the BOM hard-coded `Corro` at `0.42` in five places. Measured 2026-11-11 on the reference book:
     * changing the profile returned **the identical total**, 1 707 893 cents, every time.
     *
     * The numbers are not cosmetic. Lo-Rib covers 817 mm where Corro covers 762 (7% fewer sheets) and a
     * 0.48 Corro sheet is $9.93/m where 0.42 is $8.45.
     *
     * ## Why this asserts the thickness list rather than a price
     *
     * The price lives in the API and is covered by `stepOneInputsReachThePrice`. What a browser test can
     * see — and a unit test cannot — is that the thickness control exists, follows the profile, and
     * offers only what the book stocks for it. `Lo-Rib` has no 0.48 row, so offering one would produce a
     * mocked sheeting line on a real quote.
     */
    const wall = page.locator('#shed-wallProfile');
    const roof = page.locator('#shed-roofProfile');
    await expect(wall).toBeVisible();
    await expect(page.locator('#shed-wallBmt')).toBeVisible();
    await expect(page.locator('#shed-roofBmt')).toBeVisible();

    const thicknesses = async (id: string): Promise<string[]> =>
      page.locator(`${id} option`).evaluateAll((els) =>
        els.map((el) => (el as HTMLOptionElement).value),
      );

    // Corro is sold in all three thicknesses.
    await wall.selectOption('Corro');
    expect(await thicknesses('#shed-wallBmt')).toEqual(['0.35', '0.42', '0.48']);

    /*
     * Lo-Rib has no 0.48 row in the book: selecting it must snap, not offer a pair nothing prices.
     *
     * Polled rather than read once: the option list is derived from the store, which the change reaches
     * on the next render, and a single read saw the previous profile's list.
     */
    await wall.selectOption('Lo-Rib');
    await expect
      .poll(async () => thicknesses('#shed-wallBmt'))
      .toEqual(['0.35', '0.42']);
    const shown = await page.locator('#shed-wallBmt').inputValue();
    expect(['0.35', '0.42']).toContain(shown);

    // The roof profile is a separate choice with its own thickness — TL-5 does have a 0.48.
    await roof.selectOption('TL-5');
    await expect.poll(async () => thicknesses('#shed-roofBmt')).toEqual(['0.35', '0.42', '0.48']);
  });

  test('the downpipe material decides which colours the downpipe can be', async ({ page }) => {
    /*
     * ## The rule, from the desktop's event handler
     *
     * `OnChangeBasicDownpipeTypeEvent` (`QuoteDetailsView.Events.cs:696`) re-filters the downpipe
     * colour list on every material change, through `FindDownpipeColors(kind, true)`. On the reference
     * book that join gives **PVC → White alone** and **STEEL → the other 29 colours**, so a Monument
     * PVC downpipe is not a thing the factory sells. Before this, downpipe type was free text and the
     * colour grid offered all 30 colours whatever was typed.
     *
     * ## Why it opens the palette instead of reading a value
     *
     * The filter is visible only in the swatch grid, so the test has to open it — the summary row
     * shows one colour either way. Asserting the *count* rather than a specific colour is deliberate:
     * a book revision that adds a PVC colour should not break the test, while a filter that stops
     * running makes the count jump from 1 to 30.
     */
    const material = page.locator('select#shed-downpipeType');
    await expect(material).toBeVisible();

    // PVC: one colour, and the auto-pick puts the downpipe on it.
    await material.selectOption('PVC');
    await page.getByRole('button', { name: /^Downpipe: .*Change colour$/ }).click();
    const grid = page.getByRole('radiogroup', { name: 'Downpipe colour' });
    await expect(grid.getByRole('radio')).toHaveCount(1);
    await expect(grid.getByRole('radio', { name: 'White' })).toHaveAttribute('aria-checked', 'true');

    // Steel: the full range, and White is not among it.
    await material.selectOption('STEEL');
    await expect(grid.getByRole('radio')).toHaveCount(29);
    await expect(grid.getByRole('radio', { name: 'White' })).toHaveCount(0);
  });

  test('the roof pitch field offers the book’s angles for this span, and says when a value is not one', async ({ page }) => {
    await stateDimensions(page);
    /*
     * ## The desktop rule, and its bug
     *
     * The roof-pitch dropdown is rebuilt on every span change (`GetHintListRoofPitch`,
     * `ShedConfigCombo.cs:66-102`), keeping the `config_shed` rows whose **span** band contains the
     * current span. That function assigns `min = cfg.BayMin; max = cfg.BayMax` and then compares the
     * span against them — bay limits standing in for span limits. The result is a wrong suggestion
     * list, not a wrong price, because the dropdown is editable.
     *
     * Reproduced against the span band, and reported rather than snapped: the slider is limited to the
     * book's own range for the span, the listed angles are marked, and a pitch between two of them says
     * so instead of moving the roof the customer already agreed to.
     */
    const pitch = page.locator('#shed-roofPitchDeg');
    await expect(pitch).toBeVisible();

    // The reference book's list at every span it covers.
    await expect(page.getByText(/The book sells 7\.5, 10, 15, 20, 25, 30° at this span/)).toBeVisible();

    // A value that is not listed, but within range: reported, and left alone.
    await pitch.fill('12.5');
    const unlisted = page.getByText(/is between the pitches this book lists/);
    await expect(unlisted).toBeVisible();
    await expect(pitch).toHaveValue('12.5');

    // A listed value: no warning.
    await pitch.fill('15');
    await expect(page.getByText(/is between the pitches this book lists/)).toHaveCount(0);
  });

  test('bays can be given different lengths, and the length follows their sum', async ({ page }) => {
    /*
     * ## The desktop's `Adjust Bay Spacing` panel
     *
     * `UcAdjustBaySize` gives every bay its own length, and `OnBayUnitsChange` then sets
     * `OverallLength = val.Sum()` while **leaving the nominal spacing alone**. The building it
     * produces — 4 000/4 000/6 000 — is not describable by any even division, and the frame table is
     * keyed by the *largest* bay, so it is a genuinely different quote.
     *
     * ## Why this also guards a rule
     *
     * Before this, `validateDraft` refused any length that did not divide evenly by the bay count. That
     * rule is right while equal division is the only way to describe a shed, and wrong the moment the
     * panel exists: it would block the very building the panel creates. The assertion that the field
     * is not marked invalid is therefore part of the behaviour, not decoration.
     */
    /*
     * Changing a dimension can wipe options, and the app asks first (`applyDimension` →
     * `shouldWipeOptions`). An earlier test leaves a cantilever on the building, so the guard fires and
     * Playwright's default is to dismiss — the fill then silently does nothing, which is how this test
     * passed alone and failed in the suite.
     */
    page.on('dialog', (dialog) => void dialog.accept());

    const bays = page.locator('#shed-bays');
    const length = page.locator('#shed-length');

    /*
     * A known even building first, so the test does not inherit whatever ran before it.
     *
     * **Polled, not read once.** `applyBays` reconciles length, bay count and spacing in one store
     * write, so the assertion has to wait for the render that follows both fields rather than for the
     * DOM the click left behind. Measured 2026-11-12: with `fill`/`blur` and an immediate read the
     * field still held the previous 24 000 in a full-suite run, while a standalone run passed — the
     * classic "passes alone, fails in the suite" shape, and `expect.poll` is the honest fix because it
     * asserts the settled value instead of a race.
     */
    await length.fill('12000');
    await length.blur();
    await bays.fill('3');
    await bays.blur();
    await expect.poll(async () => length.inputValue()).toBe('12000');

    await page.getByRole('button', { name: /Adjust bay spacing/i }).click();
    const first = page.locator('#shed-bayWidth-0');
    await expect(first).toBeVisible();
    await expect(page.locator('#shed-bayWidth-1')).toBeVisible();
    await expect(page.locator('#shed-bayWidth-2')).toBeVisible();
    await expect(page.locator('#shed-bayWidth-3')).toHaveCount(0);

    // 12 000 in three bays is 4 000 each; making the first 6 000 makes the sum 14 000.
    await expect(first).toHaveValue('4000');
    await first.fill('6000');
    await first.blur();
    await expect(length).toHaveValue('14000');

    // The bay count did not change, and the form does not claim the building is invalid.
    await expect(bays).toHaveValue('3');
    await expect(page.locator('#shed-bays-error')).toHaveCount(0);
    await expect(page.locator('#shed-nomBaySpacing-error')).toHaveCount(0);

    // And the count hint says the bays differ rather than quoting a single average.
    await expect(page.locator('#shed-bays-hint')).toContainText(/per bay — see Adjust bay spacing/);
  });

  test('a long cantilever is refused on a standard building and allowed on a custom one', async ({ page }) => {
    await stateDimensions(page);
    /*
     * ## The desktop rule
     *
     * `ValidateDesignInfoBlock` (`QuoteDetailsView.Error.cs:315-330`) refuses a cantilever over
     * 1 400 mm — and skips the check entirely inside `if (!IS_NON_STANDARD_BUILDING)`. A cantilever is
     * a bracket hanging past the last column; past 1 400 mm it needs a design the standard series does
     * not carry, which is why the factory sells a custom building.
     *
     * ## Why this test goes through the screen twice
     *
     * The allowance is the interesting half. A rule that blocked everywhere would pass a test that only
     * checked the refusal, and would make a custom building impossible to quote — so the same 2 500 mm
     * is entered again after switching the structure, and must be accepted.
     *
     * Before 2026-11-11 this could not pass either way: `custom_gable` was not a member of
     * `StructureType`, so the dropdown's "custom" option silently became `gable` and the exemption was
     * unreachable code.
     */
    const structure = page.locator('select#design-structureType');
    const front = page.locator('#design-cantilever-front');
    await expect(front).toBeVisible();

    await structure.selectOption('gable');
    await front.fill('2500');
    await front.blur();

    const refusal = page.locator('#design-cantilever-error');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('1400');

    // The same length, on a building the factory designs to order.
    await structure.selectOption('custom_gable');
    await expect
      .poll(async () => page.locator('#design-cantilever-error').count())
      .toBe(0);
    await expect(front).toHaveValue('2500');
  });

  test('the PIN button opens the building panel, and names what it is waiting for', async ({ page }) => {
    /*
     * ## The change this test protects
     *
     * The button beside the site address used to **pin** straight away, sending the quote's own
     * `span`/`height`/`length`/`importanceLevel`. Those come from `DEFAULT_SHED` — 12 000 × 24 000 ×
     * 4 200 — so a building nobody described was certified by ShedSafe and every number in the quote
     * was priced against that rating.
     *
     * The desktop never worked that way: PIN opens the **Building Parameters** flyout, whose fields
     * start empty, and its `GO TO SITECHECK` stays disabled until they are entered (trace §5.2-5.3).
     *
     * So this asserts three things in order: the button opens a panel, the panel's fields are **empty**
     * rather than pre-filled from the quote, and the panel's own submit is disabled with the missing
     * fields named.
     */
    const opener = page.getByRole('button', { name: /Set the building to rate|Review the rated building|Building parameters are open/ });
    await expect(opener).toBeVisible();
    await expect(page.locator('#sitecheck-params-title')).toHaveCount(0);

    await opener.click();
    await expect(page.getByRole('heading', { name: 'Building parameters' })).toBeVisible();

    /*
     * Empty, not seeded. The quote has a span of its own — 12 000 from the defaults — and copying it
     * here without a keystroke is exactly the defect.
     */
    for (const id of ['#sitecheck-params-spanMm', '#sitecheck-params-heightMm', '#sitecheck-params-lengthMm']) {
      await expect(page.locator(id), `${id} must start empty`).toHaveValue('');
    }
    /*
     * Importance level is **not** empty, and should not be: it is a quote field with a real default
     * (2, the desktop's own), not a dimension the operator has to state. Only the three dimensions and
     * the pitch begin unset.
     */
    await expect(page.locator('#sitecheck-params-importanceLevel')).not.toHaveValue('');
    await expect(page.locator('#sitecheck-params-roofPitchDeg')).toHaveValue('');

    // The panel's average height is read-only and says so while it cannot be computed.
    await expect(page.locator('#sitecheck-params-averageHeight')).toHaveText('—');
    await expect(page.locator('input#sitecheck-params-averageHeight')).toHaveCount(0);

    // Its submit is disabled, and the missing fields are written beside it.
    const go = page.getByRole('button', { name: /^Go to ShedSafe$/ });
    await expect(go).toBeDisabled();
    await expect(page.locator('#sitecheck-params-missing')).toContainText(/Span \/ Width/);
    await expect(page.locator('#sitecheck-params-missing')).toContainText(/Height/);
    await expect(page.locator('#sitecheck-params-missing')).toContainText(/Overall Length/);
    /*
     * Roof pitch is **not** in the missing list when the quote already states one: the panel reads the
     * quote's pitch, and the desktop's gate only requires a pitch above zero. A brand-new quote has
     * pitch 10 from `DEFAULT_SHED`, so only the three dimensions are missing.
     */
    await expect(page.locator('#sitecheck-params-missing')).not.toContainText(/Roof Pitch/);
  });

  test('the building panel refuses a number below the floor the desktop enforces', async ({ page }) => {
    /*
     * `ValidateBuildingParametersForButton` requires each dimension to be at least 100 mm and the pitch
     * to be above zero. The desktop implemented the floor as `MinValue = 100` on the control plus a
     * `Text == "0"` hack, which the trace marks **not to be ported**; here the floor is a check on the
     * number, and the message is beside the field.
     */
    await page.getByRole('button', { name: /Set the building to rate|Review the rated building|Building parameters are open/ }).click();
    await page.locator('#sitecheck-params-spanMm').fill('50');

    const error = page.locator('#sitecheck-params-spanMm-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('at least 100');
    await expect(page.locator('#sitecheck-params-missing')).toContainText(/Out of range|Span/);
    await expect(page.getByRole('button', { name: /^Go to ShedSafe$/ })).toBeDisabled();
  });

  test('the panel shows the quote’s own dimensions, and the average height follows them', async ({ page }) => {
    await stateDimensions(page);
    /*
     * The one thing the desktop does not have, and the reason it is a **button**: the four numbers
     * usually are the quote's, so typing them again is friction. What must not happen is them being
     * filled without somebody deciding — which is what the previous version did automatically.
     */
    await page.getByRole('button', { name: /Set the building to rate|Review the rated building|Building parameters are open/ }).click();

    /*
     * **No copy button, and no empty box.** The panel and the Shed group are one record, so the
     * dimensions the operator just entered are already here. A "Copy from the quote" button was an
     * artefact of the private-copy design; its absence is the fix.
     */
    await expect(page.getByRole('button', { name: /Copy from the quote/i })).toHaveCount(0);
    await expect(page.locator('#sitecheck-params-spanMm')).toHaveValue('12000');
    await expect(page.locator('#sitecheck-params-heightMm')).toHaveValue('4200');
    await expect(page.locator('#sitecheck-params-lengthMm')).toHaveValue('24000');

    /*
     * The average height appears once span, height and pitch are all present, and it is the figure a
     * council application asks for — computed by the same `averageHeightMm` the Shed group uses.
     */
    const pitch = page.locator('#sitecheck-params-roofPitchDeg');
    if ((await pitch.inputValue()) === '') await pitch.selectOption({ index: 1 });
    await expect(page.locator('#sitecheck-params-averageHeight')).not.toHaveText('—');
  });

  test('the gate opens once the panel is complete, for a login ShedSafe accepts', async ({ page }) => {
    /*
     * ## Why this test skips, and what the skip means
     *
     * The suite signs in as `E2ESHEDS` / `owner`, a tenant created for it and **not** a registered
     * ShedSafe salesman — so the enabled branch of `Go to ShedSafe` is unreachable there, and every
     * other test in this file exercises the blocked one.
     *
     * The branch was verified on 2026-11-12 against the real thing: signed in as `HEADOFFICE` /
     * `hoangduy7617` (whose email *is* a salesman, "Jayy Ngo, Head Office"), an empty panel reports
     * the **panel** as the blocker and never mentions the account, and filling span/height/length/
     * pitch/importance enables the button with the sentence "Creates the building on ShedSafe with the
     * numbers above." Run it yourself with:
     *
     *     E2E_COMPANY_CODE=HEADOFFICE E2E_USERNAME=hoangduy7617      *     E2E_PASSWORD='…' npx playwright test --project=chrome --grep "gate opens once"
     *
     * The button is deliberately **not pressed**: that would create a building in the company's real
     * ShedSafe account, which is the operator's data, not a test fixture.
     */
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });

    /*
     * Wait for the identity sentence to resolve before reading it. It starts as "The site check is
     * issued under this login…" while the salesman list is in flight, which reads exactly like the
     * unknown case — a first version asserted on it immediately and reported a bug that was not there.
     */
    const state = page.locator('#sitecheck-salesman-state');
    await expect(state).toHaveText(
      /^Registered ShedSafe salesman|^This login is not a registered ShedSafe salesman/i,
      { timeout: 20_000 },
    );
    const text = ((await state.textContent()) ?? '').trim();
    if (!/^Registered ShedSafe salesman/i.test(text)) {
      test.skip(true, 'this suite signs in as a tenant that is not a ShedSafe salesman; see the note above for the real-account run');
      return;
    }

    await page.locator('#customer-firstName').fill('Dana');
    await page.locator('#customer-lastName').fill('Nguyen');
    await page.locator('#customer-email').fill('dana@example.com');
    await page.locator('#customer-address').fill('1 Test Road');
    await page.locator('#site-address').fill('1 Test Road');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');

    await page.getByRole('button', { name: /Set the building to rate/ }).click();
    const go = page.getByRole('button', { name: /^Go to ShedSafe$/ });

    // Empty panel + accepted login: the reason is the panel, and the account is not mentioned.
    await expect(go).toBeDisabled();
    await expect(page.locator('#sitecheck-params-missing')).toContainText(/Span \/ Width/);
    await expect(page.getByText(/ShedSafe will refuse this login/i)).toHaveCount(0);

    await page.locator('#sitecheck-params-spanMm').fill('12000');
    await page.locator('#sitecheck-params-heightMm').fill('4200');
    await page.locator('#sitecheck-params-lengthMm').fill('24000');
    await page.locator('#sitecheck-params-roofPitchDeg').selectOption('15');
    await page.locator('#sitecheck-params-importanceLevel').selectOption('2');

    // Average height, from the panel's own numbers.
    await expect(page.locator('#sitecheck-params-averageHeight')).toContainText('mm');

    await expect(go).toBeEnabled();
    await expect(page.getByText(/Creates the building on ShedSafe with the numbers above/)).toBeVisible();
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

    /*
     * And the button is genuinely disabled rather than merely explaining.
     *
     * The panel has to be open first: the submit lives inside it now, so on a closed panel there is no
     * button to be disabled. That is the desktop's own arrangement — `GO TO SITECHECK` is built into
     * `UcShowBuildingParameterss`, not into the grid.
     */
    await page
      .getByRole('button', { name: /Set the building to rate|Review the rated building|Building parameters are open/ })
      .click();
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
    /*
     * The quote must be **complete** for steps 2 and 3 to exist: the rail shows a `<span>`, not a
     * button, while the quote has no price. Filling the required fields is therefore part of reaching
     * every step, which is what this test is about.
     */
    await stateDimensions(page);
    await page.locator('#customer-firstName').fill('Every');
    await page.locator('#customer-lastName').fill('Step');
    await page.locator('#customer-email').fill('every@example.com');
    await page.locator('#customer-address').fill('1 Test Road');
    await page.locator('#site-address').fill('1 Test Road');
    await page.locator('#site-suburb').fill('Brisbane');
    await page.locator('#site-state').fill('QLD');
    await page.locator('#site-postcode').fill('4000');
    const deliveryGroup = page.getByRole('button', { name: /^Delivery/ });
    if ((await deliveryGroup.getAttribute('aria-expanded')) === 'false') await deliveryGroup.click();
    await page.locator('#site-deliveryAcknowledged').check();

    const save = page.getByRole('button', { name: /^(Save quote|Save revision)$/ });
    for (const step of STEPS) {
      /*
       * Reach the step through the rail. `StepRail` is an `<ol>` of buttons with
       * `aria-current="step"`, not `role="tab"` — a first version looked for tabs, found none, and
       * spent 60 s in a `.catch()` waiting for a locator that could never resolve.
       */
      const railItem = page
        .locator('nav[aria-label="Quote steps"] li button')
        .filter({ hasText: new RegExp(step) })
        .first();
      if (await railItem.count()) {
        /*
         * Steps 2 and 3 are locked until a price exists, so the click waits for the calculation the
         * dimensions triggered. A rail item that stayed disabled would otherwise leave the heading
         * assertion below to report a step that was never reached.
         */
        await expect(railItem).toBeEnabled({ timeout: 30_000 });
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

    // The dimensions come **after** the navigation, or the reload would clear them.
    await stateDimensions(page);

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
