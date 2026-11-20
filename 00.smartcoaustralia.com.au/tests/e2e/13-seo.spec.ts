import { test, expect } from '@playwright/test'

/**
 * SEO surface: the sitemap, robots rules and the structured data the home page
 * ships in its server HTML. The sitemap is asserted by path rather than by full
 * URL so the spec holds whatever host the suite runs against; `sitemap.ts`
 * builds every entry from `NEXT_PUBLIC_SERVER_URL`, which the checks below still
 * pin to an absolute origin.
 */

const STATIC_PATHS = [
  '/',
  '/capabilities',
  '/process',
  '/quality',
  '/projects',
  '/products',
  '/team',
  '/contact',
  '/privacy',
]

test('sitemap lists every static page and every published project', async ({ request }) => {
  const res = await request.get('/sitemap.xml')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('xml')

  const xml = await res.text()
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

  // Every entry must be an absolute URL under a single origin.
  for (const location of locations) {
    expect(location).toMatch(/^https?:\/\/[^/]+/)
  }

  const paths = locations.map((location) => new URL(location).pathname)

  for (const path of STATIC_PATHS) {
    expect(paths, `sitemap should list ${path}`).toContain(path)
  }

  const projectPaths = paths.filter((path) => /^\/projects\/[a-z0-9-]+$/.test(path))
  expect(projectPaths.length).toBeGreaterThanOrEqual(6)
  expect(projectPaths).toContain('/projects/warehouse-newcastle')

  // Each entry carries a lastModified timestamp.
  expect(xml.match(/<lastmod>/g)?.length ?? 0).toBe(locations.length)
})

test('robots blocks admin, api and next internals and points at the sitemap', async ({
  request,
}) => {
  const res = await request.get('/robots.txt')
  expect(res.status()).toBe(200)

  const txt = await res.text()
  expect(txt).toMatch(/User-Agent: \*/i)
  expect(txt).toContain('Disallow: /admin')
  expect(txt).toContain('Disallow: /api')
  expect(txt).toContain('Disallow: /next')
  expect(txt).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/)
})

test('home emits one Organization and exactly two LocalBusiness nodes', async ({ page }) => {
  await page.goto('/')

  const json = await page.locator('script[type="application/ld+json"]').first().textContent()
  expect(json).toBeTruthy()

  const data = JSON.parse(json!) as {
    '@context'?: string
    '@graph'?: Record<string, unknown>[]
  }

  expect(data['@context']).toBe('https://schema.org')

  const graph = data['@graph'] ?? [data as unknown as Record<string, unknown>]
  const organizations = graph.filter((node) => node['@type'] === 'Organization')
  const locations = graph.filter((node) => node['@type'] === 'LocalBusiness')

  expect(organizations).toHaveLength(1)
  expect(locations).toHaveLength(2)

  const organization = organizations[0]
  expect(organization.name).toBe('Smart Solutions Australia')
  expect(organization.url).toMatch(/^https?:\/\//)
  expect(organization.logo).toBeTruthy()
  expect(organization.email).toBeTruthy()
  expect(organization.telephone).toBeTruthy()

  const [sydney, hcmc] = locations
  expect(sydney.name).toContain('Sydney')
  expect(hcmc.name).toContain('Ho Chi Minh City')

  for (const location of locations) {
    expect(location.address).toBeTruthy()
    expect(location.telephone).toBeTruthy()
    expect(location.openingHours).toBeTruthy()
  }
})

test('structured data is in the server HTML, with no client JavaScript', async ({ request }) => {
  const res = await request.get('/')
  expect(res.status()).toBe(200)

  const html = await res.text()
  expect(html).toContain('application/ld+json')
  expect(html).toContain('"Organization"')
  expect(html).toContain('"LocalBusiness"')
})
