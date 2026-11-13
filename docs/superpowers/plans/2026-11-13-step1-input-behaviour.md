# Step 1 Input Behaviour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Step 1 of the quote editor:
- every number field commits only on blur or Enter;
- roof pitch becomes an editable combobox that asks the wipe question once;
- one set of size limits, read from the price book, decides both what a field accepts and what blocks saving.

**Architecture:**
- A pure `bookBounds(catalogue, span)` in the client is the single source of limits. It feeds both the field inputs (via `useShedDimensions`) and `validateDraft` (via a new optional third argument).
- The writers (`applyDimension`, `applyBays`) return whether they applied. Fields use that to snap back to the stored value after a cancelled confirm.
- Two small components replace the per-keystroke inputs: `CommitNumberInput` for plain numbers, and `PitchCombobox`, which follows `AddressField`'s ARIA combobox pattern.

**Tech Stack:** Next.js 16 / React 19 client (`@sq/client-app`), Zustand store, Tailwind tokens (`sq-*`), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-13-step1-input-behaviour-design.md`

## Global Constraints

- **Form only.** No change to `apps/api`, `packages/contracts` or `packages/core/src/domain/schema.ts`.
- **Tests are opt-in in this repo** (CLAUDE.md), so no new test files.
  - Validator rules get new cases in the **existing** `src/components/editor/__tests__/validation.test.ts`, written failing first.
  - UI tasks are verified by typecheck plus DOM checks in the running app at http://localhost:3061. Never use 127.0.0.1.
- **Git is opt-in.** Commit nothing; leave every change in the working tree. Never push. The commit steps below are replaced by a ledger line in `docs/state/step1-input-behaviour.md`.
- **Packages:** `@sq/core` is consumed from `dist`. This plan does not edit core.
- **Ids stay as they are:** `shed-bays`, `shed-nomBaySpacing`, `shed-bayWidth-<i>`, `design-cantilever-<wall>` (with `data-issue-path="design-cantilever"`), `customer-quoteRatePct`, `shed-roofPitchDeg`, `sitecheck-params-roofPitchDeg`.
  - The validator, error summary and `markTouched` address fields by these ids.
- **Never clamp** a typed value. Out of range means refused, with a sentence naming the limit.
- **Fallback limits:**
  - When there is no catalogue, or the book states 0 for a bound: span 2000–30000, height 2000–12000, pitch 0–45. Bay size is not checked.
  - Always: length 2000–120000, bays 1–30.
  - When the book has no bay bounds, the bay inputs take 1000–20000 (their range today), with no validator issue.
- **Copy for the book's limit** (spec "Left to the builder", pinned here):
  - Full message: `Span must be between 1800 mm and 15000 mm for this price book.` Same shape for `Wall height` and `Roof pitch` (`7.5° and 30°`). Length and Bays keep today's text, since the book states neither.
  - Short form: `1800–15000 mm`, `7.5–30°`.
  - Bay size: `Bay 3 is 6000 mm; this price book sells bays of 1000–4000 mm.` (or `Each bay is 6000 mm; …` when the bays are even).
  - Fallback messages keep today's text, without "for this price book".
- **Pitch 0 on a book is an issue** (planner's call). The form treats 0 as "no pitch chosen" (`BuildingParamsPopover.tsx:122`), and the desktop's config lookup skips the pitch filter at 0 (`ShedConfigCache.cs:53`), so it would price from an arbitrary row. With a book loaded, 0 falls outside e.g. 7.5–30 and blocks Save. Without a book, the 0–45 fallback still accepts 0, so the existing tests are unaffected. Both comboboxes show 0 as empty.

Commands (PowerShell, repo root):

- Typecheck: `pnpm --filter @sq/client-app typecheck 2>&1 | Select-String "error TS"; "exit: $LASTEXITCODE"` — expect no lines and exit 0.
- Validator tests: `pnpm --filter @sq/client-app exec vitest run src/components/editor/__tests__/validation.test.ts`
- All client tests: `pnpm --filter @sq/client-app test`
- Build: `pnpm --filter @sq/client-app build`

## Review Focus

1. **Typing a decimal with a comma** (`12,5` into quote rate, `7,5` into pitch). Expect it parsed like `DimensionField` does (`,` → `.`) and committed, not refused. Owner: Task 3 (shared parse) — browser check in Tasks 3 and 4.
2. **A quote opened with an out-of-book size** (span 20000 from import). Expect it to open, the field to be red after Save, and nothing rewritten on load. Owner: Task 1 — validator test `span above the book is blocked…`. No code path rewrites sizes on load; the browser step confirms the book range reaches the form.
3. **Cancelling the wipe confirm from a bay width or Bays** (options placed). Expect the field to show the stored number again, not the typed one. Owner: Task 3 — browser check step.
4. **Pitch picked with the mouse from the list while the input still has focus.** Expect exactly one confirm and one commit. Blur after the pick must not commit a second time. Owner: Task 4 — browser check step.
5. **Span changes after a pitch is set**, moving into a band with other pitch limits. Expect the validator's pitch range to follow the new span, because `bookBounds` takes the span. Owner: Task 1 — validator test `pitch range follows the span band`.

---

### Task 1: One source of limits, and the validator uses the book's

**Files:**
- Create: `apps/client/src/components/editor/bookBounds.ts`
- Modify: `apps/client/src/components/editor/validation.ts` (`LIMITS` at :116-122, comment at :112, `validateDraft` signature at :135-145, range checks at :238-272, the 4000/4000/6000 wording at :277-280)
- Modify: `apps/client/src/components/editor/QuoteEditor.tsx:231-242` (pass bounds)
- Modify: `apps/client/src/components/editor/details/useShedDimensions.ts` (bounds from `bookBounds`)
- Test: `apps/client/src/components/editor/__tests__/validation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Range { min: number; max: number }
  export interface BookBounds {
    span: Range; height: Range; pitch: Range; length: Range; bays: Range;
    /** null when the book states no bay bounds — then the validator does not check bay size. */
    baySpacing: Range | null;
    /** Per field: true when the range is the book's, false when it is the fallback. Drives the message wording. */
    fromBook: { span: boolean; height: boolean; pitch: boolean };
  }
  export function bookBounds(catalogue: Pick<Catalogue, 'dimensions' | 'roofPitchGroups'> | null | undefined, spanMm: number | null): BookBounds;
  export function largestBay(config: { length: number | null; bays: number; bayWidths?: readonly number[] }): { mm: number; index: number | null } | null;
  // validation.ts
  export function validateDraft(draft: DraftForValidation, book?: { nonStandardStructureCodes: readonly string[] }, bounds?: BookBounds): DraftIssue[];
  ```
  - `index` is the 0-based bay when the bays are uneven, and `null` when they are even.
  - `bounds` defaults to `bookBounds(null, draft.config.span)`.
  - `ShedDimensions` (hook) gains `pitchBounds: Range` and `baySpacingBounds: Range`. `baySpacingBounds` is the book's, or 1000–20000.

- [ ] **Step 1: Write the failing tests** in `validation.test.ts`, in a new `describe('validateDraft — the price book's limits', …)`.
  - Build `bounds` with a helper. It takes a fake catalogue:
    - `dimensions`: span 1800–15000, height 2200–6000, baySpacing 1000–4000, roofPitch 7.5–30, each with `hints: []` and whatever default field `ShedDimension` needs;
    - `roofPitchGroups`: `[{spanMin:1800,spanMax:9000,pitchMin:7.5,pitchMax:15,hints:[7.5,10,15]},{spanMin:9001,spanMax:15000,pitchMin:20,pitchMax:30,hints:[20,25,30]}]`.
  - Cases (`shed()` is the existing helper; pass `bookBounds(fake, config.span)` as the third argument):
    - `span inside the book is fine`: `shed({ span: 12000, roofPitchDeg: 25, nomBaySpacing: 4000, length: 16000, bays: 4 })` gives no issue with path `shed-span`, `shed-roofPitchDeg` or `shed-nomBaySpacing`.
    - `span above the book is blocked and names the book's range`: span 20000 gives a `shed-span` issue with `short` `'1800–15000 mm'` and `message` `'Span must be between 1800 mm and 15000 mm for this price book.'`.
    - `a span the old limits refused but the book accepts`: span 1900 gives no `shed-span` issue.
    - `height uses the book`: height 7000 gives a `shed-height` issue with short `'2200–6000 mm'`.
    - `pitch range follows the span band`: span 6000 with pitch 25 gives a `shed-roofPitchDeg` issue with short `'7.5–15°'`. Span 12000 with pitch 25 gives none.
    - `pitch between listed angles is not an error`: span 12000, pitch 22 gives no `shed-roofPitchDeg` issue.
    - `even bays larger than the book sells`: length 24000, bays 4, nomBaySpacing 6000 gives a `shed-nomBaySpacing` issue whose message is `'Each bay is 6000 mm; this price book sells bays of 1000–4000 mm.'`.
    - `the uneven bay that is too long is the one marked`: `bayWidths:[4000,4000,6000]`, length 14000, bays 3 gives exactly one bay issue, path `shed-bayWidth-2`, message starting `'Bay 3 is 6000 mm'`.
    - `without bounds nothing about the book runs`: span 20000 with no third argument gives the old message `'Span must be between 2000 mm and 30000 mm.'`, and no bay-size issue for nomBaySpacing 6000.

- [ ] **Step 2: Run the tests and see them fail**
  - Run: validator tests command.
  - Expected: FAIL. The new cases fail on the missing import `bookBounds` / `../bookBounds`. Existing cases are unchanged.

- [ ] **Step 3: Implement `bookBounds` and `largestBay` in `bookBounds.ts`**
  - Each book field uses `book.min || fallback.min` and `book.max || fallback.max`, keeping the `||` reason from `useShedDimensions`'s comment.
  - `fromBook.x` is true only when both numbers came from the book.
  - Pitch:
    - `spanMm !== null` and the groups are non-empty: `roofPitchBoundsForSpan(groups, spanMm)` from `@sq/core/domain`;
    - otherwise: `dimensions.roofPitch`;
    - otherwise: 0–45.
  - `baySpacing` is `null` unless the book states both numbers.
  - `largestBay`:
    - uneven (`bayWidths?.length === bays`): the max element and its index;
    - else `length / bays` when `length !== null && bays > 0`, index `null`;
    - else `null`.

- [ ] **Step 4: Use the bounds in `validateDraft`**
  - Add the third parameter. Replace `LIMITS.span|height|pitch|bays|length` reads with `bounds.*`.
  - Keep `LIMITS` only as the fallback values that `bookBounds` exports, as `FALLBACK_BOUNDS`. Do not keep two copies.
  - Add the bay-size rule after the "Spacing × bays ≠ length" rule. Uneven: one issue per offending bay. Even: one issue on `shed-nomBaySpacing`, pushed **before** the mismatch issue on the same path.
  - Replace the comment at :112 with the spec's reason (book limits decide validity; `ShedConfigCache.cs:47-54` filters config rows by span, height, bay and pitch).
  - Reword :277-280 so the 4000/4000/6000 example no longer reads as valid on every book.

- [ ] **Step 5: Run the tests and see them pass**
  - Run: validator tests command.
  - Expected: PASS, all cases old and new.

- [ ] **Step 6: Pass the bounds from the editor and the hook**
  - In `QuoteEditor.tsx`: `const bounds = useMemo(() => bookBounds(catalogue, config.span), [catalogue, config.span])`. Pass it as the third argument, and add it to the memo deps.
  - In `useShedDimensions`: take `spanBounds`, `heightBounds`, `lengthBounds`, `pitchBounds` and `baySpacingBounds` (null → 1000–20000) from `bookBounds(catalogue, config.span)`. Delete the local 1800/15000/2200/6000 fallbacks and `LENGTH_BOUNDS`.

- [ ] **Step 7: Typecheck.** Run the typecheck command. Expected: no `error TS` lines, exit 0.

- [ ] **Step 8: Browser check** (Review Focus 2). On the test quote `/quotes/8f0c1f05-6c92-4208-a964-63c72bbb9e3c/edit`:
  - Set span to 1900 in `#shed-span` and blur. The value is accepted, and `#shed-span-error` is absent even after pressing Next (the old 2000–30000 rule would have flagged it).
  - Set `#shed-nomBaySpacing` to a value above the book's bay max (read it from the bay field's refusal or the catalogue) and blur. Press Next. The error summary lists the bay with the book's range.
  - Restore the values. Save nothing.

