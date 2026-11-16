# Plan — Production hardening (2026-11-15, bản 2: đã chốt D1–D3)

> **Người thực hiện:** một agent implement khác. Đọc hết file này trước khi sửa dòng đầu tiên.
> **Nguồn:**
> - `docs/reviews/2026-11-15-production-readiness-review.md` (B1, H1–H4, M3)
> - `docs/reviews/2026-11-15-db-seat-ip-analysis.md` (phân tích và các quyết định D1–D3)
>
> **Quyết định đã chốt (người dùng, 2026-11-15):**
> - **D1:** DB ứng dụng **chỉ dùng Postgres** ở dev, test và prod. Bỏ driver SQLite của `@sq/db` và bỏ test in-memory.
> - **D2:** price book **giữ định dạng file SQLite**. Bytes của file được lưu thêm trong Postgres; disk chỉ là cache.
> - **D3:** **seat theo thiết bị**, gắn với `(công ty, người dùng, trình duyệt)` qua cookie thiết bị. Thiết bị không dùng
>   quá N ngày thì tự thu hồi. Admin công ty có màn hình Thiết bị để thu hồi tay.
>
> **Quy tắc repo vẫn áp dụng** (`CLAUDE.md` ở root repo):
> - env mới phải thêm vào `turbo.json` `globalPassThroughEnv`;
> - package phải rebuild thì app mới thấy code mới;
> - migration đã chạy thì **không sửa**, chỉ thêm file mới;
> - **không commit, không push** trừ khi người dùng yêu cầu.

---

## 0. Trước khi bắt đầu

### 0.1 Working tree có thay đổi chưa commit không liên quan

Không sửa, revert hay format các file sau (đang có người làm dở):

- `apps/client/src/components/editor/{PlanView,Render3D,Shed3D}.tsx`
- `apps/client/src/components/editor/__tests__/cameraFrame.test.ts`
- `packages/core/src/domain/{openings3d,structure3d}.ts` và test của chúng
- `e2e/stepOne.spec.ts`
- `docs/smartquote-quote-editor-reference.md`

### 0.2 Môi trường máy dev (đã kiểm 2026-11-15)

- Postgres 18.1 ở `localhost:5432`.
- `.env` đã là `DB_DRIVER=postgres`, `DATABASE_URL=postgres://smartquote:…@localhost:5432/smartquote`.
- DB `smartquote_test` có sẵn, owner `smartquote`.
- Lệnh `TEST_DB_DRIVER=postgres TEST_DATABASE_URL=postgres://smartquote:…@localhost:5432/smartquote_test pnpm --filter @sq/api exec vitest run`
  cho kết quả **300/300 pass** trong 93,7 giây.
- App kết nối bằng role `smartquote`, không dùng superuser. **Không** ghi mật khẩu superuser vào bất kỳ file nào.
  Việc gì cần superuser (tạo DB test mới) thì ghi vào `scripts/postgres-setup.sql` và nhờ người dùng chạy.

### 0.3 Baseline

```bash
pnpm build
pnpm typecheck
pnpm test
```

Lúc viết plan, cả ba đều pass: core 1123, api 300, client 82, contracts 15, db 18. Nếu baseline đã fail thì dừng lại và
báo người dùng.

### 0.4 Số migration

Thư mục `packages/db/migrations/` hiện có số lớn nhất là `016`. Plan `2026-11-14-admin-price-book-management.md` cũng
định dùng `017`/`018`. **Dùng số kế tiếp còn trống tại thời điểm làm.** Nếu file đó chưa có thì lấy `017`, `018`. Ghi
số đã dùng vào báo cáo cuối để plan kia đánh số lại.

### 0.5 Thứ tự task

Làm tuần tự. Mỗi task xong phải `typecheck` và test của package liên quan đều xanh rồi mới sang task tiếp.

| Task | Nội dung | Mã | Package chạm tới |
|---|---|---|---|
| 1 | Chỉ dùng Postgres cho DB ứng dụng | D1, H4 | `@sq/db`, `@sq/api`, scripts, docs |
| 2 | Seat theo thiết bị, tự thu hồi, màn hình Thiết bị | D3, B1, M3 | `@sq/db`, `@sq/contracts`, `@sq/api`, `apps/client`, `apps/admin` |
| 3 | IP thật của client (trust proxy) | H1 | `@sq/api`, `apps/client`, `apps/admin` |
| 4 | Giới hạn số PDF render đồng thời | H3 | `@sq/core`, `@sq/api` |
| 5 | Security header cho 3 app Next.js | H2 | `apps/client`, `apps/admin`, `apps/site` |
| 6 | Lưu bytes price book trong Postgres | D2 | `@sq/db`, `@sq/api` |
| 7 | Tài liệu và kiểm tra cuối | — | `docs/`, `.env.example`, `turbo.json` |

> H4 (chặn SQLite khi production) không còn là task riêng: Task 1 bỏ hẳn driver SQLite.

---

## Task 1 — Chỉ dùng Postgres cho DB ứng dụng (D1)

### 1.1 Phạm vi

**Bỏ:**

- `packages/db/src/sqlite.ts`
- `packages/db/src/sqliteRuntime.ts`
- `packages/db/migrations/sqlite/`
- nhánh `sqlite` trong `packages/db/src/config.ts` và `migrate.ts`
- SQLite in-memory trong test của `@sq/api` và `@sq/db`

**Giữ nguyên, không đụng:**

- `packages/core/src/lib/pricing/sqliteRuntime.ts` và mọi code đọc price book (D2).
- Quy ước viết `?` placeholder. Driver Postgres vẫn tự rewrite sang `$1…$n`, nên **không** viết lại SQL cũ.

### 1.2 Các bước

**1.2.1 — `packages/db`**

- `src/index.ts`: bỏ `export * from './sqlite.js'`.
- `src/config.ts` (`DbConfig`, `loadDbConfig`, `openDb`):
  - `driver` chỉ còn kiểu `'postgres'`.
  - `DB_DRIVER` không đặt hoặc bằng `postgres` thì chạy bình thường.
  - `DB_DRIVER=sqlite` thì throw:
    `"DB_DRIVER=sqlite is no longer supported: the application database is Postgres everywhere (DECISIONS <id>). Set DATABASE_URL."`.
  - Giá trị khác thì throw như hiện tại.
  - Bỏ đọc `DB_FILE`.
- `src/driver.ts:47`: `readonly driver: 'postgres'`. `routes/health.ts:26` và `server.ts:96` vẫn in ra được, không cần
  sửa logic.
