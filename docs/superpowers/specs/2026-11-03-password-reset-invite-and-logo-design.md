# Đặt lại mật khẩu, mời thành viên, và logo nền tảng — thiết kế

**Ngày:** 2026-11-03
**Trạng thái:** chờ operator duyệt
**Phạm vi:** hai workstream độc lập, làm sau `994634b` (workstream A — admin tạo công ty từ UI)

---

## 0. Vì sao có tài liệu này

Brief licence conversion (§4.1) nêu hai thứ máy chủ licence cũ có mà v2 chưa có — **logo ảnh** và
**đặt lại mật khẩu qua email** — và trong lúc đo để trả lời "còn task gì", tôi tìm ra hai lỗ hổng
thật có cùng gốc: **không có route nào tạo một thành viên**, và **không ai lấy lại được mật khẩu đã
quên**. Cả hai hoá ra dùng **cùng một cơ chế**: một token dùng-một-lần gửi qua email, kèm một trang
đặt mật khẩu. Vì vậy chúng là một workstream, không phải hai.

Operator đã chốt ba điều quyết định thiết kế:

| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | Ai được yêu cầu đặt lại mật khẩu? | **Tự phục vụ + admin công ty đặt lại cho thành viên** |
| Q2 | Sau khi đặt lại qua link, có đăng nhập luôn không? | **Vào thẳng workspace** |
| Q3 | Form "quên mật khẩu" hỏi gì? | **company code + email** |
| Q4 | Email không tồn tại thì báo sao? | **Không tiết lộ** — luôn cùng một câu trả lời |
| Q5 | Logo ảnh là của ai? | **Một logo nền tảng cố định**, không phải per-company upload |
| Q6 | Định dạng ảnh? | **PNG/JPG/WEBP, cấm SVG** |

---

## 1. Hiện trạng (đã kiểm source, có dòng)

| Điểm | Vị trí | Ghi chú |
|---|---|---|
| Bảng `invitations` **đã có sẵn** | `packages/db/migrations/001_init.sql:98-114` | Cột `token_hash`, `tenant_id`, `email`, `role`, `kind` (`member \| platform \| reset`), `expires_at`, `accepted_at`, `revoked_at`. **Không câu lệnh nào đọc/ghi bảng này.** |
| `inviteRequest` là hợp đồng mồ côi | `packages/contracts/src/auth.ts:109` | 0 consumer — không route, không form |
| Mail queue **buộc phải là quote** | `apps/api/src/lib/mail/queue.ts:88-99`, `001_init.sql:368` | `send_jobs.quote_id` và `revision_id` là `NOT NULL`. Một email đặt lại mật khẩu không có quote nên không dùng queue này được. |
| Đổi mật khẩu chỉ khi đã đăng nhập | `apps/api/src/routes/auth.ts:337` (`POST /auth/password`) | Cần mật khẩu hiện tại — vô dụng với người đã quên |
| Token đã có sẵn và đúng | `apps/api/src/lib/tokens.ts` | `newToken()` 256-bit base64url, `hashToken()` sha256, `tokenMatches()` so sánh hằng thời gian. Dùng lại nguyên. |
| Rate limiter đã có sẵn, chạy trước khi làm việc | `apps/api/src/lib/rateLimit.ts` | Ghi vào bảng, nên nhiều instance chia sẻ đúng một giới hạn |
| SMTP transport đã có sẵn | `apps/api/src/lib/mail/smtp.ts`, `transport.ts` | `MailTransport.send(OutboundMail)` — `OutboundMail.attachment` là optional |
| Document render `logoText` ở **một chỗ** | `packages/core/src/lib/documents/html.ts:119` | `<div class="logo">${escapeHtml(company.logoText)}</div>` |
| PDF render từ HTML qua Chrome | `packages/core/src/lib/documents/pdf.ts` | Nên ảnh dạng data-URI sẽ vào PDF mà không cần thêm đường tải file |
| `BrandMark` là shield vẽ bằng SVG | `packages/ui/src/brand.tsx` | 4 chỗ dùng: client `ShellFrame`, `SignInShell`, admin `ShellFrame`, site `page.tsx` |
| Ảnh nguồn đã có | `smq-code-smartquote/App/SmartQuote/Logo.ico` | Chứa **1 entry PNG 256×256 / 32bpp / 100 KB** — trích ra được, không phải convert tay |
| `logoText` fallback khi chưa có logo | `apps/api/src/lib/settings.ts:122` | Giữ nguyên: công ty không cấu hình gì thì tài liệu vẫn in chữ |
| Revision freeze company như nó lúc lưu | `packages/core/src/lib/documents/projection.ts:250` | `logoText` nằm trong `FrozenCompany`. Đây là chỗ khó nhất — xem §4.3 |

