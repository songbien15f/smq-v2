# Bản đầy đủ — nhận yêu cầu do vendor chuyển tới, quản lý vai trò

Trạng thái: **quyết định đã chốt** (2026-11-17), spec chờ duyệt. Thuộc [quote-tiers.md](quote-tiers.md).

Bản đầy đủ là editor hiện tại trong `apps/client`, dành cho `company_admin` và `estimator`. Spec này chỉ ghi những gì phải **thêm** để hai cấp kia hoạt động. Không viết lại editor, không đổi engine.

Khác với nháp trước: công ty **không** tự bật cổng Guest, và không có link `/q/<CODE>`. Mọi yêu cầu của Guest đi qua cổng chung tới super admin, rồi được **chuyển** cho công ty ([quote-tiers-guest.md](quote-tiers-guest.md)).

## Câu chuyện người dùng

- Là **estimator**:
  - tôi thấy mục "Yêu cầu" với số yêu cầu mới do platform chuyển tới;
  - tôi mở một yêu cầu, đọc khách muốn gì và ghi chú của platform, nhận xử lý, rồi bấm "Tạo quote từ yêu cầu";
  - editor mở ra với khách hàng, địa điểm, kích thước và cửa đã điền sẵn;
  - tôi hoàn thiện (vùng gió, vị trí cửa, phụ kiện), lưu và gửi; yêu cầu tự chuyển sang "Đã báo giá".
- Là **estimator**, tôi từ chối một yêu cầu không phù hợp và ghi lý do.
- Là **company admin**, tôi quản lý vai trò (spec [quote-tiers-dealer.md](quote-tiers-dealer.md)), mời dealer, và lọc danh sách quote theo người tạo.
- Là **super admin**, tôi chuyển lead cho một công ty, kể cả tenant của chính vendor. Màn hình này nằm trong spec Guest.

## Dữ kiện (đã kiểm tra 2026-11-17)

| Điều | Ở đâu |
|---|---|
| Editor mới nhận cấu hình ban đầu qua fragment `#template=<json>`, nếu không có thì dùng `STARTING_BUILDING` | [fragment.ts:43](../../apps/client/src/components/editor/fragment.ts:43), [QuoteEditor.tsx:211-232](../../apps/client/src/components/editor/QuoteEditor.tsx:211) |
| Editor cũng nhận khách hàng từ fragment khi mở từ `.sqd`; field được chép tường minh, không spread | [fragment.ts:53](../../apps/client/src/components/editor/fragment.ts:53) |
| Trang quote mới đá người không có `quote:write` về danh sách | [quotes/new/page.tsx:17](../../apps/client/src/app/quotes/new/page.tsx:17) |
| Lưu quote dùng `saveQuoteRequest` (customer, site, config, pricing, evaluationId) | [quote.ts:95](../../packages/contracts/src/quote.ts:95) |
| Menu workspace và khung trang | [WorkspaceMenu.tsx](../../apps/client/src/components/WorkspaceMenu.tsx), [ShellFrame.tsx](../../apps/client/src/components/ShellFrame.tsx) |
| Trang client hiện có: `dashboard`, `quotes`, `team`, `settings`, `activity`, … | `apps/client/src/app/` |

## Thay đổi

### 1. Bảng `quote_requests` (cùng migration với các bảng Guest)

```sql
CREATE TABLE quote_requests (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  guest_request_id TEXT NOT NULL UNIQUE REFERENCES guest_requests(id),
  number           TEXT NOT NULL,          -- số của lead, để hai bên nói cùng một số
  contact_json     TEXT NOT NULL,          -- chép từ lead lúc chuyển
  design_json      TEXT NOT NULL,
  notes            TEXT,                   -- ghi chú của khách
  platform_note    TEXT,                   -- ghi chú của super admin lúc chuyển
  status           TEXT NOT NULL,          -- new | in_progress | quoted | declined
  assigned_to      TEXT,
  quote_id         TEXT REFERENCES quotes(id),
  decline_reason   TEXT,
  assistant_transcript_json TEXT,          -- hội thoại của khách với trợ lý AI, chép lúc chuyển (chỉ chữ, đã che)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

- Dữ liệu được **chép** vào tenant lúc chuyển, không JOIN ngược sang bảng của platform. Nhờ vậy công ty chỉ đọc bảng có `tenant_id` của mình.
- `UNIQUE(guest_request_id)` bảo đảm một lead chỉ vào một công ty.

### 2. Hộp thư yêu cầu (`request:manage`)

API — mọi route lọc theo `tenant_id` của phiên:

| Route | Việc làm |
|---|---|
| `GET /requests?status=&q=` | Danh sách: số, tên khách, suburb/bang, kích thước tóm tắt, trạng thái, ngày, người xử lý |
| `GET /requests/:id` | Chi tiết: thiết kế, liên hệ, ghi chú của khách và của platform, quote đã nối nếu có |
| `POST /requests/:id/assign` | Gán cho mình hoặc người khác; `new` chuyển sang `in_progress` |
| `POST /requests/:id/decline` | Từ chối, có lý do |
| `GET /requests/:id/draft` | Bản nháp cho editor: `{ customer, site, config }` dựng bằng `configFromGuestDesign` của `@sq/core` |
| `GET /requests/summary` | Số yêu cầu `new`, để hiện huy hiệu trên menu |

Client:
- Mục menu **"Yêu cầu"** có huy hiệu số mới. Chỉ hiện khi có `request:manage`.
- `/requests`: bảng lọc theo trạng thái. Admin đã có `DataTable`; nó có nằm trong `@sq/ui` không hay chỉ ở `apps/admin` thì *chưa kiểm tra*. Nếu chỉ ở admin, chuyển nó vào `@sq/ui`.
- `/requests/[id]`: hai cột. Bên trái là những gì khách gửi, giữ nguyên lời khách, cộng ghi chú của platform, và hội thoại của khách với trợ lý AI nếu có (thu gọn mặc định). Bên phải là các nút: Nhận xử lý · Tạo quote · Từ chối. Khi đã có quote thì hiện link tới quote.

### 3. Tạo quote từ yêu cầu

- Nút "Tạo quote" mở `/quotes/new#request=<id>`. Editor thấy `request` trong fragment thì gọi `GET /requests/:id/draft` và nạp kết quả đúng như đường `#template` hiện có. Không nhét JSON vào URL.
- Lưu lần đầu: `saveQuoteRequest` có thêm field tùy chọn `fromRequestId`. Trong cùng transaction tạo quote, server:
  - kiểm tra request thuộc cùng công ty, chưa có `quote_id`, và trạng thái là `new` hoặc `in_progress`;
  - ghi `quote_requests.quote_id`;
  - tạo hoặc dùng lại một dòng `customers` từ liên hệ của khách (khớp theo email trong công ty).

  Request đã có quote thì trả **409**, để hai người bấm cùng lúc không tạo hai quote.
