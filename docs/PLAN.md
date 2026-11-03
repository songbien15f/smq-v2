# SmartQuote v2 — Build Plan

A web rebuild of the SmartQuote desktop quoting app and its licence server, as one
system with a separate backend and three front-ends. Target market: steel shed
manufacturers and dealers in Australia.

- **Not** a consumer app. The buyer is a shed **company** buying a workflow for its staff.
- **Supersedes** both `smq-code-smartquote` (WinForms desktop) and `smq-code-license`
  (ASP.NET Core licence server). It does not run alongside them.
- Analysis baseline: `D:\Docs\OS.mr.Thi\docs\smartquote-analysis` — start at `tong-ket/README.md`.
- Reuse source: `D:\Docs\OS.mr.Thi\01.RFQ_PWA_SQ` — a working web app whose BOM engine,
  pricing chain, 2D/3D editor and revision model are already tested (1,747 tests).
  Its **core is copied forward; its shell is not**.

Read `DECISIONS.md` before changing anything structural, and `KNOWN-DEVIATIONS.md`
before changing any formula.

---

## 1. What the product must do

A salesperson at a customer's table goes from *"a 12 m × 9 m shed with one roller door"*
to a **locked price**, a **2D/3D drawing**, a **bill of materials** and **payment terms**,
without handing off to engineering or accounting.

Four problems it solves, and each one has a consequence for the build:

| Problem | Consequence |
|---|---|
| A shed has thousands of parts; price cannot be area × rate | A BOM must be computed from geometry first. This is the profit engine, and the highest-risk area. |
| One wrong parameter breaks the structure (AS/NZS 1170.2 wind, terrain, importance) | Cross-field constraints plus ShedSafe-certified inputs. |
| Selling happens on site, sometimes without signal | Must work on a phone, and must never silently lose an edit. |
| Commercial protection: sold per company, per seat, per subscription | Licensing is a first-class feature of the admin site, not an afterthought. |

## 2. Shape

```
packages/core        pure: building geometry, BOM, pricing, estimating, document projection
packages/contracts   zod schemas + DTOs shared by API and every front-end
packages/db          schema, migrations, repositories (SQLite dev / Postgres prod)
packages/ui          design tokens + components
apps/api             NestJS + Fastify, REST /api/v1 — the only process with a database
apps/admin           licence vendor control plane
apps/client          a shed company's workspace (the quote editor lives here)
apps/site            end-customer site: landing, share viewer, enquiry
```

The golden rule: **`packages/core` imports no database, no HTTP, no tenant.** That is why
the engine can be tested without a database and reused by all three front-ends.

## 3. Phases

| Phase | Deliverable | State |
|---|---|---|
| **0** | Decision record, verification items, golden-test selection | **done** — A1–A20 decided, C1 resolved; real issued quotes still needed from the operator |
| **1** | Monorepo that runs; design system; shared contracts; first migration | **done** |
| **2** | Real schema, price-book importer, `.sqd` reader | **done** — importer publishes the real 75-table dump; `.sqd` reads plaintext and AES, refuses `BinaryFormatter` |
| **3** | The engine: optimise → groups → merge → price chain | **done** — runs against the real book; girt pricing fixed (A18) |
| **4** | REST API: auth, seats, quotes, evaluations, price books | **done through the quote lifecycle** — evaluate, save, revisions, publish a book. Documents, mail and members pending |
| **5** | Client: 3-step editor with the price always visible | **done for details · options · cost · save · document download · share link.** Settings, team and price editor pending |
| **6** | Admin: the company, price books, audit | company page, price-book publish/list and audit done; members, templates, versions pending |
| **7** | End-customer site: landing and the shared quote | landing **and `/s#token` done** — the token is exchanged for a cookie and removed from the URL |
| **8** | Documents, launcher, deployment, CI | **one-click launcher verified from an empty database**; **PDF and HTML verified in a browser**; mail and CI pending |

### What is verified, and what is only written

| Check | Result |
|---|---|
| `pnpm build` (turbo, 8 tasks) | all pass |
| `pnpm test` (turbo, 8 tasks) | **741 tests pass** — core 679, api 42, db 12, contracts 8 |
| **`pnpm test` on PostgreSQL 18.1** | **42/42 API tests pass on Postgres** as well as on SQLite |
| `pnpm typecheck` | 12/12 tasks pass |
| `pnpm db:migrate` on PostgreSQL 18.1 | 3 migrations; 27 tables; both immutability triggers; money as `integer` |
| `pnpm install:company` | creates the one company and refuses a second |
| **A quote, end to end, in a browser** | sign in → fill six groups → price **$30,119.92** → change the span → **$25,200.92** → add a roller door → **$25,760.71** → negotiate to **$27,500** with the deposit re-derived to **$2,750** → save → `Q-2026-0002` revision 1 |
| **The saved revision in Postgres** | `contract_cents = 2750000` exactly; `overridden.contract = true`; `engine_version`, `price_book_hash` and `settings_version` recorded with it |
| Capability enforcement | a viewer receives no `contractCents`; a platform admin with no membership is refused a company route |
| Seat limit | the third sign-in on a two-seat company is refused; signing out frees the seat |
| Single company | the second `POST /admin/companies` answers 409 and the row count stays 1 |
| Revision immutability | Postgres triggers **raise** on `UPDATE` and `DELETE` |
| Engine against the real price book | every preset prices cleanly; `GIRT_PRICE_FROM_PURLIN` raised with 2 `assumed` lines |
| **The quote document, in a browser** | PDF renders through Chrome (**70 KB, `%PDF-`**); the customer page states wind region, terrain and importance, prints colours by Colorbond name, and its three payment stages **sum to the contract exactly** |
| **The leak check** | the customer page contains **no** material cost, margin, kit price, BOM code, price-book reference or demo advertising — asserted on the visible text, and pinned by 12 tests |
| **The share link, opened as a stranger** | `/s#token` redeems into a cookie, clears the fragment from the URL, serves **the same page the operator sees byte for byte**, and answers 404 to a forged cookie and an unknown token with an identical message |

