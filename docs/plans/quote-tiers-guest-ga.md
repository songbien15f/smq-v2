# Plan — Guest `/quote`, lát G-a

> Spec: [quote-tiers-guest.md](../specs/quote-tiers-guest.md) (đã duyệt 2026-11-18). Giao diện: [pages/guest-quote.md](../../design-system/smartquote-v2/pages/guest-quote.md).
> Checkpoint: [docs/state/quote-tiers.md](../state/quote-tiers.md). Cỡ: *large*, **một coder**, 8 bước tuần tự; mỗi bước build và chạy được một mình.
> Tests và git: tắt (mặc định). Coder tự kiểm tra từng bước; mục "Đề xuất test" ghi chỗ nên bật `tests=on`.

## 1. Phạm vi

**G-a làm:**
- trang `/quote` 4 tab trong `apps/site`;
- loại nhà (mặc định từ core khi bảng rỗng);
- địa chỉ qua proxy Google Places có chống spam, kèm danh sách suburb dự phòng;
- vùng Design với `GuestPlan` 2D bằng SVG; tab 3D chỉ có hình minh họa;
- gửi yêu cầu, màn xác nhận, mail xác nhận;
- migration 020; bridge của site.

**Không làm** (lát sau):

| Lát | Nội dung |
|---|---|
| G-b | link ma thuật, "My requests", `guest_tokens` / `guest_sessions` |
| G-c | màn lead trong admin, chuyển lead thành quote |
| G-f | 3D thật |
| G-g | trợ lý AI và bảng của nó; cột `assistant_session_id` |
| G-h | extras |
| G-i | trình sửa loại nhà cho super admin (G-a chỉ đọc bảng) |

AC phải đạt: 1, 1a, 1b (bước 1–6 và 8), 1c, 1d, 1e, 1g, 2, 3, 8, 12, 13.

## 2. Sự thật đã kiểm tra (file:line)

**API**
- Route công khai mẫu: [enquiries.ts](../../apps/api/src/routes/enquiries.ts). Thứ tự: `consume` theo `hashIp(clientIp)`, rồi `parseBody` (schema `.strict()`, honeypot là field tùy chọn), rồi `INSERT` với `newId()`, rồi gửi mail nền qua `notificationRecipients` (`ENQUIRY_TO` + nhân viên platform).
- Đăng ký route: [app.ts:161-196](../../apps/api/src/app.ts:161). `registerPlaces(scope)` ở :184; allow-list CORS ở :130.
- Rate limit: [rateLimit.ts](../../apps/api/src/lib/rateLimit.ts). Cửa sổ cố định, lưu trong bảng `rate_limits` (001); chỉ có `consume` và `reset`. **Không có dọn dẹp** — bảng tăng một dòng mỗi khóa.
- Places hiện tại: [places.ts](../../apps/api/src/lib/places.ts).
  - `createGooglePlacesTransport(apiKey, fetchImpl)`; autocomplete POST `places:autocomplete`, `includedRegionCodes:['au']`; details GET `places/{id}` với field mask `formattedAddress,addressComponents`.
  - **Chưa gửi `sessionToken`.**
- Price book: `activeBookHash` [priceBook.ts:47](../../apps/api/src/lib/priceBook.ts:47), `openBookDatabase` :96, `ensureBookOnDisk` :170.
  - Bảng `country_surburb(surburb_id, surburb_name, surburb_code = postcode, State_id)` có trong `data/price-books/fe5a7cae…eb8.db`, chưa được code nào dùng.
- Mail: [transactional.ts](../../apps/api/src/lib/mail/transactional.ts) có `TransactionalDeps` (:32), `MailNotConfiguredError` (:41), `sendResetMail` / `sendInviteMail`. Chưa có mail cho Guest.
- Secret cấu hình theo mẫu `sessionSecret` ở [config.ts:100](../../apps/api/src/config.ts:100): production từ chối giá trị dev hoặc ngắn hơn 32 ký tự.

