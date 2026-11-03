# SmartQuote v2 — Test Access Reference

This file is the single source of truth for **how to reach each app during local testing**. Ports,
domains and seeded accounts are listed here so you do not have to grep `.env` files or remember which
seed script created which user.

> Credentials for Places and ShedSafe live in `.env` only. There is no admin screen for them, and the
> `platform_settings` table has been dropped (migration `008`). Changing a key means editing `.env`
> and restarting the API.

## Apps and ports

| App | Port | URL | Purpose |
| --- | ---- | --- | ------- |
| API | 3060 | http://localhost:3060 | Fastify backend. All `/api/v1/*` routes live here. |
| Client | 3061 | http://localhost:3061 | Next.js app for sales staff: quotes, editor, documents. |
| Admin | 3062 | http://localhost:3062 | Next.js app for the vendor: companies, price books, releases, templates, usage. |
| Docs / Storybook | 3063 | http://localhost:3063 | Component docs and the share-link preview host. |

All four run under `pnpm dev` from the repository root. The client and admin apps proxy their own
`/api/sq/*` paths to the API on port 3060, so browser requests never need to know the API port
directly.

## Domains (for cookies and CORS)

Local development uses `localhost` only. There are no custom hostnames, no `/etc/hosts` entries and
no TLS certificates to install. If you later bind real domains, update these three env vars in
`.env`:

- `SITE_ORIGIN` — the public origin of the client app (used by share links and password-reset emails).
- `ADMIN_ORIGIN` — the public origin of the admin app (used by the admin session cookie).
- `API_ORIGIN` — the public origin of the API (used by CORS when the apps are on different hosts).

Until then, leave them unset; the defaults point at the four localhost ports above.

## Seeded accounts

`start/start-306.bat` provisions **one company and one platform administrator** on first run, and
does nothing on later runs. The values below are the launcher's defaults; every one of them can be
overridden by setting the same environment variable before starting. Passwords are intentionally
long enough to pass validation and short enough to type.

### Platform (vendor) admin

Use this account on **http://localhost:3062** to manage companies, publish price books, author
templates and read usage across every tenant.

| Field | Value |
| ----- | ----- |
| Email | `ops@smartquote.local` |
| Password | `platform-password-change-me` |
| Role | `platform_admin` |

### Demo company

One shed company, one administrator, one settings row. The price book is published separately by
the launcher (`pnpm publish-book --if-empty`), so a fresh clone with no licensed book can still sign
in and open the editor — it just cannot price anything, and says so.

Sign-in takes **three fields, in this order**: the company code, the username, then the password.
The code is what picks the company — a username is only unique inside one, so `owner` at another
company is a different person.

| Field | Value |
| ----- | ----- |
| **Company code** | `DEMOSHEDS` |
| **Username** | `owner` |
| Password | `a-long-enough-password` |
| Role | `company_admin` |
| Tenant slug | `demo-sheds` |

The email `owner@demo-sheds.local` is still on the account — it is where a quote is mailed from —
but it is **not** what you type to sign in.

### A second person with a smaller role

The seed creates only the administrator. To test what an estimator sees, invite them from
**Team** while signed in as `owner` (Settings → Team → invite, role `estimator`), then sign in with
the company code `DEMOSHEDS` and the username they were invited under. Their capabilities are
checked on the server for every operation, so a hidden button is never the only thing stopping them.

### Adding your own company

A second company is an ordinary operation now, not a refused one. From the admin app
(`POST /api/v1/admin/companies`), supply a `code` (letters, digits, dashes; stored upper-case) and
the first administrator's email and name; the response carries a one-time password, and the
username defaults to the part of that email before the `@`. A created company signs in exactly the
way above.

## Integration credentials (`.env` only)

Both integrations are **optional**. When a key is absent, the relevant UI degrades to the hand-typed
path and says so plainly; nothing crashes.

### Google Places

Used by the address autocomplete on the quote editor. Without it, the field accepts free text and
the site-check pin step asks for a manual suburb/state/postcode.

```env
GOOGLE_PLACES_API_KEY=AIzaSy...your-key-here
```

Get a key from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with the
**Places API (New)** enabled. The key is billed per keystroke; set a quota in Cloud Console before
testing.

### ShedSafe SiteCheck

Used to pin a building and read back the certified wind rating. Without it, the wind fields on the
quote editor remain manual-entry and the site-check panel says "ShedSafe is not configured".

```env
SHEDSAFE_USERNAME=your-shedsafe-username
SHEDSAFE_PASSWORD=your-shedsafe-password
# Optional — defaults to https://api.sitecheck.shedsafe.com.au/v1
SHEDSAFE_BASE_URL=https://api.sitecheck.shedsafe.com.au/v1
```

Credentials come from your ShedSafe manufacturer account. They are the same ones the desktop licence
server used; if you have an existing `.env` or config file from that system, copy the values rather
than re-entering them.

## Verifying the setup

After `pnpm dev` is running and `.env` has the keys you want:

1. Sign in to http://localhost:3062 as `ops@smartquote.local`. The Releases and Templates pages
   should load without error; Usage will be empty until someone creates a quote.
2. Sign in to http://localhost:3061 with company code `DEMOSHEDS`, username `owner`, password
   `a-long-enough-password`. Open any quote and type into the customer address field — if Places is
   configured, suggestions appear within a second.
3. On the same quote, open the site-check panel. If ShedSafe is configured, the "Pin site" button is
   enabled; otherwise the panel explains what to type by hand.
4. Create a new quote from a template on the quotes list. The building should arrive pre-filled and
   the customer fields should be empty — that is the rule the catalogue exists under.

If any of these fail, check the API terminal output first. The API logs the exact reason a transport
returned `null`, which is almost always a missing or misspelled env var.