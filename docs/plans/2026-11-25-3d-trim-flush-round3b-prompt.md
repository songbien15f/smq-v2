Bạn sửa tiếp phần 3D của SmartQuote v2 (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Đây là **vòng 3b**, một lỗi nhỏ review tìm ra sau vòng 3. Code vòng 3 đang nằm trong working tree, **chưa commit**: giữ nguyên, sửa tiếp lên trên.

Đọc trước:
- `docs/plans/2026-11-25-3d-trim-flush-round3-prompt.md`: đề bài vòng 3. Mọi ràng buộc ở đó vẫn áp dụng.
- `docs/state/3d-trim-flush.md`: mục "Vòng 3".

## Ràng buộc

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Dùng `localhost`.
- Giữ line ending từng file, **đo theo byte bằng Python** trước khi sửa. Hai file TS đang là CRLF.
- Không đổi bất kỳ con số nào của vòng 1–3, trừ chiều cao và vị trí `y` của hai jamb roller door.
- File được sửa:
  - `packages/core/src/domain/openings3d.ts`
  - `packages/core/src/domain/__tests__/openings3d.test.ts`
  - tài liệu ở mục "Tài liệu" bên dưới.

## Lỗi: jamb của roller door không chạm sàn

### Triệu chứng

- Review đo bằng probe (roller door rộng 3 000, cao 2 100, offset 1 500, tường trước):
  - `trim-left` và `trim-right` chạy từ `y = 46.5` đến `y = 2053.5`;
  - `trim-head` chạy từ `y = 2053.5` đến `y = 2098.5`.
- Hai jamb dừng cách đáy lỗ 46,5 mm.
- Trong `docs/qa/screens/2026-11-25-3d-trim/after/1919-roller.png`, phóng to góc dưới hai bên cửa (khoảng x 440–540 và 1180–1280, y 590–680) sẽ thấy một khấc tôn xám lộ ra ở chân jamb, ngay chỗ base trim dừng.

### Nguyên nhân

- Trong `trimRing` (`openings3d.ts`), chiều cao jamb là `innerH − face·2` và tâm jamb nằm ở `y + innerH / 2`.
- Công thức đó chừa chỗ cho **cả** head lẫn sill.
- Khi `withSill = false`, sill không còn nhưng phần chừa cho nó vẫn còn.

### Việc cần làm

1. **Viết test trước và cho nó đỏ.** Trong `describe('roller door — mounted on the inside face')`, thêm test cho mỗi jamb của roller door. Lấy số từ chính các part, không chép hằng số tay:
   - mặt dưới jamb nằm đúng mặt dưới của lỗ trong ring, tức `sill + OPENING_CLEARANCE` (sai số 1e-6);
   - mặt trên jamb nằm đúng mặt dưới của `trim-head` (sai số 1e-6).

   Chạy test, ghi lại test nào đỏ.
2. **Sửa `trimRing`.**
   - Khi `withSill = false`: jamb chạy từ đáy lỗ trong ring lên tới mặt dưới head. Chiều cao là `innerH − face`, tâm đặt lại cho đúng.
   - Khi `withSill = true`: **không đổi gì**.
   - Hai test "a window is unchanged" và "a PA door is unchanged" phải xanh mà không sửa test.
3. Chạy lại toàn bộ test `openings3d`, thấy xanh, kể cả quy tắc 7 (chống chớp hình).
   - Mặt dưới jamb ở `y = 1.5`, không nằm trên `y = 0`.

## Kiểm tra

**Lệnh:**
- `pnpm --filter @sq/core test`: pass hết. Vòng 3 kết thúc ở 1 227 passed và 16 skipped.
- `pnpm --filter @sq/core typecheck`
- `pnpm --filter @sq/viewer3d typecheck`
- `pnpm build:inc`
- Kiểm `packages/core/dist` và `packages/viewer3d/dist` đã có code mới trước khi chụp ảnh.

**Ảnh:**
- Cùng cấu hình và cùng camera với `docs/qa/screens/2026-11-25-3d-trim/after/meta.json`, cùng cỡ 1711 × 787.
- Ghi đè `after/1919-roller.png`.
- Thêm `after/1919-roller-foot.png`: cận chân jamb trái của roller door từ ngoài, thấy jamb chạm đáy lỗ và base trim dừng ngay cạnh. Ghi camera vào `meta.json` (mục `round3b`).
- Script chụp tự viết phải stub `**/api/sq/public/guest-requests` và `**/api/sq/public/guest/places/**`. Xoá script khi xong.
- Lưu ý từ vòng 3:
  - chờ dev server biên dịch xong rồi mới chụp;
  - reload trang sẽ đưa editor về step đầu.
- **Tự mở ảnh ra xem**, phóng to chân jamb. Nếu phiên của bạn không xem được ảnh thì nói rõ, không mô tả như thể đã thấy.

**Guest e2e:** `pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy.

## Tài liệu

- `docs/state/3d-trim-flush.md`: thêm mục "Vòng 3b" gồm lỗi, nguyên nhân, cách sửa, số test.
- `docs/qa/screens/2026-11-25-3d-trim/README.md`: ghi ảnh đã ghi đè và ảnh mới.

## Báo cáo (tiếng Việt, ngắn)

- `y` của hai jamb roller door trước và sau.
- Test nào đỏ trước khi sửa, xanh sau khi sửa.
- Bằng chứng PA door và cửa sổ không đổi.
- Số test trước và sau, kết quả e2e.
- Danh sách ảnh, mỗi ảnh một câu.
- Danh sách file đã đổi, kèm line ending của từng file.
