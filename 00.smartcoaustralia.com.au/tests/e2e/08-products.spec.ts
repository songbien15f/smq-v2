import { test, expect } from '@playwright/test'

test('products page shows two groups and all items', async ({ page }) => {
  await page.goto('/products')
  await expect(page.locator('[data-testid="product-group"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="product-item"]')).toHaveCount(17)
  await expect(page.locator('main')).toContainText('Substation Steel Poles')
  await expect(page.locator('main')).toContainText('Powder-Coated Louvres')
})

test('products page serves the hero and section heading', async ({ page }) => {
  const res = await page.goto('/products')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Products')
  await expect(page.locator('main')).toContainText('Our Products')
  await expect(page.locator('main')).toContainText('Beyond the frame')
  await expect(page.locator('main')).toContainText(
    'We can supply any steel and aluminium product to your requirements.',
  )
})

test('products page lists the groups in seed order with their items', async ({ page }) => {
  await page.goto('/products')
  const groups = page.locator('[data-testid="product-group"]')
  await expect(groups.nth(0).locator('h3')).toHaveText('Structural & Architectural')
  await expect(groups.nth(1).locator('h3')).toHaveText('Telecom & Energy')
  await expect(groups.nth(0).locator('[data-testid="product-item"]')).toHaveCount(9)
  await expect(groups.nth(1).locator('[data-testid="product-item"]')).toHaveCount(8)
  await expect(groups.nth(1)).toContainText('Transmission Line Poles')
  await expect(groups.nth(1)).toContainText('Scaffolding & Galvanised Steel')
})

test('product lists keep their list semantics', async ({ page }) => {
  await page.goto('/products')
  const lists = page.locator('ul.product-list')
  await expect(lists).toHaveCount(2)
  for (const list of await lists.all()) {
    await expect(list).toHaveAttribute('role', 'list')
  }
})

test('products page is keyed to its own heading', async ({ page }) => {
  await page.goto('/products')
  const section = page.locator('section.products')
  await expect(section).toHaveAttribute('aria-labelledby', 'products-h')
  await expect(page.locator('#products-h')).toHaveText('Beyond the frame')
})

test('products page renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/products')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="product-group"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="product-item"]')).toHaveCount(17)
  await context.close()
})

test('products page has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/products')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('products page exposes title and description metadata', async ({ page }) => {
  await page.goto('/products')
  await expect(page).toHaveTitle(/Products/)
  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute('href', /\/products$/)
  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute('content', /steel or aluminium product/i)
})
