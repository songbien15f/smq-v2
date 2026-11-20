# Plan — Admin định nghĩa loại công trình cho trang Guest (`guest_building_types`)

> **Bối cảnh:** trang Guest (`apps/site`, `/quote`) đọc loại công trình từ API. Bảng `guest_building_types` đang trống, nên API trả 6 loại cài sẵn trong code (`GUEST_DEFAULT_TYPES`). Admin (`apps/admin`, vendor control plane) chưa có màn hình nào để sửa các loại này.
> **Mục tiêu:** vendor tạo, sửa, bật/tắt và sắp xếp loại công trình trong admin. Trang Guest nhận thay đổi mà không cần deploy.
> **Cỡ:** *standard*, **một coder**, làm tuần tự. Mỗi bước build và chạy được một mình. Git tắt. Tests: **`tests=on` cho riêng S2** (một file test API, Q6); các bước khác coder tự kiểm tra.
> **Viết:** 2026-11-19. Q1–Q8 đã chốt cùng ngày. Chưa code.

## 0. Đọc trước khi làm (bắt buộc cho agent thực thi)

1. **Đọc:** `CLAUDE.md` ở gốc repo (hai bẫy: dùng `localhost`; app dùng `dist` của package, nên sửa `@sq/contracts` / `@sq/core` xong phải build lại), rồi mục 1–2 của file này.
2. **Git:** không commit, không push, không tạo branch hay worktree.
3. **Migration:** không sửa migration đã có (001–020 có checksum). Plan này **không cần migration mới**. Nếu thấy cần thì tạo file `021_*` và ghi lý do vào checkpoint.
4. **Bí mật:** không in `.env`, `GOOGLE_PLACES_API_KEY`, `SHEDSAFE_*`, `VILAO_API_KEY`.
5. **Server:** chạy bằng preview tool (`.claude/launch.json`: `api`, `admin`, `site`) hoặc `pnpm dev`. Admin ở http://localhost:3062, Guest ở http://localhost:3063/quote.
6. **Kỷ luật khẳng định:** chỗ nào chưa soi thì ghi "chưa kiểm tra" (`docs/CLAIM-DISCIPLINE.md`).
7. **Giới hạn chiều rộng:** người dùng đã chốt giữ trần 15 m cho 6 loại mặc định. Plan này **không đổi số mặc định**. Nó chỉ cho admin quyền tự đặt giới hạn cho từng loại (Q2).

