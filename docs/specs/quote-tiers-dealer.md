# Vai trò tùy biến, kèm mẫu Dealer (không thấy BOM)

Trạng thái: **quyết định đã chốt** (2026-11-17), spec chờ duyệt. Thuộc [quote-tiers.md](quote-tiers.md). Cỡ: *large*, ba lát (A) → (B) → (C). Không phụ thuộc phần Guest.

Quyết định áp dụng:
- **D-T1:** admin công ty tạo vai trò bằng cách tick quyền. Các vai trò có sẵn là mẫu khóa.
- **D-T2:** không có `quote:all` thì chỉ thấy quote mình tạo.
- **D-T7:** mọi thành viên, kể cả dealer, chiếm seat.

## Câu chuyện người dùng

- Là **company admin**, tôi vào Team → "Vai trò":
  - thấy 4 mẫu khóa (Admin, Estimator, Viewer, Dealer) và các vai trò tôi đã tạo;
  - tạo vai trò "Sales nội bộ" bằng cách tick: xem/sửa/gửi quote, thấy giá bán, xem mọi quote; không thấy BOM, không thấy margin;
  - gán vai trò đó cho nhân viên khi mời hoặc sau đó.
- Là **company admin**, tôi tạo vai trò mới từ một mẫu ("Nhân bản Dealer") rồi tick thêm hoặc bớt quyền.
- Là **dealer**:
  - tôi đăng nhập bằng mã công ty, username và mật khẩu như mọi nhân viên;
  - tôi lập quote, thấy giá bán, in và gửi;
  - tôi chỉ thấy quote mình tạo;
  - tôi không thấy BOM, .vqu, cut list khung, punching, giá vốn hay margin.
- Là **nhân viên có vai trò bị sửa**, quyền mới có hiệu lực ngay ở request kế tiếp, không cần đăng nhập lại.

## Dữ kiện (đã kiểm tra 2026-11-17)

| Điều | Ở đâu |
|---|---|
| Vai trò là một danh sách cố định: `company_admin`, `estimator`, `viewer` | [roles.ts:19](../../packages/contracts/src/roles.ts:19) |
| Capability được giải ở đúng 4 chỗ: guard, danh sách trả cho UI, hai cờ của evaluate | [guard.ts:49](../../apps/api/src/lib/guard.ts:49), [auth.ts:92](../../apps/api/src/routes/auth.ts:92), [evaluations.ts:380](../../apps/api/src/routes/evaluations.ts:380), [:383](../../apps/api/src/routes/evaluations.ts:383) |
| Một chỗ so sánh **tên vai trò**: giá bán trong header quote | [quotes.ts:143](../../apps/api/src/routes/quotes.ts:143) |
| Cột `memberships.role` là TEXT, **không có CHECK** | [001_init.sql:64](../../packages/db/migrations/001_init.sql:64) |
| Request mời hoặc đổi vai trò được kiểm bằng `z.enum(COMPANY_ROLES)` | [auth.ts:234](../../packages/contracts/src/auth.ts:234) |
| Mời và đổi vai trò cần `members:manage` | [settings.ts:183](../../apps/api/src/routes/settings.ts:183) và các dòng sau |
| Nhãn và mô tả vai trò ở UI | [TeamPage.tsx:36](../../apps/client/src/components/workspace/TeamPage.tsx:36), [:45](../../apps/client/src/components/workspace/TeamPage.tsx:45) |
| `quotes.created_by` lưu `session.userId` khi tạo | [quotes.ts:324-334](../../apps/api/src/routes/quotes.ts:324) |
| Lịch sử revision trả giá vốn và khối lượng cho mọi `quote:read` | [quotes.ts:167-178](../../apps/api/src/routes/quotes.ts:167) |
| BOM sheet, CSV, schedule cần `cost:read` | [bomExport.ts:86](../../apps/api/src/routes/bomExport.ts:86), [:114](../../apps/api/src/routes/bomExport.ts:114), [:145](../../apps/api/src/routes/bomExport.ts:145) |
| File .vqu cần `cost:read` | [vquExport.ts:24](../../apps/api/src/routes/vquExport.ts:24) |
| Cut list khung và punching theo `cost:read`; dòng BOM và giá nội bộ theo `cost:margin` | [evaluations.ts:383-406](../../apps/api/src/routes/evaluations.ts:383) |
| Tài liệu in không bao giờ chứa BOM hay giá vốn | [projection.ts:6](../../packages/core/src/lib/documents/projection.ts:6) |
| Link BOM và .vqu ở client | [DocumentActions.tsx:220](../../apps/client/src/components/workspace/DocumentActions.tsx:220), [:230](../../apps/client/src/components/workspace/DocumentActions.tsx:230) |
| Desktop không có vai trò dealer: chỉ có `DealerLogoPath` (logo) và cờ `IsDealerApproved` không ai đọc | `AdminService.cs:138`, `Quotation.cs:296` |

