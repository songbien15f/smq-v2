# Plan — the remaining work

Written 2026-11-02. `docs/FEATURE-COVERAGE.md` says what is missing; this says in what order and why.
Each slice leaves the product usable by one more person, and each is verifiable on its own.

The order is not preference. It is dependency: a document cannot be emailed before it exists, a
company's terms cannot print before there is a field to type them into, and an option cannot be priced
from the editor before the editor can place it.

---

## Slice A — Send: mail, quote status, materials export  ✅ done 2026-11-02

**Why first.** The document and the share link exist. Sending them by email is the last step that
keeps a quote inside the building, and `issued` — the fact that a customer was sent something — is
not recorded anywhere today. A revision with no status is a revision nobody can account for.

| # | Deliverable | Notes |
|---|---|---|
| A1 | Mail transport + durable queue | Ported from the upstream project: `transport.ts` (one interface), `smtp.ts` (SMTP2GO over plain SMTP, **with the timeouts Nodemailer does not set by default**), a queue row so a crash mid-send is recoverable |
| A2 | `POST /quotes/:id/send` | Renders the PDF for the **revision the customer will receive**, attaches it, dispatches inline so the operator gets the relay's real answer |
| A3 | Quote status transitions | `draft → issued → accepted / declined / expired`. A send moves `draft → issued`; the rest are explicit |
| A4 | `GET /quotes/:id/revisions/:rev/bom` | The materials spreadsheet. `bomSheet.ts` already exists in core and nothing served it |
| A5 | Send dialog in the client | To, subject, message, a preview of the attachment name, and the honest state when mail is unconfigured |

**Verified by:** a real send through SMTP2GO to an address the operator controls; the revision's
status moving to `issued`; the queue row reaching `accepted`; the BOM download opening in a
spreadsheet. **And now** `apps/api/src/__tests__/send.test.ts` — 18 tests: the queue's refusals
(unpriced lines, blockers, unacknowledged allowances), idempotency, the lease that guarantees one
worker per job, an expired lease resolving to `unknown` rather than a retry, and a dispatch through
an **injected** transport that moves the quote to `issued`.

**Defect found and fixed while writing the tests:** the BOM route was gated by `quote:read`, so a
**viewer** — whose policy is "no cost, no margin, no internal BOM" — could download the one
workbook that carries unit costs and group subtotals. The gate is now `cost:read`.

**Decision to make:** the From address is **platform-owned** (`no_reply@martechsky.com`, verified with
the relay) and each company supplies a **Reply-To**. Sending as an address the relay has not verified
is how a mail domain gets blacklisted, and it would let one company impersonate another.

---

## Slice B — Company settings, because the document is half-empty today  ✅ done 2026-11-02

**Why second, and why it is not cosmetic.** Found while building the document: `saveQuote` writes
`company_json` as `{ name, version }`. So every revision's frozen company block has **no ABN, no
address, no phone, no email, no terms, no scope notes** — and the customer's page prints the company
name and nothing else. The verification run showed exactly that and I read past it.

| # | Deliverable | Notes |
|---|---|---|
| B1 | Extend `CompanySettings` | abn, address, phone, email, logo text, terms, and the existing margin / payment / assumptions |
| B2 | Freeze the whole company block into a revision | The snapshot must carry what the document prints, or a settings change silently rewrites history |
| B3 | `GET`/`PATCH /settings` | One versioned row; a change creates a **new version**, because a revision records the version it was priced under |
| B4 | Settings page in the client | Company details, terms, scope notes, margin, payment percentages |
| B5 | Members: list, invite, change role, remove | A second person cannot be added today |
| B6 | A regression test that rewrites the stored blob **without** the new keys | The upstream project took every quote in the product down with a 500 after adding one settings field, while its whole test suite passed |

**Verified by:** a saved revision whose document shows the company's address and terms; a settings
change creating version 2 while revision 1 still prints the old terms. **And now** the settings and
team tests in `send.test.ts`: a version bump on every save, the legacy-blob regression (B6), the
margin range, the team list with seat state, and the two guards that keep a company administrable —
the last administrator cannot be removed and cannot demote themselves.

---

## Slice C — The remaining option kinds in the editor  ✅ done 2026-11-02

