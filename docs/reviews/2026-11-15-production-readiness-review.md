# SmartQuote v2 — Đánh giá sẵn sàng triển khai production (2026-11-15)

> Phạm vi: tech stack, kiến trúc, logic nghiệp vụ lõi, bảo mật, vận hành. **Chỉ rà soát + ghi chú, không sửa
> code.** Dùng làm nền để phân tích / lập kế hoạch tiếp.
>
> Ký hiệu: **(V)** = đã đọc code trong phiên này, có `file:line`. **(I)** = suy luận từ code, chưa tái hiện
> bằng lệnh chạy. **Chưa kiểm** = chưa xem tới, không được hiểu là "thiếu".
>
> Không lặp lại khoảng trống về admin/price book — xem `docs/reviews/2026-11-14-admin-site-gap-review.md`.

---

## 0. Kết luận một trang

> **Trạng thái (2026-11-15):** plan `docs/superpowers/plans/2026-11-15-production-hardening.md` đã được
> thực hiện. **B1, H1–H4, M3 đã xử lý** — xem báo cáo cuối của lần implement đó. Tóm tắt:
> - **B1 + M3** → seat gắn với **thiết bị** (migration `017_device_seats.sql`), thu hồi lười trong
>   transaction đăng nhập, retry một lần khi tranh slot (500 → `no_seat`). Màn hình Team → Devices.
> - **H1** → `trustProxy` theo **danh sách tin cậy** (mặc định `loopback`), `clientIp()` đọc
>   `request.ip`; hai bridge đăng nhập nay chuyển IP thật. Test chứng minh fail trên code cũ.
> - **H2** → 6 security header trên cả ba app Next.js (site dùng `no-referrer` vì token share nằm
>   trong fragment); `X-Powered-By` tắt. **Chưa có `script-src`** — cần nonce, để đợt sau.
> - **H3** → limiter đồng thời trong `@sq/core/documents`, `PDF_CONCURRENCY` (mặc định 2), 429 khi
>   hàng đợi quá lâu.
> - **H4** → không còn driver SQLite cho DB ứng dụng (D1); `DB_DRIVER=sqlite` là lỗi có tên.
> - Thêm **D2**: bytes price book lưu trong Postgres (`018_price_book_files.sql`), đĩa chỉ là cache.
>
> Chưa kiểm: e2e (`pnpm dev` không chạy trong phiên đó), PDF tay (không có `CHROME_PATH`), UI tay
> (Team → Devices mới chỉ kiểm qua API).


**Tech stack: ổn, hợp lý cho production.** Monorepo pnpm + Turborepo, Fastify 5 + Next.js 16 + React 19,
Postgres, Zod dùng chung, engine tính giá thuần (`@sq/core`) tách khỏi DB/HTTP. Không có lựa chọn nào cần
đập đi làm lại.

**Chất lượng code và tư duy thiết kế: cao hơn mặt bằng chung.** Tiền là số nguyên (cents), price book bất
biến theo hash nội dung, cô lập multi-company có test chứng minh, mật khẩu scrypt + so sánh constant-time,
token session chỉ lưu hash, cookie `httpOnly`, error handler không lộ stack/SQL, migration có checksum,
quyết định kiến trúc được ghi lại (`docs/DECISIONS.md`).

**Nhưng chưa nên đưa lên production ngay.** Có 3 chặn (blocker) và một số lỗ hổng mức cao:

| # | Vấn đề | Mức |
|---|---|---|
| B1 | Seat (license) **không tự giải phóng** khi session hết hạn/idle → công ty dần bị khóa không đăng nhập được | Blocker |
| B2 | **Chưa có gì để deploy**: không Dockerfile, không CI, chưa chọn nơi chạy, chưa có cấu hình reverse proxy/TLS | Blocker |
| B3 | Cập nhật price book vẫn phụ thuộc app desktop (đã ghi ở review 2026-11-14) trong khi desktop sẽ bị bỏ | Blocker (nghiệp vụ) |
| H1 | Giả mạo `X-Forwarded-For` → vượt rate limit theo IP (đăng nhập, reset mật khẩu, spam enquiry) | Cao |
| H2 | 3 app Next.js **không có security header** (CSP, chống iframe, HSTS…) | Cao |
| H3 | Mỗi PDF khởi động một Chromium mới, **không giới hạn đồng thời** → nguy cơ hết RAM | Cao |
| H4 | Driver SQLite không an toàn cho tải đồng thời, nhưng không bị chặn khi `NODE_ENV=production` | Cao |

