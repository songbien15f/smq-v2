# Guest opening placement — one rule for every change (plan)

**Goal:** a door or window on the Guest page is never left in an illegal spot by *any* change — the
assistant's or the guest's — and the assistant can talk about where an opening is.

**Why now:** on 2026-11-20 the assistant's `addOpening` wrote `offset: 0` (flush with the corner post),
the door failed `validateGuestDesign`, was not drawn, and step ② said "needs attention". That was fixed
in `applyGuestOps` (`addOpening`, `moveOpening` now use `nearestLegalGuestOffset`). The same class of
bug is still open on three other paths, listed below.

**Size:** standard. Order: Task 1 → 2 → 3 → 4 (each builds and runs on its own). Task 5 only if the
human turns tests on.

## Ground truth (read, don't re-derive)

| Thing | Where |
|---|---|
| Single write path for assistant ops | `packages/core/src/domain/guestOps.ts` `applyGuestOps` |
| Nearest-legal search (core) | `packages/core/src/domain/guest.ts` `nearestLegalGuestOffset`, `centredGuestOffset`, `GUEST_SNAP_MM` (~line 922–976) |
| Same search, duplicated on the page | `apps/site/src/app/quote/designOps.ts` `nearestLegalOffset` (~line 102) |
| Page's resize (keeps centre) | `designOps.ts` `setOpeningSize` (~line 268) |
| Page's refit after a size change | `designOps.ts` `refitOpenings` (~line 292); called from `components/ControlAccordion.tsx:145,178,245,266,277` |
| Page applies the **server's** resulting design (does not re-run ops) | `apps/site/src/app/quote/assistantStore.ts` → `store.ts` `applyAssistantDesign` |
| Model prompt + per-turn context | `apps/api/src/lib/guestAssistant.ts` (prompt ~line 200–248, `designContext` ~line 257) |
| Saved design load | `apps/site/src/app/quote/store.ts` `hydrate` (~line 302–368) |
| Wall length | `packages/core/src/domain/placement.ts:53` `wallLength` (front/back = span, left/right = length) |
| Opening id scheme used by the checks | `guest-${index + 1}` in both `toOpening` (core `guest.ts:541`) and `asOpening` (page) |

`needsConfirm` (the "Apply / Keep my design" card) is **intended**: the server forces it when ≥ 2
openings are removed (`guestAssistant.ts:511`). Not a bug — do not touch.

## Open gaps this plan closes

1. **`resizeOpening` (assistant) checks only the size chip** (`guestOps.ts:263–280`). "Make the left door
   4.2 m" can push the door past the wall end or onto another opening.
2. **Assistant size changes never move openings.** `setSpan`, `setBayWidth`, `addBay`, `removeBay`,
   `setRoof` in `applyGuestOps` leave offsets as they were. Removing 4 bays from a 30 m Riding Arena
   leaves a left door at 13500 on a 15 m wall. (The page's own controls already call `refitOpenings`;
   the assistant does not.)
3. **Designs saved before the fix** still hold `offset: 0` doors and stay "needs attention" on reload.
4. **The model cannot see where openings are.** `designContext` lists `type, wall, size` but no offset,
   so "move the left door towards the back" or "put the window 2 m from the corner" is a guess.
5. **Duplicated placement logic** between core and page.

## Global constraints

- `@sq/core` stays pure (no React/HTTP/DB). Core is the only place placement is decided.
- Never commit, never push. Leave changes in the working tree.
- Do not change `GUEST_DEFAULT_TYPES` numbers, the 15 m width limit, or `placementRules.ts` rules.
- Apps read `@sq/core` from `dist`: after any core edit run `pnpm build:inc` from the repo root before
  checking the site or API.
- Files: `guestOps.ts`, `store.ts`, `route.ts` are CRLF; `guest.ts`, `designOps.ts` are LF — keep each
  file's line endings.
- Use `localhost`, never `127.0.0.1`. Do not type a street address on the Guest page (it calls Google
  Places); the saved test design already has one.
- Test contact values: Test / Guest / `test.guest+35@example.com` (increment) / `0412 345 678`. The
  mobile box shows `0412 345 678` as a **placeholder** — type it, or step ② stays locked.

---

## Task 1 — Core: resize and refit in one place, used by `applyGuestOps`

**Files:** modify `packages/core/src/domain/guest.ts`, `packages/core/src/domain/guestOps.ts`.

**Add to `guest.ts`** (next to `nearestLegalGuestOffset`; exported, so `index.ts` re-exports them):

```ts
/** Resize opening `index` to `size`, keeping its centre if legal, else the nearest legal spot. */
export function resizeGuestOpening(
  design: GuestDesignInput, type: GuestBuildingTypeSpec, index: number,
  size: { width: number; height: number },
): { ok: true; design: GuestDesignInput } | { ok: false; reason: string };

/**
 * After the building changes size, slide each opening (in order) to the nearest legal spot.
 * Returns the new design and the indexes that fit nowhere on their wall (left where they were,
 * so validateGuestDesign still reports them).
 */
export function refitGuestOpenings(
  design: GuestDesignInput, type: GuestBuildingTypeSpec,
): { design: GuestDesignInput; stuck: number[] };
```

