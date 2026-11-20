import { test, expect } from '@playwright/test'

test('process page shows five ordered steps', async ({ page }) => {
  await page.goto('/process')
  const steps = page.locator('[data-testid="process-step"]')
  await expect(steps).toHaveCount(5)
  await expect(steps.nth(0).locator('h3')).toHaveText('Design & Engineering')
  await expect(steps.nth(4).locator('h3')).toHaveText('Door-to-Door Delivery')
})

test('process page serves the hero and step numbers in order', async ({ page }) => {
  const res = await page.goto('/process')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Our Process')
  await expect(page.locator('[data-testid="process-step"] .step-num')).toHaveText([
    '1',
    '2',
    '3',
    '4',
    '5',
  ])
})

test('process page links to the quote and quality views', async ({ page }) => {
  await page.goto('/process')
  const actions = page.locator('.hero-actions a')
  await expect(actions).toHaveCount(2)
  await expect(actions.nth(0)).toHaveText('Start Step 1 — Request a Quote')
  await expect(actions.nth(0)).toHaveAttribute('href', /^https?:\/\/[^/]+\/quote\?step=start&src=intro$/)
  await expect(actions.nth(1)).toHaveText('See the QA Documentation')
  await expect(actions.nth(1)).toHaveAttribute('href', '/quality')
})

test('process page has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/process')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('process page renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/process')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="process-step"]')).toHaveCount(5)
  await context.close()
})
