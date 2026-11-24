# VPS deployment — intro site + SmartQuote app (client test)

Audience: an agent with SSH access to the VPS, running from the developer's Windows machine
(where both source trees live). Goal: both sites live on HTTPS under five hostnames, linking to
each other, ready for the client to test.

## 0. Ground rules

- **Never print secrets** (passwords, `PAYLOAD_SECRET`, `SESSION_SECRET`, API keys) in chat or logs.
  Generate them on the server (`openssl rand -hex 32`), write them only into `.env` files (mode
  `0600`), and tell the human where they are, not what they are.
- Don't modify the source tree on the Windows machine. Don't commit or push anything.
- Only ports **22, 80, 443** may be reachable from the Internet. 3060–3063 and 3065 stay internal.
- Stop and ask the human before anything destructive on the VPS (dropping a database, deleting a
  directory that already holds data).

## 1. What runs where

| Hostname | Service | Local port | Source |
|---|---|---|---|
| `smartquote.martechsky.com` | Intro site + Payload CMS (`/admin`, `/api`) | 3065 | `…\02.smartquote_v2\00.smartcoaustralia.com.au` (npm project with its own `package-lock.json`, **not** in the pnpm workspace) |
| `quote-smartquote.martechsky.com` | App **site** — guest quote page `/quote`, guest account `/quote/account` | 3063 | `…\02.smartquote_v2\apps/site` |
| `app-smartquote.martechsky.com` | App **client** — staff workspace (sign-in) | 3061 | `…\02.smartquote_v2\apps/client` |
| `admin-smartquote.martechsky.com` | App **admin** — vendor control plane (sign-in) | 3062 | `…\02.smartquote_v2\apps/admin` |
| `api-smartquote.martechsky.com` | App **API** (Fastify, prefix `/api/v1`) | 3060 | `…\02.smartquote_v2\apps/api` |

Cross-links this deploy must produce:
- Intro: every "Request a Quote" link → `https://quote-smartquote.martechsky.com/quote?step=start&src=intro`,
  and `https://smartquote.martechsky.com/quote` answers **307** to the same place.
- Guest page: logo + Home / Projects / Contact → `https://smartquote.martechsky.com/…`.

The intro site lives **inside the app's git repo** (folder `00.smartcoaustralia.com.au/`, imported in
commit `9abfd71`), but it is a separate npm project with its own database and its own deploy directory.

Process model: native Node under **systemd** (one unit per service), **Caddy** in front (automatic
HTTPS), **one PostgreSQL** server with two databases. No Docker needed.

## 2. Prerequisites (check before starting)

1. DNS: all five hostnames have an **A record → VPS IP** (`dig +short <host>` for each). Caddy can't
   issue certificates until they resolve.
