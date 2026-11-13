# Step 1 errors and control heights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/quotes/new` Step 1, a field's error appears only after the person leaves that field (or tries Save / Next), it is one short line, and every control is 44 px tall.

**Architecture:** `QuoteEditor` keeps a `touched` set and filters `issuesByPath` before it reaches `QuoteDetailsPanel`, so inline errors and the "N to fix" badges read one filtered map. `DraftIssue` gains a `short` line for inline use; `message` stays for `ErrorSummary`. Heights are a class sweep over the Step 1 files.

**Tech Stack:** Next.js client (`apps/client`), React, Tailwind with `sq-` tokens, zustand stores.

**Spec:** `docs/superpowers/specs/2026-11-13-step1-errors-layout-design.md`

## Global Constraints

- Tests are off (CLAUDE.md): no new test files. Verify each task with typecheck, the existing `validation.test.ts`, and the browser (DOM checks through `javascript_tool`; screenshots time out in this pane).
- No commits, branches or worktrees. Never push.
- Use `http://localhost:3061`, never `127.0.0.1`.
- Steps 2 and 3 (`CostPanel`, `CategoryDock`) keep their sizes.
- What the rules check in `validation.ts` does not change — only the text and when it shows.
- Ranges stay in mm, even when the Shed group shows metres.
- Touch targets: `min-h-11` (44 px), matching `@sq/ui` `Field` (`design-system/smartquote-v2/MASTER.md` line 110).
- `docs/smartquote-quote-editor-reference.md` is corrected in the same change.
- e2e `stepOne.spec.ts:94-96` asserts the long messages and will fail. It is not edited (tests=off); the closing message says so.

Commands:
- Typecheck: `pnpm --filter @sq/client-app typecheck 2>&1 | Select-String "error TS"; "exit: $LASTEXITCODE"` → no `error TS` lines, `exit: 0`.
- Unit (existing file): `pnpm --filter @sq/client-app exec vitest run src/components/editor/__tests__/validation.test.ts` → all pass.

## Review Focus

1. **Blocked Save / Next with nothing red.** Today both buttons are `disabled` while issues exist, so a "Save / Next attempt" can never happen. With errors hidden until blur, someone who has not touched the empty fields would see a dead button and no red fields. Expected: a press reveals everything (Task 2, Step 3).
2. **Badges vs fields.** After blurring one empty field in "Quote & client", the header says "1 to fix" and exactly that field is red — not "3 to fix" (Task 2, Step 5).
3. **Composite controls.** Leaving a cantilever input, a colour row, or the popover's span/height/length marks the right issue path as touched (Task 2, Step 2 mapping; Step 5 check).
4. **Opened saved quote.** `/quotes/<id>/edit` with a problem shows it at once, with no blur needed (Task 2, Step 1).
5. **375 px phone.** After the height change: no horizontal scroll, and a one-line error does not wrap past two lines (Task 4).

---

### Task 1: Short inline lines and trimmed summary messages

**Files:**
- Modify: `apps/client/src/components/editor/validation.ts` (`DraftIssue` :32-37, header comment :26-28, every `issues.push`)
- Modify: `apps/client/src/components/editor/details/{CustomerGroup,SiteGroup,DeliveryGroup,DesignGroup,ShedGroup}.tsx` — each `errorAt` line (`issuesByPath.get(path)?.message` → `?.short`)
- Modify: `apps/client/src/components/editor/details/ColourGroup.tsx:295` (`?.message` → `?.short`)

**Interfaces:**
- Produces: `interface DraftIssue { path: string; short: string; message: string }`. `short` is the inline line (no field name, ≤ ~30 chars); `message` names the field and is what `ErrorSummary` lists. `ErrorSummary.tsx` is unchanged.

- [ ] **Step 1: Add `short` to `DraftIssue` and give every issue its two texts**

Use exactly these. `<min>`/`<max>` come from `LIMITS`; numbers stay interpolated as today.