## 1. Hiện trạng (đã soi 2026-11-19)

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| Bảng | `packages/db/migrations/020_guest_requests.sql:58-72` | Cột: `id`, `name`, `description`, `base_preset`, `config_json`, `enabled`, `sort_order`, `version`, `updated_by`, `created_at`, `updated_at`. **Không có `tenant_id`**, vì đây là cấu hình cấp nền tảng. Có index `(enabled, sort_order)`. |
| Đọc phía API | `apps/api/src/routes/guest.ts:158-190` (`loadBuildingTypes`) | Bảng **trống** → trả `GUEST_DEFAULT_TYPES`. Có hàng → chỉ lấy `enabled = 1`, `ORDER BY sort_order, name`. Mỗi hàng parse bằng `guestBuildingTypeSchema`; hàng hỏng bị bỏ qua và ghi log. **Hệ quả:** có ít nhất 1 hàng thì 6 loại mặc định biến mất khỏi trang. |
| Endpoint công khai | `guest.ts:263` `GET /public/guest/building-types` | Ngoài ra còn hai chỗ đọc qua `loadBuildingTypes`: route gửi yêu cầu (`guest.ts:296-304`, tìm `design.typeId` rồi gọi `validateGuestDesign`) và route trợ lý AI (`guest.ts:460`). |
| Schema | `packages/contracts/src/guest.ts:159-243` | `guestBuildingTypeConfigSchema` (strict): `basePreset`, `icon`, `mode`, `enclosure`, `roofs`, `start`, `limits` (span/height/bayWidth theo mm, bays 1–30, `pitchesByRoof`), `openings` (`rules` ≤ 4, `defaults` ≤ 10, `lockedReason`), `colours` (`defaults`, `allowed` 1–40). `guestBuildingTypeSchema` bọc thêm `id` (1–64), `name` (1–40), `description` (≤ 120), `version` (0 = mặc định trong code, chưa từng lưu), `sortOrder`. |
| Mặc định | `packages/core/src/domain/guest.ts:336-502` | 6 loại: `garage`, `industrial`, `riding_arena`, `aircraft_hangar`, `carport` (`roof_only`, `footing_only`), `house` (`mode: 'enquiry'`). Giới hạn lấy từ `BOOK_SPAN_MM` / `BOOK_HEIGHT_MM` / `BOOK_BAY_MM` (`guest.ts:221-223`), tức là sổ giá. |
| Cờ duyệt | `guest.ts:772-789` `guestReviewFlags` | So thiết kế với **hằng số sổ giá**, không so với limits của loại. Admin cho phép rộng hơn 15 m thì đơn vẫn gửi được nhưng bị gắn cờ `span` ("Needs estimator check"). |
| Phân quyền | `packages/contracts/src/roles.ts:49-55, 87-96`; `apps/api/src/lib/guard.ts:65` | Có các quyền `platform:*`. `platform_admin` có đủ; `platform_support` chỉ có companies, enquiries, audit. |
| Mẫu CRUD gần nhất | `apps/api/src/routes/platform.ts:160-299` (templates) | Pattern: `requirePlatformCapability` → `parseBody(schema)` → SQL; lỗi `UNIQUE` thì trả `conflict`. **Không xoá**, chỉ `PATCH` trạng thái ("a clone that used it still points at it"). |
| Audit | `apps/api/src/routes/admin.ts:33-49` | Hàm `audit(tx, {...})` ghi `audit_events` **trong cùng transaction**. Hàm này đang private trong file. |
| Nav admin | `apps/admin/src/components/ShellFrame.tsx:47-69` (`ADMIN_NAV`) | Nhóm "Catalogue" gồm Price books, Company prices, Templates. Mỗi mục có `capability` và `icon` (`NavIcons.tsx`). |
| Bảng UI | `@sq/ui` `DataTable` (`packages/ui/src/table.tsx:39`) | Ví dụ dùng: `apps/admin/src/components/CompanyTable.tsx:18`. |
| Bản nháp Guest | `apps/site/src/app/quote/store.ts:225-255`; `packages/core/src/domain/guest.ts:634` `upgradeGuestDesign` | localStorage giữ `typeId` + `typeVersion`. Khi đọc lại, **không có gì so `typeVersion`** với bản hiện hành. Thiết kế chỉ được kiểm lại bằng `validateGuestDesign` trên `DesignPanel` và ở bước gửi. |
| Bản nháp trỏ tới loại đã tắt | `StartPanel.tsx:57` | `type` thành `undefined`. Trang có bắt khách chọn lại loại hay không: **chưa kiểm tra**, xem S6. |
| Yêu cầu đã gửi | `020_guest_requests.sql:38` `design_json` | Lưu cả `typeId` và `typeVersion` trong JSON. Vì vậy **không được xoá cứng một loại** đã có yêu cầu trỏ tới. |

## 2. Quyết định — **đã chốt 2026-11-19**

Người dùng chọn đúng đề xuất cho cả Q1–Q8. Cột "Đề xuất" dưới đây là quyết định cuối; không hỏi lại.

