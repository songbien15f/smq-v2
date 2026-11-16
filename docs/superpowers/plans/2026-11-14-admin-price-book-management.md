# Quản lý price book trên Admin site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bỏ hẳn app desktop khỏi việc quản lý giá. Vendor sửa **book tổng** trên admin site. Mỗi công ty có
**book công ty** kế thừa book tổng và sửa riêng được. Giá tính **giống hệt desktop v1**.

**Architecture:**
- **Book bất biến, định danh bằng hash** (A4). Sửa = ghi vào **bản nháp** trong DB ứng dụng. Publish = tạo
  **book phái sinh**: chép file cha, áp các thay đổi trong một transaction, cập nhật các bảng `view_*`, tính
  hash mới.
- **Book tổng (master)** = dump ban đầu + chuỗi các lần publish của vendor. Có một con trỏ "master active".
- **Book công ty** = `derive(master đang active, danh sách thay đổi đã publish của công ty)`.
  - Khi master đổi, mọi book công ty được dựng lại. Ô công ty đã sửa thì giữ, ô còn lại nhận giá master mới.
  - Công ty chưa sửa ô nào thì dùng thẳng master, không tạo file.
- Revision ghi `price_book_hash` = hash book công ty. Hash này đủ để tái tạo giá, nên `override_version`
  không còn cần cho revision mới.

**Tech Stack:** TypeScript, Fastify (`apps/api`), `node:sqlite` cho file book (`packages/core/src/lib/pricing`),
adapter DB tự viết (`packages/db`, Postgres | SQLite), zod (`packages/contracts`), Next.js (`apps/admin`), vitest.

**Spec:** `docs/reviews/2026-11-14-admin-site-gap-review.md`
- §5 là các quyết định **đã chốt 2026-11-14**.
- §4.1 là cách desktop tính margin, có file:line.

## Global Constraints

- **A4:** không sửa một file `data/price-books/<hash>.db` đã có. Mỗi lần publish ra một file mới.
- **A9/A13:** `@sq/core` không import DB ứng dụng, HTTP hay tenancy, và mọi phép tính giá nằm ở core.
  `derive*` nằm trong core và chỉ làm việc với file book cùng danh sách thay đổi truyền vào.
- **SQL dùng tập con mà cả hai driver chạy được:**
  - placeholder `?`;
  - không viết `? IS NULL` (A20), không dùng `?|` hay `??` (A12);
  - id là TEXT uuid; thời gian là ISO-8601 TEXT; boolean 0/1; tiền là cents nguyên.
- **Migration:** file mới bắt đầu từ `017`. Không sửa file cũ vì runner kiểm checksum.
- **Biến môi trường mới:** thêm vào `turbo.json` `globalPassThroughEnv`.
- **Tên bảng và tên cột không bao giờ lấy từ input.** Luôn tra trong registry (Task 4) rồi dùng chuỗi của registry.
- **Quyền:**
  - Book tổng (đọc/sửa/publish/activate): `platform:pricebooks`.
  - Book công ty trên admin: `platform:pricebooks`, kèm `tenantId` trên đường dẫn.
  - Sửa margin từng báo giá: `cost:margin`.
- **Audit:** mọi hành động ghi đều có audit, gồm:
  - `pricebook.draft.create`, `pricebook.draft.change`, `pricebook.draft.discard`;
  - `pricebook.publish`, `pricebook.activate`;
  - `company.pricebook.publish`, `company.pricebook.rebase`.
- **Không chép mô hình bảo mật của desktop:**
  - không mã cố định, không khoá nằm trong mã nguồn;
  - không chép mật khẩu DB desktop vào repo;
  - import không được "drop table rồi insert".
- **Mọi task có SQL mới chạy test trên cả hai driver:** SQLite mặc định và Postgres
  (`TEST_DB_DRIVER=postgres TEST_DATABASE_URL=…`, tên DB chứa `test`).
- **Bẫy repo:**
  - Dùng `localhost`, không dùng `127.0.0.1`.
  - Sửa package thì build lại `dist` (`pnpm build:inc`).

## Review Focus

1. **Revision cũ sau khi master đổi hoặc công ty dựng lại book.** Mở và in lại một revision đã lưu phải ra
   đúng con số cũ. Test ở Task 1 và Task 7.
2. **Dựng lại book công ty khi master và công ty cùng sửa một ô.** Giá của công ty phải thắng, và ô đó phải
   hiện trong danh sách "xung đột" để vendor xem. Ô công ty không sửa phải nhận giá master mới. Test ở Task 7.
3. **Giá trị nhập bậy.** Các trường hợp: số âm, chữ, `NaN`, số quá lớn, khoá dòng không tồn tại, cột ngoài
   whitelist, tên bảng như `"cost_frame; DROP TABLE x"` hoặc `sqlite_master`. Phải bị từ chối với lỗi theo từng
   ô và không ghi gì. Test ở Task 4 và Task 5.
4. **Rò rỉ giữa các công ty.** Công ty A không bao giờ được thấy hay dùng book hoặc thay đổi của công ty B.
   Test ở Task 7 và trong `isolation.test.ts`.
5. **Giá không khớp desktop.** Mọi báo giá mẫu `.sqd` phải ra tổng bằng công thức desktop, sai số tối đa 1
   cent, trừ các dòng đã ghi trong `KNOWN-DEVIATIONS.md`. Test ở Task 2.

---

## Phase A — Book tổng, book công ty, giá giống desktop

### Task 0: Việc phải làm trước khi bỏ desktop + ADR

**Files:**
- Modify: `tools/price-dump/DumpAll.cs`
  - Thêm bước ghi `_views.sql`: với mỗi dòng của
    `SELECT name, sql FROM sqlite_master WHERE type='view'`, ghi `-- <name>` rồi đến `<sql>;`.
  - Không đổi phần còn lại.
