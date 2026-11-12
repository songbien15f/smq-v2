import { expect, test } from '@playwright/test';

/**
 * Layout rules that a component test cannot see, at the widths a person actually uses.
 *
 * ## Why these are here and not in a unit test
 *
 * Every rule below was **measured** as broken on 2026-11-08 and is invisible to jsdom: a CSS grid
 * only has columns when a browser computes them, a sticky offset only matters when the page scrolls,
 * and a table only overflows when a font has been laid out. Each one had shipped, and the audit that
 * found them was hand-run — which means it would have to be hand-run again after every change.
 *
 * These tests state the measured number as the pass condition, so a regression reports the number.
 *
 * ## The widths
 *
 * 1440 (a desktop), 1279 (a laptop, and the width one pixel below where the third grid column
 * appears — the exact boundary the price panel fell off), 768 (a tablet) and 390 (a phone). The skill
 * guidance says test 320/375/414/768/1024/1440; 390 sits between and is what the in-app browser uses.
 *
 * ## Measure here, not in the in-app browser pane
 *
 * The in-app browser's `setViewportSize({ width: 1279 })` **reports** 1279 and applies ~1407 (a
 * constant +102 px in the pane), so a breakpoint measurement taken there lands on the wrong side of
 * 1280 and reads as "the strip is hidden" when the strip is correctly hidden. Playwright's own
 * context applies the width exactly, which is why these assertions live here. A hand measurement
 * that disagrees with this file should be re-taken in this harness before the code is suspected.
 */

/**
 * State the building's three dimensions, so there is a price to lay out.
 *
 * A new quote has none — that is deliberate — and with no building there is no contract price, so the
 * layout questions this file asks cannot be asked. Writing the dimensions the way a person does keeps
 * each test about the layout rather than about the form.
 */
async function stateBuilding(page: import('@playwright/test').Page): Promise<void> {
  const shedGroup = page.locator('h3 > button').filter({ hasText: /^Shed(?!Safe)/ }).first();
  if ((await shedGroup.getAttribute('aria-expanded')) === 'false') await shedGroup.click();
  await page.locator('#shed-span').fill('12000');
  await page.locator('#shed-span').blur();
  await page.locator('#shed-height').fill('4200');
  await page.locator('#shed-height').blur();
  await page.locator('#shed-length').fill('24000');
  await page.locator('#shed-length').blur();
}

/** True when nothing pushes the page wider than the viewport (WCAG 1.4.10 reflow). */
async function overflowX(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('the price is visible without scrolling at every width', async ({ page }) => {
  /*
   * The defect: the price is the third grid child, so below `xl` (1280 px) it dropped to the bottom
   * of a page 5 092 / 5 996 px tall — top edge at 5 092 px on a 1279 px window. A salesperson on a
   * 1280×800 laptop, the commonest there is, could not see the number they were quoting.
   */
  for (const width of [1440, 1279, 768, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
    await page.goto('/quotes/new');
    await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
    await stateBuilding(page);
    await expect(page.getByRole('heading', { name: 'Contract price' }).first()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500);

    const visible = await page.evaluate(() => {
      // Either presentation counts: the third column above `xl`, the pinned strip below it.
      const panel = document.querySelector('aside[aria-label="Price"]');
      const strip = document.querySelector('aside[aria-label="Price summary"]');
      const inView = (el: Element | null): boolean => {
        if (el === null) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.bottom > 0 && rect.top < window.innerHeight;
      };
      return { panel: inView(panel), strip: inView(strip) };
    });

    expect(
      visible.panel || visible.strip,
      `no price on screen at ${width}px without scrolling (panel ${visible.panel}, strip ${visible.strip})`,
    ).toBe(true);
  }
});

test('the pinned price strip stays put while the form scrolls', async ({ page }) => {
  // A `sticky` element that shares an offset with the plan above it slid underneath and lost its top
  // 49 px — the dimensions along the top edge. The strip is measured against the plan, not assumed.
  await page.setViewportSize({ width: 1279, height: 800 });
  await page.goto('/quotes/new');
  await expect(page.getByRole('heading', { name: 'Quote details', level: 1 })).toBeVisible({ timeout: 40_000 });
  await stateBuilding(page);
  await expect(page.getByRole('heading', { name: 'Contract price' }).first()).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(600);

  const geometry = await page.evaluate(() => {
    const strip = document.querySelector('aside[aria-label="Price summary"]');
    const stripBox = strip === null ? null : strip.closest('div.sticky');
    const canvas = document.querySelector('canvas');
    const planBox = canvas === null ? null : canvas.closest('div[class*="lg:sticky"]');
    return {
      stripBottom: stripBox === null ? null : Math.round(stripBox.getBoundingClientRect().bottom),
      planTop: planBox === null ? null : Math.round(planBox.getBoundingClientRect().top),
      scrollY: Math.round(window.scrollY),
    };
  });

  expect(geometry.scrollY).toBeGreaterThan(1000);
  expect(geometry.stripBottom, 'the strip left the viewport').not.toBeNull();
  expect(geometry.planTop, 'the plan left the viewport').not.toBeNull();
  // The plan must start below the strip, or the strip hides part of the drawing.
  expect(
    (geometry.planTop ?? 0) >= (geometry.stripBottom ?? 0),
    `the plan (top ${geometry.planTop}) is under the strip (bottom ${geometry.stripBottom})`,
  ).toBe(true);
});

test('no page scrolls sideways on a phone or a tablet', async ({ page }) => {
  /*
   * The defect: the revisions table is seven columns wide and had no scroll wrapper, so at 390 px the
   * **page** was 154 px wider than the screen. The quotes list had the wrapper; this page did not —
   * which is why the rule is asserted on every page rather than the one that broke.
   */
  const pages = ['/quotes', '/quotes/import', '/settings'];

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 950 });
    for (const path of pages) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      expect(await overflowX(page), `${path} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    }

    /*
     * A quote with several revisions — the widest table in the product.
     *
     * The list itself is a **table above `sm` and a card list below it**, so the way into a quote
     * differs by width: a row's stretched link, or the card's own anchor. Both are links to
     * `/quotes/<id>`, so the locator is that rather than a role that only one arrangement has.
     */
    await page.goto('/quotes');
    await page.waitForTimeout(1200);
    const firstQuote = page.getByRole('link', { name: /^Open Q-\d{4}-\d{4}/ }).first();
    await firstQuote.click();
    await expect(page.getByRole('heading', { name: 'Revisions', level: 2 })).toBeVisible({ timeout: 20_000 });
    expect(await overflowX(page), `a quote detail page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
  }
});

