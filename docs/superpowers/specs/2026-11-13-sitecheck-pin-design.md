# Design: SiteCheck as a PIN on Site address (v1 parity)

> **Author:** agent. **Date:** 2026-11-13.
> **Reviewer:** operator. **Status:** awaiting review before the implementation plan is written.
> **Decisions the operator has settled:**
> - Use the PIN popover layout.
> - The six certified values are read-only, as in v1.
> - Design is the only place they are shown.

This spec is part 1 of 4 in the `/quotes/new` improvement round. Parts 2–4 get their own specs:
- errors and layout;
- input behaviour;
- dimension bounds, mobile and performance.

---

## 0. The problem, in one paragraph

In v1 (desktop) SiteCheck runs **from the Site address field**:
1. A `MapButton` (the PIN) sits at the end of the address field (`MQuoteDetailView.cs:357-411`).
2. It opens the flyout **Building Parameters**: Importance, Span, Height, Length, Pitch, plus a read-only Avg. Height (`QuoteDetailsView.ShowBuildingParameters.cs`).
3. **GO TO SITECHECK** is enabled only once the flyout is complete (`UcShowBuildingParameterss.cs:1731-1843`).
4. The five values are the same record as the Shed group (`docs/full_feature/05-building-parameters-sync.md`).
5. The six certified values fill the Design group, read-only.

v2 does it differently. A separate "ShedSafe site check" section (`SiteCheckPanel.tsx`, 1273 lines) sits between Delivery and Design. It:
- shows the six certified values **a second time**, alongside the Design group;
- has its own Building parameters form;
- carries several paragraphs of disclaimers;
- is far from the address field that triggers it.

Users see two copies of the same values and a flow that does not match the product they are replacing.

---

## 1. Goals, non-goals, anti-goals

### Goals
1. The SiteCheck flow follows v1: **address → PIN → five params → GO TO SHEDSAFE → come back and get the result → Design fills itself in.**
2. The six certified values appear **once** (Design). The site readings appear **once** (Design → "More parameters").
3. The "ShedSafe site check" section is removed from Step 1.
4. The status the user needs to know fits **on one line** under the address field.

### Non-goals
- No change to the API: pin, import, the drift rule, or the salesman rule.
- No change to how the price is calculated after import (`onImported` → `applyPartial` → `calculate`).
- No error or message rework for the whole form (that is part 2). This spec only shortens the copy in the new SiteCheck pieces.
- No change to Step 2 or Step 3.

### Anti-goals (a failure even if it "works")
- The popover's five fields and the Shed group drift apart in value. They must be **one record** in `useShedStore`.
- Something editable is shown in the Design group while ShedSafe is configured. That lets someone type over a certificate.
- The popover closes when the user switches to the ShedSafe tab and back, losing the "waiting for Auto Calc" state.
- A gate that stops the user from pinning is lost. Today's gates are `missingForPin`, `notASalesman`, `missingParams` and `paramsBelowFloor`.

---

## 2. Constraints

**Single source of truth**
- **Shed parameters:** `useShedStore.config` via `applyPartial` (passes through `normaliseShedConfig`, has undo).
- **The check:** `SiteCheckProvider` / `useSiteCheck()` in `siteCheckState.tsx`. Keep its current shape: `check`, `configured`, `replace`, `watching`, `stopWatching`, `waitingError`, `state`.
- **The salesperson:** `useShedSafeIdentity()` + `session.email`, read-only.

**API paths unchanged**
- Pin:
  - no quote: `site-checks/pin`;
  - saved quote: `quotes/${id}/site-check/pin`.
- Import:
  - no quote: `site-checks/${check.id}/import`;
  - saved quote: `quotes/${id}/site-check/import`.
- A pin before the first save still calls `setSiteCheckId`.

**No new UI library.** There is no popover dependency in `apps/client`. Build on the patterns already present:
- `SelectionPopover.tsx`: `role="dialog"`, Escape to close.
- `ControlSheet.tsx`: mobile bottom sheet (`fixed inset-0 … justify-end lg:hidden`).

**Drift logic unchanged.** Drift = `check.pinnedFor` against config (span, height, length, importance).