**Core**
- Export `./domain` có trong [package.json](../../packages/core/package.json).
- `ShedConfig` [types.ts:376](../../packages/core/src/domain/types.ts:376).
- `Preset{name, config}` [presets.ts:21](../../packages/core/src/domain/presets.ts:21), `PRESETS` :74 (chưa có `id` ổn định).
- `placeOpening` [placementRules.ts:119](../../packages/core/src/domain/placementRules.ts:119); `normaliseShedConfig` [schema.ts:1022](../../packages/core/src/domain/schema.ts:1022); `buildPlanGeometry` [plan.ts:323](../../packages/core/src/domain/plan.ts:323); `reconcileBays` [bays.ts:141](../../packages/core/src/domain/bays.ts:141).
- `COLORBOND` [defaults.ts:11](../../packages/core/src/domain/defaults.ts:11); `DEFAULT_OPENING_BY_TYPE` :65.

**Site**
- Phụ thuộc chỉ có `@sq/contracts`, `@sq/ui`, `next`, `react`; **không có `@sq/core`**.
- `transpilePackages` ở [next.config.ts:35](../../apps/site/next.config.ts:35) thiếu `@sq/core`; client có, ở [next.config.ts:38](../../apps/client/next.config.ts:38).
- `page.tsx`, `s/page.tsx` và `EnquiryForm.tsx` gọi thẳng `NEXT_PUBLIC_API_BASE`; **chưa có bridge**. Mẫu bridge: `apps/client/src/app/api/sq/[...path]/route.ts` (allow-list tiền tố, đường ngoài danh sách trả 404).

**DB**
- Migration 001…018, phần riêng của Postgres trong `pg/`. **019 đã dành cho `company_roles`**, nên G-a dùng **020**.

## 3. Kết quả nghiên cứu Google (nguồn chính thức, đọc 2026-11-18)

**Session pricing** — [session-pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing), cập nhật 2026-11-09:
- Phiên kết thúc bằng Place Details **Essentials**: 12 request autocomplete đầu tính tiền, từ request thứ 13 miễn phí, details tính giá Essentials.
- Phiên kết thúc bằng IDs Only: tính tiền từng request.
- Phiên kết thúc bằng trường Pro/Enterprise: autocomplete miễn phí, details tính giá Enterprise + Atmosphere.
- Phiên bỏ dở: tính tiền từng request.
- Hệ quả:
  - phải gửi `sessionToken` ở **cả hai** lời gọi;
  - trần mỗi phiên đặt **12** (điểm gãy của hóa đơn); quá 12 thì yêu cầu phiên mới.

