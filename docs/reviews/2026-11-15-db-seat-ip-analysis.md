# Phân tích: Postgres/SQLite, seat theo thiết bị, IP client (2026-11-15)

> Bổ sung cho `2026-11-15-production-readiness-review.md`. Mục nào kiểm bằng lệnh có ghi kết quả. Mục nào
> chưa kiểm thì ghi rõ "chưa kiểm".

---

## 1. Database: dev và prod đều chạy Postgres. Price book có nên bỏ SQLite không?

### 1.1 Thực trạng (đã kiểm trên máy này, ngày 2026-11-15)

| Hạng mục | Thực tế |
|---|---|
| Postgres trên máy | 18.1, đang listen ở cổng 5432 |
| `.env` | `DB_DRIVER=postgres`, `DATABASE_URL=postgres://smartquote:…@localhost:5432/smartquote` |
| DB `smartquote` | 29 bảng; đã chạy cả 16 migration, phần riêng cho Postgres được ghi `@postgres`; 5 tenant, 87 quote |
| DB `smartquote_test` | có sẵn, owner `smartquote`, dùng cho biến thể test trên Postgres |
| `data/app.db` | file SQLite cũ, sửa lần cuối 2026-11-06, không còn dùng. Có thể xóa. |

**Kết luận:** dev **đã** dùng Postgres. Không phải đổi gì.

- App kết nối bằng role `smartquote`, không dùng `postgres`/superuser.
- Đây là chủ ý: `scripts/postgres-setup.sql` giải thích rằng app không được có quyền tạo role hay database. Vì vậy mật khẩu
  superuser không cần nằm trong `.env`, và mình không ghi nó vào file nào.

Hiện SQLite còn ở ba chỗ:

| Chỗ dùng | Tình trạng | Đề xuất |
|---|---|---|
| (a) **Test API** chạy SQLite in-memory theo mặc định (`apps/api/src/__tests__/helpers.ts:7,113`) | Chưa nhất quán. CLAUDE.md có ghi: ba lỗi thật **chỉ lộ ra trên Postgres**. | **Bỏ**: chạy test trên Postgres theo mặc định (§1.4) |
| (b) **Driver SQLite cho DB ứng dụng** (`packages/db/src/sqlite.ts`, `DB_DRIVER=sqlite`), gợi ý trong `start/start-306.bat:88` | Chỉ là đường tắt cho máy không có Postgres | **Bỏ**, nếu đồng ý (a) |
| (c) **File price book** `data/price-books/<sha256>.db` | Đây là định dạng snapshot giá, không phải DB ứng dụng | **Giữ** (lý do ở §1.2) |

### 1.2 Price book: vì sao nên giữ định dạng file SQLite

Bạn nói đúng một điểm: price book phải nằm **trên server** và **không được phụ thuộc bản desktop**. Nhưng cần tách
hai chuyện mà lâu nay bị gộp làm một:

1. **Dữ liệu giá đến từ đâu và ai sửa.** Hiện vendor phải dump dữ liệu từ DB của desktop
   (`tools/price-dump/DumpAll.cs`) rồi chạy `pnpm publish-book`. Đây chính là vấn đề B3, và **nó cần được bỏ**.
   Plan `docs/superpowers/plans/2026-11-14-admin-price-book-management.md` đã thiết kế việc này: sửa giá trên Admin
   web, bản nháp lưu trong **Postgres**, bấm Publish thì sinh ra một book mới.
2. **Lúc tính giá thì engine đọc giá từ định dạng nào.** Hiện là một file SQLite chỉ đọc, gắn với hash, nằm ngay trên
   server API. Việc này **không liên quan gì tới desktop**. Desktop chỉ là nguồn của lần dump đầu tiên.

Nghĩa là dù bỏ desktop hoàn toàn, dữ liệu giá vẫn có thể được sửa trên web và lưu ở Postgres. SQLite chỉ đóng vai
một **bản đóng băng** (giống file build) mà engine đọc khi tính giá.

**Vì sao không đưa thẳng bảng giá vào Postgres** (đã kiểm trong code):

