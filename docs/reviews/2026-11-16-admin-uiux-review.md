# Admin site — đánh giá UI/UX (2026-11-16)

Phạm vi: `apps/admin` (port 3062, control plane của vendor). Đây là bản **phân tích**, chưa sửa code.
Bổ sung cho `docs/reviews/2026-11-14-admin-site-gap-review.md`. File đó nói admin **thiếu chức năng gì**;
file này nói admin **trông và dùng thế nào**.

Cách kiểm (V = đã kiểm trong phiên này):
- Đọc code `apps/admin/src`, `packages/ui/src` và `design-system/smartquote-v2/MASTER.md`.
- Mở admin trong trình duyệt, đăng nhập bằng tài khoản test local, đi qua từng trang.
- Chạy JS đếm class Tailwind **có trên DOM nhưng không có rule CSS**.
- Chạy cùng phép đếm đó trên client để so sánh.

---

## 0. Tóm tắt

Admin "xấu" chủ yếu vì **một lỗi build, không phải vì thiết kế**. Sửa lỗi đó trước, rồi mới tới
bố cục và luồng.

| # | Vấn đề | Mức | Công |
|---|---|---|---|
| 1 | Tailwind ở admin **không quét `@sq/ui`**. 25/81 class trên trang `/company` không sinh CSS: nút mất padding, card mất padding, pill trạng thái thành khung vuông | **P0 — gốc rễ** | 1 dòng |
| 2 | Trang `/company` là một chồng card khổng lồ. Mỗi công ty bung sẵn form seats **và** form treo tài khoản (hành động phá huỷ) | P0 | vừa |
| 3 | Không có trang tổng quan. Nav 7 mục ngang, wrap thành 3 hàng ở < ~900px | P1 | vừa |
| 4 | Copy cũ sau D3 (seat = thiết bị): "Seats are live sessions", "Live sessions", "Signing out releases your seat" | P1 | nhỏ |
| 5 | `/platform` tên "Usage" nhưng chứa Releases + Template catalogue (sửa JSON tay) | P1 | vừa |
| 6 | Bảng chưa theo MASTER §5: không sticky header, không căn phải số, không zebra, số không qua formatter (`6217`, `toFixed`) | P2 | nhỏ |
| 7 | Chọn công ty bằng tên trần: hai công ty cùng tên "Demo Sheds Pty Ltd" không phân biệt được | P2 | nhỏ |

Đề xuất hướng: giữ navy/gold "Instrument" của MASTER (admin = "Control room", density 9/10). **Không** đổi
palette và **không** quay lại blue/orange glass. Chỉ đổi khung (sidebar), mật độ (bảng thay card) và
tách hành động phá huỷ ra khỏi màn hình danh sách.

---

## 1. P0 — Lỗi gốc: CSS của `@sq/ui` không được sinh ở admin (V)

> **ĐÃ SỬA 2026-11-16.**
> - Thêm `@source "./";` và hai `@utility duration-sq-fast/base` vào `packages/ui/src/tokens.css`. Không
>   sửa `globals.css` của từng app: `tokens.css` là file mọi app đều import, nên một app thứ tư cũng không
>   thể quên.
> - Kiểm lại bằng cùng phép đếm (dev server): admin `/company` 0/81 class thiếu, client `/quotes` 0/96,
>   site `/` 0/83.
> - Nút giờ có padding `8px 12px` và `transition-duration: 0.15s`.
> - Chưa chạy `next build` production.
>
> Còn lại sau khi sửa: `Stat` đặt số căn phải, cách xa nhãn (do `.sq-numeric`). Số trong ô thống kê nên
> căn trái; căn phải chỉ dành cho cột bảng. **Đã sửa cùng §2:** `packages/ui/src/surface.tsx` thêm
> `text-left` cho giá trị của `Stat`. Ảnh hưởng cả các ô thống kê bên client (UsagePage, trang báo giá), đồng
> nhất.

**Triệu chứng nhìn thấy**
- Nút "Sign in", "Save", "New company" dính sát chữ, không padding, chữ lệch trái.
  Nút "Sign in" cao 21px, `padding: 0`, `justify-content: normal`.
