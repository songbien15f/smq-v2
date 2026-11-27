# Checkpoint: ba cấp báo giá (Guest / Dealer / Đầy đủ)

Cập nhật: 2026-11-18

## Mục tiêu
Một sản phẩm, ba cấp:
- **Guest**: khách vãng lai thiết kế vài field ở `apps/site` `/quote`, không đăng nhập, gửi yêu cầu qua cổng chung tới super admin;
- **Dealer**: một mẫu trong hệ **vai trò tùy biến** (thấy giá bán, không thấy BOM, chỉ quote của mình);
- **Đầy đủ**: editor hiện tại, cộng hộp thư yêu cầu do vendor chuyển tới.

## Đã xong
- Spec, đã viết lại theo quyết định chốt, chờ duyệt:
  - [quote-tiers.md](../specs/quote-tiers.md) — spec chung;
  - [quote-tiers-dealer.md](../specs/quote-tiers-dealer.md) — vai trò tùy biến, lát A/B/C;
  - [quote-tiers-guest.md](../specs/quote-tiers-guest.md) — cổng chung, lát G-a…G-i (G-g: trợ lý AI, G-h: extras, G-i: admin loại nhà); UI/UX theo bản mẫu SSA;
  - [pages/guest-quote.md](../../design-system/smartquote-v2/pages/guest-quote.md) — override thiết kế chỉ cho trang Guest (token đỏ/navy SSA đã sửa cho đạt AA, Archivo + Inter tự host);
  - [quote-tiers-full.md](../specs/quote-tiers-full.md) — `quote_requests`, hộp thư;
  - [quote-tiers-guest-analysis.md](../specs/quote-tiers-guest-analysis.md) — phân tích Quotec, có mục "Đã chốt".
- Chưa sửa code, chưa commit.

## Quyết định đã chốt
- D-T1: vai trò tùy biến do admin công ty tạo bằng cách tick quyền. Mẫu khóa: admin, estimator, viewer, dealer. `members:manage` và `settings:manage` không cấp được qua vai trò tùy biến.
- D-T2: không có `quote:all` thì chỉ thấy quote mình tạo.
- D-T3 / G2: Guest không thấy giá (đã cân nhắc lại sau bài Quotec, vẫn giữ).
- D-T4 / G3: không đăng nhập. Bấm QUOTE thì hỏi 4 trường; mail có link ma thuật; có phiên thì lưu vào hồ sơ. Lead tới vendor ngay, nhãn "email chưa xác nhận".
- D-T5 / D-T6: cổng chung, chỉ super admin nhận; hồ sơ khách ở cấp platform theo email.
- G1: super admin chuyển lead cho một công ty (gồm 2 tenant của vendor).
- G4: trang `/quote` ở `apps/site`.
- D-T7: mọi thành viên chiếm seat.
- 2D/3D: Guest có **trang riêng** `/quote` trong `apps/site`, thiết kế riêng cho đẹp. Khách đặt cửa trên **2D** (SVG mới `GuestPlan`: chạm tường, kéo dọc tường, snap bằng core). **3D chỉ xem** ở lát G-f, chuyển 3D sang `@sq/viewer3d`. Không dùng lại component editor (`Render2D` Konva gắn `useShedStore`); editor nhân viên không đổi.

- Trợ lý AI cho Guest (đề xuất, chờ duyệt): chat + giọng nói, **một phiên = một đoạn hội thoại** mỗi thiết kế, lưu server qua cookie `sq_ga`. AI chỉ trả `GuestDesignChangeSet` đi qua cùng reducer + core với 2D; mỗi lượt một mục undo; hỏi trước khi đổi preset/kích thước làm mất cửa. Không giá, không bấm QUOTE, không PII tới model. Giọng nói nhận dạng phía server, điền vào ô nhập, không tự gửi. Hội thoại đi theo lead, chép vào `quote_requests.assistant_transcript_json` khi chuyển. Quota + công tắc env; wizard chạy được khi AI tắt.

- UI/UX Guest (2026-11-18, theo hướng dẫn + bản mẫu SSA người dùng gửi): 4 bước (từ 2026-11-18 là **4 tab**, xem dòng dưới) ① Building type · ② Your address · ③ Design (điều khiển | sân khấu 2D/3D | trợ lý) · ④ Send request; thanh tóm tắt dính. Lệch có chủ đích so với bản mẫu (mặc định, ghi ở câu hỏi mở): giữ 4 trường liên hệ (D-T4); chỉ +61; suburb từ bảng giá thay Google Places; số yêu cầu `GR-`; thẻ Skillion thay Awning; bỏ trường kỹ thuật (móng, knee brace, profile tôn).
- Duyệt bước (2026-11-18, người dùng):
  - **4 tab thay cho trang cuộn** (WAI-ARIA tabs, `?step=`, khóa ②③④ tới khi chọn loại, ③ cao vừa màn ở ≥ 1024);
  - **① loại nhà do super admin định nghĩa** ở admin `/guest-types` (bảng `guest_building_types`, version, kiểm bằng core, mặc định từ core khi chưa có dòng; capability mặc định `platform:templates`);
  - **② dùng Google Places** qua route công khai mới có chống spam: phiên tìm địa chỉ HMAC 3 phút (12 autocomplete — điểm gãy giá của Google, 1 details), giới hạn theo IP, trần ngày toàn hệ thống, `sessionToken`, công tắc `GUEST_PLACES_ENABLED`, đường dự phòng `country_surburb`;
  - **③ duyệt, phải responsive** (bảng 5 cỡ, cả điện thoại xoay ngang); **④ duyệt**.
- Web giới thiệu SSA (2026-11-18): **tách thành project Next.js riêng**, người dùng làm sau; CTA "Design & quote a shed" trỏ sang `/quote?type=…` ở subdomain. Form RFQ thép của web đó gửi đi đâu: chưa quyết. Plan G-a P16.
- Nhà cung cấp AI (2026-11-18): gateway vilao giống RFQ_PWA_SQ — SDK `openai` + `baseURL`, biến `VILAO_BASE_URL`, `VILAO_API_KEY`, `VILAO_MODEL`, `VILAO_STT_MODEL`, cộng `GUEST_ASSISTANT_ENABLED`; thêm vào `.env.example` (rỗng) và `turbo.json`. Giá trị thật chép sang `.env` local ở lát G-g, không commit, không in ra.

## Phát hiện quan trọng
- Capability được giải ở 4 chỗ (`guard.ts:49`, `auth.ts:92`, `evaluations.ts:380/383`) cộng `quotes.ts:143` so sánh tên vai trò.
- `cost:read` gộp giá bán và dữ liệu xưởng, nên phải tách `bom:read`.
- `GET /quotes/:id/revisions` (`quotes.ts:167-178`) lộ giá vốn cho viewer — **lỗi có sẵn, nên sửa sớm**.
- `evaluations.ts:452` truy vấn quote không kèm `tenant_id` — cần kiểm tra.
- 3D (`Shed3D`, `Render3D`) chỉ để xem, nằm trong `apps/client`; phải chuyển sang package dùng chung thì `apps/site` mới dùng được.
- `apps/site` chưa có bridge `app/api/...`.
- Core hỗ trợ `roller_door`, `pa_door`, `sliding_door`, `window`.
- Bảng giá `fe5a7cae…eb8.db`: `country_surburb` (16 741 dòng) dùng được cho gợi ý suburb; `misc_option` 125 dòng (insulation, bird proofing, vent…), không có whirlybird, gutter guard, Larnec.
- `COLORBOND` trong core có 30 tên (`defaults.ts:11-42`); `/places/autocomplete` đòi `quote:write` (`places.ts:59-61`) nên Guest cần route công khai riêng; transport chưa gửi `sessionToken` (`lib/places.ts:145-158`); rate limiter DB `consume()` có sẵn (`lib/rateLimit.ts`, dùng ở `enquiries.ts:121`); chưa có captcha/Turnstile.
- Màu bản mẫu: `#E83238` trên trắng 4.25:1 (trượt AA với chữ thường), `--ink-mute #7C87A0` 3.60:1 — đã thay trong override.
- Trợ lý của editor mới là vỏ UI (`AssistantPanel.tsx:43-51`, `connected=false`); API/contracts/DB chưa có gì cho trợ lý, chưa có biến env LLM/STT. Guest có thể là nơi dựng backend trợ lý đầu tiên.

## Bước tiếp
1. Người dùng duyệt spec.
2. Viết plan cho lát (A) ở `docs/plans/quote-tiers-roles.md`: tách `bom:read`, bịt hai chỗ lộ, `quoteScope`. Rồi (B) mẫu dealer, rồi (C) vai trò tùy biến (migration 019).
3. Giai đoạn Guest: G-a → G-f, G-i (admin loại nhà, cần G-a), rồi G-g (trợ lý AI, cần G-a) và G-h (extras, tùy chọn).
4. Logo SSA đã nhận (2026-11-18, `apps/site/public/brand/`, override §4a). Các mặc định lệch bản mẫu (4 trường, chỉ +61, `GR-`, Skillion) giữ tới khi người dùng đổi.
5. ~~Nghiên cứu Places~~ xong 2026-11-18. Kết quả ghi trong plan G-a mục 3:
   - 12 autocomplete đầu của phiên tính tiền, từ lần thứ 13 miễn phí khi phiên kết thúc bằng details Essentials;
   - chỉ được lưu place ID (lat/lng tối đa 30 ngày);
   - phải ghi attribution "Google Maps".
   Trần mỗi phiên đổi từ 15 xuống **12**.
6. **Plan G-a đã viết:** [docs/plans/quote-tiers-guest-ga.md](../plans/quote-tiers-guest-ga.md).
   - Migration **020** (019 dành cho `company_roles`).
   - 8 bước S1…S8.
   - Đang code (bắt đầu 2026-11-18, chưa commit).
   - Còn chưa kiểm tra: SKU của `addressComponents` (làm ở S3) và cách `isolation.test.ts` liệt kê bảng (làm ở S2).
   - Mã lỗi: plan ghi "unavailable" → dùng `not_configured` (503); "422 invalid_design" → `validation_failed` (422). `ERROR_CODES` không có mã nào khác.
7. **S1 xong (2026-11-18):**
   - `core/src/domain/presets.ts`: `PRESET_IDS`, `PresetId`, `Preset.id`, `presetById`.
   - `core/src/domain/guest.ts`: kiểu Guest thuần TS, `GUEST_DEFAULT_TYPES` (shed/garage/carport/skillion, version 0), `guestDesignFromType`, `configFromGuestDesign`, `validateGuestDesign` (khoảng, pitch chip, loại/số lượng/cỡ chip cửa, cửa không cao hơn tường — luật riêng của Guest, `placeOpening` R1/R2/R10, màu). R3 (cột infill) không kiểm vì cần bảng giá.
   - `contracts/src/guest.ts`: schema zod + DTO Places; kiểu kiểm lúc biên dịch khớp với core (`_GuestDesignAgreesWithCore`).
   - Kiểm: `build:inc`, typecheck core/contracts/client/api/site/admin sạch; `presets.test.ts` 5/5; script tạm: 4 loại mặc định 0 lỗi, `buildPlanGeometry` chạy, 3 ca sai báo đúng lỗi.
   - Cỡ chip roller/sliding mặc định: có trong catalogue bảng giá hay không **chưa kiểm tra**.
   - Bước tiếp: S2 (migration 020 + DB adapter).
