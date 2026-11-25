Bạn sửa tiếp vòng 5 của trang Guest `/quote` (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Đây là vòng 5b: chỉ sửa những gì review tìm ra, không làm thêm gì khác.

Đọc trước:
- `docs/plans/2026-11-25-guest-design-panel-prompt.md` (prompt vòng 5)
- mục "Vòng 5" trong `docs/state/guest-uiux-bugfix.md`

## Ràng buộc (như vòng 5)

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Không gọi Google Places thật. Script tự viết phải stub `**/api/sq/public/guest/places/**` và `**/api/sq/public/guest-requests`.
- Dùng `localhost`.
- Giữ line ending: các file trong `apps/site/src/app/quote/` hiện đều là CRLF. Giữ nguyên CRLF.
- Không đổi luật trong `@sq/core`. Giữ giao diện navy/gold.
- **Quy tắc kiểm tra mới:** mọi kiểm tra "mở được hoặc hiện được" phải chứng minh phần tử **nhìn thấy được trên màn hình**, không chỉ có trong DOM. Tức là:
  - `getBoundingClientRect()` nằm trong viewport, và
  - nằm trong khung cha có `overflow` cắt (stage/workspace), và
  - `document.elementFromPoint(tâm phần tử)` trả về chính phần tử đó hoặc con của nó, tức là không bị thứ khác che.

## 1. Lỗi: popover Design check bị cắt trên desktop/tablet

Tình trạng hiện tại:
- Ảnh `docs/qa/screens/2026-11-25-guest-panel/1919-04-check-popover.png` chỉ cho thấy một dải trắng mỏng dưới chip "1 to check".
- Nguyên nhân: `.g-check-pop` có `top: calc(100% + 8px)` (`guest.css` khoảng dòng 3091–3104), nên popover mở xuống dưới.
- Từ 768 px trở lên, hàng chip nằm sát đáy stage (`.g-design .g-stage-chips`), nên popover rơi ra ngoài vùng nhìn thấy và bị cắt.
- Bước 5 của vòng 5 báo pass vì chỉ đếm phần tử trong DOM.

Việc cần làm:
- Cho popover mở **lên trên** chip: `bottom: calc(100% + 8px); top: auto`.
- Kiểm cạnh ngang: chip có thể nằm giữa hàng chip, vì hàng chip bị dời khi panel trái mở. Popover không được tràn khỏi stage ở cả trái lẫn phải; nếu cần, dùng `left: 0` thay cho `right: 0`, hoặc kẹp lại bằng JS.
- `max-height` phải vừa khoảng trống phía trên chip, kể cả khi màn hình thấp (1024×600 và 1280×720). Khi vượt chiều cao thì cuộn bên trong popover.
- Popover phải nằm trên 3D canvas và thanh tab, không bị chúng che. Kiểm `z-index`.

## 2. Phone: hàng danh sách check mở ra phải nhìn thấy được

- Ảnh `390-08-check-row.png` không cho thấy hàng danh sách. Có lẽ hàng đó nằm dưới thanh "Send quote request" cố định ở đáy, hoặc dưới nút AI Assistant.
- Khi mở hàng này trên phone, cuộn để nó nằm trọn trên thanh đáy, ví dụ dùng `scrollIntoView({ block: 'nearest' })` cộng với `scroll-margin-bottom` bằng chiều cao thanh đáy.
- Nếu người dùng đã bật reduced motion thì không cuộn mượt.
- Nút AI Assistant và nút Insight nổi không được che chữ của danh sách. Kiểm bằng `elementFromPoint` trên từng mục.

## 3. Nhãn chip "1 notes"

- `DesignCheckChip.tsx`: chữ hiển thị phải chia số ít/số nhiều: "1 note", "2 notes".
- Tên đọc cho screen reader (`spoken`) đã đúng. Gộp chữ hiển thị và tên đọc về một nguồn để chúng không lệch nhau.
- Kiểm cả "1 to check" và "2 to check". Cụm này không đổi theo số nên giữ nguyên.

## 4. Hai mục vòng 5 chưa kiểm bằng máy

- **Phím mũi tên trên rail (≥1024) và hàng tab chữ trong drawer (390):** viết script kiểm ↑/↓/←/→/Home/End.
  - `aria-selected` và focus chuyển đúng tab.
  - Tab được chọn có `tabIndex=0`, các tab khác có `-1`.
- **Độ tương phản AA:** đo tỷ lệ tương phản chữ/nền và icon/nền của cả 3 chip:
  - `review`: chữ ≥ 4,5:1, icon ≥ 3:1;
  - `note` và `ok`: cùng mức;
  - viền focus của chip ≥ 3:1 so với nền.

  Dùng lại `scripts/qa-contrast.mjs` nếu hợp. Ghi số đo vào báo cáo.

## 5. Mục 1 (hộp wind) ở 390 px

- Vòng 5 chỉ đo ở 1919 và 1280. Hãy đo ở 390: `wind.top > address.bottom` và `|wind.left − address.left| ≤ 1`, đồng thời không có cuộn ngang.
- Chụp `390-06-address-wind.png`.

## Kiểm tra

- Typecheck `@sq/site-app`. Chạy `pnpm build`.
- Guest e2e (`pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy):
  - Ghi lại số GR mà e2e tạo ra. Không xoá.
  - Nếu e2e có kiểm popover, thêm một assert "nhìn thấy được" (`toBeInViewport()` hoặc `elementFromPoint`) cho popover ở desktop.
- Script tự kiểm có stub, chạy ở 1919, 1280, 1280×720, 1024×600 và 390. Xoá script khi xong. Script phải in ra:
  1. khung bao của popover so với khung bao của stage (popover nằm trọn trong stage) và kết quả `elementFromPoint`;
  2. ở 390: khung bao của hàng check so với đỉnh thanh Send ở đáy;
  3. nhãn chip ở các trường hợp 1 note, 2 notes, 1 to check;
  4. kết quả phím mũi tên;
  5. bảng tương phản;
  6. số đo hộp wind ở 390.
- Chụp lại ảnh vào `docs/qa/screens/2026-11-25-guest-panel/`:
  - ghi đè `1919-04-check-popover.png`, `390-08-check-row.png`;
  - thêm `1280-04-check-popover.png`, `1024-04-check-popover.png`, `390-06-address-wind.png`.
- **Tự mở từng ảnh ra xem** trước khi báo cáo, và mô tả mỗi ảnh một câu: thấy gì, popover hoặc hàng danh sách có hiện đủ chữ không.

## Tài liệu

- `docs/state/guest-uiux-bugfix.md`: thêm mục "Vòng 5b".
- `docs/smartquote-quote-editor-reference.md` §3.5c: nếu cách hiển thị đổi (mở lên trên, cuộn vào tầm nhìn trên phone) thì sửa cho đúng.

## Báo cáo (tiếng Việt, ngắn)

- Từng mục 1–5: xong hay để lại, kèm lý do.
- Số đo từ script (mục 1–6 của phần Kiểm tra).
- Kết quả e2e và số GR đã tạo.
- Danh sách ảnh, mỗi ảnh một câu mô tả.
- Danh sách file đã đổi.