| Lý do | Bằng chứng |
|---|---|
| **Engine tính giá chạy đồng bộ.** Interface `PriceLookup` trả giá trị ngay, không phải `Promise` (`packages/core/src/lib/pricing/types.ts:207-235`, ví dụ `frame(size): PriceRow \| undefined`). Driver Postgres bắt buộc phải async. | Đổi sang Postgres kéo theo đổi cả BOM, pricing và estimating thành async. `PriceLookup` dùng ở 18 file; có 58 câu `prepare()` trong `lib/pricing` |
| **Một lần tính giá gọi lookup hàng trăm lần.** Đọc SQLite trong cùng process mất vài micro-giây mỗi lần; Postgres thì mỗi câu phải đi qua mạng. | `docs/PRICING-PIPELINE.md` §1: frame, purlin, sheeting, doors… mỗi dòng BOM một lookup |
| **Báo giá cũ phải tính lại ra đúng số.** Mỗi revision ghi `price_book_hash` (`packages/db/migrations/001_init.sql:216,246`). File gắn với hash và không bao giờ sửa (A4), nên một năm sau vẫn giải thích được báo giá cũ. | Postgres cũng làm được, nhưng phải giữ mọi phiên bản của 76 bảng, mỗi dòng có thêm cột `book_hash` |
| **Schema là của bên khác và thay đổi giữa các phiên bản.** Có 76 bảng với cột khác nhau tùy book; code phải hỏi cột nào tồn tại trước khi query (`lookup.ts`, `hasColumn`). | Đưa vào Postgres thì mỗi lần schema của book đổi phải viết migration mới |
| **`@sq/core` không được phụ thuộc DB ứng dụng (A9).** | Đọc file SQLite là ngoại lệ đã có chủ đích và đã được kiểm soát |
| Book nhỏ: **3,3 MB, 76 bảng, 31 553 dòng** (đã đếm trên book đang active `fe5a7cae…`) | Không có vấn đề về dung lượng |

**Điểm yếu thật của mô hình file** (cần xử lý khi lên production):

- **Backup và triển khai:** file nằm trên disk của server API. `pg_dump` không chứa nó. Mất volume là mất book; khi
  đó mọi quote báo `BookMissingError` (`apps/api/src/lib/priceBook.ts:65`).
- **Chạy nhiều instance API:** mọi instance phải thấy cùng một thư mục `data/price-books`.

**Đề xuất: lưu luôn nội dung file book trong Postgres** (bảng `price_book_files(hash PK, bytes BYTEA, …)`). Disk chỉ
còn là **cache**:

- Khi publish: ghi file vào disk như hiện nay, đồng thời `INSERT` bytes vào Postgres.
- Khi `openBook(hash)`: nếu file không có trên disk thì đọc bytes từ Postgres, kiểm SHA-256, ghi ra disk rồi mở.

Kết quả là **Postgres trở thành nguồn duy nhất cần backup** (một `pg_dump` là đủ), instance mới tự kéo book về,
trong khi engine giữ nguyên tốc độ và không phải đổi sang async. Thay đổi chỉ nằm trong `apps/api/src/lib/priceBook.ts`
và một migration mới, khoảng một task nhỏ.

> **Khi nào nên chuyển hẳn bảng giá vào Postgres:** khi cần query giá **xuyên nhiều công ty** bằng SQL (báo cáo,
> so sánh). Hiện chưa có yêu cầu nào như vậy.

### 1.3 Quyết định cần bạn chốt

| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| D1 | Bỏ hẳn SQLite cho **DB ứng dụng** (driver, tùy chọn `DB_DRIVER=sqlite`, test in-memory)? | **Có.** Dev, test và prod đều chạy Postgres. |
| D2 | Giữ file SQLite làm **định dạng snapshot** của price book? | **Có**, và lưu bytes trong Postgres để backup |

### 1.4 Nếu chọn D1: việc phải làm (task mới, làm **trước** các task khác trong plan hardening)

1. `apps/api/src/__tests__/helpers.ts`: mặc định dùng Postgres qua `TEST_DATABASE_URL`. Tên DB bắt buộc chứa `test`;
   giữ cơ chế xóa sạch bảng đang có. Thiếu biến này thì báo lỗi rõ ràng, không tự quay về SQLite.
2. `packages/db`: bỏ `sqlite.ts`, `sqliteRuntime.ts` và nhánh `driver === 'sqlite'` trong `config.ts`/`migrate.ts`;
   bỏ thư mục `migrations/sqlite/`. **Không** đụng `packages/core/src/lib/pricing/sqliteRuntime.ts`, vì price book cần nó.