- `src/migrate.ts`:
  - `dialectFolderFor` chỉ còn trả `'pg'`. Có thể xóa luôn hàm và cho caller truyền `join(MIGRATIONS, 'pg')`; chọn cách
    ít sửa nhất.
  - Phiên bản `…@postgres` đã lưu trong `schema_migrations` **phải giữ nguyên** (`migrate.ts:160`), nếu không DB đang
    chạy sẽ tưởng có migration mới.
- `scripts/migrate.ts:33`: bỏ nhánh in `config.file`.
- Xóa thư mục `migrations/sqlite/`. Không động vào file nào trong `migrations/pg/` và các file `0xx_*.sql` portable.
- **Test `src/__tests__/db.test.ts`** đang dùng `createSqliteDb({ file: ':memory:' })` ở các dòng 18, 88, 142, 209, và
  đọc `migrations/sqlite/009…` ở dòng 258. Chuyển sang Postgres:
  - URL là `TEST_DATABASE_URL`, nhưng **đổi tên database** thành `<tên>_db`. Dùng `new URL(...)`, đổi `pathname`.
  - Lý do: turbo chạy test của `@sq/db` và `@sq/api` **song song**. Hai package cùng xóa bảng trong một DB sẽ phá nhau.
  - Bắt buộc tên DB chứa `test`, giống `apps/api/src/__tests__/helpers.ts:71-78`.
  - Reset bằng cách xóa mọi bảng, giống `resetPostgres` (`helpers.ts:89-98`). Nên chuyển hàm này vào `@sq/db` thành
    `export async function dropAllTablesForTests(db: Db)`, có kiểm tên DB chứa `test` **bên trong** hàm, để hai package
    dùng chung.
  - Dòng 258: đọc `migrations/pg/009_company_code_and_username.sql`.
  - Thêm `fileParallelism: false` vào vitest config của `@sq/db` nếu chưa có.
  - Thiếu `TEST_DATABASE_URL` thì throw kèm hướng dẫn. **Không** tự skip.
- `scripts/postgres-setup.sql`: thêm khối tạo `smartquote_test` và `smartquote_test_db` (owner `smartquote`), viết theo
  cùng kiểu `\gexec` với khối tạo `smartquote`. Máy dev chưa có `smartquote_test_db`. Báo người dùng chạy:
  `"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -f scripts/postgres-setup.sql`.
  Nếu bạn được cấp quyền chạy lệnh này thì phải hỏi người dùng mật khẩu, **không** ghi nó vào file.

**1.2.2 — `apps/api/src/__tests__/helpers.ts`**

- Bỏ `createSqliteDb` và nhánh `url === null`. `postgresUrl()` bây giờ:
  - **luôn** đọc `TEST_DATABASE_URL`;
  - **không** quay về `DATABASE_URL` (tránh lỡ tay xóa DB dev);
  - giữ kiểm tên chứa `test`;
  - không cần `TEST_DB_DRIVER` nữa.
- Dùng `dropAllTablesForTests` từ `@sq/db`.
- Sửa comment đầu file (dòng 7-8) cho đúng thực tế mới.
- `apps/api/vitest.config.ts`: comment `fileParallelism` vẫn đúng, chỉ cần bỏ câu nhắc tới SQLite `:memory:`.

**1.2.3 — Cho test đọc được `TEST_DATABASE_URL`**

- Thêm `TEST_DATABASE_URL` vào `turbo.json` `globalPassThroughEnv`. Đã kiểm: hiện **chưa có** biến `TEST_*` nào trong
  đó, nên `pnpm test` chạy qua turbo sẽ không nhận được giá trị.
- `apps/api/package.json` và `packages/db/package.json`: đổi script `"test"` thành
  `"node --env-file-if-exists=../../.env ./node_modules/vitest/vitest.mjs run"`, hoặc nạp `.env` trong vitest config
  bằng `loadEnv`. Chọn một cách và áp dụng cho cả hai package. Mẫu đã có: script `publish-book` trong
  `apps/api/package.json:18` dùng `--env-file-if-exists`.
- `.env.example`:
  - thêm `TEST_DATABASE_URL=postgres://smartquote:smartquote@localhost:5432/smartquote_test`, kèm comment "suite xóa mọi
    bảng; tên DB phải chứa test; @sq/db dùng `<tên>_db`";
  - bỏ `DB_FILE` và comment "Only read when DB_DRIVER=sqlite";
  - giữ `DB_DRIVER=postgres`, hoặc bỏ luôn vì đã là mặc định.
- Báo người dùng thêm `TEST_DATABASE_URL` vào `.env` của họ. **Không** tự sửa `.env` thật nếu không được yêu cầu.

**1.2.4 — Scripts và tài liệu**

- `start/start-306.bat:85-88`: bỏ đoạn "To run without Postgres instead… DB_DRIVER=sqlite".
- `README.md`, root `CLAUDE.md`:
  - bỏ hướng dẫn `DB_DRIVER=sqlite` và câu "No Postgres?";
  - bỏ yêu cầu "SQL phải chạy trên cả hai driver";
  - **giữ** quy tắc `?` placeholder và cấm `? IS NULL`;
  - ghi rõ: SQLite chỉ còn là định dạng file price book.
- `docs/DECISIONS.md`: thêm entry D1 (id kế tiếp). Ghi là supersede phần "driver chọn bằng `DB_DRIVER`" của A12.
- **Không** xóa `data/app.db` và `data/smartquote.db`. Đây là file SQLite cũ, không còn dùng (sửa lần cuối 2026-11-06).
  Ghi vào báo cáo cuối để người dùng tự xóa.

### 1.3 Kiểm tra

```bash
grep -rn "createSqliteDb\|DB_FILE\|DB_DRIVER=sqlite" --include=*.ts --include=*.md --include=*.bat --include=.env.example . | grep -v node_modules | grep -v /dist/
pnpm --filter @sq/db build
pnpm --filter @sq/db test
pnpm --filter @sq/api typecheck
pnpm --filter @sq/api test
pnpm test
```

- Lệnh grep đầu tiên chỉ được ra kết quả trong docs lịch sử (`docs/reviews/*`, `docs/superpowers/plans/*`).
- `pnpm test` qua turbo phải chạy được, nghĩa là `TEST_DATABASE_URL` đã được truyền vào.

---

## Task 2 — Seat theo thiết bị (D3; sửa luôn B1 và M3)

### 2.1 Vấn đề hiện tại (đã xác minh bằng đọc code)

Seat là **một phiên đăng nhập**: bảng `tenant_seats(tenant_id, slot, session_id)`, PK `(tenant_id, slot)`
(`packages/db/migrations/002_seats.sql`). `findFreeSlot` (`apps/api/src/lib/sessions.ts:137`) đếm mọi dòng đang có,
không nhìn tới việc phiên đó còn sống hay không.

