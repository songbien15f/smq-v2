# Smart Solutions Australia — website

The public website and CMS for Smart Solutions Australia (structural steel
fabrication). Next.js 15 App Router front end, Payload CMS 3 admin, PostgreSQL.

| | |
|---|---|
| Public site | `/` … `/contact` (10 pages) |
| Admin | `/admin` |
| Health probe | `/api/health` → `{ "ok": true, "db": "up" }` |
| Default port | **3065** |
| Uploads | `media/` on disk (served by Payload) |

---

## 1. Prerequisites

- **Node.js ≥ 20.9** (developed on Node 24.12). Check with `node -v`.
- **PostgreSQL 16 or newer** (developed on 18.1). The database is a separate
  server; nothing in this project starts one for you.
- On Windows, the PostgreSQL installer does **not** add its `bin` directory to
  `PATH`. Client tools live at `C:\Program Files\PostgreSQL\18\bin`; the backup
  script detects that path automatically (see §6).

---

## 2. First local setup

### 2.1 Create the database

```bash
# Windows (psql is not on PATH):
"C:\Program Files\PostgreSQL\18\bin\createdb" -U postgres smartcoa

# macOS / Linux:
createdb -U postgres smartcoa
```

Or with a SQL prompt:

```bash
psql -U postgres -c "create database smartcoa"
```

### 2.2 Install dependencies

```bash
npm ci
```

`npm install` also works, but `ci` gives you the committed lockfile exactly.

### 2.3 Configure the environment

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Then edit `.env`:

| Variable | Purpose |
|---|---|
| `DATABASE_URI` | `postgresql://postgres:123456@127.0.0.1:5432/smartcoa` for a local database. Change user/password/port to match yours. |
| `PAYLOAD_SECRET` | Long random string. **Must change for production.** Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `NEXT_PUBLIC_SERVER_URL` | Public base URL. `http://localhost:3065` locally; the real domain in production (used for canonical URLs, sitemap and robots). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The first admin user created by `npm run seed`. |
| `MAIL_*` / `SMTP_*` | Optional email notifications. Leave `MAIL_ENABLED=false` until SMTP credentials exist — inquiries are still stored in the database. |

### 2.4 Apply migrations and seed content

```bash
npm run migrate     # create/upgrade the schema
npm run seed        # idempotent demo content + the first admin user
```

`npm run seed` is safe to re-run: it logs `… unchanged` for anything already
present and never duplicates records.

### 2.5 Start the dev server

```bash
npm run dev         # http://localhost:3065
```

The dev script pins port 3065 (`next dev -p 3065`), matching the `Start/`
scripts, `playwright.config.ts` and every URL in this document and in
`docs/operations.md`.

The dev server compiles routes on first request, so the first page load can take
20–40 seconds.

### 2.6 Windows: one-click start/stop

The `Start/` folder wraps the steps above for non-developers:

| File | What it does |
|---|---|
| `Start\START-WEBSITE.bat` | Checks Node and PostgreSQL, installs dependencies if missing, runs `migrate` + `seed`, opens `/admin`, then runs `npm run dev` on port 3065. Local only. |
| `Start\START-WEBSITE-PUBLIC.bat` | The same, plus a Cloudflare quick tunnel, so a remote tester can open a temporary `https://*.trycloudflare.com` address. The URL is printed in the console and written to `Start\PUBLIC-URL.txt`. |
| `Start\STOP-WEBSITE.bat` | Kills whatever is listening on port 3065, and stops the Cloudflare tunnel if one is running. |
| `Start\USER-INFO.md` | Vietnamese walkthrough of the site, admin tour and test scenarios. |

Keep the console window open while testing; closing it stops the server.

### Sharing a build with a remote tester

`Start\START-WEBSITE-PUBLIC.bat` starts a Cloudflare quick tunnel in front of the
local dev server. It needs no Cloudflare account; `cloudflared` must be on `PATH`
(`winget install --id Cloudflare.cloudflared`).

- The hostname changes on every run.
- The tunnel serves the whole app, **including `/admin`** — share the link only
  with the person reviewing, and run `Start\STOP-WEBSITE.bat` when the review ends.
- `NEXT_PUBLIC_SERVER_URL` is set to the tunnel address before `next dev` starts,
  so canonical URLs, the sitemap and `robots.txt` match the link the tester opens.
