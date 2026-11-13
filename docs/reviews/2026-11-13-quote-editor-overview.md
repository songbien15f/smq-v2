# Overview: logic & workflow của quote editor (`/quotes/new`, `/quotes/[id]/edit`) — 2026-11-13

Phạm vi: luồng Step 1 → 2 → 3, validation, hai store, tính giá, lưu. Đọc code + kiểm trên browser
(quote thử `8f0c1f05…`, **không lưu gì**). Chưa sửa code.

Ký hiệu độ chắc: **[live]** = đã thấy trên browser; **[code]** = đọc code, chưa tái hiện (cần lưu thật).

## Cao — bug có thể làm mất dữ liệu

### 1. Lưu lần 2 trên cùng trang chỉ sửa khách/site → server trả bản cũ, sửa đổi mất im lặng [live] — **ĐÃ SỬA** (reference §13.44)
- `QuoteEditor.tsx:130` idempotency key chỉ được tạo mới trong `calculate()` (`:386`), **không** sau khi lưu thành công (`:548-573`).
- Trang `/quotes/[id]/edit` không có `key` theo revision (`app/quotes/[quoteId]/edit/page.tsx:67`), nên `router.refresh()` giữ nguyên component → giữ key cũ và `evaluation` cũ.
- Server kiểm idempotency **trước** mọi thứ (`apps/api/src/routes/evaluations.ts:439-454`): key trùng → trả revision cũ với `replayed: true`, status 200.
- Kịch bản: mở quote rev 3 → đổi span → Calculate → Save → rev 4. Sửa lỗi gõ email khách (không phải input giá → giá vẫn "current") → Save → cùng key → server trả rev 4 → client `markClean` + hiện "Saved · rev 4". Email mới **không được lưu**, cảnh báo rời trang cũng tắt.
- Kể cả có key mới thì evaluation đã bị tiêu (`consumed`) → 409 → re-price → phải bấm Save lần nữa.
- Sửa: sau khi lưu thành công thì tạo key mới, bỏ evaluation đang giữ và tính lại (hoặc gắn `key={revision}` cho editor).

### 2. `markClean` chụp store lúc response về, không chụp cái đã gửi [live] — **ĐÃ SỬA** (reference §13.44)
- `useDraftStore.ts:249-256` lấy fingerprint từ `get()` ở thời điểm response; `save()` gửi giá trị trong closure (`QuoteEditor.tsx:508-518`).
- Gõ thêm vào ô khách/site trong lúc request lưu đang chạy → chỗ gõ đó bị coi là đã lưu → mất khi rời trang, không có cảnh báo.
- Sửa: `markClean` nhận fingerprint của payload đã gửi.

## Trung bình — workflow không hợp lý

### 3. Hai cổng khác nhau để sang bước tiếp [live] — **ĐÃ SỬA** (phương án A, reference §13.45)
- Nút "Next: the plan" đòi **0 issue**, gồm cả tên/email/địa chỉ khách, địa chỉ site và tick xác nhận giao hàng (`:996`).
- Tab bước trên StepRail chỉ đòi có giá (`:701`). Đã kiểm: quote thử còn 1 issue, bấm tab "2 Options" vẫn sang được.
- Ở Options, bấm "Next: cost" khi còn issue Step 1 → bị đá về Quote details (`revealIssues`, `:288`).
- Đề xuất: chọn một luật. Gợi ý: Next chỉ chặn bởi issue của building (`shed-*`, `design-*`), vì salesperson thường vẽ shed trước khi có thông tin khách; issue khách/site chỉ chặn Save.

### 4. Đổi building phải bấm "Calculate" bằng tay [live] — **ĐÃ SỬA** (phương án A, reference §13.45)
- Đã kiểm: span 12000 → 11000 commit xong, **không** có request `evaluate`; Save bị khoá vì giá cũ.
- Mỗi lần đặt option ở Step 2 cũng vậy. Chỉ thay đổi tiền mới tự tính lại (debounce 600 ms, `:448-471`).
- Ô số giờ commit khi rời ô, không còn bắn theo từng phím, nên có thể tự tính lại building (debounce) khi không còn issue `shed-*`.

### 5. Cửa sổ / cửa đi không được kiểm lại sau khi đổi kích thước [live] — **ĐÃ SỬA** (reference §13.46)
- `shouldWipeOptions` chỉ đọc `options` (`packages/core/src/domain/placementRules.ts:390`).
- `normaliseShedConfig` không kẹp lại openings, và `validateDraft` không có rule nào cho opening.
- Kịch bản: đặt cửa cuốn rộng 4 m, rồi giảm span hoặc chiều cao → cửa vượt tường, không ai báo; báo giá vẫn lưu được.
- Sửa: validator thêm rule "opening vượt tường" (dùng lại hình học của `placeOpening`), hoặc hỏi confirm như options.

