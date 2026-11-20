import { test, expect } from '@playwright/test'

test('team page shows three members in order', async ({ page }) => {
  await page.goto('/team')
  const cards = page.locator('[data-testid="team-member"]')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0).locator('h3')).toHaveText('John Walker')
  await expect(cards.nth(1).locator('h3')).toHaveText('Quynh Pham')
  await expect(cards.nth(2).locator('h3')).toHaveText('Lionel Trotman')
})

test('team page serves the hero and section heading', async ({ page }) => {
  const res = await page.goto('/team')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Our Team')
  await expect(page.locator('main')).toContainText('Experts in the Industry')
  await expect(page.locator('main')).toContainText('The people behind your steel')
  await expect(page.locator('main')).toContainText(
    'A small, senior team — you deal with the decision-makers in Sydney',
  )
  const contact = page.getByRole('link', { name: 'Contact the Team' })
  await expect(contact).toHaveAttribute('href', '/contact')
})

test('team member cards show the role and short bio of each person', async ({ page }) => {
  await page.goto('/team')
  const cards = page.locator('[data-testid="team-member"]')
  await expect(cards.nth(0).locator('.team-role')).toHaveText('Founding Director')
  await expect(cards.nth(1).locator('.team-role')).toHaveText('Manager — Vietnam')
  await expect(cards.nth(2).locator('.team-role')).toHaveText('Design & Compliance')
  await expect(cards.nth(0)).toContainText("Vietnam's steel potential")
  await expect(cards.nth(2)).toContainText('more than 2,000 delivered projects')
})

test('every team member image has non-empty alt text', async ({ page }) => {
  await page.goto('/team')
  const cards = page.locator('[data-testid="team-member"]')
  await expect(cards).toHaveCount(3)
  for (const card of await cards.all()) {
    const photo = card.locator('img')
    const initials = card.locator('.team-initials')
    const photoCount = await photo.count()
    if (photoCount > 0) {
      await expect(photo.first()).toHaveAttribute('alt', /\S+/)
    } else {
      await expect(initials.first()).toBeVisible()
    }
  }
})

test('team page renders the closing quote band', async ({ page }) => {
  await page.goto('/team')
  const band = page.locator('figure.team-wide')
  await expect(band).toHaveCount(1)
  await expect(band.locator('figcaption')).toContainText(
    'one team follows your steel the whole way',
  )
  await expect(band.locator('img')).toHaveAttribute('alt', /\S+/)
})

test('team page is keyed to its own heading', async ({ page }) => {
  await page.goto('/team')
  const section = page.locator('section#team')
  await expect(section).toHaveAttribute('aria-labelledby', 'team-h')
  await expect(page.locator('#team-h')).toHaveText('The people behind your steel')
})

test('team page renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/team')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="team-member"]')).toHaveCount(3)
  await expect(page.locator('section#team')).toContainText('Lionel Trotman')
  await expect(page.locator('figure.team-wide figcaption')).toContainText('drafting office')
  await context.close()
})

test('team page has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/team')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('team page exposes title and description metadata', async ({ page }) => {
  await page.goto('/team')
  await expect(page).toHaveTitle(/Our Team/)
  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute('href', /\/team$/)
  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute('content', /The people behind your steel/i)
})