| # | Câu hỏi | Đề xuất | Lý do |
|---|---|---|---|
| Q1 | Quyền nào được sửa loại công trình? | **Dùng lại `platform:templates`.** | Cùng đối tượng (catalogue) và cùng vai trò (`platform_admin`). Thêm quyền mới phải sửa `roles.ts` cùng hai policy mà chưa có ai cần tách. Khi cần tách thì đổi một hằng số. |
| Q2 | Admin có được đặt giới hạn vượt sổ giá (ví dụ rộng hơn 15 m)? | **Cho phép, nhưng form cảnh báo vàng.** Câu cảnh báo: "Vượt sổ giá (1.8–15 m). Đơn sẽ bị gắn cờ cần estimator kiểm tra." | Đây chính là cách trả lời câu hỏi "Guest muốn freestyle": vendor tự quyết từng loại. Schema đã cho phép; `guestReviewFlags` đã bắt. Không chặn cứng, vì sổ giá có thể đổi. |
| Q3 | Xoá hay chỉ tắt? | **Chỉ tắt (`enabled = 0`). Không có nút xoá.** | Yêu cầu đã gửi trỏ tới `typeId`; template cũng làm vậy (`platform.ts:276`). |
| Q4 | Lần lưu đầu tiên làm gì với 6 loại mặc định? | **Lần ghi đầu tiên tự chép cả 6 loại vào bảng** (cùng transaction), rồi mới áp thay đổi. | Không làm vậy thì sửa 1 loại sẽ làm 5 loại kia biến mất khỏi trang Guest (`guest.ts:160`), một lỗi im lặng. |
| Q5 | `id` có sửa được không? | **Không. `id` cố định sau khi tạo.** Định dạng: slug `^[a-z][a-z0-9_]{1,63}$`. | `id` nằm trong bản nháp của khách, trong `design_json`, và trong deep link `?type=<id>`. |
| Q6 | Có viết test không? | **Có, một file API test** cho CRUD, phân quyền, seed lần đầu và xung đột version. Không viết e2e admin. | Mục này đổi dữ liệu mà mọi khách thấy. Người dùng đã đồng ý: `tests=on` cho riêng S2. |
| Q7 | Hai người sửa cùng lúc? | **Khoá lạc quan bằng `version`.** `PUT` gửi kèm `expectedVersion`; lệch thì trả 409 "Loại này vừa được sửa, tải lại". | Đã có sẵn cột `version` (bump mỗi lần lưu), nên không tốn thêm gì. |
| Q8 | Xem trước? | **Bản đầu: nút "Mở trên trang Guest"** (`<site origin>/quote?type=<id>`). Không hard-code cổng: API đã có `serviceOrigins` (`apps/api/src/config.ts:186`, đọc `SITE_ORIGIN` / `SITE_PORT`), nên `GET /admin/guest-types` trả kèm `siteOrigin`. cùng một bảng tóm tắt bằng chữ. **Không nhúng 3D** vào admin. | `@sq/viewer3d` + three/R3F làm admin nặng thêm nhiều. Chỉ làm khi thực sự cần. Lưu ý: deep link chỉ áp dụng khi khách **chưa có bản nháp** (`store.ts` comment ở 266-272). |

## 3. Thiết kế

### 3.1 Kiểm tra chéo (core, dùng chung cho API và form)

Schema zod chỉ kiểm từng trường. Cần thêm một hàm thuần trong `@sq/core` (A9: core không đụng DB), ví dụ `checkGuestBuildingType(spec): string[]`, đặt cạnh `validateGuestDesign` trong `packages/core/src/domain/guest.ts`. Hàm này kiểm:

- `start.roof` có trong `roofs`; `start.pitchDeg` có trong `limits.pitchesByRoof[start.roof]`.
- `start.span`, `start.height` và từng `start.bayWidths[i]` nằm trong limits; số bay nằm trong `limits.bays`.
- Mỗi `openings.defaults[i]` có `rules` cho loại đó; số lượng mỗi loại ≤ `rule.max`; vị trí vừa tường của `start`. Nếu làm được thì tái dùng hàm đặt cửa đang có; nếu không thì ghi "chưa kiểm tra" và chỉ kiểm loại + số lượng.
- `rules` rỗng mà `defaults` không rỗng → lỗi.
- `colours.defaults.*` nằm trong `colours.allowed`.
- `mode: 'enquiry'` → bỏ qua các kiểm tra hình học (loại `house` vẫn phải thoả schema).

**Cảnh báo, không chặn** (`bookWarnings(spec): string[]`): limits vượt `BOOK_SPAN_MM` / `BOOK_HEIGHT_MM` / `BOOK_BAY_MM`, hoặc có pitch skillion dưới `BOOK_MIN_SKILLION_PITCH_DEG`. Đây là các cờ `guestReviewFlags` sẽ bắn (Q2).

**Tự kiểm:** gọi hàm với cả 6 `GUEST_DEFAULT_TYPES`; tất cả phải ra `[]`. Nếu một loại mặc định không qua thì đó là lỗi của hàm hoặc của dữ liệu mặc định: báo lại, **không** sửa số mặc định khi chưa hỏi.

### 3.2 Contracts (`packages/contracts/src/guest.ts`)

- `guestBuildingTypeWriteSchema`: `{ name, description, sortOrder, enabled, config }`, cộng `id` khi tạo và `expectedVersion` khi sửa.
- `GuestBuildingTypeAdminRow`: `GuestBuildingType` + `enabled`, `updatedAt`, `updatedBy` (email), `source: 'database' | 'default'` (cho trạng thái "đang dùng mặc định trong code").

### 3.3 API — file mới `apps/api/src/routes/guestTypesAdmin.ts`, đăng ký trong `app.ts`

Mọi route đều gọi `requirePlatformCapability(request, reply, 'platform:templates')` (Q1).