### 6. Mở quote đã lưu bắn 2 request `evaluate` cùng lúc [live] — **ĐÃ SỬA** (reference §13.44)
- Đo được 2 request cách nhau 1 ms.
- Nguyên nhân: `autoPriced` (`:400-405`) và `pricedFirstBuilding` (`:418-424`) cùng chạy trong một commit khi draft sẵn sàng và building đã đủ kích thước.
- Mỗi request tạo một dòng evaluation trên server. Gộp lại thành một effect.

### 7. Hệ quả của "kích thước ngoài book chặn lưu" lên quote cũ [live] — **ĐÃ ĐẾM + ĐÃ SỬA** (phương án C, reference §13.47)
- Quote cũ có bay ngoài book (quote thử 4 × 6000 mm) không lưu được, kể cả khi chỉ sửa email khách, cho tới khi sửa bay. Đây là quyết định đã chốt (Block saving); chỉ ghi lại tác động.
- Nên đếm trong DB xem có bao nhiêu quote đang ở trạng thái này trước khi phát hành.

## Thấp / polish
- Server từ chối vì freight tối thiểu khi lưu từ Step 1/2: summary hiện `cost-delivery: …` dạng chữ thường, vì ô nằm ở Step 3 nên không thành link (`ErrorSummary.tsx:133`). Có thể cho link chuyển sang Cost.
- Dòng dưới nút Save chỉ hiện lý do đầu tiên (`gate.reasons[0]`): sửa xong issue mới biết giá cũng đã cũ.
- Khoảng pitch là hợp của các band trong book: 17° được nhận dù không nằm trong band của dòng nào (reviewer Part 4 không kết luận).
- 8 minor hoãn từ Part 4 (`docs/state/step1-input-behaviour.md:38-45`):
  - lời từ chối nói "this book sells" cả với giới hạn fallback;
  - Bays dùng literal 1/30;
  - `parseNumber` nhận `1,000` → 1;
  - undo trong lúc đang focus bị ghi đè khi blur;
  - ARIA của combobox;
  - nút "Hide bays" không làm gì khi panel bị giữ mở;
  - DimensionField giữ text `9000.4`;
  - câu từ chối nằm trong `<label>`.
- Sau khi lưu, dòng dưới nút Save của quote đã lưu ghi "Nothing has been changed yet. Fill in the details, and this button saves the **first** revision." — sai cho quote đã có revision (thấy khi tái hiện mục 1).
- e2e sẽ đỏ ở 9 chỗ trong `stepOne.spec.ts` (đã liệt kê ở reference §13.43).
- `QuoteEditor.tsx` dài 1063 dòng; logic giá + lưu + baseline nằm lẫn với JSX. Tách ra hook `useQuotePricing` / `useQuoteSave` sẽ dễ test các mục 1, 2, 6.

## Thứ tự sửa đề xuất
1. Mục 1 + 2 (cùng đường lưu, rủi ro mất dữ liệu) → 6 (gộp effect).
2. Mục 3 và 4 cần bạn chọn luật trước.
3. Mục 5 (rule cho opening).

## Kết quả sửa 1, 2, 6 (2026-11-13)
Tái hiện trước khi sửa (stub `POST /api/sq/quotes`, không ghi DB):
- Mục 1: 2 lần lưu → cùng key `ui-ab1a…`, cùng evaluationId.
- Mục 2: gửi `a@example.com`, gõ email khác trong lúc chờ → "Nothing has been changed yet".
- Mục 6: request `evaluate` lúc 1072 ms và 1075 ms.

Sau khi sửa, chạy lại đúng các bước đó:
- Mục 1: 2 key khác nhau, 2 evaluationId khác nhau (tự tính lại giá sau lần lưu 1).
- Mục 2: Save vẫn bật, dòng dưới nút báo còn thay đổi chưa lưu.
- Mục 6: chỉ 1 request.

Client typecheck sạch, vitest 66/66 pass.

## Kết quả sửa 3, 4 (2026-11-13)
Tái hiện trước khi sửa: span 12000 → 11000 không gửi `evaluate`; còn 1 issue (bay 6000 mm) mà tab
"2 Options" vẫn mở.

