Bạn sửa tiếp phần 3D trim của SmartQuote v2 (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Đây là **vòng 2**: vòng 1 đã xong và đã được review. Vòng này chỉ sửa **một lỗi** review tìm ra và **một chi tiết** có sẵn từ trước, không làm thêm gì khác.

Đọc trước:
- `docs/plans/2026-11-25-3d-trim-flush-prompt.md`: đề bài vòng 1. Mọi ràng buộc ở đó vẫn áp dụng.
- `docs/state/3d-trim-flush.md`: checkpoint vòng 1.

## Ràng buộc (như vòng 1)

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Dùng `localhost`.
- Giữ line ending từng file, **đo theo byte bằng Python** trước khi sửa.
- Không đổi:
  - kích thước nhà, vị trí cửa, màu tường/mái/trim;
  - BOM, giá, `ENGINE_VERSION`, UI, AI, luồng Guest.
- Không đổi các số đã chọn ở vòng 1: base trim 75 mm, corner 60 mm, ridge 175 mm, barge 100 mm.
- File được sửa:
  - `packages/core/src/domain/structure3d.ts`
  - `packages/core/src/domain/__tests__/structure3d.test.ts`
  - `packages/viewer3d/src/Shed3D.tsx` (chỉ cho mục 2)
  - tài liệu ở mục "Tài liệu" bên dưới.

## 1. Lỗi: base trim ngắt sai chỗ ở tường sau và tường trái

### Triệu chứng

Trong `docs/qa/screens/2026-11-25-3d-trim/after/1919-pa-door.png`, dải base trim ở tường sau dừng **trước** PA door một đoạn, rồi chạy tiếp **dưới** cửa.

Review đo bằng probe trên garage 6 × 6 m, PA door rộng 820, `offset` 2 400, đặt lần lượt ở tường sau và tường trái:

| Tường | Lỗ cửa thật trên trục dọc tường | Khoảng ngắt của base trim |
|---|---|---|
| back | x: 2 780 → 3 600 | x: 2 400 → 3 220 |
| left | z: 2 780 → 3 600 | z: 2 400 → 3 220 |

Kết quả: dải đỏ chạy 380 mm dưới cửa, và có 380 mm chân tường cạnh cửa không có trim.

### Nguyên nhân

- `baseTrimParts` (`structure3d.ts` khoảng dòng 391) lấy `hole.u` và `hole.u + hole.width` từ `wallHolesFor`. Đó là toạ độ **cục bộ của tường**: `u` tính từ góc trái của tường khi đứng ngoài nhìn vào.
- Hàm dùng `u` thẳng làm toạ độ thế giới.
- Cách đặt tường nằm ở `wallTransform` (`packages/core/src/domain/walls.ts` dòng 61–77):
  - front: `x = u`
  - right: `z = u`
  - back: đặt ở `[span, 0, length]`, xoay π, nên `x = span − u`
  - left: đặt ở `[0, 0, length]`, xoay π/2, nên `z = length − u`
- Vì vậy tường sau và tường trái bị lật ngược.
- Test hiện có (`'is cut at every door that reaches the floor, and only there'`) chỉ thử tường trước, là tường duy nhất không bị lật, nên không bắt được.

### Việc cần làm

- **Viết test trước và cho nó đỏ:** đặt một cửa chạm sàn lệch tâm (ví dụ `offset` 2 400, rộng 820, trên tường 6 000) lần lượt trên **cả 4 tường**.
  - Lấy toạ độ thế giới của lỗ bằng chính transform của tường (`buildWallGeometries(...).find(...).transform`), **không** tự chép công thức lật vào test.
  - Kiểm hai điều:
    - không đoạn base trim nào giao với lỗ;
    - hai đầu đoạn trim cách mép lỗ không quá 1 mm.
  - Chạy test, thấy đỏ ở back và left, xanh ở front và right.
- **Sửa** `baseTrimParts` để đổi `u` sang toạ độ thế giới **theo cùng cách** mà `wallTransform` đặt tường.
  - Cách được khuyến nghị: tách một hàm nhỏ "điểm `u` trên tường → toạ độ thế giới" (dựa trên `position` và `rotationY` của transform) rồi dùng nó, để hai nơi không bao giờ lệch nhau nữa.
  - Không chép tay bảng 4 trường hợp.
- Chạy lại test, thấy xanh cả 4 tường.
- **Rà các hàm trim khác** xem có hàm nào cũng dùng `u` cục bộ làm toạ độ thế giới không (`cornerTrimParts`, `bargeParts`, và những chỗ có `wallHolesFor`). Có thì sửa và thêm test; không có thì ghi "đã rà, không có" vào báo cáo.

## 2. Sàn bê tông đang tô bằng màu trim

`packages/viewer3d/src/Shed3D.tsx` khoảng dòng 265–269: khối sàn (slab) dùng `config.colors.barge`.

- Khi client chọn trim đỏ, cả cạnh sàn quanh chân nhà thành một dải đỏ liền, chạy cả dưới cửa. Có ở cả ảnh "trước" lẫn "sau".
- Dải này nằm ngay dưới base trim nên trông như hai lớp trim, và có thể là một phần lý do client nói "viền trim đỏ bottom" trông sai.

Việc cần làm:
- Đổi màu sàn sang một màu bê tông trung tính cố định (xám nhạt, ví dụ `#b9b6ae`). Đặt thành một hằng số có tên và comment lý do.
- Sàn **không** thuộc hệ trim nên không theo `colors.barge`.
- Không đổi kích thước hay vị trí của sàn.
- Không thêm vai trò màu mới vào `ShedColors`.

## Kiểm tra

**Lệnh:**
- `pnpm --filter @sq/core test`: pass hết. Ghi số test trước và sau; vòng 1 kết thúc ở 1 211 passed và 16 skipped.
- `pnpm --filter @sq/core typecheck`
- `pnpm --filter @sq/viewer3d typecheck`
- `pnpm build:inc`
- `pnpm --filter @sq/site-app typecheck`

**Ảnh:**
- Chụp lại **cùng cấu hình** vòng 1 (lấy từ `docs/qa/screens/2026-11-25-3d-trim/after/meta.json`), cùng các góc camera, cùng cỡ.
- Ghi đè vào thư mục `after/` hai ảnh: `1919-pa-door.png` và `1919-wall-base.png`.
- Thêm một ảnh mới `1919-pa-door-foot.png`: cận chân PA door, thấy rõ hai đầu base trim dừng đúng mép khung cửa.
- Script chụp tự viết phải stub `**/api/sq/public/guest-requests` và `**/api/sq/public/guest/places/**`. Xoá script khi xong.
- **Tự mở ảnh ra xem.** Nếu phiên của bạn không xem được ảnh thì nói rõ, không mô tả như thể đã thấy.

**Guest e2e:** `pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy. Bản này tự xoá GR nó tạo ra.

## Tài liệu

- `docs/state/3d-trim-flush.md`: thêm mục "Vòng 2" gồm lỗi, nguyên nhân, cách sửa, số test.
- `docs/qa/screens/2026-11-25-3d-trim/README.md`: cập nhật hai ảnh đã ghi đè và thêm ảnh mới.

## Báo cáo (tiếng Việt, ngắn)

- Mục 1:
  - test mới đỏ ở tường nào trước khi sửa, xanh sau khi sửa;
  - cách đổi toạ độ đã dùng;
  - kết quả rà các hàm trim khác.
- Mục 2: màu sàn đã chọn.
- Số test trước và sau, kết quả e2e.
- Danh sách ảnh, mỗi ảnh một câu.
- Danh sách file đã đổi, kèm line ending của từng file.
