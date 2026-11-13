# SiteCheck PIN (v1 parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "ShedSafe site check" section on Step 1 with a PIN button on Site address that opens a "Building parameters" popover. Design becomes the only home of the certified values.

**Architecture:**
- First, split `QuoteDetailsPanel.tsx` (2539 lines) into per-group files, with no behaviour change.
- Then move all SiteCheck logic (gates, pin, import, drift, popover open state) out of `SiteCheckPanel.tsx` into a context provider, `SiteCheckActionsProvider`. Its consumers are the PIN button, the popover, the Design group and the Shed group.
- `siteCheckState.tsx` (the check fetch and polling) stays unchanged.

**Tech Stack:** Next.js 16 / React 19, zustand (`useShedStore`, `useDraftStore`), Tailwind tokens from `@sq/ui`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-13-sitecheck-pin-design.md` (read it with this plan; the §-numbers below refer to it).

## Global Constraints

- **Process (project rules, these override the skill defaults):**
  - Tests are opt-in and currently OFF, so do not create test files.
  - Every task self-verifies with typecheck and a manual run.
  - **Do not commit**; leave the changes in the working tree. Never push.
- **No change** to the API, `siteCheckState.tsx`, `@sq/core` or `@sq/contracts`. Pin and import paths stay exactly as they are (spec §2).
- **No new npm dependency.** The popover is hand-built on the `SelectionPopover.tsx` / `ControlSheet.tsx` patterns.
- **UI copy is English** and each status message fits on one line.
- **Use `http://localhost:3061`, never `127.0.0.1`** (the page will not hydrate).
- **Typecheck:** `pnpm --filter @sq/client-app typecheck`. Expected: exits 0 with no output.
- **E2E (existing suite only):**
  - Start `pnpm dev` first, then run `pnpm test:e2e e2e/stepOne.spec.ts`.
  - Run it once **before Task 1** and record the pass/fail list in `docs/state/sitecheck-pin.md`. That is the baseline.
- **Keep these existing DOM ids:**
  - `site-address`
  - `sitecheck-params-importanceLevel`, `-spanMm`, `-heightMm`, `-lengthMm`, `-roofPitchDeg`, `-averageHeight`
  - `sitecheck-salesman`, `sitecheck-salesman-state`
  - `design-importanceLevel`, `design-windRegion`, `design-terrainCategory`, `design-buildingClass`, `design-snowLoad`, `design-windSpeed`
  - `design-shielding`, `design-topographicFactor`, `design-snowLoadRegion`, `design-earthquakeHazardFactor`, `design-elevation`, `design-location`, `design-rainfall`
  - `shed-span`, `shed-height`, `shed-length`
- **New ids:** `design-rainfallTown`, `sitecheck-pin`, `sitecheck-status`, `sitecheck-go`, `sitecheck-import`, `design-sitecheck-refetch`.
- **Do not touch:**
  - `Backup/` folders;
  - `apps/db/migrations/008_*`;
  - `.env`, `data/`, `docs/note.md`.

## Review Focus

Things the spec implies but no automated test covers. Each line has a manual check in the task that owns it:

1. **Popover open + edit in the Shed group.** Changing span in Shed while the popover is open updates the popover immediately, and the reverse also holds. If a change would wipe options and the user cancels the confirm, both places keep the old value. *(Task 4, Step 5)*
2. **The browser blocks the ShedSafe tab after a successful pin.** The popover stays open, and a one-line message plus the "Open again ↗" link are visible. *(Task 4, Step 5)*
3. **Switching tabs, clicking outside or scrolling the page does not close the popover.** Escape and ✕ do close it, and focus returns to `#sitecheck-pin`. *(Task 4, Step 5)*
4. **Drift on importance level alone** (not a Shed field):
   - the status line shows the drift state;
   - Design lists "importance level 2 → 3";
   - the Shed group shows nothing.

   *(Task 6, Step 3)*
5. **A saved quote vs a new quote.** Pinning on `/quotes/new` calls `setSiteCheckId` and uses `site-checks/pin`. Pinning on a saved quote uses `quotes/{id}/site-check/pin`. Check this in the browser Network tab. *(Task 4, Step 5)*

---

