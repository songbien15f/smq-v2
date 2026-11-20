import { test, expect } from '@playwright/test'

test('quality page lists eight QA documents and the ISO paragraph', async ({ page }) => {
  await page.goto('/quality')
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(8)
  await expect(page.locator('[data-testid="qa-item"]').first()).toContainText('Inspection Test Plan')
  await expect(page.locator('main')).toContainText('ISO 9001:2015')
  await expect(page.locator('main')).toContainText('AS/NZS 4680')
})

test('quality page serves the hero and every management system', async ({ page }) => {
  const res = await page.goto('/quality')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Compliance & Quality')
  await expect(page.locator('main')).toContainText('ISO 14001:2015')
  await expect(page.locator('main')).toContainText('ISO 45001:2018')
  await expect(page.locator('main')).toContainText('Modern Slavery Act 2018 (Cth)')
})

test('quality page keeps the QA list semantics accessible', async ({ page }) => {
  await page.goto('/quality')
  const list = page.locator('ul.qa-list')
  await expect(list).toHaveAttribute('role', 'list')
  const items = page.locator('[data-testid="qa-item"]')
  await expect(items.nth(1)).toContainText('WPS, PQR & WPR')
  await expect(items.nth(2)).toContainText('Mill Certificates & Test Reports')
  await expect(items.nth(5)).toContainText('AS/NZS 4680')
})

test('quality page has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/quality')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('quality page renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/quality')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(8)
  await expect(page.locator('main')).toContainText('ISO 9001:2015')
  await context.close()
})

test('quality photo keeps descriptive alt text', async ({ page }) => {
  await page.goto('/quality')
  const image = page.locator('.quality-photo img').first()
  await expect(image).toHaveAttribute('alt', /bolted structural steel connection/i)
})