**Read-only certified values.** Matches v1 `Enable = false` and the existing `DesignValue` component.

**"ShedSafe not configured" mode** (`configured === false`) keeps today's behaviour:
- PIN is hidden;
- the six Design values stay read-only and show `—`.

*Correction found while planning:* today the Design values are `<output>` in every case (`QuoteDetailsPanel.tsx:2405`). `WIND_REGIONS` and `TERRAIN` are unused constants. The sentence "typed by hand" in `SiteCheckPanel.tsx:574` is stale, and it is removed along with the section.

**The popover's dimensions go through the Shed group's writer.** Today the Shed group commits:
- span and height via `applyDimension`, which asks for confirmation before wiping options (`QuoteDetailsPanel.tsx:1288`);
- length via `applyBays`, which reconciles bays (`:1310`).

The old panel's `setParam` wrote straight through `applyPartial`, skipping both. The popover must use the same writer, or the "one record" promise only holds for the stored value and not for its side effects.

**Packages:** apps consume them from `dist`. If a change touches `@sq/ui`, rebuild it.

---

## 3. Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | **PIN on Site address + Building parameters popover**; Design is the only home of the values | Matches v1 and removes the duplication. Costs one new component (the popover/sheet) and some e2e edits. | **Chosen** |
| B | Put the SiteCheck block right next to the Shed group | Fields sit close to the Shed values, but the flow differs from v1 (v1 triggers from the address) and the six values are still duplicated. | Rejected |
| C | Keep the section, just make it shorter | Least work, but keeps two copies of the six values and a flow far from the address. Does not fix what the operator raised. | Rejected |

The operator agreed with A ("ok, this approach makes sense; in v1 those values are read-only").

---

## 4. The design, as agreed

### 4.1 Site address group: PIN button + status line

```
Site address
[ 12 Example St ......................... ] [📍 PIN]
● Certified · Ref SC-1234 · Open ShedSafe ↗
```

**PIN button**
- Attached to the end of the `site-address` input. It replaces nothing: "Copy from customer" stays where it is.
- Hidden when `configured === false`.
- **Disabled** while `missingForPin` has fields missing (first name, last name, email, site address, suburb). The tooltip / `title` lists the missing fields in a single line.
- The salesman gate does **not** disable PIN. PIN still opens, and the popover shows why GO TO SHEDSAFE is blocked. This matches v1, where the flyout opens and only the GO button is gated.
- No write permission (`canWrite === false`): PIN still opens the popover to view, but the fields and buttons are disabled.

**Status line** (one line, small text, coloured dot/pill). It replaces the whole old section:

| State | Wording (shown in English, as in the UI) |
|---|---|
| no check | `Not pinned` |
| pinned, `calculated` false | `Pinned · waiting for Auto Calc` (+ `checking…` while `watching`) |
| calculated, no drift | `Certified · Ref {reference}` |
| calculated, drift | `Certified for different dimensions · pin again` (warning colour) |
| calculated, `ratingUnverified` | `Certified · dimensions not recorded` (warning colour) |
| `lastError` / `waitingError` | a short error, e.g. `ShedSafe didn't respond · try again` |

An "Open ShedSafe ↗" link appears when `siteLink` exists. Clicking the status line opens the popover.

### 4.2 The "Building parameters" popover (mobile: bottom sheet)

```
┌ Building parameters ──────────────── ✕ ┐
│ Importance level   [ 2            ▾ ]  │
│ Span / width       [ 6000     ] mm     │
│ Height             [ 2700     ] mm     │
│ Overall length     [ 9000     ] mm     │
│ Roof pitch         [ 11°          ▾ ]  │
│ Avg. height          3 090 mm  (read)  │
│ Salesperson  sales@…  ✓ registered     │
│ [        GO TO SHEDSAFE        ]       │
│ ─ after pinning ─                       │
│ 1 Open ShedSafe  2 Check the address    │
│ 3 Press Auto Calc  4 Come back here     │
│ Checking every 10s… · Stop watching     │
│ [ Get SiteCheck report ]  Open again ↗  │
└─────────────────────────────────────────┘
```

