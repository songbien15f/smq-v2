import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * Section show/hide.
 *
 * Every page section carries a "Show this section" switch in the admin. The rule
 * is asymmetric on purpose: only an explicit `false` hides anything, so adding
 * the switch never blanked a live page. These tests pin the two ends of that
 * contract — hidden means gone from the HTML, and switching it back restores it.
 *
 * The suite talks to the Payload globals endpoint rather than clicking through
 * the admin form: the switch's value is what matters here, and the admin UI test
 * in `20-admin-tree.spec.ts` already covers the forms rendering.
 */
test.describe.configure({ mode: 'serial' })

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/users/login', {
    data: {
      email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
      password: process.env.ADMIN_PASSWORD ?? 'Admin12345!',
    },
  })
  expect(res.ok()).toBeTruthy()
  const raw = res.headers()['set-cookie'] ?? ''
  return raw.split(';')[0]
}

async function setFlag(
  request: APIRequestContext,
  cookie: string,
  slug: string,
  data: Record<string, boolean>,
) {
  const res = await request.post(`/api/globals/${slug}`, {
    headers: { Cookie: cookie },
    data,
  })
  expect(res.ok(), `update ${slug} failed with ${res.status()}`).toBeTruthy()
}

test('hiding and restoring a group section', async ({ page, request }) => {
  const cookie = await login(request)

  // Office split is a group section on the home page.
  await page.goto('/')
  await expect(page.locator('.worlds')).toHaveCount(1)

  await setFlag(request, cookie, 'home-page', { officeSplit: { visible: false } } as never)
  await page.goto('/')
  await expect(page.locator('.worlds')).toHaveCount(0)
  // The rest of the page is untouched.
  await expect(page.locator('[data-testid="stat"]')).toHaveCount(4)

  await setFlag(request, cookie, 'home-page', { officeSplit: { visible: true } } as never)
  await page.goto('/')
  await expect(page.locator('.worlds')).toHaveCount(1)
})

test('hiding and restoring an array section', async ({ page, request }) => {
  const cookie = await login(request)

  await page.goto('/quality')
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(8)

  await setFlag(request, cookie, 'quality-page', { qaItemsVisible: false })
  await page.goto('/quality')
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(0)
  // The intro heading still renders either way.
  await expect(page.locator('h1')).toHaveCount(1)

  await setFlag(request, cookie, 'quality-page', { qaItemsVisible: true })
  await page.goto('/quality')
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(8)
})

test('a hidden hero still leaves a usable page', async ({ page, request }) => {
  const cookie = await login(request)

  await setFlag(request, cookie, 'products-page', { hero: { visible: false } } as never)
  await page.goto('/products')
  // No hero, but the product groups are still there and no error page.
  await expect(page.locator('.page-hero')).toHaveCount(0)
  await expect(page.locator('[data-testid="product-group"]')).toHaveCount(2)

  await setFlag(request, cookie, 'products-page', { hero: { visible: true } } as never)
  await page.goto('/products')
  await expect(page.locator('.page-hero')).toHaveCount(1)
})