- Card (`Panel`) có header đẹp nhưng thân card dính sát mép, vì `p-sq-3` không tồn tại.
- `StatusPill` ("Active") thành một khung vuông viền đen. Lý do: `rounded-full px-2 py-0.5 bg-sq-ok/10
  text-sq-ok border-sq-ok/25` đều thiếu, chấm tròn `h-1.5 w-1.5` cũng mất.
- `Stat`: nhãn và số tách xa nhau (thiếu `gap-0.5`, `items-start`).

**Bằng chứng**: đếm trên DOM `/company`, có 25 class thiếu rule:
`justify-center, px-3, py-2, select-none, disabled:*, bg-transparent, rounded-lg, items-start, mt-0.5, p-sq-3,
rounded-full, px-2, py-0.5, bg-sq-ok/10, text-sq-ok, border-sq-ok/25, h-1.5, w-1.5, bg-current, gap-0.5,
placeholder:text-sq-ink-muted/60, rounded-sq-sm, object-contain, duration-sq-fast`.
Client `/quotes` chỉ thiếu 4 class.

**Nguyên nhân**
- Tailwind v4 tự dò nguồn nhưng **bỏ qua `node_modules`**, và `@sq/ui` nằm ở đó qua symlink workspace.
- Class chỉ xuất hiện trong `packages/ui/src/*.tsx` nên không bao giờ được sinh.
- Client trông ổn **nhờ may mắn**: code của client tình cờ dùng lại phần lớn các class đó. Site cũng có cùng
  rủi ro.
- `transpilePackages` (`apps/admin/next.config.ts:38`) chỉ lo phần JS, không lo CSS.

**Sửa** (mỗi app, trong `globals.css`, sau `@import 'tailwindcss'`):

```css
@source "../../../../packages/ui/src";
```

Nên thêm cho cả client và site, để client không còn phụ thuộc vào may mắn.

**Lỗi phụ trong `packages/ui/src/tokens.css:72`**
- `--duration-sq-fast` không phải namespace theme của Tailwind v4, nên `duration-sq-fast` không bao giờ sinh
  ra, ở **cả ba app**. Hover hiện đổi màu tức thì.
- Cách sửa: dùng `duration-150` / `duration-(--duration-sq-fast)`, hoặc định nghĩa
  `@utility duration-sq-fast { transition-duration: var(--duration-sq-fast) }`.

> Sau khi sửa #1, chụp lại admin trước khi làm bất kỳ mục nào bên dưới. Khoảng một nửa cảm giác "xấu" sẽ
> biến mất, và phần còn lại mới là vấn đề thiết kế thật.

---

## 2. P0 — `/company`: danh sách bị biến thành form dài vô tận (V)

> **ĐÃ SỬA 2026-11-16.**
> - `/company` giờ là **bảng** (`components/CompanyTable.tsx`): hàng 36px, header dính, số căn phải, hàng
>   xen màu. Cột: Công ty + slug · Code · Trạng thái (chữ + màu) · Seats dùng/mua · Người · Báo giá · Hết hạn
>   · Open ›. Ô seats và ngày hết hạn đổi màu "attention" khi đầy / đã hết hạn. Chưa có thanh nhỏ cho seats.
> - Ô tìm (tên / code / slug) và lọc **All · Needs attention · Active · Suspended**, mỗi nút có số đếm. Cả
>   hai ghi vào URL (`?q=`, `?state=`), nên tải lại hoặc gửi link giữ nguyên view. Khi không có kết quả, câu
>   thông báo nói rõ bộ lọc hay từ khoá đã thu hẹp về 0, kèm nút "Show every company".
> - Logic trạng thái dùng chung ở `lib/companyState.ts` (suspended → đầy seat → hết hạn → active).
> - **Trang chi tiết `/company/[id]`** (nhận id hoặc slug): Overview (4 Stat) · Seats and subscription
>   (`CompanyLimits`) · Prices (link sang `/prices?company=…`) · Danger zone (`CompanyStatus`, nút
>   `destructive`, vẫn phải gõ tên). Khi công ty đang suspended, tiêu đề là "Access" vì kích hoạt lại không
>   nguy hiểm. Dùng các section xếp dọc, không dùng tab: ít mục, đọc một lượt.
> - **"New company" ở trang riêng `/company/new`.** Huỷ = quay về `/company`. Tạo xong có nút "Open the
>   company". Sửa luôn câu sai: trước đây nói có thể reset mật khẩu ở trang công ty, thực tế không có; giờ
>   chỉ đúng đường "Forgot password" ở client (cần cấu hình mail).
> - **Không làm phần Members:** API admin không có route đọc danh sách người của một công ty (chỉ có số
>   đếm). Cần route mới trước (B2 của gap review).
> - API cũng không có `GET /admin/companies/:id`, nên trang chi tiết đọc từ danh sách (`limit=200`, cùng
>   trần với trang danh sách). Khi số công ty vượt mức đó thì nên thêm route đọc một công ty.
> - **Chưa làm:** biến `/seats` thành view lọc sẵn. Hiện vẫn sửa seats được ở hai chỗ.
> - Đã kiểm: typecheck admin pass; trên dev server, bảng, tìm, lọc, khôi phục từ URL, trang chi tiết (qua
>   slug) và `/company/new` đều render, không lỗi hydration. Chưa chạy `next build` production, chưa tạo thử
>   công ty thật qua form mới.