**Fields**
- The five fields write into the same `useShedStore` config:
  - span and height through the Shed group's `applyDimension`;
  - length through its `applyBays`;
  - importance and pitch through `applyPartial`, as today.

  See §2 for why. Ids:
  - `sitecheck-params-importanceLevel`
  - `sitecheck-params-spanMm`
  - `sitecheck-params-heightMm`
  - `sitecheck-params-lengthMm`
  - `sitecheck-params-roofPitchDeg`
  - `sitecheck-params-averageHeight`
- These are the ids the e2e tests already use; keep them where possible.
- Pitch options come from `roofPitchHints` (same as today). Avg. height = `averageHeightMm` from `@sq/core/domain`.
- Span, height and length use the existing `DimensionField` (commit on blur/Enter). Part 4 changes its behaviour and the popover inherits that.

**Salesperson**
- Element `sitecheck-salesman`, state `sitecheck-salesman-state`, same logic as today.
- If `notASalesman`: one short line saying why, and GO TO SHEDSAFE is disabled.

**GO TO SHEDSAFE**
- Enabled only when `blockedBy === null`, i.e. no missing fields, all params present and above the floor, and a valid salesman.
- If disabled: one line under the button naming the first reason, not the whole list.
- Label:
  - `GO TO SHEDSAFE` when there is no check yet;
  - `Pin again & open ShedSafe` when there is a check and drift.
  - With a check but no drift, also `Pin again & open ShedSafe` (agent's call: pressing it re-pins).
- Action: pin (API unchanged), then `window.open(siteLink, '_blank', 'noopener')`.

**After pinning**
- Short four-step instructions (one line each).
- Watching state with `Stop watching`.
- Button `Get SiteCheck report` (import → `onImported`).
- `Open again ↗` link.
- Once `calculated`: a short summary line (`Certified · Ref …`) plus "values are in the Design group" (a scroll link to Design).

**Open/close behaviour**
- Opened by the PIN button or by clicking the status line.
- **Does not close on an outside click** and does not close on tab blur/focus. The user switches to the ShedSafe tab and back, and the popover must still be there.
- Closes on ✕ or Escape.
- No backdrop on desktop. On mobile, the bottom sheet uses a backdrop for visual focus, but tapping the backdrop does **not** close it (an exception to `ControlSheet`). Closing is via ✕ only, for the same reason.
- `role="dialog"`, `aria-labelledby` = the title. Focus moves to the first field when it opens and returns to the PIN button when it closes.
- Position on desktop: anchored under the PIN button, aligned right, `max-w` about 360px, collision-flips if it would overflow the viewport. Mobile (`< lg`): bottom sheet.

### 4.3 Design group: the only home of the certified values

```
Design                          From ShedSafe  ● Certified   [↻ Get again]
 Importance level   2            Wind region        A
 Terrain category   2.5          Building class     10
 Ground snow load   —            Design wind speed  41.5 m/s
 ▸ More parameters  (12 of 15 from the rating)
 ⚠ Differs from the certified dimensions: span 6000 → 7000. Pin again at Site address.
```

**Header**
- Show "From ShedSafe" and a status pill only when `configured`.
- A small `↻ Get again` button (re-import) appears when there is a check.

**The six values**
- Rendered with the existing `DesignValue`, keeping ids `design-*`.
- Laid out in two compact columns. Each value is in one of three states:
  - certified;
  - provisional (muted);
  - `—`.
- The existing fieldset "From the site check" and its long legend are removed; the header says it instead.

**"More parameters"**
- Merges the two lists into **one**. Checked against the code: the eight site readings in `SiteCheckPanel.tsx:846-890` are exactly the seven `geoRows` in `QuoteDetailsPanel.tsx:751` **plus "Rainfall town"**. The seven are:
  - Shielding
  - Topographic factor
  - Snow load region
  - Earthquake hazard factor
  - Elevation
  - Location
  - Rainfall 100y/20y
- Result: eight rows. Keep the existing `design-*` ids and add `design-rainfallTown`. Format as `geoRows` does (desktop format: `lat, lng`, `100y/20y`).
- One difference to keep: `geoRows` reads only `check.site` (certified values), while the SiteCheck list also shows **provisional** values before Auto Calc. The merged list shows both, with provisional values muted the way `DesignValue` does it, so the user still sees the interim data after pinning.
- The counter "N of 8 from the rating" counts only certified values.
- Drop the long explanatory paragraph; keep at most one short line.

**Drift warning**
- The full version lives here, listing every changed dimension (old → new).
- `ratingUnverified` gets one line too.

**ShedSafe not configured**
- No header pill and no "Get again". The six values stay read-only (today's behaviour).

### 4.4 Shed group: one-line drift warning

Under each dimension that drifts (span, height, length), add a single line in the hint/warning slot. Importance level has no field in the Shed group (checked: `QuoteDetailsPanel.tsx` edits it nowhere outside SiteCheck), so its drift shows only in Design and the status line:

`⚠ Differs from the certified dimensions (6000 → 7000). Pin again at Site address.`

- No separate box and no pill.
- "Site address" is a link that scrolls to and focuses the PIN button.

### 4.5 Removed

- `<Group title="ShedSafe site check">` and its `siteCheck` slot in `QuoteDetailsPanel`.
- The six-value `dl` in `SiteCheckPanel`.
- The disclaimers and the "Set the building to rate / Review the rated building" button. The popover takes over.
- `SiteCheckPanel.tsx` is **split up**, not deleted outright:
  - the pin/import/watch logic goes into the popover component;
  - display-only pieces (the reading rows) go to Design.

---

## 5. Prefactor (before 4.x)

`QuoteDetailsPanel.tsx` is 2539 lines.

**Before the SiteCheck change**, split it into per-group files with **no behaviour change**:
- Customer
- Site address
- Delivery
- Design
- Shed
- Colours
- plus the shared helpers `Group`, `SelectField` and `DesignValue`

Check the split with `pnpm --filter @sq/client-app typecheck` plus the e2e `stepOne.spec.ts` suite, which should still pass in full, before touching any behaviour.

File names and the folder (e.g. `components/editor/details/*`) are left to the builder.

---

## 6. Tests

Per the project rules, tests are opt-in, so this spec does not require new tests.

These specs in `e2e/stepOne.spec.ts` describe the old layout and **will fail**. They need updating once the operator turns tests on:

| Line | Test | Expected change |
|---|---|---|
| 99 | the building panel and the Shed group are one record | open the popover via PIN instead of the section |
| 213 | Show more parameters lists the seven geographic readings | becomes "More parameters", eight rows (adds Rainfall town) |
| 267 | the site check sits between Delivery and Design | replace with: PIN sits in Site address, no section |
| 300 | the six certified values are read-only | still holds; the selector changes if the fieldset is removed |
| 878 | the PIN button opens the building panel… | opens the popover |
| 934 | refuses a number below the floor | inside the popover |
| 951 | shows the quote's own dimensions… | inside the popover |
| 979 | the gate opens once the panel is complete… | GO TO SHEDSAFE inside the popover |
| 1091, 1117 | salesman gate | inside the popover |

Self-verification without tests:
- typecheck;
- `pnpm dev`;
- run through by hand on `/quotes/new`:
  - PIN disabled → fill in the customer → PIN opens;
  - the five fields are in sync with Shed;
  - GO TO SHEDSAFE gate;
  - switch tabs and come back, and the popover is still open;
  - Get report → Design fills in;
  - change a span → drift warning appears in Shed and in Design;
  - mobile → bottom sheet.

---

## 7. Left to the builder (agent's calls; the operator can override)

- The name and folder of the popover component and of the files from the split.
- The exact wording of the status lines, kept on one line and in English like the rest of the UI.
- Desktop popover positioning (anchor + collision flip), done by hand without a library.
- The Shed group still reads awnings from the certificate via `useSiteCheck()` (`QuoteDetailsPanel.tsx:1181`). That is unchanged; the code just moves with its file in the split.
- The salesman gate not disabling PIN (§4.1) is the agent's call, following v1, where the flyout always opens.
- How the Shed group's "Site address" link scrolls to and focuses the PIN button.
- Whether the PIN button shows a badge (e.g. a dot) when there is drift. Optional; add it only if it does not crowd the address field.
- Whether `docs/smartquote-quote-editor-reference.md` (the live editor description) needs updating. **It must be updated** in the same change as the code, per CLAUDE.md.