| path | case | `short` | `message` |
|---|---|---|---|
| `customer-firstName` | missing | `Required` | `Enter the customer’s first name.` |
| `customer-lastName` | missing | `Required` | `Enter the customer’s last name.` |
| `customer-email` | missing | `Required` | `Enter the customer’s email address.` |
| `customer-email` | invalid | `Missing @ or domain` | `That email address is missing an @ or a domain.` |
| `customer-address` | missing | `Required` | `Enter the customer’s address.` |
| `site-address` | missing | `Required` | `Enter the site address.` |
| `site-deliveryAcknowledged` | not ticked | `Tick to confirm` | `Tick that the delivery terms have been read.` |
| `shed-span` / `-length` / `-height` | missing | `Required` | `Enter the span.` / `Enter the overall length.` / `Enter the wall height.` |
| `shed-span` + `shed-height` | span ≥ 12 m, walls < 3 m | `Span ≥ 12 m needs walls ≥ 3 m` | unchanged (both sentences say what to do) |
| `shed-span` | range | `<min>–<max> mm` | `Span must be between <min> mm and <max> mm.` |
| `shed-length` | range | `<min>–<max> mm` | `Overall length must be between <min> mm and <max> mm.` |
| `shed-height` | range | `<min>–<max> mm` | `Wall height must be between <min> mm and <max> mm.` |
| `shed-roofPitchDeg` | range | `<min>–<max>°` | unchanged |
| `shed-bays` | range | `<min>–<max>` | unchanged |
| `shed-bays` | uneven division | `Bays don’t divide equally` | unchanged |
| `shed-nomBaySpacing` | mismatch | `Spacing × bays ≠ length` | unchanged |
| `options-<id>` | no longer fits | `problem.reason` | `problem.reason` |
| `design-cantilever` | over limit | `Max <CANTILEVER_LIMIT_MM> mm on a standard building` | unchanged |
| `design-stateCode` | missing | `Required` | `Choose the state.` |
| `colours-<role>` | missing | `Required` | `Choose a colour for the <role>.` |

The "unchanged" rows keep their second sentence because it says what to do, not why — the spec drops only "why" sentences. It also keeps `validation.test.ts:105-106,112,139-140` meaningful (they look for the numbers and for "Change the spacing or the bay count").

Rewrite the header's "Why the messages are sentences" paragraph: inline lines are short because the field label is beside them; the summary sentence names the field because it is read away from it. Drop the comment at :197-198 ("say why it cannot be skipped") — it now contradicts the code.

- [ ] **Step 2: Point every inline error at `short`**

The five `errorAt` helpers and `ColourGroup.tsx:295`. No other file reads `.message` from `issuesByPath` (Grep `\.message` in `details/` to confirm: only those six).

- [ ] **Step 3: Verify**

Run the typecheck command → `exit: 0`, no `error TS`.
Run the unit command → all tests pass (none assert the dropped "why" text).
Grep `validation.ts` for `The price is built|cannot be delivered|not a formality|Check it before|measured inside the columns|appears on the quote` → no matches.

---

### Task 2: Show an issue only after the field is left, or after Save / Next

**Files:**
- Modify: `apps/client/src/components/editor/QuoteEditor.tsx` — state near :117, `issuesByPath` :237-241, Save button :744-752, Next button :934-941, the wrapper around `<QuoteDetailsPanel>` near :868
- Modify: `apps/client/src/components/editor/details/DesignGroup.tsx:532` (cantilever inputs)
- Modify: `apps/client/src/components/editor/details/ColourGroup.tsx` (the per-role row wrapper that holds the button at :182 and the palette at :224)
- Modify: `apps/client/src/components/editor/details/BuildingParamsPopover.tsx:223,233,243` (popover span / height / length)

**Interfaces:**
- Consumes: `DraftIssue` from Task 1 (only `path` matters here).
- Produces: `QuoteDetailsPanel` still takes `issuesByPath: Map<string, DraftIssue>` — now the *visible* subset. No prop changes on any group. `ErrorSummary` still gets the full `issues`.
- Produces: the attribute `data-issue-path="<issue path>"` — on an element whose own id is not its issue path, it names the path that leaving it touches.