---

## 2. Workstream B — token, mail, và hai trang mới

### 2.1 Nguyên tắc: một cơ chế, hai `kind`

`invitations.kind` đã có `member | platform | reset`. Chỉ dùng `member` và `reset`:

| `kind` | Ai tạo | Token sống | Ý nghĩa |
|---|---|---|---|
| `reset` | người dùng tự xin, hoặc admin công ty | 60 phút | đổi mật khẩu của một tài khoản **đã tồn tại** |
| `member` | admin công ty | 7 ngày | tạo mật khẩu đầu tiên cho một người **chưa có** membership |

Cả hai lưu **hash** của token, không lưu token. Cả hai là **dùng một lần**: `accepted_at` ghi nhận
lần dùng, và một token đã `accepted_at` bị từ chối. Cả hai **revocable**: `revoked_at`.

### 2.2 Bốn route mới

```
POST /auth/reset/request   { companyCode, email }            công khai, rate-limited
POST /auth/reset/confirm   { token, password, confirmPassword } công khai
POST /team/invite          { email, role, displayName }       members:manage
POST /team/:email/reset                                       members:manage
```

**`POST /auth/reset/request`** — luôn trả `200 { sent: true }` kèm đúng một câu: *"If that email
belongs to a person at that company, we have sent them a link to choose a new password."* Câu này
giống nhau cho: code sai, email sai, người đã bị xoá, người bị disable, công ty bị suspend. Nhánh
âm **vẫn chạy `burnVerificationTime`**-tương-đương (một `hashToken` + một insert rỗng vào
`rate_limits`) để thời gian trả lời không phân biệt được.

Tra cứu là **company trước, rồi người**: `tenants.code` + `users.email` + `memberships.status =
'active'`. Không tra theo username — đó là thứ người quên mật khẩu cũng quên.

**`POST /auth/reset/confirm`** — `token` tra `invitations.token_hash`, kiểm `kind = 'reset'`,
`accepted_at IS NULL`, `revoked_at IS NULL`, `expires_at > now`. Hợp lệ thì:

1. ghi `password_hash`, `must_change_password = 0`, `password_set_at`,
2. `revokeAllForUser` (**mọi** session cũ chết — kể cả kẻ đang chiếm tài khoản),
3. `accepted_at = now`,
4. **tạo session và trả `SessionView`** như `/auth/sign-in` — đúng Q2, người dùng vào thẳng.

Token sai/hết hạn/bị dùng → `400 validation_failed` với đúng một câu *"That link is no longer
valid. Ask for a new one."* — không nói token sai hay hết hạn.

**`POST /team/invite`** — tạo `users` (nếu email mới) + `memberships` `status = 'pending'` +
`invitations` `kind = 'member'`. Trả `{ invited: true, email }`, **không** trả token. Nếu email đã
là thành viên active của công ty → `409 conflict` với câu nói dùng "Reset password" thay thế.

`memberships.status` hiện là `'active' | 'removed'`. Thêm `'pending'`: sign-in chỉ chấp nhận
`active` (đã đúng trong `resolveSignIn`), nên một người chưa nhận lời không chiếm ghế.

**`POST /team/:email/reset`** — chặn bởi chính `members:manage`, chỉ cho thành viên **của công ty
mình** (join `tenant_id`). Gửi mail `kind = 'reset'` kèm **username** của họ trong thân mail, vì lý
do ở §2.5.

### 2.3 Gửi mail: inline, không queue — và vì sao