Ước lượng: B1, H1–H4 mỗi cái là việc nhỏ (vài giờ đến 1 ngày). B2 là 2–4 ngày tùy nơi deploy. B3 là một
feature riêng (đã có plan `docs/superpowers/plans/2026-11-14-admin-price-book-management.md`).

---

## 1. Tech stack — đánh giá từng thành phần

| Thành phần | Lựa chọn | Nhận xét |
|---|---|---|
| Runtime | Node ≥ 22, TypeScript 5.9 | Ổn. Node 22 là LTS. Dùng `node:sqlite` (còn experimental trên 22) — chỉ chấp nhận được vì SQLite chỉ dùng cho dev/test và file price book. |
| Monorepo | pnpm 12 + Turborepo 2 | Ổn. Lưu ý bẫy đã ghi trong CLAUDE.md: app dùng `dist` của package, env phải khai báo trong `turbo.json`. |
| API | Fastify 5, `@fastify/cookie`, `@fastify/cors`, Zod 4 | Ổn. Gọn, ít dependency (bề mặt tấn công nhỏ). Thiếu `@fastify/helmet` không quan trọng vì API chỉ trả JSON và chỉ bridge gọi tới. |
| DB | Postgres (pg 8) + adapter tự viết, không ORM | Ổn cho quy mô này. SQL viết tay theo tập con chung 2 driver → có kỷ luật (A12, A20). Rủi ro: không có query builder nên mọi chỗ phải tự nhớ `tenant_id` — đã có `isolation.test.ts` bù lại. |
| Front-end | Next.js 16, React 19, Zustand, Konva (2D), three.js / R3F (3D) | Ổn. Phiên bản rất mới (Next 16.4, React 19.3) → cần theo dõi bản vá bảo mật sát sao. |
| PDF | puppeteer-core + Chromium cài trên server | Chạy được, nhưng tốn tài nguyên (xem H3) và đặt sai package (xem L1). |
| Mail | nodemailer + SMTP, hàng đợi trong DB | Ổn về thiết kế (idempotency key, lease, trạng thái `unknown` khi gián đoạn). Xem M6 về worker. |
| Test | Vitest (~121 file), Playwright e2e | Tốt cho engine và API. Front-end gần như chỉ có e2e smoke. |
| Lint/format | **Không có** | Nên thêm (L3). |
| CI/CD, container | **Không có** | Blocker (B2). |

**Kết luận stack:** không cần đổi công nghệ. Việc cần làm là *đóng gói và vận hành*, không phải *viết lại*.

---

## 2. Kiến trúc & logic — điểm mạnh nên giữ

Những điều này đúng và nên bảo vệ khi refactor:

1. **`@sq/core` là nơi duy nhất tính giá/khối lượng (A13)** — API và UI không tự cộng tổng. Tránh được loại
   bug "UI hiện một số, PDF in số khác".
2. **Price book bất biến, đặt tên theo SHA-256 (A4)** — báo giá cũ luôn tái tạo được đúng giá lúc lập.
   Cache handle theo hash nên republish không phục vụ nhầm book cũ (V: `apps/api/src/lib/priceBook.ts:29-73`).
3. **Multi-company đúng nghĩa**: `tenant_id` trên mọi bảng nghiệp vụ, header `X-Tenant-Id` không bao giờ được tin,
   lệch tenant trả 404 thay vì 403 (không lộ sự tồn tại) (V: `apps/api/src/lib/guard.ts`, `app.ts` hook `onRequest`).
4. **Xác thực**: scrypt N=2¹⁵, salt 16 byte, `timingSafeEqual`, có "decoy hash" để không lộ username tồn tại qua
   thời gian phản hồi (V: `apps/api/src/lib/password.ts`). Token session lưu dạng hash (V: `sessions.ts`).
   Cookie `httpOnly`, `sameSite=lax`, `secure` khi production (V: `routes/auth.ts:529-532`).