8. **S2 xong (2026-11-18):**
   - `db/migrations/020_guest_requests.sql`: `guest_contacts`, `guest_requests` (+ `place_id`, `source_json`), `guest_building_types` (+ cột `description`, vì contract có mà spec chưa ghi). Không có `tenant_id`. `assistant_session_id` để tới G-g.
   - `pg/020_guest_requests.sql`: `guest_request_seq` `OWNED BY guest_requests.number`, vì lúc reset test chỉ drop bảng, không drop sequence.
   - `isolation.test.ts` chèn từng dòng cụ thể, không liệt kê bảng, nên không cần loại trừ gì. Mục "chưa kiểm tra" trong plan đã xong.
   - `api/src/routes/guest.ts`:
     - `GET /public/guest/building-types`: trả các dòng `enabled`; bảng rỗng thì trả mặc định của core.
     - `POST /public/guest-requests`: theo đúng thứ tự:
       1. giới hạn 5 lần/giờ theo IP;
       2. kiểm schema zod;
       3. honeypot `website` (trả 202 giả, không lưu);
       4. giới hạn 3 lần/ngày theo email;
       5. `validateGuestDesign`;
       6. upsert contact (không ghi đè khi email đã xác nhận) + `nextval` + insert, trong một transaction;
       7. mail gửi không chờ;
       8. trả 202 `{number}`.
   - `api/src/lib/mail/guestMail.ts`: gửi mail xác nhận cho khách và thông báo tới `GUEST_NOTIFY_TO`, nếu trống thì gửi `ENQUIRY_TO` + admin platform. Không có giá. Lỗi mail bị nuốt, promise được theo dõi bằng `trackEnquiryNotification`.
   - Đã thêm `GUEST_NOTIFY_TO` và `GUEST_REQUEST_PREFIX` vào `turbo.json` và `.env.example`.
   - Lệch so với plan:
     - thiếu email trả **422** `validation_failed` chứ không phải 400, vì `parseBody` luôn trả 422;
     - lỗi thiết kế cũng là 422 `validation_failed`, đường dẫn lỗi có tiền tố `design.`.
   - Kiểm:
     - `db:migrate` chạy (020 + 020@postgres), typecheck `@sq/api` sạch;
     - API chạy với mail tắt (`.claude/launch.json` cấu hình `api` để `SMTP_HOST`/`MAIL_FROM` rỗng);
     - kết quả:
       - building-types: 4 mặc định v0;
       - gửi hợp lệ: 202 `GR-000001`;
       - thiếu email: 422;
       - 2 cửa chồng nhau: 422;
       - honeypot: 202, không có dòng mới;
       - lần thứ 6 trong giờ: 429;
       - email lần 4 (khác hoa/thường): 429.
     - Dòng thử đã xóa, sequence đặt lại về 1.
   - **Chưa kiểm tra:** nội dung mail thật qua relay. Không gửi thử, để khỏi gửi mail thật tới admin.
   - Bước tiếp: S3 (Places công khai + suburb dự phòng).
9. **S3 xong (2026-11-18):**
   - `api/src/lib/places.ts`: transport nhận thêm `{ sessionToken }` (tuỳ chọn) cho cả autocomplete lẫn details. `withTimeout` chuyển từ `routes/places.ts` sang đây để route Guest dùng chung; route của editor không đổi hành vi.
   - `api/src/lib/guestPlaces.ts`: session ký HMAC (`uuid.hếtHạnMs.chữKý`, sống 3 phút), kiểm input, các lớp giới hạn, trần ngày của cả hệ thống, mail cảnh báo tối đa 1 lần/ngày. Thứ tự giới hạn:
     - session: 10/giờ/IP;
     - autocomplete: session đã dùng → 401; 60/giờ/IP; 200/ngày/IP; 12/session; trần ngày (`GUEST_PLACES_DAILY_AUTOCOMPLETE_CAP`, mặc định 2000) → 503;
     - details: 20/ngày/IP; 1/session (sau đó session hết hiệu lực); trần ngày (`GUEST_PLACES_DAILY_DETAILS_CAP`, mặc định 300) → 503.
   - `api/src/routes/guest.ts` thêm 4 route công khai:
     - `POST /public/guest/places/session` → 201 `{s, expiresAt}`;
     - `GET /public/guest/places/autocomplete?q&s` → tối đa 5 gợi ý;
     - `GET /public/guest/places/details?id&s` → `{details}`, hoặc `null` nếu không phải địa chỉ AU đủ suburb/bang/postcode 4 số;
     - `GET /public/guest/suburbs?q` → tối đa 10 dòng từ `country_surburb` của price book, 300 lần/giờ/IP, chạy cả khi Places tắt.
   - `config.ts`: `guestPlaces` đọc `GUEST_PLACES_ENABLED` (chỉ bật khi `=1`), `GUEST_PLACES_SESSION_SECRET`, hai trần ngày. Đã thêm cả 4 biến vào `turbo.json` và `.env.example`.
   - `pnpm ratelimits:prune` (`apps/api/scripts/prune-rate-limits.ts`): xoá các dòng `rate_limits` đã hết cửa sổ. Chạy thử: xoá 12 dòng.
   - Phát hiện:
     - `addressComponents` nằm trong SKU Essentials (đã xác minh ở S3).
     - Google giới hạn `sessionToken` ở 36 ký tự base64 an toàn URL (tài liệu REST autocomplete, cập nhật 2026-10-27), nên chỉ gửi phần uuid.
     - `country_surburb`: 16741 dòng, 1 dòng trùng, 397 postcode 3 chữ số (NT/ACT mất số 0 đầu, route đệm lại thành 4 số), tên viết hoa/thường lẫn lộn. Richmond có ở 6 bang, nên luôn trả kèm bang.
     - Tìm theo số là tìm tiền tố trên postcode đã đệm: `0800` ra Darwin, còn `800` ra các postcode 800x của VIC. Đây là hành vi chủ ý.
   - Lệch so với plan:
     - input sai (`1111`, `aaaa`, quá 100 ký tự, place id lạ) trả **422** `validation_failed`, không phải 400, vì API không có mã 400;
     - `sessionToken` gửi Google chỉ là uuid, không phải cả chuỗi đã ký (P9), vì giới hạn 36 ký tự;
     - secret chỉ bắt buộc (≥ 32 ký tự) ở production **khi đã bật** Places, để server production đang chạy không bị chặn khởi động vì một tính năng chưa bật. Ở dev, secret trống thì sinh ngẫu nhiên mỗi lần chạy;
     - đạt trần ngày trả 503 `not_configured`, trang sẽ chuyển sang danh sách suburb.
   - Kiểm:
     - typecheck `@sq/api` sạch;
     - script tạm dùng transport giả (không gọi Google), chạy với DB dev: 20/20 đạt. Kết quả:
       - tắt Places → 503 ở cả 3 route;
       - suburb `Penrith` → 2750/2751 NSW; `0800` → Darwin NT; `Richmond` → nhiều bang; `%` → rỗng;
       - session 201, lần thứ 11 trong giờ → 429;
       - session giả, sửa chữ ký hoặc hết hạn → 401;
       - `1111`/`aaaa`/quá dài → 422, và không có cuộc gọi Google nào;
       - 12 autocomplete được, lần thứ 13 → 429, tối đa 5 gợi ý, token gửi đi là uuid 36 ký tự;
       - details 200; details lần 2 hoặc autocomplete sau đó → 401;
       - trần 2 → 200, 200, 503, khoá mail cảnh báo bị dùng 1 lần.
     - Dòng `rate_limits` của lần chạy thử đã xoá.
     - API thật (launch `api`, đặt thêm `GUEST_PLACES_ENABLED=0`): session/autocomplete → 503, suburbs → có dòng, log không có lỗi.
   - **Chưa kiểm tra:**
     - gọi Google thật có `sessionToken` (để S8, qua `scripts/probe-guest-places.mjs`);
     - nội dung mail cảnh báo trần qua relay thật.
   - Bước tiếp: S4.
