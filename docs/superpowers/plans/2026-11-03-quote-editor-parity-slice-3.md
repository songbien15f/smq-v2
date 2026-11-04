# Quote editor parity — Implementation plan, slice 3

**Goal:** a `misc_option` line the operator can add and the BOM prices from the book's `misc_option` catalogue.

**Spec:** `docs/superpowers/specs/2026-11-03-quote-editor-parity-design.md` §3.2 category 13, §5.3.

## Scope rulings (recorded)

- `track` is **not** a new `ShedOption` kind: a sliding door already owns its `track` (`Opening.track`, `single|double`). A separate object would be a second source of truth for the same hardware. The Step 2 "Track" category becomes a view over sliding doors in slice 7.
- `extra_charge` is **not** a new kind: `pricing.extraCents` and the Cost panel's `charges` table already model it, including the "adds after the margin" chain. Promoting it to an option would double-count. The Step 2 category moves to that existing mechanism in slice 7.
- `engineering_charge` is **not** a new kind: `pricing.engineeringCents` is added after the kit (desktop formula), and the book's 5 engineering SKUs become a dropdown over that field in slice 7. Putting it in the BOM would run it through the margin and GST, which the desktop does not.
- `misc_option` **is** a new kind: these are physical accessories (insulation, bird proofing, screens) sold per unit and priced from `misc_option.price`; they belong in the BOM so the margin recovers them, exactly like the ShedSafe fee already does.

## Task 1: `misc_option` in the domain

**Files:** `packages/core/src/domain/types.ts`, `options.ts`, `schema.ts`, `selection.ts`, `optionRules.ts`; test `packages/core/src/domain/__tests__/miscOption.test.ts`.

- `interface MiscOption { kind: 'misc_option'; name: string; quantity: number; unit: string }`; add to `OptionKind` and `ShedOption`.
- `defaultOptionsFor('misc_option')` → `{ name: '', quantity: 1, unit: 'ea' }`.
- `normaliseOption`: trim `name` (max 120), `quantity` clamp 1..999 integer, `unit` default `'ea'`.
- `hasPlanGeometry(kind): boolean` — false for `misc_option`; `resolveOptions` filters it out; `optionsThatNoLongerFit` skips it.
- Schema: tolerant + complete discriminated-union arms; id prefix `mo`; `coerceToMillimetres` returns it unchanged (quantity is not a length).
- `selection.ts`: title `Miscellaneous option`, group `interior`? → new group `extras`; fields Name (text via `type: 'select'`? no) — `FieldSpec` has no text type, so expose Quantity (number) only; the name is chosen from the catalogue in the UI and edited in the popover as a select once the catalogue is loaded. For slice 3 expose `quantity` and `unit`.

## Task 2: BOM

**Files:** `packages/core/src/lib/bom/build.ts`, `packages/core/src/lib/bom/options.ts`; test `packages/core/src/lib/bom/__tests__/miscOptions.test.ts`.

- `optionLines` gets `case 'misc_option': break;` (not an `option`-group material).
- `build.ts` appends one line per misc option to the `misc` section:
  `lookup.miscOption(option.name)` → line `{ group:'misc', code, description: option.name, unit, quantity, unitCost, massKg }`.
  Unknown name → no line, plus an issue `MISC_OPTION_UNKNOWN` (severity `assumption`) naming it.
- The ShedSafe fee stays; it is not an option.

## Task 3: surfaces

**Files:** `apps/client/src/components/editor/PlanPanel.tsx` (summary + list already generic), `packages/core/src/lib/documents/projection.ts`; test in the domain test file for `resolveOptions`.

- `optionSummary` case: `` `${option.quantity} × ${option.name}` ``.
- Document `inclusions` already lists options generically if it does; verify and, if it switches on kind, add a case.