Phiên chết mà **không trả seat** trong các trường hợp sau:

- Phiên quá idle 24h hoặc quá TTL 168h. `resolveSession` chỉ trả `null`.
- Bấm Sign out sau khi phiên đã hết hạn (`routes/auth.ts:548-553`).
- Xóa thành viên (`routes/settings.ts:312-324`).

Ví dụ: công ty 3 seat, 3 người đóng trình duyệt mà không Sign out. Hôm sau không ai vào được.

M3: hai người cùng tranh seat cuối trên Postgres thì người thứ hai bị unique violation, và lỗi bay ra thành 500
(`sessions.ts:116` chỉ bắt `SeatRefused`).

### 2.2 Mô hình mới

- **Thiết bị** là một profile trình duyệt, nhận diện bằng cookie `sq_device` sống lâu.
- Một **dòng thiết bị** ứng với `(tenant, user, cookie)`. Cùng một trình duyệt mà hai người dùng đăng nhập thì là hai
  dòng và tốn hai seat.
- **Seat gắn với thiết bị**, không gắn với phiên. Phiên hết hạn thì đăng nhập lại trên đúng trình duyệt đó dùng lại seat
  cũ. Không bao giờ bị từ chối chỉ vì phiên của chính mình đã chết.
- **Thiết bị chết** khi `revoked_at IS NOT NULL` hoặc `last_seen_at <= now - deviceIdleDays`. Seat của thiết bị chết
  được thu hồi **lười**: dọn ngay trong transaction đăng nhập, không cần cron.
- Phiên vendor (`tenantId === null`, `/auth/sign-in-platform`) **không** dùng seat và không dùng thiết bị. Giữ nguyên.

### 2.3 Migration (số kế tiếp, xem 0.4), file portable `0NN_device_seats.sql`

```sql
-- A seat belongs to a device (one browser profile, for one user in one company), not to a session.
-- A session that expires leaves the seat with its device, so signing in again on the same browser
-- never needs a free seat. Dead devices (revoked, or idle past DEVICE_IDLE_DAYS) give their seat back
-- at the next sign-in in that company.
CREATE TABLE IF NOT EXISTS devices (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_identity ON devices (tenant_id, user_id, token_hash);
CREATE INDEX IF NOT EXISTS devices_tenant_seen ON devices (tenant_id, revoked_at, last_seen_at);

CREATE TABLE IF NOT EXISTS device_seats (
  tenant_id   TEXT NOT NULL,
  slot        INTEGER NOT NULL,
  device_id   TEXT NOT NULL UNIQUE,
  claimed_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, slot),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

ALTER TABLE sessions ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

-- Seats held by sessions are meaningless under the new rule. Company sessions without a device are
-- refused by resolveSession, so every company user signs in once after this migration.
DROP TABLE IF EXISTS tenant_seats;
```

- Kiểm trên Postgres rằng `ALTER TABLE … ADD COLUMN … REFERENCES` chạy được. Nếu cần thì tách sang
  `migrations/pg/0NN_device_seats.sql`.
- Bảng `users` có cột `id` (`001_init.sql:44`).

### 2.4 Config

`apps/api/src/config.ts`:

- Thêm `deviceIdleDays: number`, đọc từ `DEVICE_IDLE_DAYS`. Mặc định `14`. Số nguyên phải từ 1 đến 365, ngoài khoảng đó
  thì throw.
- Thêm vào `testConfig()` trong `apps/api/src/__tests__/helpers.ts:42`.
- Thêm vào `turbo.json` `globalPassThroughEnv` và `.env.example`, kèm comment: "thiết bị không dùng quá N ngày thì
  seat tự trả".

### 2.5 Cookie thiết bị

- Tên `DEVICE_COOKIE = 'sq_device'`, đặt cạnh `SESSION_COOKIE` (`apps/api/src/routes/auth.ts:56`).
- Giá trị: `newToken()` (`lib/tokens.ts`). DB chỉ lưu `hashToken(value)`.
- Thuộc tính: `httpOnly`, `sameSite: 'lax'`, `secure: config.production`, `path: '/'`, `maxAge` 400 ngày (giới hạn trên
  của Chrome). Đặt lại mỗi lần đăng nhập thành công để gia hạn.
- Cookie gửi lên mà không đúng định dạng của `newToken` thì coi như không có, và cấp cookie mới.

**Hai bridge phải chuyển cookie này (đã kiểm, hiện tại thì chưa):**

- `apps/client/src/app/api/session/route.ts`. Đây là route đăng nhập thật; `SignInForm.tsx:45` gọi `/api/session`.
  - `POST` (dòng 24-60) **không** gửi cookie lên API. Phải thêm header `cookie` lấy từ request.
  - Vòng lặp `Set-Cookie` (dòng 39-60) chỉ giữ `sq_session` (`if (name?.trim() !== COOKIE) continue;`). Phải cho cả
    `sq_device` đi qua, với cùng cách đọc `Max-Age`, `HttpOnly`, `Secure`, `SameSite`.
  - `DELETE` (sign-out, dòng 69-72) dùng `proxy()`, và hàm này đã chuyển header `cookie` (dòng 77-81). Body của
    sign-out (xem 2.8) phải được chuyển lên API.
- `apps/client/src/app/api/sq/[...path]/route.ts`: đã chuyển `cookie` và mọi `Set-Cookie` (dòng 200-215). Không cần
  sửa.
- Admin không có seat nên không cần sửa.

### 2.6 `apps/api/src/lib/sessions.ts`

**Chữ ký mới:**

```ts
export type SeatOutcome =
  | { ok: true; session: IssuedSession; deviceToken: string | null }   // deviceToken: set the cookie when non-null
  | { ok: false; reason: 'no_seat' };

export async function createSession(db, config, input: {
  userId: string; tenantId: string | null; ip: string | null; userAgent: string | null;
  deviceToken: string | null;            // value of the sq_device cookie, if any
}): Promise<SeatOutcome>
```

**Trong transaction, khi `tenantId !== null`:**

1. Kiểm tenant còn `active`. Giữ logic hiện có (`sessions.ts:91-100`).
2. `await reclaimDeadDevices(tx, { tenantId, idleDays: config.deviceIdleDays })`.
3. Nếu `deviceToken` hợp lệ: tìm `devices` theo `(tenant_id, user_id, token_hash)` với `revoked_at IS NULL`.
   - Không thấy, hoặc không có token: sinh token mới (`deviceToken` trả về sẽ khác `null`) và `INSERT devices`.
     `label` lấy từ `deviceLabel(userAgent)` (mục 2.7).
   - Thấy: `UPDATE devices SET last_seen_at = ?`.