2. VPS: Ubuntu 22.04/24.04, ≥ 4 GB RAM (the app's monorepo build is heavy; add 4 GB swap if less),
   ≥ 20 GB disk.
3. Ask the human which **data** to ship (recommended defaults in brackets):
   - Intro CMS content: [**copy the local database + `media/`**, so content edited in the CMS survives]
     or fresh `seed`.
   - App: [**copy the local `smartquote` database**: company, users, price book, guest types already set
     up] or fresh `install:company` + `publish-book`.
4. Code transfer is **from the local working tree**, not git: the repo has no remote. Everything this deploy
   needs is committed locally (guest accounts = commit `9c99373`, migration `024_guest_accounts.sql`), but
   ship the working tree anyway so any later local edits go too. The human decides whether to push.

## 3. Server base setup

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git build-essential postgresql chromium-browser || sudo apt -y install chromium
# Node 22 LTS (both projects need >= 22)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
sudo corepack enable && corepack prepare pnpm@12.8.1 --activate   # app's packageManager
# Caddy
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
# Service user + dirs
sudo useradd --system --create-home --shell /usr/sbin/nologin smartquote || true
sudo mkdir -p /opt/smartquote-intro /opt/smartquote-app && sudo chown smartquote: /opt/smartquote-*
```

Record `command -v chromium chromium-browser` (needed for `CHROME_PATH`; PDFs answer 503 without it).

### PostgreSQL: two roles, two databases

```bash
INTRO_DB_PW=$(openssl rand -hex 24); APP_DB_PW=$(openssl rand -hex 24)
sudo -u postgres psql -c "CREATE ROLE smartcoa LOGIN PASSWORD '$INTRO_DB_PW';" -c "CREATE DATABASE smartcoa OWNER smartcoa;"
sudo -u postgres psql -c "CREATE ROLE smartquote LOGIN PASSWORD '$APP_DB_PW';" -c "CREATE DATABASE smartquote OWNER smartquote;"
```

Keep the two passwords in shell variables only long enough to write them into the `.env` files below.

## 4. Ship the code (from the Windows machine)

Windows 10+ has `tar` and `scp` built in. Exclude build output, dependencies and local secrets:

```powershell
cd D:\Docs\OS.mr.Thi\02.smartquote_v2\00.smartcoaustralia.com.au
tar -czf $env:TEMP\intro.tgz --exclude=node_modules --exclude=.next --exclude=test-results --exclude=backups --exclude=.env --exclude=.git .
cd D:\Docs\OS.mr.Thi\02.smartquote_v2
tar -czf $env:TEMP\app.tgz --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=dist --exclude=test-results --exclude=.env --exclude=.env.local --exclude=.git --exclude=./00.smartcoaustralia.com.au --exclude=./.claude --exclude=./note_private_ignore --exclude=./e2e/.auth --exclude=./data/app.db* --exclude=./data/smartquote.db --exclude=./data/test-accounts.json --exclude=./data/TEST-ACCOUNTS.md --exclude=./data/pdf-cache --exclude=./docs/note.md .
scp $env:TEMP\intro.tgz $env:TEMP\app.tgz <user>@<vps>:/tmp/
```

On the VPS:
```bash
sudo -u smartquote tar -xzf /tmp/intro.tgz -C /opt/smartquote-intro
sudo -u smartquote tar -xzf /tmp/app.tgz   -C /opt/smartquote-app
```

The app tarball leaves out the nested intro folder (it ships as `intro.tgz`), the developer's test
accounts, the saved e2e session, `docs/note.md` (live credentials) and `.claude/`. If any of these slipped
in, delete them on the VPS before building.

`media/` (intro uploads) is included in `intro.tgz`. `data/price-books`, `data/template-files` and
`data/shedsafe-salesmen.json` are included in `app.tgz`. The local SQLite files (`app.db`, `smartquote.db`)
are excluded on purpose: production uses Postgres.

## 5. Intro site (`/opt/smartquote-intro`)

### 5.1 `.env` (mode 0600, owner `smartquote`)

```dotenv
DATABASE_URI=postgresql://smartcoa:<INTRO_DB_PW>@127.0.0.1:5432/smartcoa
PAYLOAD_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_SERVER_URL=https://smartquote.martechsky.com
QUOTE_APP_URL=https://quote-smartquote.martechsky.com/quote?step=start
ADMIN_EMAIL=<ask human>
ADMIN_PASSWORD=<openssl rand -base64 18>   # only used by `seed` when no user exists
MAIL_ENABLED=false                          # inquiries still land in /admin; turn on later with SMTP_*
MAIL_TO_QUOTE=info@smartsolutionsaustralia.com.au
MAIL_TO_CONTACT=info@smartsolutionsaustralia.com.au
```

`NEXT_PUBLIC_SERVER_URL` is baked in at build (canonical URLs, sitemap, robots), so it must be correct
**before** `npm run build`. `QUOTE_APP_URL` is read per request, so changing it later needs only a restart.

### 5.2 Data

- **Copy local** (recommended): on Windows run `npm run backup` in the intro folder (writes a `pg_dump`
  into `backups/<timestamp>/smartcoa.dump`, custom format, plus a copy of `media/`; set `PG_BIN` if
  `pg_dump` isn't on PATH), `scp` the dump, then on the VPS
  `pg_restore --no-owner --role=smartcoa -d smartcoa smartcoa.dump`. Then run migrations (below), which is
  a no-op if the dump is current.
- **Fresh**: after migrating, `npm run seed` (creates the admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  and the seed content).

### 5.3 Build + service

```bash
cd /opt/smartquote-intro
sudo -u smartquote npm ci
sudo -u smartquote bash -c 'set -a; . ./.env; set +a; npm run migrate && npm run build'
```

Install `deploy/smart-solutions.service` as `/etc/systemd/system/smartquote-intro.service`, replacing:
`User/Group=smartquote`, `WorkingDirectory` and `EnvironmentFile` → `/opt/smartquote-intro[/.env]`,
`ReadWritePaths` → `/opt/smartquote-intro/{media,backups,.next/cache}` (create `backups/`),
`ExecStartPre`/`ExecStart` → `$(command -v npm) run migrate` / `$(command -v npm) run start`.
Then `sudo systemctl daemon-reload && sudo systemctl enable --now smartquote-intro`.

Check: `curl -s localhost:3065/api/health` → 200.

## 6. SmartQuote app (`/opt/smartquote-app`)

### 6.1 `.env` at the repo root (mode 0600)

Start from `.env.example` (`cp .env.example .env`) and set:

```dotenv
NODE_ENV=production
API_PORT=3060
CLIENT_PORT=3061
ADMIN_PORT=3062
SITE_PORT=3063

# Server-side calls (Next bridges → API) stay on loopback.
API_BASE_URL=http://127.0.0.1:3060/api/v1
# Browser-side direct calls (documents, share page /s, price import, enquiry form).
NEXT_PUBLIC_API_BASE=https://api-smartquote.martechsky.com/api/v1

# Public origins: CORS allow-list, CSRF checks, links in emails.
CLIENT_ORIGIN=https://app-smartquote.martechsky.com
ADMIN_ORIGIN=https://admin-smartquote.martechsky.com
SITE_ORIGIN=https://quote-smartquote.martechsky.com

# Guest page → intro site (logo + Home/Projects/Contact). Build-time.
NEXT_PUBLIC_BRAND_SITE_URL=https://smartquote.martechsky.com

DATABASE_URL=postgres://smartquote:<APP_DB_PW>@127.0.0.1:5432/smartquote
SESSION_SECRET=<openssl rand -hex 32>
TRUST_PROXY=loopback          # Caddy runs on this host and connects from 127.0.0.1
VENDOR_DASHBOARD_PASSWORD=<openssl rand -base64 18>
CHROME_PATH=<path from step 3>
PRICE_BOOKS=./data/price-books
PDF_CACHE=./data/pdf-cache
```

Carry over from the developer's local `.env` **only if the human asks** (they are real credentials):
`SMTP_*`, `MAIL_FROM`, `ENQUIRY_TO`, `GUEST_NOTIFY_TO`, `GOOGLE_PLACES_API_KEY` + `GUEST_PLACES_ENABLED`,
`SHEDSAFE_*`, `AI_*`, `VILAO_*`. Without SMTP the Guest page still saves requests (admin → Guest requests)
but sends no email to the admin or the customer — say so in the hand-off. If Places is enabled, `GUEST_PLACES_SESSION_SECRET` (≥ 32 random chars) is
**required in production**, and the Google key's HTTP-referrer restriction must include
`https://quote-smartquote.martechsky.com/*`. See the app's `docs/OPERATIONS.md` §8.

`DB_DRIVER` is not needed: Postgres is the only driver (any other value is refused at start).
Never set `TRUST_PROXY=true` (refused in production).

Guest accounts need **no extra variables**: the `sq_guest` cookie is set through the site's same-origin
bridge, is `HttpOnly` (and `Secure` behind HTTPS), and only a hash of its token is stored. Migration
`024_guest_accounts.sql` is applied by `pnpm db:migrate` in §6.2.

### 6.2 Build

The Next apps read env from the process, not from the root `.env`, so export it for the build.
All `NEXT_PUBLIC_*` values are baked in at build time.

```bash
cd /opt/smartquote-app
sudo -u smartquote pnpm install --frozen-lockfile
sudo -u smartquote bash -c 'set -a; . ./.env; set +a; pnpm db:migrate && pnpm build'
```

If `pnpm install` refuses a dependency build script, don't override it — report the message to the human
(the workspace only allows esbuild's). All run-time variables above are already in `turbo.json`
`globalPassThroughEnv`; add any new one there or it reaches the build as unset.

### 6.3 Data

- **Copy local** (recommended): on Windows `pg_dump -Fc -U smartquote -h localhost smartquote > smartquote.dump`,
  `scp` it, then `pg_restore --no-owner --role=smartquote -d smartquote smartquote.dump`, then `pnpm db:migrate`.
  The price-book bytes are stored in Postgres too (app `docs/OPERATIONS.md` §1), so the restore is complete.
  The dump also carries any Guest accounts, drafts and sessions from the developer's machine. Ask the human
  first: for a client test prefer a dump without test sign-ups, or delete them afterwards
  (`docs/OPERATIONS.md`, "Guest accounts").
- **Fresh**: with `.env` exported, set `COMPANY_NAME`, `COMPANY_CODE`, `COMPANY_SLUG`, `COMPANY_ADMIN_USERNAME`,
  `COMPANY_ADMIN_EMAIL`, `COMPANY_ADMIN_PASSWORD`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`
  (ask the human for names; generate the passwords), then
  `pnpm install:company -- --if-empty` and `pnpm publish-book -- --if-empty`.

### 6.4 systemd units (four)

Same shape for each; only the name, working directory and start command differ:

```ini
# /etc/systemd/system/smartquote-api.service
[Unit]
Description=SmartQuote API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=smartquote
Group=smartquote
WorkingDirectory=/opt/smartquote-app/apps/api
EnvironmentFile=/opt/smartquote-app/.env
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

| Unit | `WorkingDirectory` | `After=` add |
|---|---|---|
| `smartquote-api` | `/opt/smartquote-app/apps/api` | `postgresql.service` |
| `smartquote-site` | `/opt/smartquote-app/apps/site` | `smartquote-api.service` |
| `smartquote-client` | `/opt/smartquote-app/apps/client` | `smartquote-api.service` |
| `smartquote-admin` | `/opt/smartquote-app/apps/admin` | `smartquote-api.service` |

Each app's `pnpm start` picks its port from `API_PORT` / `SITE_PORT` / `CLIENT_PORT` / `ADMIN_PORT`
(`scripts/next-port.mjs`). Use the real `pnpm` path (`command -v pnpm`).
`sudo systemctl daemon-reload && sudo systemctl enable --now smartquote-{api,site,client,admin}`.

Check: `curl -s localhost:3060/api/v1/health/ready` → 200, then `curl -sI localhost:306{1,2,3}` → 200/307.

## 7. Caddy (`/etc/caddy/Caddyfile`)

```caddy
smartquote.martechsky.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3065
}
quote-smartquote.martechsky.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3063
}
app-smartquote.martechsky.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3061
}
admin-smartquote.martechsky.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3062
}
api-smartquote.martechsky.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3060
}
```

`sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`. Caddy adds
`X-Forwarded-For` itself, and with `TRUST_PROXY=loopback` the API sees each visitor's real IP, so rate
limits work per visitor.

Optional (ask the human): restrict `admin-smartquote.martechsky.com` and the intro's `/admin*` path to the
office IP with a Caddy `@blocked not remote_ip <ip>` matcher → `respond 403`.

## 8. Verification (all must pass before handing to the client)

```bash
for h in smartquote quote-smartquote app-smartquote admin-smartquote api-smartquote; do
  curl -s -o /dev/null -w "$h %{http_code}\n" https://$h.martechsky.com/; done
curl -s https://api-smartquote.martechsky.com/api/v1/health/ready                     # 200
curl -sI "https://smartquote.martechsky.com/quote?utm_source=test" | grep -i location   # → quote-smartquote…/quote?step=start&utm_source=test&src=intro
curl -s https://smartquote.martechsky.com/ | grep -o 'href="https://quote-smartquote[^"]*"' | sort -u
curl -s "https://quote-smartquote.martechsky.com/quote?step=start" | grep -o 'href="https://smartquote.martechsky.com[^"]*"' | sort -u
curl -s https://smartquote.martechsky.com/sitemap.xml | grep -c smartquote.martechsky.com   # > 0, no localhost
```

Then in a browser:
1. Intro home → "Request a Quote" → guest page opens. Guest logo → back to intro home.
2. Walk the guest flow to the end and send a request. The page confirms it, and the API log shows the
   `POST /api/v1/public/guest-requests` with no error or CORS refusal (`journalctl -u smartquote-api -n 100`).
3. `https://smartquote.martechsky.com/admin` → Payload sign-in works. `/contact` form → row in Inquiries.
4. `app-smartquote` sign-in with the company admin works; open a quote and download its PDF (checks `CHROME_PATH`).
5. `admin-smartquote` sign-in with the platform admin works.
6. Guest account (on `quote-smartquote`; use a throwaway address the human gives you, never a customer's):
   create an account, reload — still signed in; start a design, leave, find it under `/quote/account` →
   drafts; send a request while signed in — it shows under sent requests and the draft is gone; sign out and
   sign in again. In devtools the `sq_guest` cookie must be `HttpOnly` and `Secure`. Then confirm an
   anonymous request (private window, no sign-in) still goes through.
7. No page anywhere links to `localhost`: `curl -s <each host> | grep -c localhost` → 0.

## 9. Hand-off to the human

Report: the five URLs, which data option was used, where each `.env` lives, which credentials were
generated (the location, not the values), anything skipped (mail, Places, ShedSafe, AI), and the result of
every check in §8 (including the guest-account walk-through), and whether Guest-page emails are on or off.

Redeploy later: re-ship the tarball, then rebuild with the same §5.3 / §6.2 commands and
`sudo systemctl restart smartquote-intro` / `smartquote-{api,site,client,admin}`.

## 10. Known open item (not part of this deploy)

`https://quote-smartquote.martechsky.com/` (the app site's root) still shows the app's own older
"Sheds, quoted" landing page with an enquiry form. Visitors normally arrive at `/quote`, so this doesn't
block testing. A redirect of `/` → `/quote` or → the intro site is a pending decision for the human.
