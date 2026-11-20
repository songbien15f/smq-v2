import { test, expect } from '@playwright/test'

test('projects page shows six cards and filters by sector and state', async ({ page }) => {
  await page.goto('/projects')
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(6)
  await page.getByRole('button', { name: 'Industrial', exact: true }).click()
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(4)
  await expect(page).toHaveURL(/sector=industrial/)
  await page.getByLabel('Filter by state').selectOption('NSW')
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(2)
  await expect(page).toHaveURL(/sector=industrial.*state=NSW|state=NSW.*sector=industrial/)
})

test('project detail shows overview and scope', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  await expect(page.locator('h1')).toHaveText('Distribution Warehouse')
  await expect(page.locator('[data-testid="project-scope"] li')).toHaveCount(5)
  await expect(page.locator('main')).toContainText('Newcastle, NSW')
})

test('project cards use the short card summary and three meta chips', async ({ page }) => {
  await page.goto('/projects')

  const cards = page.locator('[data-testid="project-card"]')
  await expect(cards).toHaveCount(6)

  // The first card is the seeded Newcastle warehouse, in `order` sequence.
  const first = cards.first()
  await expect(first.locator('h3')).toHaveText('Distribution Warehouse')
  await expect(first.locator('.project-body > p')).toHaveText(
    'Large-span distribution warehouse — full structural package fabricated, inspected and shipped door to door.',
  )
  // Assert it is the short card copy, not the longer detail intro.
  await expect(first.locator('.project-body > p')).not.toContainText('A large-span distribution warehouse for Newcastle')

  await expect(first.locator('.project-meta span')).toHaveCount(3)
  await expect(first.locator('.project-meta span').nth(0)).toHaveText('Industrial')
  await expect(first.locator('.project-meta span').nth(1)).toHaveText('Large-span warehouse frame')
  await expect(first.locator('.project-meta span').nth(2)).toHaveText('Door-to-door delivery')

  // Every card carries its own third chip.
  const tags = ['Door-to-door delivery', 'Trial assembly', 'AS/NZS 1554.1 welding', 'Long-span trusses', 'Single shipment', 'Repeatable bays']
  for (const [index, tag] of tags.entries()) {
    const card = cards.nth(index)
    await expect(card.locator('.project-meta span')).toHaveCount(3)
    await expect(card.locator('.project-meta span').nth(2)).toHaveText(tag)
  }
})

test('unknown project slug returns 404', async ({ page }) => {
  const res = await page.goto('/projects/does-not-exist')
  expect(res?.status()).toBe(404)
  await expect(page.locator('body')).toContainText('not found')
})

test('projects page counts match the seed data', async ({ page }) => {
  await page.goto('/projects?sector=industrial')
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(4)
  await page.goto('/projects?state=NSW')
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(3)
})

test('featured project card is labelled and links to its detail page', async ({ page }) => {
  await page.goto('/projects')
  const featured = page.locator('[data-testid="featured-project"]')
  await expect(featured).toHaveCount(1)
  await expect(featured).toContainText('Featured Project')
  await expect(featured).toContainText('Distribution Warehouse')
  await expect(featured.locator('a')).toHaveAttribute('href', '/projects/warehouse-newcastle')
})

test('projects page is filtered on the server without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const res = await page.goto('/projects?sector=industrial&state=NSW')
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-testid="project-card"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="project-card"]').first()).toContainText(
    'Distribution Warehouse',
  )
  await context.close()
})

test('project detail renders its copy without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/projects/warehouse-newcastle')
  await expect(page.locator('main')).toContainText('Project overview')
  await expect(page.locator('main')).toContainText('Our scope')
  await expect(page.locator('[data-testid="project-scope"] li')).toHaveCount(5)
  await context.close()
})

test('project detail exposes title, description and canonical metadata', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  await expect(page).toHaveTitle(/Distribution Warehouse/)
  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute('href', /\/projects\/warehouse-newcastle$/)
  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute('content', /large-span distribution warehouse/i)
})

test('projects pages have no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/projects')
  const listOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(listOverflow).toBeLessThanOrEqual(0)

  await page.goto('/projects/warehouse-newcastle')
  const detailOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(detailOverflow).toBeLessThanOrEqual(0)
})

test('project images keep descriptive alt text', async ({ page }) => {
  await page.goto('/projects')
  const images = page.locator('[data-testid="project-card"] img')
  await expect(images).toHaveCount(6)
  for (const image of await images.all()) {
    expect((await image.getAttribute('alt'))?.trim()).toBeTruthy()
  }
})

test('project detail renders the three delivery stages from the template global', async ({
  page,
}) => {
  await page.goto('/projects/warehouse-newcastle')
  await expect(page.getByRole('heading', { name: 'How it was delivered' })).toBeVisible()
  const figures = page.locator('[data-testid="project-stages"] figure')
  await expect(figures).toHaveCount(3)

  const expected = [
    '1 · Tekla shop drawings',
    '2 · Fabrication & inspection',
    '3 · Connections checked',
  ]

  for (const [index, title] of expected.entries()) {
    const figure = figures.nth(index)
    await expect(figure.locator('figcaption strong')).toHaveText(title)
    await expect(figure.locator('figcaption')).toContainText(title)
    expect((await figure.locator('img').getAttribute('alt'))?.trim()).toBeTruthy()
  }
})

test('project detail renders the six QA documents', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  await expect(page.getByRole('heading', { name: 'QA documentation supplied' })).toBeVisible()
  await expect(page.locator('[data-testid="project-qa-docs"] .chip')).toHaveCount(6)
  await expect(page.locator('[data-testid="project-qa-docs"]')).toContainText(
    'CC3 material traceability report',
  )
})

test('project facts card shows all six fact labels', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  const facts = page.locator('aside.facts-card')
  for (const label of [
    'Location',
    'Sector',
    'Structure',
    'Fabrication',
    'Standards',
    'Delivery',
  ]) {
    await expect(facts.locator('dt', { hasText: label })).toHaveCount(1)
  }

  await expect(facts).toContainText('Vietnam — partner factory matched to project size')
  await expect(facts).toContainText('Welding to AS/NZS 1554.1 · CC3 traceability')
  await expect(facts).toContainText('Door to door — factory to site, paperwork included')
  await expect(facts.getByRole('link', { name: 'Contact the team' })).toHaveAttribute(
    'href',
    '/contact',
  )
})

test('project detail navigation wraps previous and next in template order', async ({ page }) => {
  await page.goto('/projects/warehouse-newcastle')
  const nav = page.locator('.detail-nav')
  await expect(nav.getByRole('link', { name: '← Previous: Industrial Building' })).toHaveAttribute(
    'href',
    '/projects/industrial-newcastle',
  )
  await expect(nav.getByRole('link', { name: 'Next: Feed Lot →' })).toHaveAttribute(
    'href',
    '/projects/feedlot-bega',
  )
  await expect(nav.getByRole('link', { name: '← All Projects' })).toHaveAttribute(
    'href',
    '/projects',
  )
})