- Create: `packages/core/src/lib/pricing/bookViews.sql`, chép từ `_views.sql` của lần dump cuối.
- Modify: `docs/DECISIONS.md`, thêm **A21 "Book phái sinh: book tổng và book công ty"**:
  - hash = sha256(parentHash + JSON chuẩn của danh sách thay đổi đã sắp xếp);
  - `price_books` có thêm `parent_hash`, `origin` (`dump` | `master` | `company`), `tenant_id`;
  - book công ty được dựng lại khi master đổi.
- Modify: `docs/DECISIONS.md`, thêm **A22 "Margin giống desktop"**:
  - margin = hệ số (structure × state) của book công ty, không có dòng thì = 1;
  - bỏ `settings.margin`.

- [ ] **Step 1:** Chủ sản phẩm chạy `tools/price-dump/run.sh` (đã thêm bước view) trên máy desktop **một lần
  cuối**. Ghi ngày chạy và hash book vào `docs/OPERATIONS.md`.
- [ ] **Step 2:** Chép `_views.sql` vào `bookViews.sql`.
  - Chạy thử: tạo DB tạm từ book `fe5a7cae…`, xoá 7 bảng `view_*`, chạy `bookViews.sql`, rồi so từng view với
    bảng vật chất hoá cũ bằng `SELECT * … EXCEPT SELECT * …` theo **cả hai chiều**.
  - Kỳ vọng: 0 dòng lệch cho cả 7 view.
  - Nếu lệch thì ghi vào ledger và dừng Task 10 (Task 0–9 không phụ thuộc vào bước này).
- [ ] **Step 3:** Đọc `CostView.State.cs:30-40` của desktop: cờ `b` (ai thấy được ô Margin) lấy từ đâu. Ghi
  file:line vào review §4.1. Kết quả quyết định capability của Task 2 (mặc định là `cost:margin`).
- [ ] **Step 4:** Commit `docs: A21 derived master/company books, A22 desktop margin; capture desktop view SQL`.

### Task 1: Một con trỏ master + kích hoạt lại master cũ

Đóng L2 và L7.

**Files:**
- Modify: `apps/api/src/lib/priceBook.ts`:
  - Thêm `activateMaster`.
  - Đổi tên ngữ nghĩa `activeBookHash` thành `activeMasterHash`, giữ tên cũ làm alias cho tới Task 7.
- Modify: `apps/api/src/routes/priceBooks.ts`.
- Test: `apps/api/src/__tests__/priceBookActivate.test.ts`

**Interfaces:**
- Produces: `activateMaster(db: AppDb, hash: string, actor: { userId: string; email: string }): Promise<PriceBookSummary>`.
  - Kiểm `hash` khớp `^[0-9a-f]{64}$`, có file và có dòng `price_books` với `origin IN ('dump','master')`.
    Nếu không thì ném `BookMissingError`.
  - UPSERT `price_book_active('singleton')`.
  - `active.json` chỉ còn là **bản sao** của giá trị trong DB: ghi bằng `activateBook(hash, dir)`
    (`packages/core/src/lib/pricing/publish.ts:415`).
  - Từ Task 7 trở đi, hàm này gọi thêm `rebaseAllCompanies`.
- Produces: `POST /admin/price-books/:hash/activate`.
  - Trả `200 { activeHash }` hoặc `404 { error: 'book_missing' }`.
  - Ghi audit `pricebook.activate { from, to }`.

- [ ] **Step 1: Viết test thất bại.**
  - `activates an older master and records the audit`
  - `refuses an unknown or malformed hash` (404 / 400)
  - `platform_support gets 403`
  - `an old revision keeps its own book after activation` — lưu với A, activate B, GET BOM của revision:
    `price_book_hash === A` và tổng không đổi. (Review Focus 1)
- [ ] **Step 2:** Run `pnpm --filter @sq/api exec vitest run src/__tests__/priceBookActivate.test.ts`. Expected: FAIL (404 route).
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** PASS trên SQLite và Postgres.
- [ ] **Step 5:** Commit `feat(api): activate any published master price book`.

### Task 2: Tính giá giống desktop (L1)

**Files:**
- Modify: `apps/api/src/routes/evaluations.ts:297-316`.
  - Truyền `policy.marginFor = (n) => lookup.margin(n.structureId, n.state)`.
  - `policy.margin` = margin riêng của báo giá nếu có, nếu không thì `1`.
  - **Tạm thời** giữ `settings.margin` khi công ty đã đặt, để không đổi giá của công ty đó trước khi Task 7
    chuyển nó thành hệ số trong book công ty. Ghi dòng tạm vào `KNOWN-DEVIATIONS.md`; Task 7 sẽ xoá dòng này.
- Modify: `packages/core/src/lib/estimating/evaluate.ts:61-64`.
  - Thứ tự ưu tiên: margin riêng của báo giá (nếu người có quyền đặt), rồi `marginFor`, rồi `policy.margin`.
- Modify: `packages/contracts/src/` (schema request evaluate/save): thêm trường tuỳ chọn `marginOverride?: number`.
  - API chỉ nhận trường này khi người gọi có `cost:margin`. Người khác gửi lên thì bị bỏ qua và ghi audit.
  - Giới hạn 1–10, giống kiểm tra ở `settings.ts:154`.
- Modify: `apps/client/src/components/editor/CostPanel.tsx`.
  - Hiện "Margin: <giá trị> (hệ thống: <hệ số>)", giống `CostView.Save.cs:131-136`.
  - Người có `cost:margin` sửa được ô margin.
  - Nút **Default** bật khi margin ≠ hệ số (`CostView.State.cs:618`).
- Create: `packages/core/scripts/parity.ts` và `packages/core/src/lib/estimating/__tests__/desktopParity.test.ts`.
- Modify: `docs/PRICING-PIPELINE.md:30,261`, `docs/smartquote-quote-editor-reference.md:2671`, comment
  ở `evaluations.ts:297-299`.

