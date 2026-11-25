Bạn làm tiếp trang Guest `/quote` trong repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`: ba góp ý UI của khách hàng (vòng 5).

Đọc trước:
- `CLAUDE.md` của repo
- `docs/state/guest-uiux-bugfix.md` (các vòng 1–4)
- `design-system/smartquote-v2/MASTER.md`

## Ràng buộc (giữ nguyên các vòng trước)

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`. Không in khoá API hay mật khẩu.
- Không gọi Google Places thật. Dùng stub `**/api/sq/public/guest/places/**`.
- Không tạo request thật. Script tự viết phải stub `**/api/sq/public/guest-requests` (có gạch nối).
- Bộ e2e `guestQuote.spec.ts` gửi thật vào DB dev. Ghi lại mọi số GR mà nó tạo ra. Không tự xoá.
- Dùng `localhost`, không dùng `127.0.0.1`. Không nâng cấp Next/three/R3F.
- Giữ kiểu xuống dòng của từng file. `guest.css`, `panels.ts`, `ControlAccordion.tsx`, `DesignPanel.tsx`,
  `AddressPanel.tsx`, `SiteEstimate.tsx` là CRLF. `DesignCheck.tsx`, `Stage.tsx`, `ToolsRail.tsx`,
  `GuestQuote.tsx` là LF.
- Giữ giao diện navy/gold.
- Không đổi luật trong `@sq/core`. `assessGuestDesign` và `validateGuestDesign` giữ nguyên; chỉ đổi cách hiển thị.
- Phải dùng được bằng bàn phím và screen reader. Mỗi thay đổi phải chạy được ở 1919, 1280, 1024 và 390 px.

## 1. Step ①: hộp wind phải nằm ngay dưới địa chỉ

Nguyên nhân:
- Vòng 1 đưa `<SiteEstimate>` vào trong `.g-address` (`AddressPanel.tsx`, nhánh đã chọn địa chỉ, khoảng dòng 188–218).
- Từ 1024 px trở lên, `.g-address` là lưới 2 cột (`guest.css` khoảng dòng 658–668).
- Vì vậy hộp `.g-wind` rơi sang cột phải.

Việc cần làm:
- Ở nhánh đã chọn địa chỉ, xếp dọc: dòng địa chỉ + nút Change, rồi hộp wind ngay bên dưới, cùng bề ngang.
  Ví dụ dùng một class riêng cho nhánh này, một cột.
- Giữ việc hộp wind đi theo địa chỉ đang chọn, và ẩn đi khi bấm Change.
- Nhánh tìm kiếm (ô search, link manual, …) giữ nguyên.
- Kiểm ở 1919, 1280 và 390 px.

## 2. Step ② Your building: panel gọn hơn

### 2a. Mặc định thu gọn

- `panels.ts` `defaultsFor`: desktop và tablet đổi thành `leftOpen: false`. AI assistant vẫn `rightOpen: false`.
- Thanh icon (`ToolsRail`) vẫn luôn hiện từ 1024 px trở lên. Bấm một icon thì mở panel ở đúng nhóm đó.
- Bấm lại icon đang mở thì đóng panel.
- Phone giữ như cũ (cả hai panel đóng).
- Sửa comment đầu file `panels.ts` (đang ghi "desktop and tablet tools open").
- Kiểm `GuestQuote.tsx:116`. Hiện nó gọi `focusSelector('.g-check-btn')` khi vào ②, nhưng Design check sẽ chuyển chỗ ở mục 2c.
  Focus phải rơi vào phần tử có thật và nhìn thấy được: chip check nếu có mục cần kiểm, nếu không thì
  không chuyển focus.

### 2b. Mỗi lần chỉ hiện nội dung một nhóm (tab thật, không phải accordion)

Hiện tại `ControlAccordion` là 3 `<details>` mở từng cái một, nhưng tiêu đề của cả 3 nhóm vẫn chồng lên nhau.

Đổi thành:
- Panel chỉ render nội dung của nhóm `group` đang chọn (Size & structure / Colours / Doors & windows).
  Tiêu đề panel là tên nhóm đó.
- Bỏ các `<summary>` của nhóm không chọn.
- Thanh icon là bộ chọn tab: `role="tablist"`, nút có `role="tab"`, `aria-selected`, `aria-controls`, và
  phím mũi tên trái/phải hoặc lên/xuống.
- Nội dung có `role="tabpanel"`.
- Trên phone thanh icon bị ẩn (tools là drawer). Đầu drawer phải có một hàng tab chữ
  Size / Colours / Doors để đổi nhóm.
- Lỗi kiểm hợp lệ (`issues` từ `validateGuestDesign`) thuộc nhóm không đang mở thì vẫn phải thấy được:
  - hiện chấm cam trên tab của nhóm đó, kèm `aria-label` như "Size — 1 problem";
  - nút Send vẫn chặn như hiện nay.
