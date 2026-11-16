# Admin site & quản lý price book — rà soát hiện trạng và khoảng trống (2026-11-14)

> Phạm vi: chỉ **truy xét + ghi chú**, không sửa code. Kế hoạch triển khai ở
> `docs/superpowers/plans/2026-11-14-admin-price-book-management.md`.
>
> Ký hiệu: **(V)** = đã đọc code / mở dữ liệu trong phiên này, có `file:line`.
> **(I)** = suy luận, chưa chạy thử. **Chưa kiểm** = chưa đủ ba bước của `CLAIM-DISCIPLINE.md`, không được
> ghi là "thiếu/không làm được".

## 0. Tóm tắt một trang

> **Cập nhật 2026-11-14:** đã chốt quyết định (§5). Ba điểm đổi so với đề xuất ban đầu:
> - Có book tổng và book công ty kế thừa từ book tổng.
> - Margin tính giống desktop.
> - Desktop sẽ bị bỏ.
>
> Chỗ nào bên dưới nói "một book chung" hoặc "company margin ghi đè" là ý **cũ**.

1. **Câu hỏi chính — "v2 không có chỗ cập nhật price book" là đúng về thực chất.**
   - Trang `/price-books` của admin có nút **Publish and activate**. Nhưng ô nhập là **đường dẫn thư mục
     trên máy chủ** chứa bản dump JSON (V: `apps/admin/src/components/PriceBookManager.tsx:41-48`,
     `apps/api/src/routes/priceBooks.ts:59-64`).
   - Bản dump đó chỉ sinh ra được bằng cách chạy `tools/price-dump/run.sh` trên một máy Windows có
     **cài app desktop** (đọc SQLCipher `Jz62L4.dll`).
   - Nghĩa là: muốn đổi một giá, hôm nay vẫn phải sửa trong **desktop**, dump lại, rồi publish. Admin
     web **không xem, không sửa được một dòng nào** của book.
2. **Thứ đã có trên web chỉ là lớp "giá riêng của từng công ty"**, chưa phải giá của book:
   - Override (`/prices` ở admin, `/settings/prices` import Excel ở client).
   - Settings `margin`, `rates`, `minimumFees`.
   - Override chỉ sửa được dòng **đã tồn tại** do import trước đó, không có bộ chọn dòng từ book
     (V: `PriceOverridesPanel.tsx:189-201`; `readCatalogue` ở `packages/core/src/lib/pricing/catalogue.ts:114`
     không route nào gọi).
3. **Desktop v1 có cả một bộ "Material Manage"** sau cổng mã admin (V, xem §2.1):
   - Sửa trực tiếp 21 bảng giá (kể cả bảng hệ số `setting_price_coeffcient`) và 7 bảng cấu hình màu/option.
   - Xuất/nhập Excel theo nhóm bảng.
   - **Apply All**: đẩy DB lên server và tăng version để mọi máy cập nhật.
   - Backup/restore DB.
   - v2 chưa có tương đương nào cho các mục này ngoài "publish lại cả bản dump".
4. **Lỗi/độ lệch phát hiện thêm**, nghiêm trọng nhất trước:
   - **Hệ số giá theo cấu trúc × bang (`setting_price_coeffcient`) không được dùng.** v2 tính mọi báo giá
     với `settings.margin ?? 1.48`.
     - Comment trong code nói ngược lại (V: `apps/api/src/routes/evaluations.ts:297-312`).
     - `docs/PRICING-PIPELINE.md:261` và `docs/smartquote-quote-editor-reference.md:2671` cũng mô tả sai.
     - Desktop thì dùng hệ số này làm margin (V: `smq-code-smartquote/Modules/Funcs/Input/Details/SmartQuote.ModuleDetails.ViewUc/Controls/QuoteDetailsView.Events.cs:216`,
       `Modules/Main/SmartQuote.Module.Main/Data/PriceController.Calculation.cs:37`).
     - Đây là **lệch giá thật** ở mọi tổ hợp cấu trúc/bang có hệ số ≠ 1.48. Nó chưa có dòng nào trong
       `KNOWN-DEVIATIONS.md`.
   - **Hai con trỏ "book đang active" có thể lệch nhau** (§1.3).
   - **Cổng lưu báo giá không kiểm book đã đổi** giữa lúc xem giá và lúc lưu (§1.3).
5. **Admin site nói chung** đã đủ phần vận hành tối thiểu:
   - Có: tạo/treo công ty, seat, enquiry, template `.sqd`, release record, usage, audit.
   - Thiếu phần **quản trị công ty sau khi tạo**: sửa thông tin, xem thành viên, reset mật khẩu admin
     của công ty, xem settings.
   - Thiếu **lọc audit**.
   - Có vài **lệch quyền** giữa nav và API (§3).

