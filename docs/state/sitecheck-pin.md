# SDD ledger — plan: docs/superpowers/plans/2026-11-13-sitecheck-pin.md

Spec: `docs/superpowers/specs/2026-11-13-sitecheck-pin-design.md`. Executor: inline ("Native"), chosen by the user 2026-11-13.

Ruling: project rules (CLAUDE.md) override the executing-plans skill — no worktree, no branch, no commits, no new test files (tests=off); each task self-verifies with typecheck + e2e — the user's repo rules are explicit and the plan's Global Constraints repeat them — if wrong, the work is simply committed later by the human.

Pre-flight: Task 1 → Task 4 (`useShedDimensions` consumed by the popover), Task 2 → Task 3 (gate functions), Task 3 → Tasks 4/5/6 (`useSiteCheckActions`). Interfaces match as written; no conflict.

## Baseline (Task 1, Step 1)

- First baseline run (`pnpm test:e2e e2e/stepOne.spec.ts`) was invalid: the API was not answering ("fetch failed" in `serverFetch`), so `auth.setup` timed out on `#companyCode` and 30 tests did not run. The run also overlapped the split script.
- Ruling: the post-split run is the reference baseline instead of a pre-split one — the split is a verbatim move (DesignGroup diffed byte-identical against the original lines) and a pre-split run would have required swapping the file under a live dev server — if wrong, a regression introduced by the split would be hidden; the Task 7 run will still catch anything new against this list.

Reference list (post-split, API healthy):
- 30 passed, 1 skipped, 1 failed: `stepOne.spec.ts:838` "a long cantilever is refused on a standard building…".
- The failing test **passes when run alone** (`-g "long cantilever"`, 3/3 incl. setup/teardown). Flaky under the full suite (timing of `#design-cantilever-error` after blur), not caused by the split.