- [ ] **Step 9: Ledger.** Append `Task 1: complete (<tests command> → <n> passed)` to `docs/state/step1-input-behaviour.md`. Create the file with a first line naming this plan.

---

### Task 2: Writers report whether they applied; a cancelled confirm snaps the field back

**Files:**
- Modify: `apps/client/src/components/editor/details/useShedDimensions.ts`
- Modify: `apps/client/src/components/editor/details/ShedGroup.tsx:217-230` (`applyBayWidths`)
- Modify: `apps/client/src/components/editor/DimensionField.tsx:43, 115-141, 179-193`

**Interfaces:**
- Consumes: `ShedDimensions` from Task 1.
- Produces:
  - `applyDimension(patch): boolean`, `applyBays(input): boolean`, `commitSpan/commitHeight/commitLength(mm): boolean`, and in `ShedGroup` `applyBayWidths(widths): boolean`.
  - Each returns false **only** when the person cancelled the confirm.
  - `DimensionFieldProps.onCommit: (mm: number) => boolean | void`. `false` means "not taken": the field shows the stored value again.

- [ ] **Step 1: Change the return types and bodies.**
  - The cancelled branch returns `false`; every other path returns `true`.
  - `applyBays` and `applyBayWidths` return the result of `applyDimension`.

- [ ] **Step 2: In `DimensionField`, have `commit` return whether the value was taken.**
  - It returns false on a refusal or when `onCommit(mm) === false`.
  - On blur and on Enter, when `commit` returns false, call `setText(format(valueMm, unit))`. For a refusal, keep `refusal` set so the sentence stays.
  - Remove the stale `refusal !== null` read in `onBlur`. It reads the state from before `commit` ran, which is why the snap was unreliable.

