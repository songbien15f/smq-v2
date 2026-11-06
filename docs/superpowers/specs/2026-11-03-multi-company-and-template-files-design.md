# Design — multi-company, template files and `.sqd` integrity

> **Người viết:** agent (DeepSeek). **Ngày:** 2026-11-03.
> **Người review:** operator. **Trạng thái:** chờ review trước khi viết implementation plan.
> Phạm vi này thực thi brief `docs/2026-11-03-licence-conversion-brief.md`, với bốn quyết định operator đã chốt khi trao đổi (ghi ở §2).

---

## 0. Vấn đề, một đoạn

Desktop app mở bằng **company code** — một chuỗi nghiệp vụ ngắn (`VGG`), in lên báo giá, là thứ khách đọc qua điện thoại. v2 hiện chạy **một công ty** (bất biến `SINGLE_COMPANY=1`), login không có code, và mọi màn hình client đọc công ty đầu tiên (`memberships[0]`). Máy chủ license còn hai thứ chưa port: file `.sqd` có hash (lưu trữ template + trao đổi), và catalogue template đầy đủ theo công ty.

Việc này đổi v2 từ **một công ty** thành **nhiều công ty, chọn bằng company code khi login**, và hoàn thiện file `.sqd` có hash — không port máy chủ license thành app riêng, không phục vụ desktop cũ.

---

## 1. Mục tiêu & phi mục tiêu

### Mục tiêu

1. Login client bằng **company code + email + password** như desktop cũ.
2. v2 chạy **nhiều công ty**, dữ liệu cách ly tuyệt đối.
3. Catalogue template đầy đủ: description, sort order, scope theo công ty hoặc global.
4. File `.sqd` cho template: lưu trữ có hash SHA-256 trên byte, không bao giờ ghi đè.
5. Export/import `.sqd` có khối `Integrity` (hash canonical JSON).
6. **Salesman** theo công ty (bổ sung của operator, ngoài brief).

### Phi mục tiêu (cố ý bỏ, ghi để không hỏi lại)

- HMAC-SHA256 tĩnh, `EAuthenticationStatus` trong HTTP 200, kênh installer `.msi`, `systemctl restart`.
- Mật khẩu Base64, `ForgotPwd` gửi mật khẩu gốc qua email.
- `State`/`Suburb` (Places đã trả đủ 4 thành phần).
- `BuildingManagementController` (13 action, dead code — không có view).
- Static mount + directory browsing (`/setup`, `/update`, `/img`).
- `Account.DatabaseUrl` (mỗi công ty một file `.sqb`) — v2 giữ mô hình **một sách giá chung + override theo công ty**.
- `EndUserKey` (serial từng máy).
- **Chuyển dữ liệu thật** từ `103.15.50.87` — operator chốt "không cần".

---

## 2. Quyết định đã chốt (operator trả lời khi trao đổi 2026-11-03)

| # | Quyết định | Hệ quả |
|---|---|---|
| D1 | **Mỗi người một công ty** | **Không** làm `POST /auth/switch-company`, không có UI chuyển công ty. Login bằng code chọn sẵn công ty. |
| D2 | **Không migrate dữ liệu cũ** | Bỏ Slice 5 của brief ("chuyển dữ liệu"). |
| D3 | **Phạm vi Slice 1+2+3+4** | Làm nền tảng multi-company, catalogue, file hash, integrity. |
| D4 | **Salesman: có** (lệch khỏi brief §4) | Thêm slice riêng, sau Slice 1–4. |
| D5 | Login bằng **company code + username + password** | `username` **không phải email**. Email vẫn bắt buộc khi tạo user (để gửi báo giá), chỉ không còn là khoá đăng nhập. |
| D6 | **Username unique trong từng công ty** | Cột `username` đặt trên `memberships`, không trên `users`. Hai công ty đều được có `john`. |
| D7 | Ô đăng nhập **chỉ nhận username** | Không nhận đồng thời email. Người cũ phải dùng username được cấp. |
| D8 | Màn hình đăng nhập **được dựng lại** (§4.3b) | Bố cục hai cột, giữ palette navy+gold đã có. |