3. `.env.example`: thêm `TEST_DATABASE_URL=postgres://smartquote:smartquote@localhost:5432/smartquote_test`; bỏ `DB_FILE`.
   Thêm `TEST_DATABASE_URL` vào `turbo.json` `globalPassThroughEnv` nếu chưa có.
4. `start/start-306.bat:85-88`, README, CLAUDE.md: bỏ hướng dẫn `DB_DRIVER=sqlite`. Ghi chú trong CLAUDE.md rằng SQL
   chỉ cần chạy trên Postgres, nhưng **vẫn giữ** quy ước `?` placeholder (driver vẫn rewrite) cho tới khi có lý do đổi.
5. Task 2 (H4) trong plan hardening trở thành thừa: không còn driver SQLite để mà chặn.
6. Chi phí: test API chậm hơn (kết quả đo ở §1.5), và CI sau này cần một service Postgres.

### 1.5 Thử chạy test API trên Postgres (đã chạy)

`TEST_DB_DRIVER=postgres TEST_DATABASE_URL=…/smartquote_test pnpm --filter @sq/api exec vitest run`:
**30/30 file, 300/300 test pass, mất 93,7 giây.** Cùng bộ test trên SQLite in-memory mất khoảng 32 giây, tức chậm
hơn khoảng 3 lần. Vậy chuyển hẳn sang Postgres là **khả thi ngay**, không có test nào phải sửa logic.

---

## 2. Seat theo thiết bị (mỗi account gắn với trình duyệt đã đăng nhập)

### 2.1 Hiện tại seat là gì

Seat = **một phiên đăng nhập** (`tenant_seats.session_id`, `packages/db/migrations/002_seats.sql`). Hệ quả:

- Mở 2 tab trên cùng trình duyệt: chung cookie nên chỉ tốn 1 seat.
- Cùng một người dùng Chrome và Edge: tốn 2 seat.
- Phiên hết hạn (24h không dùng) thì phiên chết, nhưng seat bị giữ mãi (lỗi B1). Sau khi sửa theo plan, seat sẽ tự
  trả khi phiên chết.

Desktop cũ gửi `MachineName` và `MachineUser` khi xác thực licence
(`smq-code-smartquote/App/SmartQuote.Api.Model/Models/MAuthenticationRequest.cs:25-27`). Vậy ý định ban đầu là gắn
licence với máy. Code licence server không có trong repo nên **chưa kiểm** được nó đếm seat cụ thể thế nào.

### 2.2 Giới hạn kỹ thuật cần biết trước

Trình duyệt **không cung cấp ID thiết bị**. Chỉ có hai cách nhận ra "cùng một thiết bị":

- **Cookie thiết bị lâu dài** (ngẫu nhiên, `httpOnly`). Đây là cách thực tế. Chrome giới hạn cookie sống tối đa
  400 ngày. Mất cookie khi: xóa dữ liệu trình duyệt, dùng chế độ ẩn danh, đổi trình duyệt, hoặc đổi profile Chrome.
  Mỗi lần như vậy là **một thiết bị mới**.
- **Fingerprint** (canvas, font, GPU…): không ổn định (đổi khi cập nhật trình duyệt), dễ làm giả, và vướng quy định
  quyền riêng tư. **Không nên dùng.**

Vì vậy "thiết bị" trên web thực chất là **"một profile trình duyệt"**. Mọi phương án đều phải tính tới chuyện cookie
bị mất.

### 2.3 Các phương án

