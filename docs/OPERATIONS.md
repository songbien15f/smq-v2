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

## 8. The Guest page's address search (Google Places)

The public Guest page (`apps/site` `/quote`) can suggest real addresses as a guest types. It is a page anyone on the internet can open, so every call it makes is Google money spent on behalf of a stranger. The API holds the key; the browser never sees it. The application caps itself (below), but the caps that cannot be bypassed by a bug are the ones in Google Cloud — set both.

### Turning it on

In the API's environment (`.env` locally):

| Variable | Value |
|---|---|
| `GUEST_PLACES_ENABLED` | `1` (on). `0` or unset = off: the page offers the price book's suburb list instead. |
| `GOOGLE_PLACES_API_KEY` | The server key. The same key the editor's own address field uses. |
| `GUEST_PLACES_SESSION_SECRET` | 32+ random characters. **Required in production** when the switch is on; in development a random one is made at each start (sessions then end at a restart, which is harmless). |
| `GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP` / `_DETAILS_CAP` | System-wide calls per UTC day (defaults 2000 / 300). Past either, the page falls back to the suburb list and one warning mail a day goes to `GUEST_NOTIFY_TO` (or the enquiry recipients). |

Restart the API, then check it against Google once:

```bash
node scripts/probe-guest-places.mjs
```

It sends one session, three autocomplete requests and one details request through the API, prints what came back and the call count, and never prints the key. It spends real calls — run it by hand, never in a loop or in CI. The E2E suite does **not** call Google: `e2e/guestQuote.spec.ts` stubs the page's Places routes in the browser to exercise the suburb fallback.

### Restricting the key (Google Cloud console → APIs & Services → Credentials)

- **API restriction:** allow only **Places API (New)** — the API calls `places.googleapis.com/v1/places:autocomplete` and `/v1/places/{id}`. A key that can call every Maps API is a key that can be spent on every Maps API.
- **Application restriction: IP addresses**, set to the server's outbound address. The calls come from the API process, not from the browser, so an **HTTP referrer** restriction does not apply to this key and would make every call fail. If a browser-side Maps key is ever added, it is a separate key restricted by referrer to the site's domain.

### Quota and budget (the limits that hold even if the app's caps fail)

- **Daily quota:** APIs & Services → Places API (New) → Quotas. Set the per-day request quota a little above the app's two daily caps combined (with the defaults, about 2,500). Google then refuses past it; the page sees an upstream failure and offers the suburb list.
- **Budget alert:** Billing → Budgets & alerts → a monthly budget on the project with alerts at 50 %, 90 % and 100 %, sent to someone who reads mail. An alert does not stop spending — the quota does — but it says something is wrong before the invoice does.

### The application's own limits

Per guest IP (hashed) and per session, from `GUEST_PLACES_LIMITS` in `apps/api/src/lib/guestPlaces.ts`: 10 sessions an hour; 60 autocomplete an hour and 200 a day; 12 autocomplete and 1 details per three-minute session; 20 details a day. Sending a request is limited to 5 an hour per IP and 3 a day per email address (`apps/api/src/routes/guest.ts`). A guest past a limit sees "That is a lot of requests from one place…" and the page keeps working with the suburb list.

### The Guest page's building types (admin, `/guest-types`)

The cards on `/quote` ① are a **platform catalogue**, not a company one: one list for every visitor.
They live in `guest_building_types` and are edited in the admin app at `/guest-types`
(`docs/plans/admin-guest-building-types.md`).

**The first save copies the six code defaults into the database.** While the table is empty the API
answers `GUEST_DEFAULT_TYPES` from `@sq/core`; the moment any row exists the database is the only
source. The seeding exists so that editing one type does not make the other five vanish.

| What the operator can do | Where |
|---|---|
| Switch a type off / on | The row's button. The Guest page stops offering it immediately. |
| Reorder | The ↑ / ↓ buttons, written as one transaction (`10, 20, 30…`). |
| Edit a type | The name link: six sections — general · roof · limits · starting design · doors · colours. |
| Add a type | "Add a type", starting from the Garage's configuration. |

**Nothing is ever deleted.** A sent request stores `typeId`, and a guest's browser keeps it in
`localStorage`, so a type is switched off instead. The **id cannot change** either: it is in deep links
(`?type=…`), in saved drafts and in leads.

**Limits beyond the price book are allowed.** The form shows an amber note ("Beyond the price book…")
and requests designed outside it carry `review_flags` for the estimator. Nothing blocks the save.

**If a type is switched off while a guest has a draft of it**, their draft is cleared on the next visit
and ① says so in one line. The address goes with it, because the address is stored inside the design.

