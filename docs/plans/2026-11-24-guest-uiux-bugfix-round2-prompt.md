Bạn tiếp tục việc sửa bug Guest UI/UX trong repo `D:\Docs\OS.mr.Thi\02.smartquote_v2` (vòng 2).

Đọc trước:
- `docs/plans/2026-11-24-guest-uiux-bugfix.md` (plan gốc; mục "Ràng buộc chung" và "Review focus")
- `docs/state/guest-uiux-bugfix.md` (checkpoint vòng 1)
- `CLAUDE.md` của repo

Vòng 1 đã xong và đã được review: B2, M1–M8, khung cửa sổ, E1–E3, E6–E8, E10–E12, mobile 390px.
Core test 1169 pass, typecheck sạch. Toàn bộ thay đổi vẫn **chưa commit**. Giữ nguyên như vậy.
Request thật GR-000038 đã được xoá; đừng nhắc lại.

## Ràng buộc (giữ nguyên từ vòng 1)
- Không commit, không push. Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
  Không in khoá API hay mật khẩu ra màn hình.
- Không gọi Google Places thật: dùng stub `**/api/sq/public/guest/places/**`, `GUEST_PLACES_ENABLED` giữ 1.
- Dùng `localhost`, không dùng `127.0.0.1`. Không nâng cấp Next/three/R3F.
- Giữ kiểu xuống dòng (CRLF) của từng file.
- Không đổi `placementRules.ts`, giới hạn 15 m, `GUEST_DEFAULT_TYPES`, `needsConfirm`, màu mặc định preset
  của khách. Giữ giao diện navy/gold.
- **Không tạo request thật.** Mọi script tự viết phải stub đúng đường dẫn
  `**/api/sq/public/guest-requests` (có gạch nối; vòng 1 stub sai `/guest/requests` nên đã tạo GR-000038).
  Riêng bộ e2e `guestQuote.spec.ts` gửi thật vào DB dev: ghi lại mọi số GR mà lần chạy tạo ra và liệt kê
  trong báo cáo. **Không tự xoá.**

## Việc cần làm (theo thứ tự)

### 1. Chạy guest e2e: việc quan trọng nhất, vòng 1 chưa chạy
- Cần `pnpm dev` đang chạy. Chạy `pnpm test:e2e` (hoặc chỉ `e2e/guestQuote.spec.ts`).
- Sửa spec nào vỡ do logic khóa bước mới (`stepLocked` dùng `contactValid`, tab bị khóa vẫn bấm được và đưa
  về ① kèm focus, ô mobile tự định dạng thành `412 345 678` khi blur).
- Sửa **spec** cho khớp hành vi đúng. **Không** nới lỏng logic khóa bước để spec pass.
  Nếu spec bắt được bug thật thì sửa code.
- Không thêm lượt đăng nhập cho từng test (mỗi phiên giữ một seat licence).

### 2. Sửa trạng thái sai trong plan
Trong "Kiểm tra cuối & Definition of Done" của plan gốc có hai ô đang đánh `[x]` nhưng chưa làm:
- e2e
- bộ ảnh cho E9

Chỉ đánh lại khi đã làm thật; nếu không thì bỏ dấu và ghi lý do.

### 3. E4: ghi chú Class 1 House bị cắt chữ
- Mở `/quote` ở 1919, 1440, 1280 và 390 px. Tìm thẻ Class 1 House / ghi chú enquiry.
- Đo bằng `scrollHeight > clientHeight` hoặc `scrollWidth > clientWidth` trên phần tử chữ, và tìm CSS
  `line-clamp`, `overflow:hidden` hoặc chiều cao cố định trong `guest.css`.
- Cho chữ xuống dòng đầy đủ.
- Nếu đo không thấy chữ bị cắt ở kích thước nào: ghi "không tái hiện được" kèm số đo. **Không đoán sửa.**

### 4. E9: mái và tường gần cùng màu trắng trong 3D
- Không đổi màu preset.
- Tăng tương phản bằng vật liệu và đường viền:
  - mái khác `roughness`/`envMapIntensity` so với tường, và/hoặc
  - một đường viền mép mái, máng và barge rõ hơn.
  - File: `packages/viewer3d` (`Shed3D.tsx`/`PartMesh.tsx` hoặc tương đương).
- Bạn không xem được ảnh, nên **đo bằng số**:
  - chụp `1919-3d-overview-roof` trước và sau bằng `scripts/qa-guest-shots.mjs`;
  - đọc pixel của một vùng mái và một vùng tường (ví dụ bằng `sharp` hoặc canvas trong Playwright);
  - báo độ chênh độ sáng (ΔL hoặc chênh trung bình RGB) trước/sau.
- Lưu ảnh vào `docs/qa/screens/2026-11-24-guest/{before,after}/` và cập nhật README.
- Rebuild viewer3d trước khi chụp (app dùng `dist`).

### 5. E5: gợi ý địa chỉ thiếu postcode / lạc
**Chỉ kiểm bằng code và stub.**
- Xem route Places ở `apps/api/src/routes/*` và `apps/api/src/lib/`: có giới hạn `country:au`,
  `types=address` không?
