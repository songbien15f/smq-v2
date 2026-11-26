# 3D trim / flush openings — checkpoint (2026-11-25)

Plan: `docs/plans/2026-11-25-3d-trim-flush-prompt.md`. Uncommitted by design.

Images: `docs/qa/screens/2026-11-25-3d-trim/` (`before/`, `after/`, README with the measured table).

## Mục tiêu

3D giống nhà thật: không chi tiết nào nhô ra sai chỗ, không thiếu nẹp. Sáu góp ý của client (nguyên
văn trong plan) quy về bốn việc: cửa sổ/PA door bằng mặt tôn, viền trim đủ 4 cạnh, base trim chân
tường, và hệ nẹp mái/tường (ridge, corner, barge).

## Quyết định

| # | Quyết định | Vì sao |
|---|---|---|
| 1 | Mọi mảnh WID/PAD ở `z ≥ 0`; **chỉ** `leaf` + `leaf-handle` được ra ngoài | client: "phải bằng mặt ngoài". Cánh mở 22° là chuyển động của cánh, không phải khung |
| 2 | Viền trim **45 mm, cùng tiết diện 4 cạnh, cùng cho window lẫn PA door**, màu `colors.barge` | client: "viền trên có, không có bottom". Một tiết diện thì không thể lệch kiểu nữa |
| 3 | Viền **nằm trong lỗ**, không đè mặt tôn | đè lên mặt tôn thì phải nhô ra — đúng cái client chê |
| 4 | Khung cửa sổ lùi **2 mm** sau viền; kính lùi tiếp | ba lớp trong 90 mm của lỗ, không hai mặt nào chung phẳng |
| 5 | Mọi mảnh lùi vào lỗ **1,5 mm** (`OPENING_CLEARANCE`) | mặt cắt của lỗ cũng là một mặt; chạm vào là nhấp nháy |
| 6 | PA door: viền ngoài → `barge`, cánh giữ `paDoor` | "chuyển viền ngoài sang colors.barge; giữ colors.paDoor cho cánh cửa" |
| 7 | Ngưỡng PA door cao **45 mm** như 3 cạnh kia | "cạnh dưới là ngưỡng, cao bằng các cạnh kia, nằm sát sàn" |
| 8 | Base trim cao **75 mm**, dày **4 mm** (1 lấp + 3 nhô) | 75 nằm trong 50–75 của plan và cùng cỡ `CORNER_FLASHING`; 1 mm lấp để không đồng phẳng với tôn |
| 9 | Base trim **ngắt** ở mọi ô cửa có `sill ≈ 0` | plan: PA/roller/sliding. Cắt theo `wallHolesFor` (lỗ đã kẹp), không theo `offset` thô |
| 10 | Corner trim **60 mm/cánh**, nhô **4 mm** (hơn base 1 mm) | 50–75 của plan; 1 mm chênh để hai lớp không đồng phẳng ở 75 mm chân tường |
| 11 | Corner **bỏ** khi một phía tường mở; carport **0 góc** | "góc có một phía là tường mở thì không có" |
| 12 | Ridge cap **2 cánh 175 mm**, gặp nhau **đúng đỉnh đã nâng** (lift thẳng đứng) | 150–200 của plan. Nâng theo pháp tuyến từng cánh làm hở 10 mm ở đỉnh (đo được) |
| 13 | Barge **100 mm mặt, 3 mm dày**; gable **4**, skillion **3** | đúng `KNOWN-DEVIATIONS` dòng 58 (4 raking / 2+1) |
| 14 | Barge **dừng 5 mm trước tang gutter**, bắt đầu từ chỗ ridge cap dừng | đo được: bản đầu chạy xuyên qua barrel gutter; bản thứ hai nằm đúng mặt phẳng của cap → nhấp nháy |
| 15 | Base/corner là **tường** → ở lại khi tắt mái; barge/ridge **đi theo mái** | cùng quy ước đã dùng cho gable end và gutter |

## Số đo (mm, từ test và từ probe)

**Cửa sổ** (`windowParts`, lỗ 900 × 900, sill 900):

| Mảnh | `z` ngoài | `z` trong |
|---|---|---|
| `trim-*` (4 cạnh) | **0** | 25 |
| `frame-*` (4 thanh + đố) | 27 | 87 |
| `glass` | 70 | 80 |

