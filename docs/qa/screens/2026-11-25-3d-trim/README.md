# 3D trim / flush openings — before and after (2026-11-25)

Plan: `docs/plans/2026-11-25-3d-trim-flush-prompt.md`.
Checkpoint: `docs/state/3d-trim-flush.md`.

Captured by `scripts/qa-3d-trim-shots.mjs` (deleted after the run) at one fixed design and one fixed
camera per shot, 1919 × 998 viewport, screenshots of `.g-stage-3d` (1711 × 787 each).

**Design** (`scripts/qa-3d-trim-design.json`): Garage 6.00 × 6.00 × 3.00 m, gable 10°, 2 × 3 000 mm
bays, roller door 3 000 × 2 100 at the front, window 900 × 900 on the left, PA door 820 × 2 040 at the
back. Walls Shale Grey, roof Surfmist, **trim Manor Red** so every flashing reads against the walls.

**Caveat, stated up front:** the assistant that produced these images **cannot display pictures**. No
image below was "looked at"; every claim in the table is a number measured from the PNGs — pixel
diff against the before-image, and the share of pixels matching Manor Red — plus the part coordinates
asserted in `packages/core/src/domain/__tests__/`.

## The seven shots

| Shot | Camera (m; x across span, y up, z along length) → target | What it is meant to show |
|---|---|---|
| `overview` | viewer's own framing | the whole building as a visitor first sees it |
| `window` | (−2.2, 1.35, 1.65) → (0, 1.35, 1.65) | square on the left-wall window: frame depth and the trim ring |
| `pa-door` | (3.69, 1.25, 9.2) → (3.19, 1.05, 6.0) | the back PA door, head **and** threshold in one frame |
| `pa-door-foot` | (3.19, 0.50, 7.4) → (3.19, 0.12, 6.0) | **round 2 only:** the PA door's foot, low and square on — both ends of the back wall's base trim |
| `wall-base` | (−1.5, 0.75, 4.6) → (0, 0.35, 3.4) | along the wall foot: base flashing, its cut at the doors |
| `ridge` | (−1.6, 5.2, −1.4) → (3.0, 3.5, 3.2) | the ridge cap as a V, from above and to one side |
| `corner` | (−2.4, 1.7, −2.4) → (0, 1.5, 0) | the front-left corner post |
| `barge` | (−1.0, 4.6, −3.0) → (1.6, 3.3, 0) | the front gable end's raking edge |

## Measured change, per shot

"Diff" is the share of pixels whose RGB differs by more than 8 on any channel. "Manor Red share" is
pixels in the trim's own hue band (R > G+25 and R > B+20, mid brightness) — the trim is the only thing
painted that colour, so this is a direct measure of how much trim is on screen. Channel threshold 8
and count share rather than mean colour: a 3 mm lip moves a few hundred pixels hard, and averages it
away.

| Shot | Pixels changed | Manor Red, before | Manor Red, after | Reading |
|---|---|---|---|---|
| `overview` | 1.40 % | 0.643 % | **1.185 %** | more trim visible on a whole-building view |
| `window` | 4.15 % | 0.928 % | **3.096 %** | 3.3× more trim: the four-sided ring replaced two flashings and the frame moved back |
| `pa-door` | 5.31 % | 1.531 % | **5.242 %** | 3.4× more: the surround is trim-coloured and the threshold is a full face |
| `wall-base` | 3.13 % | 1.328 % | **3.405 %** | a base flashing where there was none |
| `ridge` | 3.71 % | 1.558 % | 1.212 % | the flat 280 mm bar became two 175 mm wings lying on the slopes, so it presents **less** face to this camera while covering more roof |
| `corner` | 3.48 % | 2.705 % | **5.156 %** | the corner post, from nothing |
| `barge` | 3.56 % | 3.376 % | **3.922 %** | raking pieces now stop at the gutter instead of running through it |

The ridge shot is the one place the red share **falls**. That is expected and is not a regression: the
old cap was a 280 × 80 box standing off the apex with its broad face toward this camera; the new cap
is two 175 mm wings lying on the 10° slopes, so the same roof edge presents a narrower face from above
while the cap now actually covers 350 mm across the ridge instead of floating over it.

## Round 2 — two images re-shot, one added (2026-11-25)

Round 1's review found the base trim cut in the wrong place on the **back** and **left** walls (see
`docs/state/3d-trim-flush.md` → "Vòng 2"), and that the floor slab was painted in the trim colour, which
put a continuous red band round the building's foot. Both are fixed, so `pa-door` and `wall-base` were
re-shot **from round 1's own cameras** and `pa-door-foot` was added.

"The floor slab" is `Shed3D.tsx`'s slab: it used `config.colors.barge`, so a Manor Red trim painted the
whole slab edge red. It is now a fixed concrete grey (`#b9b6ae`), `SLAB_COLOR` in that file.

| Shot | Pixels changed vs round 1 | Manor Red, round 1 | Manor Red, round 2 | Red in the bottom 18 % of the frame |
|---|---|---|---|---|
| `pa-door` | 1.63 % | 5.242 % | **3.968 %** | 14.147 % → **7.444 %** |
| `wall-base` | 1.16 % | 3.405 % | **2.315 %** | 0.793 % → **0.456 %** |
| `pa-door-foot` | new | — | 3.244 % | 0.006 % |