`send_jobs` không dùng được (§1). Ba lựa chọn:

| | Cách | Đánh giá |
|---|---|---|
| **A** | Gửi inline qua `MailTransport` đã có, trong chính request | **Chọn.** Lưu lượng là "một người quên mật khẩu" — vài lần mỗi tuần. Và lỗi gửi phải hiện ngay cho người đang đứng ở form: "mail server refused" là câu trả lời hữu ích, "đã xếp hàng" thì không. |
| B | Nới `send_jobs` cho phép `quote_id NULL` + thêm `kind` | Đụng vào bảng đã có 6 trạng thái và một worker đang chạy; mọi câu SQL hiện tại phải xét `quote_id IS NOT NULL`. Rủi ro cao hơn giá trị. |
| C | Bảng queue riêng cho "transactional mail" | Một worker thứ hai, một bộ trạng thái thứ hai, cho lưu lượng vài bức mỗi tuần. YAGNI. |

Chọn **A**. Khi SMTP chưa cấu hình (`smtpConfigFromEnv()` throw), route trả `503 not_configured`
với câu *"Mail is not configured on this server..."* — cùng cách route send quote đang làm. Một
đường gửi **không bao giờ** giả vờ đã gửi.

Ghi chú: nếu sau này lưu lượng tăng, việc chuyển sang B là **một file** (`lib/mail/`) — nhưng hôm nay
làm B là trả giá trước cho một vấn đề chưa có.

### 2.4 Không tiết lộ (Q4) — cụ thể

| Tình huống | HTTP | Thân |
|---|---|---|
| email + code khớp, người active | 200 | `sent: true` + câu chung |
| code sai | 200 | câu chung |
| email sai | 200 | câu chung |
| người bị remove / disable | 200 | câu chung |
| công ty bị suspend | 200 | câu chung |
| quá rate limit | 429 | *"Too many attempts. Try again in a few minutes."* — **khác biệt có chủ ý**, vì nó là về người gọi, không về dữ liệu |

Rate limit: `reset:acct:<hash(code:email)>` = 5 / 15 phút, và `reset:ip:<hashIp>` = 15 / 15 phút.
Đặt **trước** khi tra cứu, như `rateLimit.consume` đã được thiết kế.

### 2.5 Vì sao mail reset in cả username

Operator đã đổi khoá đăng nhập từ email sang username (2026-11-03). Người quen nhập email sẽ bị
chặn ở màn đăng nhập và không có đường tự cứu. Nên:
- Mail `reset` ghi: *"Your company code is **DEMOSHEDS** and your username is **owner**."*
- Mail `member` ghi: *"Your company code is **X**, your username is **Y**. Choose a password to
  start."*
Đây là **câu trả lời cho một câu hỏi họ đã tự chứng minh** (họ kiểm soát hộp thư đó), không phải rò
rỉ.

### 2.6 Ba trang client mới

| Route | Ai vào | Ghi chú |
|---|---|---|
| `/forgot` | công khai | hai ô: company code, email. Gửi xong hiện câu chung, **không** cho biết có tồn tại |
| `/reset` | công khai, token ở **fragment** (`#token=…`) | hai ô mật khẩu + xác nhận. Xong → vào workspace |
| `/join` | công khai, token ở fragment | như `/reset`, nhưng đặt mật khẩu lần đầu và kích hoạt membership |

Fragment, không phải query — cùng lý do share link `/s#token`: một token trong query nằm lại trong
log proxy và trong header `Referer` khi trang tải tài nguyên ngoài.

Trang `/` (đăng nhập) thêm link *"Forgot your password?"*. Trang Team thêm hai nút mỗi dòng:
**Invite** (đầu trang) và **Reset password** (mỗi thành viên).

### 2.7 Dữ liệu: không migration mới

Bảng `invitations` đã đủ cột. `memberships.status` đang là `TEXT` không có CHECK, nên `'pending'`
ghi được ngay — nhưng tôi sẽ **thêm một test khẳng định `resolveSignIn` từ chối `pending`**, vì
"ghi được" không giống "được xử lý đúng".

---