**Hiện trạng** (`app/company/page.tsx:66-136`). Mỗi công ty là một `Panel` chứa:
- pill trạng thái;
- 4 `Stat`;
- `dl` ngày hết hạn;
- form `CompanyLimits` (seats + subscription + Save);
- form `CompanyStatus` (lý do, gõ tên để xác nhận, nút Suspend).

Với 5 công ty, trang dài khoảng 5 màn hình. Không có tìm kiếm, lọc hay sắp xếp.

**Vấn đề UX**
- Hành động phá huỷ (Suspend) nằm **sẵn, mở**, ngay dưới form Save seats, lặp lại ở mỗi công ty.
  Người dùng phải cuộn qua nó cả chục lần. Rủi ro thao tác nhầm cũng tăng, dù đã có bước gõ tên.
- Seats sửa được ở **hai nơi**: `/company` (`CompanyLimits`) và `/seats` (`SeatManager`). Hai UI khác nhau
  cho cùng một con số.
- Không quét được bằng mắt. Vendor cần trả lời "công ty nào sắp hết hạn / hết seat?" thì phải đọc từng card.

**Đề xuất**
- `/company` thành **bảng** density 9/10, hàng 36px. Cột: Tên + code · Trạng thái (pill) · Seats dùng/mua
  (thanh nhỏ) · Người · Báo giá · Hết hạn · ›. Có ô tìm (tên/code) và lọc trạng thái (Active / Cần chú ý /
  Suspended).
- **Trang chi tiết `/company/[id]`**, chia tab: Tổng quan · Seats & subscription · Thành viên (B2 trong gap
  review) · Giá riêng · Nguy hiểm.
  - Suspend chuyển vào tab "Nguy hiểm", giữ nguyên bước gõ tên.
  - Trang này cũng là chỗ cho B1/B2/B3 của gap review, nên làm một lần dùng cho cả hai.
- "New company" mở form ở trang riêng hoặc drawer, thay vì chen trên đầu danh sách.
- `/seats` thành **view lọc sẵn** của bảng công ty (chỉ những công ty đầy seat / hết hạn), không phải trang
  sửa thứ hai.

---

## 3. P1 — Khung: thiếu tổng quan, nav ngang không mở rộng được (V)