- [ ] **Step 3: Typecheck.** Expected: exit 0, with no other call site broken. `onCommit` returning `void` stays legal.

- [ ] **Step 4: Browser check.**
  - On the test quote, place a cantilever: type 1000 into `#design-cantilever-front` and blur (after Task 3; before it, the current input applies on change).
  - Stub the confirm with `window.confirm = () => false`. Type 9000 into `#shed-span` and press Enter.
  - Expected: `#shed-span` reads the stored span, and the store's span is unchanged.
  - Restore `window.confirm`, remove the cantilever, save nothing.

- [ ] **Step 5: Ledger line** `Task 2: complete (typecheck exit 0, browser check …)`.

---

### Task 3: `CommitNumberInput` for Bays, spacing, bay widths, cantilever, quote rate

**Files:**
- Create: `apps/client/src/components/editor/CommitNumberInput.tsx`
- Modify: `apps/client/src/components/editor/details/ShedGroup.tsx:505-525` (Bays), `:545-566` (spacing), `:629-647` (bay widths)
- Modify: `apps/client/src/components/editor/details/DesignGroup.tsx:225-241` (`setCantilever` returns boolean), `:531-546`
- Modify: `apps/client/src/components/editor/details/CustomerGroup.tsx:149-160`

**Interfaces:**
- Consumes: the boolean writers from Task 2, and `baySpacingBounds` from Task 1.
- Produces:
  ```ts
  export interface CommitNumberInputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
    id: string;
    value: number;
    min: number;
    max: number;
    /** Return false when the value was not taken (a cancelled confirm): the input shows `value` again. */
    onCommit: (next: number) => boolean | void;
    /** 'integer' rounds, 'decimal' keeps one or more decimals. Default 'integer'. */
    kind?: 'integer' | 'decimal';
    /** Called with the refusal sentence, or null, so the caller can render it under its own label. */
    onRefusal?: (message: string | null) => void;
    /** Unit for the refusal sentence, e.g. 'mm', '%', ''. */
    unit?: string;
  }
  export function CommitNumberInput(props: CommitNumberInputProps): React.JSX.Element;
  export function parseNumber(raw: string): number | null; // trims, ',' → '.', null when empty or not finite
  ```
  - `type="text"` with `inputMode` `numeric` or `decimal`.
  - Text state resyncs from `value` while not focused (the `DimensionField` pattern).
  - Blur and Enter commit; Escape reverts and blurs.
  - Empty or unparsable text reverts with no refusal.
  - Out of range: refuses with `` `${n} ${unit} is outside ${min}–${max} ${unit}.` `` and reverts the text.
  - A value equal to the current `value` does not call `onCommit`.
  - Every other prop (aria-*, className, data-issue-path) is spread onto the `<input>`.
  - `DimensionField` keeps its own `format` and `commit` and only uses `parseNumber`. Rebuilding it on this component is out of scope (spec "Left to the builder").

