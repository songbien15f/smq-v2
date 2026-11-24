import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The public Guest page (`apps/site` `/quote`): a visitor picks a building type, gives an address and
 * contact details, designs the building and sends a quote request without an account. This walks the
 * three steps of plan G-a2 S6 (Q2 — contact details are asked at the start).
 *
 * ## No sign-in
 *
 * The `guest` project in `playwright.config.ts` has no storageState: a guest has no cookie, and the
 * product session in `e2e/.auth` would hold a licence seat for a page that never uses it. Every test
 * gets a fresh context, so `localStorage` (where the page keeps the design) starts empty too.
 *
 * ## Google Places is stubbed in the browser, not switched off on the server
 *
 * The server keeps the Guest page's Places switch on (`GUEST_PLACES_ENABLED=1`, by the owner's
 * choice). The scenario wants the suburb fallback, and a suite that typed into the real address box
 * would spend Google money on every run. So the three Guest Places routes answer 503 `unavailable`
 * here, exactly what the API says when the switch is off, and the page falls back as it would in
 * production. Real Google calls are checked by `scripts/probe-guest-places.mjs`, run by hand.
 *
 * ## One real lead per run
 *
 * The desktop test sends one request: it writes one `guest_requests` row and uses one of the five
 * sends an address may make per hour (three per e-mail per day — hence an e-mail unique to the run).
 * Running the file more than about five times in an hour answers 429 `rate_limited`; that is the
 * limiter working, not the page failing.
 *
 * Rows from this suite carry "E2E" in their additional request and an `@example.com` address.
 */

const PLACES_ROUTES = '**/api/sq/public/guest/places/**';

/** What the API answers when the Guest page's Places switch is off (`routes/guest.ts`). */
const PLACES_OFF = {
  ok: false,
  code: 'unavailable',
  message: 'Address suggestions are not available.',
};

/** Make every Guest Places call fail as "unavailable"; returns how many the page made. */
async function stubPlaces(page: Page): Promise<() => number> {
  let calls = 0;
  await page.route(PLACES_ROUTES, (route) => {
    calls += 1;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(PLACES_OFF) });
  });
  return () => calls;
}

/** The design in one line: the tab bar's summary at ≥ 768, the bottom bar below. */
function summary(page: Page, phone: boolean): Locator {
  return phone ? page.locator('.g-mbar-text') : page.locator('.g-summary-value');
}

/** Open an accordion group if it is closed. `head` is the group's `<summary>` (id or locator). */
async function openGroup(page: Page, id: string | Locator): Promise<void> {
  const head = typeof id === 'string' ? page.locator(`#${id}`) : id;
  const open = await head.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
  if (!open) await head.click();
}

/** Path 1: pick a type, an address from the suburb list, and contact details, on step ①. */
async function fillStart(page: Page, { phone }: { phone: boolean }, email: string, path = '/quote'): Promise<void> {
  const placesCalls = await stubPlaces(page);

  // 1. No cookie, no saved design: ②③ are locked until ① has everything.
  await page.goto(path);
  for (const id of ['g-tab-design', 'g-tab-send']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-disabled', 'true');
  }

  const garage = page.getByRole('button', { name: /^Garage/ });
  await garage.click();
  await expect(garage).toHaveAttribute('aria-pressed', 'true');
  // The bar is shorter on a phone (room for the tabs), the full line from 768 up.
  await expect(summary(page, phone)).toContainText(
    phone ? 'Garage · 6.00 × 6.00 m' : 'Garage · 6.00 × 6.00 m · Gable 10° · 2 bays',
  );

  // 2. Address: the first search finds Places unavailable and the page falls back to the suburb list
  // by itself — the path a visitor takes when Google is down or the daily cap is reached.
  await page.locator('#g-address-search').pressSequentially('Ballar');
  await expect(page.getByText('Address search is unavailable — type your suburb instead.')).toBeVisible();
  const suburbBox = page.locator('#g-suburb-search');
  await expect(suburbBox).toBeFocused();
  await suburbBox.pressSequentially('Ballar');
  await page.getByRole('option', { name: /^Ballarat\s*VIC 3350$/ }).click();
  await expect(page.getByRole('button', { name: /Change/ })).toBeVisible();
  await expect(page.locator('.g-address-chosen-text')).toContainText(/Ballarat VIC 3350/);
  await expect(page.getByText(/Wind region confirmed in your quote/)).toBeVisible();
  expect(placesCalls()).toBeGreaterThan(0);

  // 3. Contact details, only on ①: a bad mobile is refused next to the field, then fixed.
  await page.getByRole('textbox', { name: 'First name' }).fill('Test');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Guest');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  const mobile = page.getByRole('textbox', { name: 'Mobile' });
  await mobile.fill('0412');
  await mobile.press('Tab');
  await expect(page.getByText(/Enter an Australian mobile, e\.g\. 0412 345 678/)).toBeVisible();
  await mobile.fill('0412345678');
  await mobile.press('Tab');
  // The button's label is "Building" on a wide screen and "Build" on a phone, so match the prefix.
  await page.getByRole('button', { name: /Continue to Build/ }).click();
  await expect(page).toHaveURL(/step=design/);
}

