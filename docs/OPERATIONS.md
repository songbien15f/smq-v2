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
| **Published price books** | `$PRICE_BOOKS` (default `./data/price-books`) | Content-addressed and immutable: one `.db` file per publication plus `active.json`. A revision records the book's hash, so restoring a DB without the books leaves every document unable to render its own price, and `documents.ts` refuses rather than printing a different one. |
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

## 6. Turning analytics off

`usage_events` is the only table that grows on every page view. It is safe to prune old rows:

```sql
DELETE FROM usage_events WHERE at < now() - interval '365 days';
```

Nothing else reads them for a quote; the Activity screen is a 7/30/90-day window.