**Interfaces:**
- Consumes: `lookup.margin(structureId, state): number`. Hàm này trả 1 khi không có dòng, đúng như desktop
  (`lookup.ts:745-751`).
- Produces: `desktopCustomerTotal(q: DesktopTotalsInput): number`, chỉ dùng trong test. Nó chép nguyên công
  thức ở `PriceController.cs:443-480`:
  ```
  base = buildingBaseCost (+ shedSafeFee nếu version file không bắt đầu bằng "2") + miscOptionsPrice
  num1 = base × margin + exChargeNotes + engineeringCharges      (hai khoản cuối chỉ khi có misc options)
  total = (num1 × 1.1 + delivery) × (1 + customerRate/100) + Σ (qty × unit × 1.1) của distributor options
  ```

- [ ] **Step 1: Viết test thất bại.**
  - `uses the book coefficient for structure × state` — chọn một cặp có hệ số ≠ 1 trong book `fe5a7cae…`
    (bảng có 88 dòng, 11 structure × 8 state); khi đó total = cost × hệ số.
  - `falls back to 1, not 1.48, when the pair has no row`.
  - `a cost:margin holder's per-quote margin wins; an estimator's is ignored`.
  - `matches the desktop customer total for every golden .sqd within 1 cent`.
    - Duyệt các `.sqd` mẫu mà `scripts/golden.ts --sqd` đang dùng, so `evaluateQuote` với
      `desktopCustomerTotal`.
    - File nào lệch vì một dòng đã có trong `KNOWN-DEVIATIONS.md` thì ghi tên dòng đó vào danh sách cho phép.
      (Review Focus 5)
- [ ] **Step 2:** Run `pnpm --filter @sq/core exec vitest run src/lib/estimating/__tests__/desktopParity.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Cài đặt.
  - Lệch nào ngoài margin (GST, delivery, customer rate, distributor) thì sửa v2 cho khớp desktop.
  - Không sửa v2 nếu lệch đó là một dòng KNOWN-DEVIATIONS có chủ đích (lỗi BOM của desktop: sửa chứ không chép, A8).
- [ ] **Step 4:** PASS. Ghi bảng trước/sau của `golden.ts` vào mô tả commit, và ghi vào CHANGELOG: **giá báo
  giá mới thay đổi**. Revision cũ đọc `bom_json` đã lưu nên không đổi.
- [ ] **Step 5:** Commit `fix: price with the desktop's structure × state coefficient and per-quote margin`.

### Task 3: Cổng lưu revision kiểm book đã đổi

Đóng L3 (D7).

**Files:**
- Modify: `apps/api/src/routes/evaluations.ts:460-499`.
- Modify: phần xử lý lỗi lưu ở `apps/client/src/components/editor/` (nơi đang xử lý lỗi lệch override version).
- Test: `apps/api/src/__tests__/saveGateBook.test.ts`

**Interfaces:**
- Consumes: `priceBookHash` của lần evaluate.
  - Response evaluate đã có hash này.
  - Nếu request lưu chưa mang thì thêm trường đó vào schema lưu trong `@sq/contracts`.
- Produces: `409 { error: 'price_book_changed', activeHash }` khi hash khác book hiện hành của công ty.
  - Từ Task 7, book hiện hành là `companyBookHash(db, tenantId)`; trước đó là master.

- [ ] **Step 1: Viết test thất bại.**
  - `refuses to save when the book changed after evaluation`
  - `saves after re-evaluating`
- [ ] **Step 2:** Run `pnpm --filter @sq/api exec vitest run src/__tests__/saveGateBook.test.ts`. Expected: FAIL (201).
- [ ] **Step 3:** Cài đặt. Phía client hiện thông báo "The price book was just updated. Re-price, then save."
  kèm nút tính lại.
- [ ] **Step 4:** PASS trên cả hai driver. `pnpm --filter @sq/client typecheck` sạch.
- [ ] **Step 5:** Commit `fix(api): refuse to save a revision priced on a replaced book`.

### Task 4: Registry bảng + trình duyệt book chỉ đọc

**Files:**
- Create: `packages/core/src/lib/pricing/bookTables.ts`
- Create: `packages/core/src/lib/pricing/bookBrowser.ts`
- Modify: entry export `pricing` của core.
- Modify: `apps/api/src/routes/priceBooks.ts`.
- Test: `packages/core/src/lib/pricing/__tests__/bookBrowser.test.ts`, `apps/api/src/__tests__/priceBookBrowse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ColumnKind = 'cents' | 'decimal' | 'mass' | 'int' | 'text' | 'bool';
  export interface BookColumn { name: string; kind: ColumnKind; min?: number; max?: number; companyEditable: boolean }
  export interface BookTable { name: string; key: string[]; columns: BookColumn[]; views: string[] }
  export const BOOK_TABLES: readonly BookTable[];
  export type RowKey = Record<string, string | number>;
  export function tableSpec(name: string): BookTable;            // ném lỗi nếu tên không có trong registry
  export function listBookTables(db: DatabaseSync): { table: string; rows: number }[];
  export function readBookRows(db: DatabaseSync, q: { table: string; search?: string; offset: number; limit: number }):
    { columns: BookColumn[]; rows: Record<string, unknown>[]; total: number };
  ```
- **Danh sách bảng:**
  - 21 bảng của `AdminManageManterial.cs:115-141`: cost_frame, material_sheeting, cost_sheeting, cost_haunch,
    cost_apex, cost_bracket, setting_price_coeffcient, cost_bolt, screws, material_window, cost_bracing,
    delivery_data, downpipe, flashing, gutter, misc_option, padoor, cost_purlin, roller_door, skylight,
    sliding_door.
  - **Đối chiếu từng tên với `bookColumns(db)` (`publish.ts:188`)** trên book thật. Tên nào không có trong
    book thì ghi vào ledger, không đoán.