- [ ] **Step 1: Write `CommitNumberInput.tsx`** to the interface above.

- [ ] **Step 2: Wire the five fields.** Each keeps its id, aria and class.
  - Bays: `min 1 max 30`. `onCommit = (n) => config.length === null ? false : applyBays({ length: config.length, bays: n, nomBaySpacing: 0 })`.
  - Nominal spacing: `min/max = baySpacingBounds`. `onCommit = (n) => applyBays({ length: config.length ?? n * config.bays, bays: config.bays, nomBaySpacing: n })`.
  - Bay widths: `min/max = baySpacingBounds`. `onCommit` builds the array and returns `applyBayWidths(widths)`.
  - Cantilever: `min 0 max 3000`. `onCommit = (n) => setCantilever(wall, n)`.
    - 0 still removes the cantilever, but only when typed and committed. Clearing the box now reverts.
    - Update the hint copy to `Type 0 to remove the cantilever.`
  - Quote rate: `kind="decimal" min 0 max 100 unit="%"`. `onCommit = (n) => { setPricing({ quoteRatePct: n }); }`.
  - Render refusals: each caller passes `onRefusal` into a local `useState` and renders the sentence with `role="alert"` and class `text-sq-micro text-sq-danger`, under the field's existing error span.

- [ ] **Step 3: Typecheck.** Expected: exit 0.