**PA door** (820 × 2040): viền `0…25`; `leaf` −270,7 … +43; `leaf-handle` −294,7 … −212,6; `hinge-*`
+2 … +42.

**Vỏ nhà** (6 × 6 × 3 m, gable 10°): base `z ∈ [−3, +1]`, cao 75; corner `z ∈ [−4, +1]`; ridge cap
2 × 175 mm, đỉnh nâng 21,5 mm trên `ridgeY`; barge bắt đầu tại `t = 175 mm` tính từ đỉnh xuống dốc và
dừng ở `x = −150` (trái) / `x = span + 150` (phải).

## Việc còn lại

- **Client xác nhận cách hiểu mục 2.** Plan ghi rõ: "viền quanh WID/PAD thiếu cạnh dưới" là **cách
  hiểu của chúng tôi**, chưa được client xác nhận. Đã dựng đúng theo cách hiểu đó.
- **Sliding door nhô ra theo thiết kế** — cửa lùa của shed ở Úc treo trên ray **bên ngoài** tường và
  trượt dọc mặt tôn, nên số đo "nhô" là đúng chứ không phải nợ. Roller door đã được đưa vào trong ở
  vòng 3; xem mục "Vòng 3".
- **Base trim không có trong BOM** (desktop không có profile này). Nếu client muốn tính tiền thì phải
  thêm dòng BOM, và đó là quyết định giá.
- **`colors.window` chỉ còn trên khung cửa sổ**, không còn trên viền. Nếu client muốn viền cửa theo
  màu cửa sổ thay vì màu trim thì đổi một tham số trong `windowParts`.
- **Chưa xem được ảnh** trong phiên này; mọi khẳng định hình ảnh đều là số đo pixel (README trong
  thư mục ảnh).

## Kiểm tra

| Việc | Kết quả |
|---|---|
| `pnpm --filter @sq/core test` | **1211 passed**, 16 skipped (trước khi sửa: 1169 passed) |
| `openings3d.test.ts` | 42 (trước: 22) |
| `structure3d.test.ts` | 40 (trước: 24) |
| `walls.test.ts` | 16 (trước: 10 — thêm 6 ca chứng minh refactor `buildWallGeometries` không đổi hành vi) |
| `pnpm --filter @sq/core typecheck` | sạch |
| `pnpm build:inc` | chạy sau mỗi lần sửa core |
| `pnpm --filter @sq/site-app typecheck` | sạch |
| `pnpm test:e2e --project=guest` | **5/5 passed**, GR-000053 tự xoá |

---

## Vòng 2 (2026-11-25) — base trim ngắt sai ở tường sau/trái, và màu sàn

Plan: `docs/plans/2026-11-25-3d-trim-flush-round2-prompt.md`. Chỉ hai việc, không thêm gì khác.

### Lỗi 1 — base trim ngắt sai chỗ trên tường sau và tường trái

**Triệu chứng** (review đo bằng probe trên garage 6 × 6 m, PA door 820 mm, `offset` 2 400): trên
tường **back** lỗ cửa thật nằm ở x 2 780…3 600 nhưng base trim bị cắt ở x 2 400…3 220; trên tường
**left** đúng cùng kiểu lệch, theo `z`. Kết quả: dải đỏ chạy 380 mm **dưới cửa** và 380 mm chân tường
cạnh cửa không có trim.

**Nguyên nhân.** `baseTrimParts` lấy `hole.u` từ `wallHolesFor` — toạ độ **cục bộ của tường** — rồi dùng
thẳng làm toạ độ thế giới. Điều đó chỉ đúng ở tường **front**, tường duy nhất có transform là identity.
Tường back bị xoay π (`x = span − u`) và tường left xoay π/2 (`z = length − u`). Tệ hơn: file có **hai**
mô tả vị trí tường — `wallTransform` (walls.ts, dùng để đặt tường) và một bảng 4 trường hợp `wallPlane`
(structure3d.ts, dùng để đặt trim) — và chúng đã lệch nhau.

**Cách sửa.** Xoá hẳn `wallPlane`/`WallPlane`. Thêm `wallPlacement(shed, wall)` đọc **chính transform**
của `buildWallGeometries` và trả `{ length, rotationY, toWorld(u, d) }` theo một phép xoay duy nhất:

```
world x = px + u·cos t + d·sin t
world z = pz − u·sin t + d·cos t
```

