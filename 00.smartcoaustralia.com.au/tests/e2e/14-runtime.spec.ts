import { test, expect } from '@playwright/test'

/**
 * Runtime smoke: the two endpoints a deploy is judged by.
 *
 * Against `npm run dev` this only proves the routes exist; the real signal is
 * running the same assertions against `npm run start` after a production build
 * (see README → "Build and run in production" / Task 16 verification).
 */
test('health and one CMS page respond on the production server', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ ok: true, db: 'up' })

  expect((await request.get('/projects')).status()).toBe(200)
})
