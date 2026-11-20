# Smart Solutions Australia Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Smart Solutions Australia marketing site on Next.js 15 with Payload CMS 3 as an English-only content admin, preserving the supplied single-file template design.

**Architecture:** Next.js App Router with ten fixed routes. Payload runs in the same app under `/admin` and `/api`. Page content lives in typed globals; repeating data lives in collections. Server Components read Payload through the Local API; client components are limited to the mobile nav, project filter, reveal/count-up and the two forms. PostgreSQL 18 stores data in the `smartcoa` database; local disk stores media in `media/`.

**Tech Stack:** Next.js 15.4.11, React 19.2.6, Payload 3.88.0, `@payloadcms/db-postgres`, Lexical, template CSS + Tailwind v4, Zod, Nodemailer, Playwright, tsx.

**Spec:** `docs/superpowers/specs/2026-11-18-smart-solutions-website-design.md`

## Global Constraints

- Node.js >= 20.9.0 (current machine: Node 24.12.0).
- Pin versions: `next@15.4.11`, `react@19.2.6`, `react-dom@19.2.6`, `payload@3.88.0`, all `@payloadcms/*@3.88.0`.
- Site language `en-AU`. No i18n, no language switcher. Admin UI English.
- Fixed menu, in this order: Home, Capabilities, Process, Quality, Projects, Products, Team, Contact. Plus CTA "Request a Quote". There is no menu collection and no menu builder.
- Section order on every page is owned by React components. There is no block builder and no `Pages` collection.
- PostgreSQL 18 is running locally on port 5432. Local connection: `postgresql://postgres:123456@127.0.0.1:5432/smartcoa`. The `smartcoa` database already exists. Media at `media/` is gitignored and must be persistent in production.
- All marketing copy and images are editable in Payload. Only structural UI chrome (filter labels, aria labels, "View project details") may live in `src/lib/labels.ts`.
- Forms never accept file uploads. No analytics, no cookie banner, no newsletter.
- Every page must render its content without client-side JavaScript. Interactivity is progressive enhancement only.
- WCAG 2.2 AA: visible focus, 4.5:1 text contrast in light and dark, every form input has a label and error described by `aria-describedby`.
- Dark mode follows `prefers-color-scheme`. No toggle.
- Commit after each task with a conventional-commit message.

## Review Focus

1. `/projects/does-not-exist` must render the 404 page with status 404, not a stack trace or empty page. Test in Task 9.
2. With `MAIL_ENABLED=false` or no `SMTP_HOST`, quote and contact submissions must still return success and persist the inquiry. Test in Tasks 12 and 13.
3. Invalid email, missing name, or missing consent must return 400 with field-level errors and create no inquiry row. Test in Task 12.
4. With no project flagged `featured`, the home page must omit the featured section cleanly instead of rendering an empty card. `pickFeatured` returns null (unit test in Task 4) and `FeaturedProject` renders nothing (Task 5).
5. At 375px in dark mode there must be no horizontal scroll, and the mobile drawer must open, trap focus, close on Escape and close on route change. Test in Task 3.
6. A double-click on submit must create exactly one inquiry row. Test in Task 12 using a client-generated `submissionId` with a unique index.
7. Missing or broken media must not break layout: `SafeImage` renders a fixed-ratio placeholder when the source is absent, and `hasUsableImage` returns false for empty or non-http values. Unit test in Task 5.

---

### Task 1: Scaffold Next + Payload + PostgreSQL + health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.env.example`, `.env`, `.gitignore`, `playwright.config.ts`
- Create: `src/payload.config.ts`, `src/collections/Users.ts`, `src/collections/Media.ts`
- Create: `src/app/(payload)/layout.tsx`, `src/app/(payload)/admin/[[...segments]]/page.tsx`, `src/app/(payload)/admin/[[...segments]]/not-found.tsx`, `src/app/(payload)/admin/importMap.js`, `src/app/(payload)/api/[...slug]/route.ts`, `src/app/(payload)/api/graphql/route.ts`, `src/app/(payload)/api/graphql-playground/route.ts`, `src/app/(payload)/custom.css`
- Create: `src/app/(frontend)/layout.tsx`, `src/app/(frontend)/page.tsx`, `src/app/(frontend)/styles.css`, `src/app/api/health/route.ts`
- Create: `src/seed/index.ts`, `tests/e2e/00-smoke.spec.ts`
- Create directory: `media/`

**Interfaces:**
- Produces: `Users` and `Media` (`CollectionConfig`) from `src/collections/`.
- Produces: default Payload config at `src/payload.config.ts`.
- Produces: `GET /api/health -> { ok: true, db: 'up' }` with status 200, or `{ ok: false, db: 'down' }` with status 503.
- Produces: `npm run seed` creates one admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` if the users table is empty. Idempotent.
- Produces: scripts `dev`, `build`, `start`, `typecheck`, `lint`, `test:e2e`, `test:unit`, `seed`, `migrate`, `migrate:create`, `generate:types`, `generate:importmap`.

- [ ] **Step 1: Initialize git and ignore generated files**

Run:

```bash
git init
```

Write `.gitignore`:

```gitignore
node_modules/
.next/
media/
.env
test-results/
playwright-report/
backups/
*.tsbuildinfo
```

- [ ] **Step 2: Write `package.json` with pinned versions**

```json
{
  "name": "smart-solutions-australia",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cross-env NODE_OPTIONS=--no-deprecation next dev",
    "build": "cross-env NODE_OPTIONS=--no-deprecation next build",
    "start": "cross-env NODE_OPTIONS=--no-deprecation next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test:e2e": "npm run migrate && npm run seed && playwright test",
    "test:unit": "tsx --test \"tests/unit/**/*.test.ts\"",
    "seed": "cross-env NODE_OPTIONS=--no-deprecation tsx src/seed/index.ts",
    "migrate": "cross-env NODE_OPTIONS=--no-deprecation payload migrate",
    "migrate:create": "cross-env NODE_OPTIONS=--no-deprecation payload migrate:create",
    "generate:types": "cross-env NODE_OPTIONS=--no-deprecation payload generate:types",
    "generate:importmap": "cross-env NODE_OPTIONS=--no-deprecation payload generate:importmap",
    "payload": "cross-env NODE_OPTIONS=--no-deprecation payload"
  },
  "dependencies": {
    "@payloadcms/db-postgres": "3.88.0",
    "@payloadcms/next": "3.88.0",
    "@payloadcms/richtext-lexical": "3.88.0",
    "@payloadcms/ui": "3.88.0",
    "cross-env": "10.1.0",
    "dotenv": "16.4.7",
    "graphql": "^16.8.1",
    "next": "15.4.11",
    "nodemailer": "^6.9.16",
    "payload": "3.88.0",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "sharp": "0.34.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/node": "^22.10.0",
    "@types/nodemailer": "^6.4.17",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "eslint": "^9.16.0",
    "eslint-config-next": "15.4.11",
    "tailwindcss": "^4.1.18",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  },
  "engines": { "node": ">=20.9.0" }
}
```

Run `npm install` and `npx playwright install chromium`.

- [ ] **Step 3: Write config files**

`tsconfig.json`: `target: ES2022`, `module: esnext`, `moduleResolution: bundler`, `jsx: preserve`, `strict: true`, `plugins: [{ "name": "next" }]`, path aliases `"@/*": ["./src/*"]` and `"@payload-config": ["./src/payload.config.ts"]`, include `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`.

`next.config.ts`:

```ts
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = { output: 'standalone' }

export default withPayload(nextConfig)
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`eslint.config.mjs`: extend `eslint-config-next/core-web-vitals` and ignore `.next/`, `src/payload-types.ts`, `src/app/(payload)/admin/importMap.js`.

`.env.example`:

```dotenv
DATABASE_URI=postgresql://postgres:123456@127.0.0.1:5432/smartcoa
PAYLOAD_SECRET=change-me-to-a-long-random-string
NEXT_PUBLIC_SERVER_URL=http://localhost:3456
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-now

# Email is optional. Leave MAIL_ENABLED=false until real credentials are available.
MAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Smart Solutions Australia <no-reply@smartsolutionsaustralia.com.au>"
MAIL_TO_QUOTE=info@smartsolutionsaustralia.com.au
MAIL_TO_CONTACT=info@smartsolutionsaustralia.com.au
```