Base trim tính run trong `u` rồi đặt bằng `placement.toWorld(centre, localDepth)`, và mỗi part mang
`rotation: [0, rotationY, 0]` với size trong hệ trục của tường. Vì thế cả 4 tường đi **một** đường code.

**Test viết trước, và nó đỏ đúng chỗ.** Khối `'on every wall, not just the front one'` trong
`structure3d.test.ts` đặt cửa lệch tâm lần lượt trên 4 tường, lấy toạ độ thế giới của lỗ từ
`buildWallGeometries(...).transform` (không chép công thức lật vào test), rồi kiểm hai điều: không run
nào giao lỗ, và hai đầu run cách mép lỗ ≤ 1 mm. Trước khi sửa: **front ✓, right ✓, back ✗, left ✗**.
Sau khi sửa: **4/4 xanh**.

**Rà các hàm trim khác** — đã rà, **không có** chỗ nào khác dùng `u` cục bộ làm toạ độ thế giới:

- `cornerTrimParts`: dựng trực tiếp bằng toạ độ thế giới từ 4 mép `x ∈ {0, span}`, `z ∈ {0, length}`,
  không dùng `wallHolesFor`. Probe 6 × 6 m: 8 part đúng ở x −1/6 002 và z −1/6 002, mỗi cánh 60 mm.
- `bargeParts`: chỉ dùng hình học mái (`span`, `length`, `slope`, `EAVE`), không có lỗ, không có `u`.
- `wallHolesFor`: chỉ còn `baseTrimParts` gọi.

### Lỗi 2 — sàn bê tông tô bằng màu trim

`Shed3D.tsx` vẽ slab bằng `config.colors.barge`. Với trim đỏ, cả mép sàn quanh chân nhà thành một dải
đỏ liền chạy dưới mọi cửa; nó nằm ngay dưới base trim nên đọc thành hai lớp trim, và rất có thể là một
phần lý do client nói "viền trim đỏ bottom" trông sai.

Sửa: hằng số `SLAB_COLOR = '#b9b6ae'` (xám bê tông trung tính) trong `Shed3D.tsx`, có comment lý do.
Sàn **không** thuộc hệ trim, không theo `colors.barge`, không thêm vai trò màu nào vào `ShedColors`.
Kích thước/vị trí sàn không đổi; option (skylight, mezzanine…) vẫn dùng `colors.barge` như cũ — ngoài
phạm vi vòng này.

### Kiểm tra vòng 2

| Việc | Kết quả |
|---|---|
| `pnpm --filter @sq/core test` | **1215 passed**, 16 skipped (vòng 1: 1 211) |
| `structure3d.test.ts` | **44** (vòng 1: 40 — thêm 4 ca, một ca mỗi tường) |
| `pnpm --filter @sq/core typecheck` | sạch |
| `pnpm --filter @sq/viewer3d typecheck` | sạch |
| `pnpm build:inc` | chạy (core + contracts); `@sq/viewer3d` tự rebuild qua `tsup --watch` của `pnpm dev` |
| `pnpm --filter @sq/site-app typecheck` | sạch |
| `pnpm test:e2e --project=guest` | **5/5 passed**, GR-000055 tự xoá (lần chạy đầu fail vì dev server đang biên dịch lại; chạy lại xanh) |

**Ảnh:** ghi đè `after/1919-pa-door.png` và `after/1919-wall-base.png` từ **đúng camera vòng 1**, thêm
`after/1919-pa-door-foot.png`. Số đo trong README của thư mục ảnh. **Phiên này vẫn không xem được ảnh**;
mọi khẳng định hình ảnh là phép đo pixel, không phải mô tả bằng mắt.

---

## Vòng 3 (2026-11-25) — roller door lắp ở mặt trong của lỗ

Plan: `docs/plans/2026-11-25-3d-trim-flush-round3-prompt.md`. Một việc: đưa roller door về đúng vị trí
lắp thật. Sliding door **không đụng** (cửa lùa treo ngoài tường theo thiết kế).

### Trước và sau, theo `z` (mm; `z = 0` mặt ngoài tôn, `z = 50` mặt trong)