Task 1: complete (no commits — working tree; checks: typecheck exit 0, no `error TS`; QuoteDetailsPanel.tsx 115 lines < 250; e2e 30 passed / 1 flaky / 1 skipped)
Task 2: complete (no commits; `apps/client/src/components/editor/siteCheckGates.ts`; typecheck exit 0)
Task 3: complete (no commits; `siteCheckActions.tsx` provider wraps the Step 1 body inside `SiteCheckProvider`; `SiteCheckPanel` takes no props; typecheck exit 0; e2e 31 passed / 1 skipped — the old message assertions still pass, cantilever passed this run)
Task 3: Ruling: the identity type is `ReturnType<typeof useShedSafeIdentity>` because `siteCheckState.tsx` does not export its value type and the plan forbids editing that file — cost if wrong: none at runtime, a rename later.
Task 3: Ruling: `SiteCheckPanel` keeps its own `params`/`setParam` until Task 4 deletes it — Task 4 replaces the whole panel, so moving them now would be churn — cost if wrong: one task of duplicate code.
Task 4: complete (no commits; created `details/SiteCheckPin.tsx`, `details/BuildingParamsPopover.tsx`; wired in `SiteGroup`; `QuoteDetailsPanel` slot + `Group` re-export removed; `SiteCheckPanel.tsx` deleted, Grep "SiteCheckPanel" → only doc comments in siteCheckGates/siteCheckActions/siteCheckState; typecheck exit 0; browser on /quotes/new as E2ESHEDS/owner: PIN disabled with "Needs: …" title until customer+site filled, popover opens with focus on importance, span typed in popover → Shed shows it and the reverse, scroll/outside click/blur keep it open, Escape and ✕ close and return focus to #sitecheck-pin, GO disabled with "Your email isn’t a ShedSafe salesman" for this non-salesman login, mobile 375×812 bottom sheet, one #sitecheck-popover, no horizontal scroll)
Task 4: Review Focus 1 (cancel the wipe confirm) not exercised — a new quote has no options so no confirm appears; the popover calls the Shed group's own `commitSpan`/`commitHeight`/`commitLength`/`applyDimension`, so both places behave identically. Known: `DimensionField` keeps the typed text when the confirm is cancelled (its `valueMm` does not change) — that is Part 4 (input behaviour), out of scope here.
Task 4: Review Focus 2 and 5 not exercised in the browser — both need a successful pin, and the only test login (E2ESHEDS owner) is not a ShedSafe salesman. The logic is Task 3's `siteCheckActions.tsx` (path at :208, `setSiteCheckId` at :234, blocked-tab message in `pin()`), moved unchanged from the old panel; the popover renders `message` with role status/alert and the "Open again ↗" link.
Task 4: Ruling: PIN rides in the address `Field`'s `suffix` slot instead of an `items-end` flex row — keeps it level with the input when the field shows an error — cost if wrong: layout only.
Task 4: Ruling: the plan's single `SiteCheckPin({unit})` is two exports, `SiteCheckPin` and `SiteCheckStatusLine`, and the popover is its own file taking `unit` — the button sits in the suffix slot and the status line under the whole field — cost if wrong: a rename.
Task 4: Ruling: the popover's pitch select writes with `applyDimension({ roofPitchDeg })` instead of the plan's `applyPartial` — spec's "one record" means the same wipe-options confirm the Shed group asks — cost if wrong: one extra confirm.
Task 4: Ruling: `!canWrite` disables the fields with `<fieldset disabled>` — `DimensionField` and `SelectField` have no `disabled` prop — cost if wrong: none.
Task 4: Ruling: desktop flip only when the popover overflows the bottom of the window AND there is more room above the anchor, measured once per opening — re-measuring on scroll would make it jump — cost if wrong: popover can run off-screen below on a short window (it scrolls within `max-h`).
Task 4: Ruling: importance and pitch use plain `<select>`s (compact, 38px) rather than `SelectField` — the popover is a 2-column 360px grid and `SelectField`'s hint/label block doubles its height — cost if wrong: visual only.
Task 5: complete (no commits; `DesignGroup.tsx` header aside = "From ShedSafe" + StatusPill + `#design-sitecheck-refetch` (only when a check exists); six `DesignValue compact` in a 2-col grid with ids kept; drift line (role status, "Pin again at Site address" → `focusPin`), unverified line, shortened book warning; "More parameters" 8 rows with certified → provisional (amber, titled) → `—`, counter counts certified only; `siteState` paragraph removed; typecheck exit 0; browser /quotes/new before a pin: six values `—` dashed, header "Design · From ShedSafe · Not pinned", no refetch button, summary "0 of 8 from the rating", 8 rows `—`, no nested buttons, no horizontal scroll)
Task 5: Ruling: `Group`'s `aside` renders beside the `<h3>`, outside the toggle button — a button inside a button is invalid and a click on "Get again" would fold the group — cost if wrong: layout only.
Task 5: Ruling: `DesignValue compact` keeps the state sentence in the DOM as `sr-only` for `aria-describedby`, and shows provisional as amber text + tooltip — the three states must still reach a screen reader — cost if wrong: none.
Task 5: Ruling: "From ShedSafe" is hidden below `sm` — the header row would wrap the pill under the title on a 375px phone — cost if wrong: the label is missing on phones; the pill still says the state.
Task 6: complete (no commits; `ShedGroup.tsx` local `DriftLine({entry, onPin})` under span/height/length, each field+line wrapped in a grid-cell `div`; importance drift not shown in Shed; typecheck exit 0; browser /quotes/new renders the three fields, no drift lines without a certified check, no runtime error)
Task 6: Review Focus 4 not exercised — needs a certified check, and the only test login is not a ShedSafe salesman. `drift` is `driftOf(check, config)` from Task 2, empty unless `check.calculated` and `pinnedFor` exist.
Task 6: Ruling: the "to" figure carries " mm" (`6000 → 7000 mm`) and the line has `role="status"` — matches `driftText` in Design so the two places read the same — cost if wrong: two characters.
Task 7: complete (no commits; `docs/smartquote-quote-editor-reference.md` §13.41 added (PIN in Site address, popover fields sharing the Shed record, Design as the single home, drift places); typecheck exit 0; `pnpm --filter @sq/client-app build` exit 0, dev server still serving afterwards; e2e `stepOne.spec.ts` 22 passed / 10 failed (32 total): failures = 99, 213, 267, 878, 934, 951, 979, 1091, 1117 (all on the spec §6 expected list) + 838 (known flaky cantilever, passes alone 3/3). No other regression.)
Task 7: Note — 300 ("six certified values are read-only, and say they have no source yet") was on the expected-failure list but still passes: `DesignValue compact` keeps the note text in the DOM as `sr-only`. The baseline's 1 skipped test now runs and fails (it is on the §6 list).
Task 7: e2e §6 tests not updated — tests=off; they need rewriting for the new layout when tests are turned on.
Task 2: Ruling: `siteCheckStatus` danger label uses a straight apostrophe "didn't" as the plan's table spells it, while other copy keeps the typographic ’ — matches the plan verbatim — cost if wrong: one character.

## Final review (opus subagent, whole working tree): 0 Critical, 4 Important, 6 Minor

Final: Ruling: fixes are verified by typecheck + browser instead of RED→GREEN tests — tests=off in CLAUDE.md forbids new test files — cost if wrong: a fix that only looks right; the paths needing a salesman login (refetch, lastError, canWrite) are unexercised.
Final: fixed "Get again" in Design gave no feedback — Design now renders `message` (role alert/status) under the header; typecheck exit 0; not browser-exercised (needs a pinned check).
Final: fixed "Get again" ignored `canWrite` — button hidden when `!canWrite`; typecheck exit 0; browser: no refetch button before a pin.
Final: fixed `check.lastError` shown nowhere — shown in the popover's pinned block and under the certified line, and in Design when no fresh `message`; `siteCheckStatus` returns danger "ShedSafe reported a problem · open for details" when not yet calculated and `lastError` is non-empty; typecheck exit 0; not browser-exercised.
Final: Ruling: `lastError` turns the status line danger only before a rating — after one the certificate still stands, so the line keeps "Certified" and the error shows beside it — cost if wrong: a stale import error is less loud once certified.
Final: fixed folding the Site group left `popoverOpen` true — unmount cleanup calls `closePopover`; focus returns to `#sitecheck-status` when PIN is disabled; browser: open via status line → Escape → focus on `sitecheck-status`; open → fold → unfold → popover absent.
Final: minor (deferred): `message` is never cleared when the popover opens or closes.
Final: minor (deferred): mobile bottom sheet lacks `aria-modal` and a focus trap.
Final: minor (deferred): disabled PIN's reason is only in `title` (not reachable by touch / screen reader).
Final: minor (deferred): "See Design" does nothing when Design is collapsed and does not move focus.
Final: minor (deferred): desktop flip anchors on `panel.parentElement.parentElement` — fragile to markup changes.
Final: minor (deferred): unused imports left in `details/*` by the split.