**Restoring a type that was switched off:** open it and press "Switch on". There is no undo and no
delete, so nothing else is needed. **Restoring the six defaults after editing them** means editing them
back — the code defaults are not a button, deliberately: a "reset to code defaults" would silently
discard an operator's own limits.

### Guest requests (admin, `/guest-requests`)

Every request sent from the Guest page is stored in `guest_requests` whether or not the notification
mail went out, and **Customers › Guest requests** is where it is read (capability
`platform:enquiries`, the same as Enquiries). The list opens on **New**; a request's own page shows
the contact, the design, the additional request, the server's estimate and "check" flags (internal —
the guest's email never carries them) and the assistant conversation, if any.

On that page a request can be **declined** (with an optional reason, kept on the row), **marked as
spam**, or **put back to new**. Each change is an audit event (`guest_request.status`). Nothing is
deleted. `transferred` cannot be set here: it belongs to handing the request to a company, which is
not built yet.

### Guest accounts (optional sign-in on the Guest page)

A guest may create an account (email + password) or keep sending requests anonymously — both
work, and nothing on the page requires the account (DECISIONS D4). Three tables hold it:
`guest_accounts` (one per normalised email, password as a scrypt hash), `guest_account_sessions`
(only a hash of the `sq_guest` token; 90 days, extended on use) and `guest_drafts` (unfinished
designs, at most 20 per account, no contact details). A request sent while signed in carries
`guest_requests.account_id`; anonymous requests keep it NULL.

Limits, counted in `rate_limits` like the rest: sign-in 10 per 15 minutes per address and per
email, sign-up 5 per hour per address, draft saves 120 per 10 minutes per account.

Expired sessions are refused when read but not deleted. Remove them at any time:

```sql
DELETE FROM guest_account_sessions WHERE expires_at < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
```

There is no password reset by mail yet: a guest who forgets the password creates a new account
under another email, or the operator deletes the account. Its sessions and drafts go with the row
(`ON DELETE CASCADE`); its sent requests do not, so detach them first or the delete is refused:

```sql
UPDATE guest_requests SET account_id = NULL WHERE account_id = '<account id>';
DELETE FROM guest_accounts WHERE id = '<account id>';
```

### The Guest assistant (optional, off by default)

The Guest page can offer a "Shed Assistant": a chat box that turns a sentence ("6 by 9 garage with two
roller doors") into design operations. It costs money per message, so it is **off unless two things
are true**: `GUEST_ASSISTANT_ENABLED=1` **and** at least one provider key is set (`GEMINI_API_KEY` or
`VILAO_API_KEY`). With either missing, the route answers 503 `not_configured` and the page shows "the
assistant is unavailable — the designer still works".

**Two providers, one primary and one fallback.** Since 2026-11-27 the assistant can be answered by
Google Gemini directly or by the vilao gateway. The **router** (`apps/api/src/lib/ai/index.ts`) sends
each job to the primary; if that fails in a way worth retrying and the fallback is enabled with enough
of the job's deadline left, the fallback answers the same job. A safety block is never retried, and a
400 does not fall back late in a short deadline. Three jobs use it: the design turn (25 s total), the
transcript repair (8 s) and speech to text (25 s). The provider that answered appears in one log line
per call:

```
[ai] job=turn provider=gemini status=ok fallbackFired=false latencyMs=1180 inputTokens=3120 outputTokens=240
```

**Where the settings live.** *Which* provider and *which* models is data, in the `ai_settings` table
(migration 025), edited on the vendor's **AI assistant** screen (`apps/admin`, `/ai`, capability
`platform:ai`; each change is audited as `ai_settings.update`). **The keys are not data.** They live in
`.env` only and never reach the database or the screen, which shows "key set: yes/no" as two booleans.
Migration 008 dropped `platform_settings` for exactly this reason: a key in a table is a key in every
backup.

**Rotating a key means editing `.env` and restarting the API.** There is no reload path on purpose; a
half-applied key is worse than a slow rotation. A key revoked in Google Cloud but left in `.env` turns
every Gemini call into a 403, and the log line above is where that shows.

