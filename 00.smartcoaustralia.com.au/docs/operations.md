# Operations guide

Day-to-day running of the Smart Solutions Australia website: where content
lives, how publishing works, what to do with inquiries, and the procedures for
backups and email. Setup and deployment commands are in the
[README](../README.md).

---

## 1. Signing in

| | |
|---|---|
| Admin URL | `/admin` (e.g. `http://localhost:3065/admin`) |
| Credentials | `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` for the seeded first user |

Two roles exist:

- **admin** — everything, including the `users` collection.
- **editor** — everything except managing users.

Create one account per person rather than sharing the seeded login, so the
inquiry status changes and content edits can be traced. Admin users are managed
under `/admin/collections/users`.

---

## 2. Where content is edited

The admin sidebar opens with a **Website pages** tree (one node per page), then
**Site chrome**, then Payload's own grouped lists.

### Page content (globals)

Each public page has its own form. Edit it, click **Save**, and reload the public
page — the site revalidates on save, so no rebuild or redeploy is needed.

| Public page | Admin form |
|---|---|
| `/` | `Website pages → Home` |
| `/capabilities` | `Website pages → Capabilities` |
| `/process` | `Website pages → Process` |
| `/quality` | `Website pages → Quality` |
| `/projects` | `Website pages → Projects` |
| `/products` | `Website pages → Products` |
| `/team` | `Website pages → Team` |
| `/quote` | none — redirects to the SmartQuote app (`QUOTE_APP_URL`, see below) |
| `/contact` | `Website pages → Contact` |
| `/privacy` | `Website pages → Privacy` |

Every page form also carries a **Meta** group (`title`, `description`) used for
the browser tab, search results, OpenGraph and Twitter cards. Leaving it blank
falls back to built-in copy.

### Entries (collections)

Nested under the page they appear on:

| Collection | Appears on | Notes |
|---|---|---|
| `Projects` | `/projects`, `/projects/<slug>`, home featured block | Drafts + autosave; only one **Featured** project at a time (enabling a new one silently clears the old). |
| `Product groups` | `/products` | Drafts + autosave. |
| `Team members` | `/team` | Drafts + autosave. |
| `Offices` | `/contact` (address cards + maps) | Order controls display order. |
| `Media` | Everywhere images are used | Alt text is **required**. |

### Site chrome (globals)

| Form | Controls |
|---|---|
| `Site Settings` | Site name, logo, contact email, phone numbers (AU / VN / WA) |
| `Header` | The eight navigation labels and the CTA button label/link |
| `Footer` | Company description, compliance links, copyright line |

The header and footer therefore change in one place and appear on every page.

### Images

Upload through `Media` (`/admin/collections/media`). Payload generates three
sizes (`thumbnail` 400px, `card` 800px, `hero` 1920px) automatically and writes
them to `media/`.

Practical limits for a fast site: hero images 1920px wide or smaller, JPEG for
photos, PNG only for logos with transparency. Always write alt text that
describes the image for a screen-reader user — the field is enforced.

---

## 3. Draft and publish flow

Drafts apply to **Projects**, **Product groups** and **Team members**. Page
globals (Home, Capabilities, …) have version history but no draft/published
switch — **Save** on a page global is immediately live.

For a collection entry:

1. **Create or edit** the document. Autosave stores a draft about every
   375 ms; a "Draft" badge shows while the document is unpublished.
2. Review it while logged in — an authenticated preview shows the draft; the
   public site does not.
3. **Publish** when it is ready. Only published documents are visible to the
   public, listed in the sitemap, and returned by the API to anonymous visitors.
4. To take something down, unpublish it (or revert to an earlier version from
   the **Versions** panel). Unpublishing removes it from the public site at
   once; the record stays in the admin.

Only one project can be **Featured** on the home page. Ticking Featured on a new
project clears it on the previous one; drafts do not affect the currently
featured published project.

If an edit does not appear on the public site, hard-reload (`Ctrl+F5` / `Cmd+Shift+R`)
and confirm the document was published rather than saved as a draft.

---

## 4. Inquiry inbox

Every contact message (`/contact`) is stored in the `Inquiries` collection
**before** any email is attempted. The inbox is at `/admin/collections/inquiries`
(sidebar: `Contact → Inquiries`). Older rows may be quote requests from the
retired on-site quote form.

### Quote requests go to the SmartQuote app

Quotes are no longer taken on this site. Every link whose href is `/quote` (the
header CTA, page buttons, inline links) is rendered as the SmartQuote guest flow
URL from `QUOTE_APP_URL` (default `http://localhost:3063/quote?step=start`), with
`src=intro` added. Visiting `/quote` directly answers a 307 redirect to the same
URL and forwards its query (UTM tags). Set `QUOTE_APP_URL` in `.env` to the
production app address and restart; no rebuild is needed. Editors keep typing
`/quote` in link fields. The old `Quote Page` global is hidden in the admin but
its data is kept.

Each inquiry carries:

- **Type** — quote request or contact message.
- **Status** — `new` → `read` → `replied` → `archived`.
- Contact details, plus the quote-specific fields (project type, tonnage, site
  location) or contact-specific fields (office, enquiry type).
- **Source path** — the page the form was submitted from.
- **Consent** and a client-generated `submissionId` (a unique key that makes a
  double-click or a retried request resolve to one row, not two).

Working the inbox:

1. Filter by **Status: new** and by **Type** at the top of the list.
2. Open a record, reply from your normal email client (`reply-to` is set when the
   notification email is enabled), then set the status to `replied`.
3. Archive handled records rather than deleting them — they are the record of
   what the business was asked.

Abuse: the forms include a hidden honeypot field, a minimum fill time and a rate
limit; obvious spam still reaching the inbox is best archived, not deleted, so
patterns stay visible.

---

## 5. Backup schedule

`npm run backup` creates `backups/<ISO timestamp>/` containing
`smartcoa.dump` (whole database, custom format) and `media/` (all uploads). It
prunes folders older than 14 days on every successful run, and exits non-zero if
`pg_dump` fails so a scheduler can alert.

Recommended cadence:

- **Daily** database + media backup, retained 14 days locally by the script.
- **Weekly** copy of that directory to off-machine storage (object storage, NAS
  or a second server), retained longer. The 14-day window covers mistakes, not
  disk or host failure.
- **Before every deploy that includes a migration**, take one manual backup.

Linux (cron, 02:00 daily):

```cron
0 2 * * * cd /opt/smart-solutions && /usr/bin/npm run backup >> /var/log/smart-solutions-backup.log 2>&1
```

Windows (Task Scheduler → Create Basic Task → Daily, 02:00):

```
Program:   cmd.exe
Arguments: /c cd /d "D:\path\to\project" && npm run backup >> backups\backup.log 2>&1
```

Restore procedure: see README §6. Restore into a scratch database first when
you are not certain the dump is good:

```bash
createdb -U postgres smartcoa_restore_check
pg_restore --dbname postgresql://postgres:123456@127.0.0.1:5432/smartcoa_restore_check backups/<timestamp>/smartcoa.dump
dropdb -U postgres smartcoa_restore_check
```

Verify a backup is not truncated:

```bash
pg_restore --list backups/<timestamp>/smartcoa.dump | grep -c "TABLE DATA"   # expect 83
```

---

## 6. Enabling email notifications

Out of the box `MAIL_ENABLED=false`: inquiries are stored in the database and the
API still returns success, but no notification email is sent. Nothing breaks.

Checklist to turn real notifications on:

1. Obtain SMTP credentials (host, port, username, password) from the mailbox
   provider. A dedicated sending address such as
   `no-reply@smartsolutionsaustralia.com.au` is recommended.
2. Add the sending domain to the provider's SPF/DKIM/DMARC records so mail is not
   filtered as spam. This is a DNS change and needs the domain administrator.
3. Fill in `.env`:

   ```dotenv
   MAIL_ENABLED=true
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=no-reply@smartsolutionsaustralia.com.au
   SMTP_PASS=the-smtp-password
   MAIL_FROM="Smart Solutions Australia <no-reply@smartsolutionsaustralia.com.au>"
   MAIL_TO_QUOTE=info@smartsolutionsaustralia.com.au
   MAIL_TO_CONTACT=info@smartsolutionsaustralia.com.au
   ```

   Port `465` is treated as implicit TLS; `587` uses STARTTLS. Authentication is
   skipped when `SMTP_USER` is empty.
4. Restart the app (`docker compose up -d` or `sudo systemctl restart
   smart-solutions`). Environment files are read at process start.
5. Submit a real test through `/contact`. Confirm:
   - the inquiry appears in `/admin/collections/inquiries`, **and**
   - the notification arrives at the `MAIL_TO_*` address,
   - replying to that email goes to the enquirer (`reply-to` is their address).
6. If the email does not arrive but the inquiry is stored, the failure is SMTP
   side (credentials, port, DNS, spam filter). The server log warns once:
   `[email] mail disabled: …` when mail is off, and
   `[email] sending the inquiry notification failed: …` when a send fails. A
   mail failure never blocks or fails the form submission.

To turn notifications off again, set `MAIL_ENABLED=false` and restart. The
inbox keeps working either way.

---

## 7. Routine checks

| Frequency | Check |
|---|---|
| Daily | New inquiries triaged; backup job ran (log line `[backup] done`) |
| Weekly | `curl -f <site>/api/health` from outside returns `{"ok":true,"db":"up"}`; disk space on the host and `media/` size |
| Monthly | Restore one recent backup into a scratch database; review admin users |
| Before deploy | Manual `npm run backup`; run `npm run migrate` as part of the deploy |
| After content changes | Spot-check the changed page on desktop and mobile |

Health endpoint meaning: `{"ok":true,"db":"up"}` is a live read against the
database. `503` with `{"ok":false,"db":"down"}` means the app is up but cannot
reach PostgreSQL — check the database service and `DATABASE_URI` before
restarting the app, since a restart will not fix a database outage.
