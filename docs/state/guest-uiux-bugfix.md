# Guest UI/UX bugfix — checkpoint

Plan: `docs/plans/2026-11-24-guest-uiux-bugfix.md`. Uncommitted by design.

## Phase 0 — screenshots (done)

- `packages/viewer3d/src/ShedViewer.tsx`: added a dev-only `QaCamera` that installs
  `window.__sqQaCamera(position, target)` (metres, scene frame). Behind `NODE_ENV` so a production
  build has dead code and no global.
- `scripts/qa-guest-shots.mjs` + `scripts/qa-guest-design.json` (Garage 6×6×3, gable 10°, 2 bays,
  1 roller door front, 1 window left at 2400/900×900, suburban VIC 3350 stub).
- The design is seeded into `localStorage['sq.guest.v1']`; contact details (memory-only, Q2) are typed
  by the script, then Continue — that is also the current gating, which Phase A changes.
- 20 screenshots at 1919×998 and 390×844 in `docs/qa/screens/2026-11-24-guest/before/`.

**Limit:** this session cannot display images, so the geometry was reproduced numerically instead:

| Bug | Measured on the pre-fix code |
|---|---|
| Rafter runs past the wall | `rafter-left` x −315.6 … 3015.6; `rafter-right` 2984.4 … **6315.6** on a 6000 span |
| Downpipe stands off the wall | centre x −230 → **230 mm** from the face, i.e. a 182 mm gap (radius 48) |
| Window frame proud of the wall | frame z −98 … 28 (**98 mm** out), flashings to **−125** |

Next: Phase A (gating).

## Phase A (done) — one gate for ②③

- `store.ts`: `stepLocked` now uses `contactValid` (was `contactStarted`); new `firstStartProblem` +
  `explainStart`; `goTo` returns to ① with the offending field focused instead of silently doing nothing;
  new state `startProblem` so the inline error shows (focus alone cannot blur).
- `StepTabs.tsx`: a locked tab is pressable (it explains), `title="Finish Start first"`, hint uses
  `contactValid`.
- `GuestQuote.tsx`: the header/phone Send goes through `goTo`, focuses the first Design-check item when
  ② opens, and `explainStart` when ① is the blocker.
- Verified by `scripts/_verify-phaseA.mjs` (temporary, deleted): mobile "123" → both tabs locked, press ②
  stays on ① with focus moved email→mobile and the mobile error shown; `?step=send` falls back; breaking
  the email on ① returns to ① with the email error; header Send same; Class 1 House → ③ directly.

## Phase B (done) — mobile format, address ways back

- `SendPanel.tsx`: `formatAuMobile` — the review step prints `+61 412 345 678` for all four spellings.
- `StartPanel.tsx`: the mobile box rewrites itself to `412 345 678` on blur when it normalises.
- `AddressPanel.tsx`: "Search by street address instead" in suburb/manual mode (hidden when Places has
  really failed); "Keep this address" while editing; "Suburb only — no street number or name" on a
  suburb-only pick; `SiteEstimate` moved here, so it follows the chosen address instead of the picker.
- `guest.css`: `.g-address-suburb-only`.

## Phase C (done) — geometry, tests first

- Tests changed first and failed: rafters back in the "nothing proud of the wall" check (rotation-aware),
  new ridge/foot test, downpipe stand-off/offset/shoe + carport-to-column tests, window flushness test.
- `structure3d.ts`: gable rafters from the column face to the ridge (no eave overhang); skillion rafter
  between cladding faces; downpipe at radius+10 off the face (column face for carports), body to y = 0,
  plus `downpipe-offset-*` and `downpipe-shoe-*`.
- `openings3d.ts`: window frame 60 mm deep, outer face −25; glass −10; flashings 60 deep, outer −45.
- `pnpm --filter @sq/core test` 1168 passed; core typecheck clean; `pnpm build:inc` run.
- After-shots in `docs/qa/screens/2026-11-24-guest/after/` + README with before/after table.

Next: Phase D.

## Phase D (done) — tick, wind box, Send state

- `StepTabs.tsx`: `complete()` takes `locked` first; Start needs `site` + valid contact.
- `store.ts`: `setSite(undefined)` clears `estimate`.
- `SiteEstimate.tsx`: one indicative sentence, `10a` as `<abbr>` plus a spelled-out line, no
  "confirmed in your quote" when there is no region letter.