### Six defects the browser found that the type checker could not

None of these was visible in code review or in a green test suite:

1. **A group heading read `Delivery1 to fix`** — the visible pill ran into the title, so a screen
   reader announced one word. Fixed with an explicit accessible name.
2. **Typing a customer's name marked the price out of date**, and said "the building changed". The
   price is a fact about the building and the money; staleness was keyed on the whole draft.
3. **Negotiating the contract did not re-derive the deposit on the Cost step** — it showed the
   deposit for the price *before* the negotiation, so the stages did not sum to the contract.
4. **A save refused by the server showed nothing at all.** The error summary was rendered only when
   the *client* found a problem, so a 409 on a valid form made the button look broken.
5. **The customer's address was required by the API and not by the form**, so a complete-looking
   form was refused with "Some fields need attention" and no field marked. Both sides now check it,
   and the summary lists the server's own field errors.
6. **A field's element id was generated**, so the error summary's links pointed at nothing and
   clicking an item did nothing.

**Still not verified:** the BOM has never been calibrated against a real issued quote. The harness
exists and reads a real `.sqd`; the comparison needs the operator's quotes.

### Measured UI, and one thing that could not be measured

Measured in the running app at 1440 / 768 / 375 px, after the accessibility fixes:

| Check | Result |
|---|---|
| Horizontal overflow | **0 px at all three widths** |
| Primary text contrast | ink on surface **17.85:1**, muted on surface **7.58:1**, white on navy **17.71:1**, gold on navy **11.83:1** — every pair well past AA |
| Body text below 12 px | **0** (was 19: issue codes and two badges were 11 px) |
| Interactive controls under 44 px | the colour swatches, at 32 px |

The swatches are deliberately 32 px rather than 44: a 30-colour picker at 44 px each is a screen of
its own, and WCAG 2.2's target-size rule (minimum 24 px) is met with room. They are also the one
control whose purpose is *looking*, so density is the point.

**Could not be measured here:** whether the `:focus-visible` ring actually paints on keyboard focus.
The rule is present in the loaded stylesheet (`outline: 2px solid`, `outline-offset: 2px`, gold on
navy), but `:focus-visible` ignores programmatic focus and the automation surface in this environment
would not deliver a real Tab press without timing out. **A human should tab through the editor once on
a real browser** — it is a thirty-second check and it is the one claim this build cannot make for you.

### Phase 0 — decisions and verification (must precede code that trusts a number)

- Write `DECISIONS.md` (done) and `KNOWN-DEVIATIONS.md` (done).
- Verify the two live items: `.sqd` is AES **or** plaintext (the reader auto-detects both,
  so this is a test, not a branch), and option material really is missing from the
  desktop's BOM.
- Choose 5–6 real issued quotes as golden tests: one per building family, one with
  options, one non-standard.
- Answer `DECISIONS.md` §B (name, build order, tenancy, purlin table, history).

### Phase 3 — the engine, in the order that matters

```
purlin/girt optimisation   ← everything downstream depends on this
  → frame → purlin/girt → sheeting → gutter/downpipe → flashing
  → bracket → flat fly → bracing → bolts → screws → options → misc
  → merge (code | unit | description | unitCost) → totals
  → price chain (kit → total → contract → deposit/progress/balance)
```

Then the option rule engine (propose / add / infill / remove + cascade on delete), then
the cross-field constraints — **replacing the desktop's three manual boolean flags with a
single state store**. The desktop's flags can stick, and a stuck flag drops every edit on
the panel silently. That failure mode must not survive the port.

## 4. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | BOM + pricing decides profit and loss; the formulas span ~13,400 lines with 25 known behavioural quirks | Golden tests against real quotes; every divergence recorded; `ENGINE_VERSION` travels with each revision |
| R2 | The desktop's 3-way sync (panel ↔ grid ↔ engine) drops edits when a flag sticks | One state store, one source of truth, tested transitions |
| R3 | The option rule engine has dozens of implicit rules (100 mm edge, 185 mm auto-shift, infill cascades) that cannot be inferred from the UI | Port rule by rule with a test each, keeping the message text |
| R4 | The reference price book is licensed data | Never committed; a mock book for demos; a demo-safety check that scans by shape, not by a column list |
| R5 | The real database is newer than the ORM metadata | Use the bacpac DDL as the source of record |
| R6 | Sheer size | Phase gates; P0 parity before P1/P2 ambition |
| R7 | Drift between `01` and `02` | `packages/core` is the only copy that matters; `01` becomes reference |

## 5. What "done" means for a phase

A phase is done when it can be demonstrated, not when the files exist.

- Phase 2: a real dump imports, and the report says what changed.
- Phase 3: a golden quote reproduces the expected contract price, and a deviation is
  explained rather than absorbed.
- Phase 4: a capability check refuses the operation when called directly by URL.
- Phase 5: one salesperson quotes a shed end to end on a phone, and the saved revision
  still reads the same a week later.
- Phase 6: a new company can be created, seated, published to, and suspended.
- Phase 7: a customer opens a share link and sees no internal caveat.
- Phase 8: a clean box deploys from the repository and reports healthy.
