# Smart Solutions Australia — Thông tin test (Local)

Cập nhật: 2026-11-19 · Trạng thái build: **hoàn thành, UI đã bổ sung đủ theo template**

---

## 1. Cách chạy

Có 2 cách, chọn theo nhu cầu:

**Chỉ test trên máy mình:**

```
Start\START-WEBSITE.bat
```

**Cho tester ở xa truy cập (có domain public tạm thời):**

```
Start\START-WEBSITE-PUBLIC.bat
```

Cả hai đều tự động: kiểm tra Node → cài dependencies nếu thiếu → kiểm tra PostgreSQL cổng 5432 → kiểm tra cổng 3065 → chạy migration → seed nội dung mẫu (an toàn khi chạy lại) → mở trình duyệt vào trang admin → khởi động dev server. Bản PUBLIC làm thêm một bước: mở Cloudflare quick tunnel và in ra địa chỉ `https://xxx.trycloudflare.com` để gửi cho tester.

Giữ cửa sổ đen mở trong suốt quá trình test. Dừng server bằng `Ctrl+C` trong cửa sổ đó, hoặc nhấp đúp:

```
Start\STOP-WEBSITE.bat
```

Script stop sẽ tắt cả dev server và tunnel.

Khởi động lần đầu mất khoảng 20–40 giây do Next.js biên dịch, các lần sau nhanh hơn.

**Cổng mặc định là 3065.** Cổng này được cấu hình ở 4 nơi đã đồng bộ: `Start/START-WEBSITE.bat`, `Start/STOP-WEBSITE.bat`, `.env` (`NEXT_PUBLIC_SERVER_URL`) và `package.json` (`next dev -p 3065`). Nếu cần đổi cổng, sửa cả 4 chỗ đó.

### Cho tester ở xa

Khi chạy `START-WEBSITE-PUBLIC.bat`, cửa sổ sẽ in ra dạng:

```
PUBLIC site   : https://ellen-dimensions-dad-slowly.trycloudflare.com
PUBLIC admin  : https://ellen-dimensions-dad-slowly.trycloudflare.com/admin
```

Địa chỉ này cũng được ghi vào `Start\PUBLIC-URL.txt` để bạn copy nhanh. Gửi link đó cho tester cùng tài khoản đăng nhập bên dưới.

Lưu ý về tunnel:

- Địa chỉ **đổi mỗi lần chạy** — Cloudflare quick tunnel cấp hostname ngẫu nhiên, không giữ nguyên.
- **Không cần tài khoản Cloudflare**, nhưng Cloudflare không cam kết uptime cho kiểu tunnel này; phù hợp để review, không dùng cho production.
- **Admin cũng public.** Ai có link đều mở được trang đăng nhập. Chỉ chia sẻ link cho tester và tắt tunnel khi xong.
- Máy bạn phải đang chạy và kết nối internet; tunnel trỏ về `localhost:3065` trên máy bạn, không upload code đi đâu.
- Canonical URL, sitemap và robots.txt tự dùng hostname tunnel, nên link chia sẻ có preview đúng.
- Nếu `cloudflared` chưa có, script chỉ cảnh báo và vẫn chạy local bình thường. Cài bằng: `winget install --id Cloudflare.cloudflared`

#### Nếu tester thấy "Your request was blocked."

Đây là trang lỗi của **Cloudflare edge**, không phải của website — trang này không nằm trong code của app và không xuất hiện trong mã nguồn Next.js/Payload. Quick tunnel đi qua hạ tầng Cloudflare nên thỉnh thoảng bị chặn nhầm, thường do:

- Trình duyệt gửi header bất thường (chế độ ẩn danh đặc biệt, extension chặn, profile lạ).
- Đổi giữa các mạng (Wi-Fi ↔ 4G) khiến Cloudflare thấy phiên đáng ngờ.
- IP của tester nằm trong dải bị đánh dấu.

Cách xử lý đã kiểm chứng: **đổi profile/cửa sổ trình duyệt khác** (hoặc tắt extension chặn) rồi mở lại link. Tôi đã thử cả curl, trình duyệt thật, điều hướng client-side và submit form qua tunnel — tất cả đều 200 và không có chuỗi "request was blocked" trong HTML, nên đây không phải lỗi của app.

Muốn loại bỏ hoàn toàn rủi ro này thì dùng **named tunnel** với domain riêng của bạn thay vì quick tunnel — named tunnel không đi qua lớp chặn bot dùng chung.

---

## 2. Đăng nhập

| Mục | Giá trị |
|---|---|
| URL website | http://localhost:3065 |
| URL admin | http://localhost:3065/admin |
| Email | `admin@example.com` |
| Mật khẩu | `Admin12345!` |
| Vai trò | admin (toàn quyền) |

Tài khoản do `npm run seed` tạo từ `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env`.