### Task 1: Split `QuoteDetailsPanel.tsx` per group (prefactor, no behaviour change)

**Files:**
- Create the folder `apps/client/src/components/editor/details/` with:
  - `shared.tsx`: move `Group` (line 65), `DesignValue` (2387), `Switch` (2433) and `SelectField` (2456) here, plus `outOfBookMessage` (2367).
  - `constants.ts`: `STRUCTURE_TYPES` (676), `STATES` (703), `IMPORTANCE` (713), `COLOUR_LABELS` (2005). Delete `WIND_REGIONS` (690) and `TERRAIN` (697); nothing uses them.
  - `useShedDimensions.ts`: see Interfaces.
  - `CustomerGroup.tsx`: lines 240-467.
  - `SiteGroup.tsx`: lines 469-531.
  - `DeliveryGroup.tsx`: lines 533-642, together with `chooseDeliveryScope` (207-227).
  - `DesignGroup.tsx`: line 720 onwards.
  - `ShedGroup.tsx`: line 1151 onwards.
  - `ColourGroup.tsx`: line 2018 onwards.
  - `snapBmt`, `bmtOptions`, `useShedStoreConfig` and `useApplyBuilding` go into the file that uses them, or into `shared.tsx` if more than one file does.
- Modify `apps/client/src/components/editor/QuoteDetailsPanel.tsx`:
  - It keeps only `QuoteDetailsPanelProps`, the `QuoteDetailsPanel` composer and the `placesConfigured` state.
  - Pass `placesConfigured` / `setPlacesConfigured` to `CustomerGroup` and `SiteGroup` as props.
  - Add `export { Group } from './details/shared'`, because `SiteCheckPanel.tsx:26` imports `Group` from here until Task 4.

**Interfaces:**
- Produces, in `details/useShedDimensions.ts`:
  ```ts
  export interface ShedDimensions {
    spanBounds: { min: number; max: number };   // catalogue.dimensions.span || {1800, 15000}
    heightBounds: { min: number; max: number }; // catalogue.dimensions.height || {2200, 6000}
    lengthBounds: { min: number; max: number }; // {2000, 120000}
    commitSpan(mm: number): void;    // = applyDimension({ span: mm })
    commitHeight(mm: number): void;  // = applyDimension({ height: mm })
    commitLength(mm: number): void;  // = applyBays({ length: mm, bays: config.bays, nomBaySpacing: 0 })
    applyDimension(patch: Partial<ShedConfig>): void; // body moved verbatim from line 1288
    applyBays(input: { length: number; bays: number; nomBaySpacing: number }): void; // from 1310
  }
  export function useShedDimensions(catalogue: Catalogue | null | undefined): ShedDimensions;
  ```
  - `ShedGroup` uses it instead of its own `spanBounds`, `heightBounds`, `applyDimension` and `applyBays` (lines 1247-1254, 1288-1318) and the `2000`/`120000` literals at 1600-1601.
  - The `onCommit` handlers at 1448, 1466 and 1604 become `commitSpan`, `commitHeight` and `commitLength`.
- Produces `shared.tsx` exports: `Group`, `DesignValue`, `Switch`, `SelectField`, `outOfBookMessage`. Their signatures do not change.

- [ ] **Step 1: Record the baseline.** Run typecheck and `pnpm test:e2e e2e/stepOne.spec.ts`. Write the pass/fail list to `docs/state/sitecheck-pin.md`.
- [ ] **Step 2: Move the code.** Cut and paste the code into the files above. The only edits allowed are imports and exports, plus the `useShedDimensions` extraction. Keep the comments with the code they describe.
- [ ] **Step 3: Typecheck.** Expected: exit 0.
- [ ] **Step 4: Run the e2e suite again.** Expected: **the same** pass/fail list as the baseline.
- [ ] **Step 5: Check the line count.** Run `wc -l apps/client/src/components/editor/QuoteDetailsPanel.tsx`. Expected: under 250.

---

### Task 2: Pure gate and drift functions

**Files:**
- Create `apps/client/src/components/editor/siteCheckGates.ts`. It must not import React and must not import any store.

