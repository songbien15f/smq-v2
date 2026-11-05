# SmartQuote v2 — Quote editor reference

> Tài liệu tham khảo cuối: logic, công thức, rule, nguồn dữ liệu và các quyết định của
> editor 3 bước. Ghi song song với quá trình port từ desktop.
> Cập nhật lần cuối: 2026-11-05.

---

## 1. Mục đích và phạm vi

Tái tạo editor báo giá của desktop SmartQuote (WinForms) trên web, đủ để một nhân viên
sales không phải quay lại desktop. Phạm vi: **Step 1 Quote details · Step 2 Options ·
Step 3 Cost**, cùng BOM, giá, tài liệu khách.

Không port: dialog in GDI+/RawPrint, Outlook COM, `.rdlc`, control plane license (đã có
spec riêng), và các tính năng chết (`STABLE` không có UI trên desktop, `OVERHANG` bị
`is_visible=0`, `QUICK_OPENING` chỉ có trong DB).

---

## 2. Nơi đặt code

| Việc | File |
|---|---|
| Kiểu dữ liệu, normalise, migrate | `packages/core/src/domain/{types,schema,colors,options,placementRules,optionRules}.ts` |
| Hình học plan | `packages/core/src/domain/{plan,placement,bays,walls}.ts` |
| BOM | `packages/core/src/lib/bom/**` (mỗi nhóm một file trong `groups/`) |
| Giá | `packages/core/src/lib/pricing/{price,lookup,rowKeys,catalogues}.ts` |
| Catalogue từ sách giá | `packages/core/src/lib/pricing/catalogues.ts` |
| Tài liệu khách | `packages/core/src/lib/documents/{projection,html}.ts` |
| API | `apps/api/src/routes/{quotes,evaluations,shedsafe,catalogues}.ts` |
| UI editor | `apps/client/src/components/editor/*` |
| Store hình học | `apps/client/src/store/useShedStore.ts` |
| Store draft | `apps/client/src/store/useDraftStore.ts` |

Ranh giới: `packages/core` không import HTTP/tenant. Sách giá là ngoại lệ có kiểm soát —
`lib/pricing/*` đọc SQLite trực tiếp, đúng pattern `createLookup(db)`.

---

## 3. Mô hình dữ liệu

### 3.1 `ShedConfig`

```
structureType, span, length, height, roofPitchDeg, bays, nomBaySpacing
openings: Opening[]
options:  ShedOption[]
charges:  Charge[]
internalPressure: 'closed' | 'open'
windRegion A|B|C|D · terrainCategory 2|2.5|3 · shieldingFactor · importanceLevel 1|2
topographyFactor · stateCode ACT|NSW|NT|QLD|SA|TAS|VIC|WA
wallProfile · roofProfile · downpipeType · footingType · footingSubType
endOpening {left,right} · sideOpening {front,back}
buildingClass · snowLoad · designWindSpeed        (read-only, từ ShedSafe)
colors: ShedColors (10 vai trò) · displayUnit
```

**Ba trường bay** (`length`, `bays`, `nomBaySpacing`) được hoà giải bằng
`reconcileBays`: spacing > 0 thì `length = spacing × bays`; ngược lại
`spacing = floor(length / bays)`. `baySpacingMismatch` báo lệch, không tự làm tròn.

### 3.2 `ShedColors` — 10 vai trò

`wall · roof · barge · downpipe · gutter · window · paDoor · rollerDoor · slidingDoor ·
dividingWall`

Migration từ bản ghi cũ (4 vai trò) — **giữ nguyên ngoại hình báo giá cũ**:

| Cũ | Mới |
|---|---|
| `trim` | `barge`, `gutter`, `downpipe` (BOM cũ dùng trim cho cả gutter lẫn flashing) |
| `door` | `window`, `paDoor`, `rollerDoor`, `slidingDoor` |
| `wall`, `roof` | giữ nguyên |
| — | `dividingWall` lấy default |

`migrateColors` idempotent: vai trò mới có sẵn thì thắng fallback cũ.

