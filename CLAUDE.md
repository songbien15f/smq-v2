# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SmartQuote v2 is a **web rebuild** of the SmartQuote shed-quoting product: a Fastify API plus three Next.js front-ends, in a pnpm + Turborepo TypeScript monorepo (Node ≥ 22). It replaces the WinForms desktop app and its licence server.

The parent folder's `CLAUDE.md` (the "dev team" rulebook and the `.NET Framework / WinForms` project profile) describes the **desktop app** in the sibling `../smq-code-smartquote`, not this repo. Its process rules (opt-in tests/git, never push) still load here, but its build commands and layout do not apply. The desktop source is only a *reference* for behaviour — see "Claim discipline" below.

## Commands

Run from the repo root unless noted. Postgres is the default database; `.env` is copied from `.env.example` (never commit `.env`, `data/`, or `tools/price-dump/out/`).

```bash
pnpm install
pnpm db:migrate                 # apply migrations (packages/db)
pnpm install:company            # provision the company + admin (reads COMPANY_* env, see README)
pnpm publish-book               # publish the licensed price book from tools/price-dump/out
pnpm dev                        # all four services, watching (turbo run dev)
pnpm build | typecheck | test   # turbo across the workspace; typecheck/test depend on ^build
pnpm test:e2e                   # Playwright smoke suite — needs `pnpm dev` already running
pnpm db:seed                    # development-only shortcut data (not the provisioning path)
pnpm seats:release              # free licence seats held by crashed/closed sessions
pnpm quotes:blocked [-- --tenant <slug> | --list]   # count quotes that cannot be priced (docs/OPERATIONS.md)
```

Postgres: `docker compose up -d` (local-only container, credentials match `.env.example`), or on a machine that already runs Postgres use `scripts/postgres-setup.sql`. `scripts/probe-*.mjs` are one-off live probes (pricing, documents, mail, ShedSafe), not tests.

Windows launcher: `start/start-306.bat` does the whole first-run (env, install, migrate, create company, publish book, start services, open browser); `start/stop-306.bat` kills whatever listens on 3060–3063. The README says these are at the repo root — they are in `start/`.

| Service | Port |
|---|---|
| API (`apps/api`) | 3060 (`/api/v1`) |
| Client (`apps/client`, the quote editor) | 3061 |
| Admin (`apps/admin`, vendor control plane) | 3062 |
| Site (`apps/site`, end customer) | 3063 |

Single package / single test:

```bash
pnpm --filter @sq/core test                              # one workspace's suite
pnpm --filter @sq/api exec vitest run src/__tests__/isolation.test.ts
pnpm --filter @sq/core exec vitest run -t "name fragment"
pnpm --filter @sq/api typecheck
```

