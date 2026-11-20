import { test, expect } from '@playwright/test'

const routes = ['/', '/capabilities', '/process', '/quality', '/projects', '/projects/warehouse-newcastle', '/products', '/team', '/contact', '/privacy']

for (const route of routes) {
  test(`${route} has one h1, labelled inputs and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const res = await page.goto(route)
    expect(res?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveCount(1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    for (const img of await page.locator('main img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull()
    }
    for (const input of await page.locator('main input:not([type="hidden"]), main select, main textarea').all()) {
      const id = await input.getAttribute('id')
      expect(id, 'form control needs an id').toBeTruthy()
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
    }
  })
}

test('keyboard focus reaches the skip link and header', async ({ page, browserName }) => {
  // Safari's defaults leave links out of the Tab order (its "Press Tab to
  // highlight each item" preference is off), so WebKit tabs straight past the
  // skip link into form controls. That is browser behaviour, not a page defect:
  // the link is the first focusable element and is revealed on focus. Chromium
  // covers the assertion.
  test.skip(browserName === 'webkit', 'WebKit excludes links from the Tab order by default.')
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '#main')
})