### 3.3 `OptionKind` — 12 loại

Hình học: `skylight · mezzanine · awning · outrigger · dividing_wall · gable_infill ·
stable · carry_beam · horizontal_cladding · overhang · cantilever`

Không hình học: **`misc_option`** `{ name, quantity, unit }` — dòng catalogue, không vẽ.

`hasPlanGeometry(kind)` là nguồn duy nhất quyết định một option có lên plan/3D hay không.
`resolveOptions` lọc theo nó; plan, 3D, drag và `optionsThatNoLongerFit` đều theo.

### 3.4 `Opening`

`type (roller_door|pa_door|sliding_door|window|opening) · width · height · sill · wall ·
align (center|left|right|custom) · offset · swing · track (none|single|double)`

`track` chỉ có nghĩa với `sliding_door`; normalise xoá ở các loại khác.

---

## 4. Chuỗi giá

`packages/core/src/lib/pricing/price.ts`:

```
kit      = totalCost × margin × (1 + GST)
total    = kit + delivery + engineering + extra
contract = total × (1 + quoteRate%) + additions
gst      = contract − round(contract / (1 + GST))     ← trích ra, không cộng thêm
deposit  = contract × depositPct%
progress = contract × progressPct%                     (hoặc phần còn lại nếu 2 % cộng = 100)
balance  = contract − deposit − progress               ← luôn là phần dư
```

- **GST = 10%, hardcode** (luật, không phải cấu hình).
- **Contract GST-inclusive**: khách đọc con số là số phải trả.
- **Delivery / engineering / extra là GST-inclusive**, cộng thẳng (đã kiểm với `mock-test.sqd`:
  24.42 + 275 + 110 = 409.42).
- **Ba ô sửa được**: Contract, Deposit, Progress. Balance không bao giờ gõ.
- `margin` lấy theo `structureId + stateCode`, hoặc margin riêng của công ty (Settings).

---

## 5. BOM

`totalCost = buildingCost + miscCost`. `buildingCost` = 11 nhóm vật tư; `misc` gồm phí
ShedSafe và các `misc_option` của người dùng.

| Nhóm | Nguồn giá |
|---|---|
| frame, purlin | `cost_frame`, `cost_purlin`, span table `devided` |
| sheeting | `view_cost_sheeting` / `material_sheeting` |
| gutter, downpipe | `gutter`, `downpipe` (màu: `gutter`, `downpipe`) |
| flashing | `flashing` (màu: `barge`) |
| bracket, bracing, bolt, screw | `cost_bracket`, `cost_bracing`, `cost_bolt`, `screws` |
| option | tuỳ option: cửa, mezzanine, awning, carry beam… |
| misc | `misc_option` theo `option_name` |

Dòng `misc_option` không có tên trong book → **không tạo dòng**, phát issue
`MISC_OPTION_UNKNOWN`.

---

## 6. Rule đặt option

`packages/core/src/domain/placementRules.ts` + `optionRules.ts`.

### Đã có

| Rule | Hành vi |
|---|---|
| R1 | Cửa cách mỗi đầu tường ≥ **100 mm**; vi phạm → đề xuất vị trí hợp lệ |
| R2 | Không chồng lấn cửa khác trên cùng tường → đề xuất trái/phải vật cản |
| R4 | Đề xuất dạng `GO WITH <n> mm from the left corner` |
| R7 | Carry beam bị từ chối khi khẩu độ > **15 000 mm** |
| R10 | Roller door tối thiểu **1000 × 2000 mm**; dưới → đề xuất size |
| Cascade | Xoá cửa → gỡ `carry_beam.openingId`; xoá option; `wipeOptions` |
| Wipe | Đổi span/height/pitch/bays khi có option → hỏi xác nhận, đồng ý thì xoá hết option |

`placeOpening` trả ba dạng: hợp lệ, từ chối (một câu), hoặc đề xuất. Store áp dụng đề xuất
đầu tiên và ghi notice `GO WITH … — applied.`