- **Khoá dòng:**
  - Mặc định `['id']`.
  - `setting_price_coeffcient` có khoá `['structure_id','state_code']`, vì trong book bảng này không có cột id
    và không có PK (đã kiểm). Bảng nào không có cột `id` thì phải khai báo khoá riêng; test ở Step 1 sẽ đỏ nếu
    thiếu.
- **`views`:** các bảng `view_*` lấy dữ liệu từ bảng này.
  - Đã biết: `cost_sheeting` → `view_cost_sheeting`, `material_window` → `view_cost_window`.
  - Phần còn lại đọc từ `bookViews.sql` (Task 0).
- **`companyEditable`:** chỉ đúng cho cột giá, khối lượng và `price_coeffcient`.
- **`readBookRows`:** `limit` tối đa 200 (`MAX_PAGE`, `catalogue.ts:56`). `search` là `LIKE ?` trên các cột
  `text`.

- [ ] **Step 1: Viết test thất bại (core).**
  - `lists registry tables with row counts`
  - `pages and searches`
  - `refuses "cost_frame; DROP TABLE x" and "sqlite_master"` (Review Focus 3)
  - `every registry table and column exists in the licensed book, and every key is unique there`
    (bỏ qua nếu không có file book)
- [ ] **Step 2:** Run `pnpm --filter @sq/core exec vitest run src/lib/pricing/__tests__/bookBrowser.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Cài đặt core rồi `pnpm --filter @sq/core build`.
- [ ] **Step 4:** Thêm route API:
  - `GET /admin/price-books/:hash/tables`
  - `GET /admin/price-books/:hash/tables/:table/rows`

  Test: 403 với `platform_support`, 404 với hash lạ, 200 kèm đúng shape. Run và PASS.
- [ ] **Step 5:** Commit `feat(core,api): book table registry and read-only browser`.

### Task 5: `derivePriceBook` (core)

**Files:**
- Create: `packages/core/src/lib/pricing/derive.ts`
- Test: `packages/core/src/lib/pricing/__tests__/derive.test.ts`

**Interfaces:**
- Consumes: `tableSpec`, `BOOK_TABLES` (Task 4); `openPublishedBook` (`publish.ts:309`).
- Produces:
  ```ts
  export type BookChange =
    | { op: 'set'; table: string; key: RowKey; column: string; value: number | string | boolean | null }
    | { op: 'insert'; table: string; row: Record<string, unknown> }      // dùng từ Task 10
    | { op: 'delete'; table: string; key: RowKey };                      // dùng từ Task 10
  export interface DerivedBook { hash: string; parentHash: string; changeCount: number }
  export function canonicalChanges(changes: BookChange[]): BookChange[];   // sắp theo (table, JSON(key), column, op)
  export function derivedHash(parentHash: string, changes: BookChange[]): string;
  export function validateChanges(db: DatabaseSync, changes: BookChange[], scope: 'master' | 'company'):
    { index: number; reason: string }[];
  export function derivePriceBook(parentHash: string, changes: BookChange[], root: string): DerivedBook;
  ```
- **`validateChanges`** từ chối các trường hợp sau:
  - bảng hoặc cột ngoài registry;
  - `scope === 'company'` mà cột không `companyEditable`, hoặc `op ≠ 'set'`;
  - giá trị sai kiểu, hoặc là số mà không `Number.isFinite`, hoặc ngoài `[min,max]`;
  - khoá không tồn tại;
  - trùng (table, key, column).
- **Thuật toán:**
  1. `derivedHash = sha256(parentHash + "\n" + JSON.stringify(canonicalChanges(changes)))`.
  2. Nếu `<hash>.db` đã có thì trả về luôn (idempotent).
  3. Chép file cha sang `<root>/.staging-<uuid>.db`, rồi `BEGIN`.
  4. Với mỗi `set`: `UPDATE <table> SET <column> = ? WHERE k1 = ? AND k2 = ?`. Tên bảng, cột, khoá đều lấy từ registry.
  5. **Cập nhật view:**
     - Nếu `bookViews.sql` có định nghĩa view thì `DELETE FROM view_x; INSERT INTO view_x SELECT … (SQL của view)`
       cho mọi view bị chạm.
     - Nếu chưa có (Task 0 Step 2 chưa xong) thì UPDATE cùng cột, cùng `id` trên view. Chỉ cho phép đường này
       với `set`.
  6. Ghi bảng `book_meta(parent_hash, change_count, derived_at)` → `COMMIT` → `rename` sang `<hash>.db`, rồi
     ghi `.meta.json`.
- Không động vào file cha và không động vào `active.json`.

- [ ] **Step 1: Viết test thất bại.**
  - `derivedHash is order-independent`
  - `the parent file is byte-identical after deriving` (so sha256 trước và sau)
  - `a cost_sheeting edit reaches view_cost_sheeting`
  - `a setting_price_coeffcient edit by composite key changes lookup.margin`
  - `createLookup on the derived book returns the new price`
  - `company scope refuses a description column and any insert/delete`
  - `rejects negative, NaN, unknown key, non-registry column with per-index reasons` (Review Focus 3)
  - `deriving twice returns the same hash without rewriting`
- [ ] **Step 2:** Run `pnpm --filter @sq/core exec vitest run src/lib/pricing/__tests__/derive.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** PASS, rồi build core.
- [ ] **Step 5:** Commit `feat(core): derive a price book from a parent and changes`.

### Task 6: Bản nháp book tổng (migration 017 + API)

**Files:**
- Create: `packages/db/migrations/017_price_book_drafts.sql`. Nếu `ALTER … ADD COLUMN … DEFAULT` khác nhau
  giữa hai driver thì tách thêm file vào `pg/` và `sqlite/`.