5. **Session có cả TTL tuyệt đối (168h) và idle timeout (24h)**, kiểm tra user bị disable, công ty bị suspend,
   membership — mỗi request (V: `sessions.ts` `resolveSession`).
6. **Error handler** không trả message gốc của DB/parser ra ngoài, nhưng giữ đúng status 4xx (V: `app.ts`).
   Body limit 1 MB.
7. **Bridge cùng origin** (A14): trình duyệt không bao giờ gọi thẳng API, có allow-list prefix và chặn `..`
   (V: `apps/client/src/app/api/sq/[...path]/route.ts`).
8. **PDF được cô lập tốt**: tắt JavaScript, chặn mọi request mạng trừ `data:`/`about:`, có timeout
   (V: `packages/core/src/lib/documents/pdf.ts:93-120`) → HTML có dữ liệu khách hàng không thể gọi ra ngoài.
9. **Migration có checksum**, sửa file đã chạy bị từ chối; boot kiểm tra DB trước khi listen; graceful shutdown
   chờ mail đang gửi (V: `server.ts`).
10. **Có tài liệu backup/restore thật** (`docs/OPERATIONS.md`: `pg_dump`, restore vào DB tạm, cách kiểm tra
    backup có thật).

---

## 3. Phát hiện chi tiết

### Blocker

#### B1. Seat không tự giải phóng khi session hết hạn — (V) đọc code, (I) chưa tái hiện

- Đăng nhập chiếm một slot trong `tenant_seats` (V: `apps/api/src/lib/sessions.ts:91-110`).
- Slot chỉ được trả lại khi: sign-out (`revokeSession`, `sessions.ts:238`), admin suspend công ty
  (`routes/admin.ts:176`), hoặc chạy tay `pnpm seats:release` — lệnh này **xóa toàn bộ seat và revoke toàn bộ
  session của mọi công ty** nếu không có `--tenant` (V: `apps/api/scripts/release-seats.ts:38`).
- `findFreeSlot` chỉ đếm slot đã có, **không xét session đã hết hạn / idle / revoke**
  (V: `sessions.ts:137`). Không có job nền nào dọn (V: không có `setInterval`/cron trong `apps/api/src`).
- **Hậu quả:** người dùng đóng trình duyệt thay vì bấm Sign out → sau 24h session chết nhưng seat vẫn bị giữ.
  Công ty mua 3 seat sẽ dần bị "Every seat in this company is in use" và phải gọi vendor.
- **Sửa (nhỏ):** trong cùng transaction của `createSession`, trước `findFreeSlot`, xóa các slot của tenant
  mà session tương ứng đã revoke / quá `expires_at` / quá idle. Đây là "lazy reclaim", không cần cron.
  Thêm test: tạo session, đẩy `last_seen_at` lùi 25h, đăng nhập lại khi hết seat → phải thành công.

#### B2. Chưa có đường deploy

- Không có `Dockerfile`, không có CI (`.github/` không tồn tại), `docker-compose.yml` chỉ chạy Postgres cho dev
  (V). `start/*.bat` là launcher Windows cho dev, không phải deploy. `DECISIONS.md` chưa có mục chọn hạ tầng.
- **Cần quyết định trước** (đây là quyết định của người dùng, không phải fact):
  - Nơi chạy: VPS/Docker Compose (đề xuất mặc định — đơn giản, 4 process + Postgres + Chromium), hay PaaS.
  - Reverse proxy + TLS (Caddy/Nginx), 3 domain (admin / client / site) hay path-based.
  - Postgres tự quản hay managed (managed giảm gánh backup).
- **Tối thiểu cần có:** 1 Dockerfile multi-stage cho API (có Chromium cho PDF) + 1 cho mỗi Next app (dùng
  `output: 'standalone'`), compose production, bước `pnpm db:migrate` chạy **một lần** trước khi start API,
  CI chạy `pnpm build && pnpm typecheck && pnpm test` (+ test Postgres, vì CLAUDE.md ghi 3 lỗi chỉ lộ trên Postgres).

#### B3. Price book phụ thuộc desktop