| Setting | Meaning |
|---|---|
| `GUEST_ASSISTANT_ENABLED` | `1` to offer the assistant. Anything else is off. |
| `AI_PRIMARY` | `gemini` (default) or `vilao`. The admin screen overrides it. |
| `AI_FALLBACK` | `vilao` (default), `gemini` or `none`. The admin screen overrides it. |
| `GEMINI_API_KEY` | Google AI Studio key. **A server secret**: `.env` only. It must be an authorization key or a restricted standard key — an unrestricted standard key is refused with 403. |
| `GEMINI_MODEL` | Defaults to `gemini-3.5-flash-lite`. The admin screen overrides it. |
| `GEMINI_STT_MODEL` | Speech-to-text model. Empty means "use `GEMINI_MODEL`". |
| `GEMINI_BASE_URL` | Defaults to `https://generativelanguage.googleapis.com/v1beta`. |
| `GEMINI_THINKING_LEVEL` | `minimal` (default), `low`, `medium`, `high`. Thinking tokens are billed as output. |
| `VILAO_BASE_URL` | OpenAI-compatible gateway. Defaults to `https://api.vilao.ai/v1`. |
| `VILAO_API_KEY` | The key. **A server secret**: it stays in `.env`, never `NEXT_PUBLIC_*`, never in a commit. |
| `VILAO_MODEL` | Chat model. Defaults to `wiki`. |
| `VILAO_STT_MODEL` | Speech-to-text model, used by the composer's microphone. Defaults to `mgr/grok-stt`. |
| `GUEST_ASSISTANT_VOICE` | `1` to offer the microphone in the composer. **Separate from the chat switch**, because each recording is its own paid call. Defaults to off. |
| `GUEST_ASSISTANT_DAILY_TURNS` | Platform-wide ceiling per UTC day. Defaults to 200. |
| `GUEST_ASSISTANT_DAILY_VOICE` | Platform-wide ceiling on transcriptions per UTC day. Defaults to 300. |
| `NEXT_PUBLIC_SQ_ASSISTANT` | `1` renders the panel for everyone. `?assistant=1` turns it on for one visit. |

**Rate limits and spend (Gemini).** Limits are per **project**, not per key: RPM, TPM and RPD, with RPD
resetting at midnight Pacific. The model's own numbers are not in the public docs — read them on the
AI Studio rate-limit page (`https://aistudio.google.com/rate-limit`) with the project's sign-in. Spend is
capped on a rolling 10 minutes: **Tier 1 allows $10 per 10 minutes with a $250 billing cap** (Tier 2:
$200 / $2,000). Breaking any limit answers 429 `RESOURCE_EXHAUSTED`, which the router retries once and
then hands to the fallback. At the published price of $0.30 per million input tokens and $2.50 per
million output, a typical turn (3–6k in, 300–800 out) is about $0.001–0.004 and a 60 s voice note is
about $0.0006, so the spend cap is not the limit that bites first — the daily turn ceiling is.

**What a turn costs and who stops it.** One model call per provider tried, and occasionally two: when
the reply is valid JSON whose operation names do not exist, the server re-asks once with the exact shape
and keeps the reply that lost fewer operations. Gemini is asked for a schema-constrained reply, so on the
primary that second call is rare; on vilao it is the normal repair path. Three counters are consumed
*before* the call: 60 a day per IP, 40 per conversation, and the daily ceiling above — they count
turns, not calls, so a fallback is not billed to the guest twice. A refusal answers "unavailable" and
the designer keeps working.

**The microphone (speech to text).** Switched on separately with `GUEST_ASSISTANT_VOICE=1`; without it
the composer simply has no mic. The mic **dictates into the composer** (`VoiceComposer.tsx`, 2026-11-27):
tap to start and tap ⏹ or pause two seconds to finish, or hold it (≥ 300 ms) to talk and release to
finish (quiet does not end a hold). While the guest speaks, the browser's own recogniser (Web Speech,
`useLiveSpeech.ts`, free, skipped on iOS) shows the words greyed; when the take ends the recording goes
to the server for speech to text and the repair pass, and that text is **added** to the box. Speaking
again adds more. If the server cannot answer, the browser's words are added instead. Nothing reaches the
chat until the guest presses **Send** — a misheard "nine" cannot become a design change behind their
back. A recording is capped at 60 s and 1 MB, and the audio is **never stored or logged** — only its
length and mime type appear in a failure line. Hiding the panel, hiding the tab or unmounting ends the
take and stops the microphone stream. Its counters are its own — 60 a day per IP, 40 per
conversation, and `GUEST_ASSISTANT_DAILY_VOICE` for the platform — consumed before the model call.
Over the IP or conversation limit answers 429; over the daily budget answers `unavailable` and the page
retires the mic for that visit.

**The vilao STT model does not take a vocabulary prompt (measured 2026-11-22).** `mgr/grok-stt` answers
`400 BAD_REQUEST` to the OpenAI `prompt` field at any length, while `language` and `response_format` are
accepted. The API therefore sends the shed-vocabulary prompt once and, on a 400, retries without it —
remembering the refusal per model for the life of the process, so repeat visitors do not pay for the
same rejection. Gemini takes an instruction and a hint, so the vocabulary goes in the prompt there and
no refusal is expected. Accuracy is otherwise the recogniser's own; the word-level fixes in
`lib/guestVoice.ts` ("role a door" → "roller door") and the topic check still apply. Re-check with
`node scripts/probe-stt.mjs <clip.webm>` (vilao) or `node scripts/probe-gemini.mjs --file <clip.webm>`
(Gemini) if the STT model changes.

