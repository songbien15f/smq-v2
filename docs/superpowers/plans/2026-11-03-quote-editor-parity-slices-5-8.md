# Quote editor parity — remaining plan, slices 5–8

**Spec:** `docs/superpowers/specs/2026-11-03-quote-editor-parity-design.md`.

Slices 1–4 shipped: domain (10 colour roles, new config fields, migration), catalogue layer,
`misc_option`, placement rules + cascade. The remaining work is the visible editor.

## Slice 5 — layout: 2D/3D in column 2 on every step

**Goal:** the user's original complaint — the middle column is empty text while the plan sits in
column 1 of step 2 only.

- Extract the canvas from `PlanPanel` into `PlanView` (2D/3D toggle + `Render2D`/`Render3D`).
- `PlanView` takes `interactive`; steps 1 and 3 render it non-interactive (`pointer-events-none`).
- `QuoteEditor`: column 2 always renders `PlanView`; column 1 renders the step panel; column 3 the
  price. Remove `TreeViewSummary` and the "plan is on the previous step" copy.
- Stack on one column below `lg` instead of hiding the plan.

**Test:** typecheck + the page returns 200 on all three steps; no new unit test (layout only).

## Slice 6 — Step 1 UI: the remaining fields

**Goal:** every field in the spec's Step 1 table is on screen and bound to the config.

- Quote & client: Fax, Quote Rate moved into group 1.
- Delivery: `Copy from Above` (site → delivery), scope **select** from the catalogue.
- Design: Building Class / Ground Snow Load / Design Wind Speed read-only from the site check;
  End/ Side opening switches; Cantilever front/rear; Gable infill switch.
- Shed: Nom. bay spacing, Wall/Roof profile, Downpipe type, Footing type + sub-type,
  Adjust bay spacing.
- Colours: **Assign wall colour for all**.
- Site check: PIN enabled before save (API stateless pin is slice 6's API half).

**Test:** `validation.test.ts` extended for the new required fields; a form-level test for
`reconcileBays` wiring; API test for the stateless pin.

## Slice 7 — Step 2 UI: the 15 categories

**Goal:** the desktop's category dock replaces the flat button grid.

- `CategoryDock`: one accordion per category, ordered from `structureOptions`, each with a
  parameter grid and an **Add** that is disabled with a reason.
- Track category = a view over sliding-door openings; Extra charge = the existing `charges` table;
  Engineering = a dropdown over `engineeringCents` (the five book SKUs).
- Add mode: canvas overlay green/orange/blocked from `placeOpening` / `refusePlacement`;
  proposals menu; right-click menu.
- Remove All per category and globally; wipe dialog on dimension change.

**Test:** one test per category that its Add produces the expected option; proposal menu test for
the refusal path; wipe dialog test.

## Slice 8 — Step 3, Additions, documents

- Cost panel: `cost:margin` capability hides Building/BOM/Margin/Additions/Quote Rate.
- Additions dock with the preset line catalogue.
- PDF/BOM: misc and engineering lines on the document; BOM workbook includes `misc`.
- Golden test against five operator quotes.

## Execution order

5 → 6 → 7 → 8, each committed green. Todo list is updated at the start of each slice and after
every task so the remaining work is always visible.