- [ ] **Step 1: `touched` state, and an opened quote starts revealed**

```ts
const [showIssues, setShowIssues] = useState(initial !== undefined);
const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
```

A new quote and a template (`initial === undefined`) start clean.

- [ ] **Step 2: Mark a field touched when focus leaves it**

Wrap `<QuoteDetailsPanel …/>` in a `<div onBlur={markTouched}>`. React's `onBlur` bubbles through the React tree, so it also catches the popover. Handler:

```ts
const markTouched = useCallback((event: React.FocusEvent<HTMLElement>) => {
  const target = event.target as HTMLElement;
  const path = target.closest<HTMLElement>('[data-issue-path]')?.dataset.issuePath ?? target.id;
  if (path === '') return;
  setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
}, []);
```

Elements whose id is not their issue path get `data-issue-path`:

| element | id today | `data-issue-path` |
|---|---|---|
| cantilever inputs (`DesignGroup.tsx:532`) | `design-cantilever-front` / `-back` | `design-cantilever` |
| colour row wrapper (`ColourGroup`, holds button + palette) | none / `colours-<key>-palette` | `colours-<key>` |
| popover span / height / length | `sitecheck-params-spanMm` / `heightMm` / `lengthMm` | `shed-span` / `shed-height` / `shed-length` |

Every other issue path is already the focusable element's id (checked in the browser 2026-11-13: customer ×4, `site-address`, `shed-span/height/length/bays/nomBaySpacing/roofPitchDeg`, `design-stateCode`; `site-deliveryAcknowledged` is the checkbox's id at `DeliveryGroup.tsx:198`). `options-<id>` has no Step 1 control and only appears in the summary.

- [ ] **Step 3: A blocked Save / Next press reveals instead of doing nothing**

Ruling for the executor to ledger: both buttons are `disabled` while issues exist (`gate.blocked`, `issues.length > 0`), so the spec's "after a Save / Next attempt" cannot happen. Make that press possible:

- `const revealIssues = () => { setShowIssues(true); requestAnimationFrame(focusErrorSummary); }` — `focusErrorSummary` is already exported from `ErrorSummary.tsx:153`.
- Save: `disabled={gate.blocked && issues.length === 0}`; `onClick={() => (issues.length > 0 ? revealIssues() : void save())}`. Other gate reasons (no change, no price, saving) still disable it.
- Next: `disabled={evaluation === null}`; `onClick` reveals when `issues.length > 0`, else `goTo(...)` as today.
- Both keep `aria-describedby` / the reason line beside them unchanged.

- [ ] **Step 4: Filter what the panel sees**

```ts
const visibleIssuesByPath = useMemo(() => {
  const map = new Map<string, DraftIssue>();
  for (const issue of issues) {
    if (!showIssues && !touched.has(issue.path)) continue;
    if (!map.has(issue.path)) map.set(issue.path, issue);
  }
  return map;
}, [issues, showIssues, touched]);
```

Pass `visibleIssuesByPath` to `QuoteDetailsPanel`. Keep the unfiltered `issuesByPath` only if something else still reads it (Grep); otherwise replace it.

- [ ] **Step 5: Verify**

Typecheck → `exit: 0`.
Browser, fresh `http://localhost:3061/quotes/new` as E2ESHEDS/owner, via `javascript_tool`:
- On load: `document.querySelectorAll('[aria-invalid="true"]').length === 0`, and no group header text matches `/\d+ to fix/`.
- Focus `#customer-firstName`, then focus `#customer-lastName` → `#customer-firstName` has `aria-invalid="true"`; its error text is `Required`; "Quote & client" header shows `1 to fix`.
- Focus and leave `#design-cantilever-front` → no crash (no issue unless a cantilever exists); `touched` mapping verified by reading the attribute: `document.querySelector('#design-cantilever-front')?.closest('[data-issue-path]')?.dataset.issuePath === 'design-cantilever'`.
- Click Save (`button` with text `Save quote`) → it is not disabled, the summary heading `#error-summary-heading` exists and is `document.activeElement`, and every Step 1 issue field is red.