Sau khi sửa (chi tiết trong reference §13.45):
- Còn issue building: tab khoá, không tự tính. Sửa bay thì tự tính đúng 1 request sau 600 ms. Đổi span
  thêm 1 request.
- Chỉ thiếu email khách: Next đi được Details → Options → Cost. Save vẫn chặn và đưa về Quote details.
- Sửa thêm [code, chưa tái hiện riêng]: đổi building trong 600 ms sau khi sửa tiền có thể làm Save bị giữ
  mãi (cleanup không tắt `refreshing`). Nay `refreshing` là bộ đếm.

Client typecheck sạch, vitest 66/66 pass.

## Kết quả sửa 5 (2026-11-13)
Tái hiện trước khi sửa: thêm cửa cuốn 4000 × 3600 cách mép trái 7000 mm, rồi đổi span 12000 → 10000 và
height 4200 → 3000. Không có issue nào, và Save gửi request lưu (đã stub).

Ghi chú: `normaliseShedConfig` chỉ làm tròn số đo của opening, không kẹp lại vị trí. `plan.ts` có tính
`warnings` cho cửa sai chỗ, nhưng client không hiển thị chúng.

Sau khi sửa (chi tiết trong reference §13.46):
- Cùng các bước đó cho ra 1 issue "… no longer fits: opening extends 1000 mm past the right edge …".
  Không có request lưu nào được gửi, và tab Options vẫn mở.
- Trả span về 12000: chỉ còn lỗi chiều cao. Trả height về 4200: hết lỗi.
- Trường hợp chồng cửa đã kiểm bằng script gọi core, chưa kiểm trên UI.

Core vitest 1072 pass; client typecheck sạch, vitest 66/66 pass.

## Kết quả mục 7 (2026-11-13)
Script chỉ đọc: `apps/api/scripts/count-blocked-quotes.ts`.
- Chạy `pnpm quotes:blocked`. Thêm `-- --tenant <slug>` để lọc theo công ty, `-- --list` để kèm tên từng quote.
- Nó đọc revision hiện tại của mỗi quote và chạy đúng `validateDraft` + `bookBounds` của editor với book đang active, nên con số khớp với màn hình.
- Không ghi gì vào DB.

Kết quả trên DB local (Postgres, book `fe5a7cae55a5…`):
- 87 quote, tất cả có building.
- **46 bị chặn bởi building**, cả 46 đều do `shed-nomBaySpacing`: 4 bay × 6000 mm, dài 24000, span 12000. Band bay của book là 1000–4000 mm.
- 0 bị chặn bởi cửa/option, 0 chỉ bị chặn bởi trường khách/site.
- 41 lưu lại được: 4 × 3750, span 6000.

Đọc kết quả:
- DB local là dữ liệu demo/test. 46 quote cùng một building, giống hệt quote thử `8f0c1f05…`, nên gần như chắc là do seed/e2e tạo ra, không phải dữ liệu khách.
- Con số này **không** nói gì về production. Phải chạy cùng lệnh trên DB production (đặt `DATABASE_URL` trỏ tới đó; script chỉ đọc) trước khi phát hành.
- Nếu production có nhiều quote bị chặn, các hướng xử lý (chưa làm, cần chọn):
  - (a) giữ nguyên luật và báo cho salesperson;
  - (b) chỉ chặn khi building bị sửa, cho lưu khi building giữ nguyên như revision trước;
  - (c) sửa dữ liệu hàng loạt.

## Sửa mục 7: phương án C (2026-11-13)
Đã chọn C, nút "Split into N bays of X mm"; chi tiết ở reference §13.47. Spec ở
`docs/superpowers/specs/2026-11-13-split-bays-design.md`, plan ở `docs/superpowers/plans/2026-11-13-split-bays.md`.
- Không chọn B (cho lưu building ngoài book nếu không đổi), vì như thế sẽ tính lại giá trên một building mà book không có cấu kiện.
- Không chọn D (sửa dữ liệu hàng loạt), vì revision là bất biến.
- Quote thử: 4 × 6000 → 6 × 4000 sau một cú bấm, chỉ 1 request `evaluate`, Save được mở, không có request lưu nào.
- Còn lại: với chiều dài không chia hết cho N, sau khi bấm vẫn còn lỗi "Bays don't divide equally", vì v2 cố ý đòi các bay bằng nhau. 46 quote local đều dài 24000 nên không gặp trường hợp này. Production cần xem qua `pnpm quotes:blocked -- --list`.

Client typecheck sạch, vitest 66/66 pass; core typecheck sạch.