| | A. Seat = phiên (hiện tại, đã sửa B1) | B. Seat = thiết bị (cookie thiết bị) | C. Seat = người dùng | D. Seat = người dùng, mỗi người tối đa K thiết bị |
|---|---|---|---|---|
| Đếm cái gì | Phiên đang sống | Cặp (người dùng, trình duyệt) đã đăng nhập | Tài khoản đang hoạt động | Như C, cộng giới hạn thiết bị mỗi người |
| Đăng nhập lại trên cùng máy sau khi hết phiên | Lấy seat mới. Có thể bị từ chối nếu công ty đã hết seat. | **Dùng lại seat cũ**, không bao giờ bị từ chối | Luôn vào được | Luôn vào được |
| Một người dùng 2 máy | 2 seat | 2 seat | 1 seat | 1 seat (nếu K ≥ 2) |
| Hai người dùng chung một máy | 2 seat | 2 seat (seat gắn với người + máy) | 2 seat | 2 seat |
| Chống chia sẻ tài khoản | Trung bình | Trung bình. Chia sẻ thì tốn thêm seat, nên tự giới hạn. | Yếu: 1 tài khoản dùng cho 10 người | **Tốt** |
| Khi cookie bị mất | Không ảnh hưởng | Thành thiết bị mới. Seat cũ bị giữ tới khi được thu hồi. | Không ảnh hưởng | Thiết bị cũ chiếm 1 slot tới khi được thu hồi |
| Cần thêm UI | Không | Màn hình "Thiết bị" cho admin công ty + nút "Đăng xuất và trả thiết bị này" | Không | Màn hình thiết bị (dạng nhẹ) |
| Khối lượng | Đã có trong plan | Trung bình: 1 migration, sửa sign-in, 1 màn hình | Nhỏ | Trung bình |
| Giống phần mềm nào | Licence theo số người dùng đồng thời | Licence theo máy (giống desktop cũ) | Hầu hết SaaS | Netflix, Microsoft 365 |

### 2.4 Đề xuất: phương án B, đúng ý bạn, với bốn điều kiện để không tái diễn lỗi kẹt seat

1. **Seat gắn với `(công ty, người dùng, thiết bị)`**, không gắn với phiên. Phiên hết hạn thì chỉ cần đăng nhập lại
   trên đúng máy đó, seat vẫn còn nguyên.
2. **Tự thu hồi thiết bị lâu không dùng.** Thiết bị không hoạt động quá `DEVICE_IDLE_DAYS` ngày (đề xuất 14, cấu hình
   được) thì seat tự trả. Cách làm giống lazy reclaim trong plan: dọn ngay lúc có người đăng nhập, không cần cron.
3. **Có đường tự gỡ khi hết seat:**
   - Người dùng: nút "Đăng xuất và trả thiết bị này".
   - Admin công ty: màn hình **Thiết bị** liệt kê người dùng, tên trình duyệt/hệ điều hành (từ User-Agent), lần dùng
     cuối, và nút **Thu hồi**.
   - Khi hết seat, thông báo phải nói rõ ai đang giữ seat, và nếu người đăng nhập có quyền thì hiện luôn nút thu hồi.
4. **Xóa thành viên, khóa công ty, đổi mật khẩu** thì thu hồi luôn thiết bị của người đó.

**Nếu mục tiêu chính là chống chia sẻ tài khoản** chứ không phải tính tiền theo máy, thì **D** (seat = người dùng,
K = 2 thiết bị) dễ hiểu hơn với khách hàng: "5 seat = 5 người, mỗi người 2 máy". Đây là quyết định kinh doanh, bạn chốt.

### 2.5 Phác thảo kỹ thuật cho phương án B (để viết plan khi bạn chốt)

- **Migration mới** `devices`: `id`, `tenant_id`, `user_id`, `token_hash UNIQUE`, `label`, `created_at`,
  `last_seen_at`, `revoked_at`.
  - Bảng seat chuyển sang khóa theo `device_id`: `UNIQUE (tenant_id, device_id)`, PK `(tenant_id, slot)` giữ nguyên.
  - `sessions` thêm cột `device_id`.
  - Viết ở dạng migration mới, **không sửa** migration đã chạy.
- **Cookie `sq_device`:** giá trị ngẫu nhiên 32 byte, DB chỉ lưu hash; `httpOnly`, `secure` khi production,
  `SameSite=Lax`, `Max-Age` 400 ngày; đặt lại `Max-Age` mỗi lần đăng nhập.
  - Cần kiểm bridge `apps/client/src/app/api/sq/[...path]/route.ts` có chuyển `Set-Cookie` thứ hai về trình duyệt
    không. **Chưa kiểm.**
- **Luồng sign-in:**
  1. Đọc `sq_device`.
  2. Nếu thiết bị này đã giữ seat cho đúng `(tenant, user)` thì dùng lại seat đó.
  3. Nếu chưa: dọn thiết bị quá hạn, tìm slot trống, chèn seat; hết slot thì trả `no_seat` kèm danh sách thiết bị.
  4. Tạo phiên gắn `device_id`.