**What the model never sees.** The contact details (name, email, mobile, street address) are not in
the request — the route's schema has no field for them. The sentence itself is redacted first: email
addresses, Australian mobiles and street addresses become `[email]`, `[mobile]`, `[address]` before
the prompt is built.

**What it cannot do.** Only design operations, and each is re-checked against the building type on
the server (`applyGuestOps`). A suggestion outside the book — a 40 m span, a 9 m bay, a colour the
type does not offer — is refused and the guest is told why. It has no tool that sends a request,
touches the database or quotes a price. The sentence shown is corrected to what really happened: if
nothing was applied it says so instead of "Done", and a partial change says "please check the plan".

**What it will not talk about.** Its scope is what the guest can edit on the page (size, roof, slab,
knee brace, cladding, colours, doors and windows) and the Design-check items on screen. It is given
only the type's limits, the design's numbers and those findings — never a BOM, a price or the price
book. Asked about parts, steel sections, footings, calculations or its own instructions, it answers
with one sentence pointing to the "Additional Request" box. `guardMessage` enforces this without
relying on the model: a reply mentioning money becomes the pricing sentence, and one mentioning
internals (parts list, BOM, purlins, girts, C/Z sections, price book, its prompt) becomes the scope
sentence. Either replacement is logged as `assistant reply mentioned money or internals`.

**The conversation travels with the lead.** When a request is sent, the whole conversation is
**copied** onto the lead (`guest_requests.assistant_transcript_json`) and the notification mail to the
estimator quotes its last ten turns. The lead keeps its copy; `assistant_session_id` is only a trace of
where it came from.

**Cleaning up.** Sessions expire 30 days after the last visit:

```bash
pnpm assistant:prune
```

Run it daily, like `pnpm ratelimits:prune`. It deletes expired sessions (their turns cascade), and
first nulls `guest_requests.assistant_session_id` for any lead pointing at one — **the lead's own
transcript is untouched**, which is why deleting a session a lead came from is safe. Before migration
023 the transcript only lived in the session, and this script would have destroyed it; that is what the
copy exists to prevent.

### The wind region the page shows (estimated, not certified)

When a guest picks an address from Google's suggestions, the page shows *"Region B · 10a Enclosed ·
Importance Level 2 — Indicative — confirmed in your quote"*. Three properties matter to whoever runs
this:

- **It is an estimate.** The letters come from a simplified copy of Geoscience Australia's *1170.2
  Wind Regions for Australia* dataset (`packages/core/src/domain/windRegionData.ts`, 77 rings). GA's
  own record says the dataset is *"not suitable for design purposes"* and *"has not been formally
  endorsed by Standards Australia"*, and it carries **no stated licence** — see
  `docs/KNOWN-DEVIATIONS.md` row 57, which is an **open decision for the operator**.
- **It refuses to answer near a boundary.** Within about 9 km of a boundary between two regions the
  answer is `null` and the page says "Wind region confirmed in your quote". That is deliberate: the
  simplified table moves a boundary by up to 5.5 km, and answering the wrong side under-states a
  cyclonic site's frame.
- **No wind speed is printed.** The Standard's Table 3.1 could not be sourced, so
  `GuestSiteEstimate.windSpeedMs` is deliberately left unset
  (`docs/research/wind-regions-as1170-2.md` §4).

The server **recomputes** the region when the request is sent — it calls Place Details again with
the stored `place_id` and stores its own answer in `guest_requests.site_estimate_json`. A browser
that sends a different region cannot change the record. If Google is unavailable at that moment, the
estimate is `null` and the request is still stored; the log line is
`guest wind region: the address could not be resolved`.

Rebuilding the table from the source shapefile is described in the header of
`windRegionData.ts`; the two downloaded files (`ga_windregions.zip`, `ga_windspec.pdf`) are
gitignored at the repo root.


### Cleaning `rate_limits`

All of these counters live in one table, `rate_limits(key, count, window_end)`, keyed `gplaces:…`, `guest-request:…` and `guest-suburbs:…`. An expired row is overwritten the next time its key is used and never deleted, so one-off keys (a session id, a day's counter) stay. Remove the expired ones at any time, including while the API runs:

```bash
pnpm ratelimits:prune
```

A sensible schedule is once a day. To lift a limit on purpose before its window ends (for example after a test run from the office), delete that one key — never truncate the table, which would also reset the system-wide daily caps:

```sql
SELECT key, count, window_end FROM rate_limits WHERE key LIKE 'guest-request:ip:%';
DELETE FROM rate_limits WHERE key = '<the key>';
```