- `resizeGuestOpening`: wanted = `snap(offset + (oldWidth − newWidth) / 2)` with `GUEST_SNAP_MM`
  (exactly what the page's `setOpeningSize` does), then `nearestLegalGuestOffset`. If the shed is
  unusable (`'Fix the building size first.'`) just set the size and keep the offset (ok: true).
- `refitGuestOpenings`: port of the page's `refitOpenings`, plus collecting `stuck`. An opening whose
  `nearestLegalGuestOffset` result is `ok: false` goes into `stuck` unless the reason is
  `'Fix the building size first.'` (then nothing can be judged; return the design unchanged, `stuck: []`).

**Change `applyGuestOps`:**

1. `resizeOpening`: after the size-chip check, call `resizeGuestOpening`. On `ok: false` →
   `fail(index, \`The ${opening.type} cannot be that size on the ${opening.wall} wall: ${reason}\`)` and
   do not count it as applied.
2. After each successful `setSpan`, `setHeight`, `setBayWidth`, `addBay`, `removeBay`, `setRoof`, run
   `refitGuestOpenings(next, type)` and use its design. For each `stuck` index add **one** failure for
   that op: `Opening ${i + 1} (${kind} on the ${wall} wall) no longer fits after this change.` The size
   change itself still counts as applied (the guest asked for it; the page shows the opening as
   needing attention, exactly as it does when the guest drags the size themselves).
   Implement as a small local helper inside `applyGuestOps` (e.g. `afterResize(index)`), not six copies.

**Verify (no test files — tests are off):** write a scratch script in the session scratchpad (not the
repo) and run with `npx tsx <script>` from `packages/core`, importing from
`D:/Docs/OS.mr.Thi/02.smartquote_v2/packages/core/src/domain/index.ts`. Use the Riding Arena type from
`GUEST_DEFAULT_TYPES` with span 15000, height 4500, gable 10°, 8 × 3750 bays. Expected:

| Ops on a design with left + right 3000×2100 roller doors at 13500 | Expected |
|---|---|
| `removeBay` ×4 (length 30 m → 15 m) | applied 4, doors refitted to a legal offset ≤ 12000, `validateGuestDesign` = [] |
| `resizeOpening` index 0 → largest roller size the type offers | applied 1, offset re-centred, validate = [] |
| front door 5100 wide at 4950, then `setSpan` 6000 (if the type's min allows; else min span) | front door slid or reported in `failures` as "no longer fits"; never silently at an illegal offset without a failure |
| Garage 6000 × 6000, two left doors already, third `addOpening` left | failure "no room", design unchanged (already works — regression check) |

Then `npx tsc --noEmit -p .` in `packages/core` → no output, and `pnpm build:inc` from the root.

## Task 2 — Page uses core instead of its own copy

**Files:** modify `apps/site/src/app/quote/designOps.ts`.

- Delete the local `nearestLegalOffset`; call core's `nearestLegalGuestOffset` everywhere it was used
  (`addOpening`, `moveOpening`, `setOpeningWall`, `setOpeningSize`, `refitOpenings`). The search and id
  scheme are identical (see Ground truth); keep `snap()` and `SNAP_MM` (UI uses them) but set
  `SNAP_MM = GUEST_SNAP_MM`.
- `setOpeningSize` → wrap `resizeGuestOpening` (return its result as the page's `Fit`).
- `refitOpenings` → `refitGuestOpenings(design, type).design` (keep the exported name and signature so
  `ControlAccordion.tsx` is untouched).
- Remove imports that become unused (`placeOpening`, `asOpening`, …) only if nothing else in the file
  uses them.
- Reason text: core says `on the left wall` (lowercase wall id); the page said
  `WALL_NAMES[wall].toLowerCase()` — same words. No copy change.

**Verify:** `npx tsc --noEmit -p .` in `apps/site` (package name is `@sq/site-app`). In the browser at
`http://localhost:3063/quote` step ②: add a roller door with the page's own button (lands centred),
drag it to a corner (stops at the margin, not 0), change its size chip (stays centred), remove a bay
(door slides in). Step ② tab must not show "needs attention" at any point.

## Task 3 — Repair designs saved before the fix

**Files:** modify `apps/site/src/app/quote/store.ts` (`hydrate`).

- After `const type = types?.find(...)` (~line 352), if `design !== null && type !== undefined`, run
  `refitGuestOpenings(design, type).design`.
- **Trap:** `revisionOf` and `designSeen` below compare `design === saved.design` by reference. Capture
  `const fromSaved = design === saved.design;` **before** the refit and use `fromSaved` in both places.
- Do not refit when `types === null` (list not loaded yet) — nothing is known then.

**Verify:** in the browser, with DevTools JS set `localStorage['sq.guest.v1']` to the current value but
with one side door's `offset` changed to `0`, reload → after hydrate the stored offset is legal
(non-zero) and step ② does not say "needs attention". Read it back with
`JSON.parse(localStorage.getItem('sq.guest.v1')).design.openings`.

## Task 4 — Let the assistant see and say positions

**Files:** modify `apps/api/src/lib/guestAssistant.ts` (`designContext` and the prompt text only).

1. **First establish the direction, don't assume it.** For each wall, find out which end offset 0 is,
   as the guest sees it on the 2D plan (front/back: left or right end seen from outside; left/right
   walls: front end or back end). Method: in the browser put a door on each wall with the page's
   "Left" position chip (`positionOpening(..., 'left')`, aims at offset 100) and look at where the 2D
   plan draws it. Record the four answers in this plan file under "Findings" before writing step 2.
2. `designContext`: per opening add its position, e.g.
   `0: roller_door on left wall, 3000×2100 mm, at 13500 mm of a 30000 mm wall (centred)`. Compute wall
   length with `withDimensions(configFromGuestDesign(design, type))` + `wallLength`; label `centred` /
   `near <end>` / plain using the same tolerances as the page's `positionOf` (centre within 50 mm of
   `(run − width) / 2`; an end within 150 mm of 0 or of `run − width`). Numbers and enum names only —
   nothing the guest typed.
3. Prompt: add after the op list, in the prompt's existing plain style:
   - "offset" is the opening's left edge in mm from the wall's start end; state the step-1 finding for
     what the start end is on each wall.
   - Use `"offset": null` when the visitor names no position — the page centres it.
   - The server moves an opening to the nearest legal spot, so an offset near a corner is fine to send.
   - For "towards the back/front/corner", compute the offset from the wall length in the context.
   Keep the "You MUST NOT" block unchanged (it forbids explaining how the page works to the visitor —
   these lines are for the model, not to be repeated).

**Verify:** `npx tsc --noEmit -p .` in `apps/api`. The API restarts on save (`node --watch`). In the
browser assistant panel, on the Riding Arena with side doors:
- "move the left door towards the back" → the door's offset moves toward the back end found in step 1.
- "make the left door the biggest size" → resized, still legal (Task 1).
- "make it 4 bays shorter" → doors slide in; if one cannot fit, the reply says so.
Check consecutive turns share a session (cookie `sq_ga`): rows in `guest_assistant_turns` for the same
conversation have one `session_id`.

If `apps/api/src/__tests__/guestAssistant.test.ts` asserts on the exact `designContext` text, update
that expectation (that is keeping an existing test true, not writing new tests).

## Task 5 — Tests (ONLY if the human asks for tests)

`packages/core/src/domain/__tests__/guestOps.test.ts`, by risk:
- addOpening with no offset → centred and `validateGuestDesign` = [].
- addOpening `offset: 0` → nearest legal (> 0).
- addOpening on a full wall → failure, design unchanged.
- resizeOpening to a larger chip → legal; to a size that fits nowhere → failure.
- removeBay that strands a door → door refitted, or failure reported when it fits nowhere.
Run: `pnpm --filter @sq/core exec vitest run src/domain/__tests__/guestOps.test.ts`.

---

## Review focus (what most likely bites a guest)

1. A building shrink that strands **several** openings on one wall — refit runs in index order; a later
   opening must see earlier ones' new offsets (use the running design, as `refitOpenings` does).
2. A resize/refit while span or height is outside limits (`withDimensions` → null) — must not throw and
   must not drop openings.
3. `hydrate` refit changing the object reference and silently clearing `designSeen` / `revisionOf`.
4. The assistant's failure text reaching the guest: `honestMessage` must still say "Done"-free wording
   when an op applied but a door got stuck.
5. Page and server disagreeing: the page applies the server's design as-is, so any page-side
   post-processing of assistant results would diverge — don't add any.

## Out of scope

- Telling the guest the exact resulting position in the assistant's own sentence (the change card
  and "View on plan" already show it).
- `needsConfirm` behaviour, motorised doors, window sills, new opening kinds.
- e2e changes, commits.

## Done when

- `npx tsc --noEmit -p .` clean in `packages/core`, `apps/site`, `apps/api`; `pnpm build:inc` run.
- The four browser checks in Tasks 2–4 pass, step ② never shows "needs attention" after any of them.
- Scratch-script table in Task 1 matches.
- `docs/smartquote-quote-editor-reference.md` (Vietnamese, trusted live description) updated in the
  Guest openings section: every change re-places openings at the nearest legal spot; the assistant
  receives positions.
- Nothing committed. Final summary lists what was verified and what was not.

## Findings

_(Task 4 step 1 writes the wall-direction answers here.)_

Task 4 step 1 (read from `packages/core/src/domain/placement.ts:130-150`, not yet confirmed in the browser): offset 0 is the front wall's x = 0 end, the back wall's x = span end, the left wall's back end (y = length), the right wall's front end (y = 0).