10. **S4 xong (2026-11-18):** khung trang `/quote` (apps/site).
   - Phụ thuộc: `@sq/core` thêm vào `apps/site/package.json` và `transpilePackages`; chỉ import `@sq/core/domain`.
   - Bridge `apps/site/src/app/api/sq/[...path]/route.ts`: chỉ cho `public/guest/*` và `public/guest-requests`, còn lại 404 `not_found`; không chuyển tiếp và không đặt cookie; chỉ GET/POST; API không trả lời → 503 `upstream_failed`. Form enquiry trên `/` vẫn gọi API trực tiếp.
   - Font: Archivo + Inter, bản variable woff2 lấy từ Fontsource 5.3.0 (Latin), có kèm OFL, nạp bằng `next/font/local` trong `app/quote/layout.tsx`. Không có request nào tới fonts.googleapis.
   - `app/quote/guest.css`: token SSA chỉ áp trong `.guest-quote`, đủ sáng/tối. Token tự suy: `--g-heading`, `--g-link`, `--g-red-text`, `--g-focus`, `--g-dot`.
   - `app/quote/store.ts`: store ngoài (`useSyncExternalStore`) giữ thiết kế, tab và nguồn utm. Lưu `localStorage` key `sq.guest.v1` trong try/catch; khi đọc lại thì kiểm bằng `guestDesignSchema`/`guestSourceSchema`.
   - Component trong `app/quote/components/`: `GuestQuote`, `GuestHeader`, `StepTabs` (WAI-ARIA, roving tabindex, kích hoạt thủ công), `StepFooter` (Start over hỏi lại bằng `<dialog>`), `icons`. Thêm `app/quote/api.ts` (`guestApi` trả `ApiResult`).
   - Panel ②③④ mới là placeholder. ① tạm là danh sách loại nhà đơn giản; S5 thay bằng TypeCard.
   - `NEXT_PUBLIC_BRAND_SITE_URL` đã thêm vào `turbo.json` và `.env.example`. Launch config `site` (cổng 3063) nằm trong `.claude/launch.json`.
   - Quyết định:
     - `?type=` chỉ áp dụng khi chưa có gì được lưu; thiết kế đã lưu thì giữ nguyên.
     - Sau khi đọc `type`/`utm_*`, URL được viết lại thành `/quote?step=X`.
     - utm trên URL thay nguồn đã lưu; Start over giữ nguồn.
     - Nav gồm 3 link theo spec (Home/Projects/Contact, giả định đường dẫn `/`, `/projects`, `/contact`), ẩn khi biến brand trống. Logo trỏ về `${BRAND}/`, hoặc `/` nếu biến trống.
     - Tab đang mở hiện số, không hiện ✓. ③ được tính là xong ngay khi có thiết kế mặc định.
     - Dưới 560px: tab và nút Next dùng nhãn ngắn ("Next: Send"); Start over chỉ còn icon, nhãn vẫn đọc được (`.g-narrow-sr`); footer còn 1 hàng nút và cao khoảng 96px. Logo link cao tối thiểu 44px.
   - Kiểm:
     - typecheck `@sq/site-app` sạch; `pnpm --filter @sq/site-app build` exit 0 (`/quote` tĩnh, bridge động).
     - Xem trên trình duyệt (launch `api` + `site`):
       - 4 tab; ②③④ có `aria-disabled` kèm gợi ý khoá cho tới khi chọn loại.
       - Chọn Shed → mở khoá, tóm tắt "Shed · 9.0 × 6.0 m", chấm cam ở ②.
       - Next → `?step=address`, focus về h2. Back/Forward theo đúng URL.
       - Tải lại giữ tab và thiết kế.
       - `?step=design` khi chưa có loại → ①.
       - `?type=garage` khi chưa lưu gì → Garage, mở ②, utm được lưu. `?type=carport` khi đã có Garage → bị bỏ qua.
       - Phím ←/→/Home/End chỉ dời focus và quay vòng; click/Enter mới mở tab.
       - Start over: dialog modal, focus vào "Keep my design"; xác nhận → khoá lại, giữ utm.
       - Ở 360px không cuộn ngang, mọi đích chạm ≥ 44px.
       - Dark mode: logo nằm trên tấm trắng, không bị đảo màu.
       - Console không có lỗi. `/` và `/s` vẫn hiển thị như cũ (401 trên `/s` không token là hành vi sẵn có).
   - Ghi chú: `next build` lần đầu đôi khi báo `SecurityFatalError` (Next 16.4.3 có lỗ hổng đã biết); chạy lại thì qua. Chưa nâng Next — chờ người dùng quyết.
   - **Chưa kiểm tra:**
     - Tốc độ tải khi pane hiện: lúc kiểm pane bị ẩn nên timer và animation bị hãm, hydrate mất khoảng 12 giây và hiệu ứng mờ dần 150ms đứng yên trong ảnh chụp.
     - Bố cục khi đặt `NEXT_PUBLIC_BRAND_SITE_URL` (nav ở ≥1024).
     - Trình đọc màn hình thật.
     - Bản production (`next start`).
   - Bước tiếp: S5.
11. **S5 xong (2026-11-18):** tab ① loại nhà, tab ② địa chỉ (apps/site, `src/app/quote/`).
   - File mới:
     - `components/TypeCard.tsx`: thẻ loại nhà, là nút `aria-pressed` có viền đỏ và huy hiệu ✓.
     - `components/SearchCombobox.tsx`: combobox WAI-ARIA 1.2 dùng chung, debounce 300ms, huỷ request cũ, ↓/↑/Enter/Esc.
     - `addressSearch.ts`: phiên Places tạo lười, `searchSuburbs`, mọi lỗi trả về giá trị.
     - `components/AddressPanel.tsx`: ô tìm địa chỉ và 4 trường sửa được.
     - `components/WindNote.tsx`: ghi chú gió, chỉ có chữ.
   - File sửa: `components/icons.tsx` (7 icon), `GuestQuote.tsx` (dùng các panel mới), `guest.css` (bỏ khối tạm của S4, thêm tab ① và ②).
   - Quyết định:
     - Phiên Places tạo ở ký tự thứ 3 và kết thúc sau khi chọn.
       - Phía client tự đổi phiên sau 12 lần gọi, hoặc khi còn 5s trước khi hết hạn.
       - 401 thì thử lại đúng 1 lần với phiên mới.
     - Ba đường vào, mỗi đường là một bậc lùi:
       1. Places.
       2. Danh sách suburb (≥ 2 ký tự). Dùng khi Places tắt/hết hạn mức/429/lỗi, kèm câu giải thích; hoặc khi khách tự chọn.
       3. Nhập tay.
     - Places đã hỏng một lần thì nhớ trong suốt vòng đời trang (biến cấp module).
     - `site` chỉ được ghi khi 4 trường tạo thành địa chỉ đủ (suburb, state, postcode 4 số). Thiếu thì xoá, để ④ vẫn báo thiếu địa chỉ. Sửa tay thì bỏ `placeId`.
     - Lỗi trường chỉ hiện sau khi rời ô (blur).
     - Không có loại nhà nào → câu "Online design is unavailable right now." kèm link `/#enquire`.
   - Kiểm:
     - typecheck sạch; `pnpm --filter @sq/site-app build` exit 0.
     - Trên trình duyệt (`GUEST_PLACES_ENABLED=0`, chỉ dùng bàn phím):
       - Chọn thẻ → mở khoá tab, tóm tắt "Shed · 9.0 × 6.0 m".
       - Next → ②, focus vào h2.
       - Gõ ký tự thứ 3 → chuyển sang ô suburb, hiện câu thông báo, focus sang ô đó.
       - "Richm" → 10 gợi ý; ↓ đổi `aria-activedescendant`; Enter điền suburb/state/postcode, `site` được lưu, chấm cam biến mất.
       - Xoá 1 số postcode → lỗi sau blur, `aria-invalid`, `site` bị xoá; gõ lại → `site` được khôi phục.
       - Esc đóng danh sách; Esc lần nữa xoá ô.
       - Ở 360px: không cuộn ngang, đích chạm ≥ 44px; state và postcode chung một hàng; thẻ loại nhà xếp dạng hàng.
       - Console: chỉ có 503 `not_configured` của phiên Places, đúng như mong đợi.
     - AC 1a và 1e đạt với đường suburb.
   - Hoãn:
     - Hộp xác nhận khi đổi loại nhà lúc cửa đã bị sửa → S6, vì cửa chưa sửa được.
     - "Or describe it to the assistant" → G-g.
   - **Chưa kiểm tra:**
     - Đường Places thật (cần key; probe ở S8).
     - Thử lại khi phiên trả 401.
     - `details` trả null.
     - Điện thoại thật / iOS.
     - Animation khi pane hiện.
     - Dark mode của tab ① và ②.
   - Bước tiếp: S6.

12. **S6 xong (2026-11-18):** tab ③ Design (apps/site, `src/app/quote/`).
   - File mới:
     - `components/DesignPanel.tsx`: lưới stage + controls.
     - `components/Stage.tsx`: tab 2D/3D; 3D là hình minh hoạ của loại nhà. Chip Ridge/Bays/Roof/Walls/Wind.
     - `components/GuestPlan.tsx`: SVG từ `buildPlanGeometry`. Chạm vách thì thêm cửa, kéo dọc vách (snap 50 mm, `moveOpening`), zoom bằng nút/pinch/Ctrl+wheel, phím mũi tên dời 100 mm, popover.
     - `components/ControlAccordion.tsx`: 3 nhóm, gồm kích thước (slider + ô số), pitch chips, bays, cửa.
     - `components/SwatchGrid.tsx`: màu theo phần, tuỳ chọn tách trim.
   - Sửa:
     - `GuestQuote.tsx`: nối tab ③. Thêm hộp "Switch to …?" khi đổi loại nhà sau khi design đã sửa (khoản hoãn từ S5).
     - `TypeCard.tsx`: export `ICONS`.
     - `guest.css`: khối "tab ③ design (S6)" đặt trước khối motion.
     - `packages/core/src/domain/guest.ts:446`: câu báo cửa không vừa vách đổi thành "no longer fits on the X wall. Move it to another wall or remove it." Câu cũ sai ngữ pháp và gợi ý một vị trí không còn hợp lệ.
   - Quyết định:
     - ≥1024: lưới `320px | 1fr`, cao `100dvh − header − tab bar`, `grid-template-rows: minmax(0,1fr)` để mỗi cột tự cuộn.
     - Landscape thấp (≤499px): 60% / 40%.
     - Cửa không còn vừa sau khi thu kích thước thì giữ nguyên chỗ và hiện trong `.g-issues`. Không tự xoá.
   - Đã kiểm tra trên trình duyệt (1280 trừ khi ghi khác):
     - Đổi span 9 → 12 m: kích thước 2D, Ridge, tiêu đề nhóm, ô số đều đồng bộ.
     - Thêm 11 cửa: không chồng nhau. Thu về 6 m: vẫn không chồng, cửa thừa được báo.
     - Carport: nhóm cửa `aria-disabled` kèm lý do; chạm vách cũng hiện lý do.
     - 360/390/768/1024/1440/844×390: không cuộn ngang (scrollWidth = clientWidth).
     - 844×390 và 1280: panel cao đúng bằng phần còn lại, cột điều khiển tự cuộn.
     - Typecheck site + core sạch.
   - Bẫy: `pnpm --filter @sq/core build` xoá `dist`, nên API (tsx watch) và Next dev lỗi tạm thời. Build xong phải khởi động lại cả hai.
   - **Chưa kiểm tra:**
     - Kéo cửa thật bằng chuột/ngón tay và pinch trên máy thật (mới thử bằng sự kiện giả và đọc code).
     - Bàn phím trên handle.
     - `pnpm build` của site.
     - Dark mode.
     - Screen reader.
     - Ảnh chụp ở từng breakpoint (mới đo bằng số).
   - Bước tiếp: S7.