Đã phân tích đầy đủ ở `docs/reviews/2026-11-14-admin-site-gap-review.md` §0.1: bản dump chỉ tạo được trên máy
Windows có cài desktop. Khi desktop bị bỏ, không còn cách cập nhật giá gốc. Đây là blocker về **nghiệp vụ**,
không phải kỹ thuật — có thể go-live với book hiện tại nếu chấp nhận giá đứng yên một thời gian.

### Mức cao

#### H1. Giả mạo `X-Forwarded-For` vượt rate limit theo IP — (V)

- API bật `trustProxy: true` vô điều kiện (V: `apps/api/src/app.ts:60`).
- `clientIp()` lấy **phần tử đầu tiên** của `X-Forwarded-For` (V: `apps/api/src/lib/http.ts:55-63`) — phần do
  client tự gửi.
- Bridge của client chuyển nguyên header `x-forwarded-for` từ trình duyệt sang API
  (V: `apps/client/src/app/api/sq/[...path]/route.ts:164,175`).
- **Hậu quả:** đổi header mỗi request là có "IP mới" → vô hiệu giới hạn `signin:ip`, `reset:ip`
  (`routes/auth.ts:200,265,341`) và `enquiry:ip` (`routes/enquiries.ts:118-121`, form public của site → spam lead
  và spam mail). Giới hạn theo account vẫn còn.
- **Sửa:** cấu hình số hop proxy tin cậy (`trustProxy: <số hop>` hoặc danh sách IP proxy) và dùng `request.ip`;
  bridge lấy IP từ proxy tin cậy (header do reverse proxy *ghi đè*, ví dụ `X-Real-IP`) thay vì chuyển nguyên
  header của client. Cấu hình này gắn với B2 (topology proxy).

#### H2. Không có security header trên 3 app Next.js — (V)

- `next.config.ts` của client/admin/site chỉ có `transpilePackages` (V), không có `headers()`, không có middleware.
- Thiếu: `Content-Security-Policy` (ít nhất `frame-ancestors 'none'`), `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy` (quan trọng: link chia sẻ báo giá trên site không nên lộ
  qua Referer).
- **Sửa:** thêm `headers()` trong `next.config.ts` của cả 3 app (hoặc đặt ở reverse proxy). CSP cho client cần
  cho phép canvas/WebGL và Google Places nếu dùng phía trình duyệt — chưa kiểm.

#### H3. PDF: một Chromium mỗi request, không giới hạn đồng thời — (V)

- `renderPdf` gọi `puppeteer.launch` cho mỗi lần render và đóng ngay (V: `pdf.ts:93`). Có cache PDF theo hash
  revision (V: `apps/api/src/lib/documents.ts:59,238`) nên lần xem lại rẻ, nhưng lần đầu thì không.
- Mỗi Chromium ~150–300 MB và ~0.5–1.5 s khởi động (I). 10 người bấm "Send/PDF" cùng lúc trên VPS 2 GB → OOM,
  kéo chết cả API (cùng process cha).
- **Sửa:** semaphore giới hạn 1–2 render đồng thời (xếp hàng phần còn lại), cân nhắc giữ một browser sống và chỉ
  mở page mới. Về lâu dài có thể tách PDF ra worker/process riêng.

#### H4. SQLite trong production — (V) cấu trúc, (I) hành vi khi tải đồng thời

- Driver SQLite dùng **một connection chung** cho cả process và một cờ `inTransaction` toàn cục
  (V: `packages/db/src/sqlite.ts:41,76`).
- Hai request cùng mở transaction mà transaction đầu có `await` thật bên trong (I/O, scrypt…) → request thứ hai
  ném "A transaction is already open" → 500; truy vấn ngoài transaction của request khác có thể lọt vào
  transaction đang mở (I).
- Không có chốt chặn: `DB_DRIVER=sqlite` vẫn chạy khi `NODE_ENV=production` (V: `apps/api/src/config.ts` không kiểm).
- **Sửa:** `loadConfig` từ chối `DB_DRIVER=sqlite` khi production (hoặc yêu cầu biến opt-in rõ ràng). Postgres là
  lựa chọn duy nhất cho production.

### Mức trung bình