4. Nếu thiết bị đã có dòng trong `device_seats` thì dùng lại seat đó. Nếu chưa, gọi `findFreeSlot` (đổi sang đọc
   `device_seats`) rồi `INSERT device_seats`. Hết slot thì `throw new SeatRefused('no_seat')`.
5. `INSERT sessions (…, device_id)`.

**Thử lại khi tranh seat (M3):**

- Bọc phần trên thành `attempt()`. Mỗi lần thử sinh `token`, `sessionId`, `createdAt` mới.
- Bắt lỗi như sau:
  - `SeatRefused` thì trả `no_seat`.
  - `isUniqueViolation(error)` ở lần thử đầu thì gọi `attempt()` thêm một lần, bằng một `db.transaction` **mới**.
    Transaction cũ đã ROLLBACK (`packages/db/src/postgres.ts:72-111`).
  - `isUniqueViolation(error)` ở lần thứ hai thì trả `no_seat`.
  - Lỗi khác thì ném lại.
- `isUniqueViolation(error: unknown): boolean` là file mới `packages/db/src/errors.ts`, export qua `index.ts`. Điều kiện
  là `error.code === '23505'` (Postgres). Test bằng cách chèn trùng PK trên DB test của `@sq/db`.

**Hàm mới:**

```ts
/** Give back the seats of devices that can no longer hold one: revoked, or idle past `idleDays`. */
export async function reclaimDeadDevices(db: Db, input: { tenantId?: string; idleDays: number; at?: Date }): Promise<number>
```

SQL dùng hai câu, tham số dựng có điều kiện. **Không** dùng `? IS NULL`:

```sql
DELETE FROM device_seats WHERE device_id IN (
  SELECT id FROM devices WHERE (revoked_at IS NOT NULL OR last_seen_at <= ?) [AND tenant_id = ?]
) [AND tenant_id = ?];
UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL AND last_seen_at <= ? [AND tenant_id = ?];
```

`cutoff = new Date(at - idleDays * 86_400_000).toISOString()`. So sánh chuỗi ISO là đúng vì mọi timestamp đều sinh từ
`toISOString()` (`packages/db/src/ids.ts`). Hàm trả về số seat đã xóa.

```ts
/** Revoke one device: its seat, its sessions, and the device itself. */
export async function revokeDevice(db: Db, input: { tenantId: string; deviceId: string }): Promise<boolean>
/** Revoke every device of a user in a company (member removal, password change). */
export async function revokeDevicesForUser(db: Db, input: { userId: string; tenantId?: string; exceptDeviceId?: string }): Promise<void>
```

Mỗi hàm chạy trong một transaction gồm: `DELETE FROM device_seats`, `UPDATE devices SET revoked_at`,
`UPDATE sessions SET revoked_at … WHERE device_id …`. Mọi câu đều có `tenant_id = ?` khi có tenant.

**Sửa các hàm đang có:**

- `resolveSession`:
  - Thêm điều kiện: phiên công ty (`tenant_id` khác null) mà `device_id` null **hoặc** thiết bị đã `revoked_at` thì trả
    `null`. Cần `LEFT JOIN devices`.
  - Khi touch `last_seen_at` của phiên (nhịp 5 phút, `sessions.ts:211-213`), touch luôn `devices.last_seen_at` cho
    `device_id` đó.
- `revokeSession` (`sessions.ts:234-244`): bỏ câu `DELETE FROM tenant_seats`. Seat thuộc về thiết bị và **giữ lại**.
  Đây là chủ ý: Sign out thông thường không trả seat (xem 2.8).
- `revokeAllForUser` (`sessions.ts:247`): thêm `revokeDevicesForUser`. Hàm này được gọi khi đổi mật khẩu
  (`routes/auth.ts:597`) và khi chấp nhận lời mời (`auth.ts:438`).
  - Đổi mật khẩu với `exceptSessionId`: **giữ** thiết bị của phiên hiện tại (`exceptDeviceId`). Chỉ thu hồi các thiết
    bị khác.

### 2.7 `deviceLabel(userAgent)`

Hàm thuần trong `apps/api/src/lib/devices.ts`, ví dụ trả `"Chrome on Windows"`, `"Safari on iPhone"`.

- Nhận diện tối thiểu: Edge, Chrome, Firefox, Safari / Windows, macOS, iPhone, iPad, Android, Linux.
- Không nhận ra thì trả `"Unknown browser"`.
- Không thêm thư viện. Có unit test với 5–6 chuỗi User-Agent thật.

### 2.8 API

| Route | Thay đổi |
|---|---|
| `POST /auth/sign-in` (`routes/auth.ts:175-215`, `completeSignIn` ~500-545) | Đọc `request.cookies[DEVICE_COOKIE]` và truyền vào `createSession`. Khi `deviceToken !== null` thì `reply.setCookie(DEVICE_COOKIE, …)` như 2.5. Thông báo khi hết seat (`auth.ts:523`): `"Every seat in this company is in use. Ask your company admin to free a device under Team → Devices."` |
| `POST /auth/sign-out` (`auth.ts:548-554`) | (a) Tra phiên theo `token_hash` **trực tiếp**, không qua `resolveSession`, để vẫn revoke được phiên đã hết hạn. (b) Body tùy chọn `{ releaseDevice?: boolean }`, schema zod mới trong `packages/contracts`. Khi `true` và phiên có `device_id` thì gọi `revokeDevice` và `clearCookie(DEVICE_COOKIE)`. |
| `GET /settings/devices` (mới, `routes/settings.ts`, `requireCompanyCapability(…, 'members:manage')`) | Danh sách thiết bị **còn sống** của công ty: `id`, `userDisplayName`/`username`, `label`, `createdAt`, `lastSeenAt`, `holdsSeat`, `current` (đúng là thiết bị của phiên đang gọi). Kèm `seats` (`tenants.seats`) và `seatsInUse`. DTO định nghĩa trong `packages/contracts`. |
| `DELETE /settings/devices/:deviceId` (mới, `members:manage`) | Gọi `revokeDevice`. Thiết bị không thuộc tenant thì trả 404. Thu hồi chính thiết bị đang dùng thì vẫn cho phép (người đó sẽ bị đăng xuất). Ghi audit nếu module audit có sẵn (`grep -rn "audit" apps/api/src/lib`). |
| Xóa thành viên (`routes/settings.ts:312-324`) | Trong cùng transaction gọi `revokeDevicesForUser({ userId, tenantId })`. |
| Suspend công ty (`routes/admin.ts:166-180`) | Đổi `DELETE FROM tenant_seats` thành `DELETE FROM device_seats` và `UPDATE devices SET revoked_at` của tenant đó. |
| Danh sách công ty (`routes/admin.ts:70`) | `seats_in_use` đếm từ `device_seats`. |

