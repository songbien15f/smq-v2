# Checkpoint — Admin định nghĩa loại công trình cho trang Guest

Plan: [admin-guest-building-types.md](../plans/admin-guest-building-types.md). Bắt đầu 2026-11-19.
Tests: **chỉ bật cho S2** (`apps/api/src/__tests__/guestTypesAdmin.test.ts`). Các bước khác tự kiểm
bằng typecheck, build và chạy thật.

Quy tắc đang giữ: không commit/push/branch; không sửa migration đã có; không in secret; không gửi mail
thật; không đụng seat `E2ESHEDS`/`HEADOFFICE`; không đổi giới hạn 6 loại mặc định.

## Nhật ký

_(mỗi bước một dòng: bước nào, file chính, đã kiểm tra gì, số đo thật)_

### S1 — core checks + write schema (2026-11-19)

- `packages/core/src/domain/guest.ts`: thêm `checkGuestBuildingType(type)` và `bookWarnings(type)` cạnh `guestReviewFlags`.
  - `checkGuestBuildingType` kiểm cấu trúc (roof khởi đầu có trong `roofs`; mỗi roof có ≥1 pitch), rồi dựng
    `guestDesignFromType(type)` và cho qua `validateGuestDesign` — **cùng hàm trang và route gửi dùng** (A13).
    `mode: 'enquiry'` bỏ qua hình học. Lỗi `building.roof` bị bỏ khi đã báo bằng câu của người vận hành
    (tránh hai câu cho một lỗi).
  - `bookWarnings` chỉ **cảnh báo** (Q2): limits vượt `BOOK_SPAN_MM`/`BOOK_HEIGHT_MM`/`BOOK_BAY_MM`, skillion pitch
    dưới `BOOK_MIN_SKILLION_PITCH_DEG`.
- `packages/contracts/src/guest.ts`: `GUEST_TYPE_ID_PATTERN`, `guestBuildingTypeWriteSchema`, `guestBuildingTypePatchSchema`,
  `guestBuildingTypeReorderSchema`, `GuestBuildingTypeAdminRow`, `GuestBuildingTypesAdminResponse`, `GuestBuildingTypeAdminDetail`.
- **Kiểm (chạy thật, `npx tsx` script tạm rồi xoá):** 6 `GUEST_DEFAULT_TYPES` → `checkGuestBuildingType` = **0 lỗi** cả 6.
  `bookWarnings`: garage 1, industrial 1, riding_arena 0, aircraft_hangar 0, carport 2, house 0 (garage/industrial/carport
  có chip skillion 5°; carport thêm bay 1–6 m). Ca lỗi: start pitch 12.5° → 1 câu; start roof `skillion` trên
  riding_arena (chỉ gable) → 1 câu; skillion không có pitch → 1 câu; rules rỗng + defaults → 1 câu; house với span
  999999 → **0 lỗi** (enquiry bỏ qua hình học). `pnpm --filter @sq/core build` + `@sq/contracts build` sạch;
  typecheck core + contracts sạch.
- **Không đổi** số của 6 loại mặc định (trần 15 m giữ nguyên).

### S2 — audit lib + routes + seed + version lock + test (2026-11-19)

- `apps/api/src/lib/audit.ts` (mới): `audit(tx, entry)` chuyển nguyên từ `routes/admin.ts:33-49` (cùng SQL, cùng cột);
  `admin.ts` import lại từ lib. Không đổi hành vi.
- `apps/api/src/routes/guestTypesAdmin.ts` (mới), đăng ký ở `app.ts`: `GET /admin/guest-types`, `GET /admin/guest-types/:id`,
  `POST`, `PUT`, `PATCH`, `POST /admin/guest-types/reorder`. Mọi route qua `requirePlatformCapability(..., 'platform:templates')` (Q1).
  - Mọi ghi trong **một transaction**: seed 6 mặc định nếu bảng trống (Q4) → áp → `audit` (`guest_type.seed_defaults` / `.create` /
    `.update` / `.enable` / `.disable` / `.reorder`).
  - `version` + `expectedVersion` → **409 conflict** (Q7). `id` bất biến (Q5) → 422 khi cố đổi.
  - `checkGuestBuildingType` chạy ở POST/PUT → **422** kèm lý do; `bookWarnings` **không** chặn (Q2).
  - Hàng `config_json` hỏng vẫn trả về với `invalid.reason` (trang Guest đang bỏ qua nó).
  - `GET` trả kèm `siteOrigin` từ `config.origins.site` (Q8).
- `packages/contracts/src/guest.ts`: schema ghi/patch/reorder + `GuestBuildingTypeAdminRow`/`…Response`/`…Detail` (từ S1).
- **Test** `apps/api/src/__tests__/guestTypesAdmin.test.ts` — **15/15 pass** với `TEST_DATABASE_URL=…/smartquote_test`:
  seed 6 loại khi lưu lần đầu (và chỉ 1 audit seed); `platform_support` → 403; khách ẩn danh → 401; PUT cũ → 409 và bản ghi giữ
  tên người lưu trước; start pitch 12.5° → 422; span max 18 m **lưu được** + warning; đổi id → 422; POST tạo `test_shed` → trang
  công khai trả **7** loại; trùng id → 409; id không phải slug → 422; PATCH tắt `aircraft_hangar` → công khai còn **5**, bật lại →
  **6**; audit có `guest_type.disable`; reorder → 10/20/30; id lạ → 422.