### Chưa có — vì model chưa có (không đoán)

| Rule | Thiếu gì |
|---|---|
| R3/R5 | Cột infill và dọn cột 750/450 — v2 không có model cột |
| R9 | "2 tường bên trống" — chính docs desktop nói wording mơ hồ |
| R11 | Track dài 1000–6000 — track là thuộc tính cửa, không phải chiều dài |
| R12 | Snap theo tấm mái — không có lưới tấm |

---

## 7. Catalogue từ sách giá

`GET /api/v1/price-books/:id/catalogues` (`:id` = hash 64 hex hoặc `active`).
503 khi chưa publish book; 409 khi book không có trên đĩa; 404 khi id không hợp lệ.
Quyền: `quote:read`.

| Catalogue | Bảng | Cột / lọc |
|---|---|---|
| colours | `system_colour` | `colour_status=1`, kèm `option_spec_array` → roles |
| miscOptions | `misc_option` | `type='MicsellaneousOptions'`, 55 dòng |
| engineeringCharges | `misc_option` | `type='EngineeringCharges'`, 5 dòng |
| structureOptions | `system_structure_option` | `CAST(is_active AS REAL)=1`, theo `display_priority` |
| windRegions / terrain / importance | `design_*` | `is_active=1` |
| profiles | `material_sheeting` | gộp theo `profile`, `bmtValues[]`, `is_wall/is_roof` |
| footingTypes / footingSubTypes | `shed_footing_type`, `shed_footing_sub_type` | `is_active=1` |
| deliveryScopes | `delivery_data` | `status=1`, parse `"ACT : 250; …"` |
| span/height/pitch/bay hints | `shed_hint_*` | `hint_value` |

**Bảng thiếu → `[]`; cột thiếu → ném lỗi.** Một dump cũ thiếu bảng là chuyện bình thường;
thiếu cột là không tương thích và phải nhìn thấy, không được giả làm danh sách rỗng.

---

## 8. Additions (chi phí bổ sung)

Desktop: `PriceController.Calculation.cs:90` `CalculateAdditionsPrice`.

Chỉ tính khi `InstallationInfo.HasAdditionSupply`. Kết quả vào công thức
`ContractPrice = TotalPrice × (1 + QuoteRate%) + Additions` (`PriceController.cs:257`).

| Nhóm | Cách tính | GST |
|---|---|---|
| Concreter / Electrician / Labourer 1 / Labourer 2 | `hours × rate` | **× (1+GST)** |
| Equipment hire | `quantity × unitPrice` | × (1+GST) |
| Distributor misc | `quantity × unitPrice` hoặc `TotalDistributor` | × (1+GST) |
| Accommodation | số tiền | cộng thẳng |
| Council fee, Engineering, Rubbish, Delivery fee | số tiền | cộng thẳng |
| Concrete footings | `quantity × price` | cộng thẳng |
| Demolition | theo bảng `DemolitionSiteFees` hoặc số tiền | cộng thẳng |

Mỗi dòng có cờ `Has*`. Ô `RealAdditionItem` trong Cost panel cho phép **ghi đè** tổng
(`CostView.Items.cs:214`).

**Quyết định của v2:** Additions dùng đúng bucket `pricing.additionsCents` hiện có (không
tạo bucket thứ tư). Các dòng được itemise và cộng ra tổng; gõ tay vào tổng là override,
đúng như desktop.

**Đã hiện thực:**

- `packages/core/src/domain/additions.ts` — `AdditionLine`, `DEFAULT_ADDITION_LINES`
  (13 dòng, 6 taxable), `additionsTotalCents(lines)` làm tròn **một lần mỗi dòng** sau
  khi nhân GST.
- `pricingInput.additionLines` là **optional** trong contracts — revision cũ vẫn parse;
  revision mới lưu cả bảng dòng trong pricing JSON.
- Cost panel: bảng 13 dòng (checkbox / quantity / đơn giá), tổng tính lại mỗi lần sửa, và
  ô **Override total** ghi đè tổng mà không đụng các dòng.