- Quick tunnels have no uptime guarantee and are for review, not production. For a
  stable hostname, use a named Cloudflare tunnel with your own domain.

---

## 3. Admin access

| | |
|---|---|
| URL | `http://localhost:3065/admin` |
| Email | `ADMIN_EMAIL` from `.env` (default `admin@example.com`) |
| Password | `ADMIN_PASSWORD` from `.env` (default `Admin12345!`) |

Those credentials are created **only when the users collection is empty**, so
changing `.env` on an existing database does not change an existing password.
To reset it, delete the user in `/admin/collections/users` (or
`npm run payload -- …`), then run `npm run seed` again. In production, create a
real admin user in the admin UI and change `ADMIN_PASSWORD` before the first
public deployment.

What an editor can change is documented in [`docs/operations.md`](docs/operations.md).

---

## 4. Build and run in production

```bash
npm run build       # production build (type-checked and linted)
npm run start       # serves the build on http://localhost:3065
```

Notes:

- `next.config.ts` sets `output: 'standalone'`, so the build also produces
  `.next/standalone/server.js` — a self-contained server bundle used by the
  Docker image.
- The build prerenders `robots.txt` and the published project detail pages, so
  `NEXT_PUBLIC_SERVER_URL` must be correct **at build time** — it is baked into
  `robots.txt`. The Docker image therefore takes it as a build argument:
  `docker compose build` forwards `NEXT_PUBLIC_SERVER_URL` from `.env`. If the
  database is unreachable during a build, project pages are skipped with a
  warning and rendered on demand instead, so a build never requires a live
  database — the Docker image builds without one, and `npm run migrate` runs
  afterwards.
- Stop any running `npm run dev` before `npm run build`. Both write `.next/`, and
  a dev server left running against a fresh production build serves a broken
  (partial) stylesheet.
- `npm run start` binds port 3065 explicitly (`next start -p 3065`). `PORT` in
  `.env` is ignored by the Next CLI, so 3065 is the single source of truth and
  matches `NEXT_PUBLIC_SERVER_URL` and `playwright.config.ts`. To move the port,
  change `-p 3065` in `package.json`, `NEXT_PUBLIC_SERVER_URL` in `.env`, and the
  port mapping in `docker-compose.yml` together.
- Verify a deployment with:

  ```bash
  curl -f http://127.0.0.1:3065/api/health     # {"ok":true,"db":"up"}
  curl -f http://127.0.0.1:3065/projects       # 200
  ```

### 4.1 systemd (Linux)

`deploy/smart-solutions.service` is a template. Adjust the four
`PLACEHOLDER`-marked paths (`WorkingDirectory`, `EnvironmentFile`,
`ExecStartPre`, `ExecStart`), copy it to `/etc/systemd/system/`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smart-solutions
journalctl -u smart-solutions -f
```

Migrations run via `ExecStartPre` on every start; `npm run migrate` is
idempotent, so this is safe.

---

## 5. Docker

`Dockerfile` builds the app on `node:22-alpine`; `docker-compose.yml` runs it
next to `postgres:18`. The database is **external to the app container** — the
compose `db` service is one way to provide it, a managed database is another.

`DATABASE_URI` inside compose is overridden to point at the `db` service
(`postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/smartcoa`), so the
`127.0.0.1` value in `.env` is for local non-Docker development only.

### First-run sequence

```bash
# 1. Set the public origin and the database password in .env
#    NEXT_PUBLIC_SERVER_URL=https://www.smartsolutionsaustralia.com.au
#    POSTGRES_PASSWORD=a-strong-password
#    (the 123456 default is for local development only)

# 2. Build the image (NEXT_PUBLIC_SERVER_URL is forwarded as a build arg)
docker compose build

# 3. Create the schema (one-off, and after every deploy that adds a migration)
docker compose run --rm app npm run migrate

# 4. Seed demo content and the first admin (optional on a production database)
docker compose run --rm app npm run seed

# 5. Start the stack
docker compose up -d

# Check
curl -f http://127.0.0.1:3065/api/health
docker compose logs -f app
```

Uploads are bind-mounted from `./media`, so images written by the CMS survive a
container rebuild. Database data lives in the `pgdata` named volume.

**PostgreSQL 18 volume path.** On the `postgres:18` image, `PGDATA` is
`/var/lib/postgresql/18/docker` and the declared volume root is
`/var/lib/postgresql`. The compose file mounts `pgdata:/var/lib/postgresql`; the
older `/var/lib/postgresql/data` layout applies to PostgreSQL 17 and earlier and
does **not** persist data on 18.

Subsequent deploys:

```bash
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

