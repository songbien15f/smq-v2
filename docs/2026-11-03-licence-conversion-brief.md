# Brief: gộp máy chủ license (`smq-code-license`) vào SmartQuote v2

> **Người nhận: agent đang làm trong `02.smartquote_v2`.**
> Đọc hết file này trước khi sửa code. Mọi con số "đã kiểm" dưới đây đọc trực tiếp từ source, có `file:dòng` để tra.
>
> **Người giao việc:** operator. Ngôn ngữ trao đổi: tiếng Việt. Code và định danh: giữ tiếng Anh.
> **Ngày:** 2026-11-03. **Nguồn cũ:** `D:\Docs\OS.mr.Thi\smq-code-license`.

---

## 0. Mục tiêu một câu

Chuyển nghiệp vụ của máy chủ license .NET (quản nhiều công ty, thư viện mẫu báo giá, file `.sqd` có hash) thành tính năng của monorepo v2 — **không** port máy chủ license như một app riêng, **không** giữ bản desktop làm client bắt buộc.

Ba quyết định đã chốt (đây là đầu vào, không phải câu hỏi):

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | **Multi-company**, phân biệt bằng **company code** (ví dụ `VGG`), đúng như máy chủ license cũ | Phá vỡ bất biến `SINGLE_COMPANY=1` hiện tại của v2 — đây là thay đổi lớn nhất trong brief |
| D2 | **`.sqd` vẫn là định dạng trao đổi có hash**, dùng cho cả import và export | Hash ở hai nơi: cột DB cho file lưu trữ, và khối `Integrity` nhúng trong file do ta ghi |
| D3 | **Không còn phục vụ desktop cũ** (không HMAC tĩnh, không enum trả trong HTTP 200, không kênh installer `.msi`) | Khớp `docs/DECISIONS.md` A5 đã ghi. Nếu điều này sai, dừng lại và hỏi operator |

---

## 1. Hiện trạng: phần lớn việc đã có sẵn

Đo thực tế trên v2 hôm nay: **60 route** (`apps/api/src/routes`, đếm `app.<verb>(`), **26 bảng** trong `001_init.sql` + 7 migration, **842 test** (111 api + 711 core + 12 db + 8 contracts). Đối chiếu với máy chủ license: 14 bảng, 24 controller chứa **136 action method** (đếm `public ... IActionResult|JsonResult|ActionResult|...` trong `Controllers/*.cs`).

| Máy chủ license cũ | v2 hôm nay | Việc còn lại |
|---|---|---|
| `Account` (công ty) | `tenants` + `/admin/companies` + `/company` | chỉ cần **cho phép nhiều dòng** |
| `Account.AmountCpu` (số máy) | `tenants.seats` + `tenant_seats` PK `(tenant_id, slot)` | ✅ đã đúng, **không đụng** |
| `Account.ExpiredDate` / `Active` | `tenants.subscription_ends_at` / `tenants.status` | ✅ |
| `EndUserKey` (serial từng máy) | — | **bỏ** (D3) |
| Mật khẩu Base64 | scrypt tự mô tả (`scrypt$N$r$p$salt$hash`) | ✅ **không port** |
| `Version` / `Db` / `DbApp` + `.msi` | `releases` (label, engine_version, price_book_hash, `current`) | **không port** kênh phân phối; giữ `releases` như nhật ký "đang chạy bản nào" |
| `PublishController` (`systemctl restart`) | — | **không port** |
| `QuoteTemplateType` | `template_types` + seed gable/skillion/carport | ✅ |
| `QuoteTemplate` | `quote_templates` — **thiếu `description`, `sort_order`, chưa có scope theo công ty** | migration nhỏ |
| `QuoteTemplateFileRevision` | `quote_template_files` **đã có `sha256 TEXT NOT NULL`** nhưng **0 dòng code đọc/ghi** | **việc chính** |
| `.sqd` tải về theo template | — | **việc chính** |
| `.sqd` export/import theo quote | `apps/api/src/routes/quoteFile.ts` — chạy được, **không hash** | **việc chính** |
| `Salesman` (đồng bộ ShedSafe) | không có; ShedSafe dùng `client.email` | **không port** trừ khi operator yêu cầu |
| `Building` (bản sao ShedSafe) | `site_checks` (giữ id + 6 trường chứng nhận) | ✅ đủ cho báo giá |
| ShedSafe proxy | `/quotes/:id/site-check{,/pin,/import}` | ✅ |
| Google Places | `apps/api/src/routes/places.ts` | ✅ |
| `Log` (lịch sử xác thực) | `audit_events` + `usage_events` + `/audit` | ✅ gần đủ |
| `ForgotPwd` gửi mật khẩu gốc | chỉ có `/auth/password` (đổi mật khẩu) | thiếu **đặt lại qua email** — xem §7 |