## 3. Workstream C — logo nền tảng

### 3.1 Một logo, không upload

Operator chọn **một logo nền tảng cố định** (Q5). Hệ quả: **không có bảng, không có route upload,
không có migration**. Logo là một tệp trong repo, đường dẫn từ env:

```env
# Optional. A PNG/JPG/WEBP file in the repository. Without it, documents print logoText.
LOGO_FILE=./assets/logo.png
```

Tôi sẽ trích entry 256×256 PNG từ `Logo.ico` và commit vào `assets/logo.png`.

**Vì sao không phải `data/`:** `data/` bị gitignore (nó chứa sách giá có bản quyền, `app.db`, cache
PDF). Logo là tài sản của sản phẩm và phải đi cùng mã nguồn để một clone mới render đúng ngay lần
chạy đầu.

### 3.2 Đọc và kiểm tra — một hàm, dùng ở ba chỗ

`packages/core/src/lib/branding/logo.ts` (thuần, không DB, không HTTP):

```ts
export type LogoImage = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string; width: number; height: number };
export async function loadLogo(path?: string): Promise<LogoImage | null>;
```

- Đọc tệp, kiểm **magic bytes** (không tin phần mở rộng): `89 50 4E 47` PNG, `FF D8 FF` JPEG,
  `RIFF....WEBP` WebP. **SVG bị từ chối** — một `<script>` trong SVG là XSS trên trang tài liệu
  khách nhận và trên chính app.
- Trần 1 MB. Vượt → `null` và log một dòng; **không** crash tài liệu.
- Trả `null` khi tệp không có hoặc không đọc được. Mọi caller xử lý `null` bằng fallback `logoText`.
- Cache trong bộ nhớ theo `(path, mtimeMs)` — logo đổi thì không cần restart API, nhưng không đọc
  đĩa mỗi lần render.

### 3.3 Document: data-URI, và tài liệu đã lưu thì sao

`html.ts:119` hiện tại:

```html
<div class="logo">${escapeHtml(company.logoText)}</div>
```

Thành:

```html
<div class="logo">${logoSrc === null
  ? escapeHtml(company.logoText)
  : `<img src="${logoSrc}" alt="${escapeHtml(company.name)}" class="logo-img">`}</div>
```

`logoSrc` là `data:image/png;base64,…` — nên PDF qua Chrome vẫn **tự chứa**, không phụ thuộc tệp
ngoài, đúng tính chất "một báo giá gửi đi là một tệp duy nhất".

**Chỗ khó, và quyết định:** `FrozenCompany` (`projection.ts:250`) freeze `logoText` vào revision.
Nếu logo là tệp nền tảng đọc lúc render, thì **một revision cũ sẽ đổi hình khi anh đổi logo** — trái
với quy tắc bất biến đã có ("một báo giá đã chốt phải giữ nguyên số liệu at that moment").

Ba cách:

| | Cách | Đánh giá |
|---|---|---|
| **A** | Freeze `logoHash` (sha256 của tệp) trong `FrozenCompany`; render lấy tệp theo hash; hash không còn ⇒ fallback `logoText` | **Chọn.** Giữ đúng nguyên tắc bất biến với chi phí một cột JSON và một dòng map. Revision cũ render đúng logo cũ nếu tệp đó còn; nếu đã xoá thì in chữ, không in logo sai. |
| B | Freeze nguyên base64 trong mỗi revision | Revision phình thêm ~135 KB mỗi bản, trong một bảng đã có trigger append-only. Không đáng. |
| C | Render logo hiện tại cho mọi revision | Đơn giản nhất, nhưng **vi phạm quy tắc bất biến** — một khách mở lại báo giá năm ngoái và thấy logo mới. |

Chọn **A**, kèm hệ quả rõ ràng: **xoá tệp logo là hành động có hậu quả với tài liệu cũ**. Ghi vào
`KNOWN-DEVIATIONS.md`.

Để A hoạt động, `assets/logo.png` không được bị dọn; nếu operator đổi logo thì đặt tên mới
(`logo-2026-11.png`) và cập nhật `LOGO_FILE`, để hash cũ vẫn tra được. Điều này ghi trong
`docs/TEST-ACCESS.md`, không chỉ trong code.