> **ĐÃ SỬA 2026-11-16.**
> - **Sidebar navy 240px** (`components/ShellFrame.tsx`), chia nhóm: (không nhóm) Overview · **Customers**
>   Companies, Seats, Enquiries · **Prices** Price books, Company prices · **System** Usage, Audit. Mục đang
>   mở có vạch vàng bên trái, nền sáng hơn và chữ đậm hơn, nên không chỉ dựa vào màu. Mục nào role không có
>   capability thì bị ẩn; nhóm rỗng thì ẩn luôn tiêu đề nhóm.
> - **Dưới 1024px**, sidebar biến thành drawer (`components/NavDrawer.tsx`), mở bằng nút menu trên topbar.
>   Dùng `<dialog>` + `showModal()` để có sẵn focus trap, phím Escape và làm trơ phần nền phía sau. Ở 580px
>   header còn 48px (trước khoảng 190px) và trang không cuộn ngang.
> - **Topbar trắng 48px**, dính khi cuộn: breadcrumb ("Customers › Companies"), tên + vai trò, "Change
>   password", "Sign out". Không làm menu thả xuống: chỉ có hai hành động, để thẳng nhanh hơn.
> - Icon SVG 24×24, nét 1.75 (`components/NavIcons.tsx`), không dùng emoji.
> - **Trang `/` Overview** thay cho redirect (đăng nhập xong và đổi mật khẩu xong đều về `/`):
>   - 4 Stat: công ty active / tổng; seats dùng / mua (toàn hệ thống); enquiries chưa xử lý; book đang
>     active (8 ký tự hash, loại, ngày publish).
>   - "Needs attention", mức nặng nhất lên trước, mỗi dòng dẫn tới trang sửa: công ty hết seat; subscription
>     đã hết hạn; subscription hết hạn trong 30 ngày; enquiry chờ hơn 2 ngày; không có book nào active.
>   - 10 dòng audit gần nhất, kèm link sang `/audit`.
>   - Mỗi phần chỉ gọi API nếu role có capability tương ứng (support không có `platform:pricebooks` nên không
>     thấy ô price book). Phần nào lỗi thì báo một dòng, các phần còn lại vẫn hiện.
> - **Tên tab riêng cho từng trang**: "Companies · SmartQuote admin". Trang chi tiết dùng tên công ty
>   ("Demo Sheds Pty Ltd · SmartQuote admin"). Trang `/` phải ghi tên đầy đủ (`title.absolute`), vì template
>   của layout chỉ áp cho segment con.
> - **Chưa làm:** thu sidebar còn 64px chỉ icon (thêm state và chỗ lưu, lợi ích nhỏ khi đã có drawer). Mục
>   Templates/Releases chưa có trang riêng; vẫn nằm trong Usage (§5).
> - Đã kiểm: typecheck admin pass. Trên dev server: 1440px và 580px, drawer mở/đóng, mọi trang trả 200 với
>   đúng tên tab, không lỗi hydration ở các trang đã mở; trang đăng nhập (không cookie) chỉ có thanh brand.
>   Chưa chạy `next build`, chưa thử bằng tài khoản platform_support.

**Hiện trạng** (`components/ShellFrame.tsx:56-91`)
- Header navy chứa logo + 7 link + Sign out, `flex-wrap`.
- Ở bề rộng pane khoảng 580px, nav wrap thành **3 hàng** và "Sign out" đứng một mình một hàng. Header chiếm
  khoảng 190px, tức một phần ba màn hình.
- Trang đầu sau đăng nhập là `/company`; không có màn hình tổng quan.
- Tab trình duyệt luôn là "SmartQuote — licence administration". Không trang nào đặt `metadata.title`
  riêng, nên mở 3 tab không phân biệt được.

**Đề xuất**
- **Sidebar trái** navy (240px, thu được còn 64px icon; dưới 1024px thành drawer). Gom nhóm:
  - **Khách hàng**: Công ty · Seats · Yêu cầu (Enquiries)
  - **Giá**: Price books · Giá theo công ty
  - **Sản phẩm**: Templates · Releases
  - **Hệ thống**: Usage · Audit
- Nav dọc chứa thêm được A1–A4 (trình duyệt/sửa book) của gap review mà không vỡ. Nav ngang thì không.
- Topbar trắng mỏng: breadcrumb + tài khoản (email, vai trò, Đổi mật khẩu, Sign out trong menu).
- **Trang `/` Tổng quan** (thay redirect):
  - 4 Stat: công ty active, seats dùng/mua, enquiries đang chờ, book đang active (hash ngắn + ngày);
  - danh sách "Cần chú ý": hết seat, sắp hết hạn trong 30 ngày, enquiry quá 2 ngày;
  - 10 dòng audit gần nhất.
- Mỗi trang có `title` riêng: "Công ty · SmartQuote Admin".
- Icon SVG 24×24, stroke 1.75 (MASTER §5) cho mục nav. Không dùng emoji.

---

## 4. P1 — Nội dung/copy sai sau D3 (V)