- Create: `apps/api/src/routes/priceBookDrafts.ts`, đăng ký trong `apps/api/src/app.ts` cạnh `registerPriceBooks` (`:158`).
- Modify: `apps/api/src/lib/priceBook.ts`, thêm `registerDerived(db, derived, { origin, tenantId?, actor, note })`.
- Modify: `packages/contracts/src/`, thêm zod cho draft và `BookChange`.
- Modify: `apps/api/src/__tests__/isolation.test.ts`. Bảng `price_book_drafts` có `tenant_id` nullable
  (null nghĩa là master). Thêm hai bảng mới vào cơ chế kiểm của test, kèm lý do.
- Test: `apps/api/src/__tests__/priceBookDrafts.test.ts`

**Schema 017:**
```sql
CREATE TABLE price_book_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                    -- NULL = bản nháp book tổng; có giá trị = bản nháp công ty (Task 7)
  base_hash TEXT NOT NULL,
  status TEXT NOT NULL,              -- 'draft' | 'published' | 'discarded'
  note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  published_hash TEXT
);
CREATE TABLE price_book_draft_changes (
  draft_id TEXT NOT NULL REFERENCES price_book_drafts(id),
  seq INTEGER NOT NULL,
  change_json TEXT NOT NULL,         -- một BookChange
  target TEXT NOT NULL,              -- table + JSON(key) + column, để upsert từng ô
  old_value_json TEXT,
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, target)
);
ALTER TABLE price_books ADD COLUMN parent_hash TEXT;
ALTER TABLE price_books ADD COLUMN origin TEXT NOT NULL DEFAULT 'dump';   -- 'dump' | 'master' | 'company'
ALTER TABLE price_books ADD COLUMN tenant_id TEXT;
```

**Routes** (book tổng; đều đòi `platform:pricebooks` và đều ghi audit):

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/admin/price-book-drafts` `{ baseHash, note }` | Trả 201 `{ id }`. |
| GET | `/admin/price-book-drafts` | Kèm `baseIsActive`. |
| GET | `/admin/price-book-drafts/:id` | |
| PUT | `/admin/price-book-drafts/:id/changes` `{ changes }` | Upsert theo `target` và ghi `old_value` từ book cha. Lỗi validate (`scope 'master'`) trả `422 { errors }` và không ghi gì. Draft không còn ở trạng thái `draft` thì trả 409. |
| DELETE | `/admin/price-book-drafts/:id/changes/:target` | |
| POST | `/admin/price-book-drafts/:id/discard` | |
| POST | `/admin/price-book-drafts/:id/publish` | Gọi `derivePriceBook`, rồi `registerDerived(origin 'master', parent_hash)`. **Không activate** (D6). Gọi lần hai trả cùng hash. |

- [ ] **Step 1: Viết test thất bại.**
  - `creates, edits, publishes a master book that is not active`
  - `publishing twice returns one hash and one price_books row`
  - `invalid cells give per-index errors and store nothing` (Review Focus 3)
  - `a draft on a no-longer-active base still publishes and is flagged`
  - `platform_support gets 403 everywhere`
- [ ] **Step 2:** Run `pnpm --filter @sq/api exec vitest run src/__tests__/priceBookDrafts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Viết migration, rồi routes.
- [ ] **Step 4:** PASS trên cả hai driver. Chạy lại `isolation.test.ts` và cũng phải PASS.
- [ ] **Step 5:** Commit `feat(api): master price book drafts and derived publication`.

### Task 7: Book công ty kế thừa book tổng (migration 018 + API + chuyển dữ liệu cũ)

**Files:**
- Create: `packages/db/migrations/018_company_price_books.sql`
- Create: `apps/api/src/lib/companyBook.ts`
- Create: `apps/api/src/routes/companyPriceBooks.ts`
- Modify: `apps/api/src/routes/evaluations.ts`:
  - mở `companyBookHash(db, tenantId)` thay cho master;
  - chỉ áp `withOverrides` với `custom`, không áp `overrides`.
- Modify: `apps/api/src/lib/priceBook.ts`. `activateMaster` gọi `rebaseAllCompanies` trong cùng request,
  rồi trả về số công ty đã dựng lại.
- Modify: `apps/api/src/lib/settings.ts`. Bỏ đọc `margin` sau khi đã chuyển dữ liệu (xem Step 4).
- Test: `apps/api/src/__tests__/companyBooks.test.ts`

**Schema 018:**
```sql
CREATE TABLE company_price_changes (       -- các thay đổi ĐÃ PUBLISH của công ty; là "phần riêng" được giữ khi dựng lại
  tenant_id TEXT NOT NULL, target TEXT NOT NULL, change_json TEXT NOT NULL,
  published_at TEXT NOT NULL, published_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, target)
);
CREATE TABLE company_price_book_active (
  tenant_id TEXT PRIMARY KEY, master_hash TEXT NOT NULL, book_hash TEXT NOT NULL, rebased_at TEXT NOT NULL
);
CREATE TABLE company_price_conflicts (     -- ô mà master đổi trong khi công ty đang giữ giá riêng
  tenant_id TEXT NOT NULL, target TEXT NOT NULL, master_hash TEXT NOT NULL,
  master_old_json TEXT, master_new_json TEXT, company_json TEXT NOT NULL, seen_at TEXT,
  PRIMARY KEY (tenant_id, target, master_hash)
);
```