/**
 * Steps on ②: width, roof switch, pitch reset, a bay edit, and the summary following along.
 *
 * On a phone the controls live in a drawer that starts **closed** (plan guest-template-3col, D2), so
 * the first thing to do is open it. The stage is what a phone shows first now, with the tools one tap
 * away in the toolbar.
 */
async function design(page: Page, { phone }: { phone: boolean }): Promise<void> {
  if (phone) {
    // Off-canvas, not hidden: the drawer keeps its box and slides out of the way, so the panel state
    // is what says whether it is open.
    await expect(page.locator('.g-design')).toHaveAttribute('data-left', 'closed');
    await page.locator('#g-tools-btn').click();
    await expect(page.locator('.g-design')).toHaveAttribute('data-left', 'open');
  }

  // Width 7.5 m: the summary changes.
  const span = page.locator('#g-span');
  await span.fill('7.5');
  await span.press('Tab');
  await expect(summary(page, phone)).toContainText('7.50 ×');

  // Roof → Skillion: the pitch chips become 5°/10°; the chips are the proof (the phone bar shows the
  // short line — type and footprint only — so it cannot carry the roof).
  await page.locator('label.g-chip').filter({ hasText: 'Skillion' }).click();
  await expect(page.getByRole('radio', { name: '10°' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '20°' })).toHaveCount(0);
  if (!phone) await expect(summary(page, phone)).toContainText('Skillion 10°');

  // 5° carries the estimator flag line.
  await page.locator('label.g-chip').filter({ hasText: '5°' }).click();
  await expect(page.getByText(/A 5° skillion is below the book/)).toBeVisible();

  // Bay list: add a bay, and the length readout follows.
  const bayCount = await page.locator('#g-bays .g-bay').count();
  await page.getByRole('button', { name: 'Add bay' }).click();
  await expect(page.locator('#g-bays .g-bay')).toHaveCount(bayCount + 1);
  if (!phone) await expect(summary(page, phone)).toContainText('3 bays');

  // Doors & windows still work: a garage starts with one roller door. Scoped to the controls,
  // because the "AI Assistant" dock's suggestion chips carry a sentence that starts with the same words.
  await openGroup(page, 'g-group-doors');
  await page.locator('#g-tools').getByRole('button', { name: 'Add a roller door', exact: true }).click();
  await expect(page.locator('.g-opening-name', { hasText: 'Roller door 2' })).toBeVisible();

  // A drawer covers the page while it is open, so a phone closes it again before moving on — the
  // footer's "Next" sits behind the scrim otherwise.
  if (phone) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.g-design')).toHaveAttribute('data-left', 'closed');
  }
}

/** Step ③: the summary shows what was entered; a bad mobile is refused, then fixed and sent. */
async function send(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: /Next: Send/ }).click();
  await expect(page).toHaveURL(/step=send/);

  // The contact details live on ① and show read-only here.
  await expect(page.getByText('Test Guest')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send quote request' })).toBeVisible();

  // Without consent the send is refused with the field message. The consent label carries the same
  // words, so scope to the error paragraph rather than the text.
  await page.getByRole('button', { name: 'Send quote request' }).click();
  await expect(page.locator('.g-field-error', { hasText: /Tick the box so we can contact you/ })).toBeVisible();

  await page.getByRole('checkbox').check();
  await page.locator('form').getByRole('button', { name: 'Send quote request' }).click();
  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
  await expect(page.locator('.g-confirm-number strong')).toHaveText(/^GR-\S+$/);
}

/** The assistant's route, stubbed so the suite never calls a real model. */
const ASSISTANT_ROUTE = '**/api/sq/public/guest/assistant/turn';