- `@sq/api test` toàn bộ: **381/381** (36 file). `@sq/api typecheck` sạch.
- Dev DB lúc bắt đầu: `guest_building_types` **0 hàng** (đang dùng mặc định trong code) — đã kiểm trước khi thử tay.

### S3 — trang danh sách + nav + bật/tắt + sắp xếp (2026-11-19)

- `apps/admin/src/app/guest-types/page.tsx` (mới, server component), `apps/admin/src/components/GuestTypesList.tsx` (mới, client):
  `DataTable` 9 cột (Order/Name/Id/Kind/Frame/Width/State/Version/Actions); banner "Using the six types built into the product"
  khi `source: 'default'`; hàng `invalid` có `StatusPill` đỏ; nút ↑/↓ gọi `POST /admin/guest-types/reorder` (gửi cả thứ tự,
  một transaction); "Switch off/on" gọi `PATCH`; hộp thoại xác nhận khi tắt loại cuối cùng; link "Open on Guest page" dùng
  `siteOrigin` API trả về (Q8).
- `apps/admin/src/components/ShellFrame.tsx`: thêm mục nav `Guest building types` (`platform:templates`) trong nhóm Catalogue.
  `apps/admin/src/components/NavIcons.tsx`: icon `guestTypes`.
- `apps/admin/src/app/api/sq/[...path]/route.ts:32`: thêm `admin/guest-types` vào allow-list (bridge chặn mọi path không liệt kê).
- **Kiểm thật:** `/guest-types` hiện **6 hàng** + banner; tắt `aircraft_hangar` → "**5 of 6 live**", banner biến mất (bảng đã seed),
  `GET /api/sq/public/guest/building-types` qua site → **5 loại**, không có `aircraft_hangar`; bật lại → **6 of 6**, danh sách
  công khai **6 loại** có hangar.
- **Bẫy gặp phải:** 404 `No such route` KHÔNG phải bridge — là **API đang chạy bản build cũ** (`app.ts:219` là notFound handler).
  Phải `pnpm --filter @sq/api build && pnpm --filter @sq/api start` sau khi thêm route.

### S4 — form sửa mục 1–4 + kiểm chéo trên client (2026-11-19)

- `apps/admin/src/components/GuestTypeEditor.tsx` (mới): 6 mục; `checkGuestBuildingType`/`bookWarnings` chạy **trên client mỗi
  lần gõ** (cùng hàm core API dùng); mét ↔ mm qua `mmToMetres`/`metresToMm`; `MetreRange` hiện cảnh báo vàng khi vượt sổ giá (Q2);
  lưu gửi `expectedVersion`, 409 → thông báo + nút "Reload the saved version"; `id` chỉ hiện khi tạo (Q5).
- `apps/admin/src/app/guest-types/[id]/page.tsx`, `.../new/page.tsx` (mới). `new` khởi tạo từ cấu hình **garage** vì một form rỗng
  không qua được `checkGuestBuildingType`.
- `apps/admin/package.json` + `next.config.ts`: thêm `@sq/core` (chỉ dùng subpath `domain`; `pricing` kéo `node:fs`).
- **Kiểm thật:** `/guest-types/garage` hiện đủ 6 mục; đổi span max `15.00` → `18.00` → cảnh báo vàng hiện ngay, **không** lỗi chặn;
  Save → "Saved.", **version 2**; `GET` công khai → garage span **1800–18000**, vẫn **6 loại**; trang Guest (chọn Garage) hiện dải
  **"1.8 m – 18.0 m"** — thay đổi từ admin tới được khách.
- **Đã trả về như cũ:** span max `15.00`, Save → **version 3**; `GET` công khai → **1800–15000**, 6 loại.

### S5 — form mục 5–6 + tạo loại mới (2026-11-19)

- `GuestTypeEditor.tsx` mục 5 (rules: kind/max/default wall/size chips; danh sách cửa khởi đầu; `lockedReason` khi không có
  rule nào) và mục 6 (màu khởi đầu walls/roof/trim + 30 ô tick "Colours offered").
- `apps/admin/src/lib/guestTypeTemplate.ts` (mới): `newTypeTemplate()`.
  **Lỗi gặp phải:** hàm này ban đầu nằm trong `GuestTypeEditor.tsx` (`'use client'`), nên trang server `/guest-types/new`
  không gọi được — Next ném "Attempted to call newTypeTemplate() from the server but it is on the client", trang hiện
  "This page couldn't load". Tách sang `lib/` là xong.
- **Kiểm thật:** `/guest-types/new` hiện 6 mục, **4 rule cửa**, **33 checkbox** (3 màu khởi đầu + 30 màu). Tạo `test_shed`
  (name "Test Shed", sortOrder 500) → chuyển tới `/guest-types/test_shed`, h1 "Test Shed"; `GET` công khai → **7 loại**, thứ tự
  `garage, industrial, riding_arena, aircraft_hangar, carport, house, test_shed` (sort 500 cuối); trang Guest hiện **7 thẻ** đúng thứ tự.