**Interfaces (Produces):**
```ts
import type { ShedConfig } from '@sq/core/domain';
import type { SiteCheck } from './siteCheckState';

type Client = { firstName: string; lastName: string; email: string };
type Site = { address: string; suburb: string; state: string; postcode: string };

export function missingForPin(client: Client, site: Site, salesman: string): string[];
//   same order and labels as SiteCheckPanel.tsx:221-230
export function missingParams(config: ShedConfig): string[];
//   SiteCheckPanel.tsx:241-248; pitch counts as missing when roofPitchDeg <= 0
export function paramsBelowFloor(config: ShedConfig): string[];
//   SiteCheckPanel.tsx:251-258 (< 100 mm)
export type BlockedBy = 'salesman' | 'fields' | 'params' | null;
export function blockedBy(a: {
  notASalesman: boolean; missingForPin: string[]; missingParams: string[]; paramsBelowFloor: string[];
}): BlockedBy;
//   same precedence as SiteCheckPanel.tsx:305-311

export type DriftField = 'span' | 'height' | 'length' | 'importanceLevel';
export interface DriftEntry { field: DriftField; from: number; to: number | null }
export function driftOf(check: SiteCheck | null, config: ShedConfig): DriftEntry[];
//   only when check.calculated && check.pinnedFor !== null; same comparisons as :494-515
export function driftText(entry: DriftEntry): string;
//   'span 6000 → 7000 mm' | 'wall height 2700 → not entered' | 'length …' | 'importance level 2 → 3'
//   exactly the strings :502-513 build today
export function isRatingUnverified(check: SiteCheck | null): boolean;
//   check.calculated && pinnedFor === null

export type StatusTone = 'neutral' | 'attention' | 'ok' | 'danger';
export function siteCheckStatus(a: {
  check: SiteCheck | null; drift: DriftEntry[]; unverified: boolean;
  watching: boolean; waitingError: string | null;
}): { tone: StatusTone; label: string };
```

`siteCheckStatus` labels, checked in this order (spec §4.1):

| Condition | Label | Tone |
|---|---|---|
| `waitingError` set, or `check.status === 'failed'` | `ShedSafe didn't respond · try again` | danger |
| no check | `Not pinned` | neutral |
| not calculated | `Pinned · waiting for Auto Calc` + ` · checking…` while watching | attention |
| drift | `Certified for different dimensions · pin again` | danger |
| unverified | `Certified · dimensions not recorded` | attention |
| otherwise | `Certified · Ref {reference}` | ok |

- [ ] **Step 1: Write the module** to the signatures above. Each body is the matching code lifted from `SiteCheckPanel.tsx`, with `params.*` replaced by `config.*`.
- [ ] **Step 2: Typecheck.** Expected: exit 0.
- [ ] **(tests=on only)** Add `__tests__/siteCheckGates.test.ts` covering:
  - `blockedBy` precedence: salesman beats fields, and fields beats params;
  - `driftOf` returns `[]` when `pinnedFor` is null;
  - `driftOf` reports `to: null` when span is cleared;
  - every row of the `siteCheckStatus` table.

---

### Task 3: `SiteCheckActionsProvider` (move the logic; the UI does not change yet)

**Files:**
- Create `apps/client/src/components/editor/siteCheckActions.tsx`.
- Modify `apps/client/src/components/editor/SiteCheckPanel.tsx`. It now reads everything from `useSiteCheckActions()`. Delete its local `missingForPin`, `missingParams`, `paramsBelowFloor`, `notASalesman`, `blockedBy`, `pin`, `importRating`, `drift`, `ratingUnverified`, `busy`, `message` and `paramsOpen`.
- Modify `apps/client/src/components/editor/QuoteEditor.tsx` (lines 785-886). Wrap `QuoteDetailsPanel` in `<SiteCheckActionsProvider>` **inside** `<SiteCheckProvider>`. It receives the props that `SiteCheckPanel` receives today (`quoteId`, `site`, `client`, `roofPitchHints`, `defaultSalesman`, `canWrite`, `onImported`), computed the same way. `<SiteCheckPanel />` then takes no props.

**Interfaces:**
- Consumes:
  - `useSiteCheck()` and `useShedSafeIdentity()` from `siteCheckState.tsx`;
  - everything from Task 2;
  - `useShedStore`, `useDraftStore`;
  - `averageHeightMm` from `@sq/core/domain`.