- `SendPanel.tsx`: `aria-disabled` + dimmed class + `#g-send-reason` above the button; still submits.
- Verified (`scripts/_verify-phaseD.mjs`, deleted): no ticks after reload with an empty ①; Start ticks
  once ① is valid; wind box follows the chosen address and hides while changing; no consent → dim,
  reason shown, press sends 0 requests and shows the consent error; ticking restores the button.

## Phase E (done except E4/E5/E9)

E1 required marks + legend; E2 full string as `title` (was already there); E3 carport preset bay is a
`note` with neutral wording (custom wide bay still `review`); E6 `aria-pressed` = roof hidden, fixed
label, titles on the zoom buttons; E7 explicit spaces in the swatch legend; E8 "View on plan" hidden
once undone; E10 source already has the spaced `&mdash;` (deploy is stale); E11 banner copy; E12 the
send hint now promises the reference number and the emailed copy it actually gives.

## Phase F (done) — 390 px

`scripts/_verify-phaseF.mjs` (deleted): no horizontal scroll at any step (`scrollWidth 390`), tools
drawer opens/closes, the AI sheet opens from the dock and a 90 px swipe down closes it, the sticky bar
no longer covers the mobile box (added `.g-main { padding-bottom }` under 768), Send gating works on the
phone bar, and the stubbed send shows `GR-999999`. Screenshots: `docs/qa/screens/2026-11-24-guest/mobile/`.

**Incident:** the first Phase F run stubbed the wrong path (`/guest/requests` instead of
`/guest-requests`) and one **real** request was created (`GR-000038`, test address/e-mail). Nothing was
deleted; see the hand-over report.

## Checks

`@sq/core test` 1169 passed · core/viewer3d/site typecheck clean · `pnpm build` 9/9.

## Vòng 2 (2026-11-24)

### guest e2e — 5/5 pass

- Fixed three spec expectations, not the gate:
  1. the wind copy ("Wind region confirmed in your quote") → the new indicative sentence;
  2. the 3D roof toggle: label is constant now, state is `aria-pressed` (E6);
  3. `getByText(email)` became ambiguous because E12's hint repeats the address → `exact: true`.
- The Send button is `aria-disabled` while consent is unticked (D1), so Playwright refuses to click it;
  the spec uses `click({ force: true })` for the "press it and get the error summary" step. Real users
  can press it; the attribute only tells assistive tech it is not ready.
- **Real requests created by the suite, left in place:** `GR-000039`, `GR-000040` (test addresses).

### Review-focus, round 2

| # | Check | Result |
|---|---|---|
| 1 | Building → break the email → ① with focus | step=start, `active=g-email`, error shown, design `garage` kept |
| 2 | Class 1 House ①→③ | step=send, Building tab `aria-disabled=true` |
| 3 | Places down → no street-search link | `#g-suburb-search` present, `backLink=false` |
| 4 | Skillion | 1 gutter, 5 `rafter-single`, 0 `rafter-left/right`, 2 downpipe bodies |
| 5 | Carport `roof_only` | all four downpipes 58 mm from the **column** face (radius 48 + 10) |

### Small fixes from the round-1 review

- `apps/site/src/app/quote/mobile.ts` now owns `mobileE164` / `nationalMobile` / `formatAuMobile`;
  `store.ts`, `SendPanel`, `StartPanel` import it (three copies before).
- `GuestQuote.send` no longer calls `explainStart` a second time (`goTo` already did).
- `editAt` no longer clears `pendingFocus` when `goTo` refuses — that erased the focus `explainStart`
  had just placed.
- E6: the 3D switches keep their space on the 2D tab (`visibility: hidden`, disabled) so the toolbar
  does not move.

### E4 — not reproducible

Measured `.g-type-desc` of the Class 1 House card at 1919 / 1440 / 1280 / 390: `scrollHeight ===
clientHeight` in all four (48 px), `overflow: visible`, `-webkit-line-clamp: none`, no max-height.

### E5 — code + stub only

- `lib/places.ts` sends `includedRegionCodes: ['au']` (already) **plus** `includedPrimaryTypes:
  ['street_address']` (the v1 replacement for `types=address`).
- Stub returning `secondary: 'Ballarat VIC 3350, Australia'` renders as
  `12 Main RoadBallarat VIC 3350, Australia` — the postcode shows. Real Google still needs
  `scripts/probe-guest-places.mjs`, not run.

