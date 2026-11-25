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
- **Roller/sliding door vẫn nhô** — ngoài phạm vi góp ý, số đo đã chốt trong test, xem báo cáo.
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