- Produces:
  ```ts
  export interface SiteCheckActionsProps {          // = today's SiteCheckPanelProps
    quoteId: string | null; site: Site; client: Client; roofPitchHints: number[];
    defaultSalesman: string; canWrite: boolean; onImported?: (values: SiteCheckValues) => void;
    children: React.ReactNode;
  }
  export interface SiteCheckActions {
    configured: boolean; canWrite: boolean; check: SiteCheck | null; state: SiteCheckState;
    watching: boolean; stopWatching(): void; waitingError: string | null;
    salesman: string; identity: ShedSafeIdentityValue; notASalesman: boolean;
    missingForPin: string[]; missingParams: string[]; paramsBelowFloor: string[]; blockedBy: BlockedBy;
    drift: DriftEntry[]; unverified: boolean; status: { tone: StatusTone; label: string };
    averageHeight: number | null;                    // logic from SiteCheckPanel.tsx:267-275
    roofPitchHints: number[];
    busy: 'pinning' | 'importing' | null;
    message: { tone: 'ok' | 'danger'; text: string } | null;
    pin(): Promise<void>;          // body moved from :313-437; setParamsOpen(true) → openPopover()
    importRating(): Promise<void>; // body moved from :439-472
    popoverOpen: boolean; openPopover(): void; closePopover(): void;
    pinButtonRef: React.RefObject<HTMLButtonElement | null>;
    focusPin(): void;              // scrollIntoView({block:'center'}) + focus() on pinButtonRef
  }
  export function SiteCheckActionsProvider(props: SiteCheckActionsProps): JSX.Element;
  export function useSiteCheckActions(): SiteCheckActions; // throws outside the provider, like useSiteCheck
  ```
- Shorten the `pin()` messages to one line each. Use these exact strings:
  - not a salesman: `${salesman} isn't a ShedSafe salesman. Ask an admin to add this email.`
  - fields missing: `Needs ${list} first.` where `list` is joined with `, ` and ` and `
  - below the floor: `Dimensions must be at least 100 mm and pitch above 0.`
  - params missing: `Fill in ${missingParams.join(', ')}.`
  - pinned, tab opened: `Pinned — ShedSafe opened in a new tab. Run Auto Calc there, then come back.`
  - pinned, popup blocked: `Pinned — your browser blocked the tab. Use “Open again ↗”.`
  - pinned, no link: `Pinned, but ShedSafe sent no link. Pin again.`
  - imported: `Rating imported.`

- [ ] **Step 1: Write `siteCheckActions.tsx`** to the interface above.
- [ ] **Step 2: Rewire `SiteCheckPanel` and `QuoteEditor`** as listed under Files.
- [ ] **Step 3: Typecheck.** Expected: exit 0.
- [ ] **Step 4: Run the e2e suite.** Expected: the baseline list, except tests that assert the old long message texts. Note which ones in `docs/state/sitecheck-pin.md`.

---

### Task 4: PIN button, status line and the "Building parameters" popover; remove the section

**Files:**
- Create `apps/client/src/components/editor/details/SiteCheckPin.tsx`. It renders the PIN button and the status line.
- Create `apps/client/src/components/editor/details/BuildingParamsPopover.tsx`.
- Modify `details/SiteGroup.tsx`:
  - wrap the `site-address` `Field` and the PIN button in one row (`flex items-end gap-sq-2`, PIN `shrink-0`, same height as the input);
  - put the status line under it;
  - render nothing new when `configured === false`.
- Modify `QuoteDetailsPanel.tsx`:
  - delete the `siteCheck` prop and its doc comment (137-155), and the `{siteCheck}` render;
  - pass `unit` to `SiteGroup` (the popover needs it for `DimensionField`).
- Modify `QuoteEditor.tsx`: delete the `siteCheck={<SiteCheckPanel …/>}` prop and the `SiteCheckPanel` import.
- Delete `apps/client/src/components/editor/SiteCheckPanel.tsx`, and the `Group` re-export from `QuoteDetailsPanel.tsx`.