| Part | Trước (`z` ngoài … trong) | Sau (`z` ngoài … trong) |
|---|---|---|
| `trim-head` / `trim-left` / `trim-right` | không có | **0 … 25** (viền 45 mm, màu `barge`) |
| `trim-sill` | — | **không có** (xe chạy qua ngưỡng) |
| `head` (khối riêng) | −130 … −10 | **đã bỏ** |
| `guide-left` / `guide-right` | −80 … +10 | **40 … 130** (lún 10 mm vào tôn, đuôi vào nhà) |
| `curtain` | −39 … −17 | **79 … 101** |
| `slat-*` | −53 … −43 | **67 … 77** |
| `bottom-bar` | −64 … −24 | **53 … 77** |
| `drum` | 80 … 380 | **không đổi** |
| `bracket-*` | 40 … 290 | **không đổi** |
| `spring-*` | 152 … 308 | **không đổi** |

Mặt trước tấm cuốn `79` cách tiếp tuyến trước của trục cuốn (`drumZ − ROLLER_DRUM_RADIUS = 80`) **1 mm**.

### Cách làm

- `trimRing` nhận thêm tham số `withSill = true`. Roller door gọi với `false` → chỉ head + 2 jamb,
  cùng tiết diện `OPENING_TRIM_FACE` / `OPENING_TRIM_DEPTH` và cùng màu `barge` như viền cửa sổ và PA
  door. Thanh sill vẫn được chèn ở **vị trí thứ hai** khi có, nên thứ tự part của cửa sổ/PA door không
  đổi (snapshot test chứng minh).
- `rollerDoorParts` viết lại: bỏ khối `head`; tấm cuốn, gờ slat, thanh đáy và ray đều dời vào trong.
  Ray giữ mẹo "lún 10 mm": mặt bản ray ở `z = 40`, tức 10 mm trong tấm tôn, nên không mặt nào nằm đúng
  `z = 50`; đuôi ray vào tới `z = 130`.
- Gờ slat và thanh đáy nằm **trước** tấm cuốn, cách mặt cuốn 2 mm — không mặt nào trùng mặt nào.
- Không đổi `ROLLER_DEPTH`, `ROLLER_INSET`, `ROLLER_TRACK_WIDTH` (2D dùng). Hằng số 3D mới:
  `ROLLER_CURTAIN_THICK`, `ROLLER_CURTAIN_SETBACK`, `ROLLER_RIB_GAP`, `ROLLER_GUIDE_DEPTH`,
  `ROLLER_GUIDE_SINK`.
- `drum`, `bracket-*`, `spring-*` giữ nguyên từng số (snapshot test).

### Test

Viết trước, **8 test đỏ**: hai test "flush" của roller, hai test quy tắc 2, quy tắc 3, 4, 5, 6. Sau khi
sửa: **54/54 xanh** trong `openings3d.test.ts`.

- Test kiểm kê cũ "what is still proud — recorded, not fixed": **xoá phần roller**; phần sliding đổi
  thành `describe('sliding door hangs outside the wall — by design')` với comment nói rõ nhô ra là thiết
  kế, số đo giữ nguyên.
- Snapshot cửa sổ và PA door (số đo chụp **trước** khi sửa) chứng minh hai loại cửa này không đổi một
  milimét nào.
- **Quy tắc 7 và quy tắc 2 mâu thuẫn ở đúng một mặt:** quy tắc 2 đặt viền ở `z ∈ [0, 25]` (mặt trước
  đúng `z = 0`), còn quy tắc 7 đòi không part nào có mặt trên `z = 0`. Viền **nằm trong lỗ**, nơi không
  có tôn, và đây là quy ước đã có từ vòng 1 cho cửa sổ/PA door, nên test rule 7 cho phép **duy nhất**
  mặt trước của viền ở `z = 0`; mọi mặt khác của roller door đều khác `0` và `50` (sai số 1e-6).
- Base trim ở lỗ roller: probe (đã xoá) trên garage 6 m, cửa 3 000 ở `offset` 1 500 → hai dải
  `[0, 1500]` và `[4500, 6000]`, mỗi đầu đúng mép lỗ. Logic không đổi.

### Kiểm tra vòng 3

| Việc | Kết quả |
|---|---|
| `pnpm --filter @sq/core test` | **1227 passed**, 16 skipped (vòng 2: 1 215) |
| `openings3d.test.ts` | **54** (vòng 2: 42) |
| `pnpm --filter @sq/core typecheck` | sạch |
| `pnpm --filter @sq/viewer3d typecheck` | sạch |
| `pnpm build:inc` | chạy; đã kiểm `packages/core/dist` có `ROLLER_CURTAIN_SETBACK` và `packages/viewer3d/dist` có `#b9b6ae` |
| `pnpm --filter @sq/site-app typecheck` | sạch |
| `pnpm test:e2e --project=guest` | **5/5 passed**, GR-000057 tự xoá (lần đầu fail vì dev server biên dịch lại; chạy lại xanh) |