> **ĐÃ SỬA 2026-11-16.**
> - Toàn bộ bảng dưới đã viết lại theo D3, thêm các chỗ cùng loại:
>   - `CompanyLimits` (hint + cảnh báo giảm seat);
>   - `CompanyStatus` (nói rõ treo thì đăng xuất thiết bị, mở lại không khôi phục thiết bị);
>   - `CompanyCreator` (hint Seats).
> - Dòng ghi chú seat ở sign-in admin đã bỏ.
> - Câu "add one row below" sửa thành "công ty tự tải bảng giá ở Settings". B4 vẫn chưa làm.
> - `tsc` admin pass; đã kiểm text trên `/seats` và `/company`.

Seat giờ thuộc **thiết bị**, không thuộc phiên (DECISIONS D3, migration 017). Admin vẫn nói theo mô hình cũ:

| Chỗ | Hiện | Nên |
|---|---|---|
| `app/seats/page.tsx:27` | "How many live sessions each company holds" | "How many devices each company has registered…" |
| `components/SeatManager.tsx:108` | "Seats are live sessions, so 'in use' can exceed…" | Seat = một trình duyệt của một người. Link tới Team → Devices của công ty |
| `components/SeatManager.tsx:14` (comment) | "A seat is a **live session**" | Cập nhật theo D3 |
| `app/company/page.tsx:97` | hint "Live sessions" | "Devices" |
| `components/SignInForm.tsx:117` | "Seats are limited — Signing out releases your seat" | **Bỏ**. Đăng nhập platform (`/auth/sign-in-platform`) không lấy seat; câu này chép từ client |
| `components/PriceOverridesPanel.tsx:146` | "…or add one row below" | Không có UI thêm dòng (B4 gap review). Sửa câu, hoặc làm B4 |

---

## 5. P1 — `/platform` ("Usage") là ba trang dồn một (V)

> **ĐÃ SỬA 2026-11-16** (một phần).
> - **Tách trang:** `PlatformPage.tsx` đã bỏ, thay bằng ba trang. `/platform` chuyển hẳn (redirect vĩnh viễn) sang `/usage`.
>   - `/usage`: server render, không có JS phía client.
>   - `/releases`: dùng `ReleaseManager`.
>   - `/templates`: dùng `TemplateCatalogue`; bảng có thêm cột Company.
> - **Nav:** nhóm "Prices" đổi tên thành "Catalogue" và có thêm Templates. Nhóm System gồm Usage, Releases, Audit.
> - **Phân quyền:** mỗi trang và mỗi mục nav ứng với đúng capability của route API.
>   - Usage cần `platform:audit`.
>   - Releases cần `platform:versions`.
>   - Templates cần `platform:templates`.
>   - Thiếu quyền thì hiện "Not available to your role" và không gọi API.
> - **Form template:**
>   - Lỗi hiện ngay dưới từng ô: company, code (cùng regex với API), name.
>   - Ô JSON building nằm trong phần "Building (advanced)", thu gọn mặc định.
>   - JSON được parse ngay khi gõ, lỗi hiện ngay dưới ô, và nút Add bị khoá cho đến khi JSON hợp lệ.
> - **Chưa làm:** tạo template bằng cách tải `.sqd` lên trước. Cần một route API đọc `.sqd` thành building cho vendor. Hiện chưa có route này: `/quotes/import/sqd` chỉ nhập file vào danh sách quote của một công ty. Validate zod đầy đủ phía client cũng chưa làm, vì API chấp nhận building thiếu field và tự điền mặc định (`normaliseShedConfig`).
> - **Đã kiểm:**
>   - `tsc` admin pass.
>   - Ba trang trả 200 với title đúng, và `/platform` redirect đúng.
>   - Lỗi form và lỗi JSON hiện đúng chỗ; History mở được.
>   - Không tràn ngang ở 1440px và 580px.
>   - Chưa thử với tài khoản `platform_support`.

`components/PlatformPage.tsx` dài 651 dòng, gồm:
- bảng Usage;
- form Releases;
- Template catalogue: chọn công ty, form, **textarea JSON "Building"**, bảng template có upload `.sqd` và
  lịch sử.

**Vấn đề**
- Nhãn nav "Usage" giấu mất chức năng Templates. Người cần thêm template sẽ không tìm thấy.
- Sửa building bằng JSON tay là công cụ của dev, không phải của vendor ops. Lỗi cú pháp chỉ biết khi bấm Add.
- Form Release và Template hiện cả với vai trò không có quyền (C2 gap review).

