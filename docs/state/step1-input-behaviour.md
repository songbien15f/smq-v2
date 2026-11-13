# SDD ledger — plan: docs/superpowers/plans/2026-11-13-step1-input-behaviour.md

Spec: docs/superpowers/specs/2026-11-13-step1-input-behaviour-design.md
Executor: Native (executing-plans inline), on master, uncommitted (CLAUDE.md: git opt-in, no worktrees — same as parts 2 and 3).

Pre-flight:
- T1 → T2: `ShedDimensions` (T1 adds pitchBounds/baySpacingBounds) ← T2 changes writer return types on the same interface. Same file, sequential; no conflict.
- T1 → T3: `baySpacingBounds: Range` consumed for bay inputs' min/max. Matches.
- T2 → T3: boolean `applyBays`/`applyBayWidths`/`applyDimension` consumed by CommitNumberInput `onCommit`. Matches (`boolean | void`).
- T3 → T4: `parseNumber(raw): number | null` consumed by PitchCombobox. Matches.
- T1/T2 → T4: `pitchBounds`, boolean `applyDimension`. Matches.
- Task 1: Ruling: plan's fallback case used span 20000, which is inside the 2000–30000 fallback and so raises nothing — test uses 31000 instead — none; the plan's value was arithmetic error.
- Task 1: Ruling: bay-size rule placed just before the spacing-mismatch rule, not after it — the plan also requires the size issue to come first on shed-nomBaySpacing, which placing it after would break — none.
- Task 1: browser: span 1900 accepted with no error; test quote's 6000 mm bays now show '1000–4000 mm' and Next is blocked by 'Each bay is 6000 mm; this price book sells bays of 1000–4000 mm.' (the test quote itself is out-of-book — expected under the 'block saving' decision).
Task 1: complete (validation.test.ts → 21 passed; typecheck exit 0)
- Task 2: Ruling: `parseNumber` created at the top of CommitNumberInput.tsx in Task 2, not Task 3, because DimensionField now uses it — none.
- Task 2: Ruling: Enter now only blurs (blur commits) and an unchanged value skips onCommit — the old Enter committed and then blur committed again from a stale closure, asking the wipe confirm twice; the spec requires once — none.
- Task 2: Ruling: Escape sets an `escaping` ref so the blur it causes reverts instead of committing the typed text (the DOM still holds it at blur) — the spec says Escape restores the stored value — none.
- Task 2: browser: with an Awning placed, span 9000→10000 + Enter, confirm stubbed false → confirm called once, field back to 9000, store 9000. Note: a window/door is an *opening* and does not trigger the wipe confirm (shouldWipeOptions reads options only) — pre-existing, out of scope.
Task 2: complete (validation.test.ts → 21 passed; typecheck exit 0)
- Task 3: Ruling: the bay-spacing panel is forced open while any `shed-bayWidth-<i>` has an issue, and each bay input shows its issue text + aria-invalid — Task 1 put issues on those paths, but the inputs exist only while the panel is open, so the summary link would go nowhere — cost if wrong: the panel can't be closed until the bay is fixed.
- Task 3: Ruling: on an accepted commit the box shows the number as stored (`12,5` → `12.5`), not the raw text — none.
- Task 3: Ruling: `setCantilever` returns false when the building has no dimensions or no default cantilever exists, so the box reverts — none.
- Task 3: browser (focusin/focusout dispatched; pane hidden so real blur doesn't fire): spacing 5/50/500 left length 24000, 3000+blur → 12000 (4 bays); cleared front cantilever → box 600, option kept; rate `12,5` → store 12.5; with a cantilever placed and confirm=false, bays 5 → confirm ×1, box 4; Enter path also ×1; spacing 9000 → alert "9000 mm is outside 1000–4000 mm.", box 3000.
Task 3: complete (validation.test.ts → 21 passed; typecheck exit 0)
- Task 4: Ruling: a pick keeps focus in the input (mousedown preventDefault), so the `settled` flag is cleared on the next keystroke as well as on blur — otherwise typing after a pick and leaving would skip the commit — none.
- Task 4: Ruling: an empty or unparsable pitch reverts silently (no refusal text), like CommitNumberInput — none.
- Task 4: Ruling: the popover's copy shows "Choose a pitch." as its error when the quote has no pitch, replacing the select's bare aria-invalid — cost if wrong: one extra line of text in the popover.
- Task 4: Ruling: the toggle button has tabIndex -1 (keyboard opens the list with ArrowDown) and options are 44 px rows — none.
- Task 4: browser (hidden pane, dispatched events): role=combobox, toggle 44 px lists 7.5/10/15/20/25/30°; with a cantilever placed and confirm=true, pick 15° → confirm ×1, store 15; `7,5`+Enter → confirm ×1, store 7.5; `40`+blur → alert "40° is outside 7.5–30° for this span.", box 7.5, confirm ×0; confirm=false + pick 20° → confirm ×1, box/store 7.5, option kept; popover #sitecheck-params-roofPitchDeg is a combobox showing 7.5, wrapper data-issue-path=shed-roofPitchDeg. Nothing saved.
Task 4: complete (validation.test.ts → 21 passed; typecheck exit 0)
Task 5: complete (client tests 8 files / 66 passed; build Compiled successfully, exit 0; reference §13.43 written)
Final review: fresh reviewer (Opus). 0 Critical, 2 Important, 9 Minor; all five Review Focus items hold; agrees with every ruling.
- Final: Ruling: fixes verified by browser reproduction (fail before → pass after) plus the full client suite, not by new unit tests — CLAUDE.md makes tests opt-in (no new test files) — cost if wrong: no regression test pins these.
- Final: fixed popover Escape — Escape with the pitch list open closed the whole Building parameters popover (React's root is `document` under the App Router, so stopPropagation can't stop a listener on the same node). Combobox now preventDefault()s and the popover skips a defaultPrevented Escape — browser RED (popover closed) → GREEN (1st Escape closes list, 2nd closes popover), suite 66/66.
- Final: fixed (re-graded Minor→Important) chevron list never closed — opening from the chevron without input focus left the list open after an outside press. Chevron now focuses the input; a document mousedown outside closes the list; `active` resets on close, `settled` on focus — browser RED (afterOutside "true") → GREEN ("false"), suite 66/66.
- Final: fixed span/height hint promised "priced from an assumed section" while Save is blocked — `outOfBookMessage` now ends "Change it before saving." and formats the range like the validator (1800–15000 mm) — not reproducible in the form (inputs refuse out-of-book values; needs an imported quote), verified by typecheck/build — suite 66/66.
- Final: minor (deferred): refusal wording differs — DimensionField says "this book sells" even for non-book limits (length, fallback bounds); PitchCombobox says "for this span" under the 0–45 fallback.
- Final: minor (deferred): Bays uses literals 1/30 rather than bounds.bays; useShedDimensions keeps a 1000–20000 spacing fallback outside bookBounds.
- Final: minor (deferred): parseNumber accepts "1,000"→1, "1e3", "0x1F"; integer fields round 4.6→5 instead of refusing.
- Final: minor (deferred): a stored value changed elsewhere while a field is focused (undo) is overwritten by the untouched old text on blur.
- Final: minor (deferred): PitchCombobox ARIA — aria-controls points at an unrendered list while closed; aria-autocomplete="list" though the list isn't filtered; aria-selected marks the stored value, not the highlighted option.
- Final: minor (deferred): while the bay panel is forced open, the "Hide bays" button does nothing.
- Final: minor (deferred): DimensionField leaves typed text (9000.4) when it rounds to the stored value; CommitNumberInput shows the stored value.
- Final: minor (deferred): refusal text sits inside <label>, so it joins the input's accessible name.
Final review: complete (client tests 8 files / 66 passed; build compiled).
