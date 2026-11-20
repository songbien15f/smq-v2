import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 120_000,
  // Payload's admin route compiles on first request in dev mode; cold compilation can
  // take tens of seconds on a busy machine, so keep a wide assertion window.
  expect: { timeout: 90_000 },
  use: {
    baseURL: 'http://127.0.0.1:3065',
    navigationTimeout: 60_000,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3065',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: '3065', NEXT_PUBLIC_SERVER_URL: 'http://localhost:3065' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
})