13. **S7 xong (2026-11-18):** tab ④ Send và thanh tóm tắt (apps/site, `src/app/quote/`).
   - Mới:
     - `content.ts`: `GUEST_CONTENT` (thời gian trả lời "2 business days", các bước "What happens next", câu consent). Câu chữ này là cấu hình nội dung, không nằm trong component.
     - `summary.ts`: các hàm `summaryLine`, `shortLine`, `summaryRows` (6 dòng, mỗi dòng có tab và selector để focus) và `missingSteps`.
     - `components/SendPanel.tsx`:
       - bảng "What you're sending", "What happens next", form 4 field + note + consent + honeypot `website`;
       - error summary ở đầu form, lỗi cạnh field (`aria-describedby`);
       - mobile nhập dạng +61, đổi sang E.164;
       - nút Send có spinner;
       - màn xác nhận có số GR.
     - `components/SummaryBar.tsx`:
       - `SummaryBar` (≥768, nằm trong thanh tab) có popover "Design summary";
       - `PhoneSummaryBar` (<768, dính đáy, `env(safe-area-inset-bottom)`), ẩn khi bàn phím mở (`visualViewport`, ngưỡng 150px) và ẩn ở tab ④.
   - Sửa:
     - `store.ts`: thêm `contact`, `sent` và `revisionOf`. `revisionOf` được lưu cùng design; contact và sent chỉ nằm trong bộ nhớ, không vào localStorage. Thêm `updateContact`, `markSent`, `keepDesigning` và `editAt` / `takePendingFocus` / `focusSelector` cho các link Edit. Sửa design sau khi đã gửi thì tính như Keep designing.
     - `StepTabs.tsx`: tab còn thiếu có chấm cam và chữ sr-only.
     - `ControlAccordion.tsx`: thêm id `g-group-colours` và `g-group-doors` làm đích focus.
     - `GuestQuote.tsx`: nối tab ④ và hai thanh. Nút Send của thanh đi tới tab đầu tiên còn thiếu.
     - `icons.tsx`: thêm `IconList`.
     - `guest.css`: thêm khối "tab ④ send, summary bar (S7)" trước khối motion.
     - `apps/api/src/routes/guest.ts`: khi mail tắt, ghi log `guest request mail skipped: mail is not configured` kèm số GR. Trước đó không có dòng nào, nên một email không tới trông như một lead bị mất.
   - Quyết định:
     - Breakpoint thanh tab: nhãn dài từ ≥1100 (trước là 900). Chữ "Your design …" của thanh tóm tắt chỉ hiện từ ≥1280. Nút "Design summary" chỉ còn icon dưới 1024 (tên vẫn có qua chữ sr-only). Nếu không làm vậy thì 768–1279 bị cuộn ngang hoặc tab "Send request" bị cắt.
     - Gửi lại sau Keep designing tạo một lead mới, note bắt đầu bằng "Revised design of GR-…".
     - Hoãn: prefill từ `sq_guest` sang G-b, dòng "extras" sang G-h.
   - Đã kiểm tra trên trình duyệt (API với mail tắt, `GUEST_PLACES_ENABLED=0`):
     - Gửi thật qua bridge: GR-000001, rồi bản sửa GR-000002 có note "Revised design of GR-000001.". DB có đúng các dòng đó, mobile lưu `+61412345678`, chỉ 1 guest_contact. API ghi dòng log mail skipped.
     - Honeypot: trả 202 kèm số giả (GR-682104), không tạo dòng. Email thứ 4 trong ngày bị 429 (email limit). Yêu cầu thứ 6 trong giờ từ cùng IP bị 429 (IP limit). GR-000003 là yêu cầu thử rate limit.
     - Form trống: hiện 5 lỗi, focus nhảy vào error summary. Nhập mobile 02… thì lỗi nằm dưới field và `aria-invalid`.
     - Link Edit mở đúng tab và focus đúng field, mở luôn `<details>` chứa nó. Escape đóng popover và trả focus về nút.
     - AC 2: gõ "Ballar" ở đường dự phòng, chọn Ballarat → field thành VIC 3350.
     - AC 3: rộng 7.5 m → nhãn 2D và thanh tóm tắt đổi cùng lúc.
     - AC 8: mobile sai báo lỗi → sửa → xác nhận có số → Keep designing giữ design và làm trống form.
     - Không cuộn ngang ở 360, 390, 768, 900, 1024, 1100, 1280, 1440 và 844×390. Thanh điện thoại dính đáy ở 360/390 và biến mất ở ④.
     - Dark mode ở ④ (390): xem nhanh, ổn.
     - Typecheck site sạch. `pnpm --filter @sq/site-app build` chạy được. Grep `.next/static`: không có `contractCents`, `priceCents`, `costCents`; mọi `$` + số đều là `$0`/`$1` của regex.
   - Ghi chú: `next build` in cảnh báo lỗ hổng bảo mật của Next đang dùng và lần đầu dừng lại. Chạy lại thì build tiếp. Chưa nâng cấp Next, việc đó để người dùng quyết định.
   - **Chưa kiểm tra:**
     - Mail thật khi mail bật (`sendGuestRequestMail`).
     - Ẩn thanh khi bàn phím mở trên máy thật.
     - UI hiển thị lỗi 429 (mới kiểm ở API).
     - Nút "Start a new design" trên màn xác nhận.
     - Screen reader.
     - Spinner với `prefers-reduced-motion`.
   - Bước tiếp: S8.
14. **S8 xong (2026-11-18):** E2E, probe Places, tài liệu vận hành.
   - Quyết định của người dùng (2026-11-18): Places của trang Guest **luôn bật** (`GUEST_PLACES_ENABLED=1` trong `.env`, `.env.example`, `.claude/launch.json`). E2E không tắt nó mà stub 3 route Places trong trình duyệt (503 `unavailable`) để đi đường dự phòng suburb.
   - Mới:
     - `e2e/guestQuote.spec.ts` + project `guest` trong `playwright.config.ts` (baseURL 3063, không storageState, viewport 1440×950 đặt riêng vì `devices['Desktop Chrome']` ghi đè). Desktop: bước 1–6 và 8 của kịch bản đầu cuối, gửi 1 lead thật (note "E2E — automated test request, please ignore.", email `test.guest+e2e<ms>@example.com`). Điện thoại 390: cùng thiết kế, không cuộn ngang, dừng ở lỗi mobile phía client, không gửi.
     - `scripts/probe-guest-places.mjs`: 1 session + 3 autocomplete + 1 details qua API, in số lệnh gọi, không bao giờ thấy/in key. Chạy tay, không chạy vòng lặp/CI.
     - `docs/OPERATIONS.md` §8: bật switch, giới hạn key (chỉ Places API (New), giới hạn theo **IP** máy chủ — referrer không áp dụng vì gọi từ server), quota ngày và budget alert trên Google Cloud, các giới hạn của app, dọn `rate_limits` (`pnpm ratelimits:prune`, xoá đúng một key, không truncate).
     - `docs/FEATURE-COVERAGE.md` mục 6: trang Guest.
   - Sửa lỗi sản phẩm: `AddressPanel.tsx` — focus sau khi đổi chế độ (Places → suburb, nhập tay) chạy trong `useEffect` sau commit thay cho `requestAnimationFrame`. Trước đó focus đôi khi rơi về trang (E2E bắt được).
   - Kiểm:
     - `npx playwright test --project guest`: 2/2 đạt (14:42Z). Tạo GR-000004.
     - Probe: 5 lệnh gọi, "1 Sturt Street Ballarat" → 1 Sturt Street | Ballarat Central VIC 3350.
     - `pnpm build` 8/8, `pnpm typecheck` 12/12 (đã dừng dev server trước vì `next build` ghi đè `.next`).
     - Test: api 349/349, core 1129, db 21, contracts 15, client 82. Lần chạy api đầu có 2 lỗi khi chạy cùng lúc với bộ `@sq/db`; chạy lại riêng thì xanh — **chưa kiểm tra** tên test và nguyên nhân.
     - AC 1d: script trình duyệt đo mọi nút chữ hiển thị (gộp lớp nền bán trong suốt, tắt transition khi đo) ở 4 tab, các group mở hết, listbox suburb, form có 5 lỗi, hộp thoại đổi loại nhà. Sáng: thấp nhất 5.41:1; tối: 5.43:1; không cặp nào dưới ngưỡng. Lưu ý: đổi theme khi trang đang chạy thì `.g-btn` (transition `color`) bị đo ở màu cũ — phải tải lại trang.
   - Giới hạn tốc độ: mỗi lần chạy E2E dùng 1 trong 5 lần gửi/giờ của IP. Chạy >5 lần/giờ thì 429 — đó là limiter, không phải lỗi trang.
   - Không làm: repo không có file CHANGELOG (chưa tạo); `smartquote-quote-editor-reference.md` không có mục Guest.
   - **Chưa kiểm tra:**
     - Contrast của màn "Request received" đo trực tiếp (chỉ suy từ token đã đo: heading/ink trên surface).
     - Quota và budget alert trên Google Cloud thật (tài liệu mô tả, chưa cấu hình).
     - Mail thật khi mail bật.
   - Bước tiếp: G-a xong cả 8 bước. Còn lại: người dùng review và quyết định commit; sau đó G-b (prefill `sq_guest`) theo `docs/specs/quote-tiers-guest.md`.

15. **Yêu cầu khách mới (2026-11-19):** phân tích ở `docs/specs/quote-tiers-guest-customer-gap.md`; plan thực thi `docs/plans/quote-tiers-guest-ga2.md` (G-a2 S0–S6, G-f S7–S8, G-g S9–S12). Q1–Q8 đã chốt 2026-11-19 (cả 8 theo đề xuất). Chưa sửa code.

16. **G-a2 S0 xong (2026-11-19):**
   - **S0.1 carport bay:** `view_system_shed_parameters` có 6 dòng, **cả 6** `bay_spacing_min = 1000`, `bay_spacing_max = 4000`; `config_shed` 6 dòng đều 1000/4000. Carport (`shed_parameters` NULL) **không có dòng config nào** → sổ giá không cho carport giới hạn bay. Desktop cũng chặn 4 m: `ServiceStructureData.cs:313` `shedConfigs.Select(x => x.BayMax).Max() : 4000` (đoạn code không bị comment). Ghi vào bảng Q6.
   - **S0.2 preset hangar:** `packages/core/src/domain/presets.ts` **không** có preset nào `structureType: 'aircraft_hangar'`; chỉ có `StructureType` ở `types.ts:57` và mã `GB_AH` (`types.ts:83`). → S1 thêm preset.
   - **S0.3 SKU Places:** `location` là **Place Details Essentials**, cùng tier `addressComponents`/`formattedAddress` ⇒ **không tăng SKU**, không cần hỏi người dùng. Ghi `docs/research/places-location-sku.md` kèm nguồn.
   - Bước tiếp: S1.

17. **G-a2 S1 xong (2026-11-19):** core + contracts lên v2.
   - `core/src/domain/guest.ts` viết lại: `GuestBuildingSpec` (span, height, pitchDeg, roof, **bayWidths[]**, slab, kneeBrace, cladding); `GuestDesignInput.v = 2` dùng `building` thay `size`; `GuestBuildingTypeConfigSpec` thêm `mode`, `enclosure`, `roofs`, `pitchesByRoof`; `GuestIcon` thêm industrial/arena/hangar/house.
   - `GUEST_DEFAULT_TYPES` = 6 loại đúng bảng 3.1: garage, industrial, riding_arena, aircraft_hangar, carport, house. `GABLE_PITCHES = [10,15,20,25,30]`, `SKILLION_PITCHES = [5,10]`. Carport = 1 × 5900 mm, slab `footing_only`; garage = 6.00 × 3.00 × 6.00. Kích thước Industrial/Arena/Hangar ghi rõ trong comment là **đề xuất**, chưa xác nhận với khách.
   - Hàm mới: `upgradeGuestDesign` (đọc v1 → v2, rác → null), `addBay`/`setBayWidth`/`removeBay`/`setRoof` (thuần, không mutate, giữ cửa), `guestReviewFlags` (pitch/bay/span), `guestSiteEstimate` (enquiry → null), `guestStructureType` (map mái → structure engine, gồm `aircraft_hangar`), `guestLengthMm` = tổng bay.
   - `configFromGuestDesign` nay đặt `structureType`, `bayWidths`, `bays = bayWidths.length`, `nomBaySpacing = bayWidths[0]`; **bỏ** `delete config.bayWidths`; cladding `horizontal` → 4 option `horizontal_cladding` (mỗi tường, 0→height).
   - `presets.ts`: thêm `aircraft_hangar` (`GB_AH`, gable Z150), `PRESET_IDS` 5 phần tử.
   - `contracts/src/guest.ts`: zod twin của mọi kiểu mới; `guestRequestBody` thêm `additionalRequest` (4000) + alias `notes`; `GuestPlaceDetails.windRegion`; 5 assert khớp core.
   - Kiểm: `@sq/core build` + `@sq/contracts build` sạch; typecheck core/contracts sạch; script (6 loại × 2 mái) 0 lỗi, carport cờ `bay`, house enquiry 0 lỗi + estimate null, v1 upgrade đúng, rác → null; `@sq/core test` **1129 passed / 16 skipped**.
   - **Chưa kiểm:** api/site còn dùng kiểu v1 nên typecheck hai app đó sẽ đỏ tới S2–S5.
   - Bước tiếp: S2.