Eleven kinds are typed in the domain and priced by the BOM, and the editor could place only openings.
So a quote could be priced with a mezzanine only if the config arrived with one, which no screen could do.

| # | Deliverable |
|---|---|
| C1 | A panel per kind, following the openings pattern: place, edit, remove — **each with a keyboard path**, because a canvas cannot be the only way |
| C2 | The rule engine's refusals surfaced as messages, not as a silent no-op |
| C3 | Order: skylight, mezzanine, awning, carry beam, dividing wall, outrigger, stable, horizontal cladding, overhang, cantilever, gable infill |

**What was actually missing was only creation.** The domain, the schema, the BOM pricing, the 2D
drawing, hit-testing, dragging, snapping, the per-kind popover editors and the store's CRUD
(`addOption` / `duplicateOption` / `removeOption`) already existed for all eleven kinds — but
`addOption` had **no caller in the client**, so no screen could add one.

**Built:** an `OPTION_KIND_OPTIONS` catalogue in core (`selection.ts`, the same one-source-of-truth
pattern as `OPENING_TYPE_OPTIONS`), grouped Roof / Walls / Interior / Frame; a **"Place option"**
button row in `PlanPanel` (one press per kind) and an **Options list** below the Openings list, with
per-row select, Duplicate (hidden where `canDuplicate` is false — overhang and cladding span a whole
wall) and Remove; and an **"Add option"** submenu on both the floating Add button and the
right-click empty-canvas menu, derived from the same catalogue.

**Out of scope, deliberately:** the desktop's `ProposeAdd` **rule engine** (add validation, cascade
on removal, interaction rules between options) is *not* ported. `normaliseOption` still clamps every
kind to physical bounds, and adding a gable infill a second time is still a silent no-op. C2 as
written (a rule engine) is a separate architectural slice; C1/C3 are done. Mobile `ControlSheet`
also remains unbuilt.

**Verified by:** `OPTION_KIND_OPTIONS` tests in `selection.test.ts` (every kind, distinct labels,
group coverage, and the label `describeSelection` gives a placed option); and a browser run — all
eleven kinds placed (12 options, gable infill's two ends), the plan summary counting them, the list
rows with summaries, Duplicate/Remove working, a row selecting into the right popover
(Mezzanine → Corner/Width/Depth/Level), the canvas **Add option** submenu listing all eleven, the
contract moving with the options ($30,119.92 → $30,920.90 for three), an honest **blocker** when an
option's material is not in the book, and **Save persisting to Postgres** (`Q-2026-0006`: 3 options,
`contract_cents = 3092090`, and its frozen document rendering with the full company block).

**A pre-existing defect found while verifying (not fixed, not in scope):** the **Customer address**
field is required by `validateDraft` (`validation.ts:118`) but is rendered **without a required
marker**, so a form that looks complete keeps Save disabled with only "1 item needs attention" in the
step rail and nothing marked on the field. A one-line fix; flagged for the operator.

---

## Slice D — 3D  ✅ done 2026-11-02

`Render2D`/`PlanCanvas` were ported; `Render3D` was not. The upstream project (`01.RFQ_PWA_SQ`) had it:
`Render3D.tsx` (72 lines) + `Shed3D.tsx` (590), on three 0.186 / @react-three/fiber 9.8 / drei 10.7.

Ported with only the import paths changed — `Shed3D` builds from `buildWallGeometries`, which v2's
`domain/walls.ts` already had byte-identical. A **Plan / 3D toggle** on the Options step swaps the
canvas; both read the same config, so the model cannot disagree with the plan.

**Verified in a browser:** the canvas is a live WebGL2 context on the real GPU (ANGLE/D3D11) at
352×418, and reading the drawing buffer inside a frame gives **147,136 non-black pixels across 39
distinct colours** — the ground plane, the grid and the shaded shed. A blank canvas would be one
colour.

---

## Slice D0 — Re-opening a saved quote for revision 2  ✅ done 2026-11-02

**Found while verifying slice C**, and it was a bigger hole than the option buttons: a saved quote
could be **looked at but never amended**.

