# Design — Quote editor parity với desktop (3 bước)

> **Người viết:** agent. **Ngày:** 2026-11-03.
> **Người review:** operator. **Trạng thái:** chờ review trước khi viết implementation plan.
> **Quyết định operator đã chốt:** chọn **hướng A — move toàn bộ qua**, vì sản phẩm này là bản cover;
> bỏ sót tính năng là lỗi không chấp nhận được.

---

## 0. Vấn đề, một đoạn

v2 dựng lại engine BOM/giá và editor 3 bước, nhưng editor **không cover** desktop:
Step 1 thiếu ~20 trường (Delivery copy, 6 vai trò màu, profile/footing, end/side opening,
Nom. Bay Spacing…); Step 2 đặt được 11 loại option trong khi desktop có 15 category, và **không có
lớp rule/propose** mà desktop dùng để quyết định một option có đặt được không; bố cục 3 cột của v2
để cột giữa trống và nhét 2D/3D vào cột 1 của step 2. Người dùng desktop không thể chuyển sang v2
mà không quay lại desktop, tức bản cover thất bại ở đúng màn hình làm ra tiền.

Mục tiêu của spec này: **đưa editor 3 bước đạt parity hành vi với desktop** — không phải parity
pixel của WinForms, mà là parity về dữ liệu nhập được, option đặt được, rule từ chối/đề xuất, và
hệ quả giá/BOM/tài liệu.

---

## 1. Mục tiêu & phi mục tiêu

### Mục tiêu

1. Step 1 có đủ **6 nhóm và toàn bộ trường** như desktop, kể cả copy-from, PIN/SiteCheck, 10 vai trò màu.
2. Step 2 có đủ **15 category**, mỗi category có **parameter grid + Add**, chế độ đặt trên plan,
   rule từ chối/đề xuất, và cascade khi xoá.
3. Step 3 giữ đúng luật desktop: **3 ô sửa được**, phần còn lại read-only, và **Additions** là
   dock riêng có catalogue dòng.
4. Bố cục: **cột 2 giữ 2D/3D xuyên suốt cả 3 bước**; cột 1 là dock của bước; cột 3 là giá.
5. Mọi catalogue (màu, misc option, engineering charge, profile, footing, structure option) đọc từ
   **sách giá**, không hardcode trong UI.
6. Bản ghi cũ vẫn đọc được; revision bất biến không bị ghi lại.

### Phi mục tiêu

- Không dựng lại WinForms: không port dialog in GDI+, Outlook COM, `RawPrint`, `.rdlc`.
- Không port **dead/legacy path**: `STABLE` không có nút Add trên desktop, `OVERHANG` bị
  `is_visible=0`, `QUICK_OPENING` chỉ có trong DB. Chúng được giữ **ở tầng đọc file** nếu cần,
  không xuất hiện trên UI.
- Không đổi mô hình revision bất biến, không đổi cách tính giá đã kiểm chứng; chỉ mở rộng đầu vào.
- Không làm lại control plane license (đã có spec riêng).

---

## 2. Quyết định

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Parity là **hành vi người dùng thấy**, không phải cấu trúc object graph của desktop | `ProposeAdd` của desktop gắn với IoC + DTO riêng; chép nguyên object graph là bê nợ kỹ thuật |
| D2 | Rule engine nằm trong `packages/core`, thuần, chạy trên `PlanGeometry` | Giữ ranh giới vàng: core không DB/HTTP/tenant, test được không cần server |
| D3 | `ShedColors` mở thành **10 vai trò đóng** (closed type), không phải `Record<string,string>` | Một vai trò mới phải là compile error ở consumer, không phải rule im lặng |
| D4 | Catalogue đọc từ **sách giá**; hằng số chỉ là fallback khi book không có dữ liệu | 36 màu, 55 misc, 5 engineering, 21 structure option là dữ liệu, không phải code |
| D5 | Gable infill / Cantilever / Horizontal cladding vẫn là `ShedOption`; Step 1 hiển thị **switch là view trên options list** | Giữ nguyên BOM đã kiểm chứng, không tạo nguồn sự thật thứ hai |
| D6 | `STABLE` giữ type, **bỏ khỏi UI đặt option** | Desktop không cho thêm; parity là không mở tính năng chết |
| D7 | Pin SiteCheck **không bắt lưu quote trước** | Desktop pin trước khi lưu; đây là khác biệt hành vi thật, không phải chi tiết kỹ thuật |
| D8 | Revision cũ được **migrate lúc đọc**, không ghi lại | Revision bất biến; migration là hàm thuần `migrateShedConfig` |