## 1. Workflow / business hiện tại của v2 (đã đọc code)

### 1.1 Luồng giá từ đầu đến cuối

```
Desktop install (Windows)            v2 server
──────────────────────────           ─────────────────────────────────────────────────────────
Jz62L4.dll (SQLCipher)  ──run.sh──▶  tools/price-dump/out/*.json   (README.md:47-50)
                                          │  pnpm publish-book  |  POST /admin/price-books {dumpDir}
                                          ▼
                                     publishPriceBook()  core/pricing/publish.ts:87
                                       hash = sha256(tên file + bytes dump)      :62-71
                                       data/price-books/<hash>.db (+ .meta.json, active.json)
                                     publishAndActivate()  api/lib/priceBook.ts:131
                                       INSERT price_books, UPSERT price_book_active('singleton')  :169-196
                                          │
POST /evaluate (client) ──────────▶  activeBookHash()  evaluations.ts:248  → openBook(hash).lookup
                                     + withOverrides(company)   evaluations.ts:276-279
                                     + settings (margin, bomProfile, rates)   :281-316
                                     → evaluateQuote()  (core, A13)
Save revision ────────────────────▶  ghi price_book_hash, override_version, settings_version (khoá bằng trigger)
                                     bom_json đóng băng — tài liệu/BOM cũ đọc lại bản đã lưu
```

### 1.2 Ai được làm gì với giá (V)

| Lớp | Ai sửa | Ở đâu | Phạm vi |
|---|---|---|---|
| **Price book** (≈80 bảng, ≈31.5k dòng) | `platform_admin` (`platform:pricebooks`, `packages/contracts/src/roles.ts:86-96`) | admin `/price-books`, CLI `pnpm publish-book` | **Toàn bộ hệ thống**: một book active duy nhất cho mọi công ty (`001_init.sql:281-289`) |
| **Override theo dòng** (`price_row_overrides`, có version) | company `price:manage` (admin + estimator); vendor `platform:companies` | client import Excel `/settings/prices`; admin `/prices` | Chỉ `unitCost` của 16 bảng trong `CATALOGUE_SOURCES` (`packages/core/src/lib/pricing/rowKeys.ts:67-231`) |
| **Mặt hàng riêng** (`company_catalogue_rows`) | như trên, chỉ qua import Excel | client `/settings/prices` | Thêm/bớt mặt hàng của công ty |
| **Settings công ty** (có version) | `settings:manage` | client `/settings` | `margin`, `depositPct`/`progressPct`, `bomProfileId`, `rates`, `minimumFees`, thông tin công ty, điều khoản |

Các bảng **có giá nhưng không có cách nào sửa trên web**, kể cả qua override (V: không có trong
`CATALOGUE_SOURCES`):
- `cost_apex`, `cost_haunch` (`cost`)
- `skylight` (`price`)
- `rdoor_parts`, `purlin` (`purlin_price`)
- `delivery_data`
- `setting_price_coeffcient`
- `app_setting` (JSON: `PriceCoeffcient`, `DefaultEquipmentHires`…)

### 1.3 Điểm lệch / lỗi trong logic hiện tại