| Method + path | Việc |
|---|---|
| `GET /admin/guest-types` | Bảng trống: trả 6 mặc định với `source: 'default'`, `enabled: true`. Có hàng: trả **mọi** hàng (cả hàng tắt), `ORDER BY sort_order, name`. Hàng không parse được vẫn trả, kèm `invalid: true` và lý do, để admin thấy và sửa (trang Guest đang bỏ qua nó). |
| `GET /admin/guest-types/:id` | Một loại. 404 nếu không có. |
| `POST /admin/guest-types` | Tạo. Kiểm schema + `checkGuestBuildingType`; trùng `id` → 409. |
| `PUT /admin/guest-types/:id` | Sửa toàn bộ. So `expectedVersion` (Q7); `version = version + 1`; ghi `updated_by`, `updated_at`. |
| `PATCH /admin/guest-types/:id` | `{ enabled }` hoặc `{ sortOrder }`, để bật/tắt và sắp xếp nhanh. Cũng bump `version`. |
| `POST /admin/guest-types/reorder` | `{ ids: string[] }` → đặt `sort_order` = 10, 20, 30… trong một transaction. Không bắt buộc: có thể chỉ dùng `PATCH`. |

**Quy tắc chung:**

- Mọi route ghi đều chạy trong **một transaction**: (1) nếu bảng trống thì chép 6 mặc định (`version = 1`, `updated_by = null`) — Q4; (2) áp thay đổi; (3) ghi `audit_events`.
- `action` audit: `guest_type.create` / `guest_type.update` / `guest_type.enable` / `guest_type.disable` / `guest_type.reorder`. Riêng lần seed ghi `guest_type.seed_defaults`.
- **Không được để mọi loại bị tắt mà không hỏi.** Khi tất cả bị tắt, trang Guest nhận danh sách rỗng (`guest.ts:162-167`). Đề xuất: API cho phép, nhưng admin UI hỏi xác nhận "Trang Guest sẽ không còn loại nào".
- **Hàm `audit`:** chuyển nó từ `admin.ts:33` sang `apps/api/src/lib/audit.ts` và export (refactor nhỏ, không đổi hành vi). Cách khác: chép riêng một bản. Ưu tiên chuyển sang `lib`.
- **`base_preset`:** cột riêng, lưu đồng thời từ `config.basePreset`.
- **Seed lần đầu:** dùng chính `GUEST_DEFAULT_TYPES` từ `@sq/core`. Không chép số tay.
- **Không đổi `loadBuildingTypes`.** Hành vi đọc phía Guest giữ nguyên.

### 3.4 Admin UI

- **Nav:** thêm vào nhóm "Catalogue" trong `ShellFrame.tsx:58-65`:
  `{ href: '/guest-types', label: 'Guest building types', capability: 'platform:templates', icon: 'guestTypes' }`
  Thêm icon tương ứng trong `NavIcons.tsx`.
- **`apps/admin/src/app/guest-types/page.tsx`** (server component, `serverFetch` như `templates/page.tsx`): một `DataTable` với các cột Thứ tự, Tên, `id`, Kiểu (Design / Enquiry), Khung (Enclosed / Roof only), Rộng min–max, Bật, Version, Sửa lúc.
  - Đang dùng mặc định → banner: "Đang dùng 6 loại cài sẵn trong code. Lưu bất kỳ thay đổi nào sẽ chép cả 6 vào cơ sở dữ liệu."
  - Hàng `invalid` → nhãn đỏ "Không hiển thị trên trang Guest".
  - Nút: "Thêm loại", lên/xuống (sắp xếp), bật/tắt.
- **`apps/admin/src/app/guest-types/[id]/page.tsx`** + component `GuestTypeEditor.tsx` (client). Form chia các mục:
  1. **Chung:** Tên, Mô tả (≤ 120, có đếm ký tự), `id` (chỉ khi tạo), Biểu tượng (`guestIconSchema`), Kiểu, Khung, `basePreset` (`PRESET_IDS`).
  2. **Mái:** chọn gable / skillion và cái nào mặc định. Danh sách pitch cho từng mái dạng chip thêm/bớt; chip đầu là mặc định.
  3. **Giới hạn:** span, height, bayWidth (nhập theo **m, 2 chữ số thập phân**, lưu theo mm); bays min–max. Cảnh báo vàng khi vượt sổ giá (Q2).
  4. **Kích thước khởi đầu:** span, height, pitch, roof, danh sách bay, slab, kneeBrace, cladding.
  5. **Cửa:** bảng rules (loại, max, các cỡ, tường mặc định), danh sách cửa mặc định, `lockedReason`.
  6. **Màu:** chọn `allowed` từ danh sách COLORBOND; màu mặc định cho walls, roof, trim.
  - Kiểu `enquiry` → ẩn mục 2–6 (vẫn gửi config hợp lệ, giữ giá trị cũ).
  - Lỗi `checkGuestBuildingType` hiện **cạnh trường**, kiểm ngay trên client (cùng hàm core) và kiểm lại ở API.
  - Nút "Mở trên trang Guest" (Q8). 409 version → thông báo + nút tải lại.
