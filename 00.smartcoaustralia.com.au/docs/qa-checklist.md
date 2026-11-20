# QA checklist

Manual and tool-assisted checks for the Smart Solutions Australia site, run at
the end of implementation (Task 17). Every row records what was actually
observed on this machine, not what was expected.

**Environment:** Windows 10 (10.0.26200), Node v24.12.0, Playwright 1.63
(Chromium + WebKit/iPhone 13 emulation), Lighthouse 12.6 run against
`npm run build && npm run start` on `http://127.0.0.1:3065`.

Legend: **PASS** = verified, **PASS\*** = verified with a caveat noted inline,
**NOT RUN** = could not be executed here (reason given), **TODO** = needs
credentials or a device this environment does not have.

---

## 1. Light and dark mode at 375 / 768 / 1440 on all 11 routes

Automated sweep: each route loaded at each width in both colour schemes, checking
HTTP status, horizontal overflow (`scrollWidth - clientWidth <= 0`), the computed
`body` background colour switching with the scheme, and zero uncaught page
errors.

Routes: `/`, `/capabilities`, `/process`, `/quality`, `/projects`,
`/projects/warehouse-newcastle`, `/products`, `/team`, `/quote`, `/contact`,
`/privacy`.

| Scheme | 375px | 768px | 1440px |
|---|---|---|---|
| Light | PASS (11/11) | PASS (11/11) | PASS (11/11) |
| Dark | PASS (11/11) | PASS (11/11) | PASS (11/11) |

66 route/viewport/scheme combinations: all returned 200, zero overflow, zero
page errors. Backgrounds resolved to `rgb(242, 244, 249)` in light and
`rgb(10, 17, 40)` in dark, confirming the `prefers-color-scheme` token block is
live.

### Contrast at those sizes

Lighthouse `color-contrast` (axe) returns **0 failing nodes on all 11 routes**
in the light scheme, and accessibility scores **100/100 on every route**
(re-measured individually per route, not extrapolated from one page).

**Fixed during this pass** (all were real WCAG 2.1 AA failures):

1. White text on the accent fill was **4.25:1** (needs 4.5:1). The accent used as
   a background behind text is now one shade darker (`#cf2430`, 5.32:1), while
   the decorative accent (bars, focus rings, large hero text) is unchanged. In
   the dark scheme the light accent (`#ff5a5f`) cannot hold white text at all
   (3.05:1), so accent surfaces switch to the dark ink there (6.12:1).
2. Muted grey `#68738f` on the page background was **4.30:1**. Now `#5f6a86`
   (4.90:1 on the page background, 5.40:1 on white cards).
3. `.office-card a` (specificity 0,1,1) was overriding `.btn-dark` (0,1,0) on the
   contact page, rendering the "Get Directions" / "Call the WA Line" buttons in
   accent red on navy — **2.01:1**. The button now keeps its own white ink
   (13.02:1).
4. The hero stat `sup` suffix (17.6px bold, below the large-text threshold) was
   accent-on-navy at **3.07:1**; it now uses the template's own on-navy coral
   `#ffb4ae` (7.68:1 light navy, 10.83:1 dark navy).

A hand-written contrast sweep also flagged `figcaption` text on the office and
team photo bands. Those are **false positives**: both captions sit on an overlay
(`rgba(9,24,66,.86)` and a dark gradient) that the flat-colour probe could not
see, and axe reports no failure on either. No change was made.

## 2. Header active state on every route

`aria-current="page"` is set by `NavLink` from the current pathname.

| Route | Active nav link |
|---|---|
| `/` | `/` |
| `/capabilities` | `/capabilities` |
| `/process` | `/process` |
| `/quality` | `/quality` |
| `/projects` | `/projects` |
| `/projects/warehouse-newcastle` | `/projects` (section stays lit on detail pages) |
| `/products` | `/products` |
| `/team` | `/team` |
| `/contact` | `/contact` |
| `/quote` | none (not in the eight-link nav; the CTA is the quote entry point) |
| `/privacy` | none |

Verified: exactly one active link on each of the nine nav routes, zero on
`/quote` and `/privacy`. **PASS**

## 3. Drawer keyboard behaviour (375px)

| Check | Result |
|---|---|
| Opening the drawer moves focus into it | PASS — focus lands on the first nav link (`data-nav="/"`) |
| Tab stays inside the drawer (trap) | PASS — 12 consecutive Tabs never left `<header>` |
| Shift+Tab from the first item wraps | PASS — wraps back to the toggle button |
| Escape closes the drawer | PASS — `aria-expanded="false"` |
| Escape returns focus to the toggle | PASS — `document.activeElement` is `.nav-toggle` |
| Clicking a link navigates and closes | PASS — `/team` loads, toggle returns to `aria-expanded="false"` |

Existing coverage in `tests/e2e/01-layout.spec.ts` (Escape + overflow) passes in
both the Chromium and mobile projects.

## 4. Project filters with JS enabled and disabled

| Mode | Action | Result |
|---|---|---|
| JS on | Click "Industrial" | 4 of 6 cards, URL gains `sector=industrial` |
| JS on | Select state "NSW" | 2 of 6 cards, URL gains `state=NSW` |
| JS on | Results note | "Showing 2 of 6 projects." |
| JS off (server render) | `GET /projects?sector=industrial&state=NSW` | 2 of 6 cards, same note |