| # | Phát hiện | Bằng chứng | Hệ quả |
|---|---|---|---|
| L1 | **Không dùng hệ số giá theo cấu trúc × bang.** API chỉ truyền `margin: settings.margin ?? 1.48`, không bao giờ đặt `policy.marginFor`. Core có `lookup.margin(structureId, state)` nhưng chỉ test gọi. | (V) `evaluations.ts:297-316`; `packages/core/src/lib/estimating/evaluate.ts:63`; `packages/core/src/lib/pricing/lookup.ts:274-275,745-751`. Book có 88 dòng `setting_price_coeffcient`. | Giá lệch so với desktop ở mọi cấu trúc/bang có hệ số khác 1.48. Hai tài liệu mô tả sai. Ô "State" ở Step 1 không ảnh hưởng margin như tài liệu reference nói. |
| L2 | **Hai nơi ghi book active.** API đọc bảng `price_book_active`; core ghi/đọc `active.json`. | (V) `apps/api/src/lib/priceBook.ts:47-49`; `packages/core/src/lib/pricing/publish.ts:139,155,339` | (I) Một công cụ đọc `active.json` (ví dụ `scripts/golden.ts`, `listPublishedBooks`) có thể báo book khác với book đang tính giá. |
| L3 | **Lưu revision không kiểm book đã đổi** giữa preview và save. Cổng chỉ so config hash và override version. | (V) `evaluations.ts:460-499` | Publish trong lúc người dùng đang mở báo giá → con số đã xem và bản đã lưu dùng hai book khác nhau, không có cảnh báo. |
| L4 | **Xuất `.vqu` dùng book active** để lấy tên màu/option, kể cả với revision cũ. | (V) `apps/api/src/routes/vquExport.ts:62-66` | (I) Revision cũ có thể in tên màu/option của book mới. |
| L5 | **Import Excel ghi version mới chỉ gồm các dòng trong file**, không mang các override khác sang. | (I, agent đọc) `apps/api/src/routes/priceImport.ts:258-279` so với PUT override `priceOverrides.ts:296-345` (có mang sang) | (I) Một lần import "một phần" xoá ngầm các override đặt tay trước đó. **Cần test trước khi kết luận.** |
| L6 | **Xoá một version override** làm revision đang trỏ `override_version` đó không còn tra lại được. | (I) `priceOverrides.ts:139` (DELETE version) | Mất khả năng trả lời "báo giá này dùng giá nào". |
| L7 | Không có route **kích hoạt lại book cũ** (rollback). Publish là con đường duy nhất để đổi active. | (V) `priceBooks.ts` chỉ có GET/POST | Lỡ publish sai thì phải tìm lại thư mục dump cũ. File book cũ vẫn còn trên đĩa nhưng không bật lại được. |
| L8 | **Không có upload**: publish nhận đường dẫn trên máy chủ. | (V) `priceBooks.ts:59-64` | Vận hành viên phải có quyền vào file system của server. Không dùng được khi API chạy ở máy khác/cloud. |
| L9 | Tài liệu lỗi thời. | (V) `tools/price-dump/README.md:59-62` (nói `scripts/import-price-book.ts`, `data/pricing.db` không tồn tại); `apps/api/src/lib/priceBook.ts:16-17` ("one company"); `docs/OPERATIONS.md:19` ("documents.ts refuses", không thấy kiểm hash) | Dễ dẫn sai người vận hành. |

## 2. Desktop v1 có — v2 chưa có

### 2.1 Quản lý price book trong desktop (V — đã đọc code; dòng nào đã chết thì ghi rõ)

Cách vào: menu **ADMINISTRATION → Database** (`Modules/Home/SmartQuote.Module.Home.View/XModule.cs:753`,
handler `ManageDatabase` ở `Modules/Home/SmartQuote.Module.Home.View.SFProvider/XModule.cs:677`) →
`MainForm.materialManageToolStripMenuItem_Click` (`Modules/Main/SmartQuote.Module.Main/UI/MainForm.cs:3393`)
→ `ManageMaterial()` (`:2680`). Nó hỏi **mã quản trị** qua `AdminRequest` rồi mở `AdminManageManterial`.

- Mã quản trị là hằng số trong mã nguồn (`AdminRequest.cs:10`).
- Ô nhập được **điền sẵn** mã đó (`:72`) và so sánh ở `:122`. Thực tế người dùng chỉ cần bấm OK.
- Không mục nào của menu ADMINISTRATION kiểm vai trò (`ERole`/`IRoleService` không dùng trong trình sửa giá).
  **Mọi người dùng đã đăng nhập đều sửa được giá.**
- Không có audit: sửa DB không ghi ai sửa, lúc nào.

(Đường dẫn module dưới đây tính từ `Modules/Manage/Any/SmartQuote.Module.Manage/`.)