### E9 — material + roof edge, measured

`PartMesh.tsx`: sheet metalness 0.5 / roughness 0.42 / env 1.2 plus a navy `EdgesGeometry` outline on
sheet parts (no new colour, no preset change). Numbers in
`docs/qa/screens/2026-11-24-guest/README.md` — roof luminance unchanged, dark-pixel share on roof bands
0 → 0.13–0.40 %, eave band 0.90 → 1.52 %.

### Contact sheets

`docs/qa/screens/2026-11-24-guest/compare/` — 15 images, `index.json` lists the 5 skipped pairs.

## Vòng 3 (2026-11-25)

- **M6** — the stage's wind chip read a fixed "Wind: confirmed in your quote". It now reads the same
  `estimate` as the wind box: `Wind: Region A (indicative)` when there is a letter, `Wind: an estimator
  confirms` when there is none. Verified in the browser both ways (suburb-only pick → the second;
  a street pick stubbed with `windRegion: 'A'` → the first). Stale comments in `SiteEstimate` and
  `AddressPanel` updated to the new wording.
- **E5** — `includedPrimaryTypes` widened to `['street_address', 'premise', 'subpremise']`: a rural lot
  without a number and a unit inside a block are typed `premise`/`subpremise`, and `street_address`
  alone had removed them from the customer's list. `places.test.ts` now asserts both
  `includedRegionCodes` and the exact array. **Not verified against real Google.**
- **PartMesh** — stale comment block (quoting 0.3 / 0.55 / 1.45) removed; the temp `BoxGeometry` is
  disposed straight after `EdgesGeometry` copies it, and the edges geometry is disposed when the size
  changes or the part unmounts (`useEffect` cleanup). viewer3d rebuilt.
- **qa-compare** — the header is two lines now (labels on the first, viewport + diff right-aligned on the
  second), so the percentage no longer sits on the SAU label at 390 px. Contact sheets regenerated:
  15 images, the same 5 pairs skipped.

### Checks

`@sq/core test` 1169 · typecheck core/viewer3d/site/api clean · `places.test.ts` 16/16 · `pnpm build`
9/9 · guest e2e **5/5**.

**Real requests created by the suite this round:** `GR-000042`, `GR-000043` (test addresses, left in
place).

## Vòng 4 (2026-11-25) — bộ ảnh QA

- **`scripts/qa-guest-shots.mjs` `showRoof`**: after E6 the label is always "Hide roof" and the state is
  `aria-pressed` (`true` = hidden). The old function searched for a "Show roof" label that no longer
  exists, so it never clicked and the four eave shots (**roof / noroof**, 1919 and 390) came out swapped.
  It now reads `aria-pressed`, clicks only when the state is not the one asked for, and **throws** if the
  attribute is still wrong afterwards. Re-shot; the script would now fail loudly rather than swap.
- **A real CSS bug found through the empty 2D images**: at 390 px the 2D `.g-stage-view` was **2 px tall**
  (`358×3`, 142 bytes). The phone rule set `height: 300px`, but the base `.g-stage-view` has `flex: 1`
  with a basis of 0, and a flex basis wins over `height` on the main axis — so the plan collapsed.
  Fixed with `flex: 0 0 300px` scoped to `:has(> .g-plan)` (2D only), and `240px` in short landscape, so
  the 3D canvas keeps its `flex: 1` sizing and existing comparisons stay clean.
- `scripts/qa-compare.mjs`: a `BAD_BEFORE` table skips the six pairs whose *before* cannot be evidence
  (four swapped eave shots, two empty 390 px 2D shots) with the reason printed; the 1919 2D pair is still
  skipped as "no intended change". Regenerated: **12 contact sheets**, 8 skipped. Header is two lines, so
  the percentage no longer overlaps the SAU label on 390 px images.
- Numeric self-check (this session cannot view images): 20/20 `after/` PNGs > 5 KB (min 7 442 B); eave
  roof-vs-noroof changed **12.23 %** (1919) and **12.60 %** (390) over the top 45 % band, above the 2 %
  requirement; the 390 2D shot is `358×301` (was `358×3`).

**Only the `after/` folder was re-shot. `before/` is untouched** — which is why six of its files are
unusable and are named above instead of being silently compared.