Kiểm `apps/client/src/lib/sq.ts` hoặc bridge `[...path]` có allow-list prefix không (`route.ts` có allow-list). Nếu có
thì thêm `settings/devices`.

### 2.9 UI client

- **Màn hình Team** (`apps/client/src/app/team/page.tsx`): thêm mục **"Devices"** dưới danh sách thành viên. Chỉ hiện
  khi người dùng có `members:manage`, theo cách trang đang ẩn/hiện nút quản lý thành viên.
  - Dòng đầu là `seatsInUse / seats`.
  - Bảng gồm: người dùng, thiết bị (`label`), lần dùng cuối (thời gian tương đối), nhãn "This device" nếu `current`,
    và nút **Free seat**. Bấm thì hiện hộp xác nhận rồi gọi `DELETE`.
  - Dùng component của `@sq/ui` và palette navy/gold (`design-system/smartquote-v2/MASTER.md`). Không tự đặt màu.
- **Sign out** (`apps/client/src/components/SignOutButton.tsx:20`): giữ nút hiện tại (chỉ đăng xuất, giữ seat). Thêm
  lựa chọn phụ **"Sign out and free this device"**, ví dụ một mục trong `WorkspaceMenu.tsx`, gửi
  `DELETE /api/session` kèm body `{ "releaseDevice": true }`. Route `/api/session` `DELETE` phải chuyển body này lên
  API (2.5).
- **Form đăng nhập** (`SignInForm.tsx`): hiển thị nguyên thông báo `no_seat` từ API. Không cần đổi logic.

### 2.10 UI admin (vendor)

`apps/admin/src/app/company/page.tsx:80` đang hiện "Every seat in use" dựa trên `seats_in_use`. Chỉ cần API trả đúng
số. Không đổi UI ngoài chữ nếu cần.

### 2.11 Script `pnpm seats:release` (`apps/api/scripts/release-seats.ts`)

- Không tham số: gọi `reclaimDeadDevices(db, { idleDays: loadConfig().deviceIdleDays })` cho mọi tenant, rồi in số seat
  đã trả. **Không** đụng thiết bị còn sống.
- `--tenant <slug>`: làm như trên nhưng chỉ cho tenant đó.
- `--all`, có thể kèm `--tenant`: hành vi cũ, tức xóa mọi `device_seats`, revoke mọi thiết bị và phiên công ty.
- Cập nhật comment đầu file, `README.md:105`, `docs/OPERATIONS.md`.
- `apps/api/scripts/import-legacy-accounts.ts:366`: đổi `tenant_seats` thành `device_seats`, kèm
  `UPDATE devices SET revoked_at` cho tenant demo.

### 2.12 Test

Bỏ hoặc sửa test cũ `refuses a session beyond the seat count, and frees the seat on sign-out`
(`apps/api/src/__tests__/api.test.ts:148`) vì hành vi đã đổi: Sign out không còn trả seat.

Thêm test mới, `describe('device seats')`. Cookie được set qua `set-cookie` của response sign-in và gửi lại qua option
`cookies` của `app.inject`.

1. **Cùng trình duyệt dùng lại seat:** công ty 1 seat. Đăng nhập, nhận cookie thiết bị. Đẩy `sessions.expires_at` về
   quá khứ. Đăng nhập lại với cùng `sq_device` thì được 200, và `device_seats` vẫn chỉ có 1 dòng.
2. **Trình duyệt khác tốn seat:** công ty 1 seat. Đăng nhập không cookie (A) rồi đăng nhập không cookie lần nữa (B).
   B nhận 403 kèm `/seat/i`.
3. **Thiết bị idle được thu hồi:** tiếp tục test 2. Đẩy `devices.last_seen_at` của A về `now - (deviceIdleDays + 1)`
   ngày. B đăng nhập được 200; thiết bị A có `revoked_at`; cookie phiên của A gọi `GET /auth/session` nhận 401.
4. **Thiết bị sống không bị cướp seat:** A vừa dùng. B vẫn nhận 403, và phiên của A vẫn 200.
5. **Sign out thường giữ seat, Sign out kèm `releaseDevice` trả seat.**
6. **Sign out sau khi hết hạn vẫn revoke phiên** (`sessions.revoked_at` khác null).
7. **Admin thu hồi thiết bị:** `GET /settings/devices` liệt kê đúng. `DELETE` thì seat được trả và phiên của thiết bị đó
   nhận 401. Người không có `members:manage` gọi thì nhận 403. Dùng `deviceId` của công ty khác thì nhận 404.
8. **Xóa thành viên** thì seat giảm 1. Đặt test trong `team.test.ts`.
9. **Đổi mật khẩu** thì thiết bị khác bị thu hồi, thiết bị hiện tại vẫn giữ seat.
10. **Phiên công ty không có thiết bị** (dòng cũ, chèn tay với `device_id` null) thì `resolveSession` trả 401.
11. **Cách ly:** trong `isolation.test.ts`, thêm case công ty B không thấy và không thu hồi được thiết bị của công ty A.
12. **Phiên vendor** không tạo dòng `devices` hay `device_seats`.
13. `isUniqueViolation` (test trong `@sq/db`) và `deviceLabel` (unit test).

Kiểm tay qua UI client, khi `pnpm dev` đang chạy:

- Đăng nhập trên Chrome, rồi trên Edge, với công ty seat = 1. Edge phải bị từ chối.
- Vào Team → Devices, bấm Free seat cho Chrome. Edge đăng nhập được.

### 2.13 Kiểm tra

```bash
pnpm --filter @sq/db build
pnpm --filter @sq/db test
pnpm --filter @sq/contracts build
pnpm --filter @sq/api typecheck
pnpm --filter @sq/api test
pnpm --filter @sq/client-app typecheck
pnpm --filter @sq/client-app test
```

---

## Task 3 — Lấy đúng IP thật của client (H1)

### 3.1 Vấn đề (đã xác minh)

- `trustProxy: true` vô điều kiện (`apps/api/src/app.ts:60`). `clientIp()` lấy phần tử **đầu tiên** của
  `X-Forwarded-For` (`apps/api/src/lib/http.ts:55-63`), mà phần này client tự ghi được.