Copy to `.env` and set a real `PAYLOAD_SECRET` (32+ random chars) and admin credentials.

- [ ] **Step 4: Write the failing smoke test**

`playwright.config.ts`: `testDir: './tests/e2e'`, `baseURL: 'http://127.0.0.1:3456'`, `webServer: { command: 'npm run dev', url: 'http://127.0.0.1:3456', reuseExistingServer: !process.env.CI, timeout: 120_000 }`, projects `chromium` desktop and `mobile` (iPhone 13).

`tests/e2e/00-smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('health endpoint reports the database is up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true, db: 'up' })
})

test('home renders a placeholder heading', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toContainText('Smart Solutions Australia')
})

test('admin login page renders', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.locator('form')).toBeVisible()
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/00-smoke.spec.ts`
Expected: FAIL because `/api/health` returns 404 and `/` has no `h1`.

- [ ] **Step 6: Implement Payload config, collections, routes and health**

`src/collections/Users.ts`: `slug: 'users'`, `auth: true`, `admin.useAsTitle: 'email'`, fields `name` (text, required), `role` (select: `admin`, `editor`, default `editor`), access read/update/delete only `admins`, create only `admins`.

`src/collections/Media.ts`: `slug: 'media'`, `upload: { staticDir: 'media', imageSizes: [{ name: 'thumbnail', width: 400 }, { name: 'card', width: 800 }, { name: 'hero', width: 1920 }] }`, `alt` text required, read `anyone`, write `authenticated`.

Create `src/access/anyone.ts`, `src/access/authenticated.ts`, `src/access/admins.ts` now; later tasks reuse them.

`src/payload.config.ts`:

```ts
import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import { Users } from './collections/Users'
import { Media } from './collections/Media'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: { user: Users.slug, importMap: { baseDir: path.resolve(dirname) } },
  collections: [Users, Media],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || 'postgresql://postgres:123456@127.0.0.1:5432/smartcoa', max: 10 },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
})
```

Create the Payload route files by copying the canonical Payload 3.88 blank-template versions (`layout.tsx`, `admin/[[...segments]]/page.tsx`, `not-found.tsx`, `api/[...slug]/route.ts`, `api/graphql/route.ts`, `api/graphql-playground/route.ts`, `custom.css`). Then run `npm run generate:importmap`.

`src/app/api/health/route.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET() {
  try {
    const payload = await getPayload({ config })
    await payload.find({ collection: 'users', limit: 1, depth: 0 })
    return Response.json({ ok: true, db: 'up' })
  } catch {
    return Response.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
```

`src/app/(frontend)/layout.tsx` imports `./styles.css` and renders `{children}` inside `<html lang="en-AU">`. `src/app/(frontend)/page.tsx` renders `<h1>Smart Solutions Australia</h1>` as a temporary placeholder.

`src/app/(frontend)/styles.css` for now:

```css
@import 'tailwindcss';
```

`src/seed/index.ts`: load `dotenv/config`, `getPayload({ config })`, if `payload.find({ collection: 'users', limit: 1 })` returns 0 docs, create one with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `name: 'Admin'`, `role: 'admin'`; log the result and exit.

- [ ] **Step 7: Create and apply the initial migration, seed, then run the test**

Run:

```bash
mkdir -p media
npm run generate:types
npm run migrate:create -- --name init
npm run migrate
npm run seed
npx playwright test tests/e2e/00-smoke.spec.ts
```

Expected: PASS, and the `smartcoa` database has Payload tables.

