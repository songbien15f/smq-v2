# SmartQuote v2

A web rebuild of the SmartQuote shed-quoting product: a separate backend and three
front-ends, replacing a WinForms desktop app and its ASP.NET Core licence server.

**One company, one database.** This is not multi-tenant SaaS. It is deployed for a single
shed company on their own Postgres. The schema still carries `tenant_id` — that is what makes
another company's rows unreachable — but a second company is refused. See
[`docs/DECISIONS.md`](docs/DECISIONS.md) A2.

**Read first**

| Document | Why |
|---|---|
| [`docs/FEATURE-COVERAGE.md`](docs/FEATURE-COVERAGE.md) | **What is converted and what is not** — measured, not planned |
| [`docs/PLAN.md`](docs/PLAN.md) | What the product does, the phase order, what is verified |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every structural decision, and the questions still open |
| [`docs/KNOWN-DEVIATIONS.md`](docs/KNOWN-DEVIATIONS.md) | Where the numbers deliberately differ from the old app |
| [`design-system/smartquote-v2/MASTER.md`](design-system/smartquote-v2/MASTER.md) | Colour, type, density, component rules |

## Shape

```
packages/core        pure: geometry, BOM, pricing, estimating, the .sqd file reader
packages/contracts   zod schemas + DTOs shared by the API and every front-end
packages/db          schema, migrations, repositories (Postgres, or SQLite offline)
packages/ui          design tokens + components
apps/api             Fastify — the only process that touches a database
apps/admin           the vendor's control plane for this one company
apps/client          the shed company's workspace (the quote editor lives here)
apps/site            end-customer site: landing, share viewer, enquiry
```

`packages/core` imports **no** database, HTTP or tenant. That boundary is what lets the
quoting engine be tested without infrastructure and reused by all three sites.

## Requirements

- **Node 22 or newer** — the SQLite fallback is the built-in `node:sqlite`.
- **pnpm 10 or newer.**
- **Postgres 14+.** Verified on **PostgreSQL 18.1**: three migrations, 27 tables, both
  immutability triggers, and the API suite 42/42.

### Provisioning Postgres once

The application must not be able to create its own role or database — a connection that can
run `CREATE ROLE` can grant itself anything. So it is a superuser's job, done once:

```bash
# Windows: psql is not on the PATH by default
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres -f scripts/postgres-setup.sql

# Linux / macOS
psql -h 127.0.0.1 -U postgres -f scripts/postgres-setup.sql
```

It creates the role `smartquote`, the database `smartquote`, and grants the schema. **Change
the password before anything leaves a laptop**, and use a secret store in a deployment.

## Run it — double-click

**`start-306.bat`** does everything and opens the browser:

1. checks Node and pnpm;
2. copies `.env.example` to `.env` on the first run;
3. installs dependencies if `node_modules` is missing;
4. migrates the database, and stops with a clear message if Postgres is unreachable;
5. creates the company — **skipped if one exists** (`--if-empty`);
6. publishes the price book — **skipped if one is active**, and only a warning if the licensed dump
   is absent;
7. starts all four services and opens the client once it answers.

| Service | URL |
|---|---|
| **Client** (the workspace) | **http://localhost:3061** |
| Admin (the vendor's control plane) | http://localhost:3062 |
| Site (end customer) | http://localhost:3063 |
| API | http://localhost:3060/api/v1 |

Sign in with `owner@demo-sheds.local` / `a-long-enough-password` — the launcher prints these too.

**`stop-306.bat`** kills whatever is listening on 3060–3063. Use it when the window was closed
without Ctrl+C: the four Node processes survive that, and the next start then fails with "address
already in use".

**No Postgres?** Put `DB_DRIVER=sqlite` and `DB_FILE=./data/app.db` in `.env` and the same launcher
runs on SQLite. Nothing else changes.

## Run it — by hand

```bash
pnpm install
cp .env.example .env

pnpm db:migrate
COMPANY_NAME="Demo Sheds Pty Ltd" \
COMPANY_ADMIN_EMAIL=owner@demo-sheds.local \
COMPANY_ADMIN_PASSWORD="a-long-enough-password" \
COMPANY_SLUG=demo-sheds \
PLATFORM_ADMIN_EMAIL=ops@example.com \
PLATFORM_ADMIN_PASSWORD="another-long-password" \
  pnpm install:company

pnpm publish-book    # needs a dump in tools/price-dump/out
pnpm seats:release   # release seats held by crashed or closed sessions
pnpm dev
```

`PLATFORM_ADMIN_*` is optional and is what makes the admin site reachable at all.

### Provisioning Postgres once

The application must not be able to create its own role or database — a connection that can run
`CREATE ROLE` can grant itself anything. So it is a superuser's job, done once:

```bash
# Windows: psql is not on the PATH by default
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres -f scripts/postgres-setup.sql

# Linux / macOS
psql -h 127.0.0.1 -U postgres -f scripts/postgres-setup.sql
```

It creates the role `smartquote`, the database `smartquote`, and grants the schema. **Change the
password before anything leaves a laptop.**

### Running the tests against Postgres as well as SQLite

The suite defaults to an in-memory SQLite database. It can also run on Postgres, which is the only
way to know the portable SQL and the adapter work there — **three real defects were found this way
and none was visible by reading the SQL**:

```bash
# A database whose name contains "test": the suite drops every table in it.
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres \
  -c "CREATE DATABASE smartquote_test OWNER smartquote;"

cd apps/api
TEST_DB_DRIVER=postgres \
TEST_DATABASE_URL=postgres://smartquote:smartquote@127.0.0.1:5432/smartquote_test \
  pnpm test
```

### Without Postgres

The same migrations run on SQLite, for a single-machine install or a dev box with no server — set
`DB_DRIVER=sqlite` and `DB_FILE=./data/app.db` in `.env` and use the same commands as above.

**`pnpm db:seed`** is a separate development-only shortcut: it creates a platform administrator and
a demo company with passwords that are in the repository, and refuses to run with
`NODE_ENV=production`.

### Two traps worth knowing

**Use `localhost`, not `127.0.0.1`.** A browser treats them as different origins; the page
renders and never hydrates, so forms silently stop working.

**Build a package before an app sees your change.** Apps consume `@sq/ui`, `@sq/core`,
`@sq/contracts` and `@sq/db` from their `dist`, so editing a component and refreshing shows
the old component until a build runs. `pnpm build` at the root orders this correctly.

## Commands

```bash
pnpm dev              # every app, watching
pnpm build            # every app, production
pnpm typecheck        # tsc --noEmit across the workspace
pnpm test             # vitest across the workspace
pnpm db:migrate       # apply migrations
pnpm db:seed          # development data only
pnpm install:company  # provision the one company
```

## The engine, checked against the real price book

`packages/core` runs its tests against hand-built fixtures, and a fixture can encode the same
misunderstanding as the code. This is the path that goes through the real licensed dump:

```bash
cd packages/core
npx tsx scripts/golden.ts                     # price every preset against the real book
npx tsx scripts/golden.ts --sqd <file.sqd>    # and read a real quote file beside it
```

It reports the totals, the line counts, how many lines are `assumed`, and every issue the
engine raised. The intended use is to put those figures next to a quote the old system issued.
They are *expected* to differ in the ways `KNOWN-DEVIATIONS.md` lists, which is why the script
prints rather than asserts.

## Data that must never be committed

- `.env` — database URL, SMTP credentials, the Places key, the ShedSafe account.
- `data/` — published price books and the PDF cache.
- `tools/price-dump/out/` — the licensed supplier price book. It is the customer's commercial
  asset and the reason this product can be sold at all.
