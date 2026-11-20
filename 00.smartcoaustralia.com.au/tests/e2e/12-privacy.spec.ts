import { test, expect } from '@playwright/test'

/**
 * The privacy policy is a single legal document, so the tests pin the things a
 * reader and a compliance reviewer rely on: the required phrases and date, the
 * sixteen anchored sections in the order the policy numbers them, real bullet
 * lists, one `h1` above them, a readable measure, and AA contrast in the dark
 * scheme. It is also reachable from the footer on every page.
 */

const SECTION_IDS = [
  'who-we-are',
  'scope',
  'what-we-collect',
  'how-we-collect',
  'why-we-use',
  'cookies',
  'disclosure',
  'overseas',
  'security',
  'retention',
  'access-correction',
  'direct-marketing',
  'complaints',
  'links',
  'changes',
  'contact-us',
] as const

test('privacy page renders the policy and is linked from the footer', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.locator('h1')).toHaveText('Privacy Policy')
  await expect(page.locator('main')).toContainText('Privacy Act 1988 (Cth)')
  await expect(page.locator('main')).toContainText('Office of the Australian Information Commissioner')
  await expect(page.locator('main')).toContainText('18 November 2026')
  await page.goto('/')
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible()
})

test('every policy section heading carries its stable anchor id', async ({ page }) => {
  await page.goto('/privacy')

  for (const id of SECTION_IDS) {
    await expect(page.locator(`main h2#${id}`)).toHaveCount(1)
  }

  // The ids belong to the numbered sections, in the policy's own order.
  const ids = await page.locator('main h2').evaluateAll((nodes) => nodes.map((n) => n.id))
  expect(ids).toEqual([...SECTION_IDS])
  await expect(page.locator('#scope')).toHaveText('2. Scope of this policy')
  await expect(page.locator('#contact-us')).toHaveText('16. Contact us')
})

test('policy keeps one h1 and never skips a heading level', async ({ page }) => {
  await page.goto('/privacy')

  const levels = await page
    .locator('main h1, main h2, main h3, main h4, main h5, main h6')
    .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))))

  expect(levels.filter((level) => level === 1)).toHaveLength(1)
  expect(levels[0]).toBe(1)
  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1)
  }
})

test('policy renders the bullet lists and the OAIC contact block', async ({ page }) => {
  await page.goto('/privacy')

  // Six of the sixteen sections are lists in Appendix A (3, 4, 5, 7, 13, 16),
  // holding 28 bullets in total.
  await expect(page.locator('main .policy-prose ul')).toHaveCount(6)
  await expect(page.locator('main .policy-prose li')).toHaveCount(28)

  // The OAIC contact block closes the complaints section, as a real list.
  await expect(
    page.locator('main .policy-prose li', { hasText: 'https://www.oaic.gov.au' }),
  ).toHaveCount(1)
  await expect(
    page.locator('main .policy-prose li', { hasText: '1300 363 992' }),
  ).toHaveCount(1)
})

test('policy renders without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/privacy')

  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Privacy Policy')
  await expect(page.locator('main')).toContainText('Australian Privacy Principles (APPs)')
  await expect(page.locator('main h2#direct-marketing')).toHaveText('12. Direct marketing')
  await context.close()
})

test('policy text keeps a readable measure and fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/privacy')

  const box = await page.locator('main .policy-prose').boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(400)
  // Around 70 characters at the body size; anything wider loses the reader.
  expect(box?.width ?? 0).toBeLessThanOrEqual(760)

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/privacy')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('policy body text meets AA contrast in the dark scheme', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto('/privacy')

  const ratio = await page.locator('main .policy-prose p').first().evaluate((element) => {
    const channels = (value: string) =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = ([r, g, b]: number[]) => {
      const channel = (raw: number) => {
        const value = raw / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    let node: HTMLElement | null = element as HTMLElement
    let background = 'rgb(255, 255, 255)'
    while (node) {
      const colour = getComputedStyle(node).backgroundColor
      if (colour && !colour.startsWith('rgba(0, 0, 0, 0)')) {
        background = colour
        break
      }
      node = node.parentElement
    }

    const [light, dark] = [
      luminance(channels(getComputedStyle(element).color)),
      luminance(channels(background)),
    ].sort((a, b) => b - a)

    return (light + 0.05) / (dark + 0.05)
  })

  expect(ratio).toBeGreaterThanOrEqual(4.5)
  await context.close()
})

test('policy exposes its title, canonical URL and description metadata', async ({ page }) => {
  await page.goto('/privacy')

  await expect(page).toHaveTitle(/Privacy Policy/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/privacy$/)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Privacy Act 1988 \(Cth\)/,
  )
})