Phiên đọc vai trò từ đâu, và có cache hay không: *chưa kiểm tra*. Xem `apps/api/src/lib/sessions.ts` trước khi viết plan.

## Mô hình

### Danh mục capability (cố định trong code)

| Capability | Nhãn trong ô tick | Cấp được cho vai trò tùy biến? |
|---|---|---|
| `quote:read` | Xem quote | ✓ |
| `quote:write` | Tạo và sửa quote | ✓ (cần `quote:read`) |
| `quote:send` | Gửi quote cho khách | ✓ (cần `quote:read`) |
| `quote:all` | Xem quote của mọi người | ✓ (cần `quote:read`) |
| `cost:read` | Thấy giá bán | ✓ |
| `cost:margin` | Thấy giá vốn và margin | ✓ (cần `cost:read`) |
| `bom:read` | Thấy BOM, .vqu, cut list, punching | ✓ |
| `price:manage` | Sửa giá của công ty | ✓ |
| `request:manage` | Xử lý yêu cầu báo giá | ✓ |
| `usage:read` | Xem thống kê sử dụng | ✓ |
| `members:manage` | Quản lý thành viên và vai trò | **Không** — chỉ mẫu Admin |
| `settings:manage` | Sửa cài đặt công ty | **Không** — chỉ mẫu Admin |

Hai quyền cuối không cấp được qua vai trò tùy biến. Lý do: người được cấp `members:manage` có thể tự nâng quyền của mình.

### Mẫu khóa