---

## 3. Ma trận parity

### 3.1 Step 1 — 6 nhóm

| Nhóm | Trường | Kiểu | Ghi chú |
|---|---|---|---|
| **1 Quote & client** | Quote No | read-only | hệ thống cấp |
| | Quote Rate | select (%) | bắt buộc; hiện đang ở step 3 |
| | First name / Last name | text | bắt buộc |
| | Email | text | bắt buộc + đúng định dạng |
| | Phone / Mobile / Fax | text | Fax mới |
| | Address | Places | bắt buộc |
| | Suburb / State / Postcode | text | Places điền |
| **2 Site** | Copy from Above | button | copy từ Client |
| | Address + **PIN** | Places + button | PIN mở Building Parameters |
| | Suburb / State / Postcode | text | |
| **3 Delivery** | **Copy from Above** | button | copy từ Site |
| | Address | text | bắt buộc |
| | Delivery Scope | **select** | bắt buộc; danh sách từ sách giá |
| | "I understand" | checkbox | bắt buộc khi đã chọn scope |
| **4 Design** | Structure Type | select | đổi → reset hình học |
| | Importance Level / Wind Region / Terrain Category | select | |
| | Building Class / Ground Snow Load / Design Wind Speed | **read-only** | điền từ SiteCheck |
| | **GET SITECHECK REPORT** | button | enable khi có BuildingId |
| | **End Opening L/R** | switch ×2 | |
| | **Side Opening F/R** | switch ×2 | mở tường → tính lại internal pressure |
| | **Cantilever front/rear** | number ×2 | >1400 mm lỗi với nhà chuẩn |
| | **Gable Infill** | switch | view trên `gable_infill` option |
| | Internal pressure | select | giữ |
| **5 Shed** | Span / Height / Overall Length / No. of Bays / Roof Pitch | number | giữ |
| | **Nom. Bay Spacing** | number | bắt buộc; ràng buộc với Length × Bays |
| | **Adjust Bay Spacing** | button/dialog | |
| | **Wall Profile / Roof Profile** | select | từ sách giá |
| | **Downpipe Type** | select | |
| | **Footing Type / Sub Type** | select ×2 | Sub Type lọc theo Footing Type |
| **6 Colours** | Wall / Roof / Barge-fascia / Downpipe / Gutter / Window / PA Door / Roller Door / Sliding Door / Dividing Wall | 10 swatch grid | **10 vai trò** |
| | **Horizontal Cladding** | switch | chỉ enable khi Wall Profile chứa `Corro` |
| | **Assign Wall Colour for All** | button | copy wall → các vai trò còn lại |

### 3.2 Step 2 — 15 category

| # | Category | Entity | Tham số UI |
|---|---|---|---|
| 1 | Window | `Opening('window')` | Type, Alignment, Distance, Size, Height from FFL, Opening Only |
| 2 | PA Door | `Opening('pa_door')` | Type, Alignment, Distance, Height from FFL, Opening Only |
| 3 | Roller Door | `Opening('roller_door')` | Location, Alignment, Distance, Qty, Series (A/AA/B), Custom W/H, Windlocks, Opening Only |
| 4 | **Track** | `OptionKind 'track'` | Track type (Single / Double / Double in bay), No. of segments, Track width, wall |
| 5 | Outrigger | `OptionKind 'outrigger'` | Wall, Height, Direction |
| 6 | Sliding Door | `Opening('sliding_door')` | Location, Height, No. of segment, Width, Size/Type, Track |
| 7 | Dividing Wall | `OptionKind 'dividing_wall'` | Axis, At, Height |
| 8 | Skylight | `OptionKind 'skylight'` | Type (Corro / TL-5), Colour, Bay, position (snap tấm mái) |
| 9 | Opening | `Opening('opening')` + global Internal Pressures | wall switches |
| 10 | Mezzanine | `OptionKind 'mezzanine'` | Corner, Width, Depth, Level, Floor load |
| 11 | Awning | `OptionKind 'awning'` | Scope, Front/Rear pitch, Span, High/Low side, walls |
| 12 | Carry Beam | `OptionKind 'carry_beam'` | Wall, Bay, Spans (opening on that wall) |
| 13 | **Misc. Options** | `OptionKind 'misc_option'` | Description (55 SKU), Quantity, Unit |
| 14 | **Extra Charges or Notes** | `OptionKind 'extra_charge'` | Description, Value |
| 15 | **Engineering Charges** | `OptionKind 'engineering_charge'` | Description (5 SKU), Quantity |