**Policies** — [policies](https://developers.google.com/maps/documentation/places/web-service/policies):
- Không pre-fetch, cache hay lưu nội dung Places. Ngoại lệ: **place ID lưu vô thời hạn**, lat/lng lưu tối đa 30 ngày.
- Bắt buộc dùng field mask.
- Kết quả hiện mà không có bản đồ Google thì phải ghi attribution "Google Maps".
- Hệ quả:
  - không có cache phía server;
  - lưu `placeId` cùng lead;
  - dưới danh sách gợi ý có dòng "Google Maps";
  - địa chỉ lưu là bản khách đã xác nhận và tự sửa, đây là vùng xám của ToS — **không phải tư vấn pháp lý**, cần chủ sản phẩm xem.

**Chưa kiểm tra:** `addressComponents` thuộc SKU Essentials hay Pro (bảng trường ↔ SKU). Việc này quyết định autocomplete có miễn phí hay không. Kiểm tra ở bước S3 trước khi chốt field mask.

## 4. Quyết định thiết kế

| # | Quyết định | Lý do / phương án bỏ |
|---|---|---|
| P1 | Migration `020_guest_requests.sql` tạo `guest_contacts`, `guest_requests`, `guest_building_types`; thêm cột `place_id` và `source_json` (utm, P16) vào `guest_requests`. `assistant_session_id` để G-g thêm | Không tạo cột trước khi có bảng nó trỏ tới |
| P2 | Số yêu cầu: `CREATE SEQUENCE guest_request_seq` trong `pg/020_*.sql`, định dạng `GR-` + 6 chữ số; tiền tố lấy từ env `GUEST_REQUEST_PREFIX` (mặc định `GR-`) | Postgres-only (D1); max+1 trong transaction dễ trùng khi hai request đến cùng lúc |
| P3 | Loại nhà mặc định ở core: `GUEST_DEFAULT_TYPES` (4 loại của spec, kèm giới hạn kích thước Guest). API trả bảng nếu có dòng `enabled`, ngược lại trả mặc định core với `version: 0` | Admin editor là G-i; trang chạy được ngay |
| P4 | `Preset` thêm `id` ổn định (`farm_machinery`, `domestic_garage`, `open_carport`, `skillion_workshop`, …); `base_preset` trong bảng lưu id | Tên hiển thị đổi được, id không đổi |
| P5 | `configFromGuestDesign(design, type)` → `ShedConfig` và `validateGuestDesign(design, type)` → danh sách lỗi; cả hai ở `@sq/core/domain`, dùng `placeOpening` và `normaliseShedConfig`. Site và API cùng gọi | A13: core là chỗ duy nhất tính hình học. Server kiểm lại, không tin client |
| P6 | Site: thêm `@sq/core` vào dependencies và `transpilePackages`. Chỉ import `@sq/core/domain`; **không** import `pricing` / `bom` / `estimating` | AC3: bundle site không có giá |
| P7 | Bridge `apps/site/src/app/api/sq/[...path]/route.ts`, chép thu gọn từ client: allow-list `public/guest/`, `public/guest-requests`; không chuyển cookie phiên. Chuyển `EnquiryForm` sang bridge: **không** trong G-a | A14; giữ diff nhỏ |
| P8 | Places của Guest là route **riêng** `/public/guest/places/*` trong `lib/guestPlaces.ts`, dùng lại transport hiện có với tham số tùy chọn `sessionToken`. Route `/places` cũ không đổi | Route cũ phục vụ editor đã đăng nhập; Guest cần lớp chống spam |
| P9 | Phiên Places: id = `uuid.ts.HMAC(secret)`, sống 3 phút, gửi Google làm `sessionToken`. Trần mỗi phiên: 12 autocomplete, 1 details | Mục 3 |
| P10 | Hạn mức theo IP băm: tạo phiên ≤ 10/giờ; autocomplete ≤ 60/giờ và ≤ 200/ngày; details ≤ 20/ngày. Trần toàn hệ thống theo ngày qua env; vượt trần thì trả `unavailable` để trang dùng fallback, và gửi tối đa một mail cảnh báo mỗi ngày (khóa `consume` riêng) | Spec mục địa chỉ |
| P11 | Kiểm tra input ở server: độ dài 3–100; từ chối chuỗi toàn số hoặc một ký tự lặp lại; dưới 3 ký tự trả rỗng, không gọi Google. Trình duyệt: debounce 300 ms, `AbortController` hủy request trước | Spec |
| P12 | `POST /public/guest-requests`: hạn mức 5/giờ theo IP và 3/ngày theo email chuẩn hóa; honeypot `website` → giả 202. Upsert `guest_contacts` theo `email_norm`: **không ghi đè** tên/mobile khi `email_verified_at` đã có — bản khách gõ chỉ nằm ở `contact_json` của lead | Spec mục dữ liệu |
| P13 | Mail xác nhận cho khách + thông báo cho `GUEST_NOTIFY_TO`, rỗng thì dùng `notificationRecipients` hiện có. Mail không có giá. Mail lỗi không làm hỏng 202 | Mẫu enquiries |
| P14 | Env mới (thêm vào `turbo.json` `globalPassThroughEnv` và `.env.example`, đều có mặc định): `GUEST_PLACES_ENABLED` (mặc định `0`), `GUEST_PLACES_SESSION_SECRET` (production bắt buộc ≥ 32 ký tự, như `SESSION_SECRET`), `GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP` (2000), `GUEST_PLACES_DAILY_DETAILS_CAP` (300), `GUEST_REQUEST_PREFIX`, `GUEST_NOTIFY_TO` | Mặc định tắt Places, để máy dev không tốn tiền |
| P16 | Web giới thiệu SSA là **project Next.js riêng** (người dùng làm sau, quyết định 2026-11-18); `/quote` vẫn ở `apps/site`. Hai điểm nối trong G-a: (a) link sâu `?type=<id>` chọn sẵn loại nhà và mở tab Address, tham số `utm_*` giữ nguyên vào `guest_requests.source_json`; (b) env `NEXT_PUBLIC_BRAND_SITE_URL` cho các link Home / Projects / Contact của `GuestHeader`, rỗng thì ẩn nav | Tách deploy, tách phạm vi platform/thương hiệu; không publish `@sq/core` |
| P15 | Font Archivo và Inter tự host (woff2, OFL) dưới `apps/site/src/fonts/`, nạp bằng `next/font/local` | Override §2. **Lấy file:** từ bản phát hành chính thức của dự án font; tải về cần người dùng duyệt |

## 5. Các bước (tuần tự, một coder)

Mỗi bước gồm: các file, cách tự kiểm tra, AC được phủ. "typecheck" nghĩa là `pnpm --filter <pkg> typecheck`.

### S1 — Hợp đồng và core
- `packages/contracts/src/guest.ts`:
  - `guestDesignSchema` (v1, đúng spec, mm, không có trường giá);
  - `guestBuildingTypeSchema`;
  - `guestRequestBody` (`.strict()`, có `website` tùy chọn), `guestRequestAccepted { number }`;
  - DTO cho Places và suburb.
  - Export trong `index.ts`.
- `packages/core/src/domain/presets.ts`: thêm `id` (P4).
- `packages/core/src/domain/guest.ts`: `GUEST_DEFAULT_TYPES`, `configFromGuestDesign`, `validateGuestDesign` (P5). Export qua `./domain`.
- Kiểm tra:
  - `pnpm build:inc` rồi typecheck `@sq/core`, `@sq/contracts`, `@sq/client` (client import `PRESETS`; thêm `id` không được làm gãy);
  - chạy một script `tsx` tạm trong scratchpad, tạo design mặc định của 4 loại, in số lỗi = 0 và `buildPlanGeometry` không ném.
- AC: 2 (một phần), 3.

### S2 — Migration và route gửi yêu cầu
- `packages/db/migrations/020_guest_requests.sql` (+ `pg/020_guest_requests.sql` cho sequence):
  - 3 bảng theo spec + `place_id`, `source_json`;
  - các bảng **không có** `tenant_id`: lead Guest thuộc platform trước khi chuyển (G-c gán tenant). Ghi rõ điều này trong phần "## Why" của file migration và thêm bảng vào danh sách loại trừ của `isolation.test.ts` nếu test đó liệt kê bảng (*chưa kiểm tra* cách test liệt kê).
- `apps/api/src/routes/guest.ts`:
  - `GET /public/guest/building-types`;
  - `POST /public/guest-requests` (P2, P12, P13; server chạy `validateGuestDesign` với loại hiện tại, sai thì `422 invalid_design` kèm danh sách lỗi);
  - đăng ký trong `app.ts`.
- `apps/api/src/lib/mail/guest.ts`: mail xác nhận và mail thông báo (văn bản thuần + HTML đơn giản, en-AU).
- Kiểm tra:
  - `pnpm db:migrate` trên DB dev;
  - typecheck `@sq/api`;
  - `curl` loại nhà (4 mặc định);
  - `curl` POST hợp lệ → 202 `GR-000001`;
  - POST thiếu email → 400;
  - cửa chồng nhau → 422;
  - honeypot → 202 nhưng không có dòng mới;
  - lần thứ 6 trong giờ → 429.
- AC: 2, 8, 13 (phía server).

### S3 — Proxy Places và suburb
- Kiểm tra trước: SKU của `addressComponents` (mục 3). Nếu là Pro thì field mask details chỉ giữ trường Essentials, và ghép suburb/state/postcode từ `formattedAddress` (*chưa kiểm tra* trường nào là Essentials).
- `apps/api/src/lib/places.ts`: thêm `sessionToken?` vào hai lời gọi của transport (không đổi hành vi khi không truyền).
- `apps/api/src/lib/guestPlaces.ts`: ký và kiểm phiên HMAC, các lớp `consume` (P9, P10), trần ngày, mail cảnh báo, kiểm input (P11), công tắc tắt.
- `routes/guest.ts`:
  - `POST /public/guest/places/session`;
  - `GET …/autocomplete?q=&s=`, trả tối đa 5 kết quả;
  - `GET …/details?id=&s=`;
  - `GET /public/guest/suburbs?q=`: `openBookDatabase(activeBookHash)`, `LIKE` theo tên hoặc postcode, tối đa 10, chỉ đọc.
- Config: env của P14 vào `config.ts`, `turbo.json`, `.env.example`.
- Kiểm tra:
  - `GUEST_PLACES_ENABLED=0` → `unavailable`;
  - suburbs `q=Penrith` trả kết quả có postcode;
  - phiên giả hoặc hết hạn → 401;
  - lần autocomplete thứ 13 → 429;
  - input `1111` → 400.
  - Gọi Google thật **chỉ** qua `scripts/probe-guest-places.mjs` (bước S8), không gọi trong vòng lặp.
- AC: 1e (phía server).

### S4 — Khung trang
- Thêm `@sq/core` vào `apps/site/package.json` và `transpilePackages` (P6). Chạy `pnpm install`.
- Bridge (P7).
- Token SSA trong `src/app/quote/guest.css`, scope `.guest-quote`, sáng/tối đúng override §1.
- Font (P15).
- Trang `src/app/quote/page.tsx` (đọc `?type=` và `utm_*` lúc vào trang, P16):
  - `GuestHeader` (logo `public/brand/ssa-logo-96.png`, override §4a), `StepTabs` (WAI-ARIA, phím mũi tên, `?step=` qua `pushState`, Back của trình duyệt), `StepFooter`;
  - store của site `src/app/quote/store.ts`: design + tab, ghi `localStorage` trong try/catch; Start over.
- Kiểm tra:
  - typecheck và `pnpm --filter @sq/site build`;
  - mở `http://localhost:3063/quote`: 4 tab, ②③④ khóa, Back quay về tab trước, tải lại vẫn giữ tab;
  - trang `/` và `/s` trông không đổi.
- AC: 1, 1g, 12 (khung).

### S5 — Tab ① Loại nhà, tab ② Địa chỉ
- `TypeCard` × n từ `GET building-types`; chọn thì mở khóa và áp kích thước mặc định của loại.
- `AddressCombobox`:
  - WAI-ARIA combobox, debounce 300 ms, hủy request trước;
  - tạo phiên lười (lúc gõ ký tự thứ 3), sau khi chọn thì phiên kết thúc;
  - 4 trường sửa được; dòng "Google Maps";
  - `unavailable` hoặc lỗi → danh sách suburb, rồi nhập tay, kèm câu giải thích.
- `WindNote`.
- Kiểm tra: với Places tắt, đi ① → ② bằng suburb dự phòng; chỉ dùng bàn phím; ở 360px không cuộn ngang.
- AC: 1a, 1e.

### S6 — Tab ③ Design
- `ControlAccordion`: kích thước (slider + ô số, kẹp theo giới hạn của loại), độ dốc (chip), số bay; danh sách cửa; `SwatchGrid` (`COLORBOND`).
- `GuestPlan` SVG:
  - vẽ từ `buildPlanGeometry(configFromGuestDesign(...))`;
  - chạm vào tường để thêm cửa mặc định;
  - kéo dọc tường, vị trí qua `placeOpening` (snap và chặn chồng);
  - phóng to/thu nhỏ bằng nút và pinch;
  - nhãn kích thước `tabular-nums`.
- `Stage`: tab 2D / 3D (hình minh họa theo loại), chip tóm tắt.
- Bố cục theo bảng breakpoint của override §3; ≥ 1024: `100dvh` trừ header và tab bar, từng cột tự cuộn.
- Kiểm tra:
  - đổi kích thước thì 2D, chip và thanh tóm tắt đổi cùng lúc;
  - không thể tạo hai cửa chồng nhau;
  - Carport không cho thêm cửa (có câu lý do);
  - đo ở 360, 390, 768, 1024, 1280, 1440 và 844 × 390.
- AC: 1c, 12.

### S7 — Tab ④ Gửi, `SummaryBar`
- Bảng "What you're sending"; "What happens next".
- Form 4 trường (mobile +61 → E.164, lỗi ngay cạnh trường), ghi chú, đồng ý, honeypot ẩn.
- Thiếu bước nào thì nút gửi đưa tới tab đầu tiên còn thiếu.
- Màn xác nhận có số yêu cầu; "Keep designing" giữ design, xóa form.
- `SummaryBar` theo override (trong tab bar ở ≥ 768, dính đáy ở < 768, ẩn khi bàn phím mở).
- Kiểm tra:
  - gửi thật qua bridge → số `GR-…` và dòng trong DB;
  - mail dev nhận được (hoặc log khi chưa cấu hình mail);
  - `grep` thư mục `.next/static` của site không có `contractCents`, `priceCents`, `$` đi kèm số.
- AC: 2, 3, 8.

### S8 — E2E, probe, tài liệu
- `e2e/guestQuote.spec.ts`: không đăng nhập (không dùng `e2e/.auth`), Places tắt, chạy bước 1–6 và 8 của kịch bản spec; một lần ở viewport 390.
- `scripts/probe-guest-places.mjs`: một phiên thật (3 autocomplete + 1 details), in số lời gọi; không in key.
- `docs/OPERATIONS.md`: giới hạn key theo API và referrer/IP, quota theo ngày ở Google Cloud, cảnh báo ngân sách, cách bật `GUEST_PLACES_ENABLED`, dọn `rate_limits`.
- Cập nhật `CHANGELOG`, `docs/FEATURE-COVERAGE.md`, mục Guest trong `docs/smartquote-quote-editor-reference.md` (nếu có).
- Kiểm tra: `pnpm build`, `pnpm typecheck`, `pnpm test:e2e -- guestQuote` (khi `pnpm dev` đang chạy).
- AC: 1b, 1d (đo tương phản bằng công cụ trình duyệt), 13.

## 6. Rủi ro và câu hỏi mở

- **SKU của `addressComponents`:** *chưa kiểm tra* (S3). Nếu là Pro, phiên mất phần autocomplete miễn phí.
- **Lưu địa chỉ theo ToS của Google:** cần chủ sản phẩm duyệt; không phải tư vấn pháp lý.
- **Bảng `rate_limits` không bao giờ được dọn:** G-a thêm nhiều khóa theo IP và phiên. Đề xuất một lệnh `pnpm ratelimits:prune` (xóa dòng có `window_end` đã qua), trong G-a hay để sau: **quyết định ở S3**, mặc định thêm vì nó nhỏ.
- **Chất lượng `country_surburb`** (chính tả "surburb" là của bảng gốc; trùng tên giữa các bang): kiểm khi làm S3.
- **`isolation.test.ts`** có thể đòi mọi bảng phải có `tenant_id`: *chưa kiểm tra*; xem ở S2.
- **Font:** tải woff2 từ nguồn ngoài cần người dùng duyệt (S4).
- **Logo SSA:** đã nhận 2026-11-18, nằm ở `apps/site/public/brand/`. Quy tắc dùng ở mục 4a của override. Ở chế độ tối logo cần nền trắng vì PNG không trong suốt.

## 7. Đề xuất test (tests đang tắt)

Nên bật `tests=on` cho những chỗ có tiền và chống lạm dụng:
- `validateGuestDesign` (từ chối cửa chồng nhau, kích thước ngoài giới hạn);
- `POST /public/guest-requests` (honeypot, hạn mức, không ghi đè hồ sơ đã xác thực);
- `guestPlaces` (phiên giả hoặc hết hạn, trần 12, trần ngày, công tắc tắt) với transport giả, không gọi Google.