| Chức năng desktop | Nơi trong code | v2 hiện có? |
|---|---|---|
| **Sửa bảng giá dạng lưới** (Add / Edit / Delete / Save từng dòng) cho 21 bảng: Frame, Wall/Roof Sheeting, Haunch, Apex, Plate/Bracket, Price Coefficient, Bolt, Screw, Window, Wind Bracing, Delivery, Downpipe, Flashing, Gutter, Misc Option, PA Door, Purlin, Roller Door, Skylight, Sliding Door | `Admin/UI/AdminManageManterial.cs:115-141` (danh sách bảng), `:93` `OpenGenericTableManager`; `Admin/UI/MaterialDataManagementForm.cs:127,161,245,268` (Add/Edit/Delete/Save); `Services/UniversalTableCrudService.cs:37-153` (CRUD SQL chung) | **Không.** Chỉ override `unitCost` cho các dòng đã import, theo từng công ty. |
| **Sửa bảng cấu hình catalogue**: Colour Selected (+Config), System Drawing Colour, Drawing Size, Structure Option (+Config), System Colour | `AdminManageManterial.cs:476-660` | **Không.** |
| **Hệ số giá** (cấu trúc × bang) | Sửa qua **lưới chung** (bảng `setting_price_coeffcient` nằm trong danh sách `:115-141`). Đọc khi tính giá qua `Layer/Repository/StructureData/SmartQuote.Repository.StructureData.Provider/Setting/RepositoryPriceCoeffcient.cs:62` (thiếu thì = 1). Form riêng `PricingFactor` (import/export `.sqc`) là **code chết**: handler ở `AdminManageManterial.cs:187,324` không gắn vào nút nào trong Designer. | **Không**, và v2 còn **không dùng** hệ số này khi tính giá (L1). |
| **Mọi bảng** (Manage All Tables, Table Info) | Nút bị ẩn: `AdminManageManterial.Designer.cs:70,80` `Visible = false` | Không cần làm (desktop cũng đã ẩn). |
| Các nút "Girt & Purlin Spacing", "Lookup Code", "Update Price/Mass from CS" | Không có handler Click (theo khảo sát) | Không cần làm. |
| **Excel**: chọn nhóm bảng (Material / System / Measurement / All), Export ra xlsx, Import từ xlsx (sheet = bảng, hàng 2 = cột, dữ liệu từ hàng 3) | `Admin/UI/ExcelDataManagement.cs:141-206,214,316`. **Import xoá bảng, tạo lại rồi chèn hàng loạt** (`:384-399`), không trộn, không kiểm hợp lệ. Chỉ mở khi app là bản mới nhất (`:430`). | **Một phần**: client import Excel *override theo công ty* (`priceImport.ts`). Không export/import **book**. v2 nên làm **có kiểm hợp lệ** và đi qua bản nháp, không chép kiểu "drop & insert". |
| **Apply to All Users = phát hành**: commit file DB lên kho Git, tăng số patch của version, gọi API installer đặt version "master" kèm release note. Mỗi đại lý phải chạy **Installer** để tải DB mới (`App/SmartQuote.Installer/InstallerForm.VersionDb.cs:50-75`). | `ExcelDataManagement.cs:457-520` (`RepoInstaller.UpgradeFileData`, `InstallerApi.UpgradeLatestVersion`) | **Tương đương về ý tưởng**: publish → book mới content-addressed, active cho mọi công ty **ngay lập tức** (không cần cài). Nhưng đầu vào phải là dump, không phải chỉnh sửa trên web. |
| **DB riêng của đại lý**: `L3bHaw.dll` trong ProgramData, được ưu tiên hơn DB chung | `Modules/Repository/SmartQuote.Module.Repository/DaoConfig.cs:10,37-52` | Tương đương: **override theo công ty** (chỉ cột giá). |
| **Backup / Restore** DB giá ra file `.db` | `AdminManageManterial.cs:676-724` (restore = chép đè file, phải khởi động lại) | **Không có trên UI.** Book cũ còn trên đĩa nhưng không bật lại được (L7). |
| Kiểm dữ liệu không hợp lệ | `Admin/InvalidDataUtils.cs` | **Chưa kiểm** nội dung. |

Ghi chú bảo mật cho người triển khai: `ExcelDataManagement.cs:131` khởi tạo kho Git bằng **khoá cứng trong
mã nguồn**. Không mang mô hình này sang v2. v2 dùng phiên đăng nhập + quyền `platform:pricebooks` + audit.

### 2.2 Các chức năng quản trị khác của desktop

Nguồn: tôi tự đọc một phần, phần còn lại lấy từ khảo sát desktop. Khảo sát xác định "còn sống" bằng
`App/SmartQuote/XConfig.cs`, csproj và phần nối sự kiện trong Designer. Menu ADMINISTRATION nằm ở
`Modules/Home/SmartQuote.Module.Home.View/XModule.cs:723-953`; handler ở
`Modules/Home/SmartQuote.Module.Home.View.SFProvider/XModule.cs:150-212`.

