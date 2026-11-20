# Page override — Guest `/quote` (`apps/site`)

> Overrides [MASTER.md](../MASTER.md) **for the Guest quote page only** (`apps/site` `/quote`, and the
> "My requests" pages that share its chrome). Every other page — editor, admin, the rest of
> `site` — stays on MASTER's navy/gold direction A. Spec: [quote-tiers-guest.md](../../../docs/specs/quote-tiers-guest.md).

**Source:** the user's reference template "Smart Solutions Australia Guest Login" and its step-by-step
guide (2026-11-18, kept outside the repo). Tokens are taken from that template. Two were changed
because they failed WCAG AA; the changes are marked ⚠ below.

**Why an override and not a MASTER change:** this page is a customer-facing branded form, not a
dense working surface. MASTER's rejection of blue/orange **glass** still holds here: no frosted
surfaces, no gradients behind text. The difference is only the brand palette and the display face.

---

## 1. Colour tokens

Scoped to the page root (`.guest-quote`), never `:root`, so they cannot leak into shared `@sq/ui`
components rendered elsewhere.

```css
.guest-quote {
  --g-red:        #E83238;  /* brand accent: borders, selected ring, icons, large display text only */
  --g-red-dark:   #C4232B;  /* primary button fill, error text — white on it is 5.80:1 */
  --g-navy:       #132C6E;  /* headings, summary bar, focus ring — 13.02:1 on white */
  --g-navy-deep:  #0B1D4D;
  --g-bg:         #F3F5F9;
  --g-surface:    #FFFFFF;
  --g-surface-2:  #EBEFF6;
  --g-line:       #D8DEE9;
  --g-ink:        #141E36;
  --g-ink-soft:   #46536F;  /* 7.05:1 on --g-bg */
  --g-ink-mute:   #5E6A86;  /* ⚠ template had #7C87A0 = 3.60:1 on white, fails; this is 5.41 / 4.96 on bg */
  --g-ok:         #177245;  /* 5.95:1 on white */
  --g-warn-bg:    #FFF4E0;
  --g-warn-line:  #E8B34B;
  --g-ai-bg:      #EEF2FB;  /* assistant panel + "wind check" note; --g-navy on it is 11.61:1 */
  --g-radius:     14px;
  --g-shadow:     0 10px 30px rgba(11, 29, 77, .10);
}

/* Dark: the same declarations go in BOTH selectors (OS preference unless the page forces light,
   and an explicit dark toggle). Keep them in one shared CSS file so they cannot drift. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .guest-quote { /* ↓ same declarations as below */ }
}
:root[data-theme="dark"] .guest-quote {
  --g-bg:        #0B1120;
  --g-surface:   #131C33;
  --g-surface-2: #1A2542;
  --g-line:      #2A385C;
  --g-ink:       #EDF1FA;  /* 14.95:1 on surface */
  --g-ink-soft:  #B4BED6;  /*  9.08:1 */
  --g-ink-mute:  #8492B3;  /*  5.43:1 */
  --g-ai-bg:     #18264A;
  --g-warn-bg:   #3A2E12;
  --g-heading:   #C7D5F5;  /* navy headings flip to this in dark */
  --g-link:      #9DB4EA;  /*  8.18:1 */
  --g-red-text:  #FF6B70;  /* ⚠ red TEXT in dark: #E83238 is 3.98:1 on surface, fails; this is 6.11 */
  --g-shadow:    0 10px 30px rgba(0, 0, 0, .45);
}
```

**Use rules:**
- **`--g-red` never carries body-size text on white.** It is 4.25:1, which fails AA at 16px. Use it for borders, the selected-card ring, icons, the FAB fill (with a white icon), and display text ≥ 24px.
- Button text sits on `--g-red-dark`.
- The primary action (**Send quote request**) is the only red-filled button on screen. Secondary buttons are navy outline.
- Selection is never colour-only. The selected card gets a red 2px border **plus** a check badge **plus** `aria-pressed`. A swatch gets a check **plus** its name.
- Disabled groups (for example doors on a Carport) use `--g-ink-mute` text plus a reason sentence, not opacity alone.

## 2. Typography

The template loads Archivo and Inter from Google Fonts. **This page self-hosts them instead**, with `next/font/local` and woff2 files committed under `apps/site/src/fonts/`, so `pnpm build` still works offline (MASTER §2).
- Both fonts are SIL OFL.
- Subset to Latin; one variable file each.