- Xem `AddressPanel` dựng nhãn `ComboOption` thế nào: có hiện `secondaryText` (suburb, state, postcode)
  khi API trả không?
- Sửa nếu thiếu. Thêm một stub trả `secondaryText` để chứng minh nhãn hiện ra.
- Ghi rõ: xác minh với Google thật cần người dùng cho phép chạy `scripts/probe-guest-places.mjs`.
  Không tự chạy.

### 6. Dọn nhỏ từ review vòng 1
- `mobileE164` đang có hai bản (`store.ts:159` và `SendPanel.tsx:34`). Gộp về một chỗ (ví dụ
  `apps/site/src/app/quote/mobile.ts`) cùng `formatAuMobile`; `store.ts`, `SendPanel`, `StartPanel` cùng
  import từ đó.
- `GuestQuote.tsx` hàm `send` (~dòng 113-120): khi `goTo` trả false thì `goTo` đã gọi `explainStart`, nên
  lần gọi `explainStart(type)` thứ hai bị thừa. Bỏ đi.
- `store.ts` `editAt` (~dòng 638): `if (!goTo(step, type)) pendingFocus = null;` xoá mất focus mà
  `explainStart` vừa đặt. Bỏ dòng reset đó để focus về đúng ô lỗi.
- E6: plan chọn giữ chỗ cho Hide roof / Reset view khi ở 2D (`visibility: hidden`) để toolbar không nhảy.
  Kiểm `Stage.tsx`; nếu chưa có thì làm.

### 7. Kiểm "Review focus" 1–5 của plan bằng tay hoặc script, có stub
1. Đang ở Building, sửa sai mobile/email: phải về ① kèm focus vào ô lỗi, design không mất.
2. Class 1 House (enquiry) đi thẳng ① → ③.
3. Places lỗi thật (`placesUnavailable`): không hiện link "Search by street address".
4. Skillion: một máng, xà đúng, có test hình học.
5. Carport `roof_only`: downpipe sát cột.

Ghi kết quả vào checkpoint.

### 8. Ảnh so sánh: trước và sau ghép chung một ảnh
Người dùng muốn so sánh trên **một ảnh duy nhất cho mỗi góc chụp**, không phải mở hai thư mục.
- Ghép mỗi cặp `before/<tên>.png` + `after/<tên>.png` thành một ảnh nằm ngang: trái là TRƯỚC, phải là SAU.
  - Mỗi nửa có nhãn chữ ở trên: "TRƯỚC" / "SAU", kèm mã bug (ví dụ "M4 — xà portal").
  - Có một vạch ngăn giữa hai nửa.
  - Ảnh 390px cũng ghép ngang như vậy.
  - Dùng `sharp` hoặc canvas trong Playwright; viết thành một script trong `scripts/`, ví dụ
    `scripts/qa-compare.mjs`.
- **Chỉ tạo ảnh cho góc chụp có thay đổi thật.**
  - Trước khi ghép, so pixel hai ảnh. Nếu khác nhau không đáng kể thì **bỏ qua**, không tạo ảnh ghép.
    Ngưỡng gợi ý: dưới 0,5% pixel đổi, với mỗi kênh lệch quá 8.
  - Ghi tên các cặp bị bỏ qua vào README.
- Chỉ áp dụng cho bug/tính năng có sửa liên quan tới hình:
  - vòng 1: M4 xà, M3 downpipe, khung cửa sổ;
  - vòng 2: E9 và E4 nếu có sửa.
- Với các bug UI có sửa nhưng chưa có ảnh trước, như E6 toolbar, E7 swatch, M6 hộp wind, M8 nút Send:
  - chụp "trước" từ code HEAD bằng `git stash` thì **không được** (git là opt-in và có nhiều thay đổi
    chưa commit), nên **bỏ qua**;
  - chỉ chụp "sau" khi thật cần, và ghi rõ là không có ảnh trước.
- Lưu vào `docs/qa/screens/2026-11-24-guest/compare/<mã-bug>-<tên>.png`.
- Thêm vào README một bảng: ảnh ghép, bug, % pixel thay đổi.
- Giữ nguyên các thư mục `before/` và `after/`. Không xoá.

## Không làm
- D3 (sheeting tam giác đầu hồi): chờ client confirm.

## Kiểm tra cuối
- `pnpm --filter @sq/core test`
- typecheck `@sq/core`, `@sq/viewer3d`, `@sq/site-app`
- `pnpm build`
- guest e2e pass

Cập nhật:
- `docs/state/guest-uiux-bugfix.md` (thêm mục "Vòng 2")
- mục "Trạng thái thực thi" của plan
- `docs/smartquote-quote-editor-reference.md` nếu đổi luật hiển thị

## Báo cáo cuối (tiếng Việt, ngắn)
- Mục nào đóng, mục nào để lại, kèm lý do.
- Kết quả e2e: số test pass/fail, spec nào đã sửa và vì sao.
- Các số GR mà e2e tạo ra.
- Số đo E9 trước/sau.
- Danh sách ảnh ghép trong `compare/`, và các cặp bị bỏ qua vì giống nhau.
- E4: tái hiện được hay không, kèm số đo.
- Danh sách file đã đổi.