**Interfaces:**
- Produces:
  - `companyBookHash(db, tenantId): Promise<string>`. Trả `book_hash` của công ty, hoặc master đang active
    khi công ty không có dòng.
  - `publishCompanyDraft(db, draftId, actor): Promise<{ hash: string }>`. Các bước:
    1. Gộp thay đổi của draft vào `company_price_changes` (theo `target`; giá trị bằng giá master thì xoá dòng).
    2. Gọi `derivePriceBook(master, all company changes)` với `scope 'company'`.
    3. `registerDerived(origin 'company', tenantId)`.
    4. UPSERT `company_price_book_active`.
    5. **Có hiệu lực ngay** cho công ty đó. D6 chỉ áp cho master, vì đây là book của riêng công ty và đã có
       bước xem trước ở Task 8.
  - `rebaseCompany(db, tenantId, newMaster, oldMaster): Promise<{ hash: string; conflicts: number }>`.
    - Derive lại từ `newMaster` cộng toàn bộ `company_price_changes`.
    - Với mỗi target mà giá trị ở `oldMaster` khác giá trị ở `newMaster`, ghi một dòng `company_price_conflicts`.
    - Thay đổi nào trỏ vào khoá đã bị xoá khỏi master (sau Task 10) thì bị loại, ghi conflict với
      `master_new_json = null`, và **không** làm hỏng việc dựng lại.
  - `rebaseAllCompanies(db, newMaster, oldMaster, actor)`. Chạy tuần tự cho mọi công ty có thay đổi, ghi audit
    `company.pricebook.rebase` cho từng công ty.
- Routes (đều đòi `platform:pricebooks`):
  - `POST /admin/companies/:tenantId/price-book-drafts`
  - các route con giống Task 6, nhưng validate với `scope 'company'`
  - `GET /admin/companies/:tenantId/price-book` (master đang dùng, hash, số ô riêng, số conflict chưa xem)
  - `GET /admin/companies/:tenantId/price-conflicts`
  - `POST …/price-conflicts/:target/resolve { keep: 'company' | 'master' }`. Chọn `master` thì xoá thay đổi
    riêng và dựng lại book.

- [ ] **Step 1: Viết test thất bại.**
  - `a company with no changes prices on the master directly`
  - `a published company change prices only that company` (Review Focus 4: công ty B vẫn giá master)
  - `activating a new master rebases: untouched cells follow the master, company cells stay, overlap becomes a conflict` (Review Focus 2)
  - `resolving a conflict to master removes the company cell and rebases`
  - `an old revision of the company still prints its old figures after a rebase` (Review Focus 1)
  - `company scope refuses non-price columns`
  - `tenant A cannot read tenant B's drafts, changes or conflicts`, kèm thêm vào `isolation.test.ts`
- [ ] **Step 2:** Run `pnpm --filter @sq/api exec vitest run src/__tests__/companyBooks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Viết migration, lib và routes; nối vào evaluate và cổng lưu (Task 3).
- [ ] **Step 4: Chuyển dữ liệu cũ.** Viết thành script idempotent `apps/api/scripts/migrate-company-prices.ts`,
  **không** đặt trong migration SQL vì cần đọc file book.
  - `price_row_overrides` (bản mới nhất của mỗi công ty): đổi mỗi `rowKey` thành `{op:'set', table, key, column}`.
    - Bảng nguồn lấy từ `CATALOGUE_SOURCES`, cột lấy từ cột cost của nguồn.
    - Đảo ngược `rowKeyOf` (`packages/core/src/lib/pricing/rowKeys.ts`). Viết hàm `rowKeyToBookKey` cạnh nó, có test.
  - `settings.margin` (khi công ty đã đặt): ghi `set price_coeffcient = margin` cho **mọi** dòng
    `setting_price_coeffcient`. Như vậy giá của công ty không đổi so với trước Task 2.
  - Dựng book cho từng công ty, rồi xoá `margin` khỏi settings và xoá dòng tạm trong `KNOWN-DEVIATIONS.md`.
  - Test: `the migration leaves every company's golden total unchanged`. Tính trước và sau trên một bộ báo giá
    mẫu cho mỗi công ty có override hoặc margin.
- [ ] **Step 5:** PASS trên cả hai driver.
- [ ] **Step 6:** Commit `feat(api): company price books inherit the master and keep their own cells`.

**Ngoài phạm vi task này (ghi ra để không quên):**
- `custom` rows (vật tư riêng của công ty, `overrides.ts:49`) vẫn đi qua `withOverrides` như cũ. Gộp chúng
  vào book công ty dưới dạng dòng thêm là việc sau Task 10.
- Bảng `price_row_overrides` và route `/admin/companies/:id/price-overrides` thành chỉ đọc. Xoá ở một lần dọn sau.
- **Dọn file:** mỗi book khoảng 3,3 MB. File book công ty mà không revision nào và không con trỏ nào tham chiếu
  có thể xoá. Việc này làm ở task vận hành riêng, chưa làm ở đây.

### Task 8: Xem trước tác động

**Files:**
- Modify: `apps/api/src/routes/priceBookDrafts.ts` và `companyPriceBooks.ts`. Thêm `POST …/:id/preview`.
- Test: thêm vào `priceBookDrafts.test.ts` và `companyBooks.test.ts`.

**Interfaces:**
- Bộ cấu hình mẫu là các template của vendor (`/admin/templates`), tối đa 50 template.
- Mỗi template được evaluate hai lần bằng `evaluateQuote` của core (A13): trên book cha và trên book nháp.
  - Book nháp được derive vào thư mục tạm, tính xong thì xoá.
  - Draft master: margin lấy từ bảng hệ số của chính book đó. Draft công ty: tính trên book công ty.
- Response: `{ rows: [{ templateId, name, baseTotalCents, draftTotalCents, deltaCents, deltaPct }], changedCells, companiesAffected? }`.
  - `companiesAffected` chỉ có ở draft master: số công ty sẽ phải dựng lại book, và số ô sẽ thành conflict.

- [ ] **Step 1: Viết test.**
  - `preview shows a delta for a template using the edited sheeting`
  - `preview leaves no file in the price-books directory`
  - `master preview counts companies whose cells would conflict`