- [ ] **Step 4: Browser check**, with DOM checks via the native value setter, an `input` event, then `blur()`:
  - Type `5`, then `50`, then `500` into `#shed-nomBaySpacing` without blurring. The store length does not change between keystrokes. Then set `3000` and blur: length is `3000 × bays`.
  - Clear `#design-cantilever-front` and blur. The box shows the stored number, and the cantilever option is still on the building.
  - Set `#customer-quoteRatePct` to `12,5` and blur. The store reads 12.5 (Review Focus 1).
  - With a cantilever placed and `window.confirm = () => false`, set `#shed-bays` to bays+1 and blur. The box shows the old count (Review Focus 3).
  - Set `#shed-nomBaySpacing` to `9000` and blur. A refusal sentence names `1000–4000 mm`, and the box shows the stored value.
  - Restore everything. Save nothing.

- [ ] **Step 5: Ledger line.**

---

### Task 4: `PitchCombobox` replaces the slider and the popover select

**Files:**
- Create: `apps/client/src/components/editor/PitchCombobox.tsx`
- Modify: `apps/client/src/components/editor/details/ShedGroup.tsx:809-867` (slider block; keep the unlisted note and the error span)
- Modify: `apps/client/src/components/editor/details/BuildingParamsPopover.tsx:122-124, 256-277` (the select and its `pitchOptions`)

