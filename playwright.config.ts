import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke suite: the flows that unit tests cannot see.
 *
 * ## Why this exists
 *
 * Three defects shipped in one afternoon with 1,300 green unit tests behind them: Save on Settings
 * answered 422 because the client echoed a `version` key the schema refuses; a saved quote opened
 * "dirty" so the leave-page guard fired on a page nobody had touched, and importing a pricing helper
 * into a client component pulled `node:fs` into the browser bundle and took the whole app down. Each
 * was invisible to a test that renders one component with mocked dependencies, and each took a
 * browser to find. This file is that browser, run on demand.
 *
 * ## It drives the real servers, not a mock
 *
 * `baseURL` is the running client (3061), which talks to the running API (3060) and the dev Postgres.
 * That is the only configuration in which these three defects appear. Start the app first:
 *
 *     pnpm dev            # then, in another shell
 *     pnpm test:e2e
 *
 * ## Chrome, not a downloaded browser
 *
 * `channel: 'chrome'` uses the Chrome already on the machine — the same binary the PDF renderer
 * needs — so `npx playwright install` is not part of setup and the suite works offline.
 *
 * ## One worker
 *
 * The specs share one database and one company's settings; parallel workers would race over the
 * settings version and the quote counter.
 */
/**
 * Read the vendor password from the environment the app actually uses.
 *
 * The dashboard's password lives in `.env` (or the deployment's environment), and this suite needs the
 * same value to sign in. `process.env` alone is empty when Playwright is started without
 * `--env-file`, so the file is read directly — the alternative is a suite that silently skips every
 * dashboard test, which is what it did on the first run.
 *
 * Read here rather than in the spec so the value reaches `process.env` for **both** this file's skip
 * decision and the test that types it.
 */
function loadVendorPassword(): void {
  if (process.env.VENDOR_DASHBOARD_PASSWORD !== undefined) return;
  for (const file of ['.env', 'apps/client/.env.local']) {
    try {
      const text = readFileSync(file, 'utf8');
      const match = /^VENDOR_DASHBOARD_PASSWORD=(.*)$/m.exec(text);
      if (match === null) continue;
      const value = (match[1] ?? '').trim().replace(/^["']|["']$/g, '');
      if (value !== '') {
        process.env.VENDOR_DASHBOARD_PASSWORD = value;
        return;
      }
    } catch {
      // A missing file is normal in CI; the skip in the spec then reports why.
    }
  }
}

loadVendorPassword();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3061',
    channel: 'chrome',
    headless: process.env.E2E_HEADED === '1' ? false : true,
    viewport: { width: 1440, height: 950 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    /*
     * Signing in is its own project, and every flow depends on it. One browser context per test
     * otherwise means one **session** per test, and a session holds a seat — six tests would take
     * six of a five-seat licence and the suite would refuse to run twice.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chrome',
      testMatch: /(smoke|layout|legacyImport)\.spec\.ts/,
      dependencies: ['setup'],
      /*
       * And it signs out when the last flow is done. A seat belongs to a session, a five-seat company
       * answers 403 when they are all held, and a suite that leaves its session behind fills the
       * licence after a handful of runs — then fails with a message about seats instead of about the
       * product.
       */
      teardown: 'teardown',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: 'e2e/.auth/state.json' },
    },
    {
      /*
       * The vendor dashboard, in its own project with **no storageState**.
       *
       * It is not part of the product's session: it has its own password and its own cookie. Sharing
       * the `chrome` project would do two wrong things — it would inherit a product session the page
       * never uses, and it would inherit a `sq_vendor` cookie left by a previous run, so the "wrong
       * password" test would start already signed in and be redirected past the form it is testing.
       */
      name: 'vendor',
      testMatch: /vendorDashboard\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'teardown',
      testMatch: /auth\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: 'e2e/.auth/state.json' },
    },
  ],
});
