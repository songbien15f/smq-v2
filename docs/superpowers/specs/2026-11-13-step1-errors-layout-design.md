# Step 1 — errors and control heights (Part 3 of the /quotes/new improvement)

Short design. Size: a small change. Approved approach: "One filter at the top" (user, 2026-11-13).

## Why

The user's words: error and required messages "take too much space and look ugly", and the controls
"feel unbalanced". Measured on a fresh `/quotes/new` (1024 px wide, nothing typed):

- 7 inline errors are already showing; four group headers already say "N to fix".
- The span error is 6 lines tall (108 px); height and length are 5 lines each.
- Inputs come in 29 / 38 / 44 px, selects in 38 px, buttons in 32 / 36 / 44 px.

Cause of the first point: `QuoteEditor` passes every issue to the panel from the first render
(`issuesByPath`, `QuoteEditor.tsx:237`); only the `ErrorSummary` waits for a save attempt
(`showIssues`, `QuoteEditor.tsx:777`).

## Goals

1. A field's error appears only after the person has left that field, or after a Save / Next attempt.
2. The inline error is one short line.
3. Every control on Step 1 is 44 px tall.
4. Step 1 still works at 375 px with no horizontal scroll.

## Non-goals

- Steps 2 and 3 (`CostPanel`, `CategoryDock`) keep their sizes.
- What the rules check (`validation.ts` logic) does not change — only when and how the result shows.
- Input behaviour (number commits, pitch confirm, bounds) is Part 4.
- The deferred SiteCheck minors stay deferred.

## Anti-goals

- A group header that says "3 to fix" while no field in it is red (or the reverse).
- An error hidden after a save attempt: once Save / Next has been pressed, everything shows.
- A summary entry that reads only "Required" — it must say which field.

## Approaches

1. **One filter at the top (chosen).** `QuoteEditor` keeps the set of field paths the person has
   left, plus the existing `showIssues`. The panel receives only the issues that may show. Inline
   errors and the "N to fix" badges read the same filtered map, so they cannot disagree.
2. Each field hides its own error until blurred. Less plumbing, but the badges and the save attempt
   still need a shared flag — two rules that can drift apart. Rejected for that reason.
3. Errors only after Save. Rejected: contradicts "after leaving the field", agreed earlier.

## Design

### When an error shows

- `QuoteEditor` holds `touched: Set<string>`. An issue is visible when `showIssues` is true **or**
  its `path` is in `touched`. The panel gets the visible subset as `issuesByPath`; the
  `ErrorSummary` keeps getting the full list, as today.
- Marking a field touched: **one** `focusout` listener on the Step 1 panel root adds `event.target.id`
  to `touched`. This works because an issue's `path` is already the field's element id — the
  `ErrorSummary` focuses fields by `document.getElementById(path)` (`ErrorSummary.tsx:51`). No
  per-field wiring.
- Builder's check: a field whose focusable element id differs from its issue path (e.g. a composite
  control, the delivery-terms tick, the colour pickers) must be found and handled — either give the
  element the path as its id or map it in the listener. List them in the plan.
- An existing quote opened for editing starts with `showIssues = true` (my call: a problem on a saved
  quote is something to fix now, not a half-typed field). A new quote and a template start clean.

### Message text

- `DraftIssue` gains `short: string` — the inline line. The groups' `errorAt` shows `short`.
- `message` stays for the `ErrorSummary`, trimmed to its first sentence (it names the field). The
  "why" sentences are dropped everywhere ("A shed cannot be delivered without…", "The price is built
  from the building's dimensions…", "It is the customer's acknowledgement…", "Check it before the
  quote is sent", "This is the clear width…").
- Short forms:

| Issue | `short` | `message` |
|---|---|---|
| any missing required value | `Required` | `Enter the <field>.` / `Choose the <field>.` |
| email without @ or domain | `Missing @ or domain` | `That email address is missing an @ or a domain.` |
| delivery terms not ticked | `Tick to confirm` | `Tick that the delivery terms have been read.` |
| span / length / height out of range | `<min>–<max> mm` | `<Field> must be between <min> mm and <max> mm.` |
| pitch out of range | `<min>–<max>°` | `Roof pitch must be between <min>° and <max>°.` |
| bays out of range | `<min>–<max>` | `Number of bays must be between <min> and <max>.` |

  Ranges stay in mm even when the Shed group shows metres (my call: the limits are defined in mm and
  the field shows its unit beside it; converting is Part 4's input work).

### Control heights

- Every input, select and button on Step 1 is 44 px (`min-h-11`, matching `@sq/ui` `Field`):
  `details/*`, `DimensionField`, `AddressField`, `SiteCheckPin` status line, the Building parameters
  popover's selects, the mm / m toggle, and the small secondary buttons ("Copy from customer", "Use
  the suggested values", "Adjust bay spacing", "Assign wall colour to all").
- `DimensionField`'s inner input is 29 px inside a bordered wrapper; the **wrapper** is what reaches
  44 px.
- Reason for 44 over 38: `design-system/smartquote-v2/MASTER.md` touch targets ≥ 44 px (the editor
  is used on tablets on site). Cost: the form grows about 100 px.

### Mobile

- Check 375 × 812 after the height change: no horizontal scroll, two-column rows still fit or stack,
  the one-line errors do not wrap past two lines.

## Constraints

- Tests are off (CLAUDE.md): verify with typecheck and the browser. e2e `stepOne.spec.ts:94-96`
  asserts the long messages and will fail; it is rewritten when tests are turned on, with the nine
  SiteCheck §6 tests.
- No commits.
- `docs/smartquote-quote-editor-reference.md` is corrected in the same change (when errors show,
  the short forms).

## Left to the builder

- Exact Tailwind classes, and whether the 44 px lives in a shared constant.
- The list of fields whose id ≠ issue path, and how each is mapped.
- Wording of each `Enter the <field>.` sentence, keeping the field names the labels use.
