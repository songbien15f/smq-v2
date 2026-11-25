Bạn sửa tiếp trang Guest `/quote` (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Đây là vòng 5c: chỉ sửa **một lỗi** mà review tìm ra trong ảnh vòng 5b, không làm thêm gì khác.

Đọc trước mục "Vòng 5b" trong `docs/state/guest-uiux-bugfix.md`.

## Ràng buộc (như vòng 5b)

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Không gọi Google Places thật. Script tự viết phải stub `**/api/sq/public/guest/places/**` và `**/api/sq/public/guest-requests`.
- Dùng `localhost`.
- Giữ line ending từng file, **đo theo byte** trước khi sửa:
  - `guest.css` và `DesignPanel.tsx` là CRLF;
  - `DesignCheck.tsx`, `DesignCheckChip.tsx`, `Stage.tsx`, `ToolsRail.tsx`, `GuestQuote.tsx` là LF.
  - Prompt vòng 5b ghi "tất cả CRLF" là sai.
- Không đổi luật trong `@sq/core`. Giữ giao diện navy/gold.

## Lỗi: dock AI đè lên popover Design check (≥ 768 px)

Lỗi thấy rõ trong `docs/qa/screens/2026-11-25-guest-panel/1919-04-check-popover.png` và `1024-04-check-popover.png`:
- Ba nút gợi ý AI ("Add a side access door", "Add a window on the back", "Make it 7 metres wide") và nút "AI Assistant" (`.g-ai-dock`) nằm **đè lên nửa phải** của popover.
- Chữ của mục "You asked to avoid knee bracing" và câu chân "Rules, not a guess…" bị che.

Vòng 5b vẫn báo pass vì `elementFromPoint` chỉ thử **tâm** của mỗi mục.

### Việc cần làm

- Không để popover và dock chồng lên nhau ở mọi cỡ từ 768 px trở lên. Chọn một trong hai cách, ghi lý do vào báo cáo:
  - **(A, khuyến nghị)** Ẩn `.g-ai-dock` (gợi ý và nút AI Assistant) khi popover đang mở, giống cách phone đang làm (`guest.css` khoảng dòng 3139, `.g-design:has(.g-check-sheet) .g-ai-dock`).
    - Phải ẩn thật (`visibility: hidden` hoặc `display: none`), để dock ra khỏi thứ tự tab và cây a11y khi bị ẩn.
    - Đóng popover thì dock hiện lại.
  - **(B)** Giữ dock và kẹp popover sang trái, chừa khoảng `--g-dock-space` (`guest.css` khoảng dòng 1234, 248 px).
    - Kiểm ở 1024 xem popover còn đủ rộng không (tối thiểu khoảng 300 px). Không đủ thì dùng A.
- Nếu panel AI Assistant bên phải đang mở (`data-right='open'`): popover cũng không được đè lên panel đó.

### Kiểm tra (quy tắc mới: kiểm cả 4 góc, không chỉ tâm)

Script tự kiểm có stub, chạy ở 1919, 1280, 1280×720 và 1024×600. Xoá script khi xong.

Với mỗi mục trong popover và với câu chân:
- lấy **4 góc** (thụt vào 2 px) cộng với tâm;
- `elementFromPoint` ở cả 5 điểm phải trả về phần tử nằm trong popover.

Chạy 3 trường hợp:
1. dock đang hiện các gợi ý AI;
2. panel trái mở;
3. panel trái đóng.

Ngoài ra:
- Phương án A: `.g-ai-dock` có `getComputedStyle().visibility === 'hidden'` (hoặc display none) khi popover mở, và hiện lại sau khi Esc.
- Phương án B: in khung bao của popover và của dock, chứng minh hai khung không giao nhau.

Kiểm tra chung:
- Typecheck `@sq/site-app`. Chạy `pnpm build`.
- Guest e2e (`pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy). Ghi lại số GR mà e2e tạo ra; không xoá.

### Ảnh

- Chụp lại, ghi đè: `1919-04-check-popover.png`, `1280-04-check-popover.png`, `1280x720-04-check-popover.png`, `1024-04-check-popover.png`.
- Mỗi ảnh phải chụp trong trạng thái **dock đang có gợi ý AI**, giống ảnh vòng 5b.
- **Nếu phiên của bạn không xem được ảnh, nói rõ trong báo cáo**, để người review tự mở ra xem. Không viết mô tả ảnh như thể đã nhìn thấy.

## Tài liệu

- `docs/state/guest-uiux-bugfix.md`: thêm mục "Vòng 5c".
- `docs/smartquote-quote-editor-reference.md` §3.5c: thêm một câu nói dock ẩn đi hoặc nhường chỗ khi danh sách Design check mở.

## Báo cáo (tiếng Việt, ngắn)

- Chọn A hay B, và vì sao.
- Bảng 5 điểm × số mục × 4 cỡ: chỉ cần tổng số điểm trúng trên tổng số điểm đo, cộng với điểm nào trượt (nếu có).
- Kết quả e2e và số GR đã tạo.
- Danh sách ảnh.
- Danh sách file đã đổi, kèm line ending của từng file.
