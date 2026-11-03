# Design System — SmartQuote v2

> **When building a page:** check `pages/<page>.md` first. If it exists its rules override
> this file. Otherwise follow this file exactly.

**Category:** construction / B2B SaaS · **Dials:** variance 4/10 (balanced), motion 3/10
(subtle), density 8/10 (dense dashboard).

---

## 0. Three directions, and why direction A is the default

`ui-ux-pro-max --design-system` proposed **trust blue `#2563EB` + orange `#EA580C` +
glassmorphism**. That direction was **already reviewed and rejected** for this product
(project memory: the navy/gold palette already passes AA, and a frosted-glass surface over
a dense BOM table costs contrast and legibility for nothing). It is not used as the default.
Three grounded alternatives were prepared instead.

| | Direction | Character | Verdict |
|---|---|---|---|
| **A** | **Navy / Gold — "Instrument"** (default) | Deep navy `#071832` chrome, gold `#F4CF75` accents, near-white working surfaces, tabular numerals. Reads as a measuring instrument: quiet chrome, loud data. | **Default.** Highest contrast on a dense table, already AA-verified, carries over from the existing product so nothing has to be re-learned. |
| B | **Graphite / Signal — "Control room"** | Neutral graphite `#1C1F24` chrome, a single saturated signal colour per state (amber = needs attention, teal = priced, red = blocked), no decorative colour at all. | Credible, but a fully neutral palette makes "attention" and "brand" the same visual weight, and the gold accent currently does that job. |
| C | **Slate / Copper — "Workshop"** | Warm slate `#2A2E35`, copper `#B87333`, generous white space, a serif display face for headings. | Best for the marketing `site`, too soft for a 40-column BOM at 12 px. |

Direction A is implemented. Switching later is a token-file change, not a component
rewrite, provided no component hardcodes a hex value.

---

## 1. Colour

Semantic tokens only. **No component may use a raw hex**; that is what makes direction B or
C a one-file change.

| Role | Value | Token | Notes |
|---|---|---|---|
| Brand (chrome, nav, headers) | `#071832` | `--sq-brand` | Navy. |
| Brand hover | `#0D2A52` | `--sq-brand-hover` | |
| Brand raised surface | `#12294A` | `--sq-brand-soft` | Cards sitting directly on brand. |
| Accent (focus, active, brand emphasis) | `#F4CF75` | `--sq-gold` | Gold. **Text on navy only** — gold on white fails contrast. |
| Accent deep (gold text on light) | `#8A6A1F` | `--sq-gold-deep` | Use this, not `--sq-gold`, for gold-coloured *text* on white. |
| Ground (page background) | `#F6F7F9` | `--sq-ground` | |
| Surface (card) | `#FFFFFF` | `--sq-surface` | |
| Line / border | `#E2E8F0` | `--sq-line` | |
| Ink (primary text) | `#0F172A` | `--sq-ink` | |
| Ink muted | `#475569` | `--sq-ink-muted` | |
| Needs attention | `#B45309` | `--sq-attention` | **Amber is reserved for "needs attention". It is never brand.** A quote with a mocked price, a clamp notice, or an unacknowledged caveat. |
| Blocked / destructive | `#B91C1C` | `--sq-danger` | |
| Priced / confirmed | `#15803D` | `--sq-ok` | |
| Info | `#1D4ED8` | `--sq-info` | |

**Contrast rules that are not negotiable**

- Body text on `--sq-ground` or `--sq-surface`: ≥ 4.5:1 → use `--sq-ink` or `--sq-ink-muted`.
- Text on `--sq-brand`: use `#FFFFFF` or `--sq-gold`. Nothing else.
- Never gold text on white. Use `--sq-gold-deep`.
- Status is never conveyed by colour alone: every attention/blocked state also carries an
  icon or a word. Colour-blind users read the BOM too.

## 2. Typography

**System stack, no `next/font`, no Google Fonts import at build time.** The build must
work offline.

```css
--sq-font-sans: Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
--sq-font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace;
```