`QuoteEditor` had an `initial` prop for opening an existing quote, and `POST /quotes` already
appended a revision when given a `quoteId` and the revision it expected — but **nothing ever passed
`initial`**. `/quotes/new` always started blank and `/quotes/[id]` was read-only, so revision 2 was
unreachable and the "Save revision" button was dead code.

| # | Deliverable |
|---|---|
| D0.1 | `GET /quotes/:id` returns `config` and `pricing`, so the editor can be seeded — **omitted for a viewer**, because `pricing` carries the negotiated contract |
| D0.2 | `/quotes/[id]/edit` route, which refuses to render the editor when the server withheld the building (a blank editor would let a save silently replace the real one) |
| D0.3 | An **Edit** link on the quote page, shown only to `quote:write` |
| D0.4 | `QuoteEditor` applies `initial.config` — it previously restored only customer/site/pricing and left the building at the default |

**A second defect found while verifying D0.4:** `useDraftStore.isDirty()` fingerprints only the
customer, the site and the money — **the building lives in `useShedStore` and the draft store never
sees it**. So an edit that only changed the building (moved a span, added an option) left the draft
"clean", and the save gate refused with "nothing has been changed yet" while the plan plainly showed
the change. The editor now tracks a **building baseline** beside the draft's and treats either
movement as a change; the baseline resets on save.

**Verified by:** three API tests (config/pricing present for a writer, absent for a viewer, and a
save that appends revision 2 while revision 1 survives); and a browser run — opened `Q-2026-0006`,
saw the saved building (12000 × 24000 × 4200), the customer, the delivery acknowledgement and the
**three saved options** restored exactly, added a fourth, and saved **revision 2** ($31,170.71,
4 options) with **revision 1 untouched** ($30,920.90, 3 options).

**Still open, noticed here:** on the Options step the price must be calculated before the step
unlocks, and the editor does not auto-price when opening an existing quote (`autoPriced` is skipped
when `initial` is set). An operator therefore presses "Calculate the price" once before they can
touch the plan. Not a defect — the price is a fact they should see — but it is one avoidable click.

---

## Slice D1 — Wiring what was already built  ✅ done 2026-11-02

An audit read the code rather than the plan and found seven capabilities that existed, were tested,
and **no screen could reach**. None needed new logic; each needed a control.

| # | Deliverable | What was missing |
|---|---|---|
| D1.1 | Materials workbook download | `GET …/bom` had no link. Now a button beside the PDF |
| D1.2 | Issued share links + revoke | `GET`/`DELETE …/shares` had no UI. Now a table with revoke, and a revoked link stops working |
| D1.3 | Send history | `GET …/sends` had no UI. Now a panel showing `accepted` / `failed` / **`unknown`** with the reason |
| D1.4 | Charge line items | `domain/charges.ts` + store actions existed and **already fed the price** via `sellingChargesCents`; no component called them. Now a table on the Cost step |
| D1.5 | Per-company BOM rules | `FACTORY_PROFILES` + `profileById` existed; the evaluate route passed no `bom`, so **every quote used `DEFAULT_BOM_RULES`** and the setting was inert. Now wired, with a select in Settings |
| D1.6 | Excel price import/export | `pricing/excel.ts` (870 lines) was tested and unwired, and **`price_row_overrides` / `company_catalogue_rows` were never written**. Now `/settings/prices`: template download, preview, apply |
| D1.7 | `.sqd` export/import | The reader existed but was not exported from `@sq/core`, and there was **no writer**. Now `writeQuoteFile` + export/import routes + two screens |

**Two defects found while verifying:**

1. **The Team screen was broken.** The client proxy allow-list named `members` (no such route) and not
   `team` (the real one), so every call 404'd and the page rendered an empty table that looked loaded.
2. **Every DELETE through the proxy failed with a 400.** The bridge sent `content-type:
   application/json` on a body-less DELETE, and Fastify refuses an empty JSON body
   (`FST_ERR_CTP_EMPTY_JSON_BODY`). Revoking a share link and removing a team member both failed. The
   bridge now forwards the header only when the request actually carries a body.