---

## 3. Hiện trạng (đã kiểm source, có dòng)

| Điểm | Vị trí |
|---|---|
| Default `SINGLE_COMPANY=1` | `apps/api/src/config.ts:64`, `packages/db/src/config.ts:71` |
| Boot dừng nếu >1 tenant | `apps/api/src/server.ts:47` |
| `createCompany` từ chối công ty thứ 2 | `apps/api/src/lib/company.ts:146` |
| Client hardcode `memberships[0]` | **8 chỗ** `apps/client/src` |
| Sign-in chọn `memberships[0]` | `apps/api/src/routes/auth.ts:137` |
| `SessionView` thiếu `currentTenantId` | `packages/contracts/src/auth.ts:38` |
| `quote_template_files` có `sha256 NOT NULL`, **0 dòng code** đọc/ghi | bảng trong migration, không câu lệnh nào |
| Sách giá chung + override theo công ty | đã chốt trong `DECISIONS.md` A4 |

---

## 4. Thiết kế từng phần

### 4.1 Company code — cột mới, không ép `slug`

```sql
ALTER TABLE tenants ADD COLUMN code TEXT;
CREATE UNIQUE INDEX tenants_code ON tenants (code);
```

- `slug` là khoá URL, không đổi được. `code` là khoá nghiệp vụ, in lên báo giá, có thể là `VGG`, `SSA`.
- Code lưu **chữ hoa**, compare không phân biệt hoa thường (khách đọc "vgg" vẫn đúng).

**Backfill cho dữ liệu đang có** — ba bước trong một migration, vì `NOT NULL` trên một bảng đã có dòng sẽ thất bại nếu làm một nhịp:

```sql
ALTER TABLE tenants ADD COLUMN code TEXT;
UPDATE tenants SET code = upper(substr(replace(slug, '-', ''), 1, 10)) WHERE code IS NULL;
CREATE UNIQUE INDEX tenants_code ON tenants (code);
```

`upper(slug)` không đủ khi slug chứa dấu gạch (`demo-sheds` → `DEMO-SHEDS`, 10 ký tự, vẫn hợp lệ nhưng xấu). Bỏ gạch và cắt 10 ký tự cho ra `DEMOSHEDS` — đúng độ dài cột `nvarchar(10)` của bản cũ. **Không** đặt `NOT NULL`: một index unique trên cột nullable đã đủ chặn trùng, còn `NOT NULL` sẽ làm migration hỏng trên một hàng mà ta chưa lường. Route tạo công ty **bắt buộc** truyền code, nên dòng mới luôn có.

Operator có thể đổi code sau bằng `PATCH /admin/companies/:id` (route đã có).

### 4.2 Login — company code + username + password

`signInRequest` thêm hai trường: `companyCode` **optional** và `username` **thay** `email`.

`username` không phải email — đó là điều operator yêu cầu, và nó khớp desktop cũ (đăng nhập bằng user, không bằng hộp thư). Email vẫn **bắt buộc khi tạo user** (dùng để gửi báo giá), chỉ không còn là khoá đăng nhập.

**Username unique trong từng công ty**, không phải toàn hệ thống: hai công ty đều có thể có `john`. Nghĩa là username thuộc **membership**, không thuộc user:

```sql
ALTER TABLE memberships ADD COLUMN username TEXT;
CREATE UNIQUE INDEX memberships_username ON memberships (tenant_id, username);
```

Lý do đặt trên `memberships` chứ không `users`: `users.email` là `NOT NULL UNIQUE` toàn cục và vẫn giữ nguyên. Một người (nếu sau này thuộc hai công ty) sẽ có hai username, mỗi công ty một — đúng mô hình danh bạ riêng.

**Backfill username cho người đang có** — lấy phần trước `@` của email, viết thường, và phải xử lý trùng **trước** khi tạo index:

```sql
ALTER TABLE memberships ADD COLUMN username TEXT;

-- Base: the part before @, lowercased.
UPDATE memberships
   SET username = lower(substr((SELECT u.email FROM users u WHERE u.id = memberships.user_id), 1,
                               instr((SELECT u.email FROM users u WHERE u.id = memberships.user_id), '@') - 1))
 WHERE username IS NULL;

-- Disambiguate within a company: append 2, 3, … to every row but the earliest.
UPDATE memberships
   SET username = username || (
     SELECT COUNT(*) FROM memberships m2
      WHERE m2.tenant_id = memberships.tenant_id
        AND m2.username = memberships.username
        AND m2.rowid < memberships.rowid
   ) + 1
 WHERE (SELECT COUNT(*) FROM memberships m2
         WHERE m2.tenant_id = memberships.tenant_id
           AND m2.username = memberships.username
           AND m2.rowid <= memberships.rowid) > 1;

CREATE UNIQUE INDEX memberships_username ON memberships (tenant_id, username);
```

Hai điều dễ sai ở đây: cột `username` **không** `NOT NULL`, vì `NOT NULL` trên bảng đã có dòng sẽ thất bại; và index được tạo **sau** khi backfill, nên nếu còn trùng thì migration dừng — đúng ý: một migration dừng còn hơn một index bỏ qua lặng lẽ.

Hệ quả cần nói với operator: username cũ = phần trước `@` của email. Người có email `an.nguyen@sheds.com.au` đăng nhập bằng `an.nguyen`. Nếu một công ty có hai người cùng tên đó, người thứ hai nhận `an.nguyen2` — và **phải được nói cho họ biết**, vì không ai đoán ra username có hậu tố.

**Admin app đổi form riêng:** platform admin không thuộc công ty nên không có username trong `memberships`. Đường đăng nhập admin dùng `users.email` + password như hiện tại, qua một tham số `platform: true` trên cùng route (hoặc route riêng — chọn cái ít mã hơn lúc implement). Client luôn dùng code + username.

**Tra cứu khi đăng nhập** (thay `memberships[0]` tại `auth.ts:137`) — đây là thay đổi lớn nhất, vì trước đó tra user bằng email rồi mới xét công ty, còn giờ phải tra **theo công ty trước**:

1. Normalise code về chữ hoa; không có code ⇒ từ chối (UI client luôn gửi).
2. `tenants` theo `code` + `status='active'`; không thấy ⇒ câu từ chối chung.
3. `memberships` join `users` theo `(tenant_id = tenant.id, username = ?)` với `status='active'`; không thấy ⇒ cùng câu từ chối chung.
4. Xác thực scrypt trên `users.password_hash`; sai ⇒ cùng câu.
5. Cấp phiên với `tenant_id` của công ty đó.

**Vì sao một câu từ chối cho cả bốn bước sai:** "sai company code" và "sai username" khác nhau sẽ cho phép dò xem một công ty tồn tại hay không, và dò username trong công ty đó. Message giữ nguyên `Those details do not match an account.`, và `burnVerificationTime` vẫn chạy khi không tìm thấy — để thời gian phản hồi không tiết lộ bước nào sai.

**Không còn nhánh "không code":** mỗi người một công ty (D1), nên không có trường hợp một người nhiều công ty phải chọn. Platform admin đi qua **admin app**, nơi form chỉ có email + password (xem §4.3b) — đường đó dùng `POST /auth/sign-in` với `platform: true`, hoặc một route riêng, tuỳ cái nào ít mã hơn lúc implement.

**Quy tắc bất biến giữ nguyên:** mọi route vẫn đọc `session.tenantId`, không bao giờ tin `X-Tenant-Id` hay path/query.


**Quy tắc bất biến giữ nguyên:** mọi route vẫn đọc `session.tenantId`, không bao giờ tin `X-Tenant-Id` hay path/query.

### 4.3 `SessionView` + 8 chỗ `memberships[0]`

