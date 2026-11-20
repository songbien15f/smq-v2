import { test, expect } from '@playwright/test'

test('home shows the hero, stats, certifications, explore cards and featured project', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Australian-standard steel')
  await expect(page.locator('[data-testid="stat"]')).toHaveCount(4)
  await expect(page.locator('[data-testid="certification"]')).toHaveCount(6)
  await expect(page.locator('[data-testid="explore-card"]')).toHaveCount(6)
  await expect(page.locator('[data-testid="featured-project"] a')).toHaveAttribute('href', '/projects/warehouse-newcastle')
})

test('the fourth hero stat carries the door-to-door copy', async ({ page }) => {
  await page.goto('/')
  const stats = page.locator('[data-testid="stat"]')
  await expect(stats).toHaveCount(4)

  const fourth = stats.nth(3)
  await expect(fourth.locator('.stat-num')).toContainText('Door → Door')
  await expect(fourth.locator('.stat-num .stat-accent')).toHaveText('→')
  await expect(fourth.locator('.stat-label')).toHaveText(
    'Factory in Vietnam to your Australian site, paperwork included',
  )

  // The non-numeric value must not be run through CountUp.
  await expect(fourth.locator('.stat-num span:not(.stat-accent)')).toHaveCount(0)
})

test('the size-range stat renders its unit with the smaller accent treatment', async ({ page }) => {
  await page.goto('/')
  const third = page.locator('[data-testid="stat"]').nth(2)
  await expect(third.locator('.stat-num')).toContainText('20–10,000 t')
  await expect(third.locator('.stat-unit')).toHaveText(' t')

  const unitStyle = await third.locator('.stat-unit').evaluate((element) => {
    const style = getComputedStyle(element)
    return { fontSize: style.fontSize, color: style.color }
  })
  const numberSize = await third
    .locator('.stat-num')
    .evaluate((element) => getComputedStyle(element).fontSize)
  expect(parseFloat(unitStyle.fontSize)).toBeLessThan(parseFloat(numberSize))
  expect(unitStyle.color).toBe('rgb(255, 180, 174)')
})

test('home does not overflow at 375px and images keep alt text', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  for (const img of await page.locator('main img').all()) {
    expect(await img.getAttribute('alt')).not.toBeNull()
  }
})

test('office split renders the template copy verbatim', async ({ page }) => {
  await page.goto('/')
  const section = page.locator('.worlds')
  await expect(section.locator('.office-mini h3')).toHaveCount(2)
  await expect(section.locator('.office-mini').nth(0)).toContainText('Sydney Head Office')
  await expect(section.locator('.office-mini').nth(0)).toContainText(
    'Client relationships, engineering oversight and delivery accountability — Level 29, 66 Goulburn St, Sydney NSW 2000.',
  )
  await expect(section.locator('.office-mini').nth(1)).toContainText('Ho Chi Minh City Office')
  await expect(section.locator('.office-mini').nth(1)).toContainText(
    'Drafting, QA inspection and factory coordination on the ground, minutes from our partner fabrication plants.',
  )
  await expect(section.locator('figure.worlds-photo figcaption')).toContainText(
    'On the ground, every project.',
  )
  await expect(section.locator('figure.worlds-photo figcaption')).toContainText(
    'Founding Director John Walker and Vietnam Manager Quynh Pham at a trial assembly — the step that catches problems in the factory, not on your site.',
  )
  await expect(section.locator('figure.worlds-photo figcaption strong')).toHaveText(
    'On the ground, every project.',
  )
})

test('hero stat strip fits four items at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')

  const strip = page.locator('.hero-stats')
  await expect(strip.locator('[data-testid="stat"]')).toHaveCount(4)

  // `scrollWidth` must ignore the decorative scrim pseudo-element; the strip
  // itself must not overflow its column either.
  const stripOverflow = await strip.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  )
  expect(stripOverflow).toBeLessThanOrEqual(0)

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)

  // The widest values ("20–10,000 t" and "Door → Door") must stay inside their
  // own grid cells.
  for (const index of [2, 3]) {
    const inside = await page.evaluate((i) => {
      const stat = document.querySelectorAll('[data-testid="stat"]')[i] as HTMLElement | undefined
      const num = stat?.querySelector('.stat-num') as HTMLElement | null
      if (!stat || !num) return false
      const cell = stat.getBoundingClientRect()
      const value = num.getBoundingClientRect()
      return value.left >= cell.left - 1 && value.right <= cell.right + 1
    }, index)
    expect(inside, `stat ${index + 1} stays inside its cell`).toBe(true)
  }
})