Filters are server-rendered from `searchParams`, so a no-JS visitor gets the
same filtered list from the URL. **PASS**

## 5. Quote and contact forms

| Check | Quote (`/quote`) | Contact (`/contact`) |
|---|---|---|
| Empty submit shows field errors | PASS — "Full name is required" | PASS — "Full name is required" |
| Invalid email shows its own message | PASS — "Enter a valid email address" | PASS (same Zod schema) |
| Invalid submit stores no row | PASS (`10-quote-form.spec.ts`) | PASS — count unchanged |
| Happy path shows the success panel | PASS — "Thank you" | PASS — "Thank you" |
| Exactly one inquiry stored | PASS | PASS |
| Double click stores exactly one row | PASS — one row added | PASS — one row added (measured) |
| Server error (simulated 500) shows a form-level alert | PASS — "We could not send your request. Please email info@smartsolutionsaustralia.com.au." | PASS (same message) |

The double click is safe because `isSubmitting` is set synchronously before the
request and the `submissionId` is idempotent server-side. The simulated 500 was
injected with `page.route` so the `postInquiry` form-level error branch was
exercised in the browser for both forms.

## 6. Inquiry appears in `/admin/collections/inquiries`

Submitted a quote with a unique name (`QA Double <id>`), then signed in to the
admin REST API and loaded `/admin/collections/inquiries`: the row was listed
with that name. **PASS**

## 7. Email delivery with real SMTP credentials

**NOT RUN.** `.env` has `MAIL_ENABLED=false` and no real SMTP credentials are
available in this environment, so no message could be delivered. The code path is
exercised and covered: with mail disabled a submission still succeeds
(`email disabled still succeeds` test), and `POST /api/inquiries` returns
`emailSent: false`. Once credentials exist:

```bash
# .env
MAIL_ENABLED=true
SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=…
MAIL_FROM="Smart Solutions Australia <no-reply@smartsolutionsaustralia.com.au>"
MAIL_TO_QUOTE=info@smartsolutionsaustralia.com.au
MAIL_TO_CONTACT=info@smartsolutionsaustralia.com.au
```

Restart the app, submit each form, and confirm the response carries
`emailSent: true` and both inboxes receive the message. **TODO**

## 8. Lighthouse mobile on `/` and `/projects`

Run with Lighthouse 12.6 against the production build (`npm run start`), mobile
emulation (Moto G Power profile), default throttling:

| Page | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| `/` | **92** | **100** | **100** | **100** |
| `/projects` | **97** | **100** | **100** | **100** |

Core metrics, `/`: FCP 0.9 s, LCP 2.9 s, TBT 190 ms, CLS 0, Speed Index 1.0 s.
`/projects`: FCP 1.0 s, LCP 2.7 s, TBT 60 ms, CLS 0, Speed Index 1.0 s.

Notes on the remaining Performance gaps, all measured and understood:

- **Home LCP 2.9 s.** The hero photo was initially served at 3840px wide on a
  412px viewport (Lighthouse scored the page 75). `SafeImage` now forwards a
  `sizes` hint, so the browser picks a 750–828px candidate. This alone lifted
  home Performance from 75 to 92/93 and cut ~500 KiB from the hero transfer.
- **"Avoid multiple page redirects" (~630 ms).** Lighthouse sees one redirect on
  the document. `curl -L` shows **0** redirects and a 200 on the first request.
  The report's own detail lists the entry's own time twice (`wastedMs` 632 and
  0), which is the well-known false positive for a `Cache-Control: no-store`
  document — every frontend route is `force-dynamic` by design so CMS edits
  appear without a rebuild. Not a defect.
- **Back/forward cache** is blocked by that same `no-store` header. Accepted
  trade-off for live CMS content.
- Both pages report remaining "image delivery" savings (~140 KiB on
  `/projects`) from re-encoding the source JPEG/PNG files. That is an asset
  optimisation, not a code defect, and does not change the visible result.

---

## Automated suite status (this pass)

| Command | Result |
|---|---|
| `npm run test:unit` | 28 passed, 0 failed |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx playwright test` | **168 passed, 6 skipped, 0 failed** (1.9 m) |

The 6 skips are deliberate: the 4 quote-form tests and the 1 contact-form test
skip the `mobile` project because they insert rows and would disturb each
other's exact counts, and the new keyboard test skips only the WebKit mobile
project (see below).

### Known browser caveat

WebKit (Safari and the iPhone 13 emulation) excludes links from the Tab order by
default — the "Press Tab to highlight each item" preference is off. In that
browser a `Tab` press lands on the first form control and never reaches the skip
link, so `99-quality.spec.ts`'s keyboard test skips the WebKit project and runs
on Chromium. The skip link itself is present, is the first focusable element, and
is revealed on focus (measured: `top` -84.7 px at rest, 8 px when focused).

## Open items

- Real SMTP delivery (section 7) — needs credentials.
- Real iOS Safari and Android Chrome on physical devices — this pass used
  Playwright's WebKit and Chromium emulation only.
- VoiceOver / TalkBack / NVDA screen-reader passes — not available here.