- **Cập nhật `last_seen_at` của thiết bị** trong cùng nhịp đang dùng cho phiên (mỗi 5 phút).
- **Test:**
  - đăng nhập lại cùng cookie thì không tốn seat mới;
  - cookie khác thì tốn seat;
  - thiết bị quá 14 ngày bị thu hồi;
  - admin thu hồi được;
  - kiểm tra cách ly giữa các công ty (`isolation.test.ts`).
- **Quan hệ với plan hardening:** Task 1 (lazy reclaim theo phiên) vẫn nên làm ngay vì nhỏ và sửa lỗi đang có. Phương
  án B sẽ thay đơn vị "phiên" bằng "thiết bị" trong cùng hàm reclaim.

---

## 3. IP client (H1): phân tích kỹ hơn

### 3.1 `X-Forwarded-For` là gì và vì sao không được tin mù quáng

Khi request đi qua proxy, proxy **nối thêm** IP mà nó nhìn thấy vào cuối header:

```
X-Forwarded-For: <client tự ghi gì cũng được>, <IP do proxy 1 thấy>, <IP do proxy 2 thấy>
```

Chỉ những phần tử do **proxy của mình** ghi mới đáng tin. Phần tử **đầu tiên** do client tự gửi, nên ai cũng ghi bậy
được.

Code hiện tại tin phần tử đầu tiên, và tin nó từ **bất kỳ nguồn nào**:

- `apps/api/src/lib/http.ts:55-63`
- `trustProxy: true` ở `apps/api/src/app.ts:60`

### 3.2 Khai thác cụ thể (mô tả, chưa chạy thử)

Site gọi API thẳng từ trình duyệt (`apps/site/src/components/EnquiryForm.tsx:30`), nên API **phải** mở ra Internet.
Kẻ tấn công chỉ cần:

```bash
for i in $(seq 1 100000); do
  curl -s -X POST https://api.example/api/v1/auth/sign-in \
    -H "X-Forwarded-For: 10.$((i/65536)).$((i/256%256)).$((i%256))" \
    -H 'content-type: application/json' \
    -d '{"companyCode":"ACME","username":"user'$i'","password":"Password1"}'
done
```

| Giới hạn | Bị vô hiệu? | Hậu quả |
|---|---|---|
| `signin:ip` 30 lần / 15 phút (`routes/auth.ts:58,200`) | **Có**, vì mỗi request mang một "IP" mới | Thử mật khẩu phổ biến trên **mọi tài khoản** của một công ty (credential stuffing) mà không bị chặn |
| `signin:account` 10 lần / 15 phút | Không, vì khóa theo tài khoản | Dò mật khẩu **một** tài khoản vẫn bị chặn. Đây là lớp bảo vệ duy nhất còn hoạt động. |
| `reset:ip` (`routes/auth.ts:265,341`) | **Có** | Gửi hàng loạt mail reset mật khẩu, tốn quota mail và làm phiền người dùng |
| `enquiry:ip` (`routes/enquiries.ts:118-121`), form công khai, không cần đăng nhập | **Có** | Spam lead vào danh sách enquiry của công ty, kèm mail thông báo cho mỗi lead |
| IP lưu trong phiên (hash, `lib/tokens.ts:41`) để truy vết | IP đó là IP giả | Nhật ký điều tra sự cố không còn đáng tin |

**Lỗi ngược chiều, ở cả admin và client:** hai đường đăng nhập **không** chuyển XFF.

- Admin: bridge `apps/admin/src/app/api/sq/[...path]/route.ts:64-69`.
- Client: đăng nhập **không** đi qua bridge `[...path]` (bridge đó có chuyển XFF). Nó đi qua route riêng
  `apps/client/src/app/api/session/route.ts`, và `POST` ở đó chỉ gửi `content-type` và `accept`, không gửi cookie lên
  API, cũng không gửi XFF. *(Đính chính 2026-11-15: bản đầu của mục này cho rằng client không có lỗi này.)*

Vì vậy mọi lần đăng nhập đều mang IP của chính server Next. Chỉ cần ai đó gõ sai 30 lần, kể cả người ngoài qua trang
đăng nhập, là **mọi người dùng của app đó bị khóa đăng nhập** 15 phút. Với client là mọi công ty; với admin là toàn bộ
nhân viên vendor. Đây là kiểu tấn công từ chối dịch vụ rất rẻ.

