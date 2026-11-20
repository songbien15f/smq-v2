import 'dotenv/config'
import type { APIRequestContext } from '@playwright/test'

/**
 * Admin REST helpers for the e2e suite.
 *
 * Logging in through the `/admin` UI races with Payload's own post-login
 * redirect when several workers do it at once, so these helpers authenticate
 * against `POST /api/users/login` and pass the resulting cookie explicitly. The
 * module-level `cookie` caches it per worker process.
 */
let cookie: string | undefined

/**
 * Payload appends the new session to `users.sessions` on login. Two workers
 * logging in at the same instant can collide there — `deleteExistingArrayRows`
 * throws `Cannot read properties of undefined (reading '_parentID')` and the
 * endpoint answers 500. It is a transient race, not a credential problem, so a
 * 5xx gets a short, bounded retry. A 4xx (bad password, locked account) is
 * reported immediately.
 */
const LOGIN_ATTEMPTS = 4

export async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  if (cookie) return cookie

  let lastError = ''

  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt += 1) {
    const res = await request.post('/api/users/login', {
      data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
    })

    const raw = res.headers()['set-cookie'] ?? ''
    const token = raw.split(';')[0]?.trim()

    if (token) {
      cookie = token
      return cookie
    }

    lastError = `Admin login failed (${res.status()}): ${await res.text()}`

    if (res.status() < 500 || attempt === LOGIN_ATTEMPTS) break

    // Jittered backoff: without it the retries collide again.
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt + Math.random() * 250))
  }

  throw new Error(lastError)
}

/**
 * Count stored inquiries, optionally only those submitted from one page.
 *
 * The quote and contact specs both insert rows and assert "exactly one more
 * than before". Playwright runs spec files in parallel workers, so an unscoped
 * total can move between a spec's two reads because of the *other* spec's
 * insert. Scoping by `sourcePath` (the page each form stamps on its request)
 * gives each spec a private population and keeps the counts exact.
 */
export async function countInquiries(
  request: APIRequestContext,
  sourcePath?: string,
): Promise<number> {
  const token = await loginAsAdmin(request)
  const query = new URLSearchParams({ limit: '1', depth: '0' })
  if (sourcePath) query.set('where[sourcePath][equals]', sourcePath)

  const res = await request.get(`/api/inquiries?${query.toString()}`, {
    headers: { Cookie: token },
  })
  const json = (await res.json()) as { totalDocs?: number }
  return json.totalDocs as number
}