**Kết luận:** "convert" = (a) mở khoá multi-company, (b) hoàn thiện file `.sqd` + hash, (c) vài migration nhỏ. **Không** dựng lại hệ thống.

---

## 2. Việc A — Mở khoá multi-company (ưu tiên cao nhất)

v2 hiện **cố ý** chạy một công ty. Bằng chứng:

| Điểm chặn | Vị trí |
|---|---|
| Default `SINGLE_COMPANY=1` (tầng DB) | `packages/db/src/config.ts:71` |
| Default `SINGLE_COMPANY=1` (tầng API) | `apps/api/src/config.ts:64` |
| Boot **dừng hẳn** nếu >1 tenant | `apps/api/src/server.ts:47` → `assertCompanyIsSingular` |
| `createCompany` từ chối công ty thứ hai | `apps/api/src/lib/company.ts:146` |
| Admin chỉ hiện 1 công ty | `apps/admin/src/app/company/page.tsx` (`limit=2`, `items[0]`) |
| Client **luôn** lấy công ty đầu tiên | `memberships[0]` xuất hiện **9 lần** trong `apps/client/src` |
| Chính sách đã tuyên bố | `docs/DECISIONS.md` A2; `.env.example:30` |
| Test giả định một công ty | `apps/api/src/__tests__/helpers.ts:41` (`singleCompany: true`) |

### 2.1 Điều **tốt**: dữ liệu đã tenant-scoped

Không cần đổi schema cho dữ liệu nghiệp vụ. 42 lần `tenant_id` xuất hiện trong `001_init.sql`. Các bảng **đã** có `tenant_id` và composite FK:

`memberships`, `sessions`, `company_settings`, `customers`, `quotes` (UNIQUE `(tenant_id, number)`), `quote_counters`, `quote_revisions`, `evaluations`, `price_overrides`, `price_row_overrides`, `company_catalogue_rows`, `quote_shares`, `send_jobs`, `site_checks`, `usage_events`.

`tenant_seats` cũng đã đúng: PK `(tenant_id, slot)`, nên hai công ty có ghế độc lập và **không thể** vượt ghế.

Các bảng **không** có `tenant_id` (đã kiểm từng bảng — đa số là đúng):
`schema_migrations`, `tenants`, `users`, `price_books`, `price_book_active`, `template_types`, `quote_templates`, `quote_template_files`, `enquiries`, `audit_events`, `rate_limits`.

Trong đó **ba bảng cần xem lại** khi multi-company: `quote_templates`, `quote_template_files` (xem §3.2) và `audit_events` (thêm `tenant_id` nullable để lọc theo công ty).

### 2.2 Company code

Máy chủ license định danh công ty bằng `CompanyCode` (`nvarchar(10)`, ví dụ `VGG`, `SSA`), và chuỗi đó đi vào tên file, đường dẫn update, và tài liệu khách nhận.

v2 dùng `tenants.slug` (URL-safe, unique). **Đề nghị: thêm cột `code`** thay vì ép slug:

```sql
ALTER TABLE tenants ADD COLUMN code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_code ON tenants (code);
```

Lý do tách: `slug` là khoá URL (`/company/abc-sheds`), `code` là khoá **nghiệp vụ** in trên báo giá và trao đổi với khách ("công ty VGG"). Ép slug = code làm mất tính URL-safe khi khách muốn code có dấu cách hoặc ký tự đặc biệt. Cột `code` cho phép đúng cả hai và cho phép migration mang code cũ sang nguyên văn.

### 2.3 Người dùng thuộc nhiều công ty

`memberships` PK `(tenant_id, user_id)` đã cho phép một người ở nhiều công ty, và `loadMemberships` (`apps/api/src/routes/auth.ts:74`) đã trả danh sách. Nhưng:

- `/auth/sign-in` chọn `memberships[0]` (`auth.ts:137`) với comment "switches explicitly afterwards" — **và route switch đó chưa tồn tại**.
- Toàn bộ UI client đọc `memberships[0]`.

Cần thêm:

| Việc | Chi tiết |
|---|---|
| `POST /auth/switch-company` | body `{ tenantId }`; kiểm membership active; **huỷ phiên cũ và cấp phiên mới** (đổi `sessions.tenant_id`) để ghế không bị giữ hai lần |
| Danh sách công ty trong session | `SessionView.memberships` đã có — hiện ở `ShellFrame` dưới dạng dropdown |
| `ShellFrame` nhận công ty đang mở | hiện 9 chỗ hardcode `memberships[0]`; đổi thành `session.currentTenantId` |
| `SessionView` thêm `currentTenantId` + `currentTenantCode` | nguồn duy nhất cho "tôi đang ở công ty nào" |

**Quy tắc bảo mật phải giữ:** `X-Tenant-Id` header không bao giờ được tin; công ty luôn đến từ phiên (đã đúng trong `apps/api/src/app.ts` và `lib/guard.ts`). Mọi route đọc `session.tenantId` — **đừng** đổi sang đọc từ path/query.

### 2.4 Bỏ `SINGLE_COMPANY`

Cách làm sạch nhất: **xoá khái niệm này**, không để nó thành cờ "đôi khi bật".

- Xoá `singleCompany` khỏi `ApiConfig` (`config.ts:29,64`) và `DbConfig` (`packages/db/src/config.ts:63,71,81,93`).
- Xoá `assertCompanyIsSingular` và khối boot ở `server.ts:47`.
- Xoá tham số `singleCompany` khỏi `createCompany` và `SingleCompanyError`.
- Xoá `SINGLE_COMPANY` khỏi `.env.example`.
- Sửa `docs/DECISIONS.md` A2 → ghi rõ **multi-company theo `tenants.code`**, kèm ngày và người quyết.
- Test: `helpers.ts:41` bỏ `singleCompany`; `api.test.ts:272` bỏ `singleCompany: false`.

**Không** giữ cờ tương thích ngược: hai nhánh mã cho hai mô hình tenant là nguồn lỗi cô lập dữ liệu, mà lỗi đó là lỗi tệ nhất có thể xảy ra ở đây.

---

## 3. Việc B — `.sqd` có hash (D2)

Hai loại file, hai cách hash. Đừng gộp.

### 3.1 File mẫu lưu trữ (template artifact) — hash trên **byte**

File thật đang có trên đĩa cũ: `App_Data/template-files/{2,3}/*.sqd`, **21.232 byte**, chia hết cho 16 → AES-256-CBC. Nội dung là `MQuotation` 125 thuộc tính, không đọc được bằng Node một cách hợp lý. **Coi là blob.**

| Bước | Hành vi |
|---|---|
| Upload | nhận base64 (v2 chưa có multipart parser — xem `priceImport.ts:48`), giới hạn **4 MB**, tính `SHA-256(bytes)` |
| Ghi DB | `quote_template_files` (đã có `sha256 NOT NULL`), `rel_path`, `size_bytes`, `version_label`, `note`, `created_by` |
| Ghi đĩa | `data/template-files/<templateId>/<fileRevisionId>.sqd` — đường dẫn **tương đối**, resolve từ workspace root (theo `DECISIONS.md` A16) |
| Trỏ active | cập nhật `quote_templates.active_file_revision_id` |
| Download | đọc file → **tính lại SHA-256 → so với cột**; lệch ⇒ **409**, không gửi file; khớp ⇒ trả `X-Content-SHA256` |
| Bất biến | **không bao giờ ghi đè**: mỗi upload là revision mới. Bản cũ giữ nguyên (cùng mô hình với `quote_revisions`) |

Đường dẫn phục vụ: **không mount tĩnh, không directory browsing** (lỗi của bản cũ — xem §5). Chỉ qua route có capability.

### 3.2 Phạm vi catalogue theo công ty

Máy chủ license cho `QuoteTemplate.CompanyId` nullable = *global cho mọi công ty*, hoặc *riêng một công ty* (`IsVisibleToCompany` trong `QuoteTemplateApiController.cs:231`). Giữ nguyên ngữ nghĩa đó:

```sql
ALTER TABLE quote_templates ADD COLUMN description TEXT;
ALTER TABLE quote_templates ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quote_templates ADD COLUMN tenant_id TEXT;   -- NULL = global
CREATE INDEX IF NOT EXISTS quote_templates_tenant ON quote_templates (tenant_id, status);
```

