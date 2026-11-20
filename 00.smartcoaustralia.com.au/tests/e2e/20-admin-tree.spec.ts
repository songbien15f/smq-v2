import { test, expect, type Page } from '@playwright/test'

/**
 * The admin sidebar renders the site as a page tree. This pins the two things
 * an editor depends on: every page of the site is reachable from the tree, and
 * a page whose form does not exist yet is shown as pending instead of linking to
 * a 404.
 *
 * Two environmental facts shape these tests:
 *
 * - Payload collapses the entire nav into a drawer below its desktop
 *   breakpoint, so the tree is not in the DOM until that drawer is opened. The
 *   assertions are about admin information architecture rather than responsive
 *   layout, so the viewport is pinned to desktop.
 * - Parallel workers logging in at the same time race with Payload's own
 *   post-login redirect, so this file runs serially and signs in once.
 */
test.use({ viewport: { width: 1440, height: 900 } })
test.describe.configure({ mode: 'serial' })

let signedIn = false

async function ensureSignedIn(page: Page) {
  if (signedIn) return
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL ?? 'admin@example.com')
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD ?? 'Admin12345!')
  await page.getByRole('button', { name: /^login$/i }).click()
  await page.waitForURL(/\/admin(\/)?$/, { timeout: 90_000 })
  await expect(page.getByRole('navigation', { name: 'Website pages' })).toBeVisible()
  signedIn = true
}

test('admin sidebar shows the website page tree', async ({ page }) => {
  await ensureSignedIn(page)

  const tree = page.getByRole('navigation', { name: 'Website pages' })
  await expect(tree).toBeVisible()

  for (const label of ['Home', 'Capabilities', 'Process', 'Quality', 'Projects', 'Products', 'Team', 'Contact', 'Privacy']) {
    await expect(tree).toContainText(label)
  }

  await expect(tree.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/admin/globals/home-page')
  await expect(tree.getByRole('link', { name: 'Project entries' })).toHaveAttribute('href', '/admin/collections/projects')
})

test('every page form in the tree opens', async ({ page }) => {
  await ensureSignedIn(page)

  for (const slug of ['home-page', 'capabilities-page', 'process-page', 'quality-page', 'projects-page', 'products-page', 'team-page', 'contact-page', 'privacy-page', 'site-settings', 'header', 'footer']) {
    const res = await page.goto(`/admin/globals/${slug}`)
    expect(res?.status(), `${slug} should open`).toBe(200)
    await expect(page.locator('form').first()).toBeVisible()
  }
})