| Role | Face | Size / line | Weight |
|---|---|---|---|
| Hero title | Archivo | clamp(32px, 5vw, 56px) / 1.05 | 800 |
| Step title (① Building type…) | Archivo | 24px / 1.2 | 700 |
| Card title, summary bar label | Archivo | 16–18px / 1.3 | 700, summary label uppercase +0.06em |
| Body, form labels, chat | Inter | 16px / 1.5 | 400 / 500 labels |
| Dimension labels on 2D, chips | Inter, `tabular-nums` | 13–14px / 1.3 | 500 |

- The fallback stack is MASTER's `--sq-font-sans`.
- Inputs are ≥ 16px so iOS does not zoom.

## 3. Layout and spacing

- Container max 1280px; side gutter 16px on mobile, 24px at ≥ 768px.
- Spacing scale is 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. The page is **density 4/10**, roomier than MASTER's 8/10, because it is a consumer form.
- **Tabs, not a scrolling page** (user decision 2026-11-18). Header · tab bar (4 tabs, summary + red button on its right at ≥ 768) · one panel · panel footer (‹ Back · saved note · Start over · Next ›). At ≥ 1024 the Design panel fills `100dvh` minus header and tab bar; the page does not scroll, each column scrolls inside.
- **The Design panel is a workspace: tools | stage | assistant** (plan `guest-template-3col`, 2026-11-20). Both side panels can be hidden independently, and each breakpoint decides what an open and a closed panel look like. Layout is driven by three attributes on `.g-design` — `data-bp`, `data-left`, `data-right` — never by measuring in JavaScript.

  | Width (`data-bp`) | Grid | Tools (`data-left`) | Assistant (`data-right`) |
  |---|---|---|---|
  | ≥ 1280 (`desktop`) | `330px · 1fr · 350px`, all columns full height | open by default; closed = 48px rail of three icon buttons | open by default; closed = gone, with the "Ask the AI" FAB |
  | 1024–1279 (`tablet`) | `330px · 1fr` | open by default; closed = 48px rail | **closed** by default; a 400px drawer from the right, with a scrim |
  | < 1024 (`phone`) | one column, the stage | **closed**; a 340px drawer from the left, opened from the toolbar's "Tools" | **closed**; below 768 a bottom sheet at 84dvh, above it the same 400px drawer |

  - A **change of breakpoint resets both panels to that width's defaults** (D4); a resize inside one breakpoint leaves a person's choice alone. Panel state is memory-only and is not persisted.
  - A closed off-canvas panel gets `inert`, so the keyboard cannot reach what is not on screen. Escape closes the assistant everywhere and the tools drawer where it is a drawer (phone); focus returns to the opener (`#g-assistant-fab` / `#g-tools-btn`).
  - Below 1280 the toolbar carries "AI Assistant"; below 1024 it also carries "Tools". Above 1280 the columns have their own hide button, so neither appears.
  - The FAB floats bottom-right; the footer reserves its width so the two never overlap, and on a phone the "Ask the AI" chips keep clear of it too.
  - The summary strip: inside the tab bar at ≥ 768; below that, one line stuck to the bottom with a safe-area inset, hidden while the soft keyboard is open.
  - Landscape phone (height < 500): the stage takes the whole width and scrolls with the page; the chips become one scrollable line.

- **The phone accordion became a drawer (D2, changed 2026-11-20).** The override used to put the controls *below* the stage at < 1024. They are now a drawer off the left, closed on arrival, so a phone opens on the model rather than on a form. The former landscape rule (stage 60% left · controls 40% right) is gone for the same reason: at that size the controls are a drawer, and a two-column split left the right 40% empty.

- Test at 360, 390, 768, 1024, 1280, 1440 and 844 × 390. On a phone the tab bar scrolls sideways inside itself (short labels "Type · Address · Design · Send"); the page never does.

- Touch targets ≥ 44×44px; chips 40px tall with an 8px gap, which is still ≥ 44px of hit area via padding.
- Radius `--g-radius` (14px) on cards and panels, 999px on pills and chips, 10px on inputs and buttons.

## 4. Components (page-local, not in `@sq/ui`)