18. **G-a2 S2 xong (2026-11-19):** vùng gió ước tính + migration 021 + route nhận v2.
   - **Nghiên cứu:** `docs/research/wind-regions-as1170-2.md`. Geoscience Australia công bố shapefile *1170.2 Wind Regions for Australia* (`as1170windzones.shp`, 20 đa giác, 1 672 249 đỉnh, mã **A0–A5/B1/B2/C/D** — trùng từ vựng ShedSafe). GA ghi "not for design purposes", "has not been formally endorsed by Standards Australia", **"Licence: Not Specified"** ⇒ ghi thành điểm mở, người dùng quyết.
   - **Đo thật (point-in-polygon cục bộ trên dataset đầy đủ):** Brisbane CBD → **B1**, Sydney → A2, Melbourne → A5, Perth → A1, Darwin/Cairns → C, Port Hedland → **D**, Hobart → A4, Alice Springs → A0. Khớp "Region B" của khách cho Brisbane.
   - **Tốc độ gió:** Bảng 3.1 paywall, không kiểm được 45 m/s là V_R hay V_des ⇒ **không in m/s**, đúng luật dừng ở S2. `windSpeedMs` để trống.
   - `core/src/domain/windRegionData.ts`: 77 vòng / **1 980 đỉnh** / 29 KB, rút từ dataset bằng Douglas–Peucker 0.05° + bỏ vòng < 1 km² + làm tròn 2 chữ số. Header ghi cách tái lập.
   - `core/src/domain/windRegion.ts`: `estimateWindRegion(lat,lng)`, `inWindRegionExtent`, `BOUNDARY_MARGIN_DEG = 0.08` (≈8,9 km), `COAST_FALLBACK_DEG = 0.2`. **Từ chối trả lời gần biên giữa hai chữ** (không phải gần bờ biển — bờ biển cũng là biên trong dữ liệu, nên đo margin chỉ với vòng khác chữ; nếu không mọi thành phố ven biển trả null).
   - **Đo:** 20/20 thành phố khớp dataset đầy đủ; 42 thị trấn thật chỉ 1/42 bị từ chối (Kununurra, sát biên C); 4 000 điểm ngẫu nhiên 97,4 % khớp (lệch đều trong ~10 km của biên); **0,05 ms/lần tra** sau lần đầu (4 ms).
   - **Test mới** `core/src/domain/__tests__/windRegion.test.ts`: 7 ca, gồm 20 thành phố, biên, ngoài AU, NaN/Infinity, dải ven biển.
   - `apps/api/src/lib/places.ts`: field mask thêm `location` (cùng tier Essentials, **không tăng SKU** — `docs/research/places-location-sku.md`); `ResolvedAddress` có `lat`/`lng` nội bộ; `splitAddress` nhận `location`.
   - `apps/api/src/lib/guestPlaces.ts`: `toGuestPlaceDetails` trả `windRegion` suy từ toạ độ; toạ độ **không** rời server.
   - `packages/db/migrations/021_guest_site_estimate.sql`: `site_estimate_json`, `review_flags`. Đã chạy `pnpm db:migrate` → `+ 021_guest_site_estimate applied`.
   - `apps/api/src/routes/guest.ts`: tính lại `siteEstimate` + `reviewFlags` ở server (`windRegionFor` gọi lại details theo `place_id`, mọi lỗi → `null`); lưu hai cột; `additionalRequest` (alias `notes`); mail nhận `estimate`/`reviewFlags`.
   - `apps/api/src/lib/mail/guestMail.ts`: khối thiết kế v2 (bays có từng chiều, roof, slab, bracing, cladding); `describeReview` **chỉ ở mail nội bộ** (ước tính + cờ), mail khách không có.
   - **Kiểm:**
     - `pnpm --filter @sq/contracts build` + `@sq/core build` sạch; typecheck core/contracts/api sạch.
     - `@sq/core test`: **1136 passed / 16 skipped**.
     - `@sq/api test` trên Postgres: **349/349** (lần đầu 1 fail `isolation.test.ts` document route 5 s; chạy riêng 9/9 xanh, chạy lại cả suite 349/349 ⇒ flake có sẵn, không do S2).
     - curl: payload v2 → **202 GR-000005**; payload v1 → **422 validation_failed** (plan ghi 400, nhưng `ERROR_CODES` của dự án dùng `validation_failed`; đã ghi ở mục 6 checkpoint trước).
     - DB: GR-000005 có `notes` = additionalRequest, `site_estimate_json` = `{"buildingClass":"10a","enclosure":"enclosed","importanceLevel":2,"region":null}` (không có placeId nên không có vùng — đúng), `review_flags` null.
   - `.gitignore`: thêm `ga_windregions.zip`, `ga_windspec.pdf` (đầu vào nghiên cứu, 18 MB).
   - **Chưa kiểm:** một lead thật có `place_id` để thấy `region` khác null trong DB (cần Places thật, và switch đang bật nhưng cần key; curl không có placeId).
   - **Chưa làm:** site (`apps/site`) còn dùng kiểu v1 nên typecheck site sẽ đỏ tới S3–S5.
   - Bước tiếp: S3.

19. **G-a2 S3–S5 xong (2026-11-19):** trang guest chuyển sang 3 bước.
   - **S3 store** (`apps/site/src/app/quote/store.ts`): `STEPS = ['start','design','send']`; `?step=type|address` cũ → `start`; `hydrate` gọi `upgradeGuestDesign` (v1 → v2); `stepLocked` giờ cần type + contact (type `enquiry` khoá `design`); `updateContact` giữ contact (không persist — Q2); `contactStarted`/`contactValid`.
   - **S4 StartPanel** (`components/StartPanel.tsx` mới): 4 section — 6 thẻ loại (TypeCard + icon mới industrial/arena/hangar/house trong `icons.tsx`), ô địa chỉ **duy nhất** (AddressPanel viết lại: chọn gợi ý bắt buộc, có nút Change, fallback suburb/manual), SiteEstimate (thay WindNote: "Region B · 10a Enclosed · Importance Level 2" kèm "Indicative — confirmed in your quote", không m/s, house không hiện), contact grid (+61 cố định, autocomplete đúng). Nút Continue → design hoặc send với house.
   - **S5 ControlAccordion**: SizeControls mới — W/H (step 0.1), Length read-only (tổng bay, link cuộn tới bays), Roof segmented (Gable/Skillion theo `roofs` của loại), Pitch chips theo `pitchesByRoof`, Slab radio (In/On/Footing Only), Knee Brace radio (có chú thích "Final bracing is set by engineering"), Cladding radio (Vertical/Horizontal), **Bay Spacing**: danh sách từng bay (input 2 lẻ, xoá, thêm bay) qua hàm core `addBay`/`setBayWidth`/`removeBay` + `refitOpenings`.
   - **S6 SendPanel**: bỏ form liên hệ, chỉ tóm tắt read-only (với nút Edit trỏ về Start), Additional Request (dùng chung state), consent, Send.
   - **Kiểm:** `@sq/site-app typecheck` sạch; trang http://localhost:3063/quote 200 và hiện "Start your quote".
   - **Chưa kiểm:** e2e guest cũ sẽ hỏng (luồng 4 bước cũ) — sửa ở S6; chạy tay đầy đủ qua trình duyệt.
   - Bước tiếp: S6.

20. **G-a2 S6 xong (2026-11-19) — HẾT G-a2.**
   - **E2E viết lại** `e2e/guestQuote.spec.ts` cho 3 bước: desktop gửi **một lead thật**, phone 390 px đo overflow và dừng trước Send. Stub 3 route Places như cũ (503), đi đường suburb.
     - Kết quả: **2/2 passed (9,0 s)**.
     - Sửa test theo thực tế UI: thanh mobile dùng `shortLine` (không có mái/bays); nhãn nút là "Continue to Build"/"Next: Send" ở mobile và "Building"/"Send request" ở desktop; thông báo fallback lấy từ `addressSearch.ts` ("type your suburb instead"); nhãn consent trùng chữ với thông báo lỗi nên phải scope `.g-field-error`.
   - **Lỗi SẢN PHẨM tìm được nhờ E2E:** "Keep designing" xoá liên hệ rồi `goTo('design')` bị khoá theo liên hệ ⇒ khách rơi lại ①, thiết kế mắc kẹt. Sửa `store.ts` `keepDesigning` — **giữ** liên hệ (v1 xoá vì form nằm ở bước cuối; nay nó là thứ mở khoá ②).
   - **Tài liệu:**
     - `docs/specs/quote-tiers-guest.md`: khung "Cập nhật 2026-11-19" ghi D-T4 đã đảo, 6 loại, 3 bước, dòng gió, trỏ tới KNOWN-DEVIATIONS 53–57.
     - `docs/KNOWN-DEVIATIONS.md` **dòng 53–57**: 5° skillion (Q4), carport 5,90 m (Q6), Footing Only chưa map, vùng gió ước tính, **licence dataset GA "Not Specified" — OPEN, người dùng quyết**.
     - `docs/FEATURE-COVERAGE.md` mục 6 viết lại theo 3 bước, có số đo kiểm tay.
     - `docs/OPERATIONS.md` §8 thêm mục "The wind region the page shows (estimated, not certified)".
   - **Kiểm toàn workspace:**
     - `pnpm typecheck`: **12/12** (client, api, site, admin sạch).
     - `pnpm build`: **8/8**.
     - `@sq/core test`: 1136 passed / 16 skipped. `@sq/api test` (Postgres): **349/349**.
     - Chạy tay trong trình duyệt (localhost:3063): 6 thẻ loại; chọn Garage → suburb Brisbane QLD 4000 → dòng "Wind region confirmed in your quote · 10a Enclosed · Importance Level 2"; liên hệ + nút Continue bật; bước Building đủ 8 mục; đổi Skillion → pitch chips 5/10; 5° hiện cảnh báo; thêm bay → 3 bays; gửi → **GR-000006**; DB: `review_flags: ["pitch"]`, `bayWidths: [3000,3000,3000]`, `roof: skillion`, `pitchDeg: 5`. Class 1 House → nút "Continue to Send request", ẩn dòng gió. 375 px: `scrollWidth 360 < 375`, không cuộn ngang.
   - **Chưa kiểm:** mail thật khi `sendGuestRequestMail` chạy (mail chưa cấu hình ở máy này); một lead có `place_id` thật để `site_estimate_json` mang chữ cái (curl không có placeId, và Places thật đang lỗi 403 phía Google); contrast đo tự động cho các khối mới (chỉ suy từ token đã đo trước đó).
   - **Bước tiếp: G-f (S7–S8) — chờ người dùng review G-a2 trước.**