- **Dọn dữ liệu thử:** tắt `test_shed` trước (6 of 7 live), rồi xoá hàng bằng SQL tay trên dev DB (route không có xoá — Q3).
  Sau khi dọn: công khai **6 loại**, garage `1800–15000`, `test_shed` không còn.

### S6 — bản nháp trỏ tới loại đã tắt (2026-11-19)

- **Đo trước khi sửa:** đặt `localStorage` một bản nháp `typeId: 'test_shed'` (loại đã tắt) rồi tải lại. Trang **không vỡ**:
  về ①, hiện đủ 6 thẻ, chọn lại được. **Nhưng** thanh tóm tắt vẫn ghi `test_shed · 6.00 × 6.00 m · Gable 10° · 2 bays` —
  id thô của loại không còn tồn tại — và bước ② nói "This building type is no longer offered" mà không có đường quay lại.
- **Sửa tối thiểu:** `apps/site/src/app/quote/store.ts` `hydrate` — bản nháp trỏ tới loại không có trong danh sách thì **bỏ cả
  thiết kế**, về ①, ghi `droppedType` vào state. `StartPanel.tsx` hiện một dòng: "The building you were designing is no longer
  available, so its design was cleared. Pick a building below to start again." `chooseType` xoá thông báo.
  - **Địa chỉ cũng mất**, vì `design.site` nằm *trong* thiết kế; câu thông báo đã sửa để không hứa "address is kept".
- **Kiểm thật:** đặt lại bản nháp `test_shed`, tải lại → `?step=start`, thông báo hiện, **thanh tóm tắt sạch**, **6 thẻ**, không lỗi
  console. Chọn Garage lại → thông báo biến mất.

### S7 — tài liệu (2026-11-19)

- `docs/FEATURE-COVERAGE.md` mục 6 (Guest quote page): thêm đoạn "The building types are editable from the admin" — bảng trống
  dùng 6 mặc định, lần lưu đầu chép cả 6, không xoá, id bất biến, vượt sổ giá là cảnh báo, bản nháp trỏ loại đã tắt bị xoá kèm
  thông báo.
- `docs/OPERATIONS.md`: mục mới "The Guest page's building types (admin, `/guest-types`)" — bảng việc/làm ở đâu, vì sao không
  xoá và id bất biến, cảnh báo vượt sổ giá, bản nháp bị xoá, cách khôi phục (bật lại; sửa tay để trả mặc định — **không** có nút
  reset, để không xoá âm thầm giới hạn của người vận hành).
- `docs/smartquote-quote-editor-reference.md`: **không có mục Guest** (đã grep: chỉ có §12.x về editor), nên không sửa.

### Kiểm cuối (2026-11-19)

| Việc | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `pnpm typecheck` | **14/14** |
| Build | `pnpm build` | **9/9** |
| Test S2 | `vitest run src/__tests__/guestTypesAdmin.test.ts` (TEST_DATABASE_URL=…/smartquote_test) | **15/15** |
| API toàn bộ | `pnpm --filter @sq/api test` | **381/381** (36 file) |
| E2E Guest | `npx playwright test e2e/guestQuote.spec.ts --project guest` | **5/5** (20,9 s) |
| Màu admin | đo `getComputedStyle` nút Save | `rgb(7, 24, 50)` — navy MASTER, không có `#E83238` của trang Guest |
| Tắt/bật một loại | Carport | "5 of 6 live" → "6 of 6 live"; ảnh chụp lưu trong `artifacts` của phiên |

**Ảnh chụp** (không xem được bằng mắt trong phiên này — model không nhận ảnh; đã kiểm bằng số đo thay thế):
`/guest-types` (danh sách 6 hàng, banner, cột Version/State), `/guest-types/garage` (6 mục, cảnh báo vàng "Beyond the price
book" cho skillion 5°), `/quote` (6 thẻ theo đúng thứ tự).

**Dữ liệu thử đã dọn:** `test_shed` xoá khỏi dev DB; garage span max trả về **15 m** (v3); 6 hàng, đúng thứ tự 10–60, tất cả `live`.
**Không đổi** số nào của 6 loại mặc định trong code (`GUEST_DEFAULT_TYPES`).
**Không thêm migration** (plan đúng: bảng `guest_building_types` đã có từ 020).

**Chưa kiểm tra:**
- **Đăng nhập `platform_support` trên trình duyệt.** Có test API (403) nhưng chưa mở admin bằng tài khoản đó; và `docs/TEST-ACCOUNTS.md`
  chỉ có `ops@smartquote.local` (platform_admin) — **chưa có tài khoản platform_support** để thử, nên phần "mục nav ẩn" của S3
  **chưa kiểm**.
- **Kéo tới 18 m trên slider của trang Guest** (mới đọc dải "1.8 m – 18.0 m" và API trả 18000; chưa kéo và chưa gửi để thấy cờ `span`
  trong Enquiries như S4 mô tả).
- **`platform:audit`/`platform:versions`** — không liên quan, không đụng.