`STABLE` không có trong danh sách đặt option (D6).

### 3.3 Step 2 — luồng thêm

```text
1. Mở category ở dock (cột 1)
2. Điền parameter grid — nút Add chỉ enable khi đủ field bắt buộc
3. Bấm Add → plan (cột 2) sang chế độ "add" với con trỏ đặt
4. Hover trên plan:
     xanh  = đặt được tại vị trí này
     cam   = có đề xuất (POSSIBLE ACTION)
     không tô = sai vị trí
5. Click:
     hợp lệ            → xác nhận "ADD <tên> @<vị trí> × <qty>"
     không hợp lệ nhưng fix được → menu "POSSIBLE ACTION: GO WITH …"
     không fix được    → không làm gì; message hiện ở khu vực thông báo
6. Chuột phải → menu liệt kê toàn bộ đề xuất hiện có
7. Escape / chuột phải / Reset → thoát chế độ add
```

### 3.4 Rule phải port

| # | Rule | Kết quả |
|---|---|---|
| R1 | Cách mép tường < 100 mm | từ chối "out of wall" |
| R2 | Chồng lấn cùng loại | từ chối "`<Option>` already exists" |
| R3 | Đặt lên cột infill (tường đầu hồi) | từ chối trừ khi span ≤ 4000 mm |
| R4 | Cửa sổ bị chiếm chỗ, được phép override | đề xuất dịch 185 mm, hoặc xoá nếu không đủ chỗ |
| R5 | Cửa mới trên tường đầu hồi | đề xuất infill ±250 mm; dọn cột gần 750/450 mm |
| R6 | Track / sliding door / carry beam xung đột | từ chối kèm lý do |
| R7 | Carry beam trên tường > 15 000 mm | từ chối (nhà chuẩn) |
| R8 | Cửa cao hơn sàn mezzanine | đề xuất hoặc từ chối "blocked by mezzanine" |
| R9 | Category cần "2 tường bên trống" | từ chối khi không đủ |
| R10 | Roller door qty ngoài 1–9; custom nhỏ hơn 2000 × 1000 | đề xuất giá trị hợp lệ |
| R11 | Track extend ngoài 1000–6000 mm | đề xuất tăng/giảm số segment |
| R12 | Skylight ngoài mái hoặc chồng nhau | từ chối; snap theo tấm mái |

### 3.5 Cascade khi xoá

| Hành động | Hệ quả |
|---|---|
| Xoá carry beam | khôi phục cột infill; xoá option đi kèm |
| Xoá sliding door | giải phóng track |
| Xoá track khi còn sliding door tham chiếu | **từ chối** |
| Xoá roller door | hỏi có xoá carry beam liên kết không |
| Remove All của một category | xác nhận rồi xoá cả loại |
| Remove All toàn bộ | xác nhận rồi xoá tất cả |

### 3.6 Wipe options

Đổi `span`, `height`, `roofPitchDeg`, hoặc `bays` khi đã có option → dialog xác nhận.
Đồng ý → xoá toàn bộ options (một history entry); Huỷ → không áp dụng thay đổi kích thước.

### 3.7 Step 3 / Additions

- Dock **Additions** riêng, catalogue dòng: concreter, electrician, labourer, council fee,
  engineering, rubbish removal, delivery fee, concrete footing, demolition, equipment hire,
  distributor misc. Mỗi dòng: label, quantity, unit, unit price.
  Danh sách label là **preset cố định trong `packages/core`** (không có trong sách giá); giá trị
  lưu theo quote dưới dạng `charges`. Người dùng được thêm dòng ngoài preset.
- Cost panel giữ đúng 3 ô sửa được: Contract Price, Deposit, Progress. Balance = remainder.
- Hiển thị theo quyền: Building Cost / BOM Cost / Margin / Additions / Quote Rate chỉ cho
  capability `cost:margin` (mới). `cost:read` chỉ thấy giá bán và các stage.

---

## 4. Kiến trúc

### 4.1 Nơi đặt code