### Review vòng 4 (2026-11-25)

The eave `before/` shots were **not** swapped. Checked visually: `before/1919-3d-eave-left-roof` has the
roof and a "Hide roof" button, and `-noroof` has none and a "Show roof" button. The pre-E6 page still
changed the label, so the old script worked there. Only the round-3 `after/` shots were swapped, and
round 4 re-shot those. The four eave entries were removed from `BAD_BEFORE`, and the contact sheets
regenerated: **16 images**, 4 pairs skipped (2D ×2 at 1919 for no intended change, and 2D ×2 at 390
because the `before` is empty). Eave diffs: 1919 roof 2.32 % / noroof 1.49 %, 390 roof 3.27 % /
noroof 1.75 %.

## Vòng 5 (2026-11-25) — ba góp ý UI của khách

### 1. Wind box dưới địa chỉ

`AddressPanel`'s chosen branch now carries `g-address-stack`, which collapses the 1024-up two-column grid to
one column for that branch only; the search branch keeps its grid. Measured at 1919 and 1280:
`wind.top 374 > address.bottom 362`, `|wind.left − address.left| = 0`, both 880 px wide. The box still
follows the chosen address and still disappears while Change is open.

### 2a. The card starts closed

`panels.ts` `defaultsFor` returns `leftOpen: false` at every breakpoint (assistant closed too); the doc
comment says so. `GuestQuote` no longer focuses `.g-check-btn` on ② — the chip is the target
(`.g-check-chip-review`), so focus lands only when there is something to check.

### 2b. One group, as tabs

- `ControlAccordion` renders three `role="tabpanel"` divs (`data-group=…`), `hidden` on the two not
  selected — kept in the DOM so `focusSelector` can find a control on a tab that is not showing.
- `ToolsRail` is the tab strip from 1024 up: `role="tablist"`, `role="tab"` per icon, `aria-selected`,
  `aria-controls`, arrow/Home/End keys, and a press on the active tab closes the card.
- A phone hides the rail; the drawer head carries the same three tabs as words (`g-grouptab-*`) driving
  the same store field.
- A group with validation problems gets an orange dot and the count in its accessible name
  ("Size and structure — 1 problem"); the same dot is on the phone's word tabs.
- `store.focusSelector` now finds the target's `[data-group]`, calls `openTools(group)`, and focuses after
  the render (60 ms), so the chip, "View on plan", the assistant and the Edit links all work.
- Dead `.g-accordion/.g-group*` CSS removed.

### 2c. Design check is a chip on the stage

`DesignCheck` was removed from the card. `DesignCheckChip` sits in `.g-stage-chips`: `N to check`
(warning tint), `N notes` or `Nothing to flag`; reviews first, notes second, `ok` hidden; the footer keeps
"Rules, not a guess…". Desktop/tablet gets a popover anchored to the chip (aria-expanded/controls, Esc,
outside click, focus back to the chip); a phone gets a full-width row under the chips. Pressing a finding
closes the list and calls `focusSelector`, which opens the right group.

### Checks

7-step script at 1919 / 1280 / 1024 / 390 (deleted after the run):

| Step | Result |
|---|---|
| 1 | ② opens with the card **closed**, rail visible, assistant closed; 1024 the same (tablet) |
| 2 | Size tab: the only visible panel is `g-group-size` |
| 3 | Doors tab: only `g-group-doors`, title "Doors & windows" (phone too) |
| 4 | Doors again → `data-left="closed"` |
| 5 | Skillion 5° → chip "1 to check"; Size selected; pressing the finding opens the card on Size and focuses the checked 5° radio (`g-pitch-_r_5_`, checked) |
| 6 | Wind box below the address at 1919 and 1280 (numbers above) |
| 7 | 390: `scrollWidth 390`, drawer word tabs Size/Colours/Doors, the check list opens as a row (`sheet: true`, `popover: false`) |

`pnpm --filter @sq/site-app typecheck` clean · `pnpm build` 9/9 · guest e2e **5/5**.