21. **Cổng về một file (2026-11-19, yêu cầu người dùng):** "đặt port vào file start/stop 3062 3063 3064 … cho khỏi trùng".
   - **Bối cảnh:** cổng nằm rải ở 6 chỗ (`.env` `API_PORT` + 3 `*_ORIGIN`, mỗi `package.json` của 3 app, 2 file `.bat`, 8 file đọc `API_BASE_URL`). Đổi một cổng phải sửa 6 file, và sai một chỗ cho ra "The quote service is not answering" — không nói cổng nào.
   - **Một nguồn:** `start/ports.env` (`API_PORT`, `CLIENT_PORT`, `ADMIN_PORT`, `SITE_PORT`). Header ghi luật: 1024–65535, bốn số khác nhau, `KEY=VALUE`, không nháy.
   - `start/start-306.bat`: đọc `ports.env` trước mọi việc; **từ chối** cổng không phải số hoặc trùng nhau (không phải để bốn dịch vụ lỗi lần lượt); suy ra `API_ORIGIN`/`CLIENT_ORIGIN`/`ADMIN_ORIGIN`/`SITE_ORIGIN`, `API_BASE_URL`, `NEXT_PUBLIC_API_BASE`; kiểm cổng bận theo biến; banner và lệnh mở trình duyệt dùng `%CLIENT_ORIGIN%`.
   - `start/stop-306.bat`: đọc cùng file, nên đổi cổng rồi vẫn dừng đúng tiến trình.
   - **Giá trị trong shell thắng file** (`if not defined`), nên override một lần vẫn chạy. Đã đo: `CLIENT_PORT=3099` từ shell → origin `localhost:3099`.
   - `scripts/next-port.mjs` (mới): ba app Next bỏ `--port` cứng khỏi `package.json`, gọi `node ../../scripts/next-port.mjs dev CLIENT_PORT 3061`. Lý do: **`--port` trong package.json thắng `PORT` của môi trường**, nên launcher xuất cổng mà app vẫn nghe cổng cũ. Resolve `next` từ `process.cwd()/node_modules/next` (workspace root **không** có `next`, chỉ có trong `apps/*/node_modules`).
   - `apps/api/src/config.ts`: **`serviceOrigins(env)`** suy origin từ cổng khi `*_ORIGIN` để trống; `ApiConfig.origins`; production **từ chối** nếu không có `CLIENT_ORIGIN` lẫn `CLIENT_PORT` (thay vì lặng lẽ dùng localhost).
   - `packages/contracts/src/endpoints.ts` (mới): `resolveApiBaseUrl(explicit, apiPort)`; 8 file bridge dùng nó thay chuỗi `http://localhost:3060/api/v1`. Nhận **chuỗi** chứ không đọc `process.env`, vì client component chỉ thấy biến `NEXT_PUBLIC_*`.
   - `app.ts`/`server.ts` dùng `config.origins.site` / `config.origins.client` thay đọc env.
   - `turbo.json`: thêm `CLIENT_PORT`, `ADMIN_PORT`, `SITE_PORT`, `API_ORIGIN`, `CLIENT_ORIGIN`, `ADMIN_ORIGIN`, `SITE_ORIGIN` vào `globalPassThroughEnv` (thiếu thì Turbo lọc mất và mọi app về mặc định).
   - Tài liệu: README (mục cổng), CLAUDE.md (bảng cổng), `.env.example` (`*_ORIGIN` thành tuỳ chọn, ghi rõ suy từ cổng).
   - **Kiểm thật:**
     - `SITE_PORT=3973 pnpm dev` trong `apps/site` → "Local: http://localhost:3973", `/quote` **200**.
     - `serviceOrigins({SITE_PORT:'3973'})` → `site: http://localhost:3973`; `loadConfig` → `allowedOrigins` có `http://localhost:3973`.
     - Bridge qua 3973 → `/api/sq/public/guest/building-types` **200** (API 3060).
     - `SITE_ORIGIN` khai báo tường minh thắng cổng và cắt `/` cuối.
     - `pnpm typecheck` **12/12**; `pnpm build` **8/8**; `@sq/api test` **349/349** (lần đầu 1 flake PDF `isolation.test.ts`, chạy lại xanh — đã gặp trước đó); e2e guest **2/2**.
   - **Chưa kiểm:** chạy `start-306.bat` thật từ Explorer (đã kiểm phần đọc `.env` bằng `.bat` tạm trên cùng cú pháp); cổng 3064+ cho dịch vụ thứ năm (không có dịch vụ nào).

22. **Cloudflare Tunnel cho QA (2026-11-19, yêu cầu người dùng):** `cloudflared tunnel --url http://localhost:****` trong `start/`.
   - `scripts/tunnel.mjs` (mới): chạy `cloudflared tunnel --url http://localhost:<port>` cho từng dịch vụ (mặc định cả 4, hoặc `api|client|admin|site`), đọc địa chỉ `https://*.trycloudflare.com` từ stdout/stderr, in bảng, ghi `start/tunnel-urls.txt` (đã gitignore). **Đọc cổng từ `start/ports.env`** nên tunnel trỏ đúng cổng đang dùng. Ctrl+C đóng mọi tunnel.
   - `start/tunnel.bat` (mới): kiểm `cloudflared` có trên PATH, đọc `ports.env`, chạy script. **Không tham số = cả 4, phải gõ YES** — vì tunnel client/admin đặt màn hình đăng nhập lên internet công khai.
   - `apps/{site,client,admin}/next.config.ts`: **`allowedDevOrigins: ['*.trycloudflare.com']`**. Không có nó Next 16 dev chặn request `/_next/*` từ host lạ (đọc `block-cross-site-dev.js`: chỉ cho `localhost` + `allowedDevOrigins`), nên link tunnel ra trang **không có JavaScript** mà không nói tại sao. Chỉ mở đúng domain tunnel, không mở cả `trycloudflare.com`.
   - Tài liệu: README "Public link for QA", CLAUDE.md thêm lệnh, `.gitignore` bỏ qua `start/tunnel-urls.txt`.
   - **Kiểm thật:** `node scripts/tunnel.mjs site` → `https://entity-ready-leone-flashers.trycloudflare.com`; curl `…/quote` **200**, curl `…/api/sq/public/guest/building-types` **200** (JSON 6 loại); **mở bằng trình duyệt qua link tunnel**: `.g-type-card` = **6**, `.g-start-section` có (hydrate đủ), thanh bước hiện đúng. `pnpm typecheck` **12/12**.
   - **Hai điều script in ra và vì sao cần:**
     - API có CORS allow-list tường minh (không wildcard), nên host tunnel phải được khai `SITE_ORIGIN`/`CLIENT_ORIGIN`/`ADMIN_ORIGIN` **rồi khởi động lại** — script in sẵn dòng `set …` để dán.
     - Trang guest khi public cần `GUEST_PLACES_SESSION_SECRET` (32+ ký tự) — API từ chối khởi động nếu thiếu, thay vì ký bằng secret dev.
   - **Chưa kiểm:** tunnel cho client/admin (đã có `allowedDevOrigins` nhưng chưa mở thử vì đó là bề mặt đăng nhập công khai — cần người dùng quyết); tunnel + đăng nhập thật qua Postgres trên một máy khác.

23. **G-f S7 xong (2026-11-19):** tách `@sq/viewer3d`.
   - `packages/viewer3d` (mới): `ShedViewer` (Canvas + camera + OrbitControls + đèn + nền), `camera.ts` (`cameraFrameFor`, `FOV`, `GROUND_SIZE`, `SHADOW_MAP_SIZE`), `Shed3D.tsx` (`buildWallShape`, `buildOptionMeshes`), `PartMesh`, `StudioEnvironment`, `useSheetingTexture`, `useContainerSize`, `useMediaQuery`. Peer deps **đúng bản client dùng**: three 0.186.1, @react-three/fiber 9.8.1, drei 10.7.9, react 19.3.1. tsup external cả ba + `@sq/core`, JSX automatic.
   - `apps/client`: `Render3D.tsx` còn **vỏ mỏng** — đọc `useShedStore`, `withDimensions`, empty state, rồi `<ShedViewer>`. Xoá `components/editor/Shed3D.tsx` và `components/three/`; `hooks/useContainerSize.ts` + `hooks/useMediaQuery.ts` thành **re-export** từ package (một nguồn, `ControlSheet`/`Render2D` vẫn dùng). `DemoView`/`DemoBuilding` trỏ sang package. `cameraFrame.test.ts` chuyển vào package (16 test).
   - `transpilePackages` của client + site thêm `@sq/viewer3d`; site thêm deps three/R3F/drei + `@types/three`.
   - **AC 1a — hành vi editor không đổi:** `npx playwright test --project chrome -g "the 3D view draws"` → **pass** (2,5 s setup + 6,3 s test + teardown). Không sửa file nào khác trong `apps/client/src/components/editor/` ngoài `Render3D.tsx`.
   - **Kiểm:** `@sq/viewer3d test` **16/16**; `@sq/client-app test` **66/66**; `pnpm typecheck` **14/14**; `pnpm build` **9/9**.
24. **G-f S8 xong (2026-11-19):** 3D trên trang guest.
   - `apps/site/src/app/quote/components/Stage.tsx` viết lại: `ShedViewer` nạp bằng `next/dynamic({ssr:false})`; **3D là tab mặc định khi máy có WebGL** (dò `webgl2`/`webgl`/`experimental-webgl`), không có thì ở lại 2D + một câu giải thích; nút **Hide roof / Show roof** và **Reset view**; `touchAction: none` để kéo xoay không cuộn trang; `config = withDimensions(configFromGuestDesign(design, type))` memo theo `design` nên mọi điều khiển và thao tác kéo trên 2D đều cập nhật 3D.
   - `guest.css`: `.g-stage-3d` (khung, min-height 320), `.g-stage-tools`, `.g-stage-3d-loading`, `.g-stage-3d-note`.
   - **Kiểm thật trong trình duyệt (localhost:3063):** tab "3D model" `aria-selected=true`; canvas **847×602** (không phải 300×150); bấm "Hide roof" → ảnh vùng canvas **đổi hẳn** (67.908 → 84.651 byte, khác nhau) ⇒ mô hình vẽ thật; "Show roof" xuất hiện lại.
   - **E2E mới** trong `e2e/guestQuote.spec.ts`: "the 3D tab is the default and draws the building" — kiểm tab mặc định, canvas > 400×250, hai ảnh khác nhau sau Hide roof, và 2D vẫn vẽ. **`--project guest` 3/3 passed.**
   - **Đo dung lượng:** trang `/quote` tải three.js chỉ khi mở tab 3D (`ssr:false` + dynamic import).
   - **Chưa kiểm:** mobile thật 375 px với WebGL (mới kiểm 390 px qua e2e, canvas có hiện nhưng chưa nhìn bằng mắt); `prefers-reduced-motion` (không có tự xoay nên không áp dụng).
   - **Bước tiếp: G-g S9 — "Design check" bằng luật core.**