| Thành phần | Package | Ghi chú |
|---|---|---|
| Kiểu dữ liệu, normalise, migrate | `packages/core/src/domain/types.ts`, `schema.ts` | thuần |
| Rule đặt option / đề xuất / cascade | `packages/core/src/domain/placementRules.ts` (mới) | thuần, chạy trên `PlanGeometry` |
| Catalogue màu / misc / engineering / profile / footing | `packages/core/src/lib/pricing/catalogues.ts` (mới) | đọc qua `PriceLookup` |
| BOM dòng misc/engineering/extra | `packages/core/src/lib/bom/` | mở rộng |
| DTO + zod | `packages/contracts/src/quote.ts` | một nguồn |
| API | `apps/api/src/routes/quotes.ts`, `siteChecks.ts`, `prices.ts` | |
| UI | `apps/client/src/components/editor/*` | |

### 4.2 Luồng dữ liệu

```text
ShedConfig (core) ──► buildPlanGeometry ──► PlanGeometry
       │                                      │
       │                                      ├─► Render2D / Render3D
       │                                      └─► placementRules (add/propose/cascade)
       │
       └─► evaluateQuote ──► PriceView ──► CostPanel / PDF / BOM
                                  ▲
PriceLookup (sách giá) ───────────┘
   ├─ system_colour (36)
   ├─ misc_option (55 misc + 5 engineering)
   ├─ system_structure_option (21)
   └─ profile / footing / delivery scope
```

Catalogue nhận một interface `CatalogueSource` (thuần, test bằng fixture). Adapter SQLite đặt cạnh
`createLookup(db: DatabaseSync)` trong `packages/core/src/lib/pricing/` — đúng pattern hiện có của
`catalogue.ts` (`sourceCounts(db)`, `bookRowKeys(db)`) — vì sách giá thuộc tầng pricing, không phải
`@sq/db`.

---

## 5. Thay đổi dữ liệu

### 5.1 `ShedConfig` — trường mới

```ts
interface ShedConfig {
  // ... hiện có
  wallProfile: string;          // 'Corro' | 'Trimdek' | 'Klip-Lok' | ...
  roofProfile: string;
  downpipeType: string;
  footingType: string;
  footingSubType: string;
  nomBaySpacing: number;         // mm
  endOpening: { left: boolean; right: boolean };
  sideOpening: { front: boolean; back: boolean };
  buildingClass: string | null;  // read-only, từ SiteCheck
  snowLoad: number | null;       // kPa
  designWindSpeed: number | null;// m/s
}
```

**Gable infill, Cantilever, Horizontal Cladding không nằm trong `ShedConfig`.** Theo D5, chúng vẫn
là `ShedOption`; switch ở Step 1 là **view** trên danh sách option: bật → tạo option với tham số mặc
định (hoặc tham số đang có), tắt → xoá option đó. Một nguồn sự thật duy nhất, BOM không đổi.

**Thứ tự tính `nomBaySpacing` (desktop, để không có hai nguồn):**

| Người dùng sửa | Hệ thống tính |
|---|---|
| `length` | `bays = clamp(ceil(length / maxBay), 2, 30)`; `nomBaySpacing = floor(length / bays)`; bay cuối nhận phần dư |
| `bays` hoặc `nomBaySpacing` | `length = nomBaySpacing × bays` |
| bất kỳ | nếu `nomBaySpacing × bays ≠ length` → lỗi "Total bay length is not equal to overall length." |

### 5.2 `ShedColors` — 10 vai trò

```ts
interface ShedColors {
  wall: string;
  roof: string;
  barge: string;        // Barge and fascia
  downpipe: string;
  gutter: string;
  window: string;
  paDoor: string;
  rollerDoor: string;
  slidingDoor: string;
  dividingWall: string;
}
```

Bỏ `trim` và `door`. Migration phải **giữ nguyên ngoại hình báo giá cũ**, nên đọc theo cách BOM cũ
thật sự dùng màu: `trim` cũ được `gutter.ts` dùng cho cả gutter và downpipe, và `door` cũ được
`openings.ts` dùng cho mọi cửa. Vì vậy:

- `trim → barge`, `gutter`, `downpipe`
- `door → window`, `paDoor`, `rollerDoor`, `slidingDoor`
- `dividingWall` → default (desktop chưa từng có màu riêng trong dữ liệu cũ)

