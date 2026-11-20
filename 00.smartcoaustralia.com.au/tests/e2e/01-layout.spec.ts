import { test, expect } from '@playwright/test'

test('header shows the eight fixed links and the quote CTA', async ({ page }) => {
  await page.goto('/')
  const links = page.locator('header nav a[data-nav]')
  await expect(links).toHaveCount(8)
  await expect(links.nth(0)).toHaveAttribute('href', '/')
  await expect(links.nth(1)).toHaveAttribute('href', '/capabilities')
  await expect(links.nth(7)).toHaveAttribute('href', '/contact')
  await expect(page.locator('header a[data-cta]')).toHaveText('Request a Quote')
  await expect(page.locator('header a[data-nav="/"]')).toHaveAttribute('aria-current', 'page')
})

test('footer shows compliance items and copyright', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('footer')).toContainText('ISO 9001')
  await expect(page.locator('footer')).toContainText('CC3 Traceability')
  await expect(page.locator('footer')).toContainText('Smart Solutions Australia')
})

test('mobile drawer opens, closes on Escape, and does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Open menu' })
  await toggle.click()
  await expect(page.locator('header nav')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('mobile drawer exposes the quote CTA and expanded state', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const toggle = page.locator('header .nav-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()

  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('header nav')).toBeVisible()
  const quote = page.locator('header nav a.nav-quote')
  await expect(quote).toBeVisible()
  await expect(quote).toHaveText('Request a Quote')
})

test.describe('without client JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } })

  test('mobile navigation and quote CTA are visible at 375px', async ({ page }) => {
    await page.goto('/')
    const links = page.locator('header nav a[data-nav]')
    await expect(links).toHaveCount(8)
    for (let index = 0; index < 8; index += 1) {
      await expect(links.nth(index)).toBeVisible()
    }
    await expect(page.locator('header nav a.nav-quote')).toBeVisible()
    await expect(page.locator('header nav a.nav-quote')).toHaveText('Request a Quote')
    await expect(page.locator('header .nav-toggle')).toBeHidden()
  })
})

test('top strip shows both locations, the AU phone link and the email link', async ({ page }) => {
  await page.goto('/')
  const strip = page.locator('.topstrip')
  await expect(strip).toHaveCount(1)
  await expect(strip).toContainText('Sydney, Australia')
  await expect(strip).toContainText('Ho Chi Minh City, Vietnam')
  await expect(strip.locator('a[href^="tel:"]')).toHaveText('AU +61 412 239 259')
  await expect(strip.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+61412239259')
  const mail = strip.locator('a[href^="mailto:"]')
  await expect(mail).toHaveText('info@smartsolutionsaustralia.com.au')
  await expect(mail).toHaveAttribute('href', 'mailto:info@smartsolutionsaustralia.com.au')
})

test('capabilities breadcrumb names the current page', async ({ page }) => {
  await page.goto('/capabilities')
  const crumb = page.locator('nav[aria-label="Breadcrumb"]')
  await expect(crumb).toHaveCount(1)
  await expect(crumb.locator('a')).toHaveText(['Home'])
  await expect(crumb.locator('a')).toHaveAttribute('href', '/')
  await expect(crumb.locator('[aria-current="page"]')).toHaveText('Capabilities')
})

test('project detail breadcrumb links Home and Projects', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  const crumb = page.locator('nav[aria-label="Breadcrumb"]')
  await expect(crumb.locator('a')).toHaveCount(2)
  await expect(crumb.locator('a').nth(0)).toHaveText('Home')
  await expect(crumb.locator('a').nth(0)).toHaveAttribute('href', '/')
  await expect(crumb.locator('a').nth(1)).toHaveText('Projects')
  await expect(crumb.locator('a').nth(1)).toHaveAttribute('href', '/projects')
  await expect(crumb.locator('[aria-current="page"]')).toHaveText('Distribution Warehouse')
})