**Interfaces:**
- Consumes:
  - `useSiteCheckActions()` (Task 3);
  - `useShedDimensions(catalogue)` (Task 1);
  - `DimensionField`, `SelectField`, `StatusPill`, `Button` from `@sq/ui`.
- Produces:
  ```ts
  export function SiteCheckPin({ unit }: { unit: DisplayUnit }): JSX.Element | null;
  export function BuildingParamsPopover({ unit }: { unit: DisplayUnit }): JSX.Element | null;
  ```

Behaviour that the spec fixes (spec §4.1, §4.2):

**PIN button `#sitecheck-pin`**
- Label `📍 PIN`, `ref={pinButtonRef}`.
- `disabled` when `missingForPin` (the customer and site fields) is non-empty. `title` = `Needs: ${missingForPin.join(', ')}`.
- Not disabled by the salesman gate.
- When `canWrite === false`, it opens the popover read-only.
- `aria-expanded={popoverOpen}`, `aria-controls="sitecheck-popover"`.

**Status line `#sitecheck-status`**
- A button-styled line containing a coloured dot and `status.label`.
- Clicking it calls `openPopover()`.
- When `check?.siteLink` exists, it also shows an `Open ShedSafe ↗` link (`target="_blank" rel="noopener"`).

**Popover `#sitecheck-popover`**
- `role="dialog"`, `aria-labelledby="sitecheck-params-title"`, title `Building parameters`, ✕ button.
- Escape closes it. There is **no** outside-click, blur or scroll close.
- When it opens, focus `#sitecheck-params-importanceLevel`. When it closes, `pinButtonRef.current?.focus()`.
- **Desktop (`lg+`):** `absolute right-0 top-full mt-sq-1 z-30 w-[360px] max-w-[calc(100vw-2rem)]`, inside a `relative` wrapper around the address row. If `getBoundingClientRect().bottom > innerHeight`, flip it to `bottom-full mb-sq-1`.
- **Mobile (`< lg`):** a `fixed inset-0 z-40 flex flex-col justify-end` layer with a backdrop that does **not** close it, and a sheet (`rounded-t-lg max-h-[85vh] overflow-y-auto`). Same classes as `ControlSheet.tsx:164`.

**Popover fields, in order**

| Field | Id | Control | Writes through |
|---|---|---|---|
| Importance level | `sitecheck-params-importanceLevel` | select over `IMPORTANCE` | `applyPartial({ importanceLevel })` |
| Span / width | `sitecheck-params-spanMm` | `DimensionField`, `spanBounds` | `commitSpan` |
| Height | `sitecheck-params-heightMm` | `DimensionField`, `heightBounds` | `commitHeight` |
| Overall length | `sitecheck-params-lengthMm` | `DimensionField`, `lengthBounds` | `commitLength` |
| Roof pitch | `sitecheck-params-roofPitchDeg` | select over `roofPitchHints` | `applyPartial({ roofPitchDeg })` |
| Avg. height | `sitecheck-params-averageHeight` | `<output>`, `averageHeight` or `—` | read-only |

- Every control is disabled when `!canWrite`.
- The select's options and placeholder copy come from today's markup (`SiteCheckPanel.tsx` around lines 975-1090).

**Salesperson row**
- `#sitecheck-salesman` shows `salesman`; `#sitecheck-salesman-state` shows the state.
- The four states and their wording are the same as `SiteCheckPanel.tsx:1144-1190`, shortened to at most 6 words each.

**GO button `#sitecheck-go`**
- Label: `Pin again & open ShedSafe` when `drift.length > 0 || check !== null`; otherwise `GO TO SHEDSAFE`.
- `disabled={blockedBy !== null || busy !== null || !canWrite}`, `loading={busy === 'pinning'}`, `onClick={pin}`.
- When disabled by `blockedBy`, show one muted line under it with the first reason:
  - `fields` → `Needs ${missingForPin[0]}`
  - `params` → `Fill in ${[...missingParams, ...paramsBelowFloor][0]}`
  - `salesman` → `Your email isn't a ShedSafe salesman`

**Message**
- `message` sits under the button: `role="alert"` for danger, `role="status"` for ok.