`SessionView` thêm ba trường: `currentTenantId: string | null`, `currentTenantCode: string | null`, `currentTenantName: string | null`. Nguồn duy nhất cho "tôi đang ở công ty nào".

8 chỗ `memberships[0]?.tenantName` trong client đổi thành `session.currentTenantName`. Không đụng schema dữ liệu.

**Shell hiển thị code** cạnh tên công ty (`Demo Sheds Pty Ltd · DEMOSHEDS`) — đó là chuỗi khách đọc qua điện thoại, và là thứ một nhân viên support cần thấy để xác nhận họ đang nói về công ty nào.

**Admin app không có ô code.** Một platform admin không thuộc công ty nào, nên form admin giữ nguyên hai trường. Đây là lý do `companyCode` là optional ở API chứ không bắt buộc: bắt buộc sẽ làm hỏng đường đăng nhập của vendor.

### 4.3b Màn hình đăng nhập — dựng lại

Hiện tại `apps/client/src/components/SignInForm.tsx` là một form trôi giữa trang trắng: không logo, không ranh giới, không nói đây là sản phẩm gì. Đó là màn hình đầu tiên mọi người dùng thấy, và nó là màn hình duy nhất **không** có chrome bao quanh (trang `/` render `ShellFrame` rỗng).

**Bố cục: hai cột, form bên phải.**

```
┌──────────────────────────┬──────────────────────────┐
│                          │                          │
│   ▣ SmartQuote           │   Sign in                │
│                          │   Your company and your  │
│   Shed quoting,           │   own sign-in details.   │
│   priced from the         │                          │
│   book your factory       │   ┌──────────────────┐   │
│   actually buys.          │   │ Company code     │   │
│                          │   └──────────────────┘   │
│                          │   ┌──────────────────┐   │
│   ── navy panel ──        │   │ Username         │   │
│   (brand chrome,          │   └──────────────────┘   │
│    gold rule)            │   ┌──────────────────┐   │
│                          │   │ Password         │   │
│                          │   └──────────────────┘   │
│                          │   [   Sign in   ]        │
│                          │   Seats are limited      │
└──────────────────────────┴──────────────────────────┘
```

- **Trái**: panel navy (`--color-sq-brand`) toàn chiều cao, logo `BrandMark`, một câu về sản phẩm, và một đường kẻ gold — dùng đúng hai token đã có, không thêm màu mới. Ẩn dưới `lg` (màn hình hẹp chỉ còn form), vì một nửa màn hình trang trí trên điện thoại là chỗ lấy mất bàn phím.
- **Phải**: form trên nền `sq-ground`, thẻ trắng `rounded-sq-lg` có viền `sq-line`, đổ bóng rất nhẹ. Rộng tối đa `max-w-sm`.

**Ba ô, đúng thứ tự bạn nêu:**

| Ô | `id` | `autoComplete` | Ghi chú |
|---|---|---|---|
| Company code | `companyCode` | `organization` | `autoCapitalize="characters"`, hiển thị **chữ hoa**, gửi nguyên văn — server tự normalise. `inputMode="text"`, `maxLength={16}`, font mono để `VGG` và `VVG` không na ná nhau |
| Username | `username` | `username` | Không phải `type="email"` — trình duyệt sẽ không bắt định dạng hộp thư |
| Password | `password` | `current-password` | Nút hiện/ẩn mật khẩu, `aria-pressed`, giữ nguyên khả năng paste (WCAG 2.2 "Accessible Authentication") |

**Company code hiển thị chữ hoa ngay khi gõ** (`value={companyCode.toUpperCase()}`) nhưng state giữ nguyên văn: một người gõ `vgg` thấy `VGG` và tin là đúng, còn server vẫn nhận đúng thứ họ gõ để tự chuẩn hoá. Đổi giá trị hiển thị mà không đổi state là cách duy nhất để vừa thân thiện vừa không che mất lỗi gõ.

