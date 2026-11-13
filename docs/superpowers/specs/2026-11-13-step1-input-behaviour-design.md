# Step 1 input behaviour: number commits, roof pitch combobox, one set of bounds

Part 4 of the `/quotes/new` improvement (parts 1–3: split panel, SiteCheck PIN, errors and layout).

## Why

People typing on Step 1 run into three things today:

1. **Some fields apply what you type on every keystroke.**
   - Typing 5000 into nominal bay spacing recalculates the length at 5, 50, 500 and 5000.
   - Clearing a cantilever to retype it sets it to 0, which removes the cantilever.
   - With options placed, each keystroke in Bays can bring up the "removes every option" confirm again.
2. **The roof pitch slider asks for confirmation repeatedly.** With options placed, the confirm appears on every 0.5° step of a drag.
3. **Three sources of size limits disagree.**
   - The validator says span 2000–30000.
   - The book says span 1800–15000.
   - The span field accepts 1900, and then the form says "2000–30000 mm".
   - A template or import with a 20000 span passes the validator and is priced as an assumption.

Also: when the confirm is cancelled, a dimension field keeps showing the number that was typed while the quote keeps the old one.

The goal is a form that behaves one way everywhere: a value counts once you leave the field, each confirm is asked once, and one set of limits decides what is valid.

## Decisions taken with the user

- **A size outside the price book blocks saving.** Answered "Block saving", 2026-11-13. A price for a building the book cannot price is wrong, and the field input already refuses values outside the book.
- **The check is in the form only (approach A), not in the API.** Every path that saves a quote goes through the form. A quote imported from the desktop with an out-of-book size still opens: the field is red and the quote can be saved once the field is fixed. No data is lost.
- **Roof pitch is a combobox whose value can be edited.**
  - It is no longer a slider.
  - The user said: "pitch: là combobox nhé nhưng có thể edit được value" ("pitch: make it a combobox, but the value can be edited").
  - The list holds the angles the book offers for this span, and any number can be typed.
  - This matches the desktop's editable dropdown (`GetHintListRoofPitch`, `ShedConfigCombo.cs:66-102`).

## Goals

- These fields commit on blur or Enter only: Bays, Nominal bay spacing, each bay width, Front/Back cantilever, and Quote rate %.
  - Escape, or leaving the field empty, restores the stored value.
  - Text that is not a number is never written to the quote.
- The roof pitch combobox commits on picking from the list, on Enter, or on blur.
  - The wipe confirm is asked **at most once per commit**, and never while typing.
- When the confirm is cancelled, every field (dimension fields, the pitch combobox and the fields above) goes back to showing the stored value.
- The validator takes **span, height and roof pitch** limits from the book when the catalogue is loaded, and also **bay size**.
  - A value outside those limits is an issue with the field's path, a short text like `1800–15000 mm`, and a full message naming the limit.
  - It blocks Save and Next in the same way as every other issue from part 3.

## Non-goals

- No API change.
  - The API keeps its loose schema (pitch 0–45°, positive sizes; `packages/core/src/domain/schema.ts:120`).
  - Import keeps accepting what it accepts today.
- No change to Length or Bays count limits. The book states neither, so the validator keeps 2000–120000 mm and 1–30.
- No change to the "between the pitches this book lists … prices as an assumption" note.
  - A pitch inside the book's min–max but not one of the listed angles stays a **warning**, not an error.
  - The desktop allows it (editable dropdown).
- No new tests (tests are opt-in for this repo). The existing `validation.test.ts` is updated where its expectations change.

## Anti-goals

- **Clamping a typed value to the limit.** It produces a building nobody described; refuse it and say why (the rule `DimensionField` already follows).
- **Two messages for one limit.** The field's refusal and the validator's issue must name the same numbers.
- **Breaking a saved quote.** Opening a quote with an out-of-book size must still work. Only saving it is blocked.

## Bounds: where each limit comes from

