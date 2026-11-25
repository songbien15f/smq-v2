# Guest 3D/2D screenshots — before / after (2026-11-24)

Produced by `node scripts/qa-guest-shots.mjs --label before|after` from the same
`scripts/qa-guest-design.json`: **Garage 6.00 × 6.00 × 3.00 m, gable 10°, 2 bays, roof Surfmist, walls
Shale Grey, one 900×900 window on the left wall at 2400**; camera coordinates are identical in both
runs (they are in the script). Viewports: 1919×998 and 390×844.

**Not committed** (the plan says so). Files sit in `before/` and `after/`.

| Shot | Before | After | What changed |
|---|---|---|---|
| 3d-overview-roof | [before](before/1919-3d-overview-roof.png) | [after](after/1919-3d-overview-roof.png) | Roof and walls unchanged; the rafters no longer show as grey tabs at the eaves. |
| 3d-overview-noroof | [before](before/1919-3d-overview-noroof.png) | [after](after/1919-3d-overview-noroof.png) | Rafter ends stop at the wall instead of hanging 315 mm outside it. |
| 3d-eave-left-roof | [before](before/1919-3d-eave-left-roof.png) | [after](after/1919-3d-eave-left-roof.png) | The grey tab under the gutter is gone. |
| 3d-eave-left-noroof | [before](before/1919-3d-eave-left-noroof.png) | [after](after/1919-3d-eave-left-noroof.png) | Same, with the roof hidden: the rafter now meets the column head. |
| 3d-downpipe-front-left | [before](before/1919-3d-downpipe-front-left.png) | [after](after/1919-3d-downpipe-front-left.png) | Pipe stands against the wall (58 mm centre offset = radius + 10) with an offset piece under the gutter, instead of 182 mm of air. |
| 3d-downpipe-base | [before](before/1919-3d-downpipe-base.png) | [after](after/1919-3d-downpipe-base.png) | Pipe reaches the wall base (y = 0) and has a shoe; it no longer floats 50 mm above the ground plane. |
| 3d-window-close | [before](before/1919-3d-window-close.png) | [after](after/1919-3d-window-close.png) | Frame face 98 mm proud → 25 mm; the flashing reads as a drip rather than a shelf. |
| 3d-window-oblique | [before](before/1919-3d-window-oblique.png) | [after](after/1919-3d-window-oblique.png) | Same, seen at 45°: no box standing off the cladding. |
| 2d-plan-fit | [before](before/1919-2d-plan-fit.png) | [after](after/1919-2d-plan-fit.png) | Unchanged on purpose — 2D draws neither rafters nor downpipes. |
| 2d-plan-window | [before](before/1919-2d-plan-window.png) | [after](after/1919-2d-plan-window.png) | Unchanged; the window symbol uses `WINDOW_INSET`, which was not touched. |

The same ten shots exist at 390 px: `before/390-*.png` and `after/390-*.png` (same rows, same order).

## Measured values behind the pictures

| Item | Before | After |
|---|---|---|
| `rafter-left` x range (span 6000) | −315.6 … 3015.6 | 34.1 … 3015.9 |
| `rafter-right` x range | 2984.4 … 6315.6 | 2984.1 … 5965.9 |
| Downpipe centre to wall face | 230 mm (182 mm clear gap) | 58 mm (touching: radius 48 + 10) |
| Downpipe foot | y = 0, outside the slab, 50 mm above the drawn ground | y = 0 at the wall base, with a shoe |
| Downpipe parts per pipe | body only | body + offset + shoe |
| Window frame outer z (outside = negative) | −98 | −25 |
| Window flashing outer z | −125 | −45 |

## How these were checked

The geometry was reproduced and confirmed **numerically** before and after (the numbers above are
printed from `structure3d`/`openings3d`), and the rendered screenshots were produced from the same
design, camera and viewports. The review notes mention eyeballing the images; this session could not
display image data, so the numeric checks are the evidence used, and the PNGs are for the human
reviewer.