Truy vấn của công ty: `WHERE status='active' AND (tenant_id IS NULL OR tenant_id = :tenant)`. Truy vấn của vendor: tất cả.

### 3.3 File `.sqd` do ta ghi ra (export quote) — hash **nhúng trong JSON**

`writeQuoteFile` (`packages/core/src/lib/quoteFile/sqd.ts:277`) hiện ghi JSON thuần; desktop auto-detect được (đã ghi trong `DECISIONS.md` A19). Thêm một thành viên **cuối cùng**:

```json
{
  "SmartQuoteVersions": [ ... ],
  "VersionMetadata": { "CurrentRevision": 3, "TotalVersions": 3, ... },
  "Integrity": {
    "Algorithm": "SHA-256",
    "Canonicalisation": "RFC8785",
    "Digest": "9b1e…(64 hex thường)…",
    "IssuedAt": "2026-11-03T04:00:00Z",
    "Issuer": "VGS"
  }
}
```

`Digest` tính trên **canonical form của document sau khi bỏ thành viên `Integrity`**: sắp khoá, không khoảng trắng (JSON Canonicalisation Scheme RFC 8785). Nhờ vậy format lại file không phá hash, nhưng sửa nội dung thì phát hiện được.

Vì sao không hash trên byte thô của file: ta ghi bằng `JSON.stringify(doc, null, 2)`, nhưng người ta có thể mở ra chỉnh khoảng trắng, hoặc một công cụ khác ghi lại. Hash trên byte sẽ báo sai trong những trường hợp vô hại. Hash trên canonical form chỉ báo khi **nội dung** đổi.

**Rủi ro phải kiểm bằng chứng cứ, không đoán:** desktop đọc file bằng Newtonsoft `JsonConvert.DeserializeObject<MQuotation>`. Newtonsoft mặc định `MissingMemberHandling.Ignore` nên thành viên lạ bị bỏ qua — **nhưng đây là mặc định thư viện, chưa quan sát**. Trước khi phát hành phải thử một bản desktop thật. Phương án lùi nếu desktop hỏng: đặt hash ở **tên file** `"<quoteNumber>-<hash8>.sqd"` và giữ nội dung nguyên vẹn — vẫn verify được, không đụng parser.

**Import:** `readQuoteFileBytes` trả thêm `integrity: 'valid' | 'invalid' | 'absent'`.
- `absent` (file AES cũ, hoặc file desktop ghi) = **không phải lỗi**, chỉ là không có gì để kiểm.
- `invalid` = **chặn**, trả lời bằng một câu giải thích (không phải 500), vì một quote đọc nửa vời sẽ ra giá sai trông hợp lý.

### 3.4 Route

| Route | Capability | Việc |
|---|---|---|
| `POST /admin/templates/:templateId/file` | `platform:templates` | Upload `.sqd` → revision mới + sha256 |
| `GET /admin/templates/:templateId/file` | `platform:templates` | Tải bản active, verify hash trước khi gửi |
| `GET /admin/templates/:templateId/files` | `platform:templates` | Lịch sử revision (label, size, sha256, ngày, người) |
| `GET /templates/:templateId/file` | `quote:write` | **Công ty** tải `.sqd` để mở bằng desktop (đây là "export" phía công ty) |

Đã có `publishTemplateRequest` trong `packages/contracts/src/admin.ts:128` và `TemplateRow.versionLabel/fileSizeBytes` (`admin.ts:113`) — hợp đồng cho file revision **đã khai**, chỉ thiếu implementation.

Sửa `TemplateRow` thêm `sha256` + `description` + `sortOrder`; sửa `quoteFile.ts` export để chèn `Integrity`, import để báo trạng thái.

---

## 4. Việc C — những thứ **không** port

Ghi rõ để sau này không ai hỏi lại. Mỗi mục là một tính năng có thật trong bản cũ và **cố ý** bị bỏ:

| Bỏ | Vì sao |
|---|---|
| HMAC-SHA256 tĩnh với secret dùng chung (`DApi.Key`) | secret nằm trong source, không thu hồi được, chữ ký replay được vô hạn |
| `EAuthenticationStatus` trả trong HTTP 200 | không còn client desktop để đọc enum |
| Kênh installer `.msi` / `.zip` / `systemctl restart` | web không có installer |
| Mật khẩu Base64 + `ForgotPwd` gửi mật khẩu gốc | đã thay bằng scrypt; gửi mật khẩu gốc qua email là lỗi |
| `State` / `Suburb` (bảng địa chỉ Úc) | Places đã trả đủ 4 thành phần địa chỉ |
| `BuildingManagementController` (13 action) | **dead code**: không có view nào trong `Views/` — gọi vào là lỗi "view not found" |
| `Salesman` + đồng bộ 2 chiều ShedSafe | ShedSafe v2 dùng `client.email`; thêm lại chỉ khi operator yêu cầu |
| Static mount + **directory browsing** `/setup`, `/update`, `/img` | mở toàn bộ file phát hành và logo **của mọi công ty** cho người lạ |
| `Account.DatabaseUrl` (mỗi công ty một file `.sqb`) | v2 dùng **một book chung + override theo công ty** — mô hình đã chốt trong `DECISIONS.md` A4 |

### 4.1 Hai thứ máy chủ license có mà v2 **chưa** có — cần quyết

| Thiếu | Hiện trạng v2 | Đề nghị |
|---|---|---|
| **Logo công ty dạng ảnh** | chỉ có `logoText` (`lib/settings.ts:52`) — in chữ thay logo | Quyết: giữ chữ (rẻ, không có upload), hoặc thêm upload ảnh như template (cùng cơ chế hash, cùng thư mục riêng). Operator nên chọn |
| **Đặt lại mật khẩu qua email** | chỉ có đổi mật khẩu đã đăng nhập (`/auth/password`) | Cần, vì nhân viên quên mật khẩu là việc thật. Dùng lại transport SMTP2GO + queue đã có (`lib/mail/*`) |

---

## 5. Việc D — chuyển dữ liệu (nếu phải chạy song song)

Nếu phải mang dữ liệu từ máy chủ license thật (`103.15.50.87 / SmartQuote`) sang:

| Bảng cũ | Bảng mới | Ghi chú |
|---|---|---|
| `Account` | `tenants` (+ `code` = `CompanyCode`) | map `AmountCpu→seats`, `ExpiredDate→subscription_ends_at`, `Active→status` |
| `EndUserKey` | — | bỏ; không mang serial sang |
| `QuoteTemplate` | `quote_templates` | `CompanyId` NULL → `tenant_id` NULL (global); có giá trị → map sang tenant id |
| `QuoteTemplateFileRevision` | `quote_template_files` | **giữ nguyên `Sha256`**; copy file, đổi đường dẫn sang `data/template-files/...` |
| `QuoteTemplateType` | `template_types` | map `Id` sang id, `Name` sang `code` (kebab-case) |
| `Version` / `Db` / `DbApp` | `releases` (rút gọn) | chỉ cần biết "đang chạy bản nào"; `IsForceUpdate` mất nghĩa khi không còn installer |

File `.sqd` phải copy **và tính lại hash** so với cột cũ — nếu lệch, ghi nhận chứ không sửa (file cũ có thể đã bị đổi tay).

---

## 6. Thứ tự thực hiện (mỗi slice tự kiểm chứng được)

**Slice 1 — Multi-company (nền tảng, làm trước mọi thứ).**
`tenants.code` migration; bỏ `SINGLE_COMPANY`; thêm `POST /auth/switch-company`; `SessionView.currentTenantId`; sửa 9 chỗ `memberships[0]`; admin `/company` thành danh sách nhiều công ty + nút tạo.
*Kiểm:* hai công ty, một người ở cả hai, chuyển qua lại; quote của VGG **không** hiện ở ABC; ghế tính riêng; xoá thành viên ở công ty A vẫn vào được công ty B.

**Slice 2 — Template catalogue đầy đủ.**
Migration `description/sort_order/tenant_id`; test scope global vs theo công ty; UI admin có ô mô tả + thứ tự + chọn công ty.

**Slice 3 — File `.sqd` cho template (hash byte).**
Thư mục `data/template-files`; upload base64; 4 route ở §3.4; verify hash khi tải; UI upload + lịch sử revision.

**Slice 4 — Hash trong `.sqd` export/import (canonical JSON).**
Canonicaliser + `computeIntegrity`/`verifyIntegrity` trong `packages/core`; sửa `quoteFile.ts`; test vector cố định (file mẫu → digest biết trước) để hash không lệch giữa hai lần chạy.

**Slice 5 — (tuỳ chọn) đặt lại mật khẩu qua email; logo ảnh nếu operator chọn.**

---

## 7. Kiểm chứng — bắt buộc trước khi báo xong