25. **G-g S9 xong (2026-11-19):** "Design check" — luật, không cần model.
   - `packages/core/src/domain/guestAssessment.ts` (mới): `assessGuestDesign(design, type, estimate) → AssessmentItem[]`, mỗi mục `{level: 'ok'|'note'|'review', title, detail, focus?}`. Luật: 5° skillion dưới sổ (Q4), bay > 4 m (Q6), span ngoài sổ, Footing Only (Q5), mở cửa sát góc (cần cột), knee brace "if possible", Roof Only, **vùng gió C/D → "cyclonic-rated frame"**, và các xác nhận "trong sổ". Loại `enquiry` trả đúng một dòng.
   - **Không có giá** trong bất kỳ mục nào — có test khẳng định điều đó.
   - `apps/site/.../DesignCheck.tsx` (mới) + `DesignPanel` chèn dưới controls; bấm một mục có `focus` thì `focusSelector` nhảy tới đúng điều khiển. Badge "1 to check" / "Nothing to flag".
   - Store thêm `estimate` (vùng gió đã ước tính, in-memory) để thẻ ② nói cùng vùng với ①; `AddressPanel`/`SiteEstimate` đọc từ store.
   - **Kiểm:** `packages/core/.../guestAssessment.test.ts` **13/13**; trình duyệt thật: thẻ hiện `badge "1 to check"`, mục 5° ở mức review, 1 nút bấm được.
26. **G-g S10 xong (2026-11-19):** trợ lý, phía API.
   - **Core** `guestOps.ts`: `GuestOp` (16 thao tác) + `applyGuestOps(design, type, ops) → {design, failures, applied}`. Thao tác sai **không dừng** các thao tác còn lại; `setType` bị từ chối (đổi loại là quyết định của người). Không có "set cả thiết kế".
   - **Contracts** `assistant.ts`: zod cho từng op, `guestAssistantTurnRequest`, `GuestAssistantTurnResponse`.
   - `apps/api/src/lib/ai/gateway.ts` (mới): `fetch` tới gateway OpenAI-compatible, `json_schema` strict, timeout 20 s, **không ném** (trả `{ok:false, reason}`), `assistantConfigFromEnv` trả `null` khi không có key, `transcribe()` trả `''` khi lỗi.
   - `apps/api/src/lib/guestAssistant.ts` (mới): phiên (`sq_ga`, hash SHA-256, 30 ngày), `redact()` (email/mobile/địa chỉ → `[email]`/`[mobile]`/`[address]`), `designContext()` chỉ gồm số và enum, `runAssistantTurn()` consume 3 bộ đếm **trước** khi gọi model, lưu transcript, `parseOps` bỏ op sai hình dạng, `needsConfirm` khi xoá ≥ 2 thứ hoặc model tự đánh dấu.
   - Route `POST /public/guest/assistant/turn`; 503 `not_configured` khi thiếu cờ/key; honeypot.
   - **Migration 022** (`guest_assistant_sessions`, `guest_assistant_turns`, `guest_requests.assistant_session_id`) — đã áp dụng.
   - `turbo.json` + `.env.example`: 6 biến mới (`VILAO_*`, `GUEST_ASSISTANT_ENABLED`, `GUEST_ASSISTANT_DAILY_TURNS`, `NEXT_PUBLIC_SQ_ASSISTANT`). **Không có `VILAO_API_KEY` trên máy này** (đã kiểm tên, không đọc giá trị).
   - **Kiểm thật:** route trả **503 not_configured** khi chưa có key. Với gateway giả: `redact` che đúng cả ba; `parseOps` bỏ 2/3 op sai; một turn "make it 9 metres wide" → span 9000, pitch 20; change set sai (`span 40000`, `bay 9000`) → **2 failures có lý do**, thiết kế **không đổi**; transcript lưu và **đã che email**.
27. **G-g S11 xong (2026-11-19):** `AssistantPanel`.
   - `apps/site/.../AssistantPanel.tsx` (mới): gập mở, log tin nhắn, thẻ thay đổi liệt kê từng op bằng lời ("Width → 9.00 m"), **Undo một lần cho cả lượt**, "View on plan", thẻ xác nhận khi `needsConfirm`, dải "unavailable", câu "AI can make mistakes — check the plan".
   - Store thêm `undo: GuestDesignInput[]` (20 bước), `applyAssistantDesign` (một lượt = một undo), `undoDesign`, `canUndoNow`.
   - `NEXT_PUBLIC_SQ_ASSISTANT=1` bật cho mọi người; **`?assistant=1`** bật cho một lần — cờ đọc trong `hydrate()` **trước khi** URL bị ghi lại thành `?step=…` (đọc trong component thì mất).
   - **E2E mới (2 ca, stub route):** (a) trợ lý áp `setSpan` → tóm tắt đổi sang `9.00 ×`, rồi **một Undo** đưa về `6.00 ×`; (b) route trả 503 → dải "unavailable" hiện và controls vẫn dùng được.
28. **G-g S12 xong (2026-11-19) — HẾT G-g.**
   - `docs/OPERATIONS.md` thêm mục "The Guest assistant (optional, off by default)": bảng biến, chi phí và 3 bộ đếm, dữ liệu không gửi model, giới hạn quyền, câu SQL dọn phiên.
   - `e2e/guestQuote.spec.ts`: `fillStart` nhận `path` để mở trang với `?assistant=1` từ đầu (liên hệ chỉ ở bộ nhớ, reload sẽ khoá bước ②).
   - **Số đo cuối:** `pnpm typecheck` **14/14**; `@sq/core test` **1136**; `@sq/viewer3d test` **16**; `@sq/client-app test` **66**; `@sq/api typecheck` sạch; **`--project guest` 5/5 passed** (3D + trợ lý ×2 + desktop gửi + phone).
   - **Chưa kiểm:** một cuộc gọi gateway **thật** (không có `VILAO_API_KEY` trên máy); giọng nói (chưa có UI mic — `transcribe()` đã có nhưng chưa nối); giao diện trợ lý ở 375 px bằng mắt (mới đo 390 px qua e2e).

29. **Review G-f/G-g — sửa 7 lỗi (2026-11-19):**
   - **(1) JSON schema strict.** `ops` cũ chỉ `required: ['op']` ⇒ Structured Outputs trả 400 ⇒ trợ lý luôn "unavailable". Viết lại `apps/api/src/lib/ai/gateway.ts`: mỗi op một nhánh `anyOf`, mọi object `additionalProperties: false` và `required` **bằng đúng** danh sách `properties`, trường tuỳ chọn thành `["string","null"]`. `parseOps` gọi `dropNulls` trước `guestOpSchema.safeParse` (zod `.strict()` từ chối `null`). **Test mới**: mọi object node đều strict + required khớp properties + optional có `null`.
   - **(2) `setColours` không đổi được màu mái.** `roof` trùng tên với shape mái. Đổi thành **`roofColour`** ở core (`guestOps.ts:65`), zod (`contracts/assistant.ts:64`), schema JSON và prompt. Trim thành `["object","null"]` với ba khoá `required`. **Đo thật**: gateway giả trả `setColours` có `roofColour: 'Monument'` ⇒ `design.colours.roof === 'Monument'`.
   - **(3) `redact` bỏ sót địa chỉ.** Viết lại (`guestAssistant.ts`): không phân biệt hoa thường, tên đường 1–3 chữ, thêm Lane/Way/Cres/Pl/Cl/Tce/Bvd/Cir/Esp/Gr/Rise/Walk/Mews/Quay/Square, và cụm `SUBURB STATE 4000` neo theo mã bang. **Đo 12/12**: che `2 GEORGE ST, BRISBANE CITY QLD 4000`, `15 Smith Lane`, `7 Ocean View Rd`, `9 Kurrajong Crescent`, `1 Sturt Street Ballarat Central VIC 3350`; **không** che `make it 9 metres wide`, `3 bays of 3 m`, `25 degrees`.
   - **(4) Lead mang hội thoại + prune.** Migration **023** thêm `guest_requests.assistant_transcript_json`. Khi gửi: `liveSessionId` (cookie `sq_ga` còn hạn) → `fullTranscript` → ghi **cả** `assistant_session_id` và bản chép. Mail nội bộ in 10 lượt cuối (`describeTranscript`). Script mới `apps/api/scripts/prune-assistant.ts` + `pnpm assistant:prune` (root + api) xoá session hết hạn (turns cascade) và **NULL** `assistant_session_id` của lead trước — bản chép của lead không mất. **Chọn cách này thay vì "không xoá session đã gắn lead"** để bảng trợ lý không phình vô hạn; lý do ghi trong header script và `docs/OPERATIONS.md`. **Đo thật**: prune xoá 1 session + 2 turn.
   - **(5) Findings đầy đủ vào prompt.** `runAssistantTurn` giờ lấy mọi mục `review`/`note` của `assessGuestDesign` (kèm `region` chữ cái, **không toạ độ**) thay vì chỉ 3 cờ pitch/bay/span.
   - **(6) `focus` của mục 5° → ô độ dốc.** Trỏ `#g-pitch input:checked` thay `g-roof`. **Phát hiện thêm lỗi có sẵn**: `ChipRadios` đặt `name={`${name}-${uid}`}` nên mọi selector `input[name="g-roof"]` **không bao giờ khớp** — `summary.ts` cũng dính. Sửa gốc: fieldset có `id={name}`, mọi selector thành `#g-… input:checked`.
   - **(7) Lọc giá phía server.** `mentionsMoney` + `guardMessage`: nếu `message` có `$N`, `N AUD`, `Nk dollars`, hoặc chữ cost/price/pricing/cheap/expensive thì thay bằng câu an toàn và `request.log.warn`. **Đo thật**: gateway giả trả "A dark roof costs about $12,000 extra." ⇒ khách nhận "Pricing comes in your formal quote by email…", log cảnh báo.
   - **Kiểm:** `pnpm typecheck` **14/14**; `pnpm build` **9/9**; `@sq/api test` **366/366** (+17); `@sq/core test` **1149/1149**; e2e `e2e/guestQuote.spec.ts --project guest` **5/5**.
   - **Bẫy khi chạy:** `pnpm build` xoá `packages/db/dist` trong lúc API `tsx --watch` đang chạy ⇒ API chết với `ERR_MODULE_NOT_FOUND …@sq/db/dist/index.js`, và e2e báo "The quote service is not answering". Chạy API bằng `pnpm --filter @sq/api build && pnpm --filter @sq/api start` (không watch) khi chạy e2e.