| Chức năng desktop (còn sống) | Nơi trong code | v2 hiện tại |
|---|---|---|
| **Settings → User Accounts**: User Code, Name, Role, Email, Phone; thêm/sửa/xoá; đổi mật khẩu. Vai trò User < Admin < SuperAdmin < Developer | `Modules/Manage/Users/SmartQuote.Module.Manage.Users.View.Form/ManageUser.cs`, `RegisterUser.cs`; `Manage.Users/Dicts/DRole.cs:13-29` | **Có ở client** `/team` (mời, đổi vai trò, xoá, gửi reset). **Admin vendor không xem được thành viên** của công ty, không reset được mật khẩu admin công ty. |
| **Settings → Company Details**: code, tên, địa chỉ, điện thoại, fax, email, **logo**, email Manager / SQ team / **CC / BCC**. Máy chủ có thể ghi đè hồ sơ + logo khi đăng nhập (đồng bộ từ vendor) | `Modules/Home/SmartQuote.Module.Home.View.SFProvider/UserSettings/CompanyInformationCustomPropertiesView.cs:124,379-416`; đồng bộ ở `Modules/Login/SmartQuote.Module.Login.View.Service/Methods/AuthenticationResponseMethods.cs:67-126` | Có ở client `/settings` (text). **Chưa kiểm**: CC/BCC mặc định khi gửi mail. **Không có logo ảnh theo công ty** (chỉ `LOGO_FILE` toàn hệ thống). Vendor **không xem/sửa được** hồ sơ công ty từ admin. |
| **Settings → Default Prices / Quote Rates / Equipment Hire / Demolition / Distributor Misc. Options / Default Inputs** | `Modules/Main/SmartQuote.Module.Main/UI/Administration.cs:53-156`; lưu ở `Modules/Core/SmartQuote.Module.Core.Service/Services/AdminService.cs` (JSON mã hoá trong ProgramData); mặc định giao kèm `App/SmartQuote/init_setting.json` | **Phần lớn có ở client `/settings`**: margin, rates (labour, default costs), mức khách hàng (`packages/core/src/domain/quoteRate.ts`), freight minimum. Equipment hire và demolition ở v2 là **một dòng mỗi báo giá** (`packages/core/src/domain/additions.ts:43,51`). Desktop có **danh sách mục** cho từng loại. **Chưa kiểm** chi tiết danh sách đó. |
| **Building Templates Manager** | menu `:742`; `BuildingCatalogueForm` / `BuildingCatalogueNewForm` (SFProvider) | **Có**: admin `/platform` (template catalogue + `.sqd`). |
| **Revisions** (New / Manage Revision) | Home.View `:289,300`; SFProvider `:889` | Có ở client (revision bất biến). |
| **Gửi mail** báo giá / đơn kỹ thuật / đơn sản xuất (xem trước rồi gửi) | `MainForm.SendMail :2738`, `UI/MailReview.cs` | Có gửi mail tài liệu ở client. **Chưa kiểm** đủ ba loại đơn. |
| **Cập nhật phiên bản** (Installer, ép cập nhật) | `Modules/Version/SmartQuote.Module.Version.Service/Services/InstallerApi.cs:38,79,114` | Không cần (web). Admin `/platform` chỉ **ghi nhận** release. |
| **Bản quyền / kích hoạt** theo company code, xác thực lại 7 ngày, ngày hết hạn | `AuthenticationResponseMethods.cs:20` | Có: seat + ngày hết hạn subscription ở admin `/company`. |
| BOM to CSV, Punching details, xuất `.vqu` (sau cổng admin) | `MainForm.cs:2830,3060,3429-3454` | `.vqu` có (`vquExport.ts`). **Chưa kiểm** BOM CSV và punching. |

Desktop **có code nhưng đã chết** — không cần đưa sang v2:
- Cấu hình SMTP/Outlook: `Modules/Mail/*` (`MailConfigForm`, `OutlookAddressConfigForm`) không nằm trong
  `XConfig` và không được code sống nào gọi (V: chỉ được tham chiếu bên trong chính module Mail).
- Form `PricingFactor` (xem §2.1).
- Page Setup, Payment Options, Labour Rates, Backup Profile, Export Init Settings, Setting Log, menu Check for
  Updates: đều bị comment ra hoặc ẩn.
- Tải DB lúc đăng nhập: `AuthenticationResponseMethods.CheckAndDownloadDb :129-149` có code, nhưng lời gọi ở
  `:124` bị comment ra.

Desktop **không có** (để v2 không phải "đuổi theo"):
- Audit / lịch sử sửa giá.
- Màn hình đánh số báo giá.
- Quản lý danh sách khách hàng. Khảo sát chưa xác minh hết mục này.

### 2.3 Điều v2 đã làm tốt hơn desktop (không được làm hỏng khi thêm tính năng)

- Book bất biến, có hash. Revision cũ luôn tính lại ra đúng con số đã gửi.
- Phát hành có hiệu lực ngay cho mọi công ty. Đại lý không phải chạy Installer.
- Sửa giá cần đăng nhập + quyền + audit. Desktop dùng mã cố định điền sẵn, ai đăng nhập cũng sửa được.
- Không có mật khẩu/khoá trong mã nguồn.

## 3. Admin site hiện tại — có gì, thiếu gì

### 3.1 Đang có (V, `apps/admin/src`)