test.describe('Guest quote page', () => {
  test('the assistant applies a change, and one Undo puts it back', async ({ page }) => {
    // `?assistant=1` shows the panel; the model call itself is stubbed below (a live model is not a
    // test dependency, and the server would spend money on every run).
    let design = { building: { span: 6000, height: 3000, pitchDeg: 10, roof: 'gable', bayWidths: [3000, 3000], slab: 'in_slab', kneeBrace: 'standard', cladding: 'vertical' } };
    await page.route(ASSISTANT_ROUTE, async (route) => {
      const sent = JSON.parse(route.request().postData() ?? '{}') as { design?: Record<string, unknown>; message?: string };
      const next = sent.design as typeof design;
      // "make it 9 metres wide": the answer the server would compute for this sentence.
      design = { ...next, building: { ...next.building, span: 9000 } };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            message: 'Made it 9 metres wide.',
            ops: [{ op: 'setSpan', mm: 9000 }],
            design,
            failures: [],
            needsConfirm: false,
          },
        }),
      });
    });

    // `?assistant=1` from the first load: the contact details are memory-only, so a later reload
    // would lock step ② and there would be no panel to test.
    const email = `test.guest+ai${Date.now()}@example.com`;
    await fillStart(page, { phone: false }, email, '/quote?assistant=1');

    await expect(summary(page, false)).toContainText('6.00 ×');
    // The assistant starts closed on every width; the bottom-right "AI Assistant" dock opens it.
    await page.locator('#g-assistant-fab').click();
    await page.locator('#g-assistant-input').fill('make it 9 metres wide');
    await page.locator('.g-assistant-form').getByRole('button', { name: 'Send' }).click();

    // The change card lists the operation, and the summary follows it.
    await expect(page.locator('.g-change')).toBeVisible();
    await expect(page.locator('.g-change')).toContainText('Width → 9.00 m');
    await expect(summary(page, false)).toContainText('9.00 ×');

    // One Undo restores the design from before the whole turn.
    await page.locator('.g-change').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.g-change')).toContainText('Undone');
    await expect(summary(page, false)).toContainText('6.00 ×');
  });

  test('the assistant says it is unavailable when the server has no key', async ({ page }) => {
    await page.route(ASSISTANT_ROUTE, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'not_configured', message: 'The assistant is unavailable right now.' }),
      }),
    );

    const email = `test.guest+ai${Date.now()}b@example.com`;
    await fillStart(page, { phone: false }, email, '/quote?assistant=1');

    // The assistant starts closed on every width; the bottom-right "AI Assistant" dock opens it.
    await page.locator('#g-assistant-fab').click();
    await page.locator('#g-assistant-input').fill('make it 9 metres wide');
    await page.locator('.g-assistant-form').getByRole('button', { name: 'Send' }).click();

    await expect(page.locator('.g-assistant-strip')).toContainText('The assistant is unavailable');
    // The designer keeps working: the controls are still there.
    await expect(page.locator('#g-span')).toBeVisible();
  });

  test('the 3D tab is the default and draws the building', async ({ page }) => {
    // The model only mounts when WebGL answers; the phone test below covers the fallback path.
    const email = `test.guest+3d${Date.now()}@example.com`;
    await fillStart(page, { phone: false }, email);

    // 3D is the opening view on a machine that supports it (plan S8).
    await expect(page.getByRole('tab', { name: '3D model' })).toHaveAttribute('aria-selected', 'true');
    const canvas = page.locator('.g-stage-3d canvas');
    await expect(canvas).toBeVisible();

    // The canvas is sized from its container, not left at the HTML default of 300 × 150.
    const box = await canvas.evaluate((c) => ({ w: (c as HTMLCanvasElement).width, h: (c as HTMLCanvasElement).height }));
    expect(box.w).toBeGreaterThan(400);
    expect(box.h).toBeGreaterThan(250);

    // "Hide roof" draws a different picture: two frames that differ prove the model is rendered,
    // because a blank canvas would produce identical bytes.
    const clip = await page.locator('.g-stage-3d').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + 20), y: Math.round(r.y + 20), width: 400, height: 300 };
    });
    const withRoof = await page.screenshot({ clip });
    await page.getByRole('button', { name: 'Hide roof' }).click();
    await expect(page.getByRole('button', { name: 'Show roof' })).toBeVisible();
    await page.waitForTimeout(600);
    const withoutRoof = await page.screenshot({ clip });
    expect(Buffer.compare(withRoof, withoutRoof)).not.toBe(0);

    // The 2D plan is still one click away and still draws.
    await page.getByRole('tab', { name: '2D plan' }).click();
    await expect(page.getByRole('group', { name: /Floor plan/ })).toBeVisible();
  });

  test('designs a building and sends a quote request (desktop)', async ({ page }) => {
    const email = `test.guest+e2e${Date.now()}@example.com`;
    await fillStart(page, { phone: false }, email);
    await design(page, { phone: false });

    const designLine = await summary(page, false).textContent();

    await send(page, email);

    // "Keep designing" goes back to the same design, not a fresh one.
    await page.getByRole('button', { name: 'Keep designing' }).click();
    await expect(page).toHaveURL(/step=design/);
    await expect(summary(page, false)).toHaveText(designLine ?? '');
  });

  test('works at phone width (390)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `test.guest+e2emob${Date.now()}@example.com`;
    await fillStart(page, { phone: true }, email);
    await design(page, { phone: true });

    // Nothing wider than the screen, on the busiest step.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: /Next: Send/ }).click();
    await expect(page).toHaveURL(/step=send/);
  });
});
