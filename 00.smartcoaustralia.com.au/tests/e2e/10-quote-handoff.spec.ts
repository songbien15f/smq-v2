import { test, expect } from '@playwright/test'

/**
 * Quotes are taken by the SmartQuote web app. The site renders its CTA links
 * straight to the app and keeps `/quote` as a redirect for old links. The app
 * itself is not running under test, so only the hrefs and the redirect target
 * are checked, never the page behind them.
 */
const APP_QUOTE = /^https?:\/\/[^/]+\/quote\?/

test('header CTA points at the SmartQuote guest flow', async ({ page }) => {
  await page.goto('/')
  const href = await page.locator('header a[data-cta]').getAttribute('href')
  expect(href).toMatch(APP_QUOTE)
  const url = new URL(href!)
  expect(url.searchParams.get('step')).toBe('start')
  expect(url.searchParams.get('src')).toBe('intro')
})

test('/quote redirects to the app and forwards the query', async ({ request }) => {
  const res = await request.get('/quote?utm_source=google', { maxRedirects: 0 })
  expect(res.status()).toBe(307)
  const url = new URL(res.headers()['location'])
  expect(url.pathname).toBe('/quote')
  expect(url.searchParams.get('step')).toBe('start')
  expect(url.searchParams.get('src')).toBe('intro')
  expect(url.searchParams.get('utm_source')).toBe('google')
})