**After pinning** (`check !== null && !check.calculated`)
- A 4-item `<ol>`: `Open ShedSafe` · `Check the pinned address` · `Press Auto Calc` · `Come back and get the report`.
- While `watching`: `Checking every 10 s…` and a `Stop watching` ghost button.
- `Get SiteCheck report` button `#sitecheck-import` (`onClick={importRating}`, `loading={busy === 'importing'}`).
- `Open again ↗` link to `check.siteLink`.

**When `check?.calculated`**
- One line: `Certified · Ref ${reference}` + a `See Design` link that scrolls to `#design-importanceLevel`.

**Steps**

- [ ] **Step 1: Build the two components** to the table above.
- [ ] **Step 2: Wire them into `SiteGroup`** and delete the old section, per the Files list.
- [ ] **Step 3: Typecheck.** Expected: exit 0. Then run `rg -n "SiteCheckPanel" apps/client/src`. Expected: no matches.
- [ ] **Step 4: Smoke-check on `/quotes/new`** at `http://localhost:3061/quotes/new`:
  - PIN is disabled with the tooltip listing the five fields.
  - Fill in the customer and site, and PIN opens the popover.
  - There is no "ShedSafe site check" group on the page.
- [ ] **Step 5: Review Focus checks 1, 2, 3 and 5.**
  - **1, one record:** with the popover open, change span in the Shed group and the popover updates. Change length in the popover and the Shed group's bays reconcile. With an option placed, change span in the popover, cancel the confirm, and both places keep the old value.
  - **2, blocked tab:** block popups for localhost and press GO. The popover stays open and the blocked-tab message plus `Open again ↗` show.
  - **3, close rules:** switch to another tab and back, click on the page body, scroll — the popover stays open. Escape closes it and focus lands on `#sitecheck-pin`.
  - **5, API path:** in DevTools Network, a pin on `/quotes/new` posts to `/api/sq/site-checks/pin`. On a saved quote it posts to `/api/sq/quotes/{id}/site-check/pin`.
  - **Mobile:** resize to 375×812. The popover is a bottom sheet, and tapping the backdrop does not close it.

---

### Task 5: Design group as the single home of the certified values

**Files:**
- Modify `details/DesignGroup.tsx` (it was `QuoteDetailsPanel.tsx:720-1150`).
- Modify `details/shared.tsx` (`DesignValue`).

**Interfaces:**
- Consumes `useSiteCheckActions()`: `configured`, `check`, `status`, `drift`, `unverified`, `busy`, `importRating`, `focusPin`.
- Changes `DesignValue`:
  - Add the prop `compact?: boolean`.
  - When `compact`, drop the per-value note line under the output. The state is still conveyed:
    - provisional → `text-sq-attention` border and `title="Provisional — not auto calculated"`;
    - unchecked → dashed border.

  The ids and the three states do not change.

**Group header**
- When `configured`, show the muted text `From ShedSafe`, then `<StatusPill tone label={status.label}>`.
- When `check !== null`, also show a ghost button `#design-sitecheck-refetch` labelled `↻ Get again` (`onClick={importRating}`, `loading={busy === 'importing'}`).
- If `Group` has no header slot, add an optional `aside?: React.ReactNode` prop to `Group` in `shared.tsx`, rendered right of the title.

**Six values**
- Replace the `<fieldset>`/`<legend>` "From the site check…" block (913-929) with a `grid grid-cols-2 gap-sq-2` of the six `DesignValue compact`.
- Delete the `siteState === 'unchecked'` paragraph (990-995). The header pill says it.
- Keep `bookCannotPrice` (982-988), shortened to: `This book has no frame table for importance ${level}; the frame uses one assumed section.`

**"More parameters"**
- Rename the summary from `Show more parameters` to `More parameters`.
- `geoRows` gets an 8th row: `['Rainfall town', …, 'design-rainfallTown']` from `site.rainfallIntensityTown`.
- Each row resolves certified → provisional → `—`, the same way as `siteValue`. When not `calculated`, read `check.provisional[key]` with `numberOf`/`stringOf` from `siteCheckState.tsx`, keyed as in `SiteCheckPanel`'s old rows:
  - `shielding`, `topographicFactor`, `snowLoadRegion`, `earthquakeHazardFactor`, `elevation`;
  - `latitude` + `longitude`;
  - `rainfallIntensity100Years` + `rainfallIntensity20Years`;
  - `rainfallIntensityTown`.