**Lỗi:** giữ nguyên hành vi đang có và đúng — `role="alert"` ở trên, lỗi từng ô dưới ô đó qua `aria-describedby`, và **focus nhảy tới ô sai đầu tiên**. Đây là pattern skill UI/UX xếp mức High ("Focusable Error Summary" + "Error Placement"), và code hiện tại đã làm đúng.

**Nút:** `variant="primary"` toàn chiều rộng thẻ, `loading` khi đang gửi (đã có), `min-h-11` (44px) — hiện là `min-h-[38px]`, dưới ngưỡng chạm.

**Những gì **không** đổi:** palette navy + gold. Skill UI/UX gợi ý "industrial grey + safety orange" cho ngành này, nhưng `tokens.css` đã ghi lý do từ chối đúng hướng đó: gold là màu "cần chú ý" trên bảng vật tư dày, và một màu cam thứ hai sẽ tranh chỗ với nó. Đổi palette là một quyết định riêng, không nằm trong việc này.

**Việc nhỏ kèm theo:** `min-h-[38px]` trong `packages/ui/src/field.tsx` nâng lên `min-h-11` cho mọi field — mọi ô nhập trong sản phẩm đang dưới ngưỡng chạm 44px, không riêng màn hình đăng nhập.

### 4.4 Bỏ `SINGLE_COMPANY` hẳn

Không giữ cờ "đôi khi bật" — hai nhánh mã cho hai mô hình tenant là nguồn lỗi cô lập dữ liệu, lỗi tệ nhất có thể xảy ra ở sản phẩm này.

- Xoá `singleCompany` khỏi `ApiConfig`, `DbConfig`, tham số `createCompany`, `SingleCompanyError`, `assertCompanyIsSingular`, block boot.
- Xoá `SINGLE_COMPANY` khỏi `.env.example`.
- Sửa `DECISIONS.md` A2.
- Test: `helpers.ts` và `api.test.ts` bỏ `singleCompany`.

### 4.5 Template catalogue

```sql
ALTER TABLE quote_templates ADD COLUMN description TEXT;
ALTER TABLE quote_templates ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quote_templates ADD COLUMN tenant_id TEXT;   -- NULL = global cho mọi công ty
CREATE INDEX quote_templates_tenant ON quote_templates (tenant_id, status);
```

Truy vấn công ty: `WHERE status='active' AND (tenant_id IS NULL OR tenant_id = :tenant)`. Vendor: `admin/templates` đã có — thêm 3 cột vào view.

### 4.6 File template — hash trên byte

Bảng `quote_template_files` giữ nguyên (`sha256 NOT NULL`). Thêm thư mục `data/template-files/<templateId>/<fileRevisionId>.sqd`.

| Route | Capability | Việc |
|---|---|---|
| `POST /admin/templates/:templateId/file` | `platform:templates` | Upload `.sqd` (base64, ≤4 MB) → revision mới, `SHA-256(bytes)` |
| `GET /admin/templates/:templateId/file` | `platform:templates` | Tải bản active, tính lại hash, lệch ⇒ 409 |
| `GET /admin/templates/:templateId/files` | `platform:templates` | Lịch sử revision |
| `GET /templates/:templateId/file` | `quote:write` | Công ty tải `.sqd` active |

Bốn route giữ đúng tên như brief §3.4 — không thêm route thứ năm theo `fileId`, vì `templateId` đã là khoá và bản "active" là thứ cả hai phía cần. Lịch sử revision trả `fileId` để một màn hình có thể tải bản cũ, qua cùng route `GET …/file?revisionId=…`.

**Verify hash khi tải là bắt buộc, không phải tuỳ chọn.** Đọc file, tính `SHA-256(bytes)`, so với cột `sha256`. Lệch ⇒ **409, không gửi file**: một file hỏng gửi đi là một công ty mở ra một báo giá sai trông hợp lý. Khớp ⇒ trả kèm header `X-Content-SHA256` để phía nhận tự kiểm lại được.