---

## 6. Backup and restore

### Backup

```bash
npm run backup
```

Writes one folder per run:

```
backups/2026-11-19T05-57-31-384Z/
  smartcoa.dump    # pg_dump --format=custom
  media/           # recursive copy of media/
```

It also deletes backup folders older than **14 days** and exits non-zero if
`pg_dump` fails (a failed run leaves no folder behind).

**pg_dump discovery (Windows).** The script looks for `pg_dump` in this order:

1. `PG_BIN` — either the executable itself or its `bin` directory, e.g.
   `set PG_BIN=C:\Program Files\PostgreSQL\18\bin`
2. `C:\Program Files\PostgreSQL\18\bin` (then 17, then 16)
3. `PATH`

If none exist it fails with a message naming `PG_BIN` and the expected path.

Schedule it with Windows Task Scheduler, cron, or a systemd timer:

```
# cron, daily at 02:00
0 2 * * * cd /opt/smart-solutions && /usr/bin/npm run backup >> /var/log/smart-solutions-backup.log 2>&1
```

Keep a copy off the machine: the 14-day window protects against mistakes, not
against disk failure.

### Restore

```bash
# Windows
"C:\Program Files\PostgreSQL\18\bin\pg_restore" --clean --if-exists \
  --dbname "postgresql://postgres:123456@127.0.0.1:5432/smartcoa" \
  "backups/<timestamp>/smartcoa.dump"

# macOS / Linux
pg_restore --clean --if-exists --dbname "$DATABASE_URI" "backups/<timestamp>/smartcoa.dump"
```

`--clean --if-exists` drops and recreates the objects in the dump. Restore into a
fresh database first if you want to inspect the result before replacing live
data. Then copy `backups/<timestamp>/media/` back over `media/`:

```bash
# macOS / Linux (Windows: use robocopy /MIR)
rsync -a --delete "backups/<timestamp>/media/" media/
```

Inspect a dump without restoring:

```bash
pg_restore --list "backups/<timestamp>/smartcoa.dump" | grep "TABLE DATA"
```

---

## 7. Tests

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test:unit      # node:test unit tests (tsx)
npm run test:e2e       # migrate + seed + Playwright (starts the dev server)
```

Playwright specs live in `tests/e2e/` and run on two projects (desktop Chromium
and an iPhone 13 viewport) against `http://127.0.0.1:3065`. With a dev server
already running on 3065, Playwright reuses it.

`tests/e2e/14-runtime.spec.ts` is the production smoke test: point it at
`npm run start` to confirm `/api/health` returns `{"ok":true,"db":"up"}` and
`/projects` returns 200 from a built app.

---

## 8. Project layout

| Path | Contents |
|---|---|
| `src/app/(frontend)/` | Public pages (`/`, `/capabilities`, … `/privacy`) and `api/inquiries` |
| `src/app/(payload)/` | Payload admin + REST/GraphQL routes |
| `src/collections/`, `src/globals/` | CMS schema |
| `src/components/` | Sections and UI used by the pages |
| `src/seed/` | Idempotent seed content |
| `src/migrations/` | Payload SQL migrations |
| `media/` | Uploads (not committed) |
| `scripts/backup.ts` | `npm run backup` |
| `deploy/smart-solutions.service` | systemd unit template |
| `docs/operations.md` | Day-to-day editing, publishing, backup, email |

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Start the service (`net start postgresql-x64-18` on Windows). |
| Port 3065 already in use | `Start\STOP-WEBSITE.bat`, or kill the process holding the port. |
| 500 on every page in production | `npm run dev` was running during/after `npm run build` and corrupted `.next`. Stop the dev server, rebuild, restart. |
| `/admin` has no content | Run `npm run seed`. |
| Content edits do not appear | Reload with `Ctrl+F5`; check the document is saved/published. |
| Inquiry form succeeds but no email | Expected with `MAIL_ENABLED=false`; the inquiry is still in `/admin/collections/inquiries`. See `docs/operations.md`. |
| `npm run backup` cannot find `pg_dump` | Set `PG_BIN` to the PostgreSQL `bin` directory. |