- API phải mở ra Internet vì site gọi thẳng từ trình duyệt (`apps/site/src/components/EnquiryForm.tsx:30`). Ai cũng giả
  được IP, nên các giới hạn `signin:ip`, `reset:ip` (`routes/auth.ts:200,265,341`) và `enquiry:ip`
  (`routes/enquiries.ts:118-121`) mất tác dụng.
- **Chiều ngược lại:** hai đường đăng nhập **không chuyển IP thật**:
  - Client: `apps/client/src/app/api/session/route.ts:27-32`. Đây là route đăng nhập thật; nó chỉ gửi `content-type`
    và `accept`.
  - Admin: bridge `apps/admin/src/app/api/sq/[...path]/route.ts:64-69`.

  Hậu quả là mọi lần đăng nhập đều mang IP của server Next. Ai đó gõ sai 30 lần trong 15 phút là **mọi người dùng** của
  app đó (mọi công ty với client, toàn bộ nhân viên vendor với admin) bị chặn đăng nhập.

  Bridge `apps/client/src/app/api/sq/[...path]/route.ts:164,175` đã chuyển XFF, nhưng sign-in không đi qua nó.

### 3.2 Thiết kế

Dùng `trustProxy` của Fastify (thư viện `proxy-addr`) với **danh sách địa chỉ tin cậy**.
`X-Forwarded-For` được đọc từ phải sang trái và bỏ qua các địa chỉ tin cậy. Kết nối đến từ địa chỉ không tin cậy thì XFF
bị bỏ qua hoàn toàn. Sau khi sửa, mọi chỗ chỉ dùng `request.ip`.

```
trình duyệt → reverse proxy (nối IP thật vào XFF) → Next (client/admin) → API (kết nối loopback, tin cậy)
trình duyệt → reverse proxy → API      (site gọi thẳng)
```

**Yêu cầu triển khai** (ghi vào docs ở Task 7): cổng của app Next (3061–3063) và cổng API không được mở thẳng ra
Internet. Chỉ mở 80/443 của reverse proxy.

### 3.3 Các bước

**3.3.1 — `apps/api/src/config.ts`**

Thêm `trustProxy: boolean | number | string`, đọc từ `TRUST_PROXY`:

| Giá trị `TRUST_PROXY` | Kết quả |
|---|---|
| không đặt hoặc rỗng | `'loopback'` |
| `'false'` hoặc `'0'` | `false` |
| số nguyên dương | `Number(...)`, tức số hop |
| `'true'` | `true`, nhưng **throw khi production** |
| giá trị khác | chuỗi danh sách IP/CIDR hoặc `loopback`, `linklocal`, `uniquelocal`; trim từng phần |

**3.3.2 — Các file còn lại của API**

- `apps/api/src/app.ts:60`: `trustProxy: config.trustProxy`.
- `apps/api/src/__tests__/helpers.ts` `testConfig`: thêm `trustProxy: 'loopback'`. `app.inject()` mặc định dùng
  `remoteAddress` `127.0.0.1`.
- `apps/api/src/lib/http.ts:55`:

  ```ts
  /** The client's address as Fastify resolved it under `trustProxy`. Never read X-Forwarded-For directly. */
  export function clientIp(request: FastifyRequest): string {
    return request.ip === '' ? 'unknown' : request.ip;
  }
  ```

- Sửa mọi lời gọi `clientIp(` (`grep -rn "clientIp(" apps/api/src`): `routes/auth.ts:189,258,334,516`,
  `routes/enquiries.ts:118` và các chỗ khác grep ra. Bỏ cast `request.headers as Record<string, unknown>`.
- Sau khi sửa, `grep -rn "x-forwarded-for" -i apps/api/src --include=*.ts` chỉ còn ra trong test.

**3.3.3 — Chuyển IP thật ở hai đường đăng nhập**

Dùng cùng cách với `apps/client/src/app/api/sq/[...path]/route.ts:164,175`:

```ts
const clientAddress = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
...(clientAddress === null || clientAddress === '' ? {} : { 'x-forwarded-for': clientAddress }),
```

Áp dụng cho:

- `apps/client/src/app/api/session/route.ts`, cả `POST` (dòng 27) và `proxy()` (dòng 79).
- `apps/client/src/app/api/account/password/route.ts`.
- `apps/admin/src/app/api/sq/[...path]/route.ts:64-69`.
- Mọi route handler khác gọi `fetch(` tới API. Kiểm bằng
  `grep -rn "fetch(" apps/admin/src/app/api apps/client/src/app/api apps/site/src/app/api 2>/dev/null`.

**3.3.4 — Env**

Thêm `TRUST_PROXY` vào `turbo.json` `globalPassThroughEnv` và `.env.example`. Comment trong `.env.example` liệt kê:

- `loopback`: một máy, mặc định.
- `loopback,uniquelocal`: Docker.
- dải IP của Cloudflare: khi đứng sau Cloudflare.
- `false`: không có proxy.

### 3.4 Test

File mới `apps/api/src/__tests__/clientIp.test.ts`, cộng thêm case trong `config.test.ts` (file mới).

1. **Không tin XFF từ nguồn lạ:**
   - Gửi 31 request `POST /api/v1/auth/sign-in` với `remoteAddress: '203.0.113.7'`.
   - Mỗi request dùng XFF khác nhau (`10.0.0.${i}`) và `username` khác nhau, để không chạm giới hạn theo tài khoản
     (10 lần).
   - Request thứ 31 phải nhận 429, message khớp `/network/i` (giới hạn IP là 30, `routes/auth.ts:58,200`).
   - **Chạy test này trên code cũ trước** để chứng minh nó fail.
2. **Tin XFF từ loopback:** `remoteAddress: '127.0.0.1'`, XFF `'1.1.1.1, 198.51.100.4'`. Kết quả phải có dòng
   `rate_limits` với key `signin:ip:${hashIp('198.51.100.4')}` (`lib/tokens.ts:41`), và không có key nào cho `1.1.1.1`.
3. **Enquiry:** làm giống test 1 cho `POST /api/v1/enquiries`. Lấy payload hợp lệ từ `enquiries.test.ts`.
4. **`config.test.ts` cho `TRUST_PROXY`:**
   - không đặt thì ra `'loopback'`;
   - `'2'` thì ra `2`;
   - `'false'` thì ra `false`;
   - chuỗi danh sách thì được trim;
   - `'true'` khi production thì throw.

Sau đó chạy lại toàn bộ `pnpm --filter @sq/api test`.

---

## Task 4 — Giới hạn số PDF render đồng thời (H3)

### 4.1 Vấn đề