**Path traversal:** `rel_path` lưu tương đối; khi đọc, `resolve` từ workspace root rồi kiểm kết quả **nằm trong** `data/template-files/`. Không dựa vào việc `rel_path` do ta ghi — nó đến từ database, và database có thể bị sửa tay.

Bất biến: **không ghi đè** — mỗi upload là file revision mới. Path resolve từ workspace root, buộc nằm trong thư mục gốc. Không mount tĩnh, không directory browsing.

### 4.7 `.sqd` integrity — hash canonical JSON (không phải byte)

`writeQuoteFile` thêm thành viên cuối:

```json
"Integrity": {
  "Algorithm": "SHA-256",
  "Canonicalisation": "RFC8785",
  "Digest": "<64 hex thường>",
  "IssuedAt": "2026-11-03T04:00:00Z",
  "Issuer": "VGS"
}
```

`Digest` tính trên canonical form của document **sau khi bỏ `Integrity`** (sắp khoá, không khoảng trắng).

Import: `readQuoteFileBytes` trả thêm `integrity: 'valid' | 'invalid' | 'absent'`. `absent` không phải lỗi (file AES cũ, file desktop ghi); `invalid` chặn với câu giải thích.

**Rủi ro:** desktop Newtonsoft có thể chấp nhận thành viên lạ (mặc định `MissingMemberHandling.Ignore`), nhưng **chưa quan sát trên file thật**. Phương án lùi: hash trong tên file `<quoteNumber>-<hash8>.sqd`, nội dung nguyên. **Chỉ ghi "tương thích" nếu thử được desktop thật.**

### 4.8 Salesman (bổ sung của operator)

Bảng `salesmen` theo tenant; dùng thay `client.email` khi pin ShedSafe; đồng bộ `createsalesman`/`updatesalesman`. Khác bản cũ: salesman ở cũ gắn với *máy* qua serial; web không có máy, nên là bản ghi công ty chọn khi pin.

---

## 5. Rủi ro & giảm nhẹ

| Rủi ro | Giảm nhẹ |
|---|---|
| **Cô lập dữ liệu** — lỗi tệ nhất | test mới: công ty A đoán id quote B → **404** (không 403); tải file của B → 404; ghế A hết không ảnh hưởng B |
| Hash lệch giữa hai lần chạy | test vector cố định: cùng document → cùng digest, trên SQLite + Postgres + hai lần chạy |
| Desktop đọc khối `Integrity` | ghi "chưa verify" nếu không thử được; phương án lùi hash trong tên file |
| Path traversal | `Path.resolve` nằm trong thư mục gốc (bản cũ đã làm đúng) |
| Code bị bỏ sót ở một màn hình | grep `memberships[0]` phải về 0 sau Slice 1 |
| **Người dùng cũ không đăng nhập được** — họ quen nhập email, giờ phải username | migration backfill `username` từ phần trước `@` của email (lowercase), và **màn hình đăng nhập ghi rõ** ô nào là gì. Không có đường "nhập email cũng được" (D7), nên backfill phải đúng ngay từ migration, không để trống |
| Username sinh ra trùng sau backfill (`an.nguyen@a.com` và `an.nguyen@b.com`) | backfill phải thêm hậu tố khi trùng (`an.nguyen`, `an.nguyen2`, …) **trước** khi tạo unique index; index tạo sau `UPDATE` trong cùng migration, nên nếu trùng thì migration **dừng** chứ không lặng lẽ ghi đè |
| Mất khả năng đăng nhập bằng email khi email đổi | username là khoá độc lập với email — đổi email không phá đăng nhập. Đây là lợi ích, không phải rủi ro, nhưng phải nói vì hành vi thay đổi |
| Username trên `memberships` nhưng session lưu `user_id` | phiên vẫn trỏ `user_id` + `tenant_id`; username chỉ dùng lúc đăng nhập. Không đưa username vào token hay `SessionView` |

---

## 6. Thứ tự & kiểm chứng

**Slice 1** (multi-company + login code) → **2** (catalogue) → **3** (file hash) → **4** (integrity) → **5** (salesman). Mỗi slice tự xanh test trước khi sang slice.