---

## 9. Phân quyền

`packages/contracts/src/roles.ts` là nguồn duy nhất; server kiểm tại thao tác, UI chỉ ẩn.

| Vai trò | Capabilities |
|---|---|
| `company_admin` | quote read/write/send, cost:read, **cost:margin**, price:manage, members, settings, usage |
| `estimator` | quote read/write/send, cost:read, price:manage |
| `viewer` | quote:read |

`cost:margin` = phần nội bộ (Materials/BOM cost/Margin/Kit/Quote rate/Additions). Desktop
chỉ cho SuperAdmin thấy.

**Đã enforce ở server:** response `/evaluate` bỏ `buildingCostCents`, `totalCostCents`,
`margin`, `kitCents` và trả `lines: []` khi caller thiếu `cost:margin`; revision vẫn lưu
đầy đủ để audit. Test: `pricing.test.ts` → "hides the internal cost breakdown from an
estimator".

---

## 10. Golden test

Nguồn thật nằm trong repo desktop (không commit sang v2 — dữ liệu khách):

```
App/SmartQuote.Build/Workspace/@@/VGS@@-00001..00010.sqd
App/SmartQuote.Build/Workspace/D5/VGSD5-00001..00002.sqd
smq-package-smartquote/data/SSA$$-00007, -00025, SSA@@-00001.sqd
App/SmartQuote/mock-test.sqd   ← đang dùng làm mốc giá trong price.ts
```

Reader v2 đã mở được file thật (`readQuoteFile` → JSON, ví dụ `VGS@@-00001.sqd`,
`ContractPrice 305.41`).

**Harness:** `tools/golden/check-price-chain.mjs [desktopRepoRoot]`.

- Đọc 12 file `.sqd` **tại chỗ** (không copy, không commit).
- Mỗi revision kiểm 3 điều:
  1. `KitOnly + Delivery + Engineer + Extra == TotalPrice`
  2. `contractFromTotal(TotalPrice, QuoteRateValue, AdditionsCost) == ContractPrice`
  3. `Deposit + Progress + Balance == ContractPrice` (không lệch một cent)
- Dùng chính `contractFromTotal` của production, nên test kiểm code thật, không phải
  bản sao công thức.

**Kết quả 2026-11-05: 19 revision / 12 file, 0 fail.**

Giới hạn: harness chỉ chứng minh **chuỗi giá**, không chứng minh số lượng BOM — muốn thế
phải convert `HousePlan` của desktop sang `ShedConfig` (tường, cột infill, anchor option),
là việc riêng. Ba file trong `smq-package-smartquote/data` là định dạng
`.NET BinaryFormatter` cũ: reader nhận diện được nhưng không giải mã, nên được báo là
"không tính" chứ không lặng lẽ bỏ qua.

---

## 11. Quyết định và lệch có chủ đích

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Parity là hành vi người dùng thấy, không phải object graph desktop | `ProposeAdd` gắn IoC/DTO riêng |
| D2 | Rule engine thuần trong `packages/core` | Test không cần server |
| D3 | `ShedColors` là closed type 10 vai trò | Thêm vai trò = compile error ở consumer |
| D4 | Catalogue đọc từ sách giá | Danh sách là dữ liệu, không phải code |
| D5 | Gable infill / Cantilever / Cladding vẫn là `ShedOption`, switch Step 1 là view | Một nguồn sự thật, BOM không đổi |
| D6 | `STABLE` giữ type, bỏ UI | Desktop không cho thêm |
| D7 | Pin SiteCheck không bắt lưu quote trước | Desktop pin trước khi lưu — **chưa làm ở v2** |
| D8 | Revision cũ migrate lúc đọc, không ghi lại | Revision bất biến |
| D9 | `track` không phải OptionKind riêng | Cửa trượt đã sở hữu track |
| D10 | `extra_charge` / `engineering_charge` không phải OptionKind | Đã có `extraCents` / `engineeringCents`, thêm sẽ double-count |
| D11 | Additions dùng `additionsCents` | Đúng công thức desktop |
| D12 | Downpipe type tạm free-text | Bảng `downpipe` trong book là bộ phận (PVC/STEEL), không phải danh mục kiểu |
| D13 | Fax đã thêm | Lưu trong `customer_json`, không cần cột DB |