- Khi quote đó được **gửi** (`send.ts`), request chuyển sang `quoted`, và khách nhận mail có link báo giá (spec Guest, mục "Khi có báo giá").
- **`configFromGuestDesign(design, base)`** trong `@sq/core` là nơi duy nhất ánh xạ Guest → đầy đủ:
  - hàm thuần, có test đơn vị;
  - đầu ra luôn qua được `shedConfigSchema`;
  - `base` là preset khách chọn;
  - giữ đúng vị trí cửa khách đặt trên 2D; chạy lại `placeOpening` với vị trí cột infill từ bảng giá, và dời cửa nào phạm luật R3 tới chỗ hợp lệ gần nhất, kèm một ghi chú cho estimator.

  Vùng gió **không** suy ra: estimator chọn hoặc gọi ShedSafe như với mọi quote.

### 4. Vai trò và Dealer trong bản đầy đủ

- Trang Team có tab "Vai trò" (spec [quote-tiers-dealer.md](quote-tiers-dealer.md), lát C). Dropdown vai trò khi mời gồm các mẫu và vai trò tùy biến.
- Danh sách quote: thêm cột **"Người tạo"** và bộ lọc theo người. Chỉ hiện khi phiên có `quote:all`.
- Dashboard: số quote theo người tạo — *tùy chọn*, chỉ làm nếu rẻ.

## Tiêu chí chấp nhận

1. Estimator thấy yêu cầu vừa được chuyển trong hộp thư. Huy hiệu đếm đúng.
2. Người không có `request:manage` không thấy mục "Yêu cầu", và mọi route `/requests*` trả 403 cho họ.
3. "Tạo quote" mở editor với khách hàng, địa điểm, kích thước và cửa đã điền. Cấu hình qua được `/evaluate` mà không lỗi schema.
4. Lưu quote nối request; lưu lần hai với cùng `fromRequestId` trả 409. Request của công ty khác trả 404.
5. Gửi quote đã nối thì request chuyển sang `quoted`, và khách mở được báo giá.
6. Từ chối ghi lại lý do, và khách thấy "Không thể báo giá".
7. Admin và estimator lọc được quote theo người tạo; người không có `quote:all` không thấy bộ lọc này.
8. Test đơn vị cho `configFromGuestDesign`: mỗi preset, kích thước ở biên, cửa giữ đúng vị trí, cửa đè cột infill bị dời và có ghi chú.
9. `quote_requests` có trong [isolation.test.ts](../../apps/api/src/__tests__/isolation.test.ts).
10. `pnpm typecheck`, `pnpm test` xanh.

## Câu hỏi mở (có mặc định)

- **Công ty từ chối thì lead quay về đâu?** Mặc định: lead ở platform trở lại `new`, có nhãn "bị công ty X từ chối", để super admin chuyển cho công ty khác. Khách chỉ được báo "Không thể báo giá" khi super admin từ chối hẳn.
- **Từ chối có gửi mail cho khách không?** Mặc định: chỉ khi super admin từ chối hẳn, với câu mẫu do vendor sửa được.
- **Một yêu cầu có thể ra nhiều quote không** (phương án A/B)? Mặc định: một quote, nhiều revision — editor đã có revision có tên.
- **Dealer có được nhận yêu cầu không?** Mặc định: không, vì mẫu Dealer không có `request:manage`. Admin có thể tạo một vai trò tùy biến có quyền đó.
