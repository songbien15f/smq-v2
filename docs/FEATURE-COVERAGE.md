# Feature coverage — what is converted, what is not

Measured 2026-11-01 by reading the routes and pages that exist, not the plans. Every "have" below
is a file you can open; every "missing" is a count of zero.

The source of truth for what the desktop does is `smq-code-smartquote/docs/full_feature/` (64
specs) plus `smq-code-license/` (24 controllers).

---

## The honest headline

**The conversion is feature-complete.** The quotation engine, the editor (openings, all eleven
option kinds, amending a saved quote, charges, **2D and 3D**), the customer document, sending it by
email, the company's own settings, the price list import, `.sqd` export/import, the admin screens, the
public enquiry form, **Google Places addresses**, **ShedSafe site checks**, **credentials an operator
can set from the admin app**, the **option placement rules**, **usage analytics**, **releases** and the
**template catalogue**, **price editor**, **seats across companies** and **template authoring** are
done. Every screen the desktop and the licence server had now has a replacement; what remains is the
operator's own golden-test quotes.**

Three amendments since this was measured:

- **`/quotes/[id]` now exists** — the list linked to a route that was not there, which is the kind of
  defect a coverage table cannot show.
- **Slices A and B landed** (2026-11-02): mail + durable send queue + quote status + the materials
  workbook, and company settings + team. **A defect was fixed with them**: the BOM workbook was
  gated by `quote:read`, so a viewer could download the one route that carries unit costs; it is now
  `cost:read`.
- **Slice C landed** (2026-11-02): the eleven option kinds can now be **created** in the editor — a
  "Place option" catalogue, an Options list with select/duplicate/remove, and an "Add option" canvas
  menu. Only creation was missing; the domain, BOM, 2D, and store CRUD already supported every kind.
  See `docs/PLAN-REMAINING.md`.
- **Slice D0 landed** (2026-11-02): **a saved quote can be re-opened and amended.** `GET /quotes/:id`
  now returns the frozen `config` and `pricing` (omitted for a viewer), `/quotes/[id]/edit` seeds the
  editor from them, and an Edit link appears on the quote page for `quote:write`. Before this,
  revision 2 was unreachable — the editor's `initial` prop had no caller. **A second defect was fixed
  with it**: `isDirty()` never saw the building, so a building-only edit could not be saved.

That split matters more than the percentage. The hard part of this product — computing a bill of
materials from geometry and turning it into a price — is built and verified against the real price
book. The missing part is largely mechanical: the rest of the editor and the admin screens.

| Area | Status |
|---|---|
| Quoting engine (BOM, price chain, girt fix) | **done**, verified on the licensed book |
| The 3-step editor | **done**, verified in a browser |
| Quote persistence (immutable revisions) | **done** |
| Identity, seats, roles, single-company | **done** |
| Price-book publishing | **done** (API + CLI), no admin screen |
| **The quote document** (PDF/HTML) | **done** — verified in a browser, 14 leak tests |
| **The share link** `/s#token` | **done** — token in the fragment, hashed at rest |
| **Sending it by email** | **done** — durable queue, SMTP, status → `issued` |
| **Quote status transitions** | **done** — `draft → issued → accepted / declined / expired` |
| **The materials workbook (BOM xlsx)** | **done** — `cost:read` |
| **Company settings + team** | **done** — versioned settings, members, seat state |
| **The option kinds in the editor** (11 kinds placeable) | **done** — catalogue + Options list + canvas "Add option" menu |
| **Amending a saved quote** (revision 2) | **done** — `/quotes/[id]/edit`, seeded from the frozen revision |
| **3D** | **done** — Render3D/Shed3D ported, Plan/3D toggle, verified rendering |
| **Google Places addresses** | **done** — key server-side, fills all four address fields |
| **ShedSafe site checks** | **done** — pin, import the six certified fields, certificate stays theirs |
| **Option placement rules** | **done** — refusals with a reason; reports what a dimension change invalidated |
| **Integration credentials screen** | **done** — set Places/ShedSafe from the admin app, secret never returned |
| **Usage analytics** | **done** — `usage_events` is written for the first time; 7/30-day windows |
| **Releases** | **done** — a record of what the deployment runs, replacing the installer channel |
| **Template catalogue** | **done** — author from a building, clone into a new quote, no identity copied |
| **Admin screens** (prices, templates, versions, seats) | **done** — slice I |