---

## 12. Việc còn lại

1. **Add-mode overlay** xanh/cam trên canvas (hiện Add tự áp dụng đề xuất + notice).

Đã xong: golden harness (§10), lọc margin ở server (§9), Fax (§11 D13), và **6d pin trước
khi lưu**:

- `POST /site-checks/pin` — pin khi chưa có quote, lưu theo `tenant_id`.
- `POST /site-checks/:checkId/import` — import rating cho check chưa gắn quote.
- `POST /quotes` nhận `siteCheckId`; server kiểm tra check thuộc đúng công ty rồi gắn
  `quotes.site_check_id` (check của công ty khác bị bỏ qua, không làm mất lần lưu).
- Client: `SiteCheckPanel` pin/import được khi chưa lưu; id giữ trong draft store và gửi
  kèm lần lưu đầu. Test: *"links a site check that was pinned before the quote was saved"*.

---

## 13. `.vqu` — định dạng cho BOM tool ngoài

Nguồn: `smq-code-smartquote/Modules/Main/SmartQuote.Module.Main/Data/ExportFileVQU.cs`.

File text, encoding **ISO-8859-1**, cấu trúc INI, ghi theo thứ tự:

```
[QUOTE DETAILS]
QuoteNumber, PostCode, SiteStreet, SiteState, SiteSuburb, SitePostCode, Name

[SHED DETAILS]
TypeOfStructure, WindRegion, TerrainCategory, BaseType, BaySize, NumofBays,
Footings, WallSheet, RoofSheet, DownpipeStyle, WidthSpan, Height, RoofPitch,
WallColour, DoorColour, RoofColour, DownpipeColour, TrimColour, GutterColour,
SLDoorColour, WindowColour, DivwallColour, PADoorColour, ForceOpenDesign,
OpenBaySide1, OpenBaySide2, OpenBayEnd1, OpenBayEnd2

[OPTIONS]
SLDoorEndCount_1, SLDoorEndCount_2

NumMiscOptions = <n>  (+ danh sách misc)
```

Ghi chú khi port:

- **Tên màu**, không phải hex: `WallColour` phải là `Shale Grey`. v2 lưu hex, nên phải tra tên qua sách giá (`lookup.colourName`) trước khi ghi.
- **Mã footing** được đổi sang nhãn: `CAST_IN_STRAP → Cast-in Strap`, `CHEMSET → Chemset`, `HD_BOLTS/HD_BOLT → HD Bolts`, `DYNABOLT`, `POST_IN_GROUND`, `RIGID_BRACKET`.
- **OpenBaySide1/2** đúng khi *tất cả* các bay của tường bên đều mở (`count == bays - 1`) — không phải "có ít nhất một bay mở".
- **SLDoorEndCount** = `width / doorWidth` cho cửa trượt ở đầu trái/phải.
- `ForceOpenDesign` = `HousePlan.OpenDesign`, tức `Internal Pressures`.

**Chưa port**: cần một file `.vqu` thật của desktop để đối chiếu từng dòng trước khi viết exporter — một file sai cho BOM tool ngoài còn tệ hơn không có file.

---

## 14. Kiểm thử hiện tại
| Lớp | Số test |
|---|---|
| `@sq/core` | 754+ (domain, BOM, giá, tài liệu, catalogue, placement) |
| `@sq/api` | 162 (auth, quote, evaluate, catalogue route, site-check) |
| `@sq/contracts` | 15 |
| `@sq/client-app` | 8 (form + category dock) |

Chạy toàn bộ: `npx turbo run test`. Typecheck: `pnpm --filter @sq/<pkg> typecheck`.