1. **`pnpm test` phải xanh trên cả hai driver.** 842 test hiện có là lưới an toàn; đừng sửa test cho khớp code, trừ khi test đang khẳng định điều D1 vừa lật (single-company).
2. **Test cô lập dữ liệu mới** — đây là test quan trọng nhất của slice 1, vì nó bắt được lỗi mà 842 test cũ không thấy:
   - người thuộc công ty A gọi `/quotes` → không thấy quote của B (kể cả khi đoán id, phải **404** không phải 403);
   - `GET /quotes/:id` với id của B → 404;
   - tải file template của công ty khác → 404;
   - ghế: A hết ghế **không** ảnh hưởng B.
3. **Hash có test vector:** cùng một document → cùng digest, trên cả SQLite và Postgres, và trên hai lần chạy khác nhau (bắt lỗi thứ tự khoá).
4. **File `.sqd` thật:** đọc được file AES 21.232 byte đang có trong `App_Data/template-files`; ghi ra file mới rồi đọc lại, digest khớp.
5. **Không có file nào phục vụ tĩnh:** `curl` thẳng `data/template-files/...` phải **404**.
6. **Verify bằng chứng, không bằng suy luận:** nếu chưa thử được desktop thật với khối `Integrity`, ghi rõ "chưa verify" trong báo cáo — đừng ghi "tương thích".

---

## 8. Câu hỏi còn mở (hỏi operator, đừng tự quyết)

1. **Code công ty** — có phải giữ đúng chuỗi cũ (`VGG`, `SSA`, `SSB`) và in lên tài liệu khách nhận không?
2. **Một người có thể thuộc nhiều công ty không**, hay mỗi người một công ty (như desktop: mỗi máy một serial, một subscription)? Điều này quyết định có cần switch-company hay không.
3. **Logo**: giữ chữ (`logoText`) hay thêm upload ảnh?
4. **Đặt lại mật khẩu qua email** có nằm trong phạm vi đợt này không?
5. **Có cần chuyển dữ liệu thật** từ `103.15.50.87` sang không, hay chỉ cần tính năng chạy trên dữ liệu mới?
6. **Salesman** (nhân viên sales đồng bộ ShedSafe, gán vào từng máy) có còn cần không?

Trả lời được 2, 5, 6 là đủ để bắt đầu Slice 1.

---

## 9. Cạm bẫy đã gặp ở bản cũ — đừng lặp lại

| Cạm bẫy | Thực tế |
|---|---|
| Đếm ghế rồi insert (không khoá) | đã sửa bằng `tenant_seats` PK `(tenant_id, slot)` — **giữ nguyên cách này**, đừng quay lại đếm |
| `catch { return new List<>(); }` | lỗi DB hiện ra thành "không có dữ liệu". v2 trả `sendFail` có mã lỗi — giữ |
| Không transaction cho thao tác nhiều bước | v2 đã dùng `db.transaction` — mọi thao tác ghi nhiều dòng phải nằm trong một transaction |
| `IsReady => RegisterDate.Date < Today` | công ty đăng ký **hôm nay** bị chặn. Nếu port logic này ở đâu, bỏ điều kiện đó |
| So sánh ngày bằng `.Date` với `DateTime.Now` | lệch múi giờ giữa server (UTC) và khách (AEST). Dùng UTC tuyệt đối như v2 đang làm |
| Path traversal qua `rel_path` | v2 phải kiểm `Path.GetFullPath(...)` nằm trong thư mục gốc (bản cũ **đã** kiểm đúng ở `QuoteTemplateApiController.cs:189`) |
| `catch` nuốt lỗi khi upload template rồi fallback SQL thô | bản cũ có `InsertTemplateDirectSql` vì framework trả 0 — **không** port; v2 tin kết quả DB |

---

## 10. Không được làm trong brief này

- Không sửa `packages/core` cho phụ thuộc DB/HTTP/tenancy (`DECISIONS.md` A9).
- Không đưa secret vào code: ShedSafe/Places/SMTP **chỉ** trong `.env` (operator đã yêu cầu như vậy).
- Không thêm `/w/<tenantId>` hay bất kỳ công ty nào trong URL (`DECISIONS.md` A7) — trừ route switch-company dùng body, không dùng path.
- Không viết lại engine BOM hay pricing.
- Không tạo app/repo mới: mọi thứ vào `apps/api`, `apps/admin`, `apps/client`, `packages/core`, `packages/db`, `packages/contracts`.