- [ ] **Step 2:** Xác nhận FAIL, cài đặt, xác nhận PASS.
- [ ] **Step 3:** Commit `feat(api): impact preview for price book drafts`.

### Task 9: Excel export/import vào bản nháp (thay ExcelDataManagement của desktop)

**Files:**
- Create: `packages/core/src/lib/pricing/bookExcel.ts`. Dùng lại thư viện xlsx mà
  `apps/api/src/routes/priceImport.ts` đang dùng.
- Modify: hai file routes draft, thêm:
  - `GET /admin/price-books/:hash/export.xlsx?tables=`
  - `POST …/drafts/:id/import` (multipart)
- Test: `packages/core/src/lib/pricing/__tests__/bookExcel.test.ts`

**Interfaces:**
- Định dạng giữ như desktop (`ExcelDataManagement.cs:316,384-399`): mỗi bảng một sheet, **A1 = tên bảng**,
  **hàng 2 = tên cột**, dữ liệu bắt đầu từ hàng 3.
- `exportBookTables(db, tables): Buffer`.
- `diffWorkbook(db, buf, scope): { changes: BookChange[]; rejected: { sheet; row; column; reason }[] }`.
  - Chỉ sinh `set` cho những ô **khác** giá trị trong book.
  - Ô không được sửa trong `scope` thì vào `rejected` với lý do `not_editable`.
  - Sheet mang tên bảng ngoài registry thì bị loại cả sheet.
  - Dòng có khoá không tồn tại trong book:
    - `scope 'master'`: sinh `insert` sau khi Task 10 đã xong; trước đó thì `rejected` với lý do `insert_not_yet`.
    - `scope 'company'`: luôn `rejected`.

- [ ] **Step 1: Viết test.**
  - `round-trip with no edits yields zero changes`
  - `an edited price becomes one set`
  - `company scope rejects a description edit`
  - `an unknown sheet is rejected whole`
- [ ] **Step 2:** Xác nhận FAIL, cài đặt, xác nhận PASS.
- [ ] **Step 3:** Commit `feat: export and import price book tables through a draft`.

### Task 10: Thêm / xoá dòng ở book tổng (bậc 2 của D3)

**Chỉ làm khi Task 0 Step 2 cho kết quả 0 dòng lệch.**

**Files:**
- Modify: `packages/core/src/lib/pricing/derive.ts`. Cài `insert` và `delete`.
  - `insert` không có `id` thì tự cấp `max(id)+1`. Phải tất định: cấp theo thứ tự của `canonicalChanges`.
  - Mọi view bị chạm được dựng lại bằng `bookViews.sql`.
- Modify: `validateChanges`. `insert` phải có đủ các cột NOT NULL của registry. `delete` của một khoá đang có
  công ty sửa giá vẫn được phép, nhưng preview (Task 8) phải báo số công ty bị ảnh hưởng.
- Modify: route draft master, nhận `insert` và `delete`.
- Test: thêm vào `derive.test.ts`.

- [ ] **Step 1: Viết test.**
  - `inserting a window adds it to material_window and view_cost_window`
  - `deleting a row removes it from the views`
  - `a company change on a deleted key becomes a conflict on rebase` (thêm vào `companyBooks.test.ts`)
  - `ids assigned to inserts are deterministic`
- [ ] **Step 2:** Xác nhận FAIL, cài đặt, xác nhận PASS.
- [ ] **Step 3:** Commit `feat(core): insert and delete rows in a derived master book`.

### Task 11: Admin UI

**Files:**
- Modify: `apps/admin/src/app/api/sq/[...path]/route.ts:23-39`. Thêm `price-book-drafts` và `companies/*/price-*`
  vào allow-list.
- Modify: `apps/admin/src/components/PriceBookManager.tsx`:
  - thêm cột `origin` và `parent`;
  - nút **Activate** có hộp xác nhận nêu số công ty sẽ bị dựng lại book;
  - nút **New draft**.
- Create: `apps/admin/src/app/price-books/[hash]/page.tsx`. Trang duyệt book: danh sách bảng, lưới có phân
  trang và ô tìm kiếm.
- Create: `apps/admin/src/app/price-books/drafts/[id]/page.tsx`. Lưới sửa, panel "Changes (n)" hiện giá cũ → mới,
  các nút Preview, Export/Import, Publish, Discard, và banner khi book cha không còn active.
- Create: `apps/admin/src/app/company/[id]/prices/page.tsx`. Book công ty gồm:
  - master đang dùng, các ô riêng (giá master | giá công ty);
  - lưới chỉ cho sửa cột giá, kể cả bảng hệ số margin theo structure × bang;
  - tab **Conflicts** với hai nút "Giữ giá công ty" và "Theo master";
  - tạo draft, preview, publish.
- Thay `PriceOverridesPanel` bằng trang trên. Panel cũ chỉ còn để đọc lịch sử.
- Ẩn mọi nút ghi khi thiếu `platform:pricebooks`, theo cách các trang hiện có đang làm.

- [ ] **Step 1:** `pnpm --filter @sq/admin typecheck` và `pnpm --filter @sq/admin build` sạch.
- [ ] **Step 2: Smoke thủ công** (`pnpm dev`, `http://localhost:3062`):
  1. Tạo draft master, sửa một giá sheeting, Preview, Publish, Activate.
  2. Ở client (3061), tính lại một báo giá: thấy giá mới.
  3. Vào trang giá của một công ty, sửa hệ số cho (structure, NSW), Publish. Báo giá NSW của công ty đó đổi
     margin; công ty khác không đổi.
  4. Sửa master đúng ô hệ số đó, rồi Activate. Thấy một conflict, và công ty vẫn giữ giá riêng.
  5. Activate lại master cũ. Mở một revision cũ: con số không đổi.