### 3.4 Header app: thay shield bằng ảnh, hay để shield

Shield `BrandMark` là SVG vẽ, sắc nét mọi kích thước, 0 request. Một ảnh PNG 256×256 thu nhỏ về
22 px sẽ hơi mờ trên màn hình Retina — nhưng đúng nhãn hiệu hơn.

Đề xuất: **`BrandMark` đọc logo nếu có, và tự fallback shield**. Giữ một component, bốn chỗ dùng
không phải sửa. Logo hiển thị ở `size` 22-28 px, và `object-cover`.

Nếu operator muốn giữ shield ở header và chỉ dùng logo trên **tài liệu** (phương án Q5 thứ hai) —
đây là chỗ đổi.

---

## 4. Kiểm chứng

### 4.1 Test phải có (viết trước khi code)

**Workstream B**

| # | Test | Khẳng định điều gì |
|---|---|---|
| B1 | `reset/request` với email đúng trả 200 và có **một** dòng `invitations` `kind='reset'` | luồng dương chạy |
| B2 | `reset/request` với code sai / email sai / người bị remove / công ty suspended — **cả bốn** trả cùng status và cùng `message` | không tiết lộ (Q4) |
| B3 | `reset/confirm` với token đúng đổi mật khẩu, đặt `accepted_at`, và **revoke mọi session cũ của user** | kẻ chiếm tài khoản mất phiên |
| B4 | `reset/confirm` **dùng lại cùng token lần hai** → 400 | dùng một lần |
| B5 | `reset/confirm` với token hết hạn → 400 cùng câu với token sai | không phân biệt được |
| B6 | `reset/confirm` trả `SessionView` và cookie —— tức là **đã đăng nhập** | Q2 |
| B7 | `team/invite` tạo `memberships.status='pending'`, và `POST /auth/sign-in` với người đó → 401 | người chưa nhận lời chưa vào được, chưa chiếm ghế |
| B8 | `team/invite` cho email đã là thành viên active → 409 | không tạo trùng |
| B9 | `join` với token `member` kích hoạt membership (`pending → active`) và đăng nhập được | luồng mời trọn vẹn |
| B10 | `team/:email/reset` của công ty A cho người của công ty B → 404 | cô lập dữ liệu |
| B11 | SMTP chưa cấu hình → `reset/request` trả 503 `not_configured`, **không** im lặng giả vờ | không bao giờ nói dối về việc đã gửi |
| B12 | rate limit: lần thứ 6 trong 15 phút → 429 | giới hạn có thật |

**Workstream C**

| # | Test | Khẳng định điều gì |
|---|---|---|
| C1 | `loadLogo` với PNG thật → mime/base64 đúng | đọc được |
| C2 | `loadLogo` với **SVG** → `null` | cấm SVG (Q6) |
| C3 | tệp giả mạo: đặt tên `.png` nhưng magic bytes không phải PNG → `null` | không tin phần mở rộng |
| C4 | tệp > 1 MB → `null`, không throw | tài liệu không sập vì một ảnh |
| C5 | render HTML khi có logo → chứa `data:image/png;base64,` và `<img` | nhúng đúng |
| C6 | render HTML khi **không** có logo → in `logoText`, không có `<img>` | fallback |
| C7 | revision freeze `logoHash`; đổi logo nền tảng rồi render lại revision cũ → **vẫn ra logo cũ** | bất biến (§3.3 A) |
| C8 | revision trỏ tới logo đã xoá → in `logoText`, không lỗi | suy giảm êm |

### 4.2 Kiểm chứng trên trình duyệt (không thể thay bằng test)

- Đăng ký "quên mật khẩu" với email thật của công ty demo → nhận mail → bấm link → đặt mật khẩu →
  **vào thẳng `/quotes`**, header hiện tên công ty.
- Admin mời một người mới → mail tới → bấm link → đặt mật khẩu → vào workspace.
- Email sai **không** cho biết là sai (so sánh thông điệp với trường hợp đúng).
- Mở một báo giá đã lưu → tải HTML → logo hiện ở đầu trang; tải PDF → logo hiện trong PDF và tệp
  không tham chiếu URL ngoài.

