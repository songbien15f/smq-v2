# Full desktop parity — implementation plan

**Goal:** cover every user-visible command of the desktop SmartQuote plus the business
logic behind it, fixing old bugs rather than copying them.

**Spec:** `docs/superpowers/specs/2026-11-03-quote-editor-parity-design.md`
**Reference:** `docs/smartquote-quote-editor-reference.md`
**Policy:** a desktop bug is **fixed**, and the fix is recorded in `KNOWN-DEVIATIONS.md`.
Nothing is copied because "the old one did it that way".

---

## Where we are

Shipped and green: domain (10 colour roles, full Step 1 fields, migration), catalogue
layer, `misc_option`, placement rules R1/R2/R4/R7/R10 + cascade + wipe, 3-column layout
with the plan on every step, CategoryDock (15 categories, alignment/distance/FFL, Remove
All), `cost:margin` enforced server-side, Additions (13 lines, GST rules, override), pin
before save, Fax, golden price-chain check (19 revisions / 12 real `.sqd`), reference wiki.

Remaining work is grouped below in execution order. Each group is a set of tasks that each
end with tests and a commit.

---

## Group 1 — Step 2 depth and Additions

### 1b. Opening parameters (model + form)

Add to `Opening`: `sku` (catalogue size/type id), `prepOnly` (Opening Only),
`series` ('A'|'AA'|'B', roller only), `windlock` (boolean, roller only), `quantity`
(roller only, 1–9).

- `types.ts`, `schema.ts` (complete + tolerant), `normaliseOption`-style normaliser for
  openings, `plan.ts` drawing of `qty` doors.
- Contract `shedConfigSchema` shares the type, so the API accepts it unchanged.
- Form: Size/Type select from `material_window` / `padoor` / `roller_door` / `sliding_door`
  catalogue rows; Series and Windlocks for roller; Opening Only switch.
- Rules: windlock defaults on for wind region C/D (desktop rule); roller qty capped by
  wall space (already refused by `placeOpening`, extend to qty).
- **Bug to fix:** the desktop lets a custom roller width exceed the series maximum
  (`SizeConst.MAX_RDOOR_A_W=3380` vs live data 3430); v2 validates against the selected
  series row, not a constant.

### 1c. Option parameters and Track

- Outrigger height/direction; Awning scope + front/rear pitch + high/low side; Mezzanine
  floor load (1.5/3.0/5.0/7.5 kPa); Carry Beam combo (`left-open`, `with-roller`,
  `with-wide-roller`, `with-sliding`); Skylight type + colour.
- **Track** gets `segments` and `width` on the sliding door that owns it (already the
  single source of truth), with the 1000–6000 mm per-segment rule (R11).
- **Bug to fix:** desktop mezzanine prices only four floor loads and silently returns $0
  for any other; v2 rejects a load outside the set instead of pricing it at zero.

### 1d. Additions, full shape

- Equipment-hire lines (description, qty, unit price), distributor-misc lines, notes /
  additional costs; labour lines gain hours × rate with the company rate table.
- **Min fee to distributor / nominated carrier** (dollar and percent) — computed, not typed.
- Settings screen for the rate lists (labour, equipment, demolition, distributor) — depends
  on group 4.

---

## Group 2 — Quote lifecycle

- **Copy quote / Copy All** (sections: details, design, options, additions) — new
  `POST /quotes/:id/copy` creating an independent quote with a new number; revisions are
  not shared.
- **Delete quote** (`DELETE /quotes/:id`, soft delete, `quote:write` + audit event).
- **Revision rename / delete / open** — revisions stay immutable in content; name and
  description become editable metadata; deleting a non-current revision is allowed once.
- **Cost Default / Reset** — restore the engine default figures and discard typed
  overrides with a confirmation.
- **Bug to fix:** the desktop's "New Revision" overwrites the current revision on a plain
  Save; v2 already always appends, which is the correct behaviour and stays.

---

## Group 3 — Outputs

- Print types: contract/quotation to client, order/quotation/contract to supplier,
  elevations, plan view. One HTML template with a `PrintKind` switch, as the desktop had
  one template — but the seven titles and column sets are explicit.
- Elevations and plan view render from `PlanGeometry`/wall geometry (SVG → PDF).
- BOM export: add CSV and `.vqu`; keep `.xlsx`.
- Punchings Details report (admin-gated).
- Send Request modes: quote / engineering / manufacturing / both, each incrementing its own
  counter on the quote, all through the existing durable send queue.
- **Bug to fix:** desktop printed supplier documents with client pricing because every type
  used one template; v2 selects the column set by `PrintKind`.

---

## Group 4 — Settings depth

- Company rate tables: labour (concreter/electrician/labourer 1–2), equipment hire,
  demolition, distributor misc, default costs (council/engineering/rubbish/delivery/
  concrete), default inputs for a new quote, quote-rate table.
- Admin database screen: table list, row counts, backup/restore of the app database.
- Salesmen list + ShedSafe salesman sync.
- **Bug to fix:** desktop stored labour rates in `Administration` JSON blob with no
  versioning; v2 versions settings (already has `settings.version`).

---

## Group 5 — Model gaps and polish

- R3/R5 infill columns: add a column model to the wall geometry, then port the rules.
- R9 two-empty-side-walls: implement only after R3, using the real column list.
- R12 skylight snap: add the roof-sheet grid from `material_sheeting.cover`.
- Golden BOM: convert `HousePlan` → `ShedConfig` for the 12 real files, compare BOM
  quantities as well as the price chain.
- Add-mode overlay in `Render2D` using `openingAtPoint` (already implemented in core).
- Document: print all ten colour roles; print Fax.

---

## Acceptance per group

1. Every command in the group reachable in the UI and enforced on the server.
2. A test per new rule, and a test that the old bug is gone.
3. `npx turbo run test` green; typecheck clean; dev servers 200.
4. Wiki updated with the new fields/rules, and `KNOWN-DEVIATIONS.md` for any deliberate
   difference.