| # | Vấn đề | Bằng chứng | Đề xuất |
|---|---|---|---|
| M1 | Bảng `rate_limits` và `sessions` không bao giờ được dọn → phình dần | (V) chỉ có `DELETE` theo key ở `lib/rateLimit.ts:76`; không job nền | Job dọn định kỳ (hoặc dọn lazy lúc sign-in), xóa session đã chết > N ngày |
| M2 | `consume()` đọc rồi ghi (SELECT → UPDATE) không khóa; trên Postgres READ COMMITTED có thể mất update khi đồng thời → vượt giới hạn một chút | (V) `lib/rateLimit.ts:46-63` | Một câu `INSERT … ON CONFLICT DO UPDATE SET count = CASE … END RETURNING count` |
| M3 | Hai người đăng nhập cùng lúc tranh seat cuối: PK `(tenant_id, slot)` chặn đúng, nhưng lỗi constraint bị ném lại → **500** thay vì "hết seat" hoặc thử slot khác | (V) `sessions.ts:116` chỉ bắt `SeatRefused`; `migrations/002_seats.sql:23` | Bắt lỗi unique violation → thử lại 1 lần / trả `no_seat` |
| M4 | Account lockout: 10 lần sai / 15 phút theo account → ai biết company code + username có thể khóa người khác liên tục | (V) `routes/auth.ts:58-59,196` | Chấp nhận được nếu ghi nhận; hoặc tăng ngưỡng + thêm delay tăng dần, cảnh báo admin |
| M5 | Vendor dashboard: một mật khẩu chung qua header `x-vendor-key`, không thấy rate limit | (V) `routes/vendor.ts:109-123`, không có `consume` ở `vendor.ts` hay `client/src/app/api/vendor/login/route.ts` | Thêm rate limit cho login vendor; về sau nên chuyển thành tài khoản platform có session |
| M6 | Mail queue chỉ được đẩy đi trong request `send` (`dispatchNextJob` inline); không có worker nền → job kẹt `queued` nếu process chết giữa chừng chỉ chạy khi có lần send kế tiếp | (V) `routes/send.ts:133`, không có caller khác; `lib/mail/queue.ts:148-160` | Worker nhỏ chạy định kỳ trong process API (claim + lease đã có sẵn) |
| M7 | Migration không có advisory lock → 2 instance cùng chạy migrate có thể đụng nhau | (V) `packages/db/src/migrate.ts:131` | Chạy migrate như bước deploy riêng (một lần), hoặc `pg_advisory_lock` |
| M8 | Pool Postgres: `max 10`, không `statement_timeout`, SSL phụ thuộc hoàn toàn vào chuỗi `DATABASE_URL` | (V) `packages/db/src/postgres.ts:35-38` | Thêm `statement_timeout` (vd. 15s), cho cấu hình `max` qua env, ghi rõ `sslmode=require` cho DB managed |
| M9 | Trạng thái nằm trong process (cache price book, mail enquiry đang gửi, dispatch inline) → API thực chất là **single-instance** | (V) `lib/priceBook.ts:29`, `server.ts` shutdown | Đủ cho giai đoạn đầu. Ghi thành quyết định; khi cần scale ngang phải xem lại M6/M7 |
| M10 | Quan sát hệ thống: chỉ có log pino của Fastify + `/health`, `/health/ready`. Không metrics, không error tracking, không request-id xuyên bridge → API | (V) `routes/health.ts`, `server.ts` (`logger: true`) | Thêm Sentry (hoặc tương đương) cho API + 3 app, log JSON ra stdout có request-id, uptime check `/health/ready` |
| M11 | ShedSafe dùng **một tài khoản chung từ env** cho mọi công ty | (V) `lib/shedsafe.ts:147-160` | Câu hỏi nghiệp vụ: mỗi công ty có tài khoản ShedSafe riêng không? Nếu có thì phải lưu theo tenant (mã hóa) |

### Mức thấp / tối ưu dần

