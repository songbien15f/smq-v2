import { test, expect } from '@playwright/test'

test('capabilities page lists seven capabilities', async ({ page }) => {
  const res = await page.goto('/capabilities')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toContainText('One accountable partner')
  await expect(page.locator('[data-testid="capability-card"]')).toHaveCount(7)
  await expect(page.locator('[data-testid="capability-card"]').first().locator('h3')).toHaveText('Steel Fabrication')
  await expect(page.locator('[data-testid="capability-card"]').first().locator('li')).toHaveCount(4)
})

test('capabilities page has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/capabilities')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('capabilities page renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/capabilities')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="capability-card"]')).toHaveCount(7)
  await context.close()
})

test('capability images keep descriptive alt text', async ({ page }) => {
  await page.goto('/capabilities')
  const images = page.locator('[data-testid="capability-card"] img')
  await expect(images).toHaveCount(2)
  for (const image of await images.all()) {
    expect((await image.getAttribute('alt'))?.trim()).toBeTruthy()
  }
})