> Đây là mật khẩu dev, chỉ dùng trên máy local. Khi deploy phải đổi `PAYLOAD_SECRET`, `ADMIN_PASSWORD` và mật khẩu PostgreSQL.

---

## 3. Admin: quản lý nội dung theo cây trang

Sau khi đăng nhập, sidebar trái hiển thị **Website pages** — mỗi trang của site là một node, kèm collection liên quan bên dưới:

```
Website pages
├── Home
├── Capabilities
├── Process
├── Quality
├── Projects
│   ├── Project entries        ← 6 dự án
│   └── Detail template        ← 3 giai đoạn giao hàng, 6 tài liệu QA, 3 fact chung
├── Products
│   └── Product groups         ← 2 nhóm, 17 sản phẩm
├── Team
│   └── Team members           ← 3 thành viên
├── Request a Quote
│   └── Inquiries              ← form gửi về đây
├── Contact
│   └── Offices                ← 3 văn phòng
└── Privacy

Site chrome
├── Site Settings              ← logo, email, hotline
├── Header                     ← nhãn 8 mục menu + CTA
├── Footer
├── Media library              ← 29 ảnh gốc từ template
└── Users
```

Mỗi node mở thẳng form sửa nội dung của trang đó. Sửa → Save → tải lại trang web là thấy ngay, không cần build lại.

### Ẩn/hiện từng section

Mỗi section trong form của trang đều có checkbox **"Show this section"** ở trên cùng (mặc định bật).

- Tắt checkbox → section đó biến mất khỏi website, **nội dung vẫn còn nguyên** trong admin.
- Bật lại → section hiện lại ngay.
- Section dạng danh sách (chứng nhận, tài liệu QA, các bước quy trình, sản phẩm, văn phòng) có checkbox riêng nằm ngay phía trên danh sách, nhãn cũng là "Show this section".
- Nếu một trang bị ẩn hết section thì trang vẫn mở được, chỉ trống nội dung — không lỗi 500.

Dùng khi cần tạm giấu một khối chưa được duyệt hoặc đang chờ ảnh, thay vì xoá nội dung đi.

---

## 4. Đã có gì để test

### 11 trang hoạt động

| Route | Nội dung |
|---|---|
| `/` | Hero với 4 stats (có "Door → Door"), 6 chứng nhận ISO, 2 văn phòng, 6 card điều hướng, dự án nổi bật |
| `/capabilities` | 7 năng lực, card đầu có 4 bullet |
| `/process` | 5 bước, đánh số tự động |
| `/quality` | 8 tài liệu QA, ảnh + caption, ISO 9001/14001/45001, AS/NZS 4680 |
| `/projects` | 6 dự án, filter theo sector + state, lưu vào URL |
| `/projects/[slug]` | Chi tiết đầy đủ: overview, scope, 3 giai đoạn giao hàng, 6 tài liệu QA, 6 fact, prev/next |
| `/products` | 2 nhóm, 17 sản phẩm |
| `/team` | 3 thành viên đúng thứ tự |
| `/quote` | 3 bước + form báo giá nhiều field |
| `/contact` | 3 văn phòng, 2 bản đồ (có fallback), form liên hệ |
| `/privacy` | 16 mục theo Privacy Act 1988 (Cth) + APPs |

**Chrome dùng chung:** top strip navy (Sydney / Ho Chi Minh City / hotline AU / email) phía trên header; breadcrumb ở mọi trang con; header đổ bóng khi cuộn.

Ngoài ra: `/sitemap.xml`, `/robots.txt`, `/api/health`, và trang 404 cho slug không tồn tại.

### Form

Hai form đều lưu vào `Inquiries` trong admin và trả về thông báo "Thank you". Khi chưa cấu hình SMTP (`MAIL_ENABLED=false`), form vẫn hoạt động và lưu dữ liệu; chỉ không gửi email.

Có sẵn: validate từng field, chống spam (honeypot + thời gian tối thiểu 2 giây), rate limit 5 lần/10 phút/IP, chống double-submit bằng `submissionId` duy nhất.

### Dữ liệu đã seed

- 6 dự án · 3 thành viên · 2 nhóm sản phẩm (17 item) · 3 văn phòng
- 29 ảnh gốc từ template, đã tách từ base64 thành file thật trong `public/images/seed/`
- Toàn bộ copy của 11 trang, lấy nguyên văn từ template

---

## 5. Kịch bản test nên thử

**Quản trị nội dung**
1. Admin → `Home Page`, đổi dòng hero, Save, tải lại `/` → chữ mới xuất hiện.
2. Admin → `Projects` → mở một dự án → bật `Featured` → Save. Mở dự án khác, bật `Featured` → dự án trước tự tắt (chỉ 1 dự án nổi bật).
3. Admin → `Header`, đổi nhãn "Projects" thành "Dự án" → menu website đổi ngay.
4. Admin → `Media library`, upload ảnh mới, gắn vào một dự án, xem ảnh hiện trên trang chi tiết.