| # | Vấn đề | Đề xuất |
|---|---|---|
| L1 | `puppeteer-core` là dependency của `@sq/core` (V: `packages/core/package.json`, `lib/documents/pdf.ts`) — trái tinh thần A9 "core không I/O" và kéo puppeteer vào mọi consumer của core (kể cả client) | Giữ phần sinh HTML trong core, chuyển `renderPdf` sang `apps/api` |
| L2 | Component rất lớn: `QuoteEditor.tsx` 1286 dòng, `Render2D.tsx` 1286, `ShedGroup.tsx` 957 (V) | Tách dần khi chạm vào; không cần refactor riêng |
| L3 | Không linter/formatter | Thêm Biome hoặc ESLint + Prettier, chạy trong CI |
| L4 | Không thấy `next/dynamic` nào trong client (V) → three.js/R3F có thể nằm trong bundle chính (I) | Đo bằng `next build` output; lazy-load view 3D |
| L5 | Tài liệu lệch code: README nói "one company, one database" và launcher ở root; `apps/db/migrations/008_*` là bản trùng bị bỏ | Dọn README, xóa thư mục `apps/db` trùng |
| L6 | Bridge đệm toàn bộ body (`request.text()`, `arrayBuffer()`) | Chấp nhận được với limit 1 MB; chỉ xem lại nếu sau này có upload lớn |
| L7 | Phiên bản rất mới (Next 16.4, React 19.3, pnpm 12, Node types 26) | Bật Dependabot/Renovate + `pnpm audit` trong CI |

---

## 4. Build & test (chạy trong phiên này)

Chạy trên working tree hiện tại (có thay đổi chưa commit ở editor 3D). API test dùng SQLite in-memory;
**chưa chạy biến thể Postgres** (`TEST_DB_DRIVER=postgres`), chưa chạy e2e.

| Lệnh | Kết quả |
|---|---|
| `pnpm typecheck` | Pass (exit 0) |
| `@sq/core` test | 78 file pass, 1 skip — 1123 test pass, 16 skip |
| `@sq/api` test | 30 file — 300 test pass |
| `@sq/client-app` test | 9 file — 82 test pass |
| `@sq/contracts` test | 2 file — 15 test pass |
| `@sq/db` test | 1 file — 18 test pass |

Tổng ~1.540 test pass, 0 fail. Engine và API được phủ tốt; front-end chỉ có test đơn vị lẻ + e2e smoke.
Nên đưa biến thể Postgres vào CI (B2), vì đây là driver production.

---

## 5. Lộ trình đề xuất trước go-live

**Giai đoạn 1 — vá nhanh (1–2 ngày, không cần quyết định gì):**
B1 (reclaim seat), H3 (semaphore PDF), H4 (chặn SQLite ở production), M2, M3, M5, L5.

**Giai đoạn 2 — chốt hạ tầng (cần người dùng quyết định nơi deploy):**
B2 (Dockerfile, compose/PaaS, CI), H1 (trustProxy theo topology thật), H2 (security header), M7, M8, M10.

**Giai đoạn 3 — vận hành ổn định:**
M1 + M6 (job nền: dọn bảng, worker mail), backup tự động theo `docs/OPERATIONS.md` + thử restore,
uptime monitor, L3/L7 trong CI.

**Song song (feature):** B3 — quản lý price book trên admin theo plan 2026-11-14.

**Quyết định cần chốt (đề xuất mặc định trong ngoặc):**
1. Nơi deploy (VPS + Docker Compose + Caddy).
2. Domain: 3 subdomain riêng cho admin / client / site (có — cookie session tách bạch).
3. Postgres managed hay tự quản (managed nếu ngân sách cho phép).
4. ShedSafe: một tài khoản chung hay theo công ty (hỏi nghiệp vụ).
5. Chính sách lockout tài khoản (giữ 10/15 phút, thêm cảnh báo).

---

## 6. Chưa kiểm (không được hiểu là "thiếu")

- Từng route có gọi đúng guard + lọc `tenant_id` hay không — chỉ dựa vào `isolation.test.ts`, chưa đọc hết 23 file route.
- Độ chính xác số liệu engine so với desktop — thuộc `KNOWN-DEVIATIONS.md` / `scripts/golden.ts`, ngoài phạm vi.
- Hiệu năng thực tế (`/evaluate` trên book thật, kích thước bundle client) — chưa đo.
- Site public: luồng share link (`routes/shares.ts`) — mới thấy cookie `httpOnly`/`lax`, chưa đánh giá entropy/thu hồi link.
- Import Excel (`exceljs`) với file độc hại (zip bomb) — chưa kiểm.
- Google Places key dùng phía server hay trình duyệt — chưa kiểm (ảnh hưởng CSP ở H2).