- [ ] **Step 8: Verify build, types and lint**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: scaffold Next.js app with Payload CMS, PostgreSQL and health check"
```

---

### Task 2: Extract template CSS, images and content

**Files:**
- Create: `scripts/extract-template-assets.ts`
- Create: `docs/template-assets.json`, `docs/template-content.md`, `docs/template-projects.json`
- Create: `src/styles/site.css`, `public/images/seed/*`, `src/app/icon.png`
- Modify: `src/app/(frontend)/styles.css`
- Test: `tests/unit/extract-assets.test.ts`

**Interfaces:**
- Produces: `docs/template-assets.json` shaped `{ images: { index: number; file: string; mime: string; width: number; height: number; alt: string; bytes: number }[] }`.
- Produces: `docs/template-content.md` with one `## View: <name>` section per `.page-view`, containing the visible text in DOM order.
- Produces: `docs/template-projects.json` with the six project records from the template's `PROJECTS` object.
- Produces: `src/styles/site.css` (the template's single `<style>` block, unchanged).

- [ ] **Step 1: Write the failing extraction test**

`tests/unit/extract-assets.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('extraction produced the stylesheet, manifest and 29 image files', () => {
  const manifest = JSON.parse(fs.readFileSync('docs/template-assets.json', 'utf8'))
  assert.equal(manifest.images.length, 29)
  assert.ok(fs.statSync('src/styles/site.css').size > 30_000)
  for (const image of manifest.images) {
    assert.ok(image.width > 0 && image.height > 0, `${image.file} has dimensions`)
    assert.ok(fs.statSync(`public/images/seed/${image.file}`).size > 1_000, `${image.file} exists`)
  }
})

test('content and project extraction cover the template', () => {
  const content = fs.readFileSync('docs/template-content.md', 'utf8')
  assert.match(content, /Steel standing across Australia/)
  assert.match(content, /Five steps\. No unknowns\./)
  const projects = JSON.parse(fs.readFileSync('docs/template-projects.json', 'utf8'))
  assert.equal(Object.keys(projects).length, 6)
  assert.equal(projects['warehouse-newcastle'].title, 'Distribution Warehouse')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL with ENOENT for `docs/template-assets.json`.

- [ ] **Step 3: Implement the extraction script**

`scripts/extract-template-assets.ts` must:

1. Read `docs/Smart Solutions Australia Website.html`.
2. Write the contents of the single `<style>` block to `src/styles/site.css`.
3. Find every `data:image/(png|jpeg|jpg|webp|svg\+xml);base64,...` in document order. Decode each with `Buffer.from(base64, 'base64')`. Use `sharp` metadata for raster dimensions; for SVG use `{ width: 0, height: 0 }` and record `mime: 'image/svg+xml'`.
4. Derive each filename from the nearest preceding `alt="..."` attribute, slugified and truncated to 40 chars; fall back to `image-XX`. Write every decoded image to `public/images/seed/<name>.<ext>` (the favicon is one of the 29, so it also gets a file there). Copy the favicon entry to `src/app/icon.png` as well.
5. Write `docs/template-assets.json`, `docs/template-content.md` and `docs/template-projects.json`.
6. For content: split the HTML on `<div class="page-view" data-view="([^"]+)"`, strip `<script>`, `<style>`, `<svg>`, tags, data URIs (replace them with `[image]`), decode entities, collapse blank lines, and emit sections in DOM order.
7. For projects: locate `var PROJECTS = `, take the balanced `{...}` literal, evaluate it in `node:vm` with a 1-second timeout, replace each `img` data URI with the matching manifest filename, and write the result as JSON.
8. Print a summary: image count, CSS bytes, and a list of images narrower than 1200px.

Add `"extract:template": "tsx scripts/extract-template-assets.ts"` to `package.json` scripts.

Append to `src/app/(frontend)/styles.css`:

```css
@import '../../styles/site.css';
```

- [ ] **Step 4: Run extraction and verify the test passes**

Run:

```bash
npm run extract:template
npm run test:unit
```

Expected: 29 images in `public/images/seed/`, manifest has 29 entries, both tests PASS. Record the low-resolution image list from the script output in `docs/template-assets.json` consumers (no code change needed).

- [ ] **Step 5: Commit**

```bash
git add scripts docs src/styles public/images src/app/icon.png src/app/\(frontend\)/styles.css package.json
git commit -m "feat: extract template stylesheet, images and content data"
```

---

### Task 3: Site settings, header, footer and frontend layout

**Files:**
- Create: `src/globals/SiteSettings.ts`, `src/globals/Header.ts`, `src/globals/Footer.ts`
- Create: `src/lib/payload.ts`, `src/lib/constants.ts`, `src/lib/labels.ts`
- Create: `src/components/layout/SiteHeader.tsx`, `src/components/layout/SiteFooter.tsx`, `src/components/layout/MobileNav.tsx`
- Modify: `src/payload.config.ts` (add globals), `src/app/(frontend)/layout.tsx`, `src/seed/index.ts`
- Create: `src/seed/content.ts`
- Test: `tests/e2e/01-layout.spec.ts`

**Interfaces:**
- Produces: `type NavKey = 'home' | 'capabilities' | 'process' | 'quality' | 'projects' | 'products' | 'team' | 'contact'`.
- Produces: `MAIN_NAV: readonly { key: NavKey; href: string }[]` in `src/lib/constants.ts`.
- Produces: `getGlobal<T>(slug: string): Promise<T>` in `src/lib/payload.ts`, cached per request.
- Produces: `<SiteHeader />`, `<SiteFooter />`.
- Header global shape: `{ labels: Record<NavKey, string>; ctaLabel: string; ctaHref: string }`.
- Footer global shape: `{ description: string; compliance: { label: string; href?: string }[]; copyright: string; modernSlaveryText: string }`.
- SiteSettings shape (generated type `SiteSetting`): `{ siteName: string; legalName: string; tagline: string; logo: Media; contact: { email: string; phoneAU: string; phoneVN: string; phoneWA: string } }`.

- [ ] **Step 1: Write the failing layout test**

`tests/e2e/01-layout.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('header shows the eight fixed links and the quote CTA', async ({ page }) => {
  await page.goto('/')
  const links = page.locator('header nav a[data-nav]')
  await expect(links).toHaveCount(8)
  await expect(links.nth(0)).toHaveAttribute('href', '/')
  await expect(links.nth(1)).toHaveAttribute('href', '/capabilities')
  await expect(links.nth(7)).toHaveAttribute('href', '/contact')
  await expect(page.locator('header a[data-cta]')).toHaveText('Request a Quote')
  await expect(page.locator('header a[data-nav="/"]')).toHaveAttribute('aria-current', 'page')
})

test('footer shows compliance items and copyright', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('footer')).toContainText('ISO 9001')
  await expect(page.locator('footer')).toContainText('CC3 Traceability')
  await expect(page.locator('footer')).toContainText('Smart Solutions Australia')
})

test('mobile drawer opens, closes on Escape, and does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Open menu' })
  await toggle.click()
  await expect(page.locator('header nav')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/01-layout.spec.ts`
Expected: FAIL because no header exists.

- [ ] **Step 3: Implement the globals and access**

`SiteSettings`: group `brand` (siteName, legalName, tagline, logo upload), group `contact` (email, phoneAU, phoneVN, phoneWA). Versions enabled. Admin group "Configuration". Read `anyone`, update `authenticated`.

`Header`: group `labels` with eight required text fields named exactly `home`, `capabilities`, `process`, `quality`, `projects`, `products`, `team`, `contact`; plus `ctaLabel` (default "Request a Quote") and `ctaHref` (default "/quote"). Versions enabled. Admin group "Configuration".

`Footer`: `description` textarea, `compliance` array of `{ label: text required, href: text }`, `copyright` text, `modernSlaveryText` textarea. Versions enabled. Admin group "Configuration".

Add all three to `payload.config.ts` `globals`.

`src/lib/constants.ts`:

```ts
export type NavKey = 'home' | 'capabilities' | 'process' | 'quality' | 'projects' | 'products' | 'team' | 'contact'

export const MAIN_NAV: readonly { key: NavKey; href: string }[] = [
  { key: 'home', href: '/' },
  { key: 'capabilities', href: '/capabilities' },
  { key: 'process', href: '/process' },
  { key: 'quality', href: '/quality' },
  { key: 'projects', href: '/projects' },
  { key: 'products', href: '/products' },
  { key: 'team', href: '/team' },
  { key: 'contact', href: '/contact' },
]
```

`src/lib/labels.ts`: `MOBILE_MENU_LABEL = 'Open menu'`, `CLOSE_MENU_LABEL = 'Close menu'`, `VIEW_PROJECT_LABEL = 'View project details'`.

`src/lib/payload.ts`:

```ts
import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'

export const payloadClient = cache(async () => getPayload({ config }))

export const getGlobal = cache(async <T,>(slug: string): Promise<T> => {
  const payload = await payloadClient()
  return (await payload.findGlobal({ slug: slug as never, depth: 1 })) as T
})
```

- [ ] **Step 4: Implement header, footer and mobile nav**

`SiteHeader` (server component) fetches `header` and `site-settings`, builds items by zipping `MAIN_NAV` with `header.labels[key]`, and renders:

- `<header className="site-header">` with logo `next/image` linking `/`.
- Exactly one `<nav aria-label="Main navigation">` containing eight `<Link data-nav={href}>`; active link gets `aria-current="page"` and `className="active"`.
- CTA `<Link data-cta href={ctaHref}>`.
- `<MobileNav items={items} cta={{ label, href }} />` renders the toggle button and drawer chrome only. It must not render a second set of links; the single nav is toggled open/closed via a `data-open` attribute on the header. This keeps `header nav a[data-nav]` at exactly eight elements at every viewport.

`MobileNav` is `'use client'`: a button with `aria-expanded` and `aria-controls`, a drawer that traps focus, closes on Escape and on pathname change (`usePathname`). Use the labels from `lib/labels.ts`.

`SiteFooter` renders description, two link columns derived from `MAIN_NAV` and footer compliance, modern slavery text, copyright, and a link to `/privacy`.

Use the template's class names (`site-header`, `wrap`, `brand`, `main-nav`, `footer`, etc.) from `src/styles/site.css`.

- [ ] **Step 5: Seed header, footer and settings**

Extend `src/seed/content.ts` with the exact copy from `docs/template-content.md` (template footer and header). Extend `src/seed/index.ts` to upsert the three globals by slug with `payload.updateGlobal`, skipping unchanged values. The seed must be idempotent.

- [ ] **Step 6: Create migration, run tests**

Run:

```bash
npm run generate:types
npm run migrate:create -- --name globals-layout
npm run migrate
npm run test:e2e -- tests/e2e/01-layout.spec.ts
```

Expected: all three layout tests PASS.

- [ ] **Step 7: Verify build and commit**

Run: `npm run typecheck && npm run lint && npm run build`

```bash
git add .
git commit -m "feat: add site settings, fixed header, footer and mobile navigation"
```

---

### Task 4: Projects, team, products and offices collections

**Files:**
- Create: `src/collections/Projects.ts`, `src/collections/TeamMembers.ts`, `src/collections/ProductGroups.ts`, `src/collections/Offices.ts`
- Create: `src/hooks/revalidate.ts`, `src/lib/filterProjects.ts`, `src/lib/data.ts`
- Modify: `src/lib/payload.ts`, `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/unit/filter-projects.test.ts`, `tests/e2e/02-collections.spec.ts`

**Interfaces:**
- Produces: `getProjects(): Promise<Project[]>`, `getProjectBySlug(slug: string): Promise<Project | null>`, `getOffices(): Promise<Office[]>`, `getTeamMembers(): Promise<TeamMember[]>`, `getProductGroups(): Promise<ProductGroup[]>` in `src/lib/data.ts`.
- Produces: `filterProjects(projects: Project[], filters: { sector?: string | null; state?: string | null }): Project[]` in `src/lib/filterProjects.ts`.
- Produces: `pickFeatured(projects: Project[]): Project | null`.
- Produces: `revalidateSite(): void` in `src/hooks/revalidate.ts`, called from `afterChange` and `afterDelete` on every collection and global.
- Collection slugs: `projects`, `team-members`, `product-groups`, `offices`.

- [ ] **Step 1: Write failing unit tests for filtering and featured selection**

`tests/unit/filter-projects.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, pickFeatured } from '../../src/lib/filterProjects'
import type { Project } from '../../src/payload-types'

const project = (over: Partial<Project>): Project => ({
  id: 1, title: 'X', slug: 'x', location: 'NSW', state: 'NSW',
  sector: 'industrial', structure: '', intro: '', scope: [], featured: false,
  order: 0, updatedAt: '', createdAt: '', ...over,
} as Project)

const all = [
  project({ id: 1, slug: 'a', state: 'NSW', sector: 'industrial' }),
  project({ id: 2, slug: 'b', state: 'NSW', sector: 'agricultural' }),
  project({ id: 3, slug: 'c', state: 'QLD', sector: 'industrial' }),
  project({ id: 4, slug: 'd', state: 'WA', sector: 'community' }),
]

test('no filters returns every project', () => {
  assert.equal(filterProjects(all, {}).length, 4)
})

test('sector and state combine', () => {
  assert.deepEqual(filterProjects(all, { state: 'NSW', sector: 'industrial' }).map((p) => p.slug), ['a'])
})

test('unknown values return an empty list', () => {
  assert.equal(filterProjects(all, { sector: 'unknown' }).length, 0)
})

test('pickFeatured returns null when nothing is featured', () => {
  assert.equal(pickFeatured(all), null)
})

test('pickFeatured returns the flagged project', () => {
  assert.equal(pickFeatured([...all, project({ id: 9, slug: 'f', featured: true })] )?.slug, 'f')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL with "Cannot find module .../filterProjects".

- [ ] **Step 3: Implement the collections**

`Projects` (`projects`): fields exactly as spec §4.1. Selects: `state` options `NSW|QLD|SA|WA|VIC|TAS|NT|ACT|PNG`, `sector` options `industrial|agricultural|community`. `slug` unique, required, index. `overview` richText (Lexical). `scope` array of text (maxRows 12). `facts` array `{ label, value }`. `heroImage` upload relation to media, required. `gallery` array of uploads (maxRows 8). `featured` checkbox, default false. `order` number, default 0. `meta` group title/description. Versions with drafts and autosave 375ms, max 25.

Access: read returns `{ _status: { equals: 'published' } }` when no user, `true` for authenticated; create/update/delete `authenticated`. `afterChange` and `afterDelete` call `revalidateSite()`.

Add a `beforeChange` hook: if `featured` becomes true, unset `featured` on all other projects.

`TeamMembers` (`team-members`): `name`, `role`, `bio` richText, `photo` upload, `initials`, `order`. Same access policy and hooks.

`ProductGroups` (`product-groups`): `title`, `eyebrow`, `description`, `items` array `{ name required, description, image upload }`, `order`. Same access and hooks.

`Offices` (`offices`): `name`, `countryCode` select AU/VN, `role`, `addressLines` array of text, `phone`, `email`, `hours` array `{ label, value }`, `lat` number, `lng` number, `directionsUrl`, `order`. Public read, authenticated write.

`src/hooks/revalidate.ts`:

```ts
import { revalidatePath } from 'next/cache'

export function revalidateSite() {
  revalidatePath('/', 'layout')
}
```

Add the four collections to `payload.config.ts`.

- [ ] **Step 4: Implement query helpers and filtering**

`src/lib/filterProjects.ts` implements the two functions; filtering is a pure array filter, no query to Payload.

`src/lib/data.ts` wraps Local API calls with `cache()`, sorts by `order` ascending, and filters out drafts. `getProjectBySlug` uses `payload.find({ collection: 'projects', where: { slug: { equals: slug }, _status: { equals: 'published' } }, limit: 1, depth: 2 })`, returns `docs[0] ?? null`.

- [ ] **Step 5: Seed all four collections**

`src/seed/content.ts` gets the six projects from `docs/template-projects.json`, the three team members and two product groups from `docs/template-content.md`, and three offices (Sydney, WA, HCMC) from the contact text. Seed offices with coordinates: Sydney `lat: -33.8688, lng: 151.2093`, HCMC `lat: 10.79706, lng: 106.71816`; WA has no coordinates and no map. Each project's `overview` is split into paragraphs and converted to Lexical root JSON; `scope` is the bullet array. Seed `warehouse-newcastle` with `featured: true` and every other project with `featured: false`; the `beforeChange` hook keeps the flag unique.

`src/seed/index.ts` upserts by `slug` for projects and product groups, by `name` for team members and offices. Upload the matching files from `public/images/seed/` through `payload.create({ collection: 'media', filePath })` on first run and store their ids. Seed must be idempotent and safe to run repeatedly.

- [ ] **Step 6: Create migration and run unit + API tests**

`tests/e2e/02-collections.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('seeded collections expose the expected records', async ({ request }) => {
  const projects = await (await request.get('/api/projects?limit=100&depth=0')).json()
  expect(projects.totalDocs).toBe(6)
  const team = await (await request.get('/api/team-members?limit=100&depth=0')).json()
  expect(team.totalDocs).toBe(3)
  const groups = await (await request.get('/api/product-groups?limit=100&depth=0')).json()
  expect(groups.totalDocs).toBe(2)
  const offices = await (await request.get('/api/offices?limit=100&depth=0')).json()
  expect(offices.totalDocs).toBe(3)
})
```

Run:

```bash
npm run generate:types
npm run migrate:create -- --name collections
npm run migrate
npm run test:unit
npx playwright test tests/e2e/02-collections.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add projects, team, products and offices collections with seed data"
```

---

### Task 5: Home page

**Files:**
- Create: `src/globals/HomePage.ts`
- Create: `src/components/sections/HeroHome.tsx`, `StatStrip.tsx`, `CertificationStrip.tsx`, `OfficeSplit.tsx`, `ExploreCards.tsx`, `FeaturedProject.tsx`
- Create: `src/components/ui/Reveal.tsx`, `CountUp.tsx`, `SafeImage.tsx`
- Create: `src/lib/media.ts`
- Modify: `src/app/(frontend)/page.tsx`, `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/03-home.spec.ts`, `tests/unit/media.test.ts`

**Interfaces:**
- Consumes: `getGlobal<HomePage>('home-page')`, `getProjects()`, `getOffices()`, `pickFeatured()`.
- HomePage global shape: `{ hero: { kicker, title, highlight, lede, primaryLabel, primaryHref, secondaryLabel, secondaryHref, image }, stats: { value, suffix, label }[], certifications: { label }[], officeSplit: { eyebrow, title, body, image, imageAlt }, exploreCards: { title, body, ctaLabel, href }[] }`. The featured project is derived from `pickFeatured(getProjects())`, not stored on the global.
- `hasUsableImage(src: unknown): boolean` in `src/lib/media.ts` returns true only for a non-empty string starting with `/` or `http`.
- `SafeImage` props: `{ src?: string | null; alt: string; width: number; height: number; className?: string; priority?: boolean }`. Renders a neutral `div[data-image-fallback]` with the same aspect ratio when `hasUsableImage(src)` is false.

- [ ] **Step 1: Write the failing home test**

`tests/e2e/03-home.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('home shows the hero, stats, certifications, explore cards and featured project', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Australian-standard steel')
  await expect(page.locator('[data-testid="stat"]')).toHaveCount(3)
  await expect(page.locator('[data-testid="certification"]')).toHaveCount(6)
  await expect(page.locator('[data-testid="explore-card"]')).toHaveCount(6)
  await expect(page.locator('[data-testid="featured-project"] a')).toHaveAttribute('href', '/projects/warehouse-newcastle')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/03-home.spec.ts`
Expected: FAIL because the placeholder page has none of these elements.

- [ ] **Step 3: Implement the HomePage global and sections**

Create `tests/unit/media.test.ts` first:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { hasUsableImage } from '../../src/lib/media'

test('hasUsableImage accepts local and remote paths', () => {
  assert.equal(hasUsableImage('/images/seed/home-hero.jpg'), true)
  assert.equal(hasUsableImage('https://example.com/a.jpg'), true)
})

test('hasUsableImage rejects empty and malformed values', () => {
  assert.equal(hasUsableImage(undefined), false)
  assert.equal(hasUsableImage(''), false)
  assert.equal(hasUsableImage('   '), false)
  assert.equal(hasUsableImage(42), false)
})
```

Run it and confirm it fails, then implement `hasUsableImage` and `SafeImage`.

Create components with the template markup and classes from `src/styles/site.css`: `hero`, `hero-media`, `hero-in`, `hero-stats`, `stat-num`, `cert-strip`, `split`, `explore-grid`, `feat-project`.

`Reveal` (`'use client'`) adds the `reveal` class on intersection and respects `prefers-reduced-motion`. `CountUp` animates the numeric span once and renders the final value server-side so no-JS users see the number.

`FeaturedProject` receives `project: Project | null`; render nothing when null. The section carries `data-testid="featured-project"`.

`page.tsx` fetches the global and data in parallel with `Promise.all`, derives the featured project with `pickFeatured(projects)`, then renders sections in template order.

- [ ] **Step 4: Seed the HomePage global**

Copy exact copy from `docs/template-content.md` under `## View: home`. `warehouse-newcastle` already has `featured: true` from Task 4, and the page derives the featured card with `pickFeatured(projects)`. Upload `home-hero` and the office-split image through the media seeder.

- [ ] **Step 5: Migrate, seed and run tests**

Run:

```bash
npm run migrate:create -- --name home-page
npm run migrate
npx playwright test tests/e2e/03-home.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Verify build and commit**

Run: `npm run typecheck && npm run lint && npm run build`

```bash
git add .
git commit -m "feat: build home page from CMS content"
```

---

### Task 6: Capabilities page

**Files:**
- Create: `src/globals/CapabilitiesPage.ts`, `src/components/sections/CapabilityGrid.tsx`, `src/components/ui/SectionHead.tsx`, `src/components/ui/PageHero.tsx`
- Create: `src/app/(frontend)/capabilities/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/04-capabilities.spec.ts`

**Interfaces:**
- Global shape: `{ hero: { eyebrow, title, lede }, intro: { eyebrow, title, body }, capabilities: { title, body, features: { text }[], image? }[] }`.
- `PageHero` props: `{ eyebrow, title, lede, children?: ReactNode }`.
- `SectionHead` props: `{ eyebrow, title, body?, id?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('capabilities page lists seven capabilities', async ({ page }) => {
  const res = await page.goto('/capabilities')
  expect(res?.status()).toBe(200)
  await expect(page.locator('h1')).toContainText('One accountable partner')
  await expect(page.locator('[data-testid="capability-card"]')).toHaveCount(7)
  await expect(page.locator('[data-testid="capability-card"]').first().locator('h3')).toHaveText('Steel Fabrication')
  await expect(page.locator('[data-testid="capability-card"]').first().locator('li')).toHaveCount(4)
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx playwright test tests/e2e/04-capabilities.spec.ts` → FAIL (404).

- [ ] **Step 3: Implement global, components and page**

Use the template markup for `page-hero`, `section-head`, `cap-grid`, `cap-card`. Keep the seven cards in the seeded order. Images use `SafeImage`.

- [ ] **Step 4: Seed, migrate, test**

Run:

```bash
npm run migrate:create -- --name capabilities-page
npm run migrate
npx playwright test tests/e2e/04-capabilities.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add capabilities page"
```

---

### Task 7: Process page

**Files:**
- Create: `src/globals/ProcessPage.ts`, `src/components/sections/ProcessSteps.tsx`
- Create: `src/app/(frontend)/process/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/05-process.spec.ts`

**Interfaces:**
- Global shape: `{ hero: { eyebrow, title, lede }, steps: { title, body }[], cta: { primaryLabel, primaryHref, secondaryLabel, secondaryHref } }`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('process page shows five ordered steps', async ({ page }) => {
  await page.goto('/process')
  const steps = page.locator('[data-testid="process-step"]')
  await expect(steps).toHaveCount(5)
  await expect(steps.nth(0).locator('h3')).toHaveText('Design & Engineering')
  await expect(steps.nth(4).locator('h3')).toHaveText('Door-to-Door Delivery')
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx playwright test tests/e2e/05-process.spec.ts` → FAIL.

- [ ] **Step 3: Implement and seed**

Use template classes `process-grid`, `process-step`. Render the step number from the array index plus one.

Run:

```bash
npm run migrate:create -- --name process-page
npm run migrate
npx playwright test tests/e2e/05-process.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add process page"
```

---

### Task 8: Quality page

**Files:**
- Create: `src/globals/QualityPage.ts`, `src/components/sections/QaList.tsx`
- Create: `src/app/(frontend)/quality/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/06-quality.spec.ts`

**Interfaces:**
- Global shape: `{ hero: { eyebrow, title, lede }, intro: { eyebrow, title, body }, image, qaItems: { title, description }[], managementSystems: { title, body } }`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('quality page lists eight QA documents and the ISO paragraph', async ({ page }) => {
  await page.goto('/quality')
  await expect(page.locator('[data-testid="qa-item"]')).toHaveCount(8)
  await expect(page.locator('[data-testid="qa-item"]').first()).toContainText('Inspection Test Plan')
  await expect(page.locator('main')).toContainText('ISO 9001:2015')
  await expect(page.locator('main')).toContainText('AS/NZS 4680')
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx playwright test tests/e2e/06-quality.spec.ts` → FAIL.

- [ ] **Step 3: Implement, seed, migrate, test**

Use template classes `qa-grid`, `qa-item`, `iso-strip`. Run:

```bash
npm run migrate:create -- --name quality-page
npm run migrate
npx playwright test tests/e2e/06-quality.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add quality page"
```

---

### Task 9: Projects list, filters and detail page

**Files:**
- Create: `src/globals/ProjectsPage.ts`, `src/components/sections/ProjectFilterBar.tsx`, `ProjectGrid.tsx`, `ProjectDetail.tsx`
- Create: `src/app/(frontend)/projects/page.tsx`, `src/app/(frontend)/projects/[slug]/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/07-projects.spec.ts`

**Interfaces:**
- `ProjectFilterBar` (`'use client'`) props: `{ initialSector: string; initialState: string }`. It reads and writes `?sector=` and `?state=` with `router.replace(..., { scroll: false })`.
- `ProjectGrid` props: `{ projects: Project[] }`.
- `ProjectDetail` props: `{ project: Project }`.
- List page reads `searchParams.sector` and `searchParams.state`, calls `filterProjects`.

- [ ] **Step 1: Write the failing tests**

```ts
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

test('unknown project slug returns 404', async ({ page }) => {
  const res = await page.goto('/projects/does-not-exist')
  expect(res?.status()).toBe(404)
  await expect(page.locator('body')).toContainText('not found')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/07-projects.spec.ts` → FAIL.

- [ ] **Step 3: Implement list page and filter**

`ProjectFilterBar` renders the sector buttons and the state `<select>` with the template labels from `src/lib/labels.ts` (`FILTER_SECTOR_LABEL = 'Filter by sector'`, `FILTER_STATE_LABEL = 'Filter by state'`). Filtering happens client-side with `useMemo` over the full list passed from the server, and the URL is updated so the state survives reload. The server page also applies `filterProjects` from `searchParams` so the first render is already filtered with JS disabled.

- [ ] **Step 4: Implement detail page**

`generateStaticParams` maps all published projects to `{ slug }`. `generateMetadata` returns title, description and canonical. `page.tsx` calls `getProjectBySlug`, and `notFound()` when null. Render hero image, intro, overview rich text, scope list (`data-testid="project-scope"`), facts, gallery.

- [ ] **Step 5: Seed the ProjectsPage global, migrate, test**

The global holds only `hero` and `note`; labels and option values are constants.

Run:

```bash
npm run migrate:create -- --name projects-page
npm run migrate
npx playwright test tests/e2e/07-projects.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add projects listing, filtering and detail pages"
```

---

### Task 10: Products page

**Files:**
- Create: `src/globals/ProductsPage.ts`, `src/components/sections/ProductGroup.tsx`
- Create: `src/app/(frontend)/products/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/08-products.spec.ts`

**Interfaces:**
- Global shape: `{ hero: { eyebrow, title, lede }, intro: { eyebrow, title, body }, partnerNote: { title, body } }`.
- Page composes `getProductGroups()` into `<ProductGroup group={group} />`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('products page shows two groups and all items', async ({ page }) => {
  await page.goto('/products')
  await expect(page.locator('[data-testid="product-group"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="product-item"]')).toHaveCount(17)
  await expect(page.locator('main')).toContainText('Substation Steel Poles')
  await expect(page.locator('main')).toContainText('Powder-Coated Louvres')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/08-products.spec.ts` → FAIL.

- [ ] **Step 3: Implement, seed, migrate, test**

Use template classes `product-group`, `product-grid`. Run:

```bash
npm run migrate:create -- --name products-page
npm run migrate
npx playwright test tests/e2e/08-products.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add products page"
```

---

### Task 11: Team page

**Files:**
- Create: `src/globals/TeamPage.ts`, `src/components/sections/TeamGrid.tsx`
- Create: `src/app/(frontend)/team/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/09-team.spec.ts`

**Interfaces:**
- Global shape: `{ hero: { eyebrow, title, lede }, intro: { eyebrow, title, body }, quote: { text, attribution } }`.
- Page composes `getTeamMembers()` into `<TeamGrid members={members} />`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('team page shows three members in order', async ({ page }) => {
  await page.goto('/team')
  const cards = page.locator('[data-testid="team-member"]')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0).locator('h3')).toHaveText('John Walker')
  await expect(cards.nth(1).locator('h3')).toHaveText('Quynh Pham')
  await expect(cards.nth(2).locator('h3')).toHaveText('Lionel Trotman')
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/09-team.spec.ts` → FAIL.

- [ ] **Step 3: Implement, seed, migrate, test**

Run:

```bash
npm run migrate:create -- --name team-page
npm run migrate
npx playwright test tests/e2e/09-team.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add team page"
```

---

### Task 12: Quote page, inquiry API and email

**Files:**
- Create: `src/collections/Inquiries.ts`, `src/lib/inquiry.ts`, `src/lib/email.ts`
- Create: `src/components/forms/QuoteForm.tsx`
- Create: `src/globals/QuotePage.ts`
- Create: `src/app/(frontend)/quote/page.tsx`, `src/app/(frontend)/api/inquiries/route.ts`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/unit/inquiry-schema.test.ts`, `tests/e2e/10-quote-form.spec.ts`

**Interfaces:**
- `quoteSchema` and `contactSchema` (Zod) in `src/lib/inquiry.ts`; both include `name`, `email`, `consent: literal(true)`, `submissionId: string().uuid()`, `startedAt: number()`, `company_website: string().max(0)` (honeypot).
- `export type QuoteInput = z.infer<typeof quoteSchema>` and `export type ContactInput = z.infer<typeof contactSchema>`; `export type InquiryInput = QuoteInput | ContactInput`.
- `sendInquiryEmail(input: InquiryInput): Promise<boolean>` in `src/lib/email.ts`.
- `POST /api/inquiries` accepts a JSON body, returns `201 { ok: true, emailSent: boolean }` or `400 { ok: false, errors: Record<string,string> }` or `429 { ok: false, error: 'rate_limited' }`.
- `checkRateLimit(key: string, now: number): boolean` in `src/lib/inquiry.ts`, 5 requests per 10 minutes.
- Inquiries collection fields: `type`, `status`, `name`, `company`, `email`, `phone`, `projectType`, `tonnage`, `siteLocation`, `office`, `enquiryType`, `message`, `sourcePath`, `consent`, `submissionId` (unique index).

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/inquiry-schema.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { quoteSchema, checkRateLimit, resetRateLimit } from '../../src/lib/inquiry'

const valid = {
  type: 'quote', name: 'Jane', email: 'jane@example.com', projectType: 'Warehouse / Industrial',
  tonnage: '20 – 100 t', message: 'Need a quote', consent: true,
  submissionId: '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607', startedAt: Date.now() - 5000,
  company_website: '', sourcePath: '/quote',
}

test('valid quote passes', () => {
  assert.equal(quoteSchema.safeParse(valid).success, true)
})

test('bad email is rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, email: 'nope' }).success, false)
})

test('missing consent is rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, consent: false }).success, false)
})

test('honeypot must be empty', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, company_website: 'spam' }).success, false)
})

test('fast submissions are rejected', () => {
  assert.equal(quoteSchema.safeParse({ ...valid, startedAt: Date.now() - 500 }).success, false)
})

test('rate limit blocks the sixth request in ten minutes', () => {
  resetRateLimit()
  const now = 1_000_000
  for (let i = 0; i < 5; i++) assert.equal(checkRateLimit('ip', now + i), true)
  assert.equal(checkRateLimit('ip', now + 6), false)
  assert.equal(checkRateLimit('ip', now + 10 * 60_000 + 1), true)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:unit` → FAIL (module not found).

- [ ] **Step 3: Implement schemas, rate limit and email**

`src/lib/inquiry.ts`: `quoteSchema` requires `type: literal('quote')`, `name` 1–120, `email` email, `projectType` 1–80, `tonnage` 1–40, `siteLocation` optional max 160, `message` optional max 4000, `consent` literal true, `submissionId` uuid, `startedAt` number with a refinement that `Date.now() - startedAt >= 2000`, `company_website` max 0, `sourcePath` max 200.

`contactSchema` requires `office` enum `sydney|wa|hcmc`, `enquiryType` 1–80, `message` 1–4000.

`checkRateLimit` stores a module-level `Map<string, number[]>`, prunes entries older than 10 minutes, and returns false when the key already has 5 timestamps. Export `resetRateLimit()` for tests.

`src/lib/email.ts` creates a Nodemailer transport only when `MAIL_ENABLED === 'true'` and `SMTP_HOST` is set. When disabled, log `mail disabled: inquiry saved without notification` once and return false. When enabled, send text + HTML to `MAIL_TO_QUOTE` or `MAIL_TO_CONTACT` with `replyTo` set to the sender.

- [ ] **Step 4: Implement the Inquiries collection and API route**

`Inquiries`: create access `anyone`, read/update/delete `authenticated`. `submissionId` has `unique: true` and `index: true`. Admin list columns type/name/email/status/createdAt. No drafts.

Route logic: parse JSON, pick schema by `type`, validate, reject honeypot and fast submits, rate-limit on `x-forwarded-for` or `127.0.0.1`, check for an existing inquiry with the same `submissionId` and return `200 { ok: true, emailSent: false, duplicate: true }`, create the inquiry, call `sendInquiryEmail`, return 201. Catch create errors and return 500 with a generic message.

- [ ] **Step 5: Implement the Quote page and form**

Global holds hero, three steps, project type options (defaults from template), tonnage options, online tool label/href, fallback phone numbers, `consentLabel` and `consentHref`. Seed `consentLabel` with the exact text "I consent to the Privacy Policy" and `consentHref` with "/privacy". `QuoteForm` (`'use client'`) renders the template fields plus a required consent checkbox whose label is `consentLabel` linked to `consentHref`. The `<form>` uses `noValidate` so Zod client-side validation drives the messages. It generates `submissionId` with `crypto.randomUUID()` on mount and `startedAt` with `Date.now()`, includes the hidden honeypot, disables the submit button while `isSubmitting`, maps 400 errors to field messages with `aria-invalid` and `aria-describedby`, and replaces the form with a success panel on 201. The first missing required field renders `<p role="alert">Full name is required</p>` (or the matching field name); the success heading starts with "Thank you".

- [ ] **Step 6: Write the failing E2E test**

`tests/e2e/10-quote-form.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { loginAsAdmin, countInquiries } from './helpers/admin'

test('quote form validates and stores one inquiry', async ({ page, request }) => {
  const before = await countInquiries(request)

  await page.goto('/quote')
  await page.getByRole('button', { name: 'Send Quote Request' }).click()
  await expect(page.getByText('Full name is required')).toBeVisible()
  expect(await countInquiries(request)).toBe(before)

  await page.getByLabel('Full name').fill('Jane Tester')
  await page.getByLabel('Work email').fill('jane@example.com')
  await page.getByLabel('Project type').selectOption({ label: 'Warehouse / Industrial' })
  await page.getByLabel('Approx. tonnage').selectOption({ label: '20 – 100 t' })
  await page.getByLabel(/consent/i).check()
  await page.getByRole('button', { name: 'Send Quote Request' }).click()
  await expect(page.getByText('Thank you')).toBeVisible()

  expect(await countInquiries(request)).toBe(before + 1)
})

test('email disabled still succeeds', async ({ page, request }) => {
  await page.goto('/quote')
  await page.getByLabel('Full name').fill('No Mail')
  await page.getByLabel('Work email').fill('nomail@example.com')
  await page.getByLabel('Project type').selectOption({ label: 'Other' })
  await page.getByLabel('Approx. tonnage').selectOption({ label: 'Not sure yet' })
  await page.getByLabel(/consent/i).check()
  await page.getByRole('button', { name: 'Send Quote Request' }).click()
  await expect(page.getByText('Thank you')).toBeVisible()
})

test('replaying the same submissionId creates one row', async ({ request }) => {
  const body = {
    type: 'quote', name: 'Replay', email: 'replay@example.com', projectType: 'Other',
    tonnage: 'Not sure yet', consent: true, company_website: '', sourcePath: '/quote',
    submissionId: '11111111-2222-4333-8444-555555555555', startedAt: Date.now() - 5000,
  }
  const before = await countInquiries(request)
  expect((await request.post('/api/inquiries', { data: body })).status()).toBe(201)
  expect((await request.post('/api/inquiries', { data: body })).status()).toBe(200)
  expect(await countInquiries(request)).toBe(before + 1)
})
```

`tests/e2e/helpers/admin.ts`:

```ts
import 'dotenv/config'
import type { APIRequestContext } from '@playwright/test'

let cookie: string | undefined

export async function loginAsAdmin(request: APIRequestContext): Promise<string> {
  if (cookie) return cookie
  const res = await request.post('/api/users/login', {
    data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  })
  const raw = res.headers()['set-cookie'] ?? ''
  cookie = raw.split(';')[0]
  return cookie
}

export async function countInquiries(request: APIRequestContext): Promise<number> {
  const token = await loginAsAdmin(request)
  const res = await request.get('/api/inquiries?limit=1&depth=0', {
    headers: { Cookie: token },
  })
  const json = await res.json()
  return json.totalDocs as number
}
```

Cache the cookie per worker (the module-level variable above does this).

- [ ] **Step 7: Run to confirm failure, then implement until pass**

Run: `npx playwright test tests/e2e/10-quote-form.spec.ts` → FAIL.

Then:

```bash
npm run migrate:create -- --name inquiries
npm run migrate
npm run test:unit
npx playwright test tests/e2e/10-quote-form.spec.ts
```

Expected: PASS. Ensure `MAIL_ENABLED=false` in `.env` for this run.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add quote form, inquiries storage and optional email notification"
```

---

### Task 13: Contact page and map

**Files:**
- Create: `src/globals/ContactPage.ts`, `src/components/forms/ContactForm.tsx`, `src/components/ui/MapEmbed.tsx`, `src/components/sections/ContactOffices.tsx`, `WhatsNext.tsx`
- Create: `src/app/(frontend)/contact/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`
- Test: `tests/e2e/11-contact.spec.ts`

**Interfaces:**
- Global shape: `{ hero, intro, whatsNext: { title, body }[], enquiryTypes: string[], formNote, consentLabel, consentHref, successHeading, successBody }`. Seed `consentLabel` as "I consent to the Privacy Policy".
- `MapEmbed` props: `{ lat: number; lng: number; label: string }`. Renders an OpenStreetMap iframe with `title={`Map of ${label}`}`, `loading="lazy"`, and a "Get directions" link to `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`.
- `ContactForm` reuses `contactSchema` and the same POST endpoint with `type: 'contact'`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'
import { countInquiries } from './helpers/admin'

test('contact page shows three offices, two maps and stores an inquiry', async ({ page, request }) => {
  await page.goto('/contact')
  await expect(page.locator('[data-testid="office-card"]')).toHaveCount(3)
  await expect(page.locator('iframe[title^="Map of"]')).toHaveCount(2)

  const before = await countInquiries(request)
  await page.getByLabel('Full name').fill('Contact Tester')
  await page.getByLabel('Email').fill('contact@example.com')
  await page.getByLabel('Office').selectOption({ label: 'Ho Chi Minh City — Vietnam Office' })
  await page.getByLabel('Enquiry type').selectOption({ label: 'General enquiry' })
  await page.getByLabel('Message').fill('Please send compliance documents.')
  await page.getByLabel(/consent/i).check()
  await page.getByRole('button', { name: 'Send Message' }).click()
  await expect(page.getByText('Thank you')).toBeVisible()
  expect(await countInquiries(request)).toBe(before + 1)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/11-contact.spec.ts` → FAIL.

- [ ] **Step 3: Implement page, offices, maps and form**

Offices come from `getOffices()`; render Sydney and HCMC maps (WA has no office). Office card contains role, address lines, phone, email and hours. `ContactForm` mirrors `QuoteForm` behavior (including `noValidate` and the required consent checkbox) and shows the chosen office label.

- [ ] **Step 4: Seed, migrate, test**

Run:

```bash
npm run migrate:create -- --name contact-page
npm run migrate
npx playwright test tests/e2e/11-contact.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add contact page with offices, maps and enquiry form"
```

---

### Task 14: Privacy page

**Files:**
- Create: `src/globals/PrivacyPage.ts`
- Create: `src/app/(frontend)/privacy/page.tsx`
- Modify: `src/payload.config.ts`, `src/seed/content.ts`, `src/seed/index.ts`, `src/components/layout/SiteFooter.tsx`
- Test: `tests/e2e/12-privacy.spec.ts`

**Interfaces:**
- Global shape: `{ lastUpdated: date, body: richText }`.
- The body seed is Appendix A of the spec, converted to Lexical: `h2` for each numbered heading, `p` for paragraphs, `ul` for lists.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('privacy page renders the policy and is linked from the footer', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.locator('h1')).toHaveText('Privacy Policy')
  await expect(page.locator('main')).toContainText('Privacy Act 1988 (Cth)')
  await expect(page.locator('main')).toContainText('Office of the Australian Information Commissioner')
  await expect(page.locator('main')).toContainText('18 November 2026')
  await page.goto('/')
  await expect(page.locator('footer a[href="/privacy"]')).toBeVisible()
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/12-privacy.spec.ts` → FAIL.

- [ ] **Step 3: Implement, seed, migrate, test**

Seed the exact Appendix A text with `lastUpdated: '2026-11-18'`. Render with the template's prose classes; headings become `h2` with anchor ids (`who-we-are`, `what-we-collect`, etc.).

Run:

```bash
npm run migrate:create -- --name privacy-page
npm run migrate
npx playwright test tests/e2e/12-privacy.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add privacy policy page"
```

---

### Task 15: SEO, sitemap, robots and structured data

**Files:**
- Create: `src/lib/seo.ts`, `src/components/seo/JsonLd.tsx`
- Create: `src/app/sitemap.ts`, `src/app/robots.ts`
- Modify: every page's `generateMetadata` (Tasks 5–14) to use `buildMetadata`.
- Test: `tests/e2e/13-seo.spec.ts`

**Interfaces:**
- `buildMetadata(input: { title: string; description?: string | null; path: string; image?: string | null }): Metadata`.
- `organizationJsonLd(settings: SiteSetting, offices: Office[]): object` returns `Organization` plus one `LocalBusiness` per mapped office (Sydney and Ho Chi Minh City).
- Sitemap includes `/`, `/capabilities`, `/process`, `/quality`, `/projects`, `/products`, `/team`, `/quote`, `/contact`, `/privacy`, and each `/projects/<slug>`.
- Robots disallows `/admin`, `/api`, `/next`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test'

test('sitemap lists static pages and projects', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text()
  for (const path of ['/', '/capabilities', '/process', '/quality', '/projects', '/products', '/team', '/quote', '/contact', '/privacy']) {
    expect(xml).toContain(`http://localhost:3456${path}<`)
  }
  expect(xml.match(/\/projects\/[a-z-]+/g)?.length).toBeGreaterThanOrEqual(6)
})

test('robots blocks admin and api', async ({ request }) => {
  const txt = await (await request.get('/robots.txt')).text()
  expect(txt).toContain('Disallow: /admin')
  expect(txt).toContain('Disallow: /api')
})

test('home emits organization structured data with two locations', async ({ page }) => {
  await page.goto('/')
  const json = await page.locator('script[type="application/ld+json"]').first().textContent()
  const data = JSON.parse(json!)
  const graph = data['@graph'] ?? [data]
  expect(graph.some((node: { '@type': string }) => node['@type'] === 'Organization')).toBe(true)
  expect(graph.filter((node: { '@type': string }) => node['@type'] === 'LocalBusiness')).toHaveLength(2)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx playwright test tests/e2e/13-seo.spec.ts` → FAIL.

- [ ] **Step 3: Implement**

`buildMetadata` sets `title`, `description`, `alternates.canonical`, OpenGraph and Twitter fields, using `metadataBase` from `NEXT_PUBLIC_SERVER_URL`.

`layout.tsx` sets the title template `%s | Smart Solutions Australia` and renders `<JsonLd data={...} />` in the body. The graph contains `Organization` (name, url, logo, email, telephone) and one `LocalBusiness` per mapped office (Sydney and Ho Chi Minh City) with `address`, `telephone`, `openingHours`.

`sitemap.ts` queries published projects and returns entries with `lastModified`. `robots.ts` returns the rules above plus the sitemap URL.

Replace hard-coded metadata in each page with `buildMetadata`, sourcing title/description from each global's `meta` fields where present.

- [ ] **Step 4: Run tests**

Run: `npx playwright test tests/e2e/13-seo.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add metadata, sitemap, robots and structured data"
```

---

### Task 16: Deployment, backup and documentation

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `scripts/backup.ts`, `deploy/smart-solutions.service`
- Create: `README.md`, `docs/operations.md`
- Modify: `package.json` (`backup` script), `.env.example` (final)
- Test: `tests/e2e/14-runtime.spec.ts` (build/start smoke) and a manual backup script run.

**Interfaces:**
- `npm run backup` writes `backups/<ISO timestamp>/smartcoa.dump` (from `pg_dump -Fc`) and `backups/<ISO timestamp>/media/`, then prunes backups older than 14 days.
- `Dockerfile` builds a standalone Next image and exposes 3456; the database is external to the container.
- `docker-compose.yml` defines `app` plus `postgres:18`, with a `pgdata` volume for the database and a `media` volume for uploads.

- [ ] **Step 1: Write the failing runtime test**

`tests/e2e/14-runtime.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('health and one CMS page respond on the production server', async ({ request }) => {
  expect((await request.get('/api/health')).status()).toBe(200)
  expect((await request.get('/projects')).status()).toBe(200)
})
```

Run it against `npm run dev` first; it should already pass. The real verification is the production start in Step 4.

- [ ] **Step 2: Implement standalone runtime assets**

`Dockerfile`: `node:22-alpine`, copy `package*.json`, `npm ci`, copy the project, `npm run build`, `ENV NODE_ENV=production`, `EXPOSE 3456`, `CMD ["npm", "run", "start"]`. Migrations are a separate deploy step (`docker compose run --rm app npm run migrate`) so the runtime image does not need migration tooling at boot.

`docker-compose.yml`: `app` build, `env_file: .env`, ports , volume `./media:/app/media`, `depends_on` a `db` service, `restart: unless-stopped`. The `db` service is `postgres:18`, environment `POSTGRES_DB=smartcoa`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD` from `.env`, volume `pgdata:/var/lib/postgresql/data`, and a `pg_isready` healthcheck. In this setup `DATABASE_URI` is `postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/smartcoa`. Document the first-run sequence: `docker compose build`, `docker compose run --rm app npm run migrate`, `docker compose run --rm app npm run seed`, `docker compose up -d`.

`deploy/smart-solutions.service`: systemd unit with `ExecStartPre=/usr/bin/npm run migrate`, `ExecStart=/usr/bin/npm run start`, `WorkingDirectory` and `EnvironmentFile` documented as placeholders with comments.

`scripts/backup.ts`: spawns `pg_dump --format=custom --file=<target> "$DATABASE_URI"` using `node:child_process`; copies `media/` with `node:fs/promises` `cp`; filenames use `new Date().toISOString().replace(/[:.]/g, '-')`; prunes directories older than 14 days. Exit non-zero if `pg_dump` fails. On Windows, the Postgres bin directory must be on `PATH`.

- [ ] **Step 3: Document run and operations**

`README.md`: prerequisites (Node, PostgreSQL 16+), database creation (`createdb smartcoa` or `psql -c 'create database smartcoa'`), `npm ci`, `.env`, `npm run migrate`, `npm run seed`, `npm run dev`, admin URL, build/start, Docker option, backup with `pg_dump`, restore with `pg_restore`, and the test commands.

`docs/operations.md`: where content is edited, publish/draft flow, inquiry inbox, backup schedule, SMTP enablement checklist.

- [ ] **Step 4: Verify production build and start**

Run:

```bash
npm run typecheck && npm run lint && npm run build
npm run start
```

In another shell: `curl -f http://127.0.0.1:3456/api/health` and `curl -f http://127.0.0.1:3456/projects`.
Expected: both 200, health body `{ "ok": true, "db": "up" }`.

Run `npm run backup` and verify `backups/<timestamp>/smartcoa.dump` and `backups/<timestamp>/media/` exist.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: add production runtime, backup script and operations docs"
```

---

### Task 17: Full QA pass

**Files:**
- Create: `tests/e2e/99-quality.spec.ts`, `docs/qa-checklist.md`
- Modify: any file that fails the checks.

**Interfaces:**
- Consumes all routes and components from Tasks 1–16.

- [ ] **Step 1: Write the cross-cutting quality test**

`tests/e2e/99-quality.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const routes = ['/', '/capabilities', '/process', '/quality', '/projects', '/projects/warehouse-newcastle', '/products', '/team', '/quote', '/contact', '/privacy']

for (const route of routes) {
  test(`${route} has one h1, labelled inputs and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const res = await page.goto(route)
    expect(res?.status()).toBe(200)
    await expect(page.locator('h1')).toHaveCount(1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    for (const img of await page.locator('main img').all()) {
      expect(await img.getAttribute('alt')).not.toBeNull()
    }
    for (const input of await page.locator('main input:not([type="hidden"]), main select, main textarea').all()) {
      const id = await input.getAttribute('id')
      expect(id, 'form control needs an id').toBeTruthy()
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
    }
  })
}

test('keyboard focus reaches the skip link and header', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '#main')
})
```

Add a skip link `<a href="#main" className="skip-link">Skip to content</a>` and `<main id="main">` if not already present.

- [ ] **Step 2: Run the full suite and fix failures**

Run:

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run test:e2e
```

Expected: all pass. Fix issues in the owning task's files; do not weaken assertions.

- [ ] **Step 3: Manual QA checklist**

Write `docs/qa-checklist.md` with these checks and record results:

- Light and dark mode at 375 / 768 / 1440 on all 11 routes.
- Header active state on every route.
- Drawer keyboard: Tab trap, Escape, link click navigates and closes.
- Project filters with JS enabled and with JS disabled (server render).
- Quote and contact forms: happy path, field errors, server error simulation, double click.
- Inquiry appears in `/admin/collections/inquiries`.
- Email test with real SMTP credentials once provided; confirm `emailSent: true`.
- Lighthouse mobile on `/` and `/projects` from `npm run start`; record Performance, Accessibility, Best Practices, SEO.

- [ ] **Step 4: Commit the QA assets and final fixes**

```bash
git add .
git commit -m "test: add cross-page quality checks and manual QA checklist"
```

---

## Execution Notes

- Run `npm run generate:types` after adding or changing any collection/global, before running tests. Commit the updated `src/payload-types.ts`.
- Run `npm run migrate:create -- --name <name>` after every task that changes collection/global schema, then `npm run migrate`. Commit the generated migration file with the task.
- `npm run seed` is idempotent and safe to re-run; it must never duplicate projects, globals or media.
- `docs/template-assets.json` and `docs/template-content.md` are the source of truth for all copy and images. Do not paraphrase template text.
- If a Payload admin component needs an import map entry, run `npm run generate:importmap` and commit the updated `src/app/(payload)/admin/importMap.js`.
- Keep client components to: `MobileNav`, `Reveal`, `CountUp`, `ProjectFilterBar`, `QuoteForm`, `ContactForm`. Everything else is a Server Component.
- Do not add a `Pages` collection, menu collection, block builder, analytics, cookie banner or file uploads.