| Field | Book loaded | Catalogue not yet loaded |
|---|---|---|
| Span | `catalogue.dimensions.span.min/max` | 2000–30000 (today's `LIMITS`) |
| Height | `catalogue.dimensions.height.min/max` | 2000–12000 |
| Roof pitch | `roofPitchBoundsForSpan(catalogue.roofPitchGroups, span)` when span is set, else `catalogue.dimensions.roofPitch` | 0–45 |
| Bay size | `catalogue.dimensions.baySpacing.min/max`, checked against the **largest bay** | not checked |
| Length | 2000–120000 always | same |
| Bays count | 1–30 always | same |

**Why bay size is a hard limit.** The desktop's shed-config lookup keeps only rows with `BayMin <= bay <= BayMax`, and the same for span, height and roof pitch (`ShedConfigCache.cs:47-54`). A bay outside the book therefore finds no config row to price from. That is the same "cannot price" case the user chose to block.

- The bay checked is the largest one: `bayWidths` when the bays are uneven, otherwise `length / bays`.
- The desktop keeps a `BayLargest` (`ServiceStructureData.cs:382-386`) and splits the length so no bay exceeds `BayMax` (`ServiceStructureData.cs:313-324`).
- **Not yet checked:** which bay value the desktop actually passes to that lookup.
- **Consequence:** the 4000/4000/6000 example in the comment at `validation.ts:279` becomes red on a book whose bay max is 4000. That comment should be reworded, because the uneven-bays rule itself is unchanged.

**Issue paths for bay size:**
- Even bays: `shed-nomBaySpacing`. If the existing "Spacing × bays ≠ length" issue on that path also fires, the size issue comes first.
- Uneven bays: `shed-bayWidth-<i>` for each bay outside the limits.

**One source for the numbers.** The book's numbers reach both places from the same function:
- the inputs' own limits (`useShedDimensions` bounds, the input `max` for bay spacing and bay widths, today 20000);
- the validator.

A field that still says "max 20000" where the book says 4000 is what this part removes.

## Approaches considered

- **A. Form only (chosen).**
  - `validateDraft`'s existing `book` argument, already used for the cantilever rule, gains the dimension limits.
  - Fewest files; the API is untouched.
  - Cost: a direct API call can still save an out-of-book size.
- **B. Form and API.**
  - One check in `@sq/core`, called by the form and by the save route.
  - Guarantees no out-of-book quote is saved.
  - Cost: import would refuse such files instead of letting the user fix them; there is route and two-driver test work; quotes saved earlier could be blocked.
  - Rejected for now. It is worth doing once something other than the form writes quotes.

## Shape of the change

- **A commit-on-blur number input**, shared by Bays, spacing, bay widths, cantilever and quote rate.
  - It holds its own text and resyncs from the stored value when not focused (the `DimensionField` pattern).
  - Blur or Enter commits a finite number within its min/max. Out of range, it refuses with a sentence.
  - Escape, or an empty field, reverts.
- **Cancel reverts the field.** `onCommit` may report that the value was not taken (the wipe confirm was cancelled), and then the field shows the stored value again.
  - `applyDimension` / `applyBays` return whether they applied.
  - `DimensionField` uses the same contract.
- **The roof pitch combobox** follows the ARIA combobox pattern already in `AddressField.tsx`:
  - a text input with `role="combobox"`, a button that opens the list, and a listbox of the book's angles for this span;
  - arrow keys, Enter and Escape work as they do there.
  - It replaces the slider (`ShedGroup.tsx:809-867`) and keeps id `shed-roofPitchDeg`.
  - The Building parameters popover's pitch `<select>` (`BuildingParamsPopover.tsx:259-263`) becomes the same combobox, under its own id `sitecheck-params-roofPitchDeg`, with `issuePath="shed-roofPitchDeg"`.
- **The validator** reads the book's limits from its `book` argument and keeps `LIMITS` only as the fallback. The comment "Limits taken from the desktop's own accepted ranges" is replaced by the reason above.

## Known effects

- **The e2e specs need updating** (they are not run in this part):
  - `stepOne.spec.ts:144`, `:914`, `:974` and `:1037` drive the popover pitch with `selectOption`.
  - `:439` and `:751` drive the slider.
  - `:259`, `:797` and `:859` type into Bays or cantilever and expect an immediate effect, so they now need a blur or Enter.
- Record this in `docs/smartquote-quote-editor-reference.md` next to the part 3 note.
- Update `docs/smartquote-quote-editor-reference.md` in the same change, to describe: commit on blur, the pitch combobox, and the book's limits as the validator's.

## Left to the builder

- Component and file names. A file under `components/editor/` next to `DimensionField.tsx` is expected.
- Whether `DimensionField` is rebuilt on the new input or only gains the cancel-revert. Either works, as long as both behave the same.
- The exact wording of messages. They follow part 3's tone and name the limit, e.g. `Span must be between 1800 mm and 15000 mm for this price book.`