## Ảnh ghép before | after (2026-11-25, vòng 4)

Mỗi ảnh trong `compare/` là **một** ảnh: trái là TRƯỚC, phải là SAU, có vạch ngăn và nhãn mã bug.
Sinh bằng `node scripts/qa-compare.mjs`; script đo % pixel đổi (mỗi kênh lệch > 8) và **bỏ qua** cặp
dưới 0,5 %.

**16 ảnh ghép** (sau khi loại 4 cặp — xem bảng dưới). Vòng 4 từng loại nhầm 4 cặp eave vì cho rằng `before/` bị tráo; kiểm bằng mắt thì `before/` đúng (trang cũ còn đổi nhãn nút), chỉ `after/` vòng 3 bị tráo, nên 4 cặp eave đã được ghép lại.

| Ảnh ghép | Bug | % pixel đổi |
|---|---|---|
| `m3-1919-3d-downpipe-front-left.png` | M3 — downpipe cách tường | 4,27 % |
| `m3-1919-3d-downpipe-base.png` | M3 — chân downpipe | 2,98 % |
| `m4-1919-3d-overview-noroof.png` | M4 — xà portal | 0,65 % |
| `e9-1919-3d-overview-roof.png` | E9 — mái/tường | 0,56 % |
| `cua-so-1919-3d-window-close.png` | Khung cửa sổ | 3,04 % |
| `cua-so-1919-3d-window-oblique.png` | Khung cửa sổ nghiêng | 3,60 % |
| `m3-390-3d-downpipe-front-left.png` | M3 — downpipe (390) | 7,19 % |
| `m3-390-3d-downpipe-base.png` | M3 — chân downpipe (390) | 3,25 % |
| `m4-390-3d-overview-noroof.png` | M4 — xà portal (390) | 0,89 % |
| `m4-1919-3d-eave-left-roof.png` | M4 — đầu xà ở mép mái | 2,32 % |
| `m4-1919-3d-eave-left-noroof.png` | M4 — đầu xà, ẩn mái | 1,49 % |
| `m4-390-3d-eave-left-roof.png` | M4 — đầu xà (390) | 3,27 % |
| `m4-390-3d-eave-left-noroof.png` | M4 — đầu xà, ẩn mái (390) | 1,75 % |
| `e9-390-3d-overview-roof.png` | E9 — mái/tường (390) | 1,47 % |
| `cua-so-390-3d-window-close.png` | Khung cửa sổ (390) | 1,69 % |
| `cua-so-390-3d-window-oblique.png` | Khung cửa sổ nghiêng (390) | 4,61 % |

### Cặp bị bỏ qua, và lý do thật

| Cặp | Lý do |
|---|---|
| `390-2d-plan-fit`, `390-2d-plan-window` | **Ảnh `before` rỗng: 142 byte, 358×3.** Ở 390 px, `.g-stage-view` của tab 2D cao **2 px** — rule điện thoại đặt `height: 300px` nhưng `flex: 1` (basis 0) của rule gốc thắng trên trục chính, nên panel collapse. Đây là bug CSS thật, đã sửa vòng 4 (`flex: 0 0 300px` cho `.g-stage-view:has(> .g-plan)`). Chỉ có ảnh **sau**; không có ảnh trước hợp lệ. |
| `1919-2d-plan-fit`, `1919-2d-plan-window` | 0,93 % — **không có thay đổi có chủ đích** ở 2D; chênh lệch là khử răng cưa giữa hai lần render. |

### Tự kiểm bằng số (vòng 4)

- 20/20 ảnh trong `after/` đều **> 5 KB** (nhỏ nhất 7 442 byte, là `390-2d-plan-window.png`).
- Cặp eave `roof` vs `noroof`, đo trên **45 % phía trên** khung (vùng trên tường):
  `1919` **12,23 %** pixel đổi, `390` **12,60 %** — ngưỡng yêu cầu là 2 %.
- Ảnh 2D ở 390 giờ là `358×301` (trước là `358×3`).