| Trang | Làm được | API |
|---|---|---|
| `/company` | Liệt kê; tạo công ty (tên, code, slug, seats, email/tên admin → mật khẩu tạm hiện một lần); đổi seat và ngày hết hạn; treo/kích hoạt lại (treo thì thu hồi mọi phiên) | `GET/POST /admin/companies`, `PATCH …/:id`, `PATCH …/:id/status` (`admin.ts:46-222`) |
| `/seats` | Bảng seat mọi công ty + danh sách cần chú ý | `PATCH /admin/companies/:id` |
| `/price-books` | Liệt kê book (hash, sample/licensed, số mã nhà cung cấp, cái nào active); publish + activate từ **đường dẫn server** | `GET/POST /admin/price-books` |
| `/prices` | Chọn công ty; xem các version override; Change/Save/Use book price trên dòng đã có; xoá một version | `/admin/companies/:id/prices/overrides` |
| `/enquiries` | Danh sách Waiting/Handled, đánh dấu đã xử lý | `GET/PATCH /admin/enquiries` |
| `/platform` | Usage (đếm theo loại); Releases (chỉ ghi nhận); Template catalogue (thêm, archive, upload/tải `.sqd`, lịch sử) | `/admin/usage`, `/admin/releases`, `/admin/templates*` |
| `/audit` | Bảng 200 sự kiện gần nhất, không lọc | `GET /admin/audit?limit=200` |
| `/change-password` | Đổi mật khẩu bắt buộc | `POST /auth/password` |

### 3.2 Thiếu, xếp theo ưu tiên

**P0 — chặn mục tiêu "quản book ở admin"**
- A1. Trình duyệt book: danh sách bảng, tìm/lọc dòng, xem một dòng.
- A2. Sửa giá trong book theo kiểu **bản nháp**, xem trước tác động, rồi **publish thành book mới**.
- A3. Kích hoạt lại book cũ (rollback), có ghi audit.
- A4. Xuất/nhập Excel cho book (tương đương `ExcelDataManagement` desktop).
- A5. Upload bản dump (zip) thay cho đường dẫn server. Chỉ cần nếu vẫn giữ luồng dump.
- A6. Sửa L1 (hệ số giá theo cấu trúc × bang) **hoặc** ghi rõ là lệch có chủ ý. Cần quyết định — xem §5.

**P1 — vận hành công ty**
- B1. Trang chi tiết công ty: sửa tên/slug/ABN; code thì cân nhắc kỹ vì đó là khoá đăng nhập.
- B2. Xem thành viên của công ty; **reset mật khẩu admin công ty**. Comment ở
  `CompanyCreator.tsx:17-19` đã hứa việc này nhưng không có route.
- B3. Xem (chỉ đọc) settings công ty: margin, rates, minimum fees. Hỗ trợ khi khách hỏi "sao giá khác".
- B4. Override: **thêm dòng** từ book bằng bộ chọn (dùng `readCatalogue`), không chỉ sửa dòng đã có. Hiện
  route xoá-tất-cả (`priceOverrides.ts:150`) và trường `custom` (`PriceOverridesPanel.tsx:50`) không ai dùng.
- B5. Audit: lọc theo công ty/hành động/thời gian, phân trang, xuất CSV.

**P2 — sửa lệch quyền & dọn dẹp**
- C1. Nav "Seats" cần `platform:companies` nhưng lưu cần `platform:seats`. `platform_support` thấy nút
  Save rồi bị từ chối.
- C2. `/platform` không ẩn form Release/Template theo quyền.
- C3. `platform_support` **sửa được giá override** của công ty, vì route chỉ đòi `platform:companies`.
  Nên đòi `platform:pricebooks` hoặc một quyền mới `platform:prices`.
- C4. Route công ty `/prices/overrides` không ai gọi được: bridge client không cho tiền tố `prices`.
  Cần quyết định: mở cho client, hoặc bỏ.
- C5. Logo ảnh theo công ty, và email CC/BCC/Manager mặc định của công ty. Desktop có trong Company Details.
  Cấu hình SMTP thì desktop **không** có (module Mail đã chết), nên giữ SMTP ở env là đúng.
- C6. Ngày hết hạn subscription lúc tạo công ty (UI luôn gửi `null`, `CompanyCreator.tsx:104`).

## 4. Chưa kiểm (không được ghi là "thiếu")

- `InvalidDataUtils.cs` của desktop làm gì.
- Desktop thực tế chỉ mở lưới cho 21 bảng giá + 7 bảng cấu hình. Nút "All Tables" bị ẩn (V), nên **người
  dùng desktop không sửa được bảng engineering** từ UI. Nhưng **Excel Import** nhận bất kỳ bảng nào có tên
  ở ô A1; liệu nó có bị dùng cho bảng engineering hay không thì chưa kiểm.