### Ranh giới từng slice — cái gì xong thì slice xong

| Slice | File chạm | Xong khi |
|---|---|---|
| **1** Multi-company + login | migration cho `tenants.code` **và** `memberships.username`; `config.ts` ×2; `server.ts`; `lib/company.ts`; `routes/auth.ts`; `contracts/auth.ts`; `SignInForm` ×2; `field.tsx`; 8 chỗ client | hai công ty tồn tại; login bằng code+username vào **đúng** công ty; username trùng ở hai công ty **đều đăng nhập được**; **test cô lập dữ liệu xanh**; `grep memberships\[0\]` = 0; form đăng nhập mới render |
| **2** Catalogue | migration cho 3 cột; `routes/platform.ts`; `PlatformPage` | ✅ **XONG 2026-11-06** — operator quyết định **không có template global**: mọi template thuộc đúng một công ty, `tenantId` bắt buộc khi tạo, và **cả ba** chỗ đọc đều lọc (list, clone, file). Form admin có chọn công ty + mô tả + thứ tự; catalogue công ty hiện mô tả |
| **3** File hash | `lib/templateFiles.ts` + `routes/templateFiles.ts` mới; UI upload trong `PlatformPage`; migration `014` (cột `tenant_id` mà route công ty cần) | ✅ **XONG 2026-11-06** — upload → hash lưu; tải lại verify khớp (byte-for-byte qua `curl`); sửa 1 byte ⇒ **409** kèm hai hash; công ty B tải template của A ⇒ **404**, body **giống hệt** id không tồn tại |
| **4** Integrity | `packages/core/src/lib/quoteFile/integrity.ts` mới; `sqd.ts`; `routes/quoteFile.ts` | ✅ **XONG 2026-11-06** — vector cố định cho canonical form; `writeQuoteFile` ghi block, `readQuoteFileBytes` trả `valid` / `invalid` / `absent` / `unsupported`; import route trả `integrity` + hai digest khi lệch. **Lưu ý: đây KHÔNG phải port — desktop không có block này** (đã kiểm 2026-11-06: `grep Integrity` = 0 trong `Layer/Entity/QuoteFile`, và 12 file `.sqd` đọc được không có trường hash). Rủi ro tương thích Newtonsoft **không còn** vì operator quyết định bỏ desktop cũ |
| **5** Salesman | — | ✅ **XONG 2026-11-06, nhưng KHÔNG làm bảng.** Operator bỏ desktop, và kiểm chứng lại: desktop gửi `Salesman = ""` (literal, `QuoteDetailsView.Events.cs:2391`); salesman là khái niệm của **licence server** (bảng 72 cột, màn hình Building Management theo franchise — thứ operator nói không cần) và không ảnh hưởng giá. Nay là **chuỗi tự do** trên site check, gửi lên ShedSafe, lưu trong `detail_json`. **Sửa luôn lỗi cũ:** v2 gửi `client.email` làm salesman, tức email khách hàng hiện như người đi kiểm tra site |

### Kiểm chứng tối thiểu trước khi báo xong

1. `pnpm test` xanh trên SQLite **và** Postgres.
2. Test cô lập dữ liệu mới (mục trên) — đây là lưới an toàn quan trọng nhất.
3. Hash có test vector.
4. File `.sqd` thật AES đọc được; file mới ghi ra đọc lại, digest khớp.
5. `curl` đường dẫn file trực tiếp → 404.
6. Mọi claim tương thích desktop được ghi "chưa verify" nếu chưa thử thật.

### Điều spec này **không** làm

- Không sửa `packages/core` để phụ thuộc DB/HTTP/tenancy (`DECISIONS.md` A9).
- Không đưa secret vào code — ShedSafe/Places/SMTP chỉ trong `.env`.
- Không thêm công ty vào URL (`/w/<tenantId>`) — `DECISIONS.md` A7.
- Không viết lại engine BOM hay pricing.
- Không tạo app/repo mới.