`renderPdf` (`packages/core/src/lib/documents/pdf.ts:70-120`) mở một Chromium mới cho **mỗi** lần gọi, không giới hạn
số lượng. Nó được gọi từ hai chỗ:

- tải PDF: `apps/api/src/routes/documents.ts:114`;
- gửi mail: `routes/send.ts:137-139`, rồi `lib/mail/queue.ts:368`.

Mỗi Chromium tốn khoảng 200–300 MB RAM. Có cache theo revision (`documents.ts:100-111`), nên chỉ lần render đầu của mỗi
revision là tốn.

### 4.2 Các bước

**4.2.1 — Limiter**

File mới `packages/core/src/lib/documents/limiter.ts`:

```ts
export class LimiterTimeoutError extends Error {}
export interface Limiter {
  run<T>(task: () => Promise<T>, maxWaitMs: number): Promise<T>;
  setConcurrency(n: number): void;   // integer >= 1, else throw
  readonly active: number;
  readonly waiting: number;
}
export function createLimiter(concurrency: number): Limiter
```

Yêu cầu:

- Xếp hàng FIFO.
- Slot luôn được trả trong `finally`.
- Task chờ quá `maxWaitMs` thì bị gỡ khỏi hàng đợi và reject `LimiterTimeoutError`.
- Không export ra ngoài `documents`.

**4.2.2 — `pdf.ts`**

- Thêm `PdfBusyError`, đặt cạnh `PdfUnavailableError` (dòng 56).
- Tạo limiter cấp module với `concurrency` 2.
- Thêm `configurePdfRendering({ concurrency?, maxWaitMs? })`. Mặc định `maxWaitMs` là 60 000.
- Thêm `pdfConcurrencyFromEnv()`, đọc `PDF_CONCURRENCY`, viết theo cách của `chromePathFromEnv` (dòng 122).
- Trong `renderPdf`: kiểm `executablePath` **trước** khi xếp hàng. Bọc đoạn `launch … close` bằng `limiter.run`. Bắt
  `LimiterTimeoutError` rồi ném `PdfBusyError('The server is busy producing other PDFs. Try again in a minute.')`.

**4.2.3 — API**

- `apps/api/src/server.ts` `main()`: gọi `configurePdfRendering({ concurrency: pdfConcurrencyFromEnv() })` trước
  `buildApp`.
- `routes/documents.ts:125-130`: `PdfBusyError` thì trả `sendFail(reply, 'rate_limited', error.message)` (429, mã đã có
  trong `packages/contracts/src/envelope.ts`).
- Đường gửi mail: `lib/mail/queue.ts:385-390` đã đánh job `failed` kèm message. Giữ nguyên hành vi này.
- Thêm `PDF_CONCURRENCY` vào `turbo.json` và `.env.example`, kèm comment: mỗi render tốn khoảng 200–300 MB RAM; VPS 2 GB
  nên đặt 1–2.

### 4.3 Test

File `packages/core/src/lib/documents/__tests__/limiter.test.ts`. Dùng deferred promise; case timeout dùng
`vi.useFakeTimers`.

1. Với concurrency 2 và 3 task: `active === 2`, `waiting === 1`. Task 1 xong thì task 3 chạy.
2. Task throw vẫn trả slot.
3. Timeout reject đúng lỗi, hàng đợi sạch, không rò slot.
4. Thứ tự chạy là FIFO.
5. `setConcurrency(0)` throw.

```bash
pnpm --filter @sq/core test
pnpm --filter @sq/core build
pnpm --filter @sq/api typecheck
pnpm --filter @sq/api test
```

Kiểm tay nếu máy có `CHROME_PATH`: mở cùng lúc 4–5 lần tải PDF của các revision chưa cache. Task Manager chỉ được hiện
tối đa 2 nhóm Chromium. Không có Chrome thì ghi "chưa kiểm tay".

**Ngoài phạm vi:** giữ một Chromium sống để tái dùng; chuyển `renderPdf` sang API (L1).

---

## Task 5 — Security header cho 3 app Next.js (H2)

Hiện `apps/{client,admin,site}/next.config.ts` chỉ có `transpilePackages` (client có thêm `experimental.staleTimes`).
Không có `headers()`, không có middleware.

Trong **mỗi** file, thêm hằng sau. Chép vào từng file, không tạo package dùng chung.

```ts
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },   // site: 'no-referrer'
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
```

Thêm vào config:

```ts
poweredByHeader: false,
async headers() { return [{ source: '/:path*', headers: securityHeaders }]; },
```

Giữ nguyên các option đang có.

- **Không** bật `script-src` đợt này. Next chèn script inline, nên CSP đầy đủ cần nonce qua middleware. Để đợt sau.
- **Không** thêm header chặn iframe vào **API**. Site nhúng `${API}/share/document` trong iframe
  (`apps/site/src/app/s/page.tsx:118-122`).
- HSTS bị trình duyệt bỏ qua trên `http://localhost`, nên dev không bị ảnh hưởng.

**Kiểm tra:**

- Chạy `pnpm build`, rồi chạy app.
- `curl.exe -sI http://localhost:3061/` (và 3062, 3063) phải có đủ 6 header và không có `X-Powered-By`. Dùng
  `localhost`, **không** dùng `127.0.0.1`.
- Chạy `pnpm test:e2e` khi `pnpm dev` đang chạy. Nếu không chạy được thì kiểm tay:
  - đăng nhập client, mở một quote, Console không báo lỗi CSP;
  - trang `/s#<token>` của site vẫn hiện iframe báo giá.

---

## Task 6 — Lưu bytes price book trong Postgres (D2)

### 6.1 Vấn đề

File book (`data/price-books/<hash>.db`, 3,3 MB) chỉ nằm trên disk của API. `pg_dump` không chứa nó. Mất volume, hoặc
chạy thêm một instance mới, thì `openBook` ném `BookMissingError` (`apps/api/src/lib/priceBook.ts:65`) và mọi lần tính
giá đều fail.

### 6.2 Thiết kế

- Postgres là nguồn chính của bytes. Disk là cache.
- Engine và `openBook` **giữ đồng bộ** như hiện tại. Thêm một bước async "bảo đảm file có trên disk" trước khi mở.
- **Lưu ý:** `hash` là SHA-256 của **dump nguồn**, không phải của file `.db` (comment đầu `priceBook.ts`). Vì vậy cần
  lưu thêm `file_sha256` riêng để kiểm tính toàn vẹn của bytes.

### 6.3 Các bước

**6.3.1 — Migration** (số kế tiếp), file `0NN_price_book_files.sql`:

```sql
CREATE TABLE IF NOT EXISTS price_book_files (
  hash         TEXT PRIMARY KEY,      -- the book's identity (sha256 of the dump), as in price_books
  file_sha256  TEXT NOT NULL,         -- sha256 of the .db bytes below, checked before use
  bytes        BYTEA NOT NULL,
  size_bytes   INTEGER NOT NULL,
  stored_at    TEXT NOT NULL
);
```

Kiểm adapter `packages/db/src/postgres.ts` truyền và nhận `Buffer` đúng với cột `BYTEA`. Thư viện `pg` trả `Buffer`.
Viết một test nhỏ trong `@sq/db`.

**6.3.2 — `apps/api/src/lib/priceBook.ts`**

- `storeBookBytes(db, hash)`: đọc file `<hash>.db`, tính SHA-256, rồi
  `INSERT … ON CONFLICT (hash) DO NOTHING`.
- Gọi `storeBookBytes` trong `publishAndActivate` (dòng ~131), ngay sau `publishPriceBook`, trước khi ghi
  `price_book_active`. Khi `registerDerived` của plan price book xuất hiện, hàm đó cũng phải gọi `storeBookBytes`. Ghi
  chú việc này vào plan kia.
- `ensureBookOnDisk(db, hash): Promise<void>`:
  - File đã có thì return.
  - Không có thì đọc `price_book_files`; không có dòng thì ném `BookMissingError` như cũ.
  - Có dòng thì kiểm SHA-256 của bytes so với `file_sha256`. Sai thì throw và không ghi file.
  - Ghi ra `<hash>.db.tmp` rồi `renameSync` thành `<hash>.db`. Rename là nguyên tử, nên hai request cùng lúc không làm
    hỏng file.
- Ba chỗ gọi `openBook` / `openBookDatabase` thêm `await ensureBookOnDisk(db, hash)` ngay trước khi mở:
  - `routes/evaluations.ts:260`
  - `routes/vquExport.ts:66`
  - `routes/catalogues.ts:51`
  Grep lại (`grep -rn "openBook(\|openBookDatabase(" apps/api/src`) để không sót chỗ nào.
- **Backfill:** `server.ts` lúc boot (hoặc một script `pnpm books:store`) duyệt `price_books` và gọi `storeBookBytes` cho
  mọi book còn file trên disk mà chưa có trong `price_book_files`. Chọn chạy lúc boot cho tự động. Log số book đã lưu.
  Book thiếu file thì chỉ log cảnh báo, không throw.

### 6.4 Test

Trong `apps/api/src/__tests__/`. Đã có test publish vào thư mục tạm; dùng lại cách đó, có `closeAllBooks()` cho Windows.

1. Publish xong thì `price_book_files` có 1 dòng, và `file_sha256` khớp với file.
2. Xóa file `.db` trên disk (gọi `closeAllBooks()` trước), rồi `POST /evaluate`. Kết quả 200, và file được tạo lại.
3. Sửa 1 byte trong `bytes` rồi xóa file. Kết quả là lỗi, và **không** có file hỏng được ghi ra.
4. Publish cùng dump hai lần chỉ tạo 1 dòng.

---

## Task 7 — Tài liệu và kiểm tra cuối

### 7.1 Tài liệu

- `docs/OPERATIONS.md`:
  - **Reverse proxy và IP client**: topology ở 3.2, quy tắc mở cổng, `TRUST_PROXY`.
  - **Seat theo thiết bị**: `DEVICE_IDLE_DAYS`, màn hình Team → Devices, hành vi mới của `seats:release`.
  - **Backup**: chỉ cần `pg_dump`; `data/price-books` là cache.
  - `PDF_CONCURRENCY`.
- `README.md`: Postgres bắt buộc, `TEST_DATABASE_URL`, mô tả mới của `seats:release`.
- `docs/DECISIONS.md`: thêm 3 entry: D1 Postgres-only, D2 bytes book trong Postgres (bổ sung A4), D3 seat theo thiết bị
  với lazy reclaim.
- `docs/smartquote-quote-editor-reference.md`: **không** sửa. File này đang được người khác sửa (0.1).
- `docs/reviews/2026-11-15-production-readiness-review.md`: thêm dòng "Trạng thái" dưới bảng §0, ghi các mục đã xử lý.
- Root `CLAUDE.md`:
  - phần Commands: test cần Postgres và `TEST_DATABASE_URL`;
  - bỏ "No Postgres?";
  - Architecture: seat theo thiết bị; IP client chỉ lấy qua `clientIp(request)`.

### 7.2 Kiểm tra cuối (bắt buộc, ghi kết quả vào báo cáo)

```bash
pnpm build
pnpm typecheck
pnpm test
git diff --stat
```

- `pnpm test:e2e` chạy khi `pnpm dev` đang chạy. Session e2e lưu trong `e2e/.auth/` sẽ mất hiệu lực sau migration của
  Task 2, nên phải tạo lại theo `docs/TEST-ACCESS.md`. Không chạy được thì ghi rõ lý do.
- `grep -rn "x-forwarded-for" -i apps/api/src --include=*.ts` chỉ còn ra trong test.
- `grep -rn "tenant_seats" apps packages --include=*.ts` không còn kết quả nào, trừ migration cũ.
- Không file nào trong danh sách 0.1 xuất hiện trong diff do mình sửa.

### 7.3 Báo cáo cuối

Với từng task, ghi:

- file đã sửa;
- migration đã thêm, kèm số;
- test đã thêm;
- lệnh đã chạy và kết quả;
- mục nào **chưa kiểm** (e2e, PDF tay, UI tay) và vì sao.

Ngoài ra nhắc người dùng ba việc:

1. Chạy lại `scripts/postgres-setup.sql` để tạo `smartquote_test_db`.
2. Thêm `TEST_DATABASE_URL` vào `.env`.
3. Mọi người dùng công ty phải đăng nhập lại một lần sau migration của Task 2.

Để thay đổi **chưa commit**.

---

## Phụ lục — ngoài phạm vi (làm đợt sau)

- **D4:** cho site đi qua một bridge để API chỉ nghe `localhost`. Sau đó API không cần mở ra Internet, và CORS gần như
  thừa.
- **B2:** Dockerfile, CI, hạ tầng. Cần người dùng chọn nơi deploy trước. Khi có CI, cần thêm service Postgres cho test.
- **B3:** quản lý price book trên web, theo plan `2026-11-14-admin-price-book-management.md`. Plan đó cần đánh số lại
  migration và gọi `storeBookBytes` (Task 6).
- M1, M2, M5, M6, M7, M8, M10; CSP đầy đủ có nonce; tái dùng Chromium; CAPTCHA hoặc honeypot cho form enquiry.