Consumer đổi theo vai trò thật:
- `lib/bom/openings.ts`: cửa sổ dùng `window`, PA dùng `paDoor`, roller dùng `rollerDoor`,
  sliding dùng `slidingDoor`.
- `lib/bom/groups/gutter.ts`: dùng `gutter`; downpipe dùng `downpipe`.
- `lib/bom/groups/fixings.ts`: dùng màu của vật liệu nó phục vụ.
- `documents/projection.ts`, `Shed3D.tsx`, `Render2D` đọc đúng vai trò.

### 5.3 `OptionKind` — thêm 4

```ts
type OptionKind =
  | /* 11 hiện có */
  | 'track'
  | 'misc_option'
  | 'extra_charge'
  | 'engineering_charge';
```

Chi tiết:

```ts
interface TrackOption { kind:'track'; wall: WallSide; trackType:'single'|'double'|'double_in_bay';
  segments: number; width: number; slidingDoorId: string|null; }
interface MiscOption { kind:'misc_option'; name: string; quantity: number; unit: string;
  at: { x:number; y:number } | null; }
interface ExtraChargeOption { kind:'extra_charge'; description: string; amountCents: number; }
interface EngineeringChargeOption { kind:'engineering_charge'; name: string; quantity: number; }
```

`misc_option` và `engineering_charge` lấy `name` từ catalogue (55 / 5 SKU). Giá tra theo
`misc_option.option_name` — hàm `lookup` đã có sẵn (`packages/core/src/lib/pricing/lookup.ts:258`).

### 5.4 `STABLE`

Giữ type để đọc file cũ; bỏ khỏi `OPTION_KIND_OPTIONS`, nên không có nút đặt.

---

## 6. Rule engine

### 6.1 API

```ts
type Adjustment =
  | { kind:'shift'; mm:number }
  | { kind:'resize'; width?:number; height?:number }
  | { kind:'remove'; optionId:string };

interface Proposal {
  label: string;          // "GO WITH 185 mm RIGHT"
  option: ShedOption;     // option sau khi áp dụng
  adjustments: Adjustment[];
}

type PlacementOutcome =
  | { ok:true; option: ShedOption; adjustments: Adjustment[] }
  | { ok:false; kind:'refused'; reason:string }
  | { ok:false; kind:'proposals'; proposals: Proposal[] };

function placeOption(
  request: { kind: OptionKind; params: OptionParams; at: { x: number; y: number } },
  shed: ShedConfig,
  geometry: PlanGeometry,
): PlacementOutcome;
```

`OptionParams` là union theo `kind`, cùng định nghĩa với parameter grid (zod schema dùng chung ở
`packages/contracts`). Hàm **thuần**: không sửa `shed`, trả về option mới hoặc lý do. Caller quyết
định ghi vào store.

### 6.2 Thứ tự kiểm tra

1. Category có được phép trên structure này không (ví dụ carry beam trên nhà đặc biệt).
2. Field bắt buộc của parameter grid.
3. Vị trí: trong tường, cách mép ≥ 100 mm.
4. Chồng lấn.
5. Cột infill / structural column.
6. Xung đột chéo (track ↔ sliding ↔ carry beam; mezzanine ↔ opening height).
7. Đề xuất sửa (shift/resize/segment) nếu có.
8. Từ chối.

### 6.3 Cascade

```ts
function removeOptionWithCascade(id: string, shed: ShedConfig):
  | { ok:true; shed: ShedConfig; removed: string[]; question?: string }
  | { ok:false; reason: string };
```

`question` dùng cho trường hợp cần hỏi (xoá roller door → xoá carry beam liên kết).

---

## 7. UI

### 7.1 Bố cục

```text
≥ 1280 px
┌─────────────────────────────────────────────────────────────────────┐
│ StepRail: Quote details · Options · Cost                            │
├───────────────┬─────────────────────────────────┬───────────────────┤
│ cột 1 (380)   │ cột 2 (1fr)  — 2D/3D luôn có   │ cột 3 (300)  giá  │
│ dock của bước │ Plan / 3D toggle, zoom, legend  │ PricePanel        │
└───────────────┴─────────────────────────────────┴───────────────────┘

1024–1279 px: 2 cột; plan nằm dưới dock, cao 40vh
< 1024 px: 1 cột; plan mở dạng sheet toàn màn hình, có nút "Show the plan"
```