- **Bridge:** `apps/admin/src/app/api/sq/[...path]/route.ts` đã chuyển tiếp `GET`, `POST`, `PATCH`, `DELETE`, `PUT` (dòng 110-134), nên không phải sửa.
- **Giao diện:** theo `design-system/smartquote-v2/MASTER.md` (navy/gold). **Không** dùng bảng màu đỏ SSA của trang Guest.

## 4. Các bước (vertical slice, tuần tự)

| Bước | Nội dung | Tự kiểm |
|---|---|---|
| **S1** | `checkGuestBuildingType` + `bookWarnings` trong core; schema ghi trong contracts. | `pnpm --filter @sq/core typecheck`. Chạy hàm với 6 mặc định → `[]` (script tạm bằng `npx tsx`, không lưu file test nếu tests tắt). Build lại `@sq/core`, `@sq/contracts`. |
| **S2** | Chuyển `audit` sang `lib/audit.ts`; route `GET` + `POST` + `PUT` + `PATCH`; seed lần đầu; khoá version. Test: `apps/api/src/__tests__/guestTypesAdmin.test.ts` (Q6). | `pnpm --filter @sq/api typecheck`. Với `TEST_DATABASE_URL=…/smartquote_test`: chạy file test đó. Kiểm tay bằng preview: sau `PUT` một loại, `GET /api/v1/public/guest/building-types` vẫn trả **đủ 6** loại, loại vừa sửa có `version` 2. |
| **S3** | Trang danh sách `/guest-types` + nav + banner mặc định + bật/tắt + sắp xếp. | `pnpm --filter @sq/admin-app build`. Mở http://localhost:3062/guest-types: bảng hiện 6 loại; tắt `aircraft_hangar` → trang Guest còn 5; bật lại. Đăng nhập `platform_support` (nếu có tài khoản thử) → mục nav ẩn, API trả 403. |
| **S4** | Form sửa (mục 1–4) + kiểm tra chéo trên client. | Sửa `garage`: span max 18 m → thấy cảnh báo vàng; lưu được. Trên trang Guest, chọn Garage → kéo Width tới 18 m được; bước gửi gắn cờ span (xem trong admin Enquiries). **Trả lại 15 m sau khi thử.** |
| **S5** | Form mục 5–6 (cửa, màu) + tạo loại mới. | Tạo loại `test_shed` (dữ liệu thử) → xuất hiện trên trang Guest đúng thứ tự → tắt nó sau khi thử. |
| **S6** | Kiểm hành vi bản nháp: khách có bản nháp loại X, admin tắt X. | Ghi lại trang làm gì: không vỡ trang là đạt. Nếu trang vỡ hoặc kẹt thì sửa tối thiểu trong `StartPanel` / `store` để khách chọn lại loại, rồi ghi lại vào checkpoint. |
| **S7** | Docs. | Cập nhật `docs/FEATURE-COVERAGE.md` (mục Guest), `docs/OPERATIONS.md` (cách khôi phục: tắt / bật, không xoá; seed lần đầu), và bản mô tả trong `docs/smartquote-quote-editor-reference.md` nếu có mục Guest. |

Cuối cùng chạy: `pnpm typecheck`, `pnpm build`, và `npx playwright test e2e/guestQuote.spec.ts --project guest`. Bộ e2e Guest phải vẫn xanh; nó chạy trên bảng trống, tức là trên mặc định.

## 5. Ngoài phạm vi

- Không đổi giới hạn của 6 loại mặc định (người dùng đã chốt giữ 15 m).
- Không thêm loại "freestyle" không giới hạn. Nếu cần, admin tạo một loại có limits rộng bằng chính trang này (Q2).
- Không nhúng 3D vào admin. Không thêm loại công trình theo từng công ty (bảng không có `tenant_id`; đó là thiết kế khác).
- Không sửa migration cũ; không thêm cột `deleted_at`.