**Verified in a browser and against Postgres:** the materials list downloads as `PK`; a minted link
appears in the list and flips to `Revoked`; a charge of $450.00 moved the contract $31,170.71 →
$31,620.71 exactly; the factory profile test proves two profiles give different prices and different
bolt counts; the Excel template downloads (93 KB) and its 2,526 rows preview as `blank`, while a
one-row sheet with a price previews as `matched` and applies into `price_overrides` v1 +
`price_row_overrides` at 1234 cents — **the first write those tables have ever had**; and a `.sqd`
export round-trips through the import route with both revisions and dollars intact.

---

## Slice E — Google Places
Address fields are plain text today, so a suburb is spelled by hand and a postcode can be wrong. The
key stays server-side behind an authenticated proxy — the desktop's version kept its key in the
desktop config file, which is the thing this replaces.

---

## Slice D2 — The admin screens, and the enquiry form the site promised  ✅ done 2026-11-02

The admin app had **two pages** (`/`, `/company`) and no nav, so every other control-plane route was
reachable only by typing a URL. The site promised an enquiry form that did not exist.

| # | Deliverable |
|---|---|
| D2.1 | Admin nav, derived from capabilities — the same rule the client shell uses |
| D2.2 | `/enquiries` — the queue, with mark-handled (kept as a record, not deleted) |
| D2.3 | `/price-books` — publish a book from a dump directory, see every book and which is active |
| D2.4 | `/audit` — the log, read-only by construction |
| D2.5 | `/change-password` — **the route was missing**, so every newly provisioned platform admin hit a 404 on first sign-in |
| D2.6 | Seat and subscription editor on `/company` — `companyLimitsRequest` existed and no route used it, so seats could only be changed by editing the database |
| D2.7 | `POST /enquiries` (public) with a per-address rate limit and a honeypot, and the site form that calls it |

**Four API defects found and fixed while building the screens:**

1. **`PATCH /admin/companies/:id/status` answered 200 for a company that did not exist** — the
   `NotFound` was swallowed by a `.catch` that returned `null`. A control plane that reports a change
   it did not make is worse than one that fails.
2. **`GET /admin/audit` and `/admin/enquiries` returned raw snake_case rows**, so a screen typed
   against the `AuditEntry`/`EnquiryRow` contracts compiled and read `undefined` for every field.
3. **`handled` came back as `0`/`1`**, which a checkbox reads as truthy for both values.
4. **The honeypot was dead on arrival**: the zod schema is `.strict()`, and an unknown key is stripped
   on parse — deleting the very field the check depended on. It is now a declared optional field.

**Verified in a browser:** the public site form submits and the enquiry appears in the admin queue on
a different port with its name, email and message; the seat editor wrote `seats 5 → 8` to Postgres and
recorded `company.limits: seats 5 → 8` in the audit log; all four admin pages render with their nav.

**Still missing from the control plane:** quote template catalogue, version/publish channel, usage
analytics (the `usage_events` table is never written), and the `platform:templates` /
`platform:versions` capabilities are granted but checked by no route.

---

## Slice F — ShedSafe
**Zero lines today**, and it is the first thing an Australian buyer checks: a quote must state the wind
region, terrain category, importance level and site wind speed. The honest shape is a **calculator
labelled as one** — the six inputs computed to AS/NZS 1170.2 — because a ShedSafe *certificate*
requires the customer's own account, which this product must not pretend to hold.

---

## Slice G — Admin

Price editor (per-row overrides), Excel import, template catalogue, version channel, seat management,
enquiries queue, usage. The API for price books and the company exists; the screens do not.

---

## What this plan does not include

- **Any new product scope.** Nothing here is a feature the desktop did not have.
- **A rewrite of what works.** The engine, the editor, the document and the share link are verified;
  they are extended, not revisited.
- **The five real quotes for golden tests.** That is the operator's, and it is still the only thing
  that proves the BOM quantities match what a factory ships.

---

## Slice G — Credentials an operator can set, and the option rules  ✅ done 2026-11-02

### G1 — Integration credentials in the admin app

`GOOGLE_PLACES_API_KEY` and the `SHEDSAFE_*` pair were declared in `.env.example`, read by nothing
until the integrations were built, and then read **only from the environment**. Turning either on
required shell access and a restart — an operator with a browser could see "not configured" and had
no way to fix it. That is the gap the operator found by looking in Settings and seeing nothing.