- L5 và L6: cần một test chạy thật để xác nhận.
- ~~Hệ số khi tính giá đọc từ JSON hay từ bảng~~ — **đã kiểm 2026-11-14, xem §4.1.**
- Các bảng `view_*` trong book là **bảng vật chất hoá**, cùng `id` và cùng `cost` với bảng gốc. Đã kiểm
  trên book `fe5a7cae…`: `view_cost_sheeting` 272/272, `view_cost_window` 26/26, `view_system_lookup_data`
  2752 khớp `id`. Book có 7 bảng `view_*`: cost_sheeting, cost_window, system_design_parameters,
  system_footing, system_lookup_data, system_shed_parameters, system_structure.
  - **Câu SQL tạo view không có trong dump** (V): `tools/price-dump/DumpAll.cs:62-99` chỉ chạy `SELECT *`
    trên view và ghi ra JSON dữ liệu.
  - Hệ quả khi bỏ desktop: muốn **thêm/xoá dòng** ở bảng nguồn của một view thì phải dựng lại view, mà định
    nghĩa view chỉ nằm trong DB desktop. **Phải lấy định nghĩa view ra trước khi bỏ desktop** (plan Task 0).

### 4.1 Margin của desktop (V — đọc 2026-11-14)

- **Nguồn = bảng `setting_price_coeffcient` trong DB**, không phải JSON.
  - `GetCoeffcient` đọc `Root` = `FindAll()` (`RepositoryPriceCoeffcient.cs:52-66`).
  - `FindAll()` là truy vấn ORM trên bảng (`RepositoryBase.cs:92`). Bảng khai báo ở
    `MSettingPriceCoeffcient.cs:9-16`, khoá là (structure_id, state_code).
  - File JSON `T8r9MK` chỉ dùng cho Import/Export (`RepositoryPriceCoeffcient.cs:36-47`).
- **Không có dòng thì hệ số = 1** (`RepositoryPriceCoeffcient.cs:65`), không phải 1.48.
  - v2 `lookup.margin` đã theo đúng điều này (`packages/core/src/lib/pricing/lookup.ts:745-751`).
  - Nhưng route evaluate không dùng nó và tự đặt `settings.margin ?? 1.48` (`apps/api/src/routes/evaluations.ts:312`).
- **Margin gắn vào báo giá** (`quotation.PriceData.Margin`). Có bốn chỗ:
  - Gán bằng hệ số hệ thống khi Quote details đổi (`QuoteDetailsView.Events.cs:216`).
  - Gán lại khi gia hạn báo giá (`QuotationController.cs:528`).
  - Gán lại khi tính theo "system setting" (`PriceController.cs:289`).
  - Ở chế độ custom thì giữ giá trị người dùng nhập (`PriceController.cs:297`).
- **Sửa margin từng báo giá:** ô Margin ở màn Cost (`CostView.State.cs:166`, `CostView.Items.cs:216`), nằm
  trong nhóm "SuperAdmin only" (`CostView.State.cs:46-58`). Nút Default bật khi margin ≠ hệ số hệ thống
  (`CostView.State.cs:618`).
  - Cờ `b` quyết định ai thấy nhóm này (`CostView.State.cs:38`) lấy từ đâu: **chưa kiểm**.
- **Công thức tổng cho khách** (`PriceController.cs:443-480`):
  1. `base = BuildingBaseCost (+ ShedSafe fee nếu file không phải v2.x) + MiscOptionsPrice`
  2. `num1 = base × margin + MicsExChargeNotes + MicsEngineeringCharges`
  3. `total = (num1 × 1.1 + delivery) × (1 + CustomerRate/100) + Σ distributor (qty × unit × 1.1)`
  - Đối chiếu từng bước với `evaluateQuote` của v2: **chưa kiểm**. Plan Task 3 làm việc này.
- **Desktop không có "margin công ty"**. Muốn công ty có margin riêng thì sửa bảng hệ số trong DB riêng của
  công ty đó (DB riêng `L3bHaw.dll` thắng DB chung).

## 5. Quyết định — ĐÃ CHỐT 2026-11-14

Chủ sản phẩm trả lời:
- *"Tôi muốn sửa trên web admin: báo giá tổng và các công ty clone ra kế thừa — có thể sửa riêng cho từng
  cty. Sửa trên một bản nháp, khi publish hệ thống tạo ra một book mới. Tôi chuẩn bị bỏ hoàn toàn app desktop."*
- *"Cách tính giá phải giống ver1 desktop."*
- Các mục còn lại theo đề xuất.

