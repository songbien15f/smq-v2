import { test, expect } from '@playwright/test'
import { countInquiries } from './helpers/admin'

/**
 * Submitting the contact form creates a row, so this runs once and in serial
 * mode: the count assertions would be disturbed by a second project (mobile)
 * inserting rows in parallel.
 */
test.skip(({ isMobile }) => isMobile, 'Contact submissions insert rows; run once to keep counts exact.')
test.describe.configure({ mode: 'serial' })

/**
 * The API allows five submissions per IP per ten minutes. Every worker would
 * otherwise share 127.0.0.1, so one full run plus a rerun could trip the limit.
 * Each worker sends its own synthetic forwarded-for address instead, which is
 * the header the route rate-limits on in production.
 */
const workerIp = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(
  Math.random() * 250,
)}.${Math.floor(Math.random() * 250)}`
test.use({ extraHTTPHeaders: { 'x-forwarded-for': workerIp } })

test('map embeds fall back to a directions panel when OpenStreetMap is blocked', async ({
  page,
}) => {
  // Deterministic version of "the office network blocks openstreetmap.org":
  // every request to the embed host is aborted, so the client probe rejects and
  // each map swaps in the fallback panel.
  await page.route('**openstreetmap.org/**', (route) => route.abort())
  await page.goto('/contact')

  const fallbacks = page.locator('[data-testid="map-fallback"]')
  await expect(fallbacks).toHaveCount(2)

  for (const fallback of await fallbacks.all()) {
    // The office label survives, and so does a working hand-off to maps.
    await expect(fallback.locator('.map-fallback-label')).not.toBeEmpty()
    const link = fallback.getByRole('link', { name: 'Get directions' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d/,
    )
  }

  // The success-path selector still exists for the unblocked case; the blocked
  // iframes are hidden rather than removed.
  await expect(page.locator('iframe[title^="Map of"]')).toHaveCount(2)

  // Either way the visitor can still navigate: the caption link is present.
  await expect(page.locator('.map-card-caption a')).toHaveCount(2)
})

test('contact page shows three offices, two maps and stores an inquiry', async ({ page, request }) => {
  await page.goto('/contact')
  await expect(page.locator('[data-testid="office-card"]')).toHaveCount(3)
  await expect(page.locator('iframe[title^="Map of"]')).toHaveCount(2)

  const before = await countInquiries(request, '/contact')
  await page.getByLabel('Full name').fill('Contact Tester')
  await page.getByLabel('Email').fill('contact@example.com')
  // Exact: the section is named "Talk to the office closest to your project",
  // so a substring label match would also hit the labelled region.
  await page.getByLabel('Office', { exact: true }).selectOption({
    label: 'Ho Chi Minh City — Vietnam Office',
  })
  await page.getByLabel('Enquiry type').selectOption({ label: 'General enquiry' })
  await page.getByLabel('Message').fill('Please send compliance documents.')
  await page.getByLabel(/consent/i).check()
  await page.getByRole('button', { name: 'Send Message' }).click()
  await expect(page.getByText('Thank you')).toBeVisible()
  expect(await countInquiries(request, '/contact')).toBe(before + 1)
})