| Use | Face | Size / line | Notes |
|---|---|---|---|
| Body | sans | 14 px / 1.5 | 16 px on the end-customer site |
| Label / field label | sans 500 | 12 px / 1.35 | Uppercase only for group headings |
| Group heading (Quote Details) | sans 600 | 13 px / 1.4 | Letter-spaced 0.04em |
| Numeric data — mm, quantities, money | **mono** | 13 px / 1.4 | `font-variant-numeric: tabular-nums`. A BOM column that does not align cannot be checked. |
| Money headline (contract price) | mono 600 | 24–28 px | |
| Never | — | < 12 px body | A 10 px requirement code is a defect, not density. |

## 3. Spacing and density

Density 8/10 — a dashboard, not a landing page. Base unit 4 px.

| Token | Value | Usage |
|---|---|---|
| `--sq-space-1` | 4 px | Icon-to-label |
| `--sq-space-2` | 8 px | Field inner padding, table cell |
| `--sq-space-3` | 12 px | Card padding (dense), table row height 36 px |
| `--sq-space-4` | 16 px | Group padding |
| `--sq-space-6` | 24 px | Section separation |
| `--sq-space-8` | 32 px | Page gutter |

Breakpoints: 375 / 768 / 1024 / 1440. The quote editor collapses to one column below
1024 px, and the 2D canvas becomes a bottom sheet (`vaul`), never a horizontal scroll.

## 4. Motion

Subtle (3/10). Duration 150–250 ms, `cubic-bezier(0.2, 0, 0, 1)`.

- Hover/focus: 150 ms. Panel open: 200 ms. Route transition: none — this is a tool.
- **`prefers-reduced-motion: reduce` disables every transform and every animation** and
  renders the final state. This is not optional.
- `requestAnimationFrame` is never scheduled in some automation environments; anything
  load-bearing must use `setTimeout`, never a frame callback.
- A price update must **not** animate the number. A number that counts up cannot be read.

## 5. Component rules

- **Focus**: visible ring, 2 px `--sq-gold` offset by 2 px on dark, 2 px `--sq-brand` on
  light. Never `outline: none` without a replacement.
- **Touch targets**: ≥ 44 × 44 px on anything reachable by a thumb. The editor is used on
  a tablet at a customer's table.
- **Icons**: SVG (hand-drawn 24 × 24 set, stroke 1.75). **No emoji as icons.** Every
  icon-only button carries an `aria-label`.
- **Tables**: sticky header, 36 px rows, right-aligned numerics, `tabular-nums`, zebra via
  `--sq-ground` at 40 % — not a border per cell.
- **Inputs**: label above, never placeholder-as-label; error text directly under the field
  in `--sq-danger` with an icon; helper text in `--sq-ink-muted`.
- **Money and millimetres** render through one formatter. No component formats a number by
  hand — two formatters is how `1,234` and `1234` end up in the same document.
- **Empty states** say what to do next, not "no data".
- **Loading**: skeleton with reserved space (CLS < 0.1). Never a layout jump when a price
  arrives.

## 6. The three sites, one system

| | `client` | `admin` | `site` |
|---|---|---|---|
| Brand surface | Navy chrome, gold active indicator | Navy chrome, denser (36 px rows) | Navy hero, white body |
| Density | 8/10 | 9/10 | 3/10 |
| Body size | 14 px | 14 px | 16 px |
| Motion | 3/10 | 2/10 | 5/10 |
| Character | Instrument | Control room | Trustworthy, plain-spoken |

The `site` may be lightest and warmest; it must never look like a different product. Same
tokens, different density.

## 7. Pre-delivery checklist

- [ ] No emoji as icons; icons are SVG with labels where icon-only
- [ ] Every clickable element has `cursor: pointer` and a visible hover state (150–300 ms)
- [ ] Body text ≥ 4.5:1 against its background; gold never on white
- [ ] Focus visible on every interactive element, keyboard-reachable
- [ ] `prefers-reduced-motion` renders the final state instantly
- [ ] 375 / 768 / 1024 / 1440 checked; **no horizontal scroll at 375**
- [ ] Numeric columns right-aligned, tabular figures, one formatter
- [ ] Status never colour-only
- [ ] No raw hex in a component