**Ảnh:** `round3-before/1919-roller.png`, `round3-before/1919-roller-side.png` (chụp trước khi sửa);
ghi đè `after/1919-roller.png`, `after/1919-roller-side.png`, `after/1919-overview.png`. Camera ghi
trong `after/meta.json`. **Phiên này không xem được ảnh** — số đo ở README thư mục ảnh.

---

## Vòng 3b (2026-11-26) — jamb roller door không chạm sàn

Review sau vòng 3 tìm ra một lỗi nhỏ: hai jamb của roller door dừng **46,5 mm** trên đáy lỗ, để lộ một
khấc tôn xám ở chân mỗi jamb, ngay chỗ base trim dừng.

### Nguyên nhân

`trimRing` tính chiều cao jamb là `innerH − face·2` và đặt tâm ở `y + innerH / 2` — công thức của khung
**4 cạnh**, chừa chỗ cho **cả** head lẫn sill. Khi `withSill = false` (roller door), sill không còn
nhưng phần chừa cho nó vẫn còn, nên jamb ngắn đi đúng một `face`.

### Cách sửa

Trong `trimRing`:

```
jambHeight  = innerH − face·(withSill ? 2 : 1)
jambCentreY = withSill ? y + innerH/2 : y + (innerH − face)/2
```

`withSill = true` giữ nguyên từng số (cửa sổ và PA door không đổi — snapshot test chứng minh, không sửa
test). Với `withSill = false`, jamb chạy từ đáy lỗ trong ring (`y = sill + OPENING_CLEARANCE`) lên đúng
mặt dưới của `trim-head`.

### Số đo (roller 3 000 × 2 100)

| Part | `y` trước | `y` sau |
|---|---|---|
| `trim-left` / `trim-right` | 46,5 … 2053,5 (cao 2 007) | **1,5 … 2053,5** (cao 2 052) |
| `trim-head` | 2053,5 … 2098,5 | **không đổi** |

Đáy jamb ở `y = 1,5` = `sill + OPENING_CLEARANCE`, không nằm trên `y = 0`, nên quy tắc 7 vẫn xanh.

### Test

Viết trước, **1 test đỏ**: `rule 2: the jambs reach the floor of the reveal and meet the head`
(`trim-left bottom: expected 46.5 to be close to 1.5`). Sau khi sửa: **55/55 xanh** trong
`openings3d.test.ts`.

Một test của vòng 3 phải nới đúng một chỗ: `rule 2: the ring is the same section as the PA door’s, bar
the sill` trước so **toàn bộ** `size` của jamb, nay so **tiết diện** (bề rộng mặt + chiều sâu + `z` +
màu + vật liệu) vì chiều cao jamb roller door **đúng là** khác PA door (không sill). Head vẫn so toàn bộ.

### Kiểm tra vòng 3b

| Việc | Kết quả |
|---|---|
| `pnpm --filter @sq/core test` | **1 228 passed**, 16 skipped (vòng 3: 1 227) |
| `openings3d.test.ts` | **55** (vòng 3: 54) |
| `pnpm --filter @sq/core typecheck` | sạch |
| `pnpm --filter @sq/viewer3d typecheck` | sạch |
| `pnpm build:inc` | chạy; đã kiểm `packages/core/dist` có chuỗi mới, `packages/viewer3d/dist` có `#b9b6ae` |
| `pnpm --filter @sq/site-app typecheck` | sạch |
| `pnpm test:e2e --project=guest` | **5/5 passed**, GR-000059 tự xoá (lần đầu fail vì dev server biên dịch lại; chạy lại xanh) |

**Ảnh:** ghi đè `after/1919-roller.png`; thêm `after/1919-roller-foot.png` (cận chân jamb trái, camera
`(1.05, 0.45, −1.05) → (1.5, 0.1, 0)`, ghi trong `meta.json` mục `round3b`). Ảnh `roller` chỉ đổi
**0,016 %** pixel, và đổi đúng **hai dải hẹp** ở x 474–487 và x 1224–1237 (y 560–660) — chân hai jamb,
không phải một dải ngang. **Phiên này không xem được ảnh.**