Spec changes: `openGroup()` clicks a rail tab (or the drawer's word tab on a phone) instead of a
`<summary>`; `design()` now opens the Size tab at every width (the card starts closed); the
"assistant unavailable" test opens Size before checking `#g-span`, because the card is closed by default.

**Real requests created by the suite this round:** `GR-000044`, `GR-000045`.

## Vòng 5b (2026-11-25) — review vòng 5

### 1. Popover Design check bị cắt (desktop/tablet) — fixed

The popover is `.g-check-pop` inside a `position: relative` chip at the **bottom** strip of the stage, so
`top: calc(100% + 8px)` opened it downwards out of the clipped workspace. Now: `bottom: calc(100% + 8px)`,
`z-index: 40` (canvas is 0, floating cards 1), and `DesignCheckChip` measures before paint
(`useLayoutEffect`, re-run on resize):

- `maxHeight` = chip top − stage top − 8, so on 1024×600 and 1280×720 it scrolls inside instead of
  crossing the stage edge;
- `left` = the chip's left clamped into the stage, because opening the card moves the chip row.

Measured (chip → popover, all four sizes): popover inside the stage, `elementFromPoint` at its centre
returns the popover, every item's centre hits its own row.

### 2. Phone list row under the send bar — fixed

The row was below the fixed summary bar. Two reasons: `scrollIntoView` used `block: 'nearest'` (a row that
is technically in the viewport never moves even when the bar covers it), and the `scroll-margin-bottom`
sat on the wrapper `li` while the scroll target is the inner `div`. Now `block: 'end'`, and both elements
reserve the bar's height. The floating AI dock is hidden while the row is open (`:has(.g-check-sheet)`), so
it cannot sit on a finding.

Measured at 390: row 592…764, bar top 780 → **above the bar**; item centre hit-tests to itself; no
horizontal scroll. Reduced motion gets `behavior: 'auto'` instead of smooth.

### 3. Chip label "1 notes" — fixed

One string now feeds both the visible label and the accessible name: `N to check` (unchanged by number),
`1 note` / `2 notes`, `Nothing to flag`. Measured in the page: "1 note", "2 notes", "1 to check".

### 4. The two unverified items — now measured

- **Keyboard.** Rail (1919): ↓ selects Colours then Doors, ↑ back to Colours, Home → Size, End → Doors;
  `aria-selected` and `tabIndex` follow (selected `0`, others `−1`). Drawer (390): →/← move, Home/End jump —
  `Home`/`End` were **missing** from the drawer handler and have been added.
- **Contrast** (text and icon share `currentColor`, so one number; border vs surface in brackets):
  `ok` 5.95 (5.95), `note` 13.02 (13.02), `review` 15.19 (1.75 border, but text carries the meaning and the
  dot/word rule is untouched); focus ring vs chip surface 13.02 / 13.02 / 11.94. All above the 4.5 text and
  3 focus requirements.

### 5. Wind box at 390 — measured

`wind.top 366 > address.bottom 354`, `|wind.left − address.left| = 0`, no horizontal scroll.

### Checks

`@sq/site-app typecheck` clean · `pnpm build` 9/9 · guest e2e **5/5** (one desktop test now asserts the
popover `toBeInViewport()`).

**Real requests created by the suite this round:** `GR-000046`.

## Vòng 5c (2026-11-25) — the AI dock stood on the popover

**Option A**, and why: the dock is a floating shortcut over the stage's bottom-right corner, which is
exactly where the list reaches. Clamping the list away from it (option B) costs 248 px of the 380–420 px
width on a 1024 screen — about 130 px, under the 300 px the prompt calls the minimum — so hiding the dock
while the list is open is the only one that keeps the list readable.

`guest.css`: `.g-design:has(.g-check-pop) .g-ai-dock { visibility: hidden; }` — `visibility`, not
`display: none`, because the dock is fixed and nothing reflows; either way it leaves the tab order and the
accessibility tree, and Esc brings it back.

Verification (5 points per finding and per footer line — four inset corners plus the centre — across 4
viewports and 3 panel states):

| | |
|---|---|
| probes | **180** |
| hits inside the popover | **180** (0 missed) |
| dock before opening | `visible` |
| dock while open | `visibility: hidden`, `display: flex` |
| dock after Esc | `visible` |

Viewports: 1919×998, 1280×900, 1280×720, 1024×600. States: dock with suggestions (card closed), left card
open, left card closed — all three give the same result.

`@sq/site-app typecheck` clean · `pnpm build` 9/9 · guest e2e **5/5**.

**Real requests created by the suite this round:** `GR-000047`, `GR-000048`.