30. **Review G-f/G-g — điều tra mục 8 (9 spec editor hỏng), 2026-11-19.** Không chạy e2e editor (công ty `e2e-sheds` hết 3 seat; không revoke, không `--all`).
   - **Nguyên nhân là `327ae47`, không phải việc tách `@sq/viewer3d`.** `git show --stat 327ae47 -- apps/client/src/components/editor/details/` ⇒ commit đó **tạo cả thư mục `details/`**: 13 file, **3.814 dòng** (`CustomerGroup`, `DeliveryGroup`, `DesignGroup`, `ShedGroup`, `SiteGroup`, `SectionJump`, `shared`, `SideFlyout`, `SiteCheckPin`, `useShedDimensions`, `constants`). `QuoteDetailsPanel.tsx` cũng do `327ae47`. `327ae47^` **không có** `details/shared.tsx`, tức Step 1 được **viết lại toàn bộ** trong commit ấy.
   - **Nút "Delivery" thứ hai (smoke:41, legacyImport:70/135):** `apps/client/src/components/editor/details/SectionJump.tsx:88-108` render một `<button>` với `aria-label = section.label` (hoặc `"Delivery, N items need attention"`), gắn ở `QuoteEditor.tsx:1000`. Cộng nút group ở `details/shared.tsx:88-105` (`h3 > button`, `aria-label = title`), `getByRole('button', { name: /^Delivery/ })` khớp **2 phần tử** ⇒ strict-mode violation. Đây là lỗi **có sẵn từ `327ae47`**, không do G-f.
   - **6 test stepOne (50, 99, 151, 213, 252, 267):** cả sáu dùng `page.locator('h3 > button').filter({ hasText: /^Shed(?!Safe)/ })` (hoặc `/^Design/`) để mở group, rồi `#shed-span`, `#sitecheck-params-spanMm`, `#customer-quoteRateTier`, `summary` "Show more parameters". `h3 > button` **chỉ tồn tại từ `327ae47`** (`git log -S` xác nhận), nên test viết trước đó không thể dùng nó — nhưng `#shed-span` và các id khác vẫn có (`ShedGroup.tsx`, `DesignGroup.tsx`). Nghĩa là **id còn, đường mở group đổi**; test hỏng vì mở group sai, không phải vì phần tử mất.
   - **Loại trừ G-f:** `git status --short apps/client/src/components/editor/details/ apps/client/src/components/editor/QuoteEditor.tsx` ⇒ **rỗng**. Diff của G-f chỉ chạm `Render3D.tsx` (257 dòng xoá), `Shed3D.tsx` (xoá, chuyển package), `three/*` (chuyển), 2 hook (thành re-export), `DemoView`/`DemoBuilding`, 8 file bridge và 3 `next.config`. `useMediaQuery`/`useContainerSize` **giống từng byte** bản cũ (`diff` sạch), và `'use client'` còn trong `packages/viewer3d/dist/index.js`.
   - **Việc cần làm khi có seat:** chạy `npx playwright test e2e/stepOne.spec.ts e2e/smoke.spec.ts e2e/legacyImport.spec.ts --project chrome`. Hai sửa đổi dự kiến: (a) selector Delivery thành `.first()` hoặc scope vào group (`section#group-delivery button`); (b) 6 test stepOne dùng `#group-shed button`/`#group-design button` thay `h3 > button`, hoặc mở group qua `OPEN_GROUP_EVENT` như `SectionJump` làm. **Chưa sửa** — cần thấy lỗi thật trước.


31. **Giọng nói (STT) cho Shed Assistant — xong phần code, kiểm một phần (2026-11-22).**
   - **Luồng:** mic trong composer → `MediaRecorder` → base64 trong JSON → `POST /public/guest/assistant/transcribe` → `transcribe()` (gateway) → `normaliseShedTranscript` → `redact` → `repairTranscript` (model sửa nghe nhầm, 2026-11-24; regex `HEARD_WRONG` đã bỏ) → `{ text, onTopic, alternatives, numberWarnings }` → **điền vào ô chat, KHÔNG tự gửi**. Lượt chat thật vẫn đi qua `/assistant/turn` khi khách bấm Send, nên phạm vi chủ đề do `SYSTEM_PROMPT` cũ chặn ở bước sau.
   - **Probe gateway thật (2026-11-22, có `VILAO_API_KEY`):** `mgr/grok-stt` trả **200** với `language` và `response_format`, nhưng trả **400 `BAD_REQUEST`** với `prompt` — *ở mọi độ dài* (3 ký tự, 61 ký tự, 900 ký tự; thông điệp "This model rejected a generation parameter"). Vì vậy `transcribe()` **gửi prompt một lần, nhận 400 thì gọi lại không prompt**, và **nhớ theo `sttModel`** trong process để lần sau khỏi trả tiền cho cùng lời từ chối. Lớp chuẩn hoá + kiểm chủ đề không phụ thuộc prompt nên vẫn chạy.
   - **Audio không lưu, không log:** bytes chỉ để gọi gateway rồi bỏ; log lỗi chỉ có `mimeType`, `durationMs`, `bytes`.
   - **Quota riêng:** `voicePerIpDay: 30`, `voicePerSession: 20` (cộng `GUEST_ASSISTANT_DAILY_VOICE`, mặc định 100). Vượt IP/phiên → 429; vượt ngân sách ngày → `unavailable` và UI bỏ nút mic cho lượt đó.
   - **Env mới:** `GUEST_ASSISTANT_VOICE` (mặc định 0) và `GUEST_ASSISTANT_DAILY_VOICE` (100) trong `.env.example` + `turbo.json`.
   - **Đo được:** `pnpm --filter @sq/api typecheck` sạch; `pnpm --filter @sq/site-app typecheck` sạch; `pnpm --filter @sq/contracts build` thành công; `curl` route với clip WAV 1 giây → **200 `{ text: "", onTopic: false }`** (clip không có giọng nói nên rỗng — đúng); header site `Permissions-Policy: camera=(), microphone=(self), geolocation=()`.
   - **UI:** desktop 1440 và 390 px: nút mic 44×44; ghi → thanh ghi (chấm đỏ, `0:07 / 1:00`, 8 vạch sóng, Cancel/Done); Done → transcript điền vào ô với con trỏ ở cuối, hint "Check the words, then press Send.", **0 request `/assistant/turn`**; lạc chủ đề → hint "I can only help with the shed design…"; im lặng quá 60 s → "Didn't catch that"; quyền bị từ chối (giả lập `NotAllowedError`) → "Microphone blocked…". 390 px không có thanh cuộn ngang.
   - **Chưa kiểm:** một transcript **thật từ giọng nói** qua gateway (máy không có clip nói; clip dùng để thử là tone tổng hợp nên gateway trả rỗng), nên câu "prompt có giúp nhận đúng từ shed không" **chưa trả lời được** — với gateway này `prompt` bị từ chối nên câu trả lời là "không áp dụng". Cũng chưa kiểm bàn phím ảo trên điện thoại thật và Esc/Done bằng bàn phím trong trình duyệt thật.
32. **Gemini là nhà cung cấp chính, vilao là dự phòng; nút mic mở hộp thoại xác nhận (2026-11-27).**
   - **Router:** `apps/api/src/lib/ai/index.ts` — mỗi việc (lượt chat 25 s, sửa transcript 8 s, STT 25 s) đi nhà cung cấp **chính** trước; chỉ dự phòng khi lỗi đáng thử lại (429/500/503/504/mạng, `invalid`, `timeout`) **và** dự phòng đang bật **và** còn đủ hạn (lượt 5 s, sửa 2 s). `blocked` (an toàn) **không** thử lại; `400` không dự phòng khi hạn đã ngắn. Một dòng log mỗi lần gọi: `[ai] job=turn provider=gemini status=ok fallbackFired=false latencyMs=… inputTokens=… outputTokens=…` — **không có prompt, không có key**.
   - **Ba file:** `ai/schemas.ts` (schema + kiểu chung), `ai/vilao.ts` (hành vi gateway cũ, nguyên văn), `ai/gemini.ts` (`generateContent`, `x-goog-api-key`, `systemInstruction`, bỏ lượt `model` cuối, **không** gửi `temperature`/`topP`/`topK`/`candidateCount`, `audio/mp4` → `audio/m4a`), `ai/settings.ts` (đọc `ai_settings` + cache 30 s). `gateway.ts` đã xoá.
   - **Cấu hình là dữ liệu, key không phải:** migration **025** `ai_settings` (một dòng `id='global'`, không `tenant_id`); sửa ở `apps/admin` `/ai`, capability mới **`platform:ai`**, ghi audit `ai_settings.update`. Bảng **không có cột key** — API chỉ trả `geminiKeySet` / `vilaoKeySet` dạng boolean. Xoay key = sửa `.env` + khởi động lại API.
   - **Nút mic = hộp thoại:** `VoiceDialog.tsx` (`<dialog>` + `showModal()`): ghi → "Listening back…" → khách **đọc, sửa** câu, chip "Did you mean", cảnh báo số, rồi **Done** mới vào khung chat. Ghi âm nằm **trong** hộp thoại nên đóng là stream tắt. Cancel/Esc không gửi gì. "Type instead" đóng và đưa con trỏ về ô chat.
   - **Hai lỗi có sẵn mà hộp thoại làm lộ ra, đã sửa:** (a) `useVoiceRecorder.release()` gọi `recorder.stop()` ⇒ `onstop` ⇒ `finish()` **lần hai** ⇒ **hai** request transcribe cho một lần ghi, và Cancel vẫn gửi một cái — nay **gỡ `onstop` trước khi stop**; (b) Esc trong hộp thoại bị `panels.ts handleEscape` đóng luôn cả cột trợ lý — nay hộp thoại `preventDefault` + `stopPropagation` và tự đóng.
   - **Đo:** `@sq/api` **395 + 16 + 13 + 9** test xanh; typecheck api/admin/site sạch; `@sq/site-app build` OK; kiểm trình duyệt (Chrome, mic giả, route transcribe stub) **27/27** chức năng + **30/30** bố cục (1440 và 390 px, AA, không tràn ngang), ảnh ở `qa/screens/2026-11-27-voice-dialog/`.
   - **Chưa kiểm:** một cuộc gọi **Gemini thật** (máy chưa có `GEMINI_API_KEY`; `scripts/probe-gemini.mjs` viết xong nhưng **chưa chạy**), và trang `/ai` bằng mắt (cần đăng nhập platform admin — không có mật khẩu trong phiên này; route trả **307** như `/usage`).