**Đề xuất**
- Tách thành `/usage`, `/releases`, `/templates`; mỗi trang một component.
- Template: ưu tiên "**Upload .sqd** → xem trước tên/kích thước/loại → lưu". JSON chỉ là "Nâng cao" thu gọn,
  có validate zod trực tiếp và báo lỗi ngay dưới ô (MASTER §5 Inputs).
- Ẩn form theo capability, như nav đang làm.

---

## 6. P2 — Bảng và số liệu chưa đúng MASTER §5 (V qua code)

> **ĐÃ SỬA 2026-11-16** (trừ lọc/phân trang phía server).
> - **`DataTable` trong `@sq/ui`** (`packages/ui/src/table.tsx`):
>   - `thead` sticky, nằm trong hộp cuộn riêng (`max-h-[calc(100dvh-14rem)] overflow-auto`). Cần vậy vì sticky bám vào ancestor cuộn gần nhất, mà wrapper `overflow-x-auto` cũ không bao giờ cuộn dọc.
>   - Hàng cao 36px, có zebra `bg-sq-ground/40` tính theo chỉ số dữ liệu (không dùng `even:`), nên hàng mở rộng như lịch sử template vẫn cùng màu với hàng cha.
>   - Cột `numeric` căn phải, `tabular-nums`. Có empty state, kiểu `dense`, và `height="none"` cho bảng lồng.
>   - Wrapper có `relative` để chữ `sr-only` trong ô không thoát khỏi vùng cắt. Trước đó `/audit` bị rộng hơn trang 5px ở 580px.
> - **Formatter:** thêm `count()` (`6,217`) và `bytes()` (`901 B`, `12.3 KB`) vào `format.ts`. Mọi chỗ hiển thị đều dùng `money`/`date`/`dateTime`/`count`/`bytes`, và các hàm `when()` riêng đã bỏ. Chỉ còn `toFixed` ở giá trị của ô input sửa giá, vì đó là giá trị để sửa, không phải để hiển thị.
> - **Đã chuyển sang `DataTable` (10 bảng):** Audit, Usage, Releases, Price books, Company prices, Seats, Companies, Templates cùng bảng lịch sử file, và Recent changes ở Tổng quan.
>   - Recent changes không sticky vì là bảng ngắn trong card.
>   - Sửa luôn các ô chữ bị dùng nhầm `sq-numeric`, làm chữ căn phải: nhãn release, engine, mã template. Chúng chuyển sang `font-mono`.
> - **Audit** (`components/AuditLog.tsx`):
>   - Ô tìm (summary/id/loại), lọc Who và Action, dòng trạng thái "X of Y shown".
>   - Nút "Download CSV" xuất đúng các hàng đang hiện: UTF-8 có BOM, xuống dòng CRLF.
>   - Nút Copy để chép id đầy đủ; id cũng có trong `title` và bản cho screen reader.
> - **Chưa làm:** lọc và phân trang phía server. `GET /admin/audit` chỉ nhận `limit`, nên trang lọc trên 200 dòng mới nhất và nói rõ hàng cũ hơn không được tải. Làm thật thì cần filter actor/action/khoảng ngày và cursor ở API.
> - **Đã kiểm:**
>   - `tsc` của ui và admin pass, build ui pass.
>   - 10 trang trả 200 với title đúng.
>   - Header vẫn ở đỉnh hộp sau khi cuộn `/audit` 1500px; zebra đúng.
>   - Usage hiện `6,217`, supplier codes hiện `1,489`.
>   - Lọc `company.install` cho "2 of 171 shown". Lọc không khớp hiện "Nothing matches.", Clear trả lại đủ.
>   - CSV có 172 dòng, header đúng. Copy chép đúng uuid đầy đủ.
>   - Ở 580px không trang nào tràn ngang: `/`, `/company`, `/seats`, `/audit`, `/usage`, `/price-books`, `/templates`.
>   - Load lại các trang không thêm lỗi console nào. Các lỗi "Can't resolve '@sq/ui'" trong log có từ lúc tsup đang dọn `dist` khi rebuild.
>   - Chưa kiểm: `/releases` khi có dữ liệu (DB đang trống), `/prices` khi đã chọn công ty, tài khoản `platform_support`, `next build`.