- `focusSelector` trong `store.ts` (khoảng dòng 647) hiện mở `<details>` gần nhất. Đổi thành:
  - tìm nhóm chứa selector đích, rồi `openTools()` và chọn đúng tab trước khi focus;
  - phần tử đích chưa render vì đang ở tab khác → đổi tab trước, focus sau khi render;
  - nút "View on plan", Design check và AI đều dùng hàm này, nên kiểm cả ba.
- Gỡ phần CSS `.g-group*` không còn dùng. Không để lại selector chết.

### 2c. Design check: không còn là khối trong panel

Design check là `assessGuestDesign` (luật, không phải AI). Các mục có mức `ok`, `note` hoặc `review`, và thuộc
nhiều nhóm khác nhau (nhịp, bay, mái, móng thuộc Size; lỗ cửa sát góc thuộc Doors). Vì vậy nó không phải
một tab.

Việc cần làm:
- Bỏ `<DesignCheck>` khỏi `DesignPanel` (`.g-controls-body`).
- Thêm một chip vào hàng chip của `Stage.tsx` (`.g-stage-chips`, cạnh Ridge / Bays / Roof / Walls / Wind):
  - có mục `review`: `⚠ N to check`, nền cam nhạt, đạt AA;
  - chỉ có `note`: `ⓘ N notes`;
  - không có gì: `✓ Nothing to flag`.
- Bấm chip thì mở danh sách:
  - desktop/tablet: popover neo vào chip, có `aria-expanded`, `aria-controls`, Esc đóng, bấm ra ngoài đóng,
    focus quay về chip;
  - phone: bottom sheet hoặc mở rộng ngay dưới hàng chip (không popover lơ lửng);
  - tái dùng `CheckItem` và logic của `DesignCheck.tsx`, chỉ đổi vỏ ngoài.
- Danh sách chỉ hiện `review` trước, rồi `note`. Ẩn mục `ok`; chip "Nothing to flag" đã nói thay chúng.
- Bấm một mục thì đóng popover, rồi `focusSelector(item.focus)`, tức là mở panel đúng tab và focus vào ô điều khiển.
- Rail/tab: nhóm nào có mục `review` thì có chấm cam, giống quy ước lỗi ở 2b.
  Ánh xạ mục → nhóm suy từ `item.focus`, bằng cách xem selector nằm trong tabpanel nào.
  Không thêm field mới vào core.
- Giữ câu "Rules, not a guess. An estimator checks every design before quoting." ở chân popover.
- Không hiện giá hay chi phí trong bất cứ câu nào (D-T3).

## 3. Kiểm tra

- Typecheck `@sq/site-app`. Chạy `pnpm build`.
- Guest e2e: `pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy.
  - `openGroup()` trong `e2e/guestQuote.spec.ts` (khoảng dòng 56) đang bấm `<summary>`. Đổi sang bấm tab.
  - Sửa **spec** cho khớp hành vi mới; không nới logic khóa bước.
  - Ghi lại số GR mà e2e tạo ra.
- Tự kiểm bằng script Playwright có stub, ở 1919 / 1280 / 1024 / 390, rồi xoá script sau khi xong:
  1. vào ② thì panel đóng, rail còn hiện, AI đóng;
  2. bấm Size: chỉ có nội dung Size, không còn tiêu đề Colours/Doors trong panel;
  3. bấm Doors: chỉ có nội dung Doors;
  4. bấm lại Doors thì panel đóng;
  5. đặt pitch hoặc bay gây mục `review` → chip ghi "1 to check", tab Size có chấm;
     bấm chip, bấm mục đó → panel mở tab Size, focus đúng ô;
  6. ① sau khi chọn địa chỉ: `.g-wind` nằm **dưới** dòng địa chỉ
     (`wind.top > address.bottom`, và `wind.left` gần bằng `address.left`);
  7. 390 px: không có cuộn ngang (`scrollWidth === 390`), drawer có hàng tab chữ, danh sách check mở được.
- Chụp ảnh "sau" cho 1, 2a, 2b, 2c ở 1919 và 390 vào `docs/qa/screens/2026-11-25-guest-panel/`.
  Không có ảnh trước hợp lệ; ghi rõ như vậy. Không dùng `git stash`.

## Cập nhật tài liệu

- `docs/state/guest-uiux-bugfix.md`: thêm mục "Vòng 5".
- `docs/smartquote-quote-editor-reference.md`: sửa phần mô tả trang Guest step ② (panel tab, mặc định thu gọn,
  chip Design check) cho đúng code.

## Báo cáo cuối (tiếng Việt, ngắn)

- Mục nào xong, mục nào để lại, kèm lý do.
- Kết quả e2e (pass/fail, spec nào sửa và vì sao) và số GR đã tạo.
- Kết quả 7 bước tự kiểm, kèm số đo.
- Danh sách ảnh.
- Danh sách file đã đổi.