| # | Kết quả |
|---|---|
| D1 | **Giữ A4**. Bản nháp → publish ra file book mới. Ghi ADR A21. |
| D2 | **ĐỔI.** Có một **book tổng (master)** do vendor sửa. Mỗi công ty có **book công ty**, tạo ra từ book tổng cộng với các thay đổi riêng của công ty đó. Khi book tổng có bản mới, mọi book công ty được dựng lại trên bản mới: ô nào công ty chưa sửa thì nhận giá mới, ô nào công ty đã sửa thì giữ giá của công ty. Vendor sửa giá công ty trên admin. |
| D3 | **ĐỔI vì bỏ desktop.** Web phải sửa được mọi thứ desktop từng sửa được, nên làm theo hai bậc:<br>• Bậc 1: sửa giá trị ô trên 21 bảng giá + hệ số + delivery. Book tổng sửa được mọi cột của các bảng đó; book công ty chỉ sửa cột giá/khối lượng/hệ số.<br>• Bậc 2: thêm/xoá dòng ở book tổng. Cần định nghĩa view (§4).<br>Bảng engineering để sau, chỉ vendor sửa, tách task riêng. |
| D4 | **ĐỔI → giống desktop.** Margin của báo giá = hệ số (structure × bang) **của book công ty**; không có dòng thì = 1. Bỏ `settings.margin` và mặc định 1.48. Công ty muốn margin riêng thì sửa bảng hệ số trong book công ty, đúng như desktop. Margin từng báo giá do người có quyền sửa, có nút Default. |
| D5 | Dump từ desktop chỉ còn là **nguồn khởi tạo một lần** (book tổng đầu tiên). Sau khi bỏ desktop, mọi thay đổi đi qua bản nháp hoặc Excel. Upload zip là tuỳ chọn, ưu tiên thấp. |
| D6 | Theo đề xuất: Publish và Activate tách riêng, có xem trước tác động. |
| D7 | Theo đề xuất: lưu bị từ chối (409) khi book của công ty đổi. |

**Lịch sử: các đề xuất ban đầu, giữ lại để đối chiếu**

| # | Câu hỏi | Đề xuất mặc định | Lý do |
|---|---|---|---|
| D1 | Sửa book trên web thì "book" vẫn bất biến (A4) chứ? | **Giữ A4.** Sửa vào một **bản nháp** trong DB ứng dụng; publish tạo **file book mới** = book cha + các thay đổi, hash mới. Không bao giờ sửa file cũ. | Revision đã lưu trỏ theo hash; sửa tại chỗ sẽ âm thầm làm sai mọi báo giá cũ. Cần ADR A21 "book phái sinh". |
| D2 | Một book chung cho mọi công ty hay mỗi công ty một book? | **Một book chung** (như hiện nay và như desktop "master"). Khác biệt từng công ty đi qua override/settings. | Desktop cũng phát hành một DB cho mọi máy. Per-company book nhân đôi việc bảo trì. |
| D3 | Sửa được những bảng nào? | **Giai đoạn 1: chỉ cột giá/khối lượng** của các bảng giá (21 bảng như desktop) + `setting_price_coeffcient` + `delivery_data`. **Không** sửa bảng engineering (lookup khung, footing, wind). Thêm/xoá dòng để giai đoạn 2. | Bảng engineering do kỹ sư cấp, sai là sai kết cấu, không chỉ sai giá. Sửa giá là 90% nhu cầu. |
| D4 | L1 — margin theo cấu trúc × bang | **Dùng hệ số của book làm mặc định**; `settings.margin` của công ty (nếu đặt) **ghi đè** như hiện nay. Thêm dòng vào `KNOWN-DEVIATIONS` nếu chọn khác. | Đúng thứ tự mà comment và `PRICING-PIPELINE.md` đã mô tả; khớp desktop khi công ty không đặt margin. **Đổi giá mọi báo giá mới** → cần thông báo. |
| D5 | Còn giữ luồng dump từ desktop không? | **Giữ làm đường "nhập toàn bộ"** (khi nhà cung cấp gửi bộ giá mới), thêm upload zip. Sửa lẻ thì đi qua bản nháp. | Hai việc khác nhau: thay cả catalogue và chỉnh vài giá. |
| D6 | Publish có tự kích hoạt không? | **Tách**: Publish (tạo book) và Activate (bật) là hai bước, có trang so sánh tác động ở giữa. | Desktop "Apply All" bật luôn; trên web nhiều công ty dùng chung nên cần một bước xem trước. |
| D7 | Khi book đổi lúc người dùng đang mở báo giá | **Từ chối lưu** (409) với thông báo "Bảng giá vừa được cập nhật — tính lại giá rồi lưu", kèm nút tính lại. | Đóng L3; giống cách cổng hiện tại xử lý override version. |