The single reddest row in `pa-door` (the slab's edge, which ran the full width) drops from **697** red
pixels to **439** — that is the slab band leaving the picture, with the base trim still there beside the
door. In `pa-door-foot` the bottom of the frame has **0.006 %** red: no red line under the door, which
is the point of the shot.

What the geometry change did is asserted numerically rather than in pixels: the new
`'on every wall, not just the front one'` block in `structure3d.test.ts` puts an off-centre door on each
of the four walls and checks, from each wall's own `transform`, that no base trim run crosses the hole
and that both runs end within 1 mm of it. Round 1's hole on the back wall was at world x 2 780…3 600
while the trim was cut at 2 400…3 220 — a 380 mm bar under the door. That test is red on a reverted
`baseTrimParts` and green now.

## What the "before" images still show

They were taken **before any code change**, from the same cameras, with the same design. They are the
evidence for the client's complaint:

- the window frame stands 25 mm proud of the sheeting and its flashings 45 mm (measured in the old
  test: outer face at `z = −25` and `z = −45`);
- the PA door frame stands 84 mm proud and its threshold 133 mm (`z = −84`, `z = −133`);
- the window has a flashing across the head and a different one under the sill, so it reads as
  "trimmed on top, bare underneath" — the client's exact words;
- there is no base flashing, no corner post and no barge flashing at all;
- the ridge cap is a 280 mm flat bar.

The "after" set is the same seven cameras against the new geometry, and the numbers above are what
changed between them.

## Round 3 — the roller door moved to the inside face (2026-11-25)

Round 3 did one thing: a roller door belongs on the **inner** face of its opening, so the curtain, ribs,
guides and a 130 mm head box that used to stand outside the sheeting were moved inside, and the opening
gained the same 3-sided trim ring every other opening has (no sill — a car drives over it).

Images:

| File | What it is |
|---|---|
| `round3-before/1919-roller.png` | **before the fix** — the roller door square on from outside |
| `round3-before/1919-roller-side.png` | **before the fix** — almost along the wall, so anything standing off its face reads in profile |
| `after/1919-roller.png` | the same camera, after |
| `after/1919-roller-side.png` | the same camera, after |
| `after/1919-overview.png` | the whole building, after |

Cameras are in `after/meta.json` → `cameras`:

| Shot | Camera (m) → target |
|---|---|
| `roller` | (3.0, 1.2, −4.2) → (3.0, 1.05, 0) |
| `roller-side` | (−1.6, 1.5, −1.0) → (3.2, 1.1, 0) |
| `overview` | the viewer's own framing, taken before any camera moved |

Measured, comparing the two pairs (same camera, same design):

| Shot | Pixels changed | Manor Red, before | Manor Red, after |
|---|---|---|---|
| `roller` | 11.32 % | 10.209 % | 9.112 % |
| `roller-side` | 4.74 % | 5.933 % | 4.510 % |

The red share falls because the big red head box (3 m wide, 90 mm tall, standing 130 mm off the wall) and
the red guides are gone; what replaces them is a 45 mm ring inside the opening. The 11 % change on the
front view is the whole door: the curtain moved from 39 mm outside to 79 mm inside.

**This session cannot display images**, so nothing above is a description of what the pictures look like.
The geometry is asserted numerically in `packages/core/src/domain/__tests__/openings3d.test.ts` (rules
1–8 of the round-3 brief), including a snapshot proving a window and a PA door did not change by a
millimetre.

## Round 3b — the roller door's jambs reach the floor (2026-11-26)

Review after round 3 measured the two jambs stopping 46.5 mm above the floor of the reveal, leaving a
notch of grey sheeting at the foot of each — right where the base trim ends. With no sill, the jambs had
been drawn with the four-sided formula, which reserves a face for a bar that is not there.

| File | What it is |
|---|---|
| `after/1919-roller.png` | **overwritten** — the same camera as round 3 |
| `after/1919-roller-foot.png` | **new** — close-up of the left jamb's foot from outside, where the base trim stops |

Cameras added to `after/meta.json` → `cameras` and `round3b`:

| Shot | Camera (m) → target |
|---|---|
| `roller` | (3.0, 1.2, −4.2) → (3.0, 1.05, 0) |
| `roller-foot` | (1.05, 0.45, −1.05) → (1.5, 0.1, 0) |

Measured, round 3's `roller` image against this one (same camera, same design): **0.016 %** of pixels
changed (217 of 1 346 557), and they fall in exactly **two narrow vertical runs** — x 474–487 and
x 1224–1237, rows 560–660. That is the foot of each jamb, 14 px wide at this camera; nothing else in the
frame moved, which is what "only the jamb height changed" should look like.

**This session cannot display images.** No statement above describes what the pictures look like; the
jamb geometry is asserted in `openings3d.test.ts` (`rule 2: the jambs reach the floor of the reveal and
meet the head`), and a window and a PA door are still pinned by their snapshots.