Route `/api/session` cũng là chỗ phải sửa cho seat theo thiết bị (§2.5): nó phải chuyển cookie `sq_device` lên API và
trả `Set-Cookie: sq_device` về trình duyệt. Hiện tại nó chỉ giữ lại cookie `sq_session`.

### 3.3 Cách sửa đúng: chỉ tin proxy của mình, đọc từ phải sang

Fastify, qua thư viện `proxy-addr`, làm sẵn việc này khi cấu hình `trustProxy` là **danh sách địa chỉ tin cậy** thay vì
`true`. Nó đọc XFF **từ phải sang trái**, bỏ qua các địa chỉ tin cậy, và dừng ở địa chỉ không tin cậy đầu tiên; địa chỉ
đó là IP thật. Kết nối từ một IP không nằm trong danh sách thì XFF bị **bỏ qua hoàn toàn**.

Ví dụ với `TRUST_PROXY=loopback`:

| Request đến API từ | XFF nhận được | `request.ip` |
|---|---|---|
| Kẻ tấn công `203.0.113.7`, gọi thẳng | `10.0.0.5` (giả) | `203.0.113.7`: XFF bị bỏ qua, giới hạn áp đúng người |
| Bridge Next trên cùng máy (`127.0.0.1`) | `1.1.1.1 (giả), 198.51.100.4` (Caddy nối thêm IP thật) | `198.51.100.4`: phần giả nằm bên trái nên bị bỏ |
| Caddy trên cùng máy, tới thẳng API (luồng của site) | `198.51.100.4` | `198.51.100.4` |

### 3.4 Chọn giá trị `TRUST_PROXY` theo cách triển khai

| Triển khai | Giá trị | Ghi chú |
|---|---|---|
| Một VPS: Caddy/Nginx + Node, tất cả qua `localhost` | `loopback` (mặc định) | Phổ biến nhất |
| Docker Compose, proxy và app ở các container khác nhau | `loopback,uniquelocal` | `uniquelocal` = 10/8, 172.16/12, 192.168/16 |
| Đứng sau Cloudflare | Thêm dải IP của Cloudflare vào danh sách, hoặc cấu hình Caddy/Nginx ghi lại IP từ `CF-Connecting-IP` | Nếu không, mọi người dùng sẽ mang IP của Cloudflare và dùng chung một bucket |
| Không có proxy, API mở thẳng | `false` | XFF bị bỏ qua hoàn toàn |

**Điều kiện bắt buộc khi deploy:** cổng của các app Next (3061–3063) **không được** mở thẳng ra Internet. Nếu mở,
bridge sẽ nhận XFF giả từ người dùng và chuyển nguyên cho API, vì kết nối từ bridge tới API là loopback nên API tin
nó. Chỉ mở cổng 80/443 của reverse proxy (đặt firewall/`ufw`).

### 3.5 Cách làm chặt hơn nữa (tùy chọn, làm sau)

- **Cho site đi qua một bridge** giống client và admin. Khi đó API chỉ cần nghe ở `localhost`, **không còn mở ra
  Internet**:
  - cả loại lỗi này biến mất;
  - CORS gần như không còn cần;
  - iframe `/share/document` cũng đi qua bridge của site.
  - Khối lượng: 1 route handler + đổi `NEXT_PUBLIC_API_BASE` ở 2 file của site.
- Bổ sung CAPTCHA hoặc honeypot cho form enquiry công khai. Đây là vấn đề riêng: kể cả khi đã lấy đúng IP, một botnet
  nhiều IP vẫn spam được.
- Thêm rate limit cho đăng nhập vendor (M5 trong review).

---

## 4. Các quyết định (người dùng chốt ngày 2026-11-15: "Chốt theo đề xuất")

| # | Quyết định | Trạng thái |
|---|---|---|
| D1 | DB ứng dụng chỉ dùng Postgres; bỏ driver SQLite và test in-memory | **Đã chốt.** Task 1 của plan hardening |
| D2 | Price book giữ định dạng file SQLite; bytes lưu thêm trong Postgres | **Đã chốt.** Task 6 |
| D3 | Mô hình seat | **Đã chốt phương án B**: theo thiết bị, có tự thu hồi và màn hình Thiết bị. Task 2 |
| D4 | Cho site đi qua bridge để API không mở ra Internet | Để sau đợt hardening (phụ lục của plan) |

Plan triển khai: `docs/superpowers/plans/2026-11-15-production-hardening.md` (bản 2).