| Component | Notes |
|---|---|
| `GuestHeader` | logo · nav (Home / Projects / Design & Quote / Contact) · pill "Guest session — no sign-up needed". Logo rules: see §4a |
| `StepTabs` | WAI-ARIA tabs (`tablist`/`tab`/`tabpanel`), ←/→ Home/End, manual activation; active = navy underline 3px + bold; done = check; missing-for-send = orange dot + sr-only text; locked = `--g-ink-mute` + "Choose a building type first"; state in `?step=` |
| `StepFooter` | ‹ Back · "Your design is saved on this device" · Start over · Next › (navy outline; never red) |
| `TypeCard` | admin-defined icon (SVG set), name, one-line description; selected = red ring + check + `aria-pressed` |
| `AddressCombobox` | WAI-ARIA combobox on the Guest Places proxy (debounce 300ms, abort previous); after a pick, 4 editable fields; falls back to the suburb list and manual entry with a visible note |
| `WindNote` | `--g-ai-bg` box, wind icon, 2–3 plain sentences |
| `SummaryBar` | navy; sits inside the tab bar at ≥ 768; summary · "Design summary" popover · red "Send quote request" (switches to tab ④) |
| `ControlAccordion` | `<details>` groups; slider + number input pairs; pitch chips; steppers |
| `SwatchGrid` | part tabs Walls / Roof / Trim; swatch 40px with name below |
| `Stage` | tabs "2D plan" / "3D model"; "Show/Hide roof" and "Reset view" in 3D; the panel switches at the right end (Tools below 1024, AI Assistant below 1280); the "Ask the AI" chips row under it |
| `ToolsRail` | the 48px rail a collapsed tools column becomes at ≥ 1024: Size / Colours / Doors, each opening its group and scrolling it into view |
| `AssistantFab` | "Ask the AI", red, 56px, fixed bottom-right, shown while the assistant is closed; a navy badge counts replies that arrived unseen ("9+" above nine) |
| `AssistantPanel` (Guest) | static head (avatar "S", name + "AI" badge, subtitle, hide button); message log `role="log"` with distinct guest and assistant bubbles; change cards with Undo and "View on plan"; rounded composer with a red Send; AI disclaimer. Thread state lives in `assistantStore.ts` so a hide does not lose it |
| `SendSection` | "What you're sending" table · "What happens next" · form · confirmation |

Icons: one SVG line set at 1.75px stroke, 20/24px. No emoji.

### 4a. Logo

- **Files** (received from the user 2026-11-18): `apps/site/public/brand/ssa-logo.png` (1280 × 360, the original) and `ssa-logo-96.png` (341 × 96, for the header at 2× density). `public/logo.png` is the SmartQuote logo. Leave it unchanged.
- **Colours in the file:** red `#EC3237` and navy `#15317B`. They are close to `--g-red #E83238` and `--g-navy #132C6E`, so the tokens stay as they are.
- **Size and alt text:** in the header, 40px tall at < 768 and 48px tall from 768 up. Alt text "Smart Solutions Australia". The logo links to `/`.
- **Dark mode:** the PNG has an opaque white background, with no transparency. In dark mode it sits on a white plate: `--g-surface` light, radius 10px, padding 6px 10px. Never invert it with a filter. A transparent SVG would remove the plate, but the repo does not have one: *not in the repo*.
- **Contrast:** a logo is exempt from WCAG 1.4.3 (logotypes). The red on white is 4.14:1 and does not count against §6.
- **Clear space:** at least the height of the "S" square ÷ 4 on every side. Nothing overlaps the logo.

## 5. Motion

- 150–200ms ease-out for hover, press, and chip select; 250ms for the drawer or sheet; 150ms cross-fade between tab panels (no sliding).
- All of it is off under `prefers-reduced-motion`. Then tab changes are instant and the drawer appears without sliding.

## 6. Pre-delivery checklist (in addition to MASTER §7)

- [ ] Every text/background pair above measured at ≥ 4.5:1 (≥ 3:1 for ≥ 24px or bold ≥ 18.66px), light and dark.
- [ ] No `--g-red` body text on light surfaces; no `#E83238` text on dark surfaces.
- [ ] No horizontal page scroll at any test size; summary bar, FAB, footer's next button and the "Ask the AI" chips never overlap each other or a form control.
- [ ] Each of the two panels opens, closes and returns to its breakpoint default; Escape closes it; focus goes back to the opener.
- [ ] Tabs work by keyboard alone; browser Back returns to the previous tab; focus lands on the new panel's heading.
- [ ] Fonts load from `apps/site/src/fonts/` (no request to fonts.googleapis.com in the network panel).
- [ ] Tokens are scoped to `.guest-quote`; the `/s` share page and the home page look unchanged.
- [ ] No price string anywhere in the rendered page or its JS chunks.