---

### Task 3: Every Step 1 control is 44 px

**Files (Step 1 only; all `min-h-[38px]`, `min-h-9`, `min-h-8` → `min-h-11`):**
- `apps/client/src/components/editor/DimensionField.tsx` (1 — the bordered wrapper reaches 44; the inner input stays borderless)
- `apps/client/src/components/editor/AddressField.tsx` (1)
- `apps/client/src/components/editor/details/SiteGroup.tsx` (1)
- `apps/client/src/components/editor/details/SiteCheckPin.tsx` (1 — `#sitecheck-status`)
- `apps/client/src/components/editor/details/CustomerGroup.tsx` (3)
- `apps/client/src/components/editor/details/ShedGroup.tsx` (9)
- `apps/client/src/components/editor/details/shared.tsx` (3 — `SelectField` and helpers)
- `apps/client/src/components/editor/details/ColourGroup.tsx` (1)
- `apps/client/src/components/editor/details/DesignGroup.tsx` (2)
- `apps/client/src/components/editor/details/DeliveryGroup.tsx` (1)
- `apps/client/src/components/editor/details/BuildingParamsPopover.tsx` (2 — `:31` select class, `:282` average-height output)
- Not touched: `CostPanel.tsx`, `CategoryDock.tsx`.

**Interfaces:** none (class changes only).

- [ ] **Step 1: Replace the classes in the files above**

Grep `min-h-\[38px\]|min-h-9\b|min-h-8\b` across `apps/client/src/components/editor` before and after; afterwards only `CostPanel.tsx` and `CategoryDock.tsx` may match. Where a small button also sets `py-*` that pushes it past 44, drop the `py-*` and centre with `items-center`.

The Task 4 ledger ruling of the SiteCheck plan ("importance and pitch use plain `<select>`s (compact, 38px)") is superseded here: they become 44 px too.

- [ ] **Step 2: Verify**

Typecheck → `exit: 0`.
Browser at 1024 px wide, `javascript_tool`:

```js
[...document.querySelectorAll('#customer-firstName, [id^="customer-"], [id^="site-"], [id^="shed-"], [id^="design-"], #sitecheck-status, #sitecheck-pin')]
  .filter((e) => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, button'))
  .map((e) => [e.id, Math.round((e.closest('[data-dimension-field]') ?? e).getBoundingClientRect().height)])
  .filter(([, h]) => h < 44)
```

Expected: `[]` — except the three dimension inputs, which are measured on their wrapper (if `DimensionField` has no stable wrapper hook, measure `e.parentElement` for `shed-span/height/length`). Also check the buttons by text: "Copy from customer", "Use the suggested values", "Adjust bay spacing", "Assign wall colour to all", and the mm/m toggles → each `getBoundingClientRect().height >= 44`.

---

### Task 4: Phone check and reference doc

**Files:**
- Modify: `docs/smartquote-quote-editor-reference.md` (the validation / error section and §13 — add a §13.42 entry)

**Interfaces:** none.

- [ ] **Step 1: 375 × 812**

`resize_window` preset `mobile`, reload `/quotes/new`, press Save to reveal everything, then `javascript_tool`:
- `document.documentElement.scrollWidth <= window.innerWidth` → true.
- Every visible inline error element (`[id$="-error"]`): `Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) <= 2`.
Reset with preset `desktop` afterwards.

- [ ] **Step 2: Update the reference doc (Vietnamese, matching its style)**

Record: errors appear after leaving a field or after pressing Save / Next; an opened saved quote shows them at once; Save / Next stay pressable while fields are missing and a press shows the summary; the inline line is short (the table's `short` column) while the summary sentence names the field; Step 1 controls are 44 px. Replace any text that says errors show on load or quotes the old long messages.

- [ ] **Step 3: Final check**

Typecheck → `exit: 0`. Unit command → pass. `pnpm --filter @sq/client-app build` → exit 0 (dev server keeps serving).