- Cột 2 **không** đổi theo bước. Step 1: plan read-only (cập nhật khi sửa kích thước);
  Step 2: plan tương tác (đặt/kéo/chọn); Step 3: plan read-only.
- Cột 1 đổi nội dung theo bước: Step 1 = 6 group; Step 2 = category dock; Step 3 = Cost + Additions.
- 3D là chế độ trong cột 2, không phải modal (desktop dùng modal; web giữ cột để không mất ngữ cảnh).

### 7.2 Step 2 — category dock

- 15 accordion, thứ tự theo `system_structure_option.display_priority` **sau khi lọc
  `is_active = 1` và chỉ lấy 15 category của dock** (bỏ các dòng flag cấu hình); fallback: thứ tự §3.2.
- Mỗi accordion: parameter grid + nút **Add** (disabled khi thiếu field, có lý do cạnh nút).
- Hai nút đầu dock: **Remove All** (toàn bộ) và **Next**.
- Category bị disable theo structure/profile (ví dụ Track khi tường đã có cửa) → hiện lý do, không ẩn.

### 7.3 Add mode trên plan

- Con trỏ đổi; overlay tô màu theo `PlacementOutcome`.
- Click hợp lệ → popover xác nhận.
- Click có đề xuất → menu `POSSIBLE ACTION: GO WITH …`, nhiều đề xuất nối bằng `OR`.
- Chuột phải → menu toàn bộ đề xuất hiện có.
- Escape/Reset → thoát.
- Danh sách option bên dưới vẫn là bản accessible: mọi thao tác đặt/xoá làm được bằng bàn phím.

### 7.4 Step 1 — PIN flow

```text
PIN (ở nhóm Site)
  └─ thiếu First/Last/Email/Customer Address/Site Address → MessageBox nhắc field
  └─ đủ → flyout Building Parameters
        (Importance Level, Span, Height, Overall Length, Roof Pitch, Avg. Height)
        └─ GO TO SITECHECK → POST /site-checks/pin (không cần quoteId) → mở SiteLink
        └─ GET SITECHECK REPORT → GET /site-checks/:id → điền 6 field read-only
```

Khi lưu quote lần đầu, `siteCheckId` được gắn vào revision.

---

## 8. API & contracts

### 8.1 Endpoint mới/đổi

| Endpoint | Đổi |
|---|---|
| `POST /site-checks/pin` | nhận draft payload (site, client, dimensions), trả `{id, siteLink, reference}`; không cần quote |
| `GET /site-checks/:id` | trả 6 giá trị + status |
| `POST /quotes/:id/site-check/link` | gắn `siteCheckId` đã pin vào quote |
| `GET /price-books/:id/catalogues` | trả màu, misc option, engineering charge, structure option, profile, footing, delivery scope |
| `POST /evaluations` | nhận `ShedConfig` mới (thêm trường + option kind) |
| `POST /quotes` | lưu config mới; từ chối nếu zod không khớp |

### 8.2 Contracts

- `ShedConfigSchema` cập nhật đủ trường §5.1.
- `ShedColorsSchema` 10 khoá bắt buộc.
- `OptionSchema` discriminated union thêm 4 kind.
- `CAPABILITIES` thêm `cost:margin`; `COMPANY_POLICY.company_admin` có nó, `estimator`/`viewer` không.
- Message lỗi theo từng field, giữ văn phong "nói cái gì sai và làm gì".

---

## 9. Giá, BOM, tài liệu

- **Misc option**: mỗi dòng là một BOM line + giá từ `misc_option`; hiện trong cost derivation.
- **Engineering charge**: như trên, 5 SKU.
- **Extra charge/note**: vào `Total Price` như desktop; không phải vật tư.
- **Additions**: vào `Contract Price` sau `Quote Rate`, đúng công thức desktop:
  `Contract = Total Price × (1 + QuoteRate%) + Additions`.
- **Màu**: BOM gutter/downpipe/fixings dùng đúng vai trò; PDF/3D dùng đúng vai trò.
- **PDF**: thêm dòng misc/engineering/extra nếu desktop có; không đổi template khác.
- **Capability**: thêm `cost:margin` vào `COMPANY_POLICY.company_admin`; `estimator` và `viewer`
  không có. `cost:read` giữ nguyên và không bao gồm margin/building cost.

---

## 10. Tương thích & migration