**Interfaces:**
- Consumes: `parseNumber` (Task 3), `pitchBounds` (Task 1), boolean `applyDimension` (Task 2).
- Produces:
  ```ts
  export interface PitchComboboxProps {
    id: string;
    label: string;
    /** Degrees, or null when the quote has none yet (shown empty). */
    value: number | null;
    /** The book's angles for this span. */
    hints: readonly number[];
    bounds: { min: number; max: number };
    onCommit: (deg: number) => boolean;
    error?: string;
    issuePath?: string;
    /** Shown under the field when there is no error (the "book sells …" / "between the pitches" text). */
    note?: React.ReactNode;
    noteTone?: 'muted' | 'attention';
  }
  ```
  - Markup follows `AddressField.tsx:209-297`: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`, and a listbox of `${hint}°` options.
  - It adds a 44 px toggle button with `aria-label="Show the book's pitches"` that opens and closes the list.
  - ArrowDown opens the list and moves; ArrowUp moves; Enter picks the active option or commits the typed text; Escape closes, or reverts if closed.
  - Options pick on `mouseDown` with `preventDefault`.
  - A pick commits once and sets a ref, so the following blur does not commit again (Review Focus 4).
  - A typed value equal to `value` does not call `onCommit`, so blurring an untouched field never asks the confirm.
  - When `onCommit` returns false (confirm cancelled), the input shows `value` again.
  - The typed value is parsed with `parseNumber` and checked against `bounds`. Out of range refuses with `` `${n}° is outside ${min}–${max}° for this span.` `` and reverts.
  - `°` is shown as a suffix outside the input, like `DimensionField`'s unit.
  - `issuePath` goes on the outer div as `data-issue-path`.

- [ ] **Step 1: Write `PitchCombobox.tsx`** to the interface above.

- [ ] **Step 2: Replace the slider in ShedGroup**, with:
  - `id="shed-roofPitchDeg"`;
  - `value={config.roofPitchDeg > 0 ? config.roofPitchDeg : null}`;
  - `hints={pitchHints}`, `bounds={pitchBounds}`;
  - `onCommit={(deg) => applyDimension({ roofPitchDeg: deg })}`;
  - `error={errorAt('shed-roofPitchDeg')}`;
  - `note` = the existing unlisted/attention or "book sells" sentence.
  - Delete the `<datalist>`, `<output>` and range input. The local `roofPitchBoundsForSpan` call is replaced by the hook's `pitchBounds`.

- [ ] **Step 3: Replace the popover select**, with:
  - `id="sitecheck-params-roofPitchDeg"`, `issuePath="shed-roofPitchDeg"`;
  - `hints={roofPitchHints}`;
  - `bounds` = `pitchBounds` from the popover's existing `useShedDimensions` call (:63);
  - the same `onCommit`.
  - Keep the "No pitches in the book for this span." note as `note` when the hints are empty. Delete `pitchOptions`.

- [ ] **Step 4: Typecheck.** Expected: exit 0.

- [ ] **Step 5: Browser check:**
  - The `#shed-roofPitchDeg` role is `combobox`. Clicking the toggle shows options matching the book's hints for the span.
  - With a cantilever placed, count confirm calls with a stub returning true. Open the list, `mouseDown` an option, then blur the input: the count is 1 and the store pitch is that option.
  - Type `7,5` and press Enter: the store reads 7.5.
  - Type `40` and blur: a refusal names the span's range, the box shows the stored pitch, and the count did not grow.
  - With the stub returning false, pick a different option: the box shows the stored pitch again.
  - Open the Building parameters popover. `#sitecheck-params-roofPitchDeg` is a combobox showing the same pitch.
  - Restore everything. Save nothing.

- [ ] **Step 6: Ledger line.**

---

### Task 5: Docs and the full check

**Files:**
- Modify: `docs/smartquote-quote-editor-reference.md`. Add a new §13 entry after the part 3 one (§13.42) describing:
  - commit on blur or Enter for the five fields;
  - "type 0 to remove" for the cantilever;
  - the pitch combobox in both places;
  - the book's limits as the validator's, including bay size checked on the largest bay;
  - the list of e2e lines that will fail, from the spec's "Known effects": `stepOne.spec.ts:144, :914, :974, :1037, :439, :751, :259, :797, :859`.
- Modify: `docs/state/step1-input-behaviour.md` (ledger).

- [ ] **Step 1: Write the reference entry** in the document's own language (Vietnamese), with the content above.
- [ ] **Step 2: Run all client tests.** Run the all-client-tests command. Expected: every file passes.
- [ ] **Step 3: Build.** Run the build command. Expected: `Compiled successfully` and exit 0.
- [ ] **Step 4: Final ledger line**, then the whole-change review the execution skill prescribes.