- Provisional values get `text-sq-attention`.
- The counter counts only certified values: `${n} of 8 from the rating`.
- Replace the trailing paragraph (970-972) with: `ShedSafe calculates these; they don't change the price.`

**Drift and unverified**
- Directly under the six values:
  - when `drift.length > 0`: `<p role="status" class="text-sq-micro text-sq-danger">⚠ Differs from the certified dimensions: ${drift.map(driftText).join(', ')}. <button onClick={focusPin}>Pin again at Site address</button>.</p>`
  - when `unverified`: `Certified dimensions weren't recorded — pin again to verify.`

**Steps**

- [ ] **Step 1: Implement** the above.
- [ ] **Step 2: Typecheck.** Expected: exit 0.
- [ ] **Step 3: Smoke-check.**
  - Before a pin: six dashed `—` values and the pill reads `Not pinned`.
  - After a pin, before Auto Calc: muted provisional values in Design and in More parameters.
  - After `Get SiteCheck report`: certified values, `N of 8`, and the pill reads `Certified · Ref …`.
  - With ShedSafe unset in `.env`: no pill, no `Get again`, and the values show `—`.

---

### Task 6: One-line drift warning in the Shed group

**Files:**
- Modify `details/ShedGroup.tsx`, around the `shed-span`, `shed-height` and `shed-length` `DimensionField`s (they were at 1432, 1450 and 1595).

**Interfaces:**
- Consumes `useSiteCheckActions()`: `drift`, `focusPin`.
- Produces a local component:
  ```ts
  function DriftLine({ entry, onPin }: { entry: DriftEntry | undefined; onPin(): void }): JSX.Element | null
  ```
- Under each of the three fields (wrap the field and the line in a `div` inside the grid cell), render:
  ```
  <p class="mt-1 text-sq-micro text-sq-attention">⚠ Differs from the certified dimensions ({from} → {to ?? 'not entered'}). <button class="underline" onClick={onPin}>Pin again at Site address</button>.</p>
  ```
  - Look the entry up with `drift.find(d => d.field === 'span' | 'height' | 'length')`.
  - Importance drift is **not** shown here; it is not a Shed field (Design shows it).

- [ ] **Step 1: Implement** the above.
- [ ] **Step 2: Typecheck.** Expected: exit 0.
- [ ] **Step 3: Review Focus check 4.**
  - On a certified check, change span by 1000 mm. The Shed group shows one line under Span; Design shows the full list; the status line reads `Certified for different dimensions · pin again`.
  - Clicking `Pin again at Site address` scrolls to and focuses `#sitecheck-pin`.
  - Change only the importance level (in the popover). There is no line in Shed, but there is drift in Design and in the status line.

---

### Task 7: Docs, final check, and the e2e handover

**Files:**
- Modify `docs/smartquote-quote-editor-reference.md` (Vietnamese; the live editor description that CLAUDE.md says must change with the code). In the Step 1 / SiteCheck section, describe:
  - PIN on Site address;
  - the five fields in the popover, sharing a record with Shed;
  - Design as the only place the six values and the eight readings appear;
  - where the drift warnings show.
- Modify `docs/state/sitecheck-pin.md`: record what was done and which e2e tests now fail.

- [ ] **Step 1: Update both docs.**
- [ ] **Step 2: Final checks.** Run typecheck (expected exit 0). Then run `pnpm --filter @sq/client-app build`. Expected: `Compiled successfully` (this catches server/client boundary errors that typecheck misses).
- [ ] **Step 3: Run the e2e suite** and compare with the baseline. The expected new failures are exactly the spec §6 tests (lines 99, 213, 267, 300, 878, 934, 951, 979, 1091, 1117). Any other new failure is a regression; fix it before handing over.
- [ ] **(tests=on only)** Update those §6 tests to the new layout:
  - open via `#sitecheck-pin`;
  - assert there is no `ShedSafe site check` heading;
  - expect 8 More-parameters rows including `#design-rainfallTown`.
- [ ] **Step 4: Hand over.** Report the changes as uncommitted, plus the e2e delta.