| # | Deliverable |
|---|---|
| G1.1 | Migration **006**: `platform_settings` (key, value, `secret` flag) |
| G1.2 | `lib/integrations.ts` — **database first, environment second**, so a UI value wins and an existing `.env` deployment keeps working |
| G1.3 | `GET /admin/integrations` (never returns a secret — only whether it is set and where it came from), `PUT` (one key at a time), `POST …/test` |
| G1.4 | `/integrations` in the admin app, with a **Test** button per integration |
| G1.5 | Places and ShedSafe now build their transport **per request** from the database, so a saved key works immediately — a transport captured at boot would have kept answering "not configured" until a restart |

**Why clearing deletes the row rather than storing `''`:** an empty string would shadow a real
environment value with nothing. Deleting lets the environment show through again, which is what
"clear this field" has to mean.

**Verified:** 8 tests (database wins over environment, empty-is-unset, an unknown key refused, the
serialised status never contains the secret, a company user refused) and an API round-trip against
Postgres — saved (`source: "database"`, `set: true`), the GET returned **zero occurrences** of the
secret, then cleared (row deleted, `set: false`).

### G2 — The option rule engine

The desktop's `ProposeAdd` layer (14 `IProposeAdd*` interfaces) **cannot be ported**: it is bound to
its own IoC container and DTO model, and reproducing it would mean reproducing the desktop's object
graph.

What was built instead is the part that matters and can be stated plainly, in
`packages/core/src/domain/optionRules.ts`:

- **`refusePlacement(kind, shed)`** — a mezzanine below the height it can stand at, a dividing wall in
  a shed too narrow for one, a second gable infill when both ends are closed, a second overhang or
  cladding band that would sit on top of the first, a stable or skylight with no room. Every refusal
  is a **sentence naming the number** that is in the way, because the operator's next action is the
  point of the message.
- **`optionsThatNoLongerFit(shed)`** — what a dimension change has invalidated. It **reports** rather
  than removing: deleting an object because a wall moved is a silent edit to a quote, and only the
  operator knows whether the mezzanine should go or the wall should come back.
- `addOption` now asks the rule first and puts the refusal in `notices`, which the panel already
  renders — so a refused placement explains itself instead of doing nothing.

**Deliberately not built:** automatic resizing (silently placing something smaller than asked is a
quote for a building nobody designed) and cascade-on-removal (that is what Undo is for, and it is
already one history entry).

**Verified:** 11 tests pinning each rule, the boundary (allowed at exactly 2400 mm), and that the
catalogue does **not** invent a refusal for a kind with no rule.

---

## Slice H — Usage, releases and the template catalogue  ✅ done 2026-11-02

The last three vendor screens. Two of them were tables that had **never been written**, which is worse
than absent: a table that looks like analytics is why nobody built analytics.

### H1 — Usage

`usage_events` existed since the first migration and **nothing ever wrote to it**. Now:

- Four kinds, all facts about the product rather than about a person: `quote_created`,
  `revision_saved`, `mail_sent`, `page_view`. **No customer name, no address, no price, no content.**
- Wired at the three real events. A **replay is not a second quote** (the same idempotency key means a
  double-click), and a send counts only when the relay **accepted** it — a `failed` job never left the
  building and an `unknown` one may not have.
- `GET /usage` for a company, `GET /admin/usage` for the vendor, with 7- and 30-day windows. The scope
  comes from the session, so a company cannot read another's numbers by editing a URL.
- The write **never fails the request**: a usage row is a side effect, and throwing would turn an
  analytics problem into a broken save. This is the one place in the codebase where swallowing is
  right, so it says so.

### H2 — Releases, not a version channel

The licence server published a desktop **installer** with a force-update flag. A web product has no
installer — every user is on the deployed build the moment it ships — so reproducing that machinery
would be a distribution system for a distribution that does not happen. What survives is the question
a support call asks: *what is this running, and what changed?* Migration **007** adds `releases`;
`current` is exclusive by construction (the write clears the others in the same transaction), because
two "current" releases make the one question the table answers unanswerable.

### H3 — The template catalogue