Đo được bằng số: `img` trong HTML có `naturalWidth > 0`; PDF có `%PDF-` và kích thước tăng đúng
~size logo.

### 4.3 Đo bằng số

```bash
pnpm -w typecheck                 # 12/12 (thêm file mới thì nhiều hơn)
cd apps/api && npx vitest run     # PASS cả SQLite và Postgres
cd apps/client && npx vitest run  # PASS
```

---

## 5. Rủi ro

| Rủi ro | Giảm nhẹ |
|---|---|
| **Token rò qua log/Referer** | Luôn ở **fragment** (`#token=…`), như share link. Không bao giờ query string. |
| **Email reset làm lộ danh sách khách hàng** | B2: bốn nhánh âm trả cùng status + cùng câu, và rate limit đặt trước tra cứu |
| **Một người nhận được mail reset của công ty khác** | Tra cứu bắt đầu từ `tenants.code`; `invitations.tenant_id` ghi lại; `reset/confirm` kiểm `tenant_id` khớp người dùng |
| **Gửi inline làm chậm request** | SMTP với timeout; đây là một request của người đang chờ, không phải batch. Nếu sau này lưu lượng tăng, chuyển sang queue là một file. |
| **Logo SVG = XSS** | C2: magic bytes chỉ chấp nhận PNG/JPEG/WEBP. SVG không có magic bytes hợp lệ trong danh sách. |
| **Revision cũ đổi hình khi đổi logo** | C7 + freeze `logoHash` (§3.3 A) |
| **Đổi logo làm hỏng tài liệu cũ** | Không xoá tệp cũ; dùng tên có ngày. Ghi vào `TEST-ACCESS.md` và `KNOWN-DEVIATIONS.md`. |
| **`memberships.status='pending'` lọt vào chỗ khác** | B7 + grep mọi `status = 'active'` sau khi thêm; chỉ `resolveSignIn`/`loadMemberships`/seat là liên quan |
| **Mời một người bằng email đã có tài khoản ở công ty khác** | `users.email` là UNIQUE toàn cục, nên **dùng lại user đó** và thêm membership — không tạo user thứ hai. Cần test riêng. |

---

## 6. Ranh giới — những gì KHÔNG làm

- Không làm **switch-company** (một người một công ty như operator đã chốt).
- Không đổi `send_jobs`; queue quote giữ nguyên.
- Không upload logo per-company; không bảng `company_logo`.
- Không SVG.
- Không đụng slices 2–5 của multi-company (template file, `.sqd` integrity, salesman).
- Không enforce `subscription_ends_at` (vấn đề riêng, đã ghi nhận).

---

## 7. Thứ tự thực hiện

Hai workstream độc lập; làm **B trước, C sau** vì B lớn hơn và chạm nhiều file hơn.

**B** — 4 nhóm, mỗi nhóm tự xanh được:
1. `invitations` service + 4 route + 12 test (chưa UI)
2. Mail template cho `reset` và `member` (inline, qua transport hiện có)
3. Ba trang client `/forgot`, `/reset`, `/join` + link "Forgot"
4. Team page: nút Invite + Reset per-member

**C** — 3 nhóm:
1. `loadLogo` (thuần) + 4 test
2. Document: `logoHash` trong `FrozenCompany` + render + 4 test
3. Header: `BrandMark` đọc logo, fallback shield

---

## 8. Định nghĩa "xong"

- 12 test B + 8 test C đều xanh trên **cả SQLite và Postgres**.
- Bốn luồng kiểm chứng bằng trình duyệt ở §4.2 chạy thật.
- `docs/TEST-ACCESS.md` ghi: cách xin reset, cách mời người, và cảnh báo đổi logo.
- `docs/KNOWN-DEVIATIONS.md` ghi: revision cũ in chữ nếu tệp logo bị xoá.
- `docs/DECISIONS.md` thêm một mục: mail transactional gửi **inline**, không qua queue quote, và vì sao.
