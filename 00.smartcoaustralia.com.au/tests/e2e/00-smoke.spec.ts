import { test, expect } from '@playwright/test'

test('health endpoint reports the database is up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true, db: 'up' })
})

test('home renders the hero heading', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toContainText('Australian-standard steel')
})

test('admin login page renders', async ({ page }) => {
  // Warm the route first: the first dev-server request compiles the admin bundle,
  // an unrelated cold-start cost that must not count against the assertion below.
  await page.request.get('/admin')
  await page.goto('/admin')
  await expect(page.locator('form')).toBeVisible()
})