- [ ] **Step 3:** (tuỳ chọn) Thêm spec Playwright cho bước 1. Dùng session đã lưu, không đăng nhập lại trong từng test.
- [ ] **Step 4:** Commit `feat(admin): master and company price books — browse, edit, preview, publish, roll back`.

### Task 12: Tài liệu — bỏ desktop khỏi quy trình

- [ ] `tools/price-dump/README.md`:
  - ghi rõ đây là **công cụ khởi tạo một lần** và đã chạy lần cuối ngày …;
  - sửa `:59-62` (thay `scripts/import-price-book.ts` / `data/pricing.db` bằng `pnpm publish-book` /
    `data/price-books/<hash>.db`).
- [ ] `docs/OPERATIONS.md`:
  - mục "Sửa giá": master gồm draft → preview → publish → activate → rollback; công ty gồm draft → publish và
    xử lý conflict;
  - kiểm lại câu ở `:19`.
- [ ] `apps/api/src/lib/priceBook.ts:16-17`: bỏ chữ "one company".
- [ ] `README.md`: bỏ "one company, one database" (đã sai từ A2).
- [ ] `docs/FEATURE-COVERAGE.md`, `docs/smartquote-quote-editor-reference.md` (phần margin), `CHANGELOG`.
- [ ] Commit `docs: price management without the desktop app`.

**Tuỳ chọn, ưu tiên thấp:** upload zip một bản dump mới qua admin (`POST /admin/price-books/upload`). Phải chặn
zip-slip: entry có `..`, đường dẫn tuyệt đối, hoặc symlink. Chỉ cần nếu sau này còn nguồn dump nào khác desktop.

---

## Phase B — Các khoảng trống khác của admin (mức task, chi tiết hoá khi bắt đầu)

| # | Task | Files chính | Test chốt |
|---|---|---|---|
| B0 | Xác nhận L5/L6 bằng test. Có thể bỏ nếu Task 7 đã chuyển `price_row_overrides` sang chỉ đọc. | `priceOverrides.test.ts` | — |
| B1 | Sửa quyền:<br>• nav Seats dùng `platform:seats`<br>• ẩn form ghi ở `/platform` theo quyền<br>• route giá công ty dùng `platform:pricebooks` | `ShellFrame.tsx`, trang `/platform`, `packages/contracts/src/roles.ts` | `platform_support` nhận 403 và không thấy nút Save. |
| B2 | Trang chi tiết công ty:<br>• sửa tên, slug, ABN<br>• đổi code phải xác nhận gõ lại<br>• đặt ngày hết hạn ngay lúc tạo (`CompanyCreator.tsx:104`) | `company/[id]`, `routes/admin.ts:222` | Slug trùng trả 409; có audit. |
| B3 | Thành viên công ty: danh sách, kèm **reset mật khẩu admin công ty** (mật khẩu tạm hiện một lần, bắt đổi khi đăng nhập), đúng như `CompanyCreator.tsx:17-19` hứa | `routes/admin.ts`, `company/[id]/members` | Reset thu hồi mọi phiên; không trả về hash. |
| B4 | Xem settings công ty (chỉ đọc): rates, minimum fees, book đang dùng. Margin giờ nằm trong book công ty. | route GET dùng `loadSettings` | — |
| B5 | Vật tư riêng của công ty (`custom` rows): giữ overlay hay gộp vào book công ty dưới dạng dòng thêm (sau Task 10) | `overrides.ts:49`, Task 7 | Báo giá dùng vật tư riêng vẫn ra đúng giá sau khi gộp. |
| B6 | Audit: lọc theo công ty, hành động, khoảng ngày; phân trang theo con trỏ; xuất CSV | `routes/admin.ts:280`, `app/audit` | Trang 2 không trùng trang 1; chạy trên cả hai driver. |
| B7 | Hồ sơ công ty: logo ảnh và email Manager/CC/BCC mặc định (Company Details của desktop). Logo lưu theo hash. | migration mới, `lib/documents*`, client `/settings` | Tài liệu cũ vẫn in logo cũ. |
| B8 | Route công ty `/prices/overrides` bị bridge chặn: xoá luôn, vì giá công ty giờ do vendor sửa trên admin | `apps/client/src/app/api/sq/[...path]/route.ts` | — |
| B9 | **Chưa kiểm:** danh sách Equipment Hire / Demolition / Distributor Misc. Options của desktop (`Administration.cs:60-80`) so với một dòng mỗi báo giá ở v2 (`additions.ts:43,51`). Distributor options có mặt trong công thức tổng (`PriceController.cs:471-477`), nên Task 2 có thể phát hiện lệch ở đây trước. | — | — |
| B10 | Bảng engineering (lookup khung, footing, wind): sửa trên master bằng chính cơ chế draft. Chỉ vendor sửa, bắt buộc có preview, và cần người duyệt thứ hai. | registry Task 4 | — |

Không đưa sang v2:
- cấu hình SMTP trên UI;
- form PricingFactor `.sqc` (desktop đã bỏ dở, handler không được nối);
- Installer / ép cập nhật;
- backup/restore bằng chép đè file. Nút activate lại master cũ và việc book bất biến đã thay thế chức năng này.

## Thứ tự & phụ thuộc

```
Task 0 ─┬─ Task 1 ── Task 3
        ├─ Task 2 (dùng settings.margin tạm thời cho tới Task 7)
        └─ Task 4 ── Task 5 ── Task 6 ── Task 7 ── Task 8 ── Task 9 ── Task 11 ── Task 12
                                              └── Task 10 (cần Task 0 Step 2 đạt)
B1 nên làm trước Task 11. Các mục Phase B còn lại độc lập.
```

**Lưu ý phát hành:** Task 2 và Task 7 nên lên production **cùng một đợt**. Task 2 đổi giá của mọi công ty
chưa đặt margin, từ 1.48 sang hệ số của book. Báo trước cho các công ty đó.