Three empty tables became a working catalogue:

- Author a template from a building. **What is copied is the rule**: the config, and nothing else — no
  customer, no site, no ShedSafe building id. A template that carried a building id would give every
  clone another site's wind certificate.
- A company sees active templates on the quotes page and starts a quote from one. The building travels
  in the **URL fragment**, so a customer's specification never reaches a server or a proxy log.
- Cloning is counted separately from reading, because a catalogue nobody clones is a catalogue to
  prune and without the count there is no way to know.

**A defect found and fixed while verifying:** `usageSummary` used `(? IS NULL OR tenant_id = ?)`, which
Postgres refuses with *"could not determine data type of parameter $3"* — the same trap this project
hit once before. The clause is now **built** rather than passed as a nullable parameter, which also
keeps it portable to SQLite (which would have accepted the other form and hidden the bug).

**Verified:** 10 tests (usage written on save, a replay not counted, company vs platform scope, the
vendor summary refused to a company user, one current release, a duplicate label refused, a template
carrying no identity, the catalogue listing, the clone count, an archived template hidden) and an API
round-trip against Postgres — a page view recorded and summarised, a release published and current, a
template authored and visible to the company **with no customer data**.

---

## Slice I — The three admin screens, and the defect underneath one of them  ✅ done 2026-11-03

The audit said "three admin screens are missing". Reading the code first changed the scope: one of the
three had **no API at all**, and building a screen over it would have edited decorative data.

### I1 — The defect: price overrides were written and never read

`price_row_overrides` and `company_catalogue_rows` were **written** by the price list import and read
by nothing. The evaluate route called `openBook(hash).lookup` directly and hardcoded
`overrideVersion: 0`. So a company could load its supplier's price list, watch it be accepted, and
every quote would still price from the shared book.

Fixed in two places:

- `packages/core/src/lib/pricing/overrides.ts` — a **`Proxy`-based decorator** that wraps any
  `PriceLookup` and replaces the unit cost of a row the company has priced differently. A proxy rather
  than a hand-written class because the interface has twenty-odd methods and gains more: enumerating
  them would silently stop overriding a new one. Any method returning a row is covered, today and later.
  It also serves a company's **own materials** by name, so "a different factory" works.
- The evaluate route applies it, records the real `overrideVersion`, and the save route now **refuses**
  a save whose price set moved after the preview — the same guard the building already had.

**Verified end-to-end against Postgres:** the book's own cost for `FBI15403` is `$16.9571`; a quote
priced it at **1234 cents** (the imported override) rather than the book price. Then a doubled override
moved the contract **$17,304.55 → $19,034.66**, with `overrideVersion` 1 → 2 and the line at 2468.

### I2 — The price editor

`GET/PUT /prices/overrides` (company) + `GET /admin/companies/:id/prices/overrides` (vendor) +
`DELETE /prices/overrides/:id` and `DELETE /prices/overrides`. A write **supersedes**: the new row set
becomes a new version and the old one stays readable, because a frozen revision names the version it
was priced under. Clearing one row removes it from the carried-forward set without touching the others.

`/prices` in the admin app: the rows in force, per-material **Change** and **Use book price**, and a
history with **Remove** to roll back a version.

### I3 — The template author

`POST /admin/templates` and `PATCH …/:id` existed with no control. `/platform` now has a code/name/type
form plus a building as JSON, and an Archive/Reactivate button per row. The building is JSON rather
than dimension fields because a template carries a whole `ShedConfig` — openings, options, colours — and
a handful of number inputs would either drop everything else or need thirty of them.

### I4 — Seats across companies

`/seats`: every company with people, seats in use, the paid limit, the subscription end and a per-row
save. Seats are **live sessions**, so the screen shows both numbers rather than a percentage: `2 / 5`
and `5 / 5` mean different things even though only the second is a problem. Lowering a limit never
evicts anybody already working.

**Verified:** 7 API tests (a write supersedes and carries rows forward, clearing one row keeps the
others, removing a version restores the previous, a viewer is refused, the active version reaches the
evaluation) plus 9 core tests on the decorator, and live API runs confirming create → archive hides a
template from the company catalogue and a seat change writes `seats 5 → 7`.