test('the workspace menu collapses to one icon on a phone, and opens without overflowing', async ({ page }) => {
  /*
   * The defect: the links were a horizontal strip. At 390 px that was 264 px of links plus 79 px of
   * sign-out across the one row every screen has — and it scrolled sideways when it did not fit. The
   * panel is now anchored to the **bar**, not the button, which is what keeps it inside the viewport;
   * anchored to the button it started 141 px in and ended at 397 px on a 390 px screen.
   */
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ['/quotes', '/quotes/new']) {
    await page.goto(path);
    await page.waitForTimeout(1200);

    // Collapsed: no workspace link is visible, the button is, and it is a real touch target.
    const toggle = page.getByRole('button', { name: /Open workspace menu/ });
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box?.width ?? 0, `${path}: menu button narrower than 24 CSS px`).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0, `${path}: menu button shorter than 24 CSS px`).toBeGreaterThanOrEqual(24);
    await expect(page.locator('nav[aria-label="Workspace menu"]')).toBeHidden();

    // Opened: every link is there, plus the account control, and nothing overflows.
    await toggle.click();
    const panel = page.locator('nav[aria-label="Workspace menu"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Quotes' })).toBeVisible();
    expect(await overflowX(page), `${path}: the open menu overflows the viewport`).toBeLessThanOrEqual(0);

    // Escape closes it and gives focus back to the button — a disclosure, not a trap.
    await page.keyboard.press('Escape');
    await expect(page.locator('nav[aria-label="Workspace menu"]')).toBeHidden();
    await expect(page.getByRole('button', { name: /Open workspace menu/ })).toBeFocused();
  }
});

test('the breadcrumb link is a real touch target', async ({ page }) => {
  /*
   * The defect: the same five-line block was copied into six pages and in all six the link was
   * **14–15 px tall**. The inline exception does not apply — it is the only way back up a level, not a
   * link inside a sentence — so WCAG 2.5.8 wants 24 CSS px.
   */
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ['/settings', '/team', '/activity', '/quotes/import', '/settings/prices']) {
    await page.goto(path);
    await page.waitForTimeout(800);
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first();
    if ((await crumb.count()) === 0) continue; // a role without that screen: nothing to measure
    const box = await crumb.boundingBox();
    expect(box?.height ?? 0, `${path}: breadcrumb link is ${box?.height}px tall`).toBeGreaterThanOrEqual(24);
  }
});
