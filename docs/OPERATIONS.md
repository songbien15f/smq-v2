# Operations — backup, restore, and what lives outside the database

This replaces the desktop's Administration screen, which listed its SQLite tables with row counts and
had backup / restore buttons. On a server the database is Postgres, the backup tool is `pg_dump`, and a
restore is a deliberate act taken with the application stopped — not a button inside the application
that can empty every quote with a stray click. See `KNOWN-DEVIATIONS.md` row 28.

**What the old screen was really for** was *get me a copy I can keep*, and that is what this page is.

---

## 1. What to back up

Three things. A backup that takes only the first is a backup that cannot restore a working system.

| What | Where | Why it cannot be reconstructed |
|---|---|---|
| **The database** | `$DATABASE_URL` | Every quote, revision, customer, membership and settings version. |
| **Published price books** | `$PRICE_BOOKS` (default `./data/price-books`) **and** the `price_book_files` table | Content-addressed and immutable: one `.db` file per publication plus `active.json`. Since DECISIONS D2 the **bytes are also stored in Postgres**, and the file is a cache: a `pg_dump` restore puts them back on disk on demand. Keeping the directory in the backup is still worth it — it avoids re-materialising 3 MB per book on first use — but a backup without it now restores a working system. |
| **Template and logo files** | `$TEMPLATE_FILES` (default `./data/template-files`), `$LOGO_FILE`, `$PDF_CACHE` | A template's `.sqd` **is** the template. A revision stores `logoHash`, so a missing logo prints the text logo — not corrupt, but not what was sent. |

`$PDF_CACHE` is regenerable; back it up only if you care about exact bytes of PDFs already issued.

## 2. Taking a backup

```bash
# 1. The database. Custom format, compressed, one file per day.
pg_dump "$DATABASE_URL" --format=custom --file "backup-$(date +%F).dump"

# 2. The files a restore also needs.
tar czf "files-$(date +%F).tar.gz" \
  -C . data/price-books data/template-files assets/logo.png

# 3. Both, somewhere that is not the server.
```

The `dump` and the `tar` must be taken **within the same window**, ideally with the API stopped. A
price book published between the two is harmless (the DB simply names a hash that exists in the newer
set); a book *deleted* between them is not.

## 3. Restoring

```bash
# Stop the API first: a restore replaces the schema under a live process.
# 1. Into a fresh database — never over the live one until the contents have been checked.
createdb smartquote_restore
pg_restore --dbname smartquote_restore --clean --if-exists "backup-2026-11-07.dump"

# 2. Files back into place.
tar xzf "files-2026-11-07.tar.gz" -C .

# 3. Point DATABASE_URL at smartquote_restore, start the API, and open one known quote.
#    Only then rename it over the old database.
```

Step 3 is the one people skip. A restore that has not been opened is a file, not a system.

## 4. Checking a backup is real

```sql
-- The counts an operator recognises: companies, people, quotes, revisions.
SELECT (SELECT COUNT(*) FROM tenants)          AS companies,
       (SELECT COUNT(*) FROM memberships)      AS people,
       (SELECT COUNT(*) FROM quotes)           AS quotes,
       (SELECT COUNT(*) FROM quote_revisions)  AS revisions;

-- The most recent real work, which should be the day before the backup.
SELECT number, current_revision, updated_at
  FROM quotes ORDER BY updated_at DESC LIMIT 5;
```

A restore whose newest revision is months old is a backup of a system nobody was using — the counts
are only meaningful next to a date.

## 5. Things that are not in the database at all

- **The licensed supplier dump** (`./tools/price-dump/out`) — git-ignored source data. Keep it
  separately; it is what a price book is published from.
- **`.env`** — the message host, the ShedSafe and Google keys, `SESSION_SECRET`. Back it up in a secret
  store, not beside the database. Rotating `SESSION_SECRET` signs everybody out, which is the intended
  behaviour and not a failure.
- **The SMTP password** — same.

## 5a. Reverse proxy, and the client's real address

The API must know the client's address: sign-in, password reset and the enquiry form are rate-limited
**per address**, and an address that is really the proxy's makes one person's mistakes lock out
everybody.