- **Tests need Postgres and `TEST_DATABASE_URL`.** The application database is Postgres everywhere (DECISIONS D1) — there is no SQLite fallback. The suites (`@sq/api`, `@sq/db`) **drop every table** in a database whose name contains `test`, and refuse any other name: `TEST_DATABASE_URL=postgres://…/smartquote_test pnpm test`. `@sq/db` uses its own schema (`db_suite`) inside that database because Turbo runs the two suites in parallel.
- API test files run **serially** (`fileParallelism: false`) on purpose: each file resets a shared database.
- E2E uses the machine's installed Chrome (`channel: 'chrome'`), one worker, and a saved session in `e2e/.auth/` (a session holds a licence seat — don't add per-test sign-ins). The vendor-dashboard spec needs `VENDOR_DASHBOARD_PASSWORD` from `.env`.
- Real-price-book check of the engine (prints, doesn't assert): `cd packages/core && npx tsx scripts/golden.ts [--sqd <file.sqd>]`.
- No linter/formatter is configured.

### Two traps

- **Use `localhost`, never `127.0.0.1`** — different browser origin; the page renders but never hydrates.
- **Apps consume `@sq/ui`, `@sq/core`, `@sq/contracts`, `@sq/db` from their `dist`.** Editing a package and refreshing shows the old code until it is rebuilt. `pnpm dev` runs `^build` once then per-package `tsup --watch`; `pnpm build:inc` rebuilds core+contracts without cleaning `dist`.

## Architecture

```
packages/core       pure engine: domain (plan geometry), BOM, pricing, estimating, documents, .sqd reader
packages/contracts  zod schemas + DTOs shared by API and every front-end
packages/db         hand-written DB adapter (Postgres), migrations, no ORM
packages/ui         design tokens + components
apps/api            Fastify — the ONLY process that touches a database
apps/{client,admin,site}  Next.js front-ends
```

Rules that span many files (full rationale: `docs/DECISIONS.md`, entry ids in parentheses):

- **`@sq/core` imports no database, HTTP or tenancy (A9) and is the only place prices/costs/masses are computed (A13).** The API and UIs never recompute a total. The one controlled exception: `core/src/lib/pricing/*` reads the SQLite price book directly via `createLookup(db)`.
- **The price book is a separate, read-only, content-addressed SQLite file** (`data/price-books/<sha256>.db`, A4), published with `pnpm publish-book`. It is distinct from the application database. Each publication is a new file.
- **Data flow for the editor:** `apps/client` UI → `lib/sq.ts` `api()` → same-origin route handler `app/api/sq/[...path]/route.ts` → Fastify (A14). The browser never talks to the API or handles the session cookie directly, and `api()` returns a result value (`ApiResult`), not exceptions. Each front-end has its own bridge.
- **Quote editor state** lives in `apps/client/src/store/useShedStore.ts` (geometry) and `useDraftStore.ts` (draft); the editor is the 3-step flow Quote details → Options → Cost (`components/editor/*`).
- **API wiring:** `apps/api/src/app.ts` registers one `registerX(scope, db, …)` per file in `routes/`; shared logic is in `lib/` (sessions, guard, settings, mail queue, ShedSafe, Places, documents).
- **Multi-company, not single-company.** Sign-in is **company code + username + password**; usernames are unique per company (`memberships.username`). Vendor staff use a separate route (`/auth/sign-in-platform`). Every business table carries `tenant_id`, and `apps/api/src/__tests__/isolation.test.ts` proves cross-company rows are unreachable. The README still says "one company, one database" — that was reversed on 2026-11-03 (DECISIONS A2); trust DECISIONS and the code.
- **A licence seat belongs to a device, not a session** (D3): one browser profile, for one user, in one company, identified by the `sq_device` cookie. Signing in again on the same browser reuses the seat; a device revoked or idle past `DEVICE_IDLE_DAYS` gives its seat back inside the next sign-in's transaction. `tenant_seats` is gone (migration 017). Ordinary sign-out keeps the seat; `{ releaseDevice: true }` returns it.
- **The client's address comes from `request.ip` only** (`lib/http.ts` `clientIp`). Never read `X-Forwarded-For` in a route: `trustProxy` (from `TRUST_PROXY`, default `loopback`) decides which peers may set it, and a number is refused because Fastify 5 fails closed on hop counts.
- **The price book's bytes live in Postgres** (`price_book_files`, D2); `data/price-books/*.db` is a cache that `ensureBookOnDisk` restores and verifies. `pg_dump` alone now restores a working system.
- **Money is integer cents, and the database is Postgres only** (D1 supersedes the `DB_DRIVER` half of A3/A17). The portable subset that remains is about *predictability*, not about a second driver: ids are app-generated TEXT uuids, timestamps ISO-8601 TEXT, booleans 0/1. Write `?` placeholders — the driver rewrites to `$1…$n` (A12), so no `?|`/`??` operators. Don't write `? IS NULL` (Postgres can't infer the type — build the parameter list conditionally, A20).
- **`node:sqlite` is loaded via an assembled specifier** in `packages/core/src/lib/pricing/sqliteRuntime.ts` because tsup rewrites `from 'node:sqlite'` and breaks it at runtime (A15). Don't "simplify" it. The **only** SQLite left in the product is the price book's file format (A4/D2).
- **Relative paths in config resolve from the workspace root, not `process.cwd()`** (A16), since `pnpm --filter` runs inside the package dir.
- **Migrations:** numbered files in `packages/db/migrations/`; dialect-only extras in `migrations/pg/` or `migrations/sqlite/` run after the portable file with the same prefix. **Applied migrations are checksummed and an edit is refused — add a new file instead.** (`apps/db/migrations/008_*` is a stray duplicate of the package's 008; the runner reads `packages/db/migrations`.)
- **Env vars** reach Turbo tasks only if listed in `turbo.json` `globalPassThroughEnv` — add any new run-time variable there, or it arrives unset and the failure points at the wrong setting.
- **The quote file reader (`.sqd`)** handles plaintext JSON and AES-256-CBC and deliberately refuses .NET `BinaryFormatter` files (A19).
- BOM bugs from the desktop are **fixed, not replicated**; each deliberate numeric divergence is a row in `docs/KNOWN-DEVIATIONS.md` (A8).

## Claim discipline (read before writing "blocked" or "missing")

`docs/CLAIM-DISCIPLINE.md` exists because five features were wrongly recorded as impossible. Before recording anything as blocked/missing/needing a new model, in the same session: (1) list the price-book tables/columns (`data/price-books/<hash>.db`), (2) open the desktop method in `D:\Docs\OS.mr.Thi\smq-code-smartquote` and cite file:line, (3) check whether the desktop code is commented out (it carries a lot of dead code). Otherwise write "not yet checked". **Plans are not inventory** — `PLAN-REMAINING.md` and `docs/superpowers/plans/*` record intent; the code wins. `docs/smartquote-quote-editor-reference.md` (Vietnamese) is the trusted live description of editor rules, BOM and documents, and is corrected in the same commit as the code.

Other docs: `docs/FEATURE-COVERAGE.md` (what is converted; partly stale), `docs/PRICING-PIPELINE.md`, `docs/OPERATIONS.md`, `docs/TEST-ACCESS.md`, `design-system/smartquote-v2/MASTER.md` (navy/gold palette passes AA — don't regress to the rejected blue/orange glass look; fonts are a system stack, not `next/font`, so builds work offline). `docs/note.md` holds live credentials and is gitignored.