- `migrateShedConfig(unknown): ShedConfig` — hàm thuần, chạy khi đọc revision cũ:
  - thiếu trường mới → default an toàn (`wallProfile` từ book default, `nomBaySpacing = length / bays`, …);
  - `colors.trim → barge`, `gutter`, `downpipe`; `colors.door → window`, `paDoor`, `rollerDoor`,
    `slidingDoor` (giữ ngoại hình báo giá cũ);
  - `STABLE` option giữ nguyên trong dữ liệu, không hiện UI.
- Không ghi lại revision. Revision mới dùng schema mới.
- API trả config **đã migrate** để client không phải biết hai schema.

---

## 11. Kiểm thử

| Lớp | Nội dung |
|---|---|
| Unit — domain | `migrateShedConfig` (4-role → 10-role); normalise trường mới; `nomBaySpacing` round-trip |
| Unit — rule | Mỗi R1–R12 một test với fixture; mỗi cascade một test; `placeOption` thuần (không mutate) |
| Unit — catalogue | 36 màu, 55 misc, 5 engineering, 21 structure option đọc đúng từ fixture book |
| Unit — BOM/giá | misc/engineering/extra vào đúng tổng; màu vào đúng nhóm |
| Contract | zod từ chối config thiếu trường; chấp nhận config cũ sau migrate |
| E2E | Đặt đủ 15 category; add mode xanh/cam/blocked; cascade; wipe options; PIN không cần lưu |
| Golden | 5 báo giá desktop: Contract Price khớp; lệch có chủ đích ghi `KNOWN-DEVIATIONS.md` |

---

## 12. Thứ tự triển khai (8 slice)

| Slice | Nội dung | Phụ thuộc |
|---|---|---|
| 1 | Domain types + `ShedColors` 10 vai trò + `migrateShedConfig` + normalise | — |
| 2 | Catalogue layer (`catalogues.ts`, `CatalogueSource`) + endpoint `/catalogues` | 1 |
| 3 | `OptionKind` mới (track/misc/extra/engineering) + BOM/giá | 1, 2 |
| 4 | `placementRules.ts`: R1–R12 + cascade + wipe | 1, 3 |
| 5 | Layout 3 cột, 2D/3D xuyên bước | — (song song được) |
| 6 | Step 1 UI đủ 6 nhóm + PIN flow (API stateless) | 1, 2, 5 |
| 7 | Step 2 UI: 15 category + add mode + proposals + Remove All | 3, 4, 5 |
| 8 | Step 3 + Additions + `cost:margin` + PDF/BOM parity + golden test | 3, 6, 7 |

Mỗi slice có test riêng và phải xanh trước khi sang slice sau. Slice 5 có thể làm song song với 1–4.
Vì phạm vi lớn, **mỗi slice sẽ có implementation plan riêng**; plan đầu tiên chỉ phủ slice 1–2.

---

## 13. Rủi ro

| # | Rủi ro | Xử lý |
|---|---|---|
| P1 | Rule engine lệch desktop vì thiếu plan model | Dựng rule trên `PlanGeometry` hiện có; mỗi rule có fixture lấy từ hành vi desktop; golden test 5 quote |
| P2 | 10 vai trò màu làm lệch BOM/PDF/3D | Làm ở slice 1, sửa consumer ngay, test từng nhóm BOM |
| P3 | Catalogue misc 55 SKU là dữ liệu có bản quyền | Không commit; demo dùng mock book; tuân `mock-everything-identifying` |
| P4 | Revision bất biến + schema mới | Migrate lúc đọc; không ghi lại; test revision cũ mở được |
| P5 | Khối lượng lớn (parity đầy đủ) | 8 slice, mỗi slice bàn giao được; không gộp |
| P6 | Add mode trên canvas khó accessible | Danh sách option là bản accessible đầy đủ; canvas chỉ là tiện ích |

---

## 14. Câu hỏi đã đóng

- Hướng: **A — full parity** (operator, 2026-11-03).
- Add model: **port propose engine** cho toàn bộ 15 category (theo A).
- 10 màu + 55 SKU: **làm trong đợt này** (theo A).
- `STABLE`: **giữ type, bỏ UI** (D6).
- `OVERHANG` / `QUICK_OPENING`: không mở UI; chỉ đọc file cũ nếu gặp.

---

*Hết spec. Chờ operator review trước khi viết implementation plan.*