```
browser → reverse proxy (appends the real IP to X-Forwarded-For) → Next app → API
browser → reverse proxy → API                    (the site's enquiry form calls it directly)
```

**Deployment requirement: only the proxy's 80/443 is reachable from the Internet.** Ports 3060–3063 are
internal. If the API is exposed directly, a caller can reach it without a proxy — and although its
`X-Forwarded-For` will then be ignored (see below), the per-address limits would all count the caller's
own address, which is correct but means a hostile caller can rotate addresses if they have many.

`TRUST_PROXY` says which peers may set the header:

| Value | Meaning |
|---|---|
| unset (default) | `loopback` — one machine; the Next bridges are trusted, everybody else is not |
| `loopback,uniquelocal` | Docker or a private network between the proxy and the app |
| `<Cloudflare ranges>` | behind Cloudflare — list its published ranges |
| `false` | no proxy: ignore `X-Forwarded-For` entirely |
| `true` | dev only. **Refused in production**, because it honours the header from any caller |
| a number (`2`) | **refused**: Fastify 5 fails closed on a hop count, so the value would look configured and trust nobody |

The API reads `request.ip` and nothing else (`lib/http.ts` `clientIp`). A header from an untrusted peer
is ignored by Fastify itself, so a spoofed address cannot move a rate-limit bucket.

## 5b. Seats belong to devices

A licence seat belongs to a **device** — one browser profile, for one user, in one company — not to a
session (DECISIONS D3).

- **Signing in again on the same browser reuses the seat.** A session expiring does not cost anybody
  their seat.
- **A second browser is a second seat.** One person on a laptop and a phone holds two.
- **A device nobody has used for `DEVICE_IDLE_DAYS` (default 14) gives its seat back**, at the next
  sign-in in that company. There is no sweeper: the reclaim happens inside the sign-in transaction that
  needs the seat, so the answer is current at the moment it is asked for.
- **A company admin can free a device** at Team → Devices, which is the answer to "nobody can sign in
  and the office is full" without a support call.
- **Company members must sign in once after upgrading to the version that introduced this.** Sessions
  created before it have no device and are refused, deliberately: their seat was held by the session,
  which no longer exists as a concept.

`pnpm seats:release` reclaims dead devices on demand:

```bash
pnpm seats:release                 # every company: revoked or idle past DEVICE_IDLE_DAYS
pnpm seats:release -- --tenant X   # one company
pnpm seats:release -- --all        # blunt: revoke EVERY device and session, clear every seat
```

The default cannot sign out anybody who is using the product.

## 5c. PDF rendering capacity

Every PDF render launches its own Chromium at roughly 200–300 MB of RAM, and scans are cached per
revision so only the first render of each is expensive. `PDF_CONCURRENCY` (default 2) limits how many
run at once; a further request waits in a queue and answers **429** if it waits longer than a minute.

```env
PDF_CONCURRENCY=1   # 2 GB VPS
PDF_CONCURRENCY=2   # 4 GB or more
```

## 5d. Backup now includes the price book

Because the bytes live in `price_book_files` (DECISIONS D2), the single `pg_dump` in section 2 is
enough to restore a working system: the API materialises each book back to `data/price-books` the first
time it is needed, verifying a digest before writing. Keep the directory anyway if you can — it saves a
3 MB write per book on first use — but it is no longer the only copy.

## 6. Turning analytics off

`usage_events` is the only table that grows on every page view. It is safe to prune old rows:

```sql
DELETE FROM usage_events WHERE at < now() - interval '365 days';
```

Nothing else reads them for a quote; the Activity screen is a 7/30/90-day window.

## 7. Before a release: quotes the editor would refuse to re-save

The editor will not save a building that sits outside the active price book. That includes an old quote whose stored building is out of book, even when the only edit is the customer's email. Count those quotes before a release. The count is read-only and safe on the live database:

```bash
pnpm quotes:blocked                       # every company
pnpm quotes:blocked -- --tenant <slug>    # one company
pnpm quotes:blocked -- --list             # name each blocked quote and why
```

It runs the editor's own validator against the current revision of each quote, so the numbers match what a salesperson will see. See `docs/reviews/2026-11-13-quote-editor-overview.md` item 7.