Bảng ở `audit/page.tsx`, `SeatManager`, `PriceBookManager`, `PriceOverridesPanel`, `PlatformPage`:
- Không có `sticky top-0` cho `thead`. Audit 200 dòng cuộn là mất tiêu đề cột.
- Cột số (People, In use, Seats, Cloned, counts Usage) **không căn phải**. Chỉ một số chỗ dùng `sq-numeric`.
- Kẻ border mỗi hàng thay vì zebra `--sq-ground` 40%.
- Số không qua formatter chung:
  - Usage hiện `6217` (thiếu dấu phân cách);
  - `PriceOverridesPanel.tsx:182` tự `$${(cents/100).toFixed(2)}`;
  - `PlatformPage.tsx:249,624` tự tính KB.
  - MASTER: "No component formats a number by hand". `@sq/ui/format.ts` đã có `date`; thêm/dùng `money`,
    `count`, `bytes`.
- Audit: không lọc, không phân trang, không xuất CSV (B5 gap review). `targetId.slice(0,12)…` không copy được
  id đầy đủ; nên có nút copy.
- Gom một component `DataTable` trong `@sq/ui` (sticky header, căn số, zebra, empty state, overflow-x)
  thay vì 5 bảng viết tay mỗi nơi một kiểu.

---

## 7. P2 — Form và lựa chọn

- Select công ty ở `/prices` và Template chỉ hiện tên. Có **hai** "Demo Sheds Pty Ltd" (code DEMOSHEDS và
  E2ESHEDS) không phân biệt được trong `/prices`. Luôn hiện "Tên (CODE)", như Template catalogue đã làm.
- Bảng `/seats`: ô Seats và nút Save trên **mỗi hàng**. Sửa 3 công ty là 3 lần Save, và không biết hàng nào
  chưa lưu. Dùng một trong hai cách:
  - (a) chỉ đọc ở đây và sửa ở trang chi tiết (khuyến nghị, xem §2);
  - (b) đánh dấu hàng "đã sửa", và có một nút "Lưu thay đổi (n)".
- `CompanyLimits`: ô ngày `datetime-local` hiện `mm/dd/yyyy --:-- --` (định dạng Mỹ) trong app `en-AU`.
  Subscription chỉ cần **ngày**; dùng `type="date"` và hiển thị bằng formatter `date()`.
- Sign-in admin: tiêu đề "Administration" rồi lại "Sign in" là hai heading chồng nhau. Gộp lại, và đặt
  form trong một card trắng giữa nền navy cho rõ đây là cổng nội bộ.

---

## 8. Những gì đang đúng — giữ nguyên

- Token màu dùng đúng: không có hex thô trong `apps/admin` (V, grep).
- Nav lọc theo capability, `aria-current="page"`, link `min-h-11` (≥ 44px).
- Bảng có `scope="col"`; empty state nói việc cần làm tiếp ("Create the first company above…").
- Suspend có bước gõ tên xác nhận và lý do ghi audit. Nên giữ khi chuyển sang tab "Nguy hiểm".
- Copy giải thích *vì sao* (ví dụ "Lowering a seat count never signs anybody out"). Đây là điểm mạnh; chỉ cần
  cập nhật theo D3.

---

## 9. Thứ tự đề xuất

1. **Sửa #1** (`@source` cho 3 app + `duration-sq-*`), rồi chụp lại admin, client và site. Nửa giờ.
2. Sửa copy §4. Nửa giờ.
3. Shell mới: sidebar nhóm, topbar, `title` từng trang, trang Tổng quan (§3).
4. `/company` thành bảng + trang chi tiết có tab; `/seats` thành view lọc (§2, §7). Làm chung với B1/B2/B3 của
   gap review.
5. Tách `/platform` (§5).
6. `DataTable` + formatter chung, rồi áp lên 5 bảng (§6).

Bước 3–6 nên có một `design-system/smartquote-v2/pages/admin.md` (override cho admin: sidebar, density 9/10,
bảng 36px) trước khi code, để MASTER vẫn là nguồn duy nhất.

## Chưa kiểm

- Trang `/enquiries`, `/change-password`, `/price-books` mới chỉ xem qua code và text, chưa chụp màn hình
  từng trạng thái (loading/lỗi).
- Site (3063) chưa đếm class thiếu. Nó cũng không có `@source` nên có cùng rủi ro với admin.
- Bàn phím/screen reader chưa đi qua từng form.
