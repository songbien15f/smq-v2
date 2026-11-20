# Guest opening placement — follow-ups (for agent_implement)

Context: `docs/plans/guest-opening-placement.md` is implemented and manually verified (uncommitted in the
working tree). This file lists what is left. Do the tasks in order. Reply to the user in Vietnamese.

## Prompt to give the agent

> Read `CLAUDE.md` and `docs/plans/guest-opening-placement.md` (its Findings section included), then do
> Tasks A–D of `docs/plans/guest-opening-followups.md`, in order. Rules: never push; commit only in Task D
> and only if the user said so; do not touch `placementRules.ts`, the 15 m width limit or
> `GUEST_DEFAULT_TYPES`; never print or commit secrets from `.env`, `docs/note.md`, `apps/site/.env.local`;
> no real Google Places calls; keep `GUEST_PLACES_ENABLED=1`; use `localhost`, never `127.0.0.1`; after any
> `packages/core` edit run `pnpm build:inc` from the repo root. `guestOps.ts`, `store.ts`, `route.ts` and
> `guestAssistant.ts` are CRLF; `guest.ts` and `designOps.ts` are LF — keep each file's line endings.
> Write "chưa kiểm tra" for anything you did not run.

## Task A — Tests for the new behaviour (user asked for tests here, so tests are ON)

Files: `packages/core/src/domain/__tests__/` (add `guestOpeningRefit.test.ts`), and
`apps/api/src/__tests__/guestAssistant.test.ts` (extend). Use the existing Riding Arena fixture used by the
other guest tests (15 m span, 8 × 3750 bays, roller doors front 5100×3600, left and right 3000×2100).

Core test cases (each must assert `validate`/`assessGuestDesign` finds no opening problem unless stated):
1. `applyGuestOps` `removeBay` ×4: left and right doors end at offset 11900 (wall 15000 − 3000 − 100).
2. `resizeOpening` left door to 5100×3600 at offset 13500: result offset 12450.
3. `setSpan` to the type's minimum: front 5100 door no longer fits → `failures` has the message
   "Opening 1 (roller_door on the front wall) no longer fits after this change." and `applied` is 1.
4. `addOpening` with `offset: 0` on a wall lands at the margin (100), not 0; with no offset it lands centred.
5. `moveOpening` towards a corner stops at the legal margin, never 0 or past the wall end.
6. `refitGuestOpenings` returns the same object when nothing moves (no needless re-render).
7. `resizeGuestOpening` returns `ok: false` with the placement reason when the new size fits nowhere.

API test: `designContext` output (export it if it is not exported, or assert through the prompt the
assistant receives) contains `left edge 13500 mm along a 30000 mm wall, centred` for the left door of that
fixture, and `at the start end` for an opening with offset 100.

Done when: `pnpm --filter @sq/core test` and `pnpm --filter @sq/api exec vitest run src/__tests__/guestAssistant.test.ts`
pass (API needs `TEST_DATABASE_URL` from `.env`, name contains `test`).

## Task B — Find why the e2e editor sign-in fails

Seen: `pnpm exec playwright test` → `[setup] e2e/auth.setup.ts:36 sign in with a company code…` and
`[teardown] auth.teardown.ts:22` fail, so the 31 editor specs do not run. `--project=guest` passes 5/5, so
this is unrelated to the Guest change. Steps:
1. Reproduce: run `pnpm exec playwright test --project=setup`; open the failure screenshot
   (`test-results/auth.setup.ts-*/test-failed-1.png`) and the error text.
2. Decide the cause from evidence: licence seat/device already taken (see `pnpm seats:release`, but do NOT use
   `--all` and do NOT revoke the devices E2ESHEDS or HEADOFFICE), wrong test credentials in `.env`, services
   not running, or a real regression in the API/admin changes in the working tree (`git diff` of
   `apps/api/src/routes`, `apps/client/src/app/api`).
3. Fix only if the cause is a regression in code; if it is an environment/credential issue, report it and
   stop. Do not type the vendor admin password.

Done when: the cause is stated with evidence, and the setup project either passes or is explained.

## Task C — Docs and the offline build

1. `docs/smartquote-quote-editor-reference.md` (Vietnamese, trusted description): it has no Guest-openings
   section. Add a short one: every change (size, roof, bays, resize, move, add, saved-design reload) re-places
   openings at the nearest legal spot (50 mm steps, 100 mm margin); an opening that fits nowhere is reported,
   not dropped; the assistant receives each opening's `offset` and wall length; offset 0 is the front-left end
   of the front wall, the right-hand end of the back wall, the BACK end of the left wall, the FRONT end of the
   right wall (`packages/core/src/domain/placement.ts:130-150`).
2. Add the same two sentences to `docs/FEATURE-COVERAGE.md` if it has a Guest section.
3. Run `pnpm build` at the repo root once; report pass/fail and the time. This is the offline build the other
   agent claimed; do not assume it passes.

## Task D — Hand over

Run `pnpm typecheck`, then `git status` and report: files changed, tests run with results, what was not run.
Do NOT commit unless the user told you to; if told, one Conventional Commit
(`feat(site): keep guest openings legal after every change`), never include `.claude/`, `.env`, `data/`,
`docs/note.md`, `apps/site/.env.local`, and never push.

## Not in scope
- `needsConfirm` (the Apply / Keep my design card) is intended; do not change it.
- Changing opening size lists, margins, or the placement rules.