Bảng capability của 4 mẫu nằm trong [quote-tiers.md](quote-tiers.md#mô-hình-chung). Các mẫu sống trong code (`roles.ts`), không nằm trong DB, nên không ai sửa hay xóa được.

### Lưu trữ (migration `019_company_roles.sql`)

```sql
CREATE TABLE company_roles (
  id                TEXT PRIMARY KEY,           -- uuid do app sinh
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  description       TEXT,
  capabilities_json TEXT NOT NULL,              -- mảng capability, đã kiểm theo danh mục
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);
ALTER TABLE memberships ADD COLUMN role_id TEXT REFERENCES company_roles(id);
```

- `memberships.role` vẫn giữ tên mẫu (`company_admin` | `estimator` | `viewer` | `dealer`), hoặc giá trị `'custom'` khi `role_id` có giá trị.
- Giữ cột `role` cũ để các truy vấn và báo cáo hiện có không vỡ. Bảng `tenants` có đúng tên đó không — *chưa kiểm tra*.

### Giải capability

- Một hàm duy nhất `resolveCapabilities(membership, customRole?)`:
  - mẫu khóa → bảng trong code;
  - `'custom'` → `capabilities_json`, giao với danh mục và bỏ hai quyền chỉ-Admin;
  - giá trị lạ hoặc `role_id` trỏ tới vai trò không còn → **không có quyền nào** (fail closed).
- Gọi lúc nạp phiên ở mỗi request. Gắn kết quả vào `session.capabilities`. Cách nạp: JOIN `company_roles` trong truy vấn phiên.
- Sửa 4 chỗ giải capability, cộng chỗ ở `quotes.ts:143`, để đọc `session.capabilities` thay vì tra theo tên vai trò.
- `companyCan(role, cap)` cũ: giữ cho test và code dùng mẫu, hoặc đổi chữ ký thành `can(session, cap)`. Plan sẽ chọn.

### Quy tắc khi sửa vai trò

- Lưu thì kiểm: capability nằm trong danh mục, đủ phụ thuộc (bảng trên), không có quyền chỉ-Admin, tên không trùng trong công ty.
- Xóa vai trò đang có người dùng → **409**, kèm số người đang dùng.
- Mọi thao tác tạo, sửa, xóa vai trò và đổi vai trò của một người đều ghi `audit_events`.
- Admin không tự hạ vai trò của chính mình nếu đó là admin cuối cùng. Kiểm tra xem quy tắc này đã có ở `settings.ts` chưa — *chưa kiểm tra*.

## Thay đổi, chia ba lát

### (A) Tách quyền và bịt lộ dữ liệu

Không đổi hành vi của vai trò hiện có, trừ hai chỗ lộ. Lát này đáng làm ngay.

1. **Thêm `bom:read`** vào [roles.ts](../../packages/contracts/src/roles.ts), cấp cho `company_admin` và `estimator`. Đổi sang `bom:read` ở:
   - [bomExport.ts:86](../../apps/api/src/routes/bomExport.ts:86), [:114](../../apps/api/src/routes/bomExport.ts:114), [:145](../../apps/api/src/routes/bomExport.ts:145);
   - [vquExport.ts:24](../../apps/api/src/routes/vquExport.ts:24);
   - `canSeeDesign` ở [evaluations.ts:383](../../apps/api/src/routes/evaluations.ts:383).

   Sửa luôn chú thích ở [evaluation.ts:266](../../packages/contracts/src/evaluation.ts:266) và [:274](../../packages/contracts/src/evaluation.ts:274). Từ đây `cost:read` chỉ còn nghĩa **giá bán**. Ghi một dòng vào `docs/DECISIONS.md`.
2. **[quotes.ts:143](../../apps/api/src/routes/quotes.ts:143):** bỏ `session.role !== 'viewer'`, tách thành hai cờ:
   - `canSeePrice` (`cost:read`) cho `contractCents` và `pricing`;
   - `canEdit` (`quote:write`) cho `config`.

   Kiểm tra trong `pricing` có field nội bộ nào không — *chưa kiểm tra*. Nếu có, lọc bằng `withoutInternalPrice` như ở [evaluations.ts:390](../../apps/api/src/routes/evaluations.ts:390).
3. **Revisions, [quotes.ts:167-178](../../apps/api/src/routes/quotes.ts:167):**
   - `total_cost_cents` và `price_json` chỉ trả khi có `cost:margin`;
   - `contract_cents` chỉ trả khi có `cost:read`;
   - `total_mass_kg` và `bom_hash` chỉ trả khi có `bom:read`.

   Client đọc những field nào trong revisions — *chưa kiểm tra*. Tìm trước khi đổi để UI không vỡ.
4. **Thêm `quote:all`** cho `company_admin`, `estimator` và `viewer`. Thêm helper `apps/api/src/lib/quoteScope.ts`:

   ```ts
   /** WHERE fragment + params that limit a quote query to what this session may see. */
   export function quoteScope(session: CompanySession, alias = ''): { sql: string; params: unknown[] }
   // → "q.tenant_id = ?"                         khi có quote:all
   // → "q.tenant_id = ? AND q.created_by = ?"   khi không có
   ```

   **Mọi** truy vấn đọc hoặc sửa một quote theo id đi qua helper này. Danh sách hiện có (grep `FROM quotes` và `quote_id = ?`, 2026-11-17):
   - `quotes.ts` dòng 64 (danh sách), 127, 198, 281, và các truy vấn theo `quote_id`;
   - `evaluations.ts:539`, và `evaluations.ts:452` (hiện **thiếu cả `tenant_id`** — kiểm tra xem đó có phải đường nội bộ không);
   - `quoteFile.ts:74`;
   - `send.ts:236`;
   - `shares.ts` (theo `quote_id`);
   - `bomExport.ts` (theo `quote_id`);
   - `vquExport.ts:46`;
   - `shedsafe.ts` dòng 517, 552, 706;
   - `documents.ts` — đọc quote qua đường nào thì *chưa kiểm tra*.

   Bỏ qua `admin.ts:79` (đếm cho vendor) và `lib/mail/queue.ts:344` (job nền, không có phiên). Quote ngoài phạm vi trả **404**, không phải 403, để không tiết lộ là quote đó tồn tại.
5. **Che UI** (chỉ là lịch sự — server đã chặn):
   - link BOM, CSV, schedule và .vqu trong [DocumentActions.tsx](../../apps/client/src/components/workspace/DocumentActions.tsx) theo `bom:read`;
   - `SteelworkPanel`, `PunchingPanel` và `FrozenSteelwork` đã tự ẩn khi danh sách rỗng;
   - margin ở bước Cost đã theo `cost:margin` ([QuoteEditor.tsx:1139](../../apps/client/src/components/editor/QuoteEditor.tsx:1139)).

### (B) Mẫu `dealer`

- Thêm `'dealer'` vào `COMPANY_ROLES`, với `quote:read`, `quote:write`, `quote:send` và `cost:read`. Không có các quyền còn lại.
- [TeamPage.tsx](../../apps/client/src/components/workspace/TeamPage.tsx): nhãn "Dealer", mô tả "Quotes and sends their own jobs with the sell price — no materials list, no cost, no other people's quotes."
- Lát này không cần migration, và đã đủ dùng nếu chưa làm (C).

### (C) Vai trò tùy biến

- Migration 019 như trên. Thêm `resolveCapabilities`, nạp lúc tạo phiên, và sửa 5 chỗ.
- **API** (cần `members:manage`, mọi truy vấn lọc theo `tenant_id`):

  | Route | Việc làm |
  |---|---|
  | `GET /roles` | Mẫu khóa (cờ `locked: true`) và vai trò của công ty, kèm số người đang dùng |
  | `POST /roles` | Tạo; body `{ name, description?, capabilities[], fromTemplate? }` |
  | `PATCH /roles/:id` | Sửa tên, mô tả, capability; mẫu khóa → 403 |
  | `DELETE /roles/:id` | Xóa; đang có người dùng → 409 |

  Request mời và đổi vai trò nhận `{ role: <mẫu> }` hoặc `{ roleId }`. Đổi `z.enum(COMPANY_ROLES)` ở [auth.ts:234](../../packages/contracts/src/auth.ts:234) cho phù hợp.
- **Client:** tab "Vai trò" trong Team:
  - danh sách vai trò (mẫu có biểu tượng khóa và nút "Nhân bản");
  - form gồm tên, mô tả và các ô tick nhóm theo Quote / Giá / Xưởng / Khác;
  - ô phụ thuộc tự tick hoặc bỏ tick (bỏ "Xem quote" thì bỏ luôn "Sửa", "Gửi" và "Xem mọi quote");
  - dropdown vai trò khi mời hoặc đổi người.
- `GET /auth/me` (hoặc route tương ứng ở [auth.ts:92](../../apps/api/src/routes/auth.ts:92)) trả `capabilities` đã giải, kèm `roleName` để hiện ở UI.

## Tiêu chí chấp nhận

1. **(A)** Admin, estimator và viewer thấy đúng như trước, trừ hai chỗ lộ đã bịt. `roles.test.ts` vẫn xanh.
2. **(A)** Revisions không trả `total_cost_cents` hay `price_json` cho người không có `cost:margin`. Header quote không trả giá cho người không có `cost:read`.
3. **(A/B)** Dealer tạo quote, chạy `/evaluate`, thấy giá bán, in quotation và contract, gửi email cho khách.
4. **(B)** Với dealer:
   - BOM sheet, CSV, schedule và .vqu trả **403**;
   - `/evaluate` trả `members: []`, `punchings: []`, `lines: []`, không có field giá nội bộ.
5. **(A/B)** Dealer A không đọc, sửa, gửi, chia sẻ, xuất hay in được quote của dealer B: mọi route trả **404**. Danh sách của A chỉ có quote của A. Admin và estimator thấy tất cả.
6. **(C)** Admin tạo vai trò "Xem giá, không BOM, mọi quote" và gán cho một người. Người đó thấy giá và mọi quote, bị 403 ở BOM. Admin bỏ tick "Thấy giá bán" → request kế tiếp của người đó không còn giá.
7. **(C)** Không tạo được vai trò có `members:manage` hay `settings:manage`, hoặc thiếu phụ thuộc (400). Không sửa được mẫu khóa (403). Xóa vai trò đang dùng trả 409.
8. **(C)** Vai trò của công ty A không thấy và không gán được ở công ty B. [isolation.test.ts](../../apps/api/src/__tests__/isolation.test.ts) có thêm `company_roles`.
9. **(C)** Membership trỏ tới vai trò không tồn tại thì không có quyền nào.
10. Test mới:
    - `quoteScope.test.ts`: từng route trong danh sách mục (A)4, với hai dealer;
    - `customRoles.test.ts`: tiêu chí 6–9.
11. `pnpm typecheck` và `pnpm test` xanh.

## Câu hỏi mở (có mặc định)

- **Danh bạ khách hàng:** người không có `quote:all` có thấy khách của người khác không? Mặc định giai đoạn 1: **có** (biết là hở). Muốn đóng thì thêm `customers.created_by` và dùng cùng helper phạm vi.
- **Dealer có giá riêng không?** Ví dụ giảm giá dealer hoặc margin cố định. Mặc định: để giai đoạn 3.
- **Chuyển quote khi một người nghỉ** (đổi `created_by`): chưa làm.
- **Logo dealer trên tài liệu**, như `DealerLogoPath` của desktop: ngoài phạm vi.
- **Vai trò tùy biến có cấp được ở cấp platform** (vendor soạn sẵn cho mọi công ty) không? Mặc định: không. Mỗi công ty tự soạn, và mẫu khóa là phần dùng chung.
