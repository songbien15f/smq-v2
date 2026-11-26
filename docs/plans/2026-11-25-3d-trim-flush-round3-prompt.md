Bạn sửa tiếp phần 3D của SmartQuote v2 (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Đây là **vòng 3**: vòng 1 và vòng 2 đã xong, review đạt và đã commit (HEAD `7626438`). Vòng này chỉ làm **một việc**: đưa roller door về đúng vị trí lắp thật, để nó không còn nhô ra khỏi mặt tường.

Đọc trước:
- `docs/plans/2026-11-25-3d-trim-flush-prompt.md`: đề bài vòng 1. Mọi ràng buộc ở đó vẫn áp dụng.
- `docs/state/3d-trim-flush.md`: checkpoint vòng 1 và vòng 2.

## Ràng buộc

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Dùng `localhost`.
- Giữ line ending từng file, **đo theo byte bằng Python** trước khi sửa.
- Không đổi:
  - BOM, giá, `ENGINE_VERSION`, UI, AI, luồng Guest;
  - kích thước, vị trí hay màu của bất cứ thứ gì ngoài roller door.
- Không đổi các con số đã chọn ở vòng 1 và vòng 2.
- **Không đụng sliding door.** Cửa lùa của shed ở Úc treo trên ray **bên ngoài** tường và trượt dọc mặt tôn, nên nhô ra là đúng thiết kế.
- **Không đổi ký hiệu 2D.** `ROLLER_DEPTH`, `ROLLER_INSET` và `ROLLER_TRACK_WIDTH` được bản vẽ mặt bằng dùng. Nếu 3D cần số khác thì đặt hằng số mới.
- File được sửa:
  - `packages/core/src/domain/openings3d.ts`
  - `packages/core/src/domain/__tests__/openings3d.test.ts`
  - tài liệu ở mục "Tài liệu" bên dưới.

## Hệ toạ độ (cục bộ của cửa, đã có sẵn)

- `z = 0` là mặt ngoài của tôn.
- `z = WALL_DEPTH` (50) là mặt trong.
- `z < 0` là bên ngoài nhà, `z > WALL_DEPTH` là bên trong nhà.
- `outerZ(part)` trong test đo mặt ngoài cùng của một part, có tính phép xoay.

## Hiện trạng

Theo `rollerDoorParts` (`openings3d.ts` khoảng dòng 161–270) và test "what is still proud — recorded, not fixed", các phần sau đang nằm ngoài nhà:

| Part | z hiện tại | Nhô ra |
|---|---|---|
| `curtain` | tâm −28, dày 22 | 39 mm |
| `slat-*` | tâm −48 | 53 mm |
| `guide-left` / `guide-right` | tâm −35, sâu 90 | 80 mm |
| `head` | tâm −70, sâu 120 | 130 mm |
| `bottom-bar` | tâm −44 | 64 mm |

Còn `drum`, `bracket-*` và `spring-*` đã nằm trong nhà từ trước: `drumZ = WALL_DEPTH + 30 + ROLLER_DRUM_RADIUS`. Phần này giữ nguyên.

## Đích: lắp như thật

Ngoài thực tế, roller door được lắp ở **mặt trong** của lỗ cửa:
- ray dẫn bắt vào mặt trong của khung cửa;
- tấm cuốn thả xuống từ mặt trước của trục cuốn;
- đứng ngoài nhìn vào, ta thấy lỗ cửa có viền, tấm cuốn **lùi vào trong**, và không có gì nhô ra.

Quy tắc phải đạt (mỗi quy tắc là một assertion):

1. **Không part nào của roller door có `outerZ < 0`.** Không có ngoại lệ (roller door không có cánh mở như PA door).
2. **Viền lỗ cửa:** head và hai jamb dùng cùng tiết diện, cùng vật liệu, cùng màu `colors.barge` với viền của PA door và cửa sổ (`OPENING_TRIM_FACE`, `OPENING_TRIM_DEPTH`), nằm trong lỗ ở `z ∈ [0, OPENING_TRIM_DEPTH]`.
   - **Không có sill:** xe chạy qua ngưỡng cửa, và base trim đã ngắt tại lỗ này.
   - Cho `trimRing` một cách bỏ sill (ví dụ một tham số) thay vì chép lại ba thanh.
   - PA door và cửa sổ phải ra **đúng y** các part như trước khi sửa (so sánh bằng test).
3. **Tấm cuốn nằm trong nhà và thẳng với trục cuốn.**
   - Mặt trước tấm cuốn ở `z > WALL_DEPTH`.
   - Mặt trước tấm cuốn cách tiếp tuyến trước của trục cuốn (`drumZ − ROLLER_DRUM_RADIUS`) không quá 15 mm, để nhìn ra là tấm cuốn thả xuống từ trục.
4. **Slat rib và bottom bar** đi theo tấm cuốn: nằm sát mặt trước tấm cuốn, vẫn trong nhà, không mặt nào trùng mặt nào.
5. **Ray dẫn** ở trong nhà, ôm hai mép tấm cuốn.
   - Giữ cách "lún 10 mm vào tôn" như hiện tại để không mặt nào nằm đúng trên `z = WALL_DEPTH`.
   - Ray không được chồng lên viền ở quy tắc 2.
6. **Bỏ khối `head` nhô 130 mm.** Đầu lỗ cửa giờ do viền ở quy tắc 2 đảm nhận.
7. **Chống chớp hình:** không part nào có mặt nằm đúng trên `z = 0` hay `z = WALL_DEPTH`. Kiểm bằng test, sai số 1e-6.
8. **Giữ nguyên** `drum`, `bracket-*`, `spring-*`: vị trí, kích thước, màu.

Desktop vẽ roller door ở `smq-code-smartquote/Modules/PLan3D/SmartQuote.Module.Plan3D/Elements/RDoor3D.cs` (khoảng dòng 130–175, `RDOOR_FRAME_THICK` = 30 trong `GlobalStatus.cs:90`). File này chỉ để tham khảo; quy tắc ở trên mới là đích. Nếu bạn thấy desktop đặt khác và có lý do thì ghi vào báo cáo, đừng tự đổi đích.

## Việc cần làm (theo thứ tự)

1. **Chụp ảnh "trước"**, trước khi sửa code (xem mục Ảnh).
2. **Viết test trước và cho nó đỏ.**
   - Đưa roller door vào vòng lặp test "nothing … stands proud of z = 0", không có ngoại lệ.
   - Thêm test cho các quy tắc 2, 3, 5, 7, 8.
   - Thêm test "PA door và cửa sổ không đổi".
   - Chạy test và ghi lại những test nào đỏ.
3. **Sửa test kiểm kê cũ.**
   - Phần roller trong "what is still proud — recorded, not fixed" nay sai, nên xoá.
   - Phần sliding giữ nguyên số đo, nhưng sửa comment thành "nhô ra theo thiết kế: cửa treo ngoài tường", không còn là "chưa sửa".
4. **Sửa `rollerDoorParts`** (và `trimRing` nếu cần) cho test xanh. Cập nhật comment đầu hàm, vì comment hiện tại nói "Curtain, guides and head sit outside the wall".
5. **Kiểm base trim:** ở lỗ roller door, base trim vẫn ngắt đúng hai mép lỗ. Logic không đổi, chỉ cần xác nhận lại bằng test có sẵn hoặc một probe.

## Kiểm tra

**Lệnh:**
- `pnpm --filter @sq/core test`: pass hết. Ghi số test trước và sau; vòng 2 kết thúc ở 1 215 passed và 16 skipped.
- `pnpm --filter @sq/core typecheck`
- `pnpm --filter @sq/viewer3d typecheck`
- `pnpm build:inc`
- `pnpm --filter @sq/site-app typecheck`
- Kiểm `packages/viewer3d/dist` và `packages/core/dist` đã có code mới trước khi chụp ảnh. Vòng 2 đã gặp trường hợp `build:inc` không rebuild hết.

**Ảnh:**
- Cùng cấu hình với `docs/qa/screens/2026-11-25-3d-trim/after/meta.json` (roller door ở tường trước, `offset` 1 500, rộng 3 000, cao 2 100), cùng cỡ 1711 × 787.
- Trước khi sửa, lưu vào `docs/qa/screens/2026-11-25-3d-trim/round3-before/`:
  - `1919-roller.png`: chính diện roller door từ ngoài;
  - `1919-roller-side.png`: góc nghiêng gần dọc theo tường, thấy rõ phần nhô ra.
- Sau khi sửa, lưu cùng hai tên đó vào `after/`, cùng camera. Ghi đè thêm `after/1919-overview.png`.
- Ghi camera của từng ảnh vào `meta.json`.
- Script chụp tự viết phải stub `**/api/sq/public/guest-requests` và `**/api/sq/public/guest/places/**`. Xoá script khi xong.
- **Tự mở ảnh ra xem.** Nếu phiên của bạn không xem được ảnh thì nói rõ, không mô tả như thể đã thấy.

**Guest e2e:** `pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy, và chờ dev server biên dịch xong rồi mới chạy. Bản này tự xoá GR nó tạo ra.

## Tài liệu

- `docs/state/3d-trim-flush.md`: thêm mục "Vòng 3"; sửa dòng "Roller/sliding door vẫn nhô" cho đúng (roller đã sửa, sliding nhô theo thiết kế).
- `docs/qa/screens/2026-11-25-3d-trim/README.md`: thêm thư mục `round3-before/` và các ảnh mới.
- `docs/smartquote-quote-editor-reference.md` (tiếng Việt): nếu có đoạn mô tả 3D của roller door hay ghi "roller door nhô ra", sửa cho đúng. Nếu không có thì ghi "không có đoạn nào cần sửa" vào báo cáo.

## Báo cáo (tiếng Việt, ngắn)

- Bảng z của từng part roller door: trước và sau.
- Những test nào đỏ trước khi sửa, xanh sau khi sửa.
- Cách bỏ sill khỏi `trimRing`, và bằng chứng PA door với cửa sổ không đổi.
- Base trim ở lỗ roller door vẫn ngắt đúng chưa.
- Số test trước và sau, kết quả e2e.
- Danh sách ảnh, mỗi ảnh một câu.
- Danh sách file đã đổi, kèm line ending của từng file.