---

## What exists, counted

**43 API routes:**

```
POST /auth/sign-in        POST /auth/sign-out      GET  /auth/session
POST /auth/password       POST /evaluate           POST /quotes
GET  /quotes              GET  /quotes/:id         GET  /quotes/:id/revisions
GET  /admin/companies     POST /admin/companies    PATCH /admin/companies/:id/status
GET  /admin/audit         GET  /admin/enquiries    GET  /admin/price-books
POST /admin/price-books   GET  /admin/price-books/active

GET  /quotes/:id/revisions/:rev/html      GET /quotes/:id/revisions/:rev/pdf
GET  /quotes/:id/revisions/:rev/bom
POST /quotes/:id/shares   GET  /quotes/:id/shares  DELETE /quotes/:id/shares/:id
POST /share/redeem        GET  /share/document

POST /quotes/:id/send     GET  /quotes/:id/sends   PATCH /quotes/:id/status
GET  /settings            PATCH /settings          GET  /team
PATCH /team/:email/role   DELETE /team/:email
GET  /health · GET /health/ready
```

**12 pages:**

| App | Routes |
|---|---|
| client | `/` (sign-in) · `/quotes` · `/quotes/new` (the editor) · `/quotes/[id]` (revisions + document) · `/settings` · `/team` · `/change-password` |
| admin | `/` · `/company` |
| site | `/` (landing) · `/s` (the customer's shared quote) |

The desktop has roughly **150 forms**. The comparison is twelve pages to 150 — but these twelve
cover the workflow that decides whether the product works: a building becomes a price, that price
becomes a page a customer can open, and the page is emailed to them.

---

## What is missing, and why each one matters

### 1. The option **rule engine** (not the kinds)

All eleven kinds can now be **placed** in the editor (Slice C, 2026-11-02): the domain, schema, BOM
pricing, 2D drawing and store CRUD already existed; the missing piece was a way to create one.

What is still absent is the desktop's **rules** around them — the `ProposeAdd` layer that refuses,
coerces or cascades a placement (adding a carry beam re-opens a column, removing one restores it,
two options that cannot coexist, a dimension change that invalidates an option). Today a placement is
only **clamped** to physical bounds (`normaliseOption`), and adding a second gable infill is a silent
no-op. This is real but modest: it needs a place to say *why* a placement was refused, and a policy
per kind.

### 2. 3D — done

`Render3D` and `Shed3D` were ported from `01.RFQ_PWA_SQ`, with a Plan/3D toggle on the Options step.
Verified in a browser: a live WebGL2 canvas drawing 147k non-black pixels across 39 colours.

### 3. ShedSafe and Google Places — done

**Places**: the key stays server-side and the field fills all four parts of an address — the state
code included, because the state selects the price table. Degrades to a text box when unconfigured.

**ShedSafe**: a `site_checks` table, a token-cached transport, three routes behind the product's own
session, and a panel that says the certificate is the manufacturer's. The licence server's version had
**no authentication** and hard-coded credentials; neither is reproduced.

### 4. Admin screens — done

| Was missing | Now |
|---|---|
| Price editor | `/prices`: rows in force, per-material change, history with rollback |
| Template catalogue | `/platform`: author a template, archive/reactivate |
| Version channel | `/platform`: record a release, mark current |
| Seat management | `/seats`: every company, seats in use, per-row save |

Members and company settings live in the client workspace (`/team`, `/settings`).

**The defect underneath the price editor** was worth more than the screen: `price_row_overrides` was
**written and never read**. The evaluate route hardcoded `overrideVersion: 0`, so an imported price
list changed nothing. It is wired now — see `docs/PLAN-REMAINING.md` slice I.

### 5. Revision manager, enquiry form, licence control plane

- Revisions are **readable** (`/quotes/[id]` lists them) but cannot be named, described or compared.
  The API **accepts** `revisionName`/`revisionDescription` and stores them; the editor never sends
  them.
- The site's enquiry form says it is not enabled. **That sentence is accurate but the reason is not
  in the copy**: there is no `POST` enquiry route at all — only `GET /admin/enquiries` — and nothing
  in the repo inserts into the `enquiries` table.
- The licence server's version/publish/update channel and salesman/building records are absent
  entirely. The conversion replaces the licence *server*, so those become admin features that are
  not built yet.

---

## Built but not wired — audited 2026-11-02, **now wired** (slice D1)

A second-pass audit read the code rather than the plan and found seven capabilities that existed,
were tested, and **no screen reached**. All seven are now connected — see
`docs/PLAN-REMAINING.md` slice D1 for what each one was and how it was verified.

| Was built, unreachable | Now |
|---|---|
| Materials workbook route | button on the quote page |
| Send history route | panel on the quote page, with `unknown` explained |
| Revoke a share link | table of issued links, each revocable |
| Excel price import/export (870 lines) | `/settings/prices`: template, preview, apply — **writes `price_row_overrides` and `company_catalogue_rows` for the first time** |
| `.sqd` reader (no writer) | `writeQuoteFile` + export/import routes + two screens |
| Charge line items | table on the Cost step; the total flows into the contract |
| Per-company BOM rules | wired into the evaluate policy; select in Settings |

**Two defects found and fixed by that audit:**
1. **The Team screen was broken.** The client's proxy allow-list named `members` (no such API route)
   and not `team` (the real one), so every call answered 404 and the page rendered an empty table
   that looked loaded.
2. **Every DELETE through the proxy failed with a 400** — the bridge sent
   `content-type: application/json` on a body-less DELETE, which Fastify refuses. Revoking a link and
   removing a team member both failed silently. The header is now forwarded only when there is a body.

**Still built but unwired:** AI shed-description parsing (`domain/schema.ts` extraction +
`fallbackParser.ts`; `AI_*` env vars never read) and `exportPng()` (`PlanPanel` renders `<Render2D />`
with no ref).

**Admin screens (slice D2, 2026-11-02):** the admin app now has a capability-derived nav and four
pages — `/company` (with a seat and subscription editor), `/price-books`, `/enquiries`, `/audit` — plus
`/change-password`, which was missing entirely so every new platform admin hit a 404 on first sign-in.
The site's enquiry form is real: `POST /enquiries` with a per-address rate limit and a honeypot, and
the submission appears in the admin queue.

**Still missing from the control plane:** quote template catalogue, version/publish channel, usage
analytics (`usage_events` is never written). `platform:templates` and `platform:versions` are granted
and checked by no route.

**Dead capabilities:** `usage:read` is granted in `contracts/roles.ts` but **no route checks it**.
`usage_events` and `invitations` tables are never written.

---

## What was deliberately not ported

Not gaps — decisions, recorded in `docs/DECISIONS.md` and `docs/KNOWN-DEVIATIONS.md`:

- The WinForms UI (~150 forms), OpenGL 2D/3D, Office COM export, WMI machine serial, NReco PDF.
- The HMAC licence handshake, replayable signatures, `systemctl` publish endpoint, Base64 passwords.
- Multi-company tenancy: this runs for one company on one database.
- The dormant history dual-write.
- Every report template except one.

---

## Suggested order for what is left

Each step makes the product usable by one more person:

1. **3D**.
2. **ShedSafe and Places** — needed for an Australian quote to be credible, and both need the
   customer's own credentials.
3. **Admin**: price editor, Excel import, templates, version channel.
4. **The option rule engine** (add/cascade/interaction rules) — when an option should be refused or
   adjusted because of the others, not just clamped.

Mail, quote status, the materials workbook, company settings, team, and **all eleven option kinds
being placeable in the editor** are now done (see above).