**Điều hướng**
5. Bấm đủ 8 mục menu, mục đang mở phải được đánh dấu.
6. Thu nhỏ xuống 375px: menu thành nút hamburger, mở/đóng được, có nút "Request a Quote" màu đỏ.
7. Bật dark mode của Windows → toàn site chuyển tối, chữ vẫn đọc được.

**Filter dự án**
8. `/projects` → bấm `Industrial` → còn 4 dự án, URL thành `?sector=industrial`.
9. Chọn thêm state `New South Wales` → còn 2 dự án.
10. F5 → filter giữ nguyên.

**Form**
11. `/quote` → bấm gửi khi form trống → thấy lỗi từng field, không có bản ghi mới trong `Inquiries`.
12. Điền đủ + tick consent → gửi → thấy "Thank you", `Inquiries` có bản ghi mới.
13. Bấm gửi 2 lần liên tiếp → chỉ tạo 1 bản ghi.

**Không có JavaScript**
14. Chrome: `F12` → `Ctrl+Shift+P` → `Disable JavaScript` → tải lại → toàn bộ nội dung vẫn hiển thị, filter vẫn đúng theo URL.

**SEO**
15. Mở `http://localhost:3065/sitemap.xml` → thấy đủ 10 trang + 6 dự án.
16. Mở `http://localhost:3065/robots.txt` → chặn `/admin`, `/api`.

---

## 6. Điều chưa hoạt động / đã hoãn

| Mục | Trạng thái |
|---|---|
| Gửi email thật | `MAIL_ENABLED=false`. Điền `SMTP_*` trong `.env` và đặt `true` để bật. Nhánh gửi mail thật chưa test với server SMTP |
| Upload bản vẽ trong form | Không có ở v1 (đúng thiết kế); form hiển thị email để gửi kèm |
| Tên pháp lý công ty | `legalName` đang là "Smart Solutions Australia"; template không có tên pháp lý |
| Nội dung Privacy | Đã soạn theo APPs nhưng **nên cho luật sư rà** trước khi public |
| Docker | Có `Dockerfile` + `docker-compose.yml` nhưng máy này không cài Docker nên chỉ kiểm tra tĩnh |

---

## 7. Thông tin kỹ thuật

| Thành phần | Giá trị |
|---|---|
| Next.js | 15.4.11 (App Router) |
| Payload CMS | 3.88.0 |
| Database | PostgreSQL 18.1, database `smartcoa` |
| Chuỗi kết nối | `postgresql://postgres:123456@127.0.0.1:5432/smartcoa` |
| Media | thư mục `media/` (không commit git) |
| Cổng | 3065 |
| Nhánh git | `feat/smart-solutions-website` |
| Test | 195 Playwright pass (7 skip có chủ đích) · 28 unit pass |

**Lệnh hữu ích:**

```bash
npm run dev          # dev server, cổng 3065
npm run build        # build production
npm run start        # chạy bản build, cổng 3065
npm run migrate      # áp migration
npm run seed         # seed lại nội dung (idempotent)
npm run backup       # backup DB + media vào backups/
npm run test:e2e     # toàn bộ test Playwright
npm run test:unit    # unit test
npm run typecheck    # kiểm tra TypeScript
```

Lưu ý: `npm run build` trong lúc dev server đang chạy sẽ ghi đè `.next`; dừng dev trước rồi build.

**Backup thủ công:**

```bash
"C:\Program Files\PostgreSQL\18\bin\pg_dump" -Fc \
  "postgresql://postgres:123456@127.0.0.1:5432/smartcoa" \
  > backups/smartcoa.dump
```

---

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Báo "PostgreSQL is not listening" | Mở CMD với quyền Administrator, chạy `net start postgresql-x64-18` |
| "Port 3065 is already in use" | Chạy `Start\STOP-WEBSITE.bat`, rồi chạy lại |
| Không có link public | Kiểm tra `cloudflared` đã cài (`cloudflared --version`); nếu thiếu: `winget install --id Cloudflare.cloudflared`. Xem log tại `%TEMP%\smartcoa-tunnel.log` |
| Link public báo lỗi 502 | Tunnel còn khởi động; đợi 10–20 giây rồi tải lại. Nếu vẫn lỗi, chạy lại script |
| Tester báo link chết | Địa chỉ đổi mỗi lần chạy — lấy link mới trong cửa sổ hoặc `Start\PUBLIC-URL.txt` |
| Trang trắng / lỗi 500 | Xem log trong cửa sổ dev server; thường do thiếu migration → `npm run migrate` |
| Admin không có nội dung | Chạy `npm run seed` |
| Ảnh không hiện | Kiểm tra `media/` và `public/images/seed/` còn file |
| Sửa admin không thấy đổi | `Ctrl+F5` trên website; kiểm tra đã Save |
| Trang admin trắng sau khi build | Dev server bị build ghi đè `.next` → dừng và chạy lại Start script |
