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
