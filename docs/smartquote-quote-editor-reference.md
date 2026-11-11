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

### Đặt cửa trực tiếp trên bản vẽ (add mode)

Trước đây chỉ có hai cách thêm cửa: form trong CategoryDock, hoặc menu ngữ cảnh đặt cửa vào
**điểm mở menu** (một cú bấm, không ngắm được). Nay có thêm **add mode**: menu có 5 dòng
`Place <loại> on the plan`, chọn một dòng thì canvas chuyển sang chế độ đặt.

| Thành phần | Vai trò |
|---|---|
| `openingAtPoint(shed, request, point)` | Hàm **thuần** quyết định: tường gần nhất, tâm cửa ở con trỏ, và chạy `placeOpening`. Trả `{ wall, candidate, outcome }` |
| `DoorGhost` (PlanCanvas) | Khung nhấp nháy tại **vị trí sẽ đặt thật**, dấu `+` tại **con trỏ**, câu mô tả |
| Màu ghost | teal = đặt được · amber = luật sẽ dời nó (bấm để chấp nhận) · đỏ = không vừa |
| Banner dưới canvas | Nói đang ở chế độ đặt; nút **Done**; **Escape** cũng thoát |
| `placeAt` (Render2D) | Chỉ lấy `wall` + `offset` từ `openingAtPoint` rồi gọi `store.addOpening` |

**Vì sao ghost hiển thị cả `candidate` và `outcome`:** `candidate` là chỗ con trỏ yêu cầu,
`outcome` là chỗ luật cho phép. Vẽ cả hai là để người dùng thấy khoảng cách giữa hai chỗ đó,
thay vì thấy cửa "tự nhiên nhảy" sang chỗ khác.

**Vì sao `placeAt` không tự xử lý từ chối:** luật (và câu `GO WITH …`) thuộc `store.addOpening`
— cùng đường mà form dùng. Copy luật sang canvas sẽ tạo **bộ luật thứ hai** có thể lệch form.

**Add mode giữ nguyên sau mỗi lần đặt** — thêm hai cửa sổ cùng tường không phải bật lại.
`DoorGhost` nằm trên một `Layer listening={false}`, nên ghost không nuốt cú bấm tiếp theo.

### R3 — cửa đầu hồi đè lên cột infill (ĐÃ CÓ)

`infillOverrideRefusal()` trong `placementRules.ts`. Hai nửa của rule desktop
(`AddingRuleDoor.AllowOverrideInfill` + `OverrideAnyInfillColumn`):

1. **Có đè lên cột không?** Hình chữ nhật của cửa, nới thêm nửa khoảng cách cửa
   (`SpaceBetween2OtherDoor / 2`, mặc định 250 mm), có chứa vị trí cột nào không.
2. **Nhà có hẹp không?** Chỉ cho đè khi `span ≤ 4000 mm`.

**Chỉ theo tường là sai.** Refuse mọi cửa trên đầu hồi rộng sẽ cấm cả những cửa nằm
gọn giữa hai cột — tức trường hợp bình thường. Test `allows a door between two columns`
khoá điều này; đó là test đầu tiên bắt lỗi khi tôi viết rule quá rộng.

Vị trí cột đến từ sách giá nên `placeOpening` **không tự có**: nó nhận qua option
`infillPositionsMm`. `placeOpening` gọi trần thì R3 không áp dụng (không có book);
`buildBomWithEvidence` — nơi có book — truyền vị trí thật và ghi issue
`DOOR_DISPLACES_INFILL_COLUMN` (severity `assumption`) cho từng cửa vi phạm.

### R5 — dời cột infill quanh cửa cuốn (ĐÃ CÓ)

`respaceAroundDoors()` port nhánh thường của `computeInfillPosition` (`BOMQuoteUtil.cs:569-637`).
Ba câu trả lời, quyết định bởi **khoảng tường trống mỗi bên cửa**:

| Trống mỗi bên | Kết quả |
|---|---|
| cả hai ≤ 500 mm | **bỏ** cột — không còn đoạn nào đáng giữ |
| cả hai > 500 mm | **tách thành hai** cột, mỗi cột cách jamb 250 mm |
| một bên > 500 mm | **dời** cột sang bên đó, cách jamb 250 mm |

`500` và `250` là số của desktop. `curtain` là dung sai rèm — **50 mm cho roller style A, 100 mm
cho loại khác** (`RDoor.GetCurtain`) — và một nửa của nó được cộng vào khoảng trống vì rèm cuốn vào
trong hốc. `rdoor_type` trong bảng `roller_door` của sách giá chính là `Style`, và v2 đã có
`Opening.series` — nên **không cần model mới**, chỉ cần tra đúng.

### R3 và R5 loại trừ nhau — và tôi đã làm sai chỗ này

Hai câu trả lời **không thể cùng tồn tại** cho một cửa:

- **nhà ≤ 4000 mm** → xưởng **dời** cột (R5) → quote là *indicative*, kèm issue
  `INFILL_COLUMNS_RESPACED`;
- **nhà > 4000 mm** → xưởng **từ chối** cửa (R3) → issue `DOOR_DISPLACES_INFILL_COLUMN`
  severity **blocker**.

Bản đầu của tôi làm cả hai cùng lúc trên mọi nhà, nên một cửa sinh ra *vừa* blocker *vừa*
assumption — hai câu mâu thuẫn cho cùng một cây nhà. Đã sửa: `buildInfillColumns` chỉ re-space khi
`span ≤ 4000`.

**R3 so với vị trí gốc, không phải vị trí đã dời.** Sau khi `respaceAroundDoors` dời cột ra khỏi cửa,
so cửa với vị trí mới thì luôn không thấy gì. Nên `InfillColumns` mang thêm `designPositionsMm` — vị
trí thiết kế ban đầu — và R3 so với nó.

### Hai bug thật mà test tìm ra

1. **So với cột của cả hai đầu hồi.** Offset của cửa đo theo tường của nó, nên so với cột của đầu
   hồi bên kia báo sai — một cửa 2400 mm ở 3000 mm bị tố là đè lên cột cách đó 12 m.
2. **Cột nội bộ bị coi là cột góc.** Desktop kiểm `index == 0 || index == count-1` trên danh sách
   **có cả hai cột góc**. `infillPositions` chỉ trả cột nội bộ, nên phần tử đầu/cuối của nó là cột
   thường — và phép kiểm theo index miễn trừ chúng khỏi mọi cửa. Một cửa 2400 mm đè lên cột nội bộ
   đầu tiên và cột đó vẫn đứng nguyên trong lòng cửa. Nay kiểm theo **vị trí so với `span`**, không
   theo index.

### R12 — snap skylight theo tấm mái (ĐÃ CÓ)

> **Ghi chú sửa sai, lần thứ hai.** Tôi từng ghi rằng R12 "bị chặn" vì "v2 neo skylight theo
> **bay**, desktop theo **span**". **Sai.** `Roof.Width` của desktop **chính là** `Plan.Length`
> (`Roof.cs:64`), và nó snap bằng `LocSkylight.X / RoofSheetingSize` — trục đó là **chiều dài nhà**,
> đúng trục `alongBay` của v2. Hai trục đã khớp từ đầu; tôi chỉ so với một trục "span" mà desktop
> không dùng cho tấm mái.

`packages/core/src/domain/skylightSnap.ts`:

| Hàm | Việc |
|---|---|
| `roofSheets(shed, coverMm)` | Danh sách tấm theo chiều dài; **tấm cuối mang bề rộng thật** (24 000 / 762 → 32 tấm, tấm cuối 378 mm) |
| `snapSkylightToSheet` | Chọn tấm dưới tâm, trả tâm tấm + `aligned` + lý do từ chối |
| `skylightOnSheet` | Đổi vị trí snap về dạng `bay`/`alongBay` để sống sót qua save/reload |
| `skylightsOverlap` / `skylightCollision` | So **hình chữ nhật**, không so điểm bắt đầu |

**Vì sao skylight thay thế một tấm:** tấm kính **là** một tấm mái — BOM đã trừ một tấm cho mỗi
skylight (`sheetCounts`). Kính nằm nửa tấm này nửa tấm kia cần hai tấm cắt hai bên, xưởng không làm
vậy. Nên snap về tấm, không về milimét tuỳ ý.

**Một bug thật do việc này lộ ra:** skylight mặc định cũ là **900 × 900**, trong khi cover của sách
giá là **762 mm** — nên **mọi** skylight bị từ chối với lý do "cần tấm cắt mỗi bên". Desktop làm
đúng: `Skylight.Width` **chính là** `Plan.RoofSheetingSize` (`Skylight.cs:38`), không có kích thước
riêng. Nay mặc định = một tấm khi biết cover.

**Hai bug nữa trong chính lần này:**

1. **`coverByState` luôn null** vì câu `SELECT profile, bmt, is_wall, is_roof FROM material_sheeting`
   không lấy `description` — mà `sheeting_cover` khoá theo `description`. `row.description` trả
   `undefined` **không báo lỗi**, nên cả tính năng im lặng không làm gì.
2. **Thông báo từ chối nói sai tấm.** Khi bề rộng pane > cover, câu cũ luôn nói "tấm cuối của mái",
   kể cả khi đó là tấm thường — đẩy người dùng đi tìm một "tấm đầy đủ" cùng bề rộng.

Cover đọc từ `sheeting_cover` (**mét** trong sách, `'QLD:0.762;'`) và đổi sang mm; UI lấy cover
theo `stateCode`, chỉ profile `isRoof`. Không có cover thì **không snap** thay vì đoán 762.

### R9 — mezzanine không được cắt qua cửa (ĐÃ CÓ)

> **Ghi chú sửa sai, lần thứ ba.** Tôi ghi R9 là "category cần **2 tường bên trống**" và cho là
> wording mơ hồ. Đọc `AddMezzamineRule` thì nó **không phải** vậy: rule đi qua các option trên hai
> tường mà sàn mezzanine chạm tới và đếm những cái sàn sẽ cắt qua — cửa cuốn cao hơn sàn, cửa sổ có
> dải sill–head chứa sàn, cửa PA đủ cao. Không phải "tường trống", mà là **độ cao** so với sàn.

`optionsUnderMezzanine` trong `optionRules.ts`:

- vị trí mặc định `back_left`, sàn ở 2400 mm, dày 150 mm (`MEZZ_SLAB`);
- hai tường mà góc đó chạm: một tường dài + một đầu hồi;
- một cửa bị coi là vướng khi dải đứng của nó giao dải của sàn — cửa: `sill` đến `sill + height`;
- **> 1 vật cản** → báo tổng số kèm danh sách; **đúng 1** → nêu tên, y như
  `WarningBlockedMezznine(optName)` của desktop.

**Khác desktop một chỗ có chủ ý:** desktop **cảnh báo** rồi vẫn cho đặt; v2 **từ chối**. Sàn cắt
qua cửa là thứ không xây được — ai đó phải dời cửa hoặc dời sàn — và cảnh báo là thứ người ta bấm
qua. Câu từ chối nêu tên thứ vướng, đó là toàn bộ giá trị của phép kiểm.

### R11 — track segment 1000–6000 mm

**Đã có từ trước**, trong `placeOpening` (`placementRules.ts:156`) và có test riêng
(`trackRule.test.ts:45`). Nó đã bị liệt kê sai ở bảng "chưa có" vì một ghi chú cũ nói track là
"thuộc tính cửa, không phải chiều dài" — trong khi `Opening.trackWidth` **chính là** chiều dài
segment, nên rule áp được.

### Bảng R1–R12 — trạng thái cuối

| Rule | Trạng thái | Ở đâu |
|---|---|---|
| R1 lề 100 mm | ✅ | `placeOpening` |
| R2 chồng lấn cửa | ✅ | `placeOpening` |
| R3 cửa đè cột infill | ✅ | `infillOverrideRefusal` — §6 |
| R4 đề xuất `GO WITH …` | ✅ | `placeOpening` |
| R5 dời cột quanh cửa cuốn | ✅ | `respaceAroundDoors` — §6 |
| R6 track/sliding/carry beam xung đột | ✅ (phần có nghĩa) | Xoá cửa gỡ `carry_beam.openingId`. Nửa "track bị chiếm" **cố ý không port** — xem §12.6 |
| R7 carry beam > 15 m | ✅ | `carryBeamRefusal` |
| R8 cửa cao hơn sàn mezzanine | ✅ | `optionsUnderMezzanine` — §6 |
| R9 (cùng R8 — xem ghi chú §6.3) | ✅ | `optionsUnderMezzanine` |
| R10 roller door tối thiểu | ✅ | `placeOpening` |
| R11 track 1000–6000 | ✅ | `placeOpening` |
| R12 snap theo tấm mái | ✅ | `skylightSnap.ts` — §6.2 |

**R6 là rule duy nhất còn một nửa, và nửa đó cố ý không port** — xem §12.6.

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

**Toàn bộ R1–R12 đã xong.** Bảng dưới là những gì còn lại, và **không mục nào là rule bị bỏ dở**:

| # | Còn gì | Vì sao |
|---|---|---|
| 1 | ~~Phiếu punchings cho roller-door column/header~~ | **ĐÃ XONG** — §12.5 |
| 1b | **File `.sqd` cho template** | **ĐÃ XONG 2026-11-06** — §16 |
| 1c | ~~Slice 2 phần còn lại~~ | **ĐÃ XONG** — form admin có công ty + mô tả + thứ tự; catalogue công ty hiện mô tả |
| 1d | **Template cô lập theo công ty** | **ĐÃ XONG** — mỗi template thuộc đúng một công ty, không có catalogue dùng chung |
| 1e | **Khối `Integrity` trong `.sqd`** | **ĐÃ XONG** — §17 |
| 1f | ~~Slice 5: salesman~~ | **ĐÃ XONG (khác spec)** — §19. Không có bảng 72 cột; salesman là chuỗi tự do trên site check |
| 1g | **Guard `autoCalc` + bảy trường địa lý** | **ĐÃ XONG** — §19 |
| 2 | ~~R6 nửa còn lại: track bị chiếm~~ | **CỐ Ý KHÔNG PORT** — track không có giá trong desktop (§12.6) |
| 3 | **Đặt cột infill quanh cửa không cuốn** (PA, cửa sổ) | Desktop chỉ re-space cho cửa cuốn; cửa nhỏ thì cột nằm nguyên. Chưa rõ desktop có ý định khác không |
| 4 | **Nhóm 4** | Rate table xong; ba mục còn lại **không phải việc port** — xem kết luận dưới |
| 5 | Hướng outrigger (left/right) | Chỉ là field hiển thị; `wall` đã bao trùm ngữ nghĩa |

> **Năm lần tôi kết luận "bị chặn" và cả năm lần đều sai:** Punchings (§12.4), R12 skylight, R9,
> R6 (track không có giá trong desktop), và "phiếu DM/DH cần model mới". Mỗi lần nguyên nhân giống
> nhau — tôi tin một ghi chú cũ của chính mình thay vì đọc code desktop. Quy tắc rút ra nằm ở
> [`CLAIM-DISCIPLINE.md`](CLAIM-DISCIPLINE.md): **ba lần kiểm tra trước khi được ghi "bị chặn"**,
> và nếu chưa kiểm thì ghi "chưa kiểm", không phải "bị chặn".

**Outrigger height: đã có** — `height` (mm), mặc định 2000, không vượt chiều cao tường; bracket
được vẽ đúng cao độ gắn chứ không phải ở eave.

**SKU picker cho cửa: đã có** — catalogue có thêm `doorSizes` cho window / PA / roller / sliding
(mỗi bảng một cách đặt tên cột, chuẩn hoá về `{code,label,width,height,series?}`); dock có dropdown
"Catalogue size" điền width/height và series.

### Nhóm 4 — kết luận

**Rate table: đã port** (§12.2).

**Min fee to distributor / nominated carrier: KHÔNG port — tính năng chết trong desktop.**
Tra toàn repo: bốn biến `MinFeeToDistributorInDollar/InPercent` và
`MinFeeToNominatedCarrierInDollar/InPercent` chỉ xuất hiện ở `AdminService` (đọc/ghi settings) và
`MainForm.cs:598-601,626-629` (copy từ admin vào `InstallationInfo`). **Không một chỗ nào trong
`PriceController`/BOM đọc chúng.** Port nghĩa là tự phát minh cách tính mà bản gốc chưa từng có.

**Salesmen: KHÔNG có màn hình để port.** Salesman là một trường trên **web ShedSafe**, lưu cùng
building (`ShedsafeData`), không có form desktop. v2 đã gửi client/reference khi pin.

**Backup/restore: là việc vận hành, không phải tính năng app.** Desktop sao lưu SQL Server cục
bộ của nó; v2 chạy Postgres và `pg_dump` là công cụ đúng — một nút trong app sẽ tạo cảm giác an
toàn giả (không kiểm soát được lịch, nơi lưu, hay khôi phục).

### Punchings Details — ĐÃ XONG (§12.4)

> **Ghi chú sửa sai.** Trước 2026-11-05 tôi viết ở đây rằng Punchings bị chặn vì "chưa có bảng vị
> trí lỗ". **Sai.** Ba bảng cần thiết — `kneeedge`, `cost_apex`, `cost_haunch` — đã có sẵn trong
> sách giá đang dùng (8 / 61 / 108 dòng), và `cost_frame` có cột `web` để chọn đúng connector.
> Tôi chỉ chưa tra. Từ đó: dựng §12.4 và không còn mục nào bị chặn.

**Cả năm loại phiếu đã có:** `C1`/`R1`/`C2`/`R2`, `M` (infill), `DM` (mullion) và `DH` (header).
Đoạn trước ở đây nói ba loại sau cần model mới — **đó là claim thứ năm hoá ra sai**: model cột infill
(`f480ad8`) và `DM`/`DH` từ bảng structure (`fc8fac3`) đều có sẵn.

### Đã xong (ghi để khỏi làm lại)

- Slice 1–8c của spec: domain, catalogue, BOM misc, rule engine, layout, Step 1, CategoryDock.
- Step 2 depth: Alignment/Distance/FFL; Series + Windlocks + Opening Only; **Track segments +
  R11**; **Mezzanine floor load 4 mức** (sửa bug $0); **Skylight Corro/TL-5** (sửa giá);
  **Awning scope + pitch**.
- Additions: 13 dòng + **dòng tự do** (equipment/distributor), GST đúng, override.
- **Copy / Delete (status) / Rename revision** — API + UI; Delete giữ revision để audit.
- **Cost Default / Reset**.
- **BOM CSV** (`?format=csv`) và **`.vqu`** (xem §13) — cả hai có test.
- **4 chế độ gửi** với counter riêng (§12.1).
- **5 loại bản in** với `PrintKind`; bản supplier **không có giá khách** (§12.1).
- Pin trước khi lưu (`POST /site-checks/pin`, `POST /site-checks/:id/import`).
- `cost:margin` enforce ở server; Fax; golden price-chain harness (§10).

---

## 12.1 Gửi mail và bản in

**4 chế độ gửi** (`POST /quotes/:id/send`, trường `mode`):

| mode | Counter tăng |
|---|---|
| `quote` (mặc định) | `quote_send_count` |
| `engineering` | `engineering_send_count` |
| `manufacturing` | `manufacturing_send_count` |
| `both` | cả hai counter nhà máy |

Counter tăng **sau khi queue nhận job**, nên replay không đếm hai lần. Migration `011_send_modes`.
Tên cột lấy từ `countersFor` (tập đóng), không từ request.

**Bản in** (`?kind=` trên `/html` và `/pdf`): `quotation` · `contract` · `order` ·
`supplier-quotation` · `supplier-contract`.

- 3 loại supplier **bỏ khối Price + Payment** — đây là bug desktop đã sửa: bản gửi nhà cung
  cấp in giá khách, tức lộ margin.
- Mỗi loại có `<h1>` riêng.
- `kind` nằm trong **cache key PDF**, để bản supplier không bị phục vụ PDF của bản khách.
- `kind` lạ → **422**, không âm thầm rơi về bản khách.

## 12.2 Rate table của công ty

`company_settings.settings_json.rates` (cents):

```
labour:        concreter · electrician · labourer1 · labourer2
defaultCosts:  council · engineering · rubbish · delivery · concrete
```

- Đường ghi `writeSettings` serialize **tường minh** từng field — thêm field mới phải thêm ở
  **cả ba chỗ**: `settingsPatch`, `CompanySettings` + `normaliseSettings`, và object
  `JSON.stringify` trong write. Thiếu chỗ thứ ba thì PATCH nhận rồi **mất im lặng**.
- `readRates` coi bảng đọc được **một phần** là `null`: 9 rate mà chỉ 7 đọc được thì giá sẽ
  đúng cho vài giờ và sai cho vài giờ, không ai phát hiện.
- Test: *"stores the company rate table"* (PATCH → GET round-trip).
- **UI đã có**: Settings → **Rates** (4 ô labour per hour + 5 ô default job costs; nhập bằng
  đô-la, lưu bằng cents).
- **`GET /settings/rates`** (quyền `quote:write`): chỉ trả bảng rate, để estimator đọc được
  mà không cần `settings:manage`; `GET /settings` vẫn 403 với role đó (có test).
- **Đã nối vào Additions**: `CostPanel` đọc rate và **chỉ điền vào ô đơn giá đang bằng 0** —
  không bao giờ ghi đè con số người dùng đã gõ.

**Plan drawing** — `GET /quotes/:id/revisions/:rev/plan` trả một trang **A4 landscape** chỉ có
hình: khung nhà, cửa/cửa sổ, kích thước, dòng "Indicative only — not for construction".
**Không giá, không tên/liên hệ khách, không quảng cáo** — đây là bản vẽ dán ở xưởng.
Dùng chung `PlanGeometry` với tài liệu khách nên hai bản không thể lệch nhau.

**Elevations** — `GET /quotes/:id/revisions/:rev/elevations`, A4 landscape, 4 panel (Front / Back /
Left end / Right end). Mỗi panel đọc `buildWallGeometries(config)` — **cùng nguồn với model 3D** —
nên lỗ cửa đúng vị trí, sill và kích thước; đường mái là **schematic** và sheet ghi rõ.
Không giá, không liên hệ khách.
`CustomerDocument` vì thế mang thêm `config` (hình học thật), không chỉ block đã project.

---

## 12.3 Steelwork schedule — model member size

**Đây là tính năng desktop "Steelwork Schedule / Member Size"**, tương đương `itemsFrame` mà
`PunchingDetailForm` đọc.

### Hàm duy nhất sinh ra nó

`frameMemberSchedule(shed, frame, lookup, rules)` trong
`packages/core/src/lib/bom/groups/frame.ts`. Mỗi dòng:

| Trường | Nguồn |
|---|---|
| `item` | `main_column` · `end_column` · `main_rafter` · `end_rafter` · `knee_brace` |
| `label` | Tên desktop dùng (`Main column`, `End wall rafter`…) |
| `section` | `FrameSchedule` của sách giá, hoặc `100 x 100 x 2.0 SHS` khi sách không có bảng |
| `assumed` | `true` khi thiếu bảng tiết diện — UI ghi rõ, không giả vờ là thiết kế |
| `lengthMm` | Cột: `height + embedment`. Rafter: `run / cos(pitch) + rafterClearance + apex + haunch` |
| `quantity` | `mainMemberCount()` / `endMemberCount()` — đúng hàm `frameLines` dùng để định giá |

**Vì sao dùng chung hàm đếm:** một báo giá nói 6 cột chính mà bảng cắt nói 8 thì xưởng cắt theo
bảng và hoá đơn theo báo giá. Cả hai đọc `mainMemberCount()`/`endMemberCount()`, và cả hai đọc
`FrameSchedule` qua `scheduleFor()`.

### Một bug của v2 đã sửa: rafter của skillion

`rafterLength()` trước đây luôn chia đôi span. Nhưng **chỉ skillion mới đổ toàn bộ chiều rộng về
một phía**; mọi họ khác đổ về hai tường dài. Nay hỏi `fallsToBothSides(structureType)` trong
`domain/types.ts`.

Căn cứ **từ sách giá**, không phải phỏng đoán — cột `structure_sub_code` của bảng `structure_type`:

| Structure | Sub-code | Sách giá gọi là |
|---|---|---|
| `gable`, `tophot_64` | `GB_TH64` | CROSSOVER GABLE – SERIES 4 |
| `tophot_96` | `GB_TH96` | CROSSOVER GABLE – SERIES 5 |
| `zed_shed` | `GB_Z150` | **CROSSOVER GABLE** – SERIES 6 |
| `aircraft_hangar` | `GB_AH` | CROSSOVER AIRCRAFT HANGAR – SERIES 6 |
| `cyclonic` | `GB_Z100` | CROSSOVER GABLE – CYCLONIC SERIES 4 |
| `gable_carport` | `GC` | CROSSOVER GABLE – CARPORT SERIES |
| `skillion` | `SB_TH64` | CROSSOVER **SKILLION** – SERIES 4 |
| `skillion_carport` | `SC` | CROSSOVER **SKILLION** – CARPORT SERIES |

Và desktop cũng vậy: `SkillionBuildingQuote.cs:242` chia **nguyên chiều rộng** cho `cos(pitch)`,
còn `TopHatQuote.cs:212` dùng `width / 2`.

> **Lần đầu tôi viết hàm này đã xếp `zed_shed` vào nhóm skillion — sai.** Sách giá gọi nó là
> crossover gable. Nếu giữ nguyên, một rafter 11 m sẽ thành 22 m: không có thép dài như vậy, và
> không ai cắt được. Test `keeps a zed shed on half the span` khoá lại điều này.

**`ENGINE_VERSION` tăng lên `2`** vì công thức đổi: revision cũ đánh dấu engine 1 và giữ nguyên số
của nó; revision mới dùng engine 2. Mọi revision skillion do engine 1 đã đặt thiếu khoảng nửa rafter.

### Đóng băng theo revision

- `quote_revisions.members_json` và `evaluations.members_json` (migration `012_frame_members`).
- Trigger append-only của `010` được **tạo lại** trong `012` để `members_json` cũng nằm trong danh
  sách cột bị khoá. Danh sách cột trong trigger là **liệt kê tay** — thêm cột mà không sửa trigger
  thì cột mới **không được bảo vệ**.
- Lý do phải đóng băng: `FrameSchedule` đến từ sách giá + factory profile. Đổi sách hay đổi profile
  tháng sau mà bảng cắt tự tính lại thì nó sẽ **lệch với hoá đơn đã gửi**.

### API và UI

| Chỗ | Nội dung |
|---|---|
| `POST /evaluate` | trả `members: FrameMemberView[]` — rỗng nếu role không có `cost:read` |
| `GET /quotes/:id/revisions/:rev/members` | bảng cắt đã đóng băng; gate `cost:read` |
| `SteelworkPanel` | Step 3 (Cost): Member · Section · Length · Qty, ghi `(assumed)` khi cần |

**Gate `cost:read`, không phải `cost:margin`:** tiết diện là thiết kế của nhà máy, không phải giá.
Người xem báo giá không cần nó; người đặt thép thì cần.

### Cột infill — thứ đã bị bỏ sót hoàn toàn

**Đây là lỗi thiếu thép, không phải thiếu tính năng.** Trước 2026-11-05, `frameLines` chỉ tính
`End wall column` từ `endMemberCount()`. Nhưng tường đầu hồi rộng cần **cột infill** đứng giữa để
mang tấm vách — sách giá nói rõ số lượng và tiết diện ở `no_M/EW`, `M1`, `M2` của bảng structure.
Một nhà 12 m thiếu **4 cột** (2 mỗi đầu hồi) và **21,71 m thép**.

`infillPositions()` port `arrayInfillPosition` của desktop:

```
step = (span − 2 × decrement) / (count + 1)
```

Cột xếp đối xứng qua sống nhà; khi cặp gặp nhau ở giữa thì **một cột** đứng trên sống chứ không
hai cột chồng nhau. `span < 3000` → không có cột nào (đúng guard của desktop, và trùng ngưỡng R3).

`infillLength()` là công thức desktop: cột chạy từ eave lên mái, nên cột càng xa góc càng **thấp**.

`buildingInfillColumns()` là **một** hàm cho ba nơi dùng (dòng giá, bảng cắt, kiểm R3) — ba bản sao
sẽ cho phép một cửa bị từ chối vì đè lên cột mà bảng cắt không có.

**Bị giữ lại khi đầu hồi có cửa.** `computeInfillPosition` + `checkRDoorColumnQuantity` của desktop
dời/bỏ cột quanh cửa cuốn, và chúng đọc `RDoor.Style` + `RelativeLocation` — v2 không có hai thuộc
tính đó. Nên đầu hồi có cửa thì **không có cột infill**, và `InfillColumns.withheld` nói lý do.

### Cái nó KHÔNG làm

Không có **vị trí lỗ đục** cho C1/R1/C2/R2 — phần đó ở §12.4.

## 12.4 Punching detail — vị trí lỗ đục

Tương đương `PunchingDetailForm` của desktop: mỗi thanh khung, lỗ nào ở đâu, tính bằng mm từ **mỗi
đầu**, cộng cỡ lỗ và tâm chày.

### Nguồn số — không có công thức nào

| Cần gì | Bảng sách giá | Cột |
|---|---|---|
| Lỗ ở eave, dưới đỉnh cột | `kneeedge` | `knee_edge_code` |
| Dung sai rafter tại knee / apex | `kneeedge` | `haunch` / `apex` |
| Lỗ connector apex | `cost_apex` | `d1`, `d2` → `r1`, `r2` |
| Lỗ connector haunch | `cost_haunch` | `d1`, `d2`, `d3` → `e1`, `e2`, `e3` |
| Chọn connector nào | `cost_frame` | `web` |

Connector chọn **theo web và pitch**: `HP20-22.5` là haunch cho web 20 mm ở pitch 22,5°. Đó là lý
do `FrameMember` mang thêm `web` / `depth` — không có web thì không gọi tên được tấm nối.

### Hai nhóm lỗ — chiều đo khác nhau

`createColumn` của desktop cộng dồn **top** từ đầu xa xuống và **bottom** từ đầu gần lên. Đọc
ngược lại thì mọi mối haunch rơi xuống chân cột. `remainingMm` là đoạn còn lại giữa hai nhóm — đoạn
thợ cắt đi qua, và là số đầu tiên người thợ kiểm.

### Một chỗ desktop làm khó hiểu, và v2 giữ nguyên

**C2 dùng haunch của cột chính, không phải haunch của chính nó.** Desktop đọc **một** `haunch` từ
`basicData.InternalColumn` rồi dùng cho cả C1 và C2 (`PunchingDetailForm.cs:100,139`), trong khi
apex thì tra riêng cho từng rafter (`apex1` cho R1, `apex2` cho R2, dòng 105 và 108). Tấm haunch
bắc qua knee của portal nên một tấm phục vụ cả hai thanh nó bắt vít; apex là tấm khác vì R1 và R2
khác tiết diện. Test `takes the portal haunch for the end wall` khoá lại.

### Khi nào KHÔNG in phiếu

Ba connector phải có **đủ cả ba**, thiếu một là **trả về rỗng**:

- sách không có `kneeedge` / `cost_apex` / `cost_haunch`, hoặc
- tiết diện là **assumed** (một `100 x 100 x 2.0 SHS` không có `HP100-22.5`), hoặc
- pitch không có trong bảng connector.

In phiếu thiếu lỗ haunch nguy hiểm hơn không in: xưởng đọc "hai lỗ" là **đủ**, và thanh về tới
công trình chưa đục ở mối chịu lực nặng nhất. Trả rỗng là đẩy người ta đi tra sách giá.

### API và UI

| Chỗ | Nội dung |
|---|---|
| `POST /evaluate` | trả `punchings: PunchPageView[]` — rỗng nếu role không có `cost:read` |
| `GET /quotes/:id/revisions/:rev/punchings` | phiếu đã đóng băng; gate `cost:read` |
| `PunchingPanel` | Step 3 (Cost), dưới Steelwork schedule |

Đóng băng ở `quote_revisions.punchings_json` và `evaluations.punchings_json` (migration `013`,
trigger append-only tạo lại trong cả hai dialect).

### Phiếu cho cột infill (ĐÃ CÓ)

Hai cột một tờ, như desktop. **Độ sâu tiết diện quyết định đường vít:** dưới 145 mm đục đường
**giữa** (`[2]`), từ 145 mm trở lên đục **hai đường ngoài** (`[1, 3]`) — tấm thép phải lách qua
cánh thép. Hai lỗ mỗi cột, cách đầu 100/100 mm (tiết diện sâu) hoặc 35/45 mm (nông).

### Phiếu DM / DH — ĐÃ CÓ

`PunchingDetailForm.cs:216-252` đục `DM` (cột mullion) với lỗ cách mỗi đầu **45 mm**, và `DH`
(dầm đầu) với **35 mm** — hai con số khác nhau, nên là hai hằng số riêng. Cả hai nay in trên một tờ,
đúng như desktop ghép cặp.

## 12.5 Khung cửa cuốn — dầm đầu và cột mullion

**Đây là lỗi thiếu thép thứ hai, cùng loại với cột infill.** Mỗi cửa cuốn là một lỗ trên tường, và
lỗ cần khung: hai cột hai bên và một dầm ngang trên. Sách giá ghi tiết diện ở cột `DM` và `DH` của
bảng structure (2752 dòng, không dòng nào trống).

v2 trước đây **không đọc hai cột đó**, và thay vào đó ghi:

> `DOOR_ACCESSORIES_ASSUMED` — "door tracks, **mullions** and jamb flashing assumed included"

Câu đó sai. Giá catalogue của cửa cuốn là tấm rèm và tang cuốn, không phải thép khung.

### Ba công thức port từ `OptionQuote.cs`

| Hàm | Nguồn | Việc |
|---|---|---|
| `rollerDoorColumnCount` | `checkRDoorColumnQuantity` (`BOMQuoteUtil.cs:766`) | 0, 1 hay 2 cột |
| `headerLengthMm` | `computeLengthRDoorHeaderBetween2Infill` (`:305`) + nhánh `:444` | Dầm dài bao nhiêu |
| `mullionLengthMm` | `computeLengthRDoorColumn_INFILL` (`:312`) + nhánh thường | Cột dài bao nhiêu |
| `doorFrameSetback` | `infillDecreamentDevided` | Lùi vào bao nhiêu |

`series` của cửa chính là `Style` của desktop, và nó đổi **đúng hai số**:

| Series | Số dầm | Cột cao hơn đầu cửa |
|---|---|---|
| `A` | 1 | 150 mm |
| `AA` | **2** | 150 mm |
| `B` | 1 | **290 mm** |

Cửa B có tang sâu hơn nên cột phải cao hơn 140 mm trước khi dầm đặt lên. Sai chỗ này là dầm thấp
140 mm — cửa không mở được.

**Cửa ≥ 5100 mm** cần thêm một đoạn `C15012` dài 1000 mm (`OptionQuote.cs:388`).

### Hai nhánh của cột mullion

- **Đứng dưới cột infill**: cột chạy từ móng lên mái theo độ dốc, trừ nửa chiều sâu rafter chia
  `cos(pitch)` — càng xa sống càng thấp.
- **Đứng tự do**: cột chỉ cao bằng cửa + packer + móng, dừng ở dầm.

### Phạm vi có chủ ý

Chỉ port **thanh thép**. Bu lông, bản mã, vít và flashing quanh miệng cửa vẫn nằm trong giả định —
`DOOR_ACCESSORIES_ASSUMED` nay đã bỏ chữ "mullions" và nói rõ phần khung là thép thật.

### Kiểm chứng

Sách giá thật, nhà 12 × 16 m, bay 4000, vùng B, cửa 3760 × 2400 series AA:

```
Roller door header   C15015   3.92 m   × 2
Roller door column   Z15024   5.25 m   × 2
→ khối lượng 5841 → 6018 kg  (+177 kg thép khung cửa)
```

Và trong trình duyệt: bảng cắt hiện cả hai dòng; phiếu punchings có mark `DM` và `DH`.

## 12.6 Cửa trượt — dầm đầu, flashing; và vì sao KHÔNG port track

### Cái đã thiếu và đã bổ sung

Cửa trượt treo trên track, track treo trên **dầm** bắc ngang miệng cửa, và trên dầm có **flashing**.
Desktop cắt dầm từ `C15024` (`SLDQuote.cs:58`) và đặt flashing lên trên (`:66`). v2 **không tính
gì** — cửa trượt chỉ có cánh cửa, dầm phía trên miễn phí và nước chảy ra sau dầm.

`slidingDoors.ts`:

| Hàm | Việc |
|---|---|
| `splitRun(length, 6000)` | Chia đều thành các đoạn bằng nhau, không phải "một dài + một mẩu" |
| `headFlashingType(opening)` | Track đơn → `SLD_SINGLE_HEAD_FLASHING`; track đôi → `SLD_HEAD_FLASHING` |
| `slidingDoorMembers` | Dầm + flashing, flashing dài hơn dầm 200 mm mỗi đầu |

**Hai loại flashing là hai sản phẩm khác giá** — kiểm trên sách giá thật: 7,39 so với 8,44 đô/m.
Track đôi đứng xa tường hơn nên flashing sâu hơn. Chọn nhầm là báo giá sai sản phẩm.

`splitRun` chia **đều**: một đoạn 13 m thành 3 × 4 333 mm, không phải 6 000 + 6 000 + 1 000. Mẩu
1 m là phí liệu, và mối nối hai đoạn lệch nhau cần bản mã mà không ai tính.

**Một lỗi tôi tự tạo ra và tự bắt:** dầm đã vào dòng giá nhưng **không vào bảng cắt** — hai view
mô tả hai cây nhà khác nhau. Phát hiện khi kiểm chứng trong trình duyệt: khối lượng tăng 12 kg mà
bảng cắt không có dòng nào. Nay có test `puts a sliding door's head beam on the cut list, not only
on the price` khoá bất biến: **thứ gì nhóm frame tính tiền thì phải cắt được**.

### Vì sao KHÔNG port "track bị chiếm thì từ chối" (nửa sau R6)

**Track không có giá trong desktop.** Kiểm chứng:

- `SLDQuote.cs:552, 581, 612, 632` — mọi dòng `DOOR_TRACK` đều **bị comment out**;
- `computeSLDTrackTQ3` (`:866`) là chỗ duy nhất còn dựng dòng `DOOR_TRACK`, và **chỗ gọi nó duy
  nhất** (`:781`) cũng bị comment;
- `TRACK_JOINER`, `TRACK_END_TOP`, `TRACK_SUPPORT_BRACKET` — tất cả đều bị comment.

Nên port rule đó nghĩa là **tự phát minh** một tính năng: nó bảo vệ một thứ bản gốc không tính
tiền, và model "track là đối tượng có vị trí" chỉ tồn tại để phục vụ nó. Ghi ở KNOWN-DEVIATIONS
dòng 20.

**Đây là lần thứ tư** một mục trong danh sách "còn thiếu" hoá ra không phải việc cần làm — sau
Punchings, R12, R9.

## 16. File `.sqd` cho template — content-addressed, verify khi tải

### Vì sao template cần file

`config_json` của template đủ để **clone** trong sản phẩm này, nhưng không đủ để **chuyển**: một
người dùng desktop cũ cần chính file `.sqd`, không phải một JSON blob họ không mở được.

### Ba quy tắc

**1. Hash trên BYTE, không phải canonical JSON.** Content-addressed storage (S3
`x-amz-checksum-sha256`, Git blob, npm `integrity`) băm đúng thứ được lưu, nên người đọc verify được
mà không cần biết producer serialize thế nào. Khối `Integrity` *bên trong* file (Slice 4) băm
canonical JSON — cơ chế khác cho câu hỏi khác, và lẫn hai cái là lỗi.

**2. Đọc mà không khớp thì TỪ CHỐI, không trả file.** Một `.sqd` hỏng mở ra thành báo giá trông hợp
lý nhưng sai số. Trả **409** kèm **cả hai** hash để người dùng so được với bản backup.

**3. `rel_path` từ DB không được tin.** Mọi lần đọc `resolve` rồi kiểm kết quả **nằm trong**
`data/template-files/`. `../../.env` resolve ra ngoài và bị từ chối. So sánh có **dấu phân cách**
(`root + sep`) để thư mục anh em `template-files-old` không bị nhận nhầm là con.

**Không ghi đè:** mỗi upload là revision mới; `active_file_revision_id` là con trỏ, nên rollback là
trỏ về row cũ.

### Bốn route

| Route | Capability | Việc |
|---|---|---|
| `POST /admin/templates/:id/file` | `platform:templates` | Lưu một revision (validate là `.sqd` thật trước khi ghi) |
| `GET /admin/templates/:id/file` | `platform:templates` | Bản active (hoặc `?revisionId=`), verify |
| `GET /admin/templates/:id/files` | `platform:templates` | Lịch sử |
| `GET /templates/:id/file` | `quote:write` | Công ty tải bản active |

**Công ty bị từ chối luôn nhận 404, và body giống hệt id không tồn tại** — một 403 xác nhận id là
thật, tức lộ rằng template của đối thủ đang ở đó.

### Giới hạn request body — hai lỗi thật tìm được khi kiểm chứng

**Lỗi 1: `priceImport` khai 8 MB nhưng server chặn 1 MB.** `app.ts:61` đặt `bodyLimit: 1 MB`, nên
mọi bảng giá lớn hơn ~750 KB bị chặn **trước khi route chạy**, và câu "larger than 8 MB" không bao
giờ hiện. Nay hằng số là **900 KB** — dưới trần, và câu thông báo tính từ chính hằng số đó.

**Lỗi 2: mọi lỗi 4xx bị bọc thành 500.** Upload 2 MB trả
`{"code":"internal","message":"Something went wrong..."}` thay vì 413. Nguyên nhân:
`setErrorHandler` gán cứng 500. Nay handler **giữ `statusCode` của Fastify** khi nó là 4xx và trả
`payload_too_large`, nhưng **không bao giờ chuyển tiếp message gốc** — message của lỗi DB từng làm lộ
`UNIQUE constraint failed: memberships.username` ra browser.

**Vì sao dùng byte, không phải số dòng:** file `.sqd` lớn nhất trong 31 file thật của desktop là
**97 KB**; v2 tự ghi 20 revision là **8,4 KB**. Base64 phình 33%, nên 1 MB là dư 5–7 lần.

### Kiểm chứng (2026-11-06, qua `curl` với server thật)

| Ca | Kết quả |
|---|---|
| upload 623 B | `sha256 f0c2f42f…`, `sizeBytes 623` |
| tải về và `sha256sum` | **khớp tuyệt đối**, header `x-content-sha256` = hash DB |
| sửa 1 byte trên đĩa rồi tải | **409**, KHÔNG có body file, nói `recorded f0c2f42f…, found b85fafa9…` |
| upload lần hai (v2) | revision mới; v2 thành active, v1 vẫn tải riêng được |
| công ty tải template global | **200** với `x-content-sha256` |
| công ty B tải template của A | **404**, body **giống hệt** một id không tồn tại |

### Một lỗi có sẵn khác, sửa luôn

**`/platform` crash cho mọi platform admin.** `apps/admin/src/app/platform/page.tsx` đọc
`usage.data.items`, nhưng `/admin/usage` trả `{ scope, summary, recent }`. `usage` thành `undefined`
và `usage.length` ném `Cannot read properties of undefined`. Kiểu viết tay nói `items`, và không có
test nào cho page admin nên không ai thấy. Nay đọc `summary`.

## 17. Template thuộc một công ty — không có catalogue dùng chung

**Quyết định của operator, khác spec gốc.** Spec cho phép `tenant_id IS NULL` = template global dùng
cho mọi công ty. Operator nói: *"công ty nào thì chỉ thấy của công ty đó"*. Nay **mọi template phải
thuộc một công ty**, và `tenantId` là trường **bắt buộc** khi tạo.

**Vì sao bắt buộc thay vì mặc định global:** một template không có `tenant_id` là template **không ai
thấy**. Hỏng theo hướng đó an toàn hơn "ai cũng thấy", nhưng nó vô hình — người dùng kết luận
"catalogue hỏng" chứ không phải "dòng này sai". Bắt buộc lúc tạo là chỗ duy nhất lỗi còn nhìn thấy
được; route cũng kiểm công ty có thật, nên một id gõ nhầm bị từ chối chứ không tạo dòng mồ côi.

**Ba chỗ phải lọc, và trước đây chỉ một chỗ lọc:**
- `GET /templates` — lọc `tenant_id` (trước đây chỉ lọc `status`)
- `POST /templates/:id/cloned` — lọc `tenant_id` (bộ đếm mà công ty khác bấm được là bộ đếm xác nhận id
  tồn tại)
- `GET /templates/:id/file` — đã lọc từ Slice 3

**Nửa vời tệ hơn không có:** trước khi sửa, công ty **thấy** template của đối thủ trong danh sách
nhưng **không tải được** file của nó. Trông như lỗi, không như chính sách.

**Một bug im lặng tìm được khi sửa:** `db.run('... WHERE id = ? AND tenant_id = ?', [id])` — mảng
**một** phần tử cho **hai** dấu `?`. Không throw, chỉ không khớp, nên bộ đếm clone đứng yên và test
clone cũ fail. TypeScript không bắt được vì `run` nhận mảng.

## 18. Khối `Integrity` trong `.sqd`

### Hai câu hỏi khác nhau, hai cơ chế khác nhau

| | Hash gì | Trả lời |
|---|---|---|
| `templateFiles.ts` (Slice 3) | **byte** của file trên đĩa | "File trên đĩa có bị sửa không?" |
| `integrity.ts` (Slice 4) | **canonical JSON** của document | "File gửi qua email có bị sửa sau khi ghi không?" |

Không lẫn hai cái: byte của file gửi qua email không phải byte server nào lưu, nên hash byte **không
chứng minh gì** ở đó.

### Canonical, không phải text

Cùng một document có thể ghi với khoảng trắng, thứ tự khoá, format số khác nhau — đều là cùng một báo
giá. Hash text sẽ làm file chỉ được **format lại** trông như bị sửa. Nên hash trên canonical form
(khoá sắp xếp, không khoảng trắng), đúng RFC 8785 — cùng cách `canonicalHash` trong `priceBook.ts` đã
làm cho việc so config.

**Block bị bỏ ra trước khi hash** rồi thêm lại: một digest không thể chứa chính nó.

### Ba trạng thái khi đọc

| | Nghĩa | Có phải lỗi? |
|---|---|---|
| `valid` | Có block, digest khớp | Không |
| `absent` | **Không có block** — file desktop cũ | **Không** — đây là điều quan trọng nhất |
| `invalid` | Có block, digest **không khớp** → ai đó đã sửa | **Có** |
| `unsupported` | Block dùng thuật toán build này không kiểm được | Không — không được gọi là "invalid" |

`absent` **không được** từ chối: làm vậy sẽ khiến mọi file cũ không đọc được, ngược hẳn mục đích.

### Nó KHÔNG phải chữ ký

Một người sửa file rồi **tính lại digest** sẽ tạo ra file `valid`. Block chứng minh file **tự nhất
quán**, không chứng minh người viết trung thực. Có test ghi rõ điều này để sau này không ai nhầm.

### Kiểm chứng

```
block trong file:  Digest f3e86a8437da…, Issuer ACME
đọc lại:           valid
sửa giá 30118.63 → 29999.99:  invalid (expected f3e86a84…, actual 4871cd82…)
chỉ format lại JSON:          valid
```

## 19. ShedSafe — guard Auto Calc, bảy trường địa lý, salesman

### Lỗi thật mà desktop đã sửa, và v2 từng mắc lại

ShedSafe trả **đủ** các trường gió **kể cả khi chưa bấm Auto Calc**, và giá trị trước đó là **số thô**
— `topographicFactor` và `vSite1` đặc biệt. Comment của desktop ghi lại hậu quả:

> *"GUARD: block premature Get SiteCheck Report before the building has been Pinned + Auto
> Calculated... Without this, the app silently accepts raw/uncalculated values (e.g. wrong
> topographicFactor / vSite1) and reports success, corrupting the structural design."*

**v2 trước đây chỉ kiểm "có giá trị nào không"** — tức đúng cái guard sai. Nay:

| | |
|---|---|
| Cờ dùng | **`autoCalc === true`** **và** `message.errorMessage` rỗng |
| Cờ KHÔNG dùng | `windRegion` — **nó có trước Auto Calc**, nên kiểm nó là guard giả |
| Khi chưa tính | **200, không phải 409** — đọc được dữ liệu, nhưng **không ghi cột giá** (xem §19.1) |

Có test dựng đúng ca này: `windRegion: 'C'` đã có, `autoCalc: false` → cột giá phải rỗng.

### 19.1 Chưa Auto Calc thì **vẫn đọc** — nhưng cảnh báo rõ và không dùng để tính giá

Bản đầu từ chối bằng **409**, và operator nhìn thấy "Not calculated" mà **không biết ShedSafe đã
được gọi tới chưa**. Nay tách làm hai:

| | |
|---|---|
| Sáu cột định giá (`wind_region`, `terrain_category`, …) | **vẫn NULL** — engine không được đọc số thô |
| `detail_json.provisional` | **lưu số thô** ShedSafe đang giữ, để hiện cho người dùng xem |
| HTTP | **200** — lời gọi thành công, nó chỉ không có *rating* |
| `calculated: false` + `lastError` | hai thứ nói rằng rating chưa được cấp |

**Vì sao 200 chứ không 409:** mã trạng thái không chở được sự khác biệt "đã đọc được building" với
"chưa có rating". Một 409 làm màn hình coi trạng thái bình thường là lỗi và nuốt luôn dữ liệu vừa đọc.

**UI** (`SiteCheckPanel`): banner vàng `role="status"` với **4 bước đánh số** (mở ShedSafe → pin vị trí →
bấm Auto Calc → quay lại đây), câu nói thẳng *"they are not used to price this quote"*, và khối
`provisional` gấp lại ghi rõ *"provisional — not a rating"*.

### 19.2 Ba lỗi thật tìm được khi gọi ShedSafe thật (2026-11-06)

Kiểm chứng bằng cách gọi API ShedSafe thật, không phải bằng mock. Cả ba đều là **lỗi của v2**, và cái
thứ ba là lỗi **của desktop** mà v2 copy lại.

**1. `Salesman` gửi email khách hàng.** `shedsafe.ts:257` vẫn là `Salesman: input.client.email` dù
commit trước đó **tuyên bố đã sửa** — thực ra chỉ sửa tham số `salesman` của `getsalesmansitelink`,
không sửa body `/building/create`. Nay gửi `input.salesman`.

**2. ShedSafe từ chối `Salesman` rỗng.** Gọi thật trả về:

```
An invalid argument was supplied. The Salesman field is required.
```

Nghĩa là **desktop gửi `Salesman = ""` là lỗi của desktop**, site check của nó không thể chạy với API
hiện tại. Nay: route **bắt buộc** `salesman` (min 1, câu lỗi nói rõ), và UI mặc định điền **người đang
đăng nhập** (`session.displayName`), vẫn sửa được. Nút bị khoá khi ô rỗng.

**3. ShedSafe từ chối `SuburbName` rỗng.**

```
An invalid argument was supplied. The SuburbName field is required.
```

Đo được: có suburb → pin OK; không suburb → lỗi trên. Câu này nêu tên **field wire** (`SuburbName`) mà
màn hình gọi là "Suburb". Nay route required `suburb`, và UI chặn trước khi gọi với câu dùng đúng từ
của form.

**Đo thêm:** `state`, `postcode`, `addressLine1`, `client.email` đều **không** bắt buộc (pin vẫn OK khi
rỗng) — nên chúng vẫn optional, không siết thêm.

### 19.3 "Go to ShedSafe" — một hành động, như desktop

Desktop: bấm **GO TO SITECHECK** → pin → `Process.Start(mapUrl)`. v2 trước đây: bấm "Pin the site" →
**không mở gì** → phải tìm link "Open ShedSafe" ở chỗ khác. Nay pin xong **tự `window.open(siteLink)`**,
và câu xác nhận nói rõ đã mở tab mới — hoặc rằng trình duyệt đã chặn, kèm link dự phòng.

Nút check lại đổi nhãn theo trạng thái: **"Check again after Auto Calc"** khi chưa tính,
**"Check and import the rating"** khi đã có — vì bước người ta quên là *quay lại*.

### Bảy trường địa lý

`SiteCheckValues` mở rộng thêm `shielding`, `topographicFactor`, `snowLoadRegion`,
`earthquakeHazardFactor`, `elevation`, `latitude`/`longitude`, `rainfallIntensity100/20Years`,
`rainfallIntensityTown` — đúng bảy dòng desktop hiện trong "show more parameters" và
`UcShedSafeInfoView`.

**Lưu ở `site_checks.detail_json`** (migration `015`), không phải chín cột riêng: không trường nào
tính giá, và thêm một cột mỗi lần cơ quan cấp chứng nhận thêm một chỉ số là không đúng hướng.

**Hai nhóm trong API, cố ý tách:** `values` là sáu trường engine đã định giá từ, `site` là những gì
chứng nhận nói về **địa điểm**. Gộp chúng sẽ gợi rằng độ cao ảnh hưởng giá — nó không.

**`detail_json` giờ có ba loại khoá** (`salesman`, `provisional`, các reading). `toView` chỉ đưa các
reading ra `site` và đưa `salesman` ra riêng — đưa cả blob ra làm màn hình in *"Shielding: undefined"*,
đúng lỗi đã thấy trên trình duyệt.

**Một lỗi tôi tự tạo khi làm:** `importIntoCheck` ghi `detail_json` mới, **xoá salesman** đã lưu lúc
pin — mất đúng lúc người ta cần biết ai đã yêu cầu kiểm tra. Nay **merge**, và có test
`keeps the salesman it recorded at pin time`. Khi import thành công, khoá `provisional` được **bỏ** —
để lại một số thô cạnh số chứng nhận là mời người ta tin nhầm cái sau.

### Salesman — làm khác spec, và nhỏ hơn nhiều

Spec §4.8 nói "bảng `salesmen` theo tenant + đồng bộ `createsalesman`/`updatesalesman`".

**Kiểm chứng lại thì không đáng:**
- Bảng 72 cột của licence server (`SSId`, `FranchiseName`, `FranchiseId`…) phục vụ màn hình "Building
  Management" theo franchise — operator đã nói không cần.
- Không có tác dụng lên giá.

**Đã làm thay:** một ô **chuỗi tự do** trên site check, mặc định là người đang đăng nhập, gửi lên qua
**cả hai** chỗ: `Salesman` trong `/building/create` và tham số `salesman` của `getsalesmansitelink`;
lưu trong `detail_json`.

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

## 13.0 Enquiry → mail: `ENQUIRY_TO` cộng một bản cho platform admin (2026-11-06)

`ENQUIRY_TO` từng nằm trong `turbo.json` và **không ai đọc**. Enquiry chỉ vào bảng `enquiries`,
tức một cái queue mà **không có gì nhắc ai mở nó**. Một lead đã ghi nhưng không ai biết = lead mất.

### Ai nhận

| Người nhận | Vì sao |
|---|---|
| Mỗi địa chỉ trong `ENQUIRY_TO` (cho phép dấu phẩy) | Đây là hộp thư trả lời khách — người vận hành chỉ định |
| Mỗi `platform_admin` đang hoạt động (`disabled_at IS NULL`) | Bản để quản lý, như bạn yêu cầu |

**Khử trùng lặp, không phân biệt hoa thường.** Máy nhỏ thường đặt `ENQUIRY_TO` trùng chính địa chỉ
admin — hai mail giống nhau là cách một thông báo bị lọc vào thư mục rác.

**`Reply-To` = email người hỏi.** Đây là chỗ duy nhất địa chỉ người hỏi thuộc về envelope: bấm
Reply là trả lời thẳng khách, không phải copy tay từ thân mail. Chi tiết vẫn nằm trong body vì mail
bị forward sẽ mất envelope.

**Người hỏi không nhận bản nào.** Một mail "chúng tôi đã nhận" là một cam kết trả lời mà sản phẩm
không biết ai sẽ giữ; form chỉ hứa `received: true`.

### Bốn quyết định, và cái sai đã sửa

**1. Row trước, mail sau — mail KHÔNG BAO GIỜ làm hỏng request.** Enquiry là lead. Mọi lỗi trong
khâu gửi đều bị nuốt: relay từ chối, relay treo, chưa cấu hình mail. Route vẫn 201. Người điền form
không sửa được mail server, và báo "enquiry thất bại" khi nó đã nằm trong DB là nói sai ở đúng chỗ
khách đang nghi ngờ không ai nghe.

**2. Bot và rate-limit không gửi mail.** Honeypot trả 201 giả rồi **dừng trước khi build message** —
không được biến nó thành đường gửi mail miễn phí.

**3. Mỗi người một mail riêng, không Cc.** Địa chỉ admin nội bộ không nên lộ sang hộp thư sales.

**4. Trả lời trước, gửi nền — và đây là chỗ tôi đã sai rồi đo lại.**
Bản đầu `await` khâu gửi với ngân sách **4 giây**. Đo SMTP2GO thật từ máy này:

```
SENT in 6476 ms
```

**Mọi** notification thật đều bị huỷ ở giây thứ 4 trong khi form báo thành công — dạng hỏng tệ nhất
của tính năng này. Đổi sang gửi nền:

- route trả lời ngay (`trackEnquiryNotification`), **0,41 s** thay vì 4,3 s;
- promise được **giữ trong một `Set`**, không `void` — để test chờ được (`settleEnquiryNotifications`)
  và shutdown không làm rơi;
- ngân sách 30 s chỉ còn để chặn relay **treo**, không phải để chặn relay bình thường;
- `server.ts` chờ hết notification đang bay trước khi thoát.

**Kiểm chứng live** (2026-11-06, relay thật): hai enquiry gửi vào
`hello@martechsky.com`; log `sent: true` cho **cả hai** người nhận, `Reply-To` = `hello@martechsky.com`.

### Cấu hình

`.env` / `.env.example`: `ENQUIRY_TO=` (rỗng = chỉ admin nhận). `.env.example` giải thích đầy đủ.

---

## 13.1 Nối các route mồ côi vào UI (2026-11-06)

Sáu route đã chạy và đã có test, nhưng **không có màn hình nào gọi tới** — chúng chỉ tồn tại
cho một `curl`. Một route không có người dùng là một tính năng chưa có; đây là chỗ nối chúng.

| Route | Nối vào đâu | Ghi chú |
|---|---|---|
| `GET /quotes/:id/revisions/:rev/members` | `FrozenSteelwork` trên trang báo giá | Đọc `members_json` của revision, **không** tính lại |
| `GET /quotes/:id/revisions/:rev/punchings` | cùng component | Trang punching cùng nguồn đông lạnh |
| `GET /quotes/:id/revisions/:rev/export/vqu` | nút "Export .vqu" trong `DocumentActions` | Qua bridge, không trỏ thẳng API |
| `GET /quotes/:id/revisions/:rev/bom?format=csv` | nút "Materials as CSV" | Desktop có cả hai dạng |
| `GET /templates/:id/file` | "Download .sqd" trong `TemplatePicker` | Chỉ hiện khi `hasFile` |
| `GET /admin/templates/:id/file` + `?revisionId=` | "Download" + bảng lịch sử trong `PlatformPage` | File cũ tải được theo id |
| `GET /usage` + `GET /usage/kinds` | trang `/activity` (mới) | Nav rail, capability `usage:read` |
| `PATCH /admin/companies/:id/status` | `CompanyStatus` trên `/company` | Gõ đúng tên công ty mới bấm được |

### Bốn quyết định đáng ghi lại

**1. Bridge phải truyền nhị phân.** Cả hai bridge (`/api/sq/[...path]`) đọc mọi câu trả lời bằng
`.text()` rồi ghi lại. Với JSON thì không sao; với `.sqd` (attachment) và `.vqu` (ISO-8859-1) thì
việc decode UTF-8 rồi encode lại tạo ra một file **sai một cách tinh vi** — tool nhận file từ chối
mà không nói tại sao. Sửa: kiểm `content-type`, nếu không chứa `json` thì `arrayBuffer()` và copy
`content-disposition` + `x-content-sha256`.

**2. `.vqu` đi qua bridge, các link cũ trỏ thẳng API.** Các link PDF/plan/elevations trỏ thẳng
`NEXT_PUBLIC_API_BASE`; chúng chạy được ở dev vì cookie theo domain chứ không theo port. Hỏng ngay
khi API và app khác host — đúng hình dạng một deployment của khách. Link mới đi bridge để không
phải sửa sau. **Các link cũ vẫn là một khoản nợ.**

**3. `hasFile` là cờ, không phải id file.** Công ty không có việc gì biết id revision của file;
route tải tự tìm file đang hoạt động. Nếu không có cờ này, màn hình mời tải cho **mọi** template và
trả 404 cho những cái chưa có file — đọc thành "catalogue hỏng" chứ không phải "template chưa đủ".

**4. Suspend cần gõ tên công ty, và huỷ phiên ngay.** `PATCH …/status` đã huỷ toàn bộ ghế + session
trong cùng transaction từ trước, nhưng không có control nào. Hộp xác nhận "are you sure" bị bấm
theo phản xạ; gõ tên là điều nhỏ nhất buộc người ta đọc **công ty nào**. Lý do được ghi vào audit
log cạnh tên người thao tác.

### Một điều học được khi kiểm chứng

Panel khoá thép **rỗng** trên báo giá `Q-2026-0006` dù báo giá đó 8,090 kg thép: `members_json` là
`"[]"`. Nguyên nhân không phải route hỏng mà là **dữ liệu cũ** — revision lưu ngày 02/11, trước khi
bảng cắt được đóng băng vào `members_json`. Một báo giá lưu mới qua đúng đường API cho 5 dòng
(`main_column`, `main_rafter`, `end_column`, `end_rafter`, `knee_brace`). Bài học: **cột mới + dữ
liệu cũ = màn hình trông như hỏng**, và cách phân biệt là lưu một bản mới rồi so.

Trên trình duyệt, cùng một kiểm chứng:
- `/activity` hiện 2 dòng `page_view` của chính phiên đang xem (beacon ghi thật);
- tab Templates có `probe-gable-9x18 / v1 / Download / History (1)`; bấm History ra
  `v1 a198b343cee1… 0.9 KB Served` + link tải theo `revisionId`;
- tải qua bridge: `.vqu` 727 bytes `text/plain; charset=iso-8859-1`, `.sqd` 901 bytes
  `application/octet-stream` với `x-content-sha256` khớp hash đã lưu;
- nút "Suspend this company" **disabled** cho tới khi gõ đúng `Demo Sheds Pty Ltd`.

---

## 13.2 `ControlSheet` — sửa cửa/option trên điện thoại (2026-11-06)

### Lỗ hổng

Dưới 1024 px, plan đặt và kéo được cửa, **wrench hiện ra**, nhưng bấm vào **không có gì xảy ra**:
`SelectionPopover` chỉ render khi `isDesktop`, và cái bottom sheet mà ba file comment mô tả —
`ControlSheet` — **chưa từng được viết**. Tệ nhất là kiểu điều khiển nhận tap rồi im lặng: người
dùng kết luận *tính năng không có*, chứ không phải *mình bấm hụt*.

Store thì đã có sẵn `sheetOpen` và `objectDragging` — khai báo từ đầu, chưa ai đọc. Đúng kiểu "đã
thiết kế, chưa ai viết".

### Thiết kế

**Bottom sheet, không phải dialog giữa màn hình.** Plan là thứ đang được sửa, nên editor phải để lộ
nhiều plan nhất có thể; che ở **đáy** là chỗ ngón tay đặt và chỗ không có gì quan trọng được vẽ.
Một modal giữa màn hình 375 px che mất toà nhà.

**Dùng lại `SelectionFields`, không viết lại control.** `SelectionFields` đã sở hữu toàn bộ ánh xạ
từ `FieldSpec` về `patchOpening` / `patchOption` / `applyPartial` — kể cả key có dấu chấm
`panels.left` và giá trị chuỗi rỗng "open" của carry beam. `ControlSheet` chỉ cung cấp phần khung.

**Target 44 px.** WCAG cho web là 24 px, nhưng sản phẩm này đã dùng 44 cho wrench và các nút của
plan; một nút Close 20 px là chi tiết làm editor mobile *cảm giác* hỏng. Đo trên viewport 390×844:
**8/8 control ≥ 44 px**, sheet cao 69% màn hình, còn 259 px plan nhìn thấy phía trên, không tràn ngang.

**`objectDragging` làm sheet thu lại, không đóng.** Kéo cửa diễn ra dưới sheet; kéo xong sheet hiện
lại, `editorOpen` và selection không đổi.

### Ba bug chỉ trình duyệt mới thấy (jsdom không)

**1. Focus không đi vào sheet.** Phải `focus()` trên container (`tabIndex={-1}`), không phải ô nhập
đầu tiên — focus ô nhập trên điện thoại bật bàn phím, che đúng phần plan mà sheet được đẩy xuống để lộ.

**2. Không nhớ được phần tử để trả focus.** Wrench **bị unmount khi editor mở** (nó chỉ render lúc
editor đóng), và bỏ phần tử đang focus là thứ đẩy focus về `<body>` — trước khi effect của sheet kịp
chạy. Nên `document.activeElement` lúc đó **đã là `<body>`**. Sửa: tìm lại theo **accessible name**
(`[aria-label="Edit selected object"]`), danh tính sống qua lần re-render.

**3. `requestAnimationFrame` không chạy.** Đo được: `document.hasFocus()` là `false` trong tab
không có OS focus, nên callback rAF **không bao giờ bắn** — focus kẹt ở `<body>`. Đổi sang
`setTimeout(0)`.

Cả ba đều lọt qua test viết bằng tay tạo `<button>` vì cái nút đó không bao giờ unmount.

### Một chỗ làm khác spec, có chủ ý: giữ selection

Comment store cũ nói đóng sheet là "mobile out focus" — xoá cả selection. Đổi thành **giữ**: đóng
card desktop vẫn giữ wrench, nên đóng sheet điện thoại phải nghĩa giống hệt, nếu không người dùng
không xây được phản xạ nào. Và nó còn là điều kiện để bug 2 tồn tại: nếu selection bị xoá thì không
còn wrench để trả focus về.

### Ảnh hưởng phụ

`apps/client/vitest.config.ts` thêm alias `@` → `src`. Thiếu nó, test import
`@/store/useShedStore` không resolve trong khi component thì build bình thường.

---

## 13.3 Báo giá cũ mở ra sửa được — và ba lỗi thật cản nó (2026-11-06)

Yêu cầu: mở một báo giá đã lưu thì phải ra **3 step**, 2D và 3D phải hiện. Đường đi đã có
(`/quotes/:id/edit` nạp `config` + `pricing` của revision hiện tại); phần lớn là kiểm chứng. Nhưng
kiểm chứng lộ ra ba lỗi mà chỉ trình duyệt thật mới thấy.

### 1. Cột plan bị CSS grid kéo cao 4892 px

Grid là `grid-cols-[380px_1fr_300px]`; một hàng grid cao bằng **ô cao nhất**, và form step bên trái
cao 6418 px. Nên cột plan bị kéo theo, và khung vẽ bên trong thành **934 × 6112**.

Hệ quả: 3D vẽ vào một tờ giấy cao mười hai màn hình — camera canh giữa, toà nhà nằm ở một góc, không
ai thấy. 2D cũng sai tỉ lệ nhưng ít lộ hơn vì Konva tự fit.

**Sửa:** cột plan `lg:sticky lg:top-sq-3 lg:h-[calc(100dvh-2rem)]` — cao bằng viewport và dính khi
form cuộn. Đo lại: **553 × 836**. Khung 3D đổi từ chiều cao cố định 420 px sang `h-auto` trên desktop,
để nó lấp đầy cột thay vì nằm trong hộp thư.

### 2. Canvas 3D kẹt ở 300 × 150

R3F đo container qua `react-use-measure`, mà thư viện đó chỉ đọc `getBoundingClientRect` **khi
`ResizeObserver` gọi nó**. Trong pane nhúng, `ResizeObserver` **không hề bắn** — đo bằng một `<div>`
trơn: không callback nào, dù đổi `width/height` hay đổi viewport. `rAF` cũng không chạy
(`setTimeout(100)` nổ sau 921 ms).

Canvas 2D bên cạnh luôn đúng, vì `Render2D` đọc thẳng `clientWidth`/`clientHeight` lúc mount.

**Sửa:** `Render3D` tự đo container giống `Render2D`, rồi **dispatch một `resize` trên `window`** —
đó chính là đường dự phòng mà `react-use-measure` có sẵn (`window.addEventListener('resize', …)`).
Không chép lại logic định cỡ của R3F, chỉ đánh thức nó. Đo lại: canvas **670 × 933**, WebGL viewport
`[0,0,670,838]` khớp.

> `readPixels` trả về một màu duy nhất vì `preserveDrawingBuffer: false` — đó là mặc định đúng của
> R3F, không phải lỗi. Muốn đọc pixel phải bật cờ đó, và bật chỉ để test là tự làm chậm sản phẩm.

### 3. `env(safe-area-inset-bottom)` trong `calc()` — không có tác dụng phụ

Đã dùng ở `ControlSheet` (§13.2). Không đổi.

### Kiểm chứng

| Việc | Kết quả |
|---|---|
| `Q-2026-0006` (2 revision, lưu 02/11) mở ở `/edit` | 3 step, `Q-2026-0006 · revision 2`, nút lưu **bật** |
| Nạp khách hàng | `Slice Charlie`, `slice.c@example.com` |
| Step Options | 5 option của báo giá cũ hiện đủ (Skylight, Mezzanine, Awning, Stable, …) |
| 2D ở cả 3 step | canvas có 11 650 pixel đã vẽ |
| 3D | canvas 670 × 933, viewport khớp |
| `Save & next` không bị gate sai | bật, vì báo giá cũ đã có giá |

### Ghi nhận cho sau: `.sqd` cũ **có** toà nhà

Đọc 3 file `.sqd` thật của desktop:

| File | Định dạng | Revision |
|---|---|---|
| `VGS@@-00001.sqd` | `aes` | 2 |
| `mock-test.sqd` | `json` | 1 |
| `SSA$$-00007.sqd` | `binaryformatter` | 0 — không đọc được, đã có câu từ chối |

Revision AES/JSON có **125 trường**, trong đó `HousePlan` (19 khoá) chứa `BuildingPlan` (Width,
Height, RoofPitch, Bays, WindRegion, TerrainCategory, FootingType, RoofSheeting, EndWalls, …) và
`OptionParts` với 15 nhóm option (`RDoorOptions`, `SkylightOptions`, `MezzamineOptions`, …);
`BuildingParametersData` có Span/Length/Height/RoofPitch; `CustomerData` có 30 trường.

Nghĩa là **import `.sqd` thành báo giá sửa được là khả thi** — **đã làm**, xem §13.8. Bốn file
`.sqd` khác trong `smq-package-smartquote/data` đều là `BinaryFormatter`, nên dữ liệu thật để thử chỉ có
hai file đọc được ở trên và cả hai gần như trống (một cửa sổ, một dòng catalogue).

---

## 13.4 "Lưu quote mới xong, lần sau mở lên sửa không được" — hai lỗi thật (2026-11-06)

Báo cáo từ người vận hành: *"new 1 quote xong > save lại > lần sau mở lên chỉnh sửa tiếp là không
được à?"*. Đường lưu **vẫn hoạt động** — nhưng có hai lỗi làm nó *trông như* không hoạt động.

### 1. Lưu quote mới xong, URL vẫn là `/quotes/new`

`save()` gọi `router.refresh()` mà không đổi địa chỉ. `quoteId` chỉ nằm trong bộ nhớ của store.

Hệ quả: bấm **F5**, hoặc Back, hoặc đóng tab → form trắng tinh, `firstName` rỗng, không nhãn quote
number. Quote đã lưu **có** trong DB (`Saved Q-2026-0012 · rev 1` hiện ra), nhưng màn hình nói
ngược lại. Đây đúng là "lần sau mở lên không được".

**Sửa:** sau lần lưu **đầu tiên** (`quoteId === null`), `router.replace('/quotes/<id>/edit')`.
`replace` chứ không `push` — form trắng không được là đích của Back sau khi quote đã tồn tại, nếu
không Back = "vứt cái vừa lưu".

Đo được: `t0=/quotes/new` → `t1=` `/quotes/6e6e9f3e…/edit` → **F5** → vẫn
`/quotes/6e6e9f3e…/edit`, khách `Url` / `urlfix2@example.com`, nhãn `Q-2026-0014 · revision 1`.
Trước khi sửa: F5 → `url=/quotes/new`, `firstName=""`.

### 2. Nút ở step 1 ghi "Save & next" nhưng chỉ **điều hướng**

Nút đó `onClick={() => goTo('options')}` — không lưu gì. Nhưng nhãn nói "Save", và dòng chữ ngay
cạnh nói *"Saves revision 1 and freezes the price shown on the right."* — vì dòng đó mô tả **gate**
của bước 3, không mô tả nút đang hiện.

Bấm nó, thấy màn hình đổi step, không thấy quote nào trong danh sách → kết luận hợp lý là "lưu không
được". Đây là lỗi nhãn, không phải lỗi lưu.

**Sửa:** nút đổi thành **"Next: the plan"** / **"Next: cost"**, và dòng dưới nút nói đúng việc:
- còn trường thiếu → *"N fields still need attention before the next step."*
- chưa tính giá → *"Calculate the price first."*
- còn lại → *"The quote is saved on the last step — step 3, Cost and price."*

Dòng mô tả việc lưu (gate) giờ chỉ hiện ở **step 3**, nơi nút Save thật sự ở đó.

### Vòng đời đầy đủ, đã kiểm chứng

| Bước | Kết quả |
|---|---|
| New quote → điền đủ → Next → Next | nút đổi nhãn đúng, không còn bẫy |
| Step 3 → **Save quote** | `Saved Q-2026-0014 · rev 1`, URL đổi sang `/quotes/<id>/edit` |
| **F5** | form giữ nguyên, `Q-2026-0014 · revision 1` |
| Mở `/quotes/<id>` → **Edit** | 3 step, khách nạp đúng, nút Save **bật sẵn** |
| Sửa tên → step 3 → **Save revision** | `Saves revision 2 … Revision 1 stays as it was sent` → `Saved · rev 2` |

### Một điều suýt bị báo sai

`document.getElementById('site-deliveryAcknowledged')` trả `null` khi accordion **Delivery** đang
đóng — checkbox không có trong DOM. Việc tick của tôi thất bại âm thầm và tôi suýt kết luận "nút
Save bị khoá oan". Thực ra form đang chờ đúng hai thứ tôi chưa điền: địa chỉ khách và
acknowledgement. **Kiểm tra một phần tử có tồn tại trước khi kết luận rằng một control bị hỏng.**

---

## 13.5 Editor: thanh điều hướng, và cảnh báo mất dữ liệu (2026-11-06)

### Editor không có đường ra

`QuoteEditor` tự dựng layout riêng và **không dùng `ShellFrame`** — rail 232 px của nó ăn mất chỗ
plan. Nhưng "tự dựng chrome" hoá ra là **không có chrome**: mở `/quotes/new` thì không có link nào về
danh sách báo giá, Settings, Team hay đăng xuất. Muốn thoát phải sửa thanh địa chỉ. Đo trong trình
duyệt: `nav a` = `[]`.

**Sửa:** một strip navy mảnh phía trên `StepRail`, lấy link từ **`navFor` của `ShellFrame`** (đã export)
— cùng một danh sách với phần còn lại của workspace, không phải bản sao thứ hai để lệch.

### F5 giữa lúc điền thì mất sạch

Không có `beforeunload` nào trong client. Nay `useUnsavedChangesWarning(dirty)`:

| Đường | Cơ chế | Ghi chú |
|---|---|---|
| F5 / đóng tab | `beforeunload` + `preventDefault` | Chữ của hộp thoại **do trình duyệt** quyết định, không sửa được — giới hạn nền tảng |
| Link nội bộ | capture-phase click listener + `window.confirm` | Next App Router chưa có navigation blocker |
| Trang ngoài | không chặn | `beforeunload` đã lo |
| `mailto:`/`tel:`/`#hash`/`download` | bỏ qua | Không rời trang |
| Link có `data-allow-navigation` | bỏ qua | Để màn hình tự chọn link được thoát |

**Một bug tìm ra ngay khi kiểm chứng:** trang **mới tinh** cũng bị chặn. Nguyên nhân: với báo giá mới
`buildingBaseline = ''`, nên `buildingDirty` luôn `true`. Cảnh báo bắn trên form trống sẽ dạy người
dùng bấm "OK" mà không đọc. Nay baseline của báo giá mới là **toà nhà lúc mở**
(`normaliseShedConfig(template ?? STARTING_BUILDING)`).

Đo lại: sạch → `defaultPrevented: false`; sửa một trường → `true`; bấm Settings khi dirty → hỏi 1 lần,
không điều hướng.

---

## 13.6 Chọn revision cũ, hai luật mồ côi, và dọn đường chết (2026-11-06)

### Revision picker — `?revision=N`

Trang báo giá luôn dùng `items[0]`, nên **không xem được revision cũ**: khách hỏi *"bản rev 1 tôi
nhận hôm trước ghi gì"* thì phải sửa URL bằng tay. Mọi route tài liệu đã nhận `:rev`; chỉ màn hình
thiếu đường vào.

- Mỗi dòng trong bảng Revisions là một link `?revision=N` (cả dòng bấm được, `after:absolute
  inset-0` — số 20 px không phải target).
- `?revision=` không parse được hoặc không tồn tại thì **rơi về bản mới nhất**, không 404: một
  bookmark cũ là chuyện thường, không phải lỗi.
- Khi xem bản cũ: tiêu đề `Revision 1 · <tên>`, pill cảnh báo *"an earlier revision — the quote is
  on 2"* + link về bản hiện tại. Không có dòng này thì header vẫn ghi revision 2 trong khi tài liệu
  là rev 1 — hai con số trên một màn hình, và người ta đọc nhầm giá.
- `DocumentActions` và `FrozenSteelwork` nhận `selected.revision`, nên PDF, plan, elevations, BOM,
  `.vqu`, bảng cắt và punching đều đúng bản đang xem.

Đo được: `?revision=1` → `revisions/1/pdf`, panel khoá thép có mặt, hai pill đúng.

### Hai luật đã viết, có test, **không ai gọi**

| Hàm | Trước | Sau |
|---|---|---|
| `optionsThatNoLongerFit()` | 0 caller | mỗi option báo một issue `options-<id>` |
| `baySpacingMismatch()` | 0 caller | issue `shed-nomBaySpacing` |

Kịch bản thật của cái thứ nhất: đặt mezzanine trong nhà tường 4200, hạ tường xuống 2100.
`normaliseOption` **clamp** slab xuống `height - 300`, nên không có gì vẽ ra ngoài nhà — nhưng kết quả
là một mezzanine **không ai đứng được**, khác hẳn cái đã đặt. Không có thông báo nào, và lưu được.

Cái thứ hai là cảnh báo của desktop *"Total bay length is not equal to overall length"*. Qua UI thì
`reconcileBays` giữ ba trường khớp nhau, nên nó chỉ cháy khi building đến từ template / file nhập /
dòng sửa tay — đúng lúc cần nhất.

Cả hai đều **chặn** chứ không cảnh báo, cùng nguyên tắc với R9: một cảnh báo là thứ người ta bấm qua.

5 test mới trong `apps/client/src/components/editor/__tests__/validation.test.ts` — gồm cả ca
**không** báo khi nhà hợp lệ, để một luật quá tay không lọt.

### Dọn đường chết

| | |
|---|---|
| `GET /admin/price-books/active` | **xoá** — `GET /admin/price-books` đã trả `activeHash` |
| `GET /usage/kinds` | **xoá** — màn hình giữ nhãn tiếng Anh riêng, route chỉ trả id |
| `exportPng()` | **nối** — nút "Save image" trên plan (2D), tải `plan.png` |
| `ADMIN_PORT`/`CLIENT_PORT`/`SITE_PORT` | **xoá** khỏi `.env.example` + `turbo.json` — cổng nằm trong từng `package.json` |
| `PRICE_DUMP` | **xoá** — `publish-book` dùng cờ `--dump` |
| `SINGLE_COMPANY` | **xoá** — tính năng đã bị bỏ từ lâu |

`exportPng` là ví dụ rõ nhất của "handle không ai giữ": hàm có, `useImperativeHandle` có, mà
`PlanView` render `<Render2D />` **không ref** — nên "copy plan as image" của desktop không tồn tại.
Nay `PlanView` giữ ref và có nút; nút chỉ hiện ở 2D vì 3D không có exporter.

---

## 13.7 Ba "loại tài liệu còn thiếu" — đo lại thì chỉ còn **một**, và nó là một dòng giá (2026-11-06)

Tôi từng liệt kê: *"Desktop `EPrintOption` có 13 mục; v2 có 5. Thiếu: Additions, Quotation supply+install,
Install cost breakdown."* **Đọc source thì hai trong ba đã chết trong chính desktop:**

| Mục | Trạng thái thật trong desktop |
|---|---|
| `PRINT_ADDITIONS` | `Enabled = false` — menu item chết (`XModule.cs:396,1383`) |
| `PRINT_INSTALL_COST_BREAKDOWN` | `case` bị **comment out** (`PrintQuoteSetting.cs:75`), khối `PriceController` cũng comment (`:68`) |
| `PRINT_QUOTATION_SUPPLY_INSTALL` | **Sống** — `MainForm.cs:1385` gọi được |

Và mục còn sống **không phải một tài liệu riêng**: cùng một template, chỉ đổi `PriceType` thành
`SUPPLY & INSTALL` hay `SUPPLY KIT ONLY` (`QuotationReportHtml.cs:234-240`), cộng giá có installation.

Nghĩa là port hai mục kia là **phát minh tính năng**, không phải port. Còn phần thật thì v2 **đã** tính
đúng — `contractFromTotal()` cộng `additionsCents` vào contract — nhưng tài liệu **chỉ in một con số**:

```
Contract price   $30,118.63
Includes GST      $2,738.06
```

Khách nhận con số không tự cộng ra được, và người bán phải giải thích qua điện thoại. Nay, **chỉ khi có
additions**:

```
Building, delivered                        $27,380.57
Additions — labour, fees and other items    $4,200.00
Contract price                             $31,580.57
```

Ba dòng cộng đúng đến từng xu vì `beforeAdditionsCents = contract − additions`, **không** tính lại từ
`totalCents` (quote rate làm phép nhân đó không khôi phục được).

**Bốn quyết định:**

1. **`additionsCents` là optional trong `FrozenPrice`**, không phải `0`. Revision cũ không có trường này
   thì in **một** tổng như cũ — in *"Additions $0.00"* lên báo giá cũ là khẳng định về nội dung của nó
   mà không ai ghi lại. `price_json` (`PriceView`) vốn đã có `additionsCents` từ đầu, nên **không cần
   migration**.
2. **Không in `kitCents`.** Đó là trường `cost:margin`-gated, nằm trong khối nội bộ mà desktop chỉ cho
   SuperAdmin xem.
3. **Supplier copy không có gì**: khối giá đã bị bỏ toàn bộ ở đó, nên phần chia cũng đi.
4. **Câu chữ không hứa quá dữ liệu**: chỉ có tổng additions, không có từng dòng — revision không đóng
   băng `additionLines`, nên *"labour, fees and other items"* mô tả đúng cái block đó, không phải liệt kê.

4 test mới trong `printKinds.test.ts`, gồm ca supply-only (không đổi gì) và ca revision cũ (thiếu trường).

---

## 13.8 Mở file `.sqd` cũ thành quote sửa được (2026-11-07)

Trước đây màn hình `quotes/import` chỉ **đọc và báo cáo**. Nay nó dựng toà nhà trong file thành một
building của v2, đưa sang editor, và **engine tính lại giá** — đúng yêu cầu *"file quote cũ cũng có
thể mở ra chỉnh sửa được, mở ra là 3 step, có load được 2D/3D"*.

### Đường đi

```
.sqd (bytes) ─ readQuoteFileBytes ─► RawRevision
                 │
                 ├─ readNewestLegacyPlan   (packages/core/src/lib/quoteFile/legacyPlan.ts)
                 │     → { config, carried[], dropped[], assumed[], customer, site, claimed }
                 ├─ POST /quotes/import/sqd  trả `building` trong envelope (không ghi gì)
                 └─ UI: "Open in the editor" → /quotes/new#template=<config>&customer=<…>
                        → editor applyConfig + load draft + tự động price
```

**Không có endpoint tạo quote mới.** Toà nhà đi qua **fragment** (không tới server, không vào log
proxy — cùng lý do template link đã dùng), editor tính giá, rồi người dùng bấm Save như mọi quote
khác. Nhờ vậy `engine_version` và `price_book_hash` của revision luôn mô tả một phép tính **đã xảy ra**.

### Cái bẫy lớn nhất: hai app xoay plan 90°

| | Desktop (`.sqd`) | v2 |
|---|---|---|
| Trục chạy theo **length** | `X` (bays trái→phải) | `y` |
| Trục chạy theo **span** | `Y` | `x` |
| Tường dài | `FrontWall`/`RearWall` (`MSideWall`) | `left`/`right` |
| Tường đầu hồi | `EndWalls[]` (`IsLeft`) | `front`/`back` |

Nên map **theo hình học, không theo tên**: `left`/`right` dài `length`, `front`/`back` dài `span`.
Đầu nào của plan cũ thành `front` **không suy ra được từ file** (file không lưu toạ độ tuyệt đối cho
tường đầu) → bảng `SIDE_WALL`/`END_WALL` là **quy ước**, và nó được ghi vào `assumed` để người dùng
kiểm tra plan có bị lật không.

Vị trí lỗ mở: `RelativeLocation.X` là **mép trái tính từ đầu bay** (`RLDoorAddToSWallCmd` so với
`bay2D.Width`), `Y` là cao độ bệ. Nên `align='custom'`, `offset = bayStart + X`, và phân biệt bay-local
với absolute bằng `X <= bayWidth` (một giá trị tuyệt đối ở bay thứ 2+ luôn lớn hơn bề rộng một bay).

### Cái gì qua, cái gì không

Qua: shell (span/height/bays/length/nomBaySpacing/pitch/structure), điều kiện site (wind region, terrain,
importance, shielding, state), sheeting/downpipe/footing, cờ tường mở, **12 màu** (ưu tiên tên trong
sách giá hơn hex của file, vì flashing/screw tính giá theo màu), `MiscOptions` → `misc_option` theo
`option_name` của sách, và **4 loại cửa** (roller/PA/sliding/window) trên mọi tường.

Không qua — và **hiện lên màn hình kèm số lượng**: skylight, mezzanine, awning, stable, outrigger, carry
beam, track, dividing wall, cantilever, infill column, `EmptyOptions`. Mỗi thứ là hình học riêng trên
plan cũ; convert mà không có bản vẽ để đối chiếu là đặt sai chỗ rồi báo giá. Im lặng bỏ qua thì thành
"báo giá thiếu skylight" — lỗi tệ nhất vì trông vẫn đúng.

`ContractPrice` **không bao giờ được dùng**. Nó chỉ được trả về trong `claimed` để màn hình đặt cạnh
con số mới.

### Ba lỗi mà việc này làm lộ ra

1. **`URLSearchParams` ghi space thành `+`**, mà `decodeURIComponent` không đổi `+` lại. Địa chỉ
   `222 Margaret St` về form thành `222+Margaret+St`. Sửa ở `fragment.ts` (thay `+`→space trước khi
   decode). Chỉ test đặt space vào field mới thấy.
2. **Draft store là singleton cấp module.** Đi từ một quote đã lưu sang `/quotes/new` bằng điều hướng
   client giữ nguyên `quoteId` + `expectedRev` → lần Save tiếp theo sẽ **ghi revision vào quote cũ**.
   Nay nhánh quote mới gọi `load(NEW_DRAFT)` trước mọi thứ.
3. **`<select>` hiện option đầu khi value không có trong danh sách.** File cũ ghi `0.35 TL-5`, sách giá
   niêm yết `TL-5` → màn hình hiện "Corro" trong khi config là `0.35 TL-5`, và `.vqu` xuất ra chuỗi thật
   ⇒ màn hình nói dối về chính quote đó. Nay `SelectField` thêm một `<option>` cho giá trị lạ.

### Đo được

`mock-test.sqd` (6000 × 15000, 4 bay 3750, 1 cửa sổ 589×790 ở bay 0, 1 dòng `Eng - Form 15 (QLD)`)
mở ở `/quotes/new`:

- 3 step, `Details` đang mở; `Span 6000 / height 3000 / length 15000 / 4 bays @ 3750 / pitch 7.5°`;
- `End wall, right` đã tick (từ `EndWalls[1].IsOpen`);
- khách **TBA / 123@gmail.com / 222 Margaret St, Brisbane City QLD 4000** — space giải mã đúng;
- màu: Deep Ocean toàn bộ, downpipe Manor Red (đúng file);
- plan: `Plan of a 6000 by 15000 millimetre shed with 1 openings and 1 options`;
- **3D: canvas 535 × 608 CSS, WebGL2 context sống** (sau khi bấm 3D, nút "Save image" biến mất — đúng
  thiết kế: 3D không có exporter);
- giá **$30,119.92** do engine mới tính, file ghi $30,118.63.

Kiểm bằng API thật qua cổng same-origin của browser: `POST /api/sq/quotes/import/sqd` → 200, `building`
có `carried/dropped/assumed` như trên.

### Giới hạn phải nói

- **8/9 file `.sqd` trong dữ liệu mẫu là `BinaryFormatter`** → vẫn bị từ chối kèm giải thích. Convert
  chúng cần một tool .NET, không phải việc của Node.
- Hai file đọc được gần như trống, nên phần map **cửa và option chỉ được kiểm bằng fixture dựng theo
  entity**, không bằng file thật nhiều cửa.
- Bảng tường (§ trên) là **quy ước**. Nếu plan bị lật, kéo cửa sang đầu kia — giá không đổi với cùng
  loại tường, nhưng bản vẽ phải khớp bản đã gửi khách.

Test: 25 ca trong `legacyPlan.test.ts`, 6 ca màn hình `QuoteFileImport.test.tsx`, 11 ca `fragment.test.ts`,
4 ca route `quoteFileRoute.test.ts`, và 1 ca giá end-to-end trong `pricing.test.ts` (building convert
được **định giá được** bằng sách thật, có dòng roller door + window, 0 dòng `mocked`).

---

## 13.9 Freight từ delivery scope, và màu trên tài liệu (2026-11-07)

Hai việc còn lại của parity, cộng hai lỗi mà việc đầu tiên làm lộ ra.

### 1. Chọn delivery scope trước đây không có tác dụng gì

Sách giá có 7 scope giao hàng (`delivery_data`) kèm số tiền, và **hai scope trong đó ghi `0`** vì
desktop không đọc số của chúng — nó tính:

```
candidate = round50( jobValue × (1 + quoteRate%) × percent / 100 )
delivery  = max( minimumDollars, candidate )        Quotation.cs:2183–2222
```

v2 có `deliveryCents` **gõ tay** và `site.deliveryScope` **không ai đọc**: chọn "Delivered to site
301–400 km" (sách ghi $650) không đổi gì. Nay:

- scope thường → chọn là điền đúng số của sách (có xét `state_value_array` theo bang);
- hai scope min-fee → **không** điền (số của chúng là % của job, mà bước 1 không biết giá), nhưng
  select nói rõ *"freight for this scope is the minimum agreed with your distributor — it is set on
  the Cost step"*, và bước Cost hiện mức tối thiểu kèm cảnh báo khi số gõ vào thấp hơn.

`packages/core/src/domain/delivery.ts` (không phải `lib/pricing/` — xem mục 4). Bốn con số min fee là
**settings của công ty** (`minimumFees`, mặc định 0 = chưa thoả thuận), sửa ở Settings → *Freight
minimums*.

**Một khác biệt có chủ ý với desktop:** công thức của nó nhân cả base — gồm engineering và extra
charges — với `1.1`, tức là **cộng GST lần nữa** lên những khoản mà `price.ts` đã chứng minh (bằng
một file quote thật) là được lưu **đã gồm GST**. Bản v2 lấy base = giá trị job đã gồm GST
(`total − delivery`) và không cộng thêm. Ghi ở `KNOWN-DEVIATIONS.md` row 26.

### 2. Tài liệu khách in đủ màu của toà nhà đó

Trước: một dòng `Walls …, roof …, trim …, doors …` — gộp 10 role thành 4. Desktop in **10 tên màu**
riêng (`QuotationReportHtml.cs:260`). Nay `CustomerDocument.building.colourRows` là danh sách
`{ label, colour }` theo đúng thứ tự editor, và **chỉ những bề mặt toà nhà thực có**: 5 bề mặt luôn có,
cộng mỗi loại cửa **đang có**, cộng dividing wall nếu có đặt. Desktop in cả 10 kể cả cửa không tồn tại
— một dòng về cánh cửa khách không mua.

### 3. Hai lỗi phát hiện khi kiểm

1. **Nút Save ở Settings luôn trả 422.** Form gửi lại nguyên object server trả (`version` nằm trong
   đó), schema là `.strict()` → *"Unrecognized key: version"* với path `(root)`, nên màn hình báo lỗi
   và **không tô đỏ field nào**. Không lưu được settings nào cả. Sửa: bỏ `version` khỏi patch.
2. **Mở một quote đã lưu bị coi là "có thay đổi"** → cảnh báo mất dữ liệu bật khi rời trang dù chưa
   sửa gì. Hai nguyên nhân, cả hai đã sửa:
   - `buildingBaseline` lưu `JSON.stringify(initial.config)` **thô**, còn store giữ bản đã
     `normaliseShedConfig` → hai biểu diễn khác nhau. Nay baseline cũng normalise.
   - `CostPanel` tự điền đơn giá lao động từ bảng rate khi mount, kể cả trên quote đã lưu → ghi vào
     `pricing` → fingerprint lệch baseline. Nay chỉ điền khi `quoteId === null` (quote mới).

   Để kiểm được từ ngoài, editor giờ có `data-dirty` và `data-dirty-building` trên phần tử gốc: cờ
   này chính là thứ guard sẽ dùng. Đo được: mở quote chưa sửa → `false/false`, rời trang **không**
   hỏi; sửa một field → hỏi.

### 4. `delivery.ts` phải nằm ở `domain/`, không phải `lib/pricing/`

Đặt nó trong `lib/pricing` làm **sập cả client**: barrel `@sq/core/pricing` re-export `publish.ts` và
`sqliteRuntime.ts` (dùng `node:fs`/`crypto`), nên mọi client component import từ đó kéo `fs` vào bundle
trình duyệt → *"Can't resolve 'fs'"*, cả app trả 500. `domain/` là tầng cả server và browser đều import
được; `import type { DeliveryScope }` từ pricing là type-only nên bị xoá khi build.

Bài học: **một hàm thuần nằm trong barrel server-only là một cái bẫy cho client.** Nếu lần sau cần
dùng chung, đặt ở `domain/` ngay từ đầu.

### Đo trong trình duyệt

| Việc | Kết quả |
|---|---|
| Settings → *Freight minimums*, đặt 300 / 10% | lưu được; `GET /settings/rates` trả `distributorDollarCents: 30000, distributorPercent: 10` |
| Chọn *Delivered to site 301-400 km* | bước Cost: **Delivery = $650.00** (số của sách) |
| Chọn *Delivered to Distributor* | bước 1 hiện câu chỉ sang Cost; Cost hiện **"minimum of $3,100.00. At $650.00 the company pays the difference."** (`role="alert"`) |
| Tài liệu khách | `Colours` in `Walls, Roof, Barge and fascia, Downpipes, Gutters` + `Windows`, `Roller doors` — không có `Sliding doors` vì nhà đó không có |
| Mở quote đã lưu rồi rời trang | **không** cảnh báo (`data-dirty=false`); sửa rồi rời → cảnh báo |

Sau khi đo, cấu hình demo được trả về 0 như lúc đầu — không để lại số bịa trên công ty mẫu.

### 13.10 Smoke Playwright — vì unit test không nhìn thấy ba lỗi đó

Ngày 2026-11-07 ba lỗi đã ship trong khi **988 + 256 + 50 test vẫn xanh**: Save Settings trả 422 vì
client gửi lại `version`; quote vừa mở bị coi là dirty; `@sq/core/pricing` kéo `node:fs` vào bundle
làm sập cả client. Cả ba chỉ hiện khi **bấm**, và cả ba lọt qua test render một component với
dependency mock. Nên có `e2e/` — 7 test, 18 giây.

```
pnpm dev          # client 3061 + API 3060
pnpm test:e2e
```

**Chạy trên app thật**, không mock: trình duyệt → bridge same-origin → API → Postgres. Dùng
`channel: 'chrome'` (Chrome có sẵn, cùng binary PDF renderer cần) nên **không cần `playwright install`**
và chạy được offline.

| # | Luồng | Bắt được lỗi gì |
|---|---|---|
| setup | đăng nhập bằng company code + username + password, lưu session | 3 field đúng thứ tự; **403 "hết seat" phải báo là hết seat**, không phải sai mật khẩu |
| 1 | tạo quote → thấy giá → tick delivery acknowledgement → 2 bước → **Save** | URL phải đổi sang `/quotes/<id>/edit` (lỗi 2026-11-06: lưu xong URL vẫn `/quotes/new`); nút step 1–2 là **điều hướng**, không phải lưu |
| 2 | mở lại quote: khách còn đó, 3 step, plan vẽ, `data-dirty=false` | lỗi "mở quote ra là mất dữ liệu" và lỗi dirty giả |
| 3 | Settings → đặt minimum → Save → `Saved as version N` (rồi trả về 0) | lỗi 422 `Unrecognized key: version` |
| 4 | hộp Send: 4 mode, To đã điền, chọn engineering → POST bị **chặn** rồi đọc body | không gửi mail thật, nhưng chứng minh `mode` đi đúng |
| 5 | quote chưa sửa rời trang **không** hỏi; sửa rồi rời **phải** hỏi | cảnh báo mất dữ liệu — cả hai chiều |

**Một session cho cả suite.** Seat gắn với *session*, không với người: mỗi test một context là mỗi
test một seat, 6 test ăn 6/5 seat và suite tự chặn chính nó ở lần chạy thứ hai — đã xảy ra thật. Nên
`setup` đăng nhập một lần, lưu cookie vào `e2e/.auth/state.json` (git-ignored), mọi test dùng lại, và
`teardown` **đăng xuất** ở cuối. Đo sau 2 lần chạy liên tiếp: `tenant_seats` = 0, session sống = 0.

Suite **có ghi** vào DB dev: mỗi lần chạy thêm một quote "E2E Smoke" và một version settings. Đó là
chủ ý — smoke mà không ghi được gì thì không chứng minh được save.

---

## 13.11 UI/UX pass — đo trước, sửa sau (2026-11-08)

Rà soát bằng cách đo trong trang (Playwright + `evaluate`) trên 5 màn × 4 bề rộng. Tương phản tính
từ `getComputedStyle` thật rồi blend nền trong suốt lên nền cha, không dựa vào bảng màu giả định.

### Cái đã đúng, ghi lại để không "sửa" hỏng

- **Tương phản 0 lỗi** ở mọi màn, mọi bề rộng. Đo các cặp: `ink/surface` 17.85, `muted/surface` 7.58,
  `gold on navy` 11.83, `danger` 6.47, `attention` 5.02, `ok` 5.02. Cặp duy nhất fail là
  `ink-muted on brand` (2.34) và **nó không được dùng ở đâu**.
- **Target**: toàn app `min-h-11` (44px), cao hơn ngưỡng WCAG web 24px. Vật thể <24px duy nhất là 6
  checkbox 16×16 **nằm trong `<label>` 36px** → thuộc ngoại lệ, không phải lỗi.
- **Focus**: `:focus-visible` toàn cục + biến thể gold trên navy; 11 chỗ `outline-none` đều nằm trong
  wrapper có `focus-within:ring-2`.
- **Error summary** đúng chuẩn (role, aria-labelledby, `tabIndex=-1` + focus, mỗi lỗi là một nút nhảy
  tới field, lỗi inline vẫn còn).

### P1 — khối giá không nhìn thấy được ở 1024–1279px và trên điện thoại

Giá là **con thứ ba** của grid, mà grid chỉ khai 2 cột dưới `xl` → nó rớt xuống đáy trang:

| Bề rộng | Cột | `top` khối giá | Thấy mà không cuộn? | Trang cao |
|---|---|---|---|---|
| 1440 | 3 | 110 | ✅ | 5 092 |
| 1280 | 3 | 110 | ✅ | 5 092 |
| **1279** | 2 | **5 092** | ❌ | 6 515 |
| 1024 | 2 | 5 092 | ❌ | 6 515 |
| **390** | 1 | **5 996** | ❌ | 7 528 |

Trên laptop 1280×800 — loại phổ biến nhất — người bán **không thấy giá** trong lúc điền form. Và header
của module đã **khẳng định** có "sticky summary at the top" từ lúc viết màn hình này; chưa từng có.

**Sửa:** `PriceSummary` — một dòng, `sticky top-0`, chỉ render dưới `xl`. Nội dung: số contract,
pill "out of date", và nút sang bước Cost. **Không** có deposit/progress/additions: chúng cần một đoạn
văn mỗi cái, và một summary phình thành panel thứ hai thì đã hết là summary.

Hai chi tiết phải xử lý mới đúng:

1. **`sticky top-0` đặt ngoài grid**, không phải trong một ô — grid là một hàng theo số cột, chiều cao
   do form quyết định, nên sticky con bên trong bị nhốt trong ô của nó.
2. **Offset của plan phải đổi.** Dải giá cao 61px; plan cũng `sticky` ở `top: 12px` nên **slide xuống
   dưới dải** và mất 49px trên cùng — đúng hàng dimension. Nay `lg:top-[4.5rem]` (dưới `xl`) và trả về
   `sq-3` ở `xl`. Đo sau khi sửa: dải `bottom` 61, plan `top` 72 → không chồng.

`stages` giờ tính **một lần** trong `QuoteEditor` và truyền cho cả hai chỗ, thay vì `deriveStages` gọi
hai lần — hai chỗ đọc cùng một con số là điều panel's doc đã cảnh báo.

### P2 — bảng Revisions đẩy cả trang sang ngang trên điện thoại

`scrollWidth − clientWidth = 154px` ở 390px: bảng 7 cột rộng 512px, **không có wrapper**, trong khi
bảng danh sách quote đã có `overflow-x-auto` từ trước. Nay có wrapper → 0. Quét lại toàn bộ 5 màn ở
390 và 768: **tất cả 0**.

### Còn lại (chưa làm)

`P3` danh sách quote: 24 dòng, chip chỉ `All / draft / accepted`, **5 dòng `deleted` chỉ hiện ở All**,
không có ô tìm kiếm · `P4` bước 1 trên điện thoại: 41 field, 7 528px, chỉ 1 nhóm đóng · `P5` link
breadcrumb cao 14–15px (dưới 24px, không thuộc ngoại lệ) · `P6` slider roof pitch thumb 8px; smoke
suite để lại quote "E2E Smoke" mỗi lần chạy.

### Test giữ cho nó không tái diễn

`e2e/layout.spec.ts` — 3 ca, mỗi ca phát biểu **chính con số đã đo** làm điều kiện pass, để lần hồi quy
báo ra số:

1. giá phải nằm trong viewport **không cần cuộn** ở 1440 / 1279 / 768 / 390;
2. sau khi cuộn 1 500px ở 1279, `plan.top >= strip.bottom` — không chồng;
3. không trang nào cuộn ngang ở 390 và 768, kể cả trang chi tiết quote (bảng rộng nhất).

---

## 13.12 UI/UX pass, phần hai — nav mobile, danh sách, breadcrumb, màu (2026-11-08)

### Nav mobile: một icon thay vì một hàng link

Trước: dưới `lg`, cả hai chrome đều trải link thành hàng. Ở 390px đó là **264px link + 79px sign-out**
chiếm trọn hàng đầu của **mọi** trang, và tự cuộn ngang khi không vừa — trên đúng hai màn cần bề rộng
nhất (danh sách quote và bản vẽ).

Nay: `WorkspaceMenu` — một nút 44×44 có `aria-expanded`, panel mở ra chứa link + tên công ty + account.
Dùng chung cho `ShellFrame` (workspace) và editor, nên hai chrome không thể lệch nhau về hành vi mobile.

Ba chi tiết phải đúng mới không tạo lỗi mới:

1. **Panel neo vào thanh bar, không neo vào nút.** Neo vào nút thì nó bắt đầu ở x=141 và kết thúc ở 397
   trên màn 390 → **tràn 13px**. Neo vào bar (left/right 0) thì luôn vừa.
2. **Nhãn `Workspace menu`, không phải `Workspace`.** Editor cũng render một hàng desktop tên
   `Workspace`; hai landmark cùng tên là tài liệu mà screen reader đọc hai lần không phân biệt được —
   và nó làm một test không chọn được cái nào.
3. **Disclosure, không phải dialog.** Bốn cái link không đáng một modal với overlay, scroll lock và
   focus trap. Disclosure: link là `<a>` thật (chạy không cần JS), Escape đóng và **trả focus về nút**,
   bấm ra ngoài đóng, và `usePathname` đóng khi điều hướng.

Đo: 390px → nút 44×44, panel `left 0 / right 375`, **tràn 0**, Escape đóng + focus về nút. Desktop
1440px → nút **ẩn**, rail 232px giữ nguyên như cũ.

### Danh sách quote: `All` không còn tính quote đã xoá

Đây là **lỗi số tiền**, không phải thẩm mỹ. Đo trên công ty demo (2026-11-08):

| | Số dòng | Contract |
|---|---|---|
| Có cả quote đã xoá (trước) | 27 | **$747,970.42** |
| Chỉ quote còn dùng (sau) | 22 | **$621,113.57** |
| Chênh = 5 quote `deleted` | 5 | $126,856.85 |

"On the books" đang cộng $126k của những quote đã bị xoá khỏi lưu thông, và "Open" đếm cả draft đã
xoá. Nay strip, caption và chip `All` đều đếm **cùng một tập**, và chip `Deleted N` chỉ hiện khi có.

Thêm **ô tìm kiếm** lọc theo số quote / khách / suburb, đặt cuối hàng chip. Lọc tại client vì danh sách
đã fetch trọn (≤50 dòng): một vòng request là cùng đáp án nhưng chậm hơn và lỗi thời ngay khi tab khác
lưu.

### Breadcrumb: 14px → 44px

Cùng một block 5 dòng được copy vào **6 trang** — nên cả 6 cùng dính một lỗi: link cao **14–15px**.
WCAG 2.5.8 cần 24 CSS px, và ngoại lệ inline **không** áp dụng (đây không phải link trong câu, đây là
đường duy nhất lên một cấp). Nay `Breadcrumb` là một component: `min-h-11` cộng `-ml-sq-2 px-sq-2` để
target 44px mà chữ không xê dịch.

### Form mobile: Colours từ 1.992px xuống 652px

P4 ban đầu tôi đề xuất "collapse các nhóm trên mobile". Đo lại thì **thủ phạm không phải số field** mà
là một khối:

| Nhóm | Cao | % trang |
|---|---|---|
| Quote & client | 703 | 9% |
| Design | 911 | 12% |
| Shed | 672 | 9% |
| **Colours** | **1.992** | **26%** |

10 fieldset, mỗi cái một palette 30 swatch cao 160px. Nay mỗi vai trò là **một hàng** 44px (swatch 32px
+ tên màu + tên vai trò), bấm mới mở palette của vai trò đó, chọn xong tự đóng.

Trang bước 1 trên điện thoại: **7.722px → 6.142px** (−20%). Palette vẫn là grid swatch — chỉ *độ hiện*
thay đổi, không phải cách chọn.

### Slider roof pitch: 8px → 44px

`h-2` → `min-h-11 py-sq-2`, track vẫn 8px nhưng hộp bấm 44px. `range` là control duy nhất mà điều này
thực sự quan trọng trên điện thoại.

### Rác test

Smoke suite trước đây để lại một quote mỗi lần chạy: tới 2026-11-08 danh sách công ty demo có **13 dòng
`E2E Smoke`** lẫn giữa quote thật, và "On the books" cộng cả tiền của chúng. Teardown nay **xoá mềm**
chúng qua API (đúng cách app làm — revision giữ bằng chứng đã gửi đi), chỉ khớp tên khách `E2E` nên
không bao giờ chạm quote thật. Đo: lần chạy đầu dọn 13, lần sau dọn **1**.

### Test giữ cho không tái diễn

`e2e/layout.spec.ts` thêm 2 ca: menu mobile (nút ≥24px, panel không tràn, Escape trả focus) và breadcrumb
(≥24px trên 5 trang). Tổng e2e: **12 ca, 53 giây**.

---

## 13.13 Danh sách quote thành card trên điện thoại (2026-11-08)

Bảng 6 cột trên màn 390px là một cuộn ngang với hai cột nhìn thấy một lúc: người bán **không thấy
khách và giá cùng lúc**, mà đó là phép so sánh duy nhất màn hình này tồn tại để làm. Skill trả đúng
rule này (`Table Handling` → *"Use horizontal scroll or card layout"*).

Nay dưới `sm` (640px) là **danh sách card**, từ `sm` trở lên vẫn là bảng. Cùng dữ liệu, cùng link,
cùng state filter — bảng không bị thay mà là thứ bề rộng cho phép.

Mỗi card, theo thứ tự thị giác:

```
│▌ Q-2026-0032                              draft
│  E2E Smoke
│  Dandenong South
│  ─────────────────────────────────────────────
│  rev 1 · 07 Nov 2026              $30,119.92
```

- **spine 3px** màu theo trạng thái, cùng hàm `spineFor` bảng dùng — nên hai hình thức không thể lệch;
- tên khách là thứ lớn nhất, vì đó là cách người ta tìm;
- số quote nhỏ, trên cùng, vì đó là thứ người ta **đối chiếu**, không phải thứ người ta tìm;
- giá ở đáy phải, kèm `rev` và ngày ở đáy trái — một dòng so sánh, không phải hai;
- cả card là một `<a>`, target **118px**, so với 48px của một hàng bảng.

Đo: 11 card, card đầu **318 × 118**, `overflowX = 0`, trang 2 034px (bảng cũ cùng dữ liệu cao hơn vì
mỗi hàng 48px cộng header). Desktop 1440: bảng 11 hàng, card `display:none`. Tablet 768: vẫn bảng.

### Ba lỗi test mà việc này làm lộ ra — và một lỗi thật

1. **`getByRole('row')` không còn tồn tại ở 390px.** Layout suite và ba flow smoke dùng nó để mở một
   quote. Nay cả hai hình thức đều là link tới `/quotes/<id>`, nên locator là **accessible name**
   (`/for E2E/`, `/^Open Q-\d{4}/`) — bền với cả bảng và card, và không phụ thuộc role nào.
2. **`.filter({ hasText })` không khớp link trong bảng.** Link của hàng chỉ có text `Open quote`
   (sr-only); tên khách nằm trong `aria-label`. Đây là lý do phải dùng accessible name chứ không text.
3. **Cả hai hình thức nằm trong DOM**, cái kia chỉ `hidden` → `.first()` trúng bản ẩn và click chờ
   60s. Sửa bằng `:visible` trước khi chuyển hẳn sang accessible name.

Và lỗi thật: **quote test tích lại thành rác.** Teardown cũ xoá mềm một quote mỗi lần chạy, nhưng
revision **không thể xoá** (trigger append-only từ chối, đúng thiết kế) — nên mỗi lần chạy để lại một
dòng `deleted`. Tới hôm nay công ty demo có **21 quote `E2E Smoke` đã xoá**, hiện trong chip Deleted và
đủ để làm sai các con số trên danh sách. Nay smoke **dùng lại một quote** (tìm hoặc tạo một lần), nên
database kết thúc mỗi lần chạy đúng như lúc bắt đầu, và không cần đường xoá nào cho thứ sản phẩm cố ý
giữ lại.

**21 dòng cũ vẫn còn** — tôi **không** xoá cứng chúng: FK là cascade nhưng trigger `refuse_delete`
chặn, và `DELETE FROM quotes` bằng tay là phá đúng cái rule sản phẩm đặt ra. Chúng nằm trong chip
`Deleted` và không còn ảnh hưởng con số nào. Nếu muốn dọn sạch thì đó là một quyết định riêng của bạn.

Một chi tiết nữa: flow 1 giờ mở lại quote cũ, mà mở lại thì **chưa có thay đổi** — nên nút Save bị
disable, và đó là sản phẩm đúng (lưu một revision y hệt là nhân bản vô nghĩa). Flow đổi số điện thoại
với một stamp theo thời gian: `fill` cùng giá trị đã có thì fingerprint không đổi và cổng vẫn đóng —
đó là lần chạy đầu tiên đã chứng minh.

---

## 13.14 Deleted mặc định ẩn; và một lỗi giá nghiêm trọng trong luồng import (2026-11-08)

### Deleted ẩn mặc định, có công tắc

Trước: chip `Deleted 21` luôn hiện. Quote đã xoá là **hồ sơ**, không phải việc — một chip thường trực
nhắc tới thứ hầu hết công ty không bao giờ làm. Nay:

- mặc định **không** render chip `deleted` chút nào;
- một checkbox **Show deleted (21)** ở cuối hàng chip — bật thì hiện chip **và** chuyển sang nó luôn
  ("cho tôi xem cái đã xoá" là lý do duy nhất để bấm), tắt thì về danh sách đang dùng;
- không render công tắc khi không có quote nào bị xoá.

State trong component, **không** `localStorage`: một tuỳ chọn lưu lại sẽ để lựa chọn của người này
trước mặt người dùng máy kế tiếp, và đây không phải tuỳ chọn về dữ liệu.

`effectiveFilter` xử lý ca tắt công tắc trong khi đang xem Deleted — nếu không, filter trỏ vào tập
không render, ra bảng rỗng dưới một chip không thấy được, đọc thành "không có quote nào".

### Lỗi thật: mở quote từ template/import thì giá của **toà nhà sai**

Đăng ký e2e cho luồng nhập `.sqd` → phát hiện nút Save bị disable với câu *"Calculate the price again
before saving"* **dù chưa sửa gì**. Đo theo thời gian: giá stale từ 300ms sau khi mở, `dirty=false`,
`data-dirty-building=false`. Thu hẹp: xảy ra với `/quotes/new#template=…`, **không** xảy ra với
`/quotes/new` trơn.

Nguyên nhân — hai quyết định đúng tương tác thành lỗi:

1. `applyConfig` **normalise** config đến từ fragment;
2. effect tự-tính-giá chạy trong **cùng commit** với `applyConfig`, và callback `calculate` đóng gói
   `config` của **render trước** — tức toà nhà mặc định.

Nên nó định giá toà nhà mặc định: một con số thật, cho một toà nhà **không có trên màn hình**. Rồi
fingerprint (tính từ config đã normalise) không khớp, và màn hình báo "out of date" cho một trạng thái
chưa từng tồn tại.

**Đo được mức độ:** cùng file `mock-test.sqd`,
- giá của toà nhà **mặc định** (144 × 240 m... không, 12 000 × 24 000 mặc định): **$30,119.92**;
- giá của toà nhà **trong file** (6 000 × 15 000, 4 bay 3 750, mái 7.5°): **$12,469.03**.

Nghĩa là trước khi sửa, mở một quote cũ hiện **giá của một toà nhà hoàn toàn khác**, và vì stale nên
không lưu được — nên nó chưa bao giờ bị đóng băng. Nhưng người dùng đọc con số đó.

**Sửa:** `calculate` đọc `useShedStore.getState().config` và `useDraftStore.getState().pricing` **tại
thời điểm gọi**, không dùng closure — cùng nguyên tắc đường lưu đã theo: thứ được đóng băng là thứ có
mặt khi request được gửi.

### `e2e/legacyImport.spec.ts` — 4 ca, dùng file thật

Playwright điều khiển được `<input type="file">`, thứ IAB browser **không** làm được — nên lần kiểm
trước của tính năng này phải bỏ qua picker và POST thẳng vào API. Nay dùng `setInputFiles` thật, trên
3 định dạng có thật:

| file | dạng | vì sao |
|---|---|---|
| `mock-test.sqd` | JSON plaintext | 1 cửa sổ, 4 bay — dạng desktop ghi hôm nay |
| `template-files/2/1.sqd` | AES-256-CBC | chứng minh key cũ vẫn giải mã trong app **đang chạy** |
| (cùng file) | | 24 000 mm / 6 bay, khác fixture trên → báo cáo không thể "trông có vẻ đúng" |

Hai file nằm trong **repo legacy bên cạnh**, không phải repo này. Test **skip và nói rõ tên file** khi
không có, để một clone thiếu chúng báo skip chứ không phải tick xanh trên đường chưa kiểm.

Bốn ca: đọc + báo cáo + mở; sửa được cả 3 step; file AES giải mã được; **lưu rồi mở lại vẫn đúng toà
nhà** (6000 × 15000 × 4 bay, cửa sổ vẫn trên plan).

---

## 13.15 Danh sách nói sai tên khách sau khi báo giá lại (2026-11-08)

Mở `Q-2026-0037` từ danh sách thì thấy: danh sách ghi **"E2E Legacy"**, trang chi tiết và editor ghi
**"E2E Smoke"**. Cùng một quote, hai câu trả lời cho "báo giá này của ai".

Nguyên nhân: **hai nguồn khác nhau**.

| Nơi đọc | Nguồn |
|---|---|
| Trang chi tiết, editor | `quote_revisions.customer_json` — **đóng băng** theo revision |
| Danh sách quote | `quotes.customer_id` → join `customers` — **cột header** |

`customer_id` chỉ được ghi khi **tạo** quote, và không bao giờ cập nhật lại. Nên một quote báo giá lại
cho người khác sẽ có revision 2 mang khách mới (đúng), trong khi header vẫn trỏ khách của revision 1
(sai) — và cột `contract_cents`, `site_json` **bên cạnh nó thì vẫn được cập nhật**, nên header là thứ
duy nhất bị bỏ lại phía sau.

**Sửa:** thêm `customer_id = ?` vào câu `UPDATE` khi append revision — header mô tả revision hiện tại,
cùng quy tắc với hai cột kia.

Test `quoteHeaderCustomer.test.ts` đi qua **route thật** với sách giá thật (publish dump), và tôi đã
kiểm nó **thật sự bắt bug**: revert fix → đỏ với `Expected "New Person", Received "Old Name"`; khôi
phục → xanh. Một test không đỏ khi bug quay lại thì không phải test.

**Dữ liệu cũ**: hai dòng trong DB dev (Q-2026-0036, Q-2026-0037) đã được sửa một lần bằng script đọc
`customer_json` của revision mới nhất rồi trỏ `customer_id` sang đúng — đo trước/sau: cả hai
`E2E Legacy → E2E Smoke`. Script chỉ chạm các dòng **lệch**, không đụng dòng đúng.

### Đã kiểm bằng tay trong trình duyệt (theo yêu cầu)

Mở `Q-2026-0037` từ `/quotes` → trang chi tiết → **Edit**:

| | Kết quả |
|---|---|
| 3 step | `Details` → `Options on the plan` → `Cost and price`, cả ba bấm được |
| Nhãn | `Q-2026-0037 · revision 2` |
| Khách | E2E Smoke / e2e.smoke@example.com |
| Toà nhà | span 6000, length 15000, height 3000, 4 bays, pitch 7.5° — đúng file `.sqd` |
| Giá | **$13,326.29** (GST $1,211.48, 3410 kg), **không** stale |
| Plan 2D | canvas 800 × 600 |
| 3D | canvas 670 × 839, **WebGL2 sống** |
| Save | `Save revision` — **disabled**, đúng: chưa sửa gì thì không có gì để đóng băng |
| `data-dirty` | `false` khi mở, `true` sau khi sửa |

---

## 13.16 `/dashboard` — trang đếm lượt dùng, và tài liệu pipeline giá (2026-11-09)

Yêu cầu: *"mục tiêu đếm có bao nhiêu lượt truy cập, từ API nào, để tôi xem có người xài không"*, và
*"bổ sung docs về flowchart + công thức + 5 nguồn dữ liệu"*. Cả hai xong.

### Cửa riêng, không dùng session sản phẩm

`/dashboard` là trang của **người vận hành** — người có thể **không thuộc công ty nào**. Cho anh ta một
dòng `users` + role để xem một trang sẽ đặt anh ta vào danh sách mà khách hàng quản trị được. Nên:

- mật khẩu **một cái**, trong `VENDOR_DASHBOARD_PASSWORD`, ở **cả hai** process;
- trình duyệt **không giữ** mật khẩu: nó giữ cookie `sq_vendor` do client ký;
- cookie ký bằng **scrypt(password)** → **đổi mật khẩu là mọi cookie cũ chết theo**, không cần secret
  thứ hai để rotate;
- API nhận `x-vendor-key`, so **timing-safe trên SHA-256 của cả hai vế** (`timingSafeEqual` ném lỗi
  khi độ dài khác nhau, nên so thô buộc phải return sớm — đúng cái timing signal cần tránh);
- sai key và không key đều trả **404**, không phải 401: người lạ không cần biết route này tồn tại;
- **không set mật khẩu = đóng**, không phải mở.

### Đếm hai cách, vì hai câu hỏi

| Bảng | Trả lời |
|---|---|
| **What is happening** (theo `kind`) | `quote_created` 32 · `revision_saved` 7 · `page_view` 1.376 — sản phẩm có được dùng không, và **bây giờ** có không (cột 7/30/90 ngày) |
| **Which screens are opened** (theo route) | `/quotes` 557 · `/quotes/new` 298 · `/quotes/:id/edit` 168 · `/quotes/:id` 141 — **màn nào** người ta thực mở. Một công ty đăng nhập rồi không bao giờ mở editor là công ty sẽ không gia hạn, và cột `kind` không nói được điều đó |

### Lỗi tôi tự tạo rồi tự bắt: `:id` không gộp

Lần đầu bảng route có **61 dòng**, trong đó ba dòng cùng nhãn `/quotes/:id/edit` với 41 / 16 / 16 lượt.
Nguyên nhân: tôi thay UUID thành `:id` lúc **render**, còn **nhóm** thì ở server theo route gốc — ba
nhóm khác nhau đội cùng một nhãn.

Nhóm và đặt nhãn là hai nửa của **một** câu hỏi ("editor được mở bao nhiêu lần"), nên cả hai phải ở
cùng một chỗ: khoá của `Map` là route đã chuẩn hoá (`normaliseRoute` ở `routes/vendor.ts`), trang chỉ
in ra thứ nó nhận. Sau khi sửa: **61 → 11 dòng**, `/quotes/:id/edit` = 168.

Test `vendorUsage.test.ts` ghi **hai UUID khác nhau** và khẳng định chúng vào **một** dòng — nếu ai
chuyển phép thay thế về lại trang, test đỏ.

### `/dashboard/docs` — cùng nội dung với `docs/PRICING-PIPELINE.md`

**Chín mục**: một hình toàn cảnh, rồi ① nguồn dữ liệu (80 bảng / 31.553 dòng) · ② một thanh thép được
định giá thế nào · ③ một revision, từng dòng · ④ chuỗi giá với số thật · ⑤ wind code · ⑥ những gì báo
giá **không** biết · ⑦ hai thuộc tính đáng biết · ⑧ đọc code ở đâu.

Bốn sơ đồ là **SVG viết tay** trong `components/vendor/PricingDiagrams.tsx` (`Frame`/`Box`/`Arrow`/
`Caption` tự dựng), **không** Mermaid và **không** client JS: trang này server-render, Mermaid cần
bundle cho một hình không bao giờ đổi.

| Sơ đồ | Trả lời |
|---|---|
| `PipelineDiagram` | năm chặng: building + money → sách giá → 12 nhóm BOM → chuỗi giá → revision đóng băng |
| `DataMapDiagram` | **nhóm BOM nào đọc bảng giá nào**; hai đường chéo đáng chú ý: `devided` quyết số hàng purlin, `frameSchedule` quyết mọi tiết diện thép (hoặc rơi về một tiết diện giả định) |
| `PriceChainDiagram` | chuỗi giá dạng thác nước với số thật của một revision đã lưu |
| `SaveGateDiagram` | cổng lúc Save quyết định "complete" hay "draft" |

Hình học được **đo bằng số**, không bằng mắt: một script so từng hộp chữ với mọi hộp khác và với
`viewBox`. Nó bắt được hai lỗi sẽ ship nếu nhìn bằng mắt — hộp "frozen revision" đè lên banner kết quả
8px ở hai chỗ (1.600px² mỗi chỗ), và một tiêu đề rộng 221px trong hộp 200px. Sau khi sửa: 0 đè nhau,
0 chữ ngoài `viewBox`. Ở 390px bốn sơ đồ cuộn **trong khung** của nó, trang không cuộn ngang.

Nguồn sự thật là `docs/PRICING-PIPELINE.md` (đọc cùng code khi review). Trang chỉ được khác về **cách
trình bày**, không được khác về **công thức** — sai là bug ở trang.

### Đo được

| | |
|---|---|
| `GET /vendor/usage` không key / sai key | **404** |
| prefix của mật khẩu đúng | **404** |
| không cấu hình mật khẩu | **503** `not_configured` |
| đúng key | 200, `page_view` 1.376 · `quote_created` 32 · 11 route |
| `/dashboard` chưa đăng nhập | redirect `/dashboard/login` |
| mật khẩu sai | *"That password is not right."*, ở lại form |
| mật khẩu đúng | `/dashboard`, 1.416 events, 61→11 screens |
| đăng xuất | cookie xoá, `/dashboard` redirect lại |

---

## 13.17 Ai đã ghé, và đã làm gì — nhật ký thật (2026-11-09)

Yêu cầu: *"thống kê lại bao nhiêu IP đã ghé thăm, và đã làm những thao tác gì… ko phải chỉ đếm summary
như hiện tại"*.

### Nút thắt đầu tiên: IP chưa bao giờ được ghi

`usage_events.ip_hash` tồn tại từ migration 001 và **mọi dòng đều NULL** — `recordUsage` ghi cứng
`NULL`. Nên "bao nhiêu IP" không trả lời được, và một bảng Visitors sẽ rỗng vĩnh viễn.

Nhưng sửa `recordUsage` là **chưa đủ**: API nhận request qua **bridge same-origin** của Next, mà bridge
là một `fetch` phía server — nên `request.ip` ở API **luôn là 127.0.0.1**. Mọi khách của mọi công ty sẽ
là **một** địa chỉ. Phải sửa bridge trước:

- bridge đọc `x-forwarded-for` / `x-real-ip` của request vào và **forward tiếp**;
- không tự bịa, không ghi đè chuỗi đã có — vì API bật `trustProxy: true`, ghi đè sẽ biến nó thành lời
  nói dối (hop cuối là chính bridge).

### IP được băm, không được lưu

Câu hỏi của dashboard là *"bao nhiêu người **khác nhau**"* — cần **tính khác biệt**, không cần danh
tính. Lưu `203.0.113.7` trả lời đúng câu đó **và** ghi lại vị trí vật lý của mọi khách hàng của mọi
công ty, trong một bảng mở bằng một mật khẩu. Nên `hashAddress()`:

- `sha256(SESSION_SECRET + '|' + address)`, cắt 32 ký tự;
- **salt là `SESSION_SECRET`**, không phải biến mới: IPv4 chỉ có 4 tỉ giá trị, băm không salt thì đảo
  ngược được trong vài giây; và salt phải sống qua restart, nếu không mỗi lần restart mọi khách thành
  "mới". `SESSION_SECRET` đã bắt buộc và đã bị từ chối ở production nếu ngắn — thêm secret thứ hai là
  thêm một thứ để quên, và hệ quả của việc quên là yếu hơn;
- chuẩn hoá `::ffff:` (dual-stack listener báo dạng mapped), nếu không **một** khách thành **hai**.

Dashboard hiện **8 ký tự đầu** làm handle: đủ để phân biệt hai khách và lần theo một khách trong log,
không đủ để nhận ra ai.

### "Ai" đi trong `detail_json`, không thêm cột

`actor` (email) đi vào `detail_json`. Lý do: `usage_events` có từ migration 001 trên **cả hai dialect**;
thêm cột là thêm migration **và** thêm một shape có thể lệch giữa SQLite và Postgres. Nhãn này là một
chuỗi ngắn trên dòng vốn đã là JSON, và **không truy vấn riêng** — dashboard đọc dòng rồi nhóm. Nếu sau
này cần index thì đó là lúc thêm cột.

### Ba call site đều ghi `address` + `actor`

| Sự kiện | Ghi thêm gì |
|---|---|
| `page_view` | `route` — dòng duy nhất xảy ra **mỗi lần mở màn**, nên là nguồn duy nhất cho đếm visitor |
| `quote_created` / `revision_saved` | `quoteId`, `revision`, **`quoteNumber`** — log nói được *báo giá nào* |
| `mail_sent` | `quoteId`, `revisionId`, **`mode`** — bốn ý định gửi, không có `mode` thì "đã gửi mail" không nói được gửi để làm gì |

### Bảng mới trên `/dashboard`

| Bảng | Nội dung |
|---|---|
| **Who came (N)** | mỗi `ip_hash` một dòng: handle 8 ký tự · **đăng nhập bằng email nào** (nhiều tên = máy dùng chung, có cảnh báo) · số màn · tổng sự kiện · lần đầu · lần cuối |
| **The activity log (N)** | **mọi** sự kiện, mới nhất trước: khi nào · **ai** (email + công ty) · **làm gì** · **trên cái gì** (route / số quote + rev / mode gửi) · visitor |

`recent` cũ bị **bỏ**: hai mảng trên một bảng là cách một màn hình hiện "40 cái mới nhất" cạnh "mọi sự
kiện" mà chúng nói khác nhau. Một danh sách, cắt ở server.

### Đo được

Ghi thật qua trình duyệt (không phải chèn DB): mở `/quotes`, `/settings`, `/activity`, `/dashboard/login`,
rồi lưu một revision của Q-2026-0039. Log hiện:

```
2026-11-09 18:46  owner@demo-sheds.local  Demo Sheds Pty Ltd  Revisions saved  Q-2026-0039 · rev 3  91dba38f
2026-11-09 18:44  owner@demo-sheds.local  Demo Sheds Pty Ltd  Screens opened   /activity            91dba38f
```

`Visitors = 1` vì tất cả đến từ một máy — đó là **hành vi đúng**, không phải lỗi. Test
`vendorUsage.test.ts` ghi **hai địa chỉ khác nhau** và đòi `visitors.length === 2` với ba sự kiện, để
chứng minh phép đếm là theo địa chỉ chứ theo sự kiện.

**Giới hạn phải nói:** mọi dòng ghi **trước** 11:43 hôm nay có `ip_hash = NULL` và `actor = NULL`, nên
chúng không xuất hiện trong bảng Visitors. Không có cách nào đổ ngược — dữ liệu đó chưa từng được ghi.

---

## 13.18 Thấy IP (che 4 số cuối) + phiên có thời lượng và lịch sử (2026-11-09)

Yêu cầu: *"tôi cần thấy IP, show thì che 4 số cuối (tôi click vào thì show). Thống kê dạng Ngày Giờ,
Ip{no}, bao nhiêu thao tác, ở lại bao nhiêu lâu, click expand thì thấy lịch sử đã làm gì"*.

Yêu cầu này **đảo ngược** quyết định §13.17 (chỉ lưu hash). Đúng, vì câu hỏi thật của người vận hành là
*"đây là khách thật hay traffic test của tôi"* — một handle 8 ký tự **không trả lời được**, và một
dashboard không trả lời được câu đó là dashboard không ai tin.

### IP được **mã hoá**, không phải plaintext

`ip_enc` = `iv:tag:ciphertext` (hex), **AES-256-GCM**. Ba tính chất, và cả ba là lý do dùng mã hoá chứ
không thêm cột text:

- dump DB / backup / file export hỗ trợ **không** chứa địa chỉ ở dạng đọc được;
- khoá suy từ `SESSION_SECRET`, nên **rotate secret là mọi địa chỉ cũ thành không đọc được** — dữ liệu
  tự hết hạn thay vì cần job xoá;
- GCM có xác thực, nên một dòng bị sửa **không giải mã được** thay vì trả về một địa chỉ sai trông hợp lý.

`ip_hash` **giữ nguyên** bên cạnh, vì nó có một tính chất mà ciphertext không có: **rotate khoá thì
ciphertext chết nhưng handle không đổi**, nên lịch sử của một khách vẫn là một lịch sử. Log nhóm theo
handle; địa chỉ chỉ để hiển thị.

Ba kết quả trong `lib/address.ts`:

| Hàm | Cho ra |
|---|---|
| `encryptAddress` | `iv:tag:body`, IV ngẫu nhiên mỗi dòng (dùng lại IV với GCM là lỗi phá cả mode) |
| `decryptAddress` | địa chỉ, hoặc `null` khi khoá đã đổi / dòng bị sửa |
| `maskAddress` | `203.0.1••••` cho IPv4; **`••••••`** cho địa chỉ ngắn như `::1` — che 4 ký tự của 3 ký tự thì không còn gì để đọc, và đó là bẫy đầu tiên tôi gặp |

### "Ở lại bao lâu" cần một biên giới — dùng session của sản phẩm

Migration **016** thêm `session_id` (index `(session_id, at)`). Nhóm theo **session**, không theo địa
chỉ: một văn phòng 4 người sau một NAT là **một** địa chỉ và **bốn** phiên; một người đi ăn trưa về là
**phiên thứ hai** cùng địa chỉ. Session là biên giới sản phẩm đã vẽ sẵn, và id đã có trên mọi request —
không thêm cookie, không sửa client.

`durationMs` = `lastAt − startedAt`. **Đây là sàn, không phải thời lượng**: nó đo khoảng của các hành
động **đã ghi**, nên một tab mở một màn rồi đọc 10 phút hiện **0** nếu không có gì xảy ra sau. Cột được
đặt tên **"Active for"** đúng vì thế, và 0 nghĩa là "một hành động được ghi", không phải "không ở lại".

### Bảng Visits mới

| Cột | Ý nghĩa |
|---|---|
| **When** | ngày giờ phiên bắt đầu |
| **Address** | `203.0.1••••`, **click để hiện đầy đủ** (`<button aria-expanded>`, không phải tooltip — tooltip không chạm được trên điện thoại và biến mất khi cuộn) |
| **Signed in as** | email + công ty |
| **Actions** | số thao tác trong phiên |
| **Active for** | `2m 15s` — sàn, xem trên |
| **Last action** | giờ:phút:giây của hành động cuối |
| **▸** | expand: danh sách `giờ:phút:giây · hành động · đối tượng` — "Opened /dashboard", "Saved a revision Q-2026-0039 · rev 3" |

`Address` giải mã **một lần mỗi phiên**, không một lần mỗi sự kiện: mọi sự kiện trong một phiên mang
cùng địa chỉ, và giải mã 200 dòng để hiện một địa chỉ là việc không có đáp án ở cuối.

### Bốn lỗi trong lúc làm — ba của test, một của tôi

1. **Migration chạy hai lần.** Tôi copy nguyên khối `ALTER TABLE` vào **cả** file dialect, mà `migrate()`
   chạy portable rồi mới tới dialect → cột được thêm hai lần, và lỗi chỉ hiện ở **lần chạy sau** (vì
   portable đã được ghi nhận), đọc thành "migration hỏng". Sửa: file dialect thành `SELECT 1;` như 015,
   kèm comment cảnh báo.
2. **Test chờ quá sớm.** Tôi đọc DOM ngay trong cùng `evaluate` sau `click()` → React chưa flush. Đọc
   lại sau 600ms thì đúng (`ol: 1`, `li: 183`).
3. **`.first()` trúng nút Address.** Nút Address **cũng** có `aria-expanded`, nên
   `tbody button[aria-expanded]` khớp nó trước nút expand. Sửa: scope theo `aria-label*="what was done"`.
4. **`title*="address"` mất khớp sau click.** `title` đổi từ *"Show the whole address"* sang *"Hide the
   last four characters"*. Test báo control đang chạy tốt là **hỏng**. Sửa: bám `class` (`font-mono`) —
   thứ duy nhất không đổi.

Bài học chung: **một control tự đổi nhãn khi bấm thì không thể định vị bằng nhãn của nó.** Cả hai lỗi
3 và 4 đều là dạng đó, và cả hai đọc thành "tính năng hỏng".

### Đo được

`GET /vendor/usage` trả `visits: 2`, mỗi phiên `actions: 184 / 237`, `events` đầy đủ, `ipMasked:
"••••••"`, `ipFull: "::1"` (localhost IPv6 — máy test). Trong trình duyệt: click `••••••` → `::1` và
`aria-expanded="true"`; expand → `ol` với `li` "19:18:22 Opened /dashboard".

**Giới hạn:** mọi dòng ghi trước migration 016 có `session_id = NULL` → không vào bảng Visits (vẫn nằm
trong Activity log). Không đổ ngược được.

---

## 13.19 Cột IP hiện `••••••` — hai lỗi thật (2026-11-09)

Người vận hành: *"sao dashboard vẫn chưa thấy địa chỉ IP của session đó, bạn ko nghe tôi yêu cầu à?"* —
đúng, và có **hai** lỗi riêng biệt.

### Lỗi 1: `maskAddress` che hết địa chỉ ngắn

Cột Address hiện **`••••••`** trên **mọi** dòng. Nguyên nhân: hàm che **4 ký tự cuối, vô điều kiện**.
Với `203.0.113.7` thì ra `203.0.1••••` (ổn). Với `::1` — loopback IPv6, **3 ký tự** — che 4 ký tự là che
toàn bộ. Mọi dòng thành một hàng chấm: **không có IP nào**, đúng cái không được phép xảy ra.

Nay che theo **phần**, vì phần cuối là phần định danh host:

| | |
|---|---|
| IPv4 `203.0.113.7` | `203.0.113.•••` — /24 đọc được, host thì không |
| IPv6 dài | `2001:db8:85a3:8d3:••••` |
| `::1`, chuỗi ngắn | **hiện đầy đủ** — không có phần host để giấu, và che 3 ký tự của 3 ký tự không nói gì |

Địa chỉ ngắn không riêng tư như địa chỉ của khách: `::1` là **máy này**, và người vận hành **cần** thấy
điều đó — *"mọi khách đều là ::1"* là một câu trả lời, không phải một rò rỉ.

### Lỗi 2: `request.ip` bỏ qua `x-forwarded-for`

`lib/http.ts` đã có `clientIp()` xử lý đúng (lấy hop đầu của `x-forwarded-for`), nhưng **cả ba** call
site dùng `request.ip` thô — thứ mà Fastify điền từ socket. Sau bridge same-origin, socket luôn là
`127.0.0.1`/`::1`, nên địa chỉ thật **không bao giờ** được ghi.

Nay cả ba dùng `clientIp(request.headers, request.ip)`.

### Chứng minh đường ống bằng IP giả

`POST /usage/page-view` với `x-forwarded-for: 203.0.113.77` (như một proxy thật sẽ gửi):

```
masked: "203.0.113.•••"
full:   "203.0.113.77"
```

Trong trình duyệt: dòng đầu hiện **`203.0.113.•••`**, click → **`203.0.113.77`**, `aria-expanded=true`,
`title` đổi thành *"Hide the last four characters"*.

### Vì sao dữ liệu thật vẫn là `::1`

Vì trình duyệt test chạy **trên cùng máy** với API — `x-forwarded-for` khi đó đúng là `::1`. Đó không
phải lỗi: khi có người truy cập từ máy khác, hoặc khi deploy sau nginx/Cloudflare, header mang địa chỉ
thật và cột hiện địa chỉ đó. Phép thử với IP giả ở trên là bằng chứng đường ống hoạt động.

### Bài học

**Một phép che phải được thử với dữ liệu ngắn nhất có thể xảy ra, không phải điển hình nhất.** Test cũ
của tôi dùng `203.0.113.7` — trường hợp đẹp — nên `::1` lọt qua. Nay test có cả `::1`, `127.0.0.1`,
IPv4, và IPv6 dài.

---

## 13.20 Bốn sơ đồ trong `/dashboard/docs` — vẽ bằng tay, đo bằng số (2026-11-09)

Yêu cầu: *"bổ sung thêm diagram, workflow chart, dạng sơ đồ các mối liên quan đầy đủ… cho tôi nhìn trực
quan"*. Trang `/dashboard/docs` trước đó giải thích pipeline bằng văn xuôi và để người đọc tự hình dung.

### Bốn hình, và câu hỏi mỗi hình trả lời

| Component | Câu hỏi |
|---|---|
| `PipelineDiagram` | **Toàn cảnh**: từ building + money trong trình duyệt → sách giá → 12 nhóm BOM → chuỗi giá → revision đóng băng → BOM / tài liệu / share link. Mũi tên đáng nhìn hai lần: **mọi thứ bên phải KHÔNG tính lại** |
| `DataMapDiagram` | **Nhóm BOM nào đọc bảng nào.** Hai đường chéo: `devided` quyết số hàng purlin (input công trình), `frameSchedule` quyết mọi tiết diện thép — hoặc rơi về **một** tiết diện giả định |
| `PriceChainDiagram` | **Chuỗi giá dạng thác nước** với số thật của một revision đã lưu |
| `SaveGateDiagram` | **Cổng lúc Save**: cái gì làm một báo giá là "draft" thay vì "complete" |

### Vì sao SVG viết tay, không Mermaid, không thư viện chart

Trang này **server-render**. Mermaid cần một client bundle để vẽ một hình **không bao giờ đổi** — trả
JS cho một ảnh tĩnh. Bốn primitive (`Frame`, `Box`, `Arrow`, `Down`, `Caption`) đủ cho cả bốn hình, và
chúng in ra được.

### Hình học được đo, không được nhìn

Mô hình này **không đọc được ảnh**, nên "trông ổn" không phải bằng chứng. Một script đo mọi hộp chữ
với mọi hộp khác và với `viewBox`. Nó bắt hai lỗi mà mắt người sẽ thấy là cẩu thả và tôi sẽ ship:

1. hộp "frozen revision" **đè** lên banner kết quả 8px ở hai chỗ — 1.600px² mỗi chỗ (sửa: `height`
   230 → 268, banner xuống `y=218`);
2. một tiêu đề rộng **221px trong hộp 200px** (sửa: rút chữ).

Sau khi sửa, cả bốn hình: **0 đè nhau, 0 chữ ngoài `viewBox`, 0 tràn thật**. Ở 390px: 4 hình, mỗi SVG
720px trong khung 318px có `overflow-x: auto`, **trang không cuộn ngang**.

### Test

`e2e/vendorDashboard.spec.ts` khẳng định: 4 `svg[role="img"]`, mỗi cái có `aria-label` ≥ 20 ký tự
(SVG không nhãn là vô hình với screen reader), và những con số trang tồn tại để nói: `31 553`,
`8,185.68`, `13,326.29`, `GIRT_PRICE_FROM_PURLIN`.

### Hai lần đỏ không phải lỗi sản phẩm

- **API đã chết** trong lúc dọn tiến trình (14+ node, 4 bộ `tsup --watch` tranh nhau ghi `dist`).
  Trang báo "Could not read the figures" — đúng hành vi (nó từ chối hiện số cũ), nhưng test đỏ.
- **`/vendor/usage` trả 404 khi dò trần** vì route nằm dưới prefix `/api/v1`; gọi đúng prefix thì 200.
  Một lần dò sai đường đọc thành "route hỏng".

Bài học: khi một test đỏ ngay sau khi sửa hạ tầng, **kiểm tiến trình trước khi kiểm code**.

---

## 13.21 Step 1 theo đặc tả desktop — bốn lỗi thật (2026-11-10)

Đọc `docs/smartquote-analysis/2026-11-10-step1-quote-details-sitecheck-workflow.md` (đặc tả trace từ
source desktop) rồi đối chiếu với v2. Bốn lỗi **đo được**, không phải suy đoán.

### Lỗi 1 — Importance Level 3 và 4 bị **hạ âm thầm về 1**

```
normaliseShedConfig({ importanceLevel: 3 }).importanceLevel  →  1
```

Nguyên nhân: `importanceLevel` khai `1 | 2` ở **cả** schema strict và schema tolerant, và schema
tolerant sửa giá trị sai bằng `.catch(DEFAULT)`. ShedSafe chứng nhận **cả bốn** mức, nên một chứng chỉ
ghi 3 bị lưu thành 1 — và báo giá in **"Importance level 1"** cạnh chứng chỉ ghi 3.

Đây là loại lỗi tệ hơn "không hỗ trợ": `.catch()` không báo lỗi, không cảnh báo, và con số sai trông
hoàn toàn hợp lệ. Cùng họ với việc đọc `topographicFactor` thô — một con số trông đã được chứng nhận.

Sửa: `ImportanceLevel = 1 | 2 | 3 | 4`, dùng chung một schema cho cả hai đường.

**Sách giá không có bảng cho 3 và 4** (đo: 1 077 dòng mức 1, 1 675 dòng mức 2, không có dòng nào cao
hơn). Nên khi chọn 3, `frameSchedule` không tìm thấy dòng → `scheduleMissing = true` → khung rơi về
**một tiết diện giả định**, và BOM mang `FRAME_SECTION_ASSUMED`. Đó là thất bại **trung thực**: báo giá
nói nó không định giá được, thay vì định giá một nhà mức 3 như mức 1. Nhóm Design cũng nói điều đó
ngay cạnh field, vì cảnh báo BOM xuất hiện hai bước sau.

### Lỗi 2 — default Importance Level không nhất quán (1 ở store, 2 ở API và desktop)

`pinRequest` mặc định **2**, panel desktop khởi tạo **2**, `DEFAULT_SHED` để **1**. Nghĩa là cùng một
báo giá có thể **pin ở mức 2 rồi định giá ở mức 1** — pin ghi một số, bảng khung đọc một số khác.
Hai trong ba chỗ nói 2; chỗ lệch là chỗ **ghi config được lưu**. Nay là 2.

### Lỗi 3 — rating ShedSafe không biết công trình đã đổi

`calculated` trả lời "ShedSafe đã cấp rating chưa", và nó **đúng mãi mãi** sau khi cấp. Câu hỏi khác
là "rating đó còn nói về **công trình này** không" — và không gì so sánh hai thứ đó. Một nhà bị nới từ
12 m lên 15 m sau khi pin vẫn giữ nhãn xanh "Rating imported" bên cạnh một công trình chưa ai rate.

Nay `detail_json.pinnedFor` lưu span/height/length/importanceLevel **lúc pin**, và panel so với công
trình đang mở. Lệch → `role="alert"` đỏ, liệt kê **cái gì đã đổi** ("span 12 000 → 15 000 mm"), và
nhãn thành *"Rating is for a different building"*. Check pin trước khi có tính năng này đọc là **chưa
xác minh**, không phải "khớp" — một tuyên bố dữ liệu không chống đỡ được thì tệ hơn một khoảng trống.

Đây là khác biệt **có chủ ý** so với desktop (desktop cũng mù chỗ này) → `KNOWN-DEVIATIONS.md` dòng 32.

### Lỗi 4 — nút PIN chỉ kiểm 2 field thay vì 5

Đặc tả §4.1: PIN cần **5** field — First, Last, Email, **Customer Address**, **Site Address** — cộng
`Salesman` mà ShedSafe bắt buộc. v2 chỉ kiểm `salesman` + `site.suburb`.

Desktop còn có lỗi **hai danh sách không khớp**: enable check fallback sang field địa chỉ cũ, còn click
handler thì không — nên nút có thể *trông* sẵn sàng, bấm vào vẫn bị chặn (§4.3). Ở đây **một** danh
sách dùng cho **cả** cổng lẫn click, nên "đang bật" và "sẽ chạy" không thể lệch.

Nút tắt **kèm lý do ghi rõ từng field còn thiếu**, vì một nút xám không nói gì trên form cao 6 273 px
là để người dùng tự đi tìm.

### Ba thứ nhỏ hơn, cùng lượt

| | |
|---|---|
| **Đổi Delivery Scope → bỏ tick cam kết** | Desktop làm vậy (`Events.cs:573-582`). Tick là phát biểu về **một bộ điều khoản cụ thể**; giữ nó qua lần đổi scope là ghi nhận một cam kết khách chưa từng thấy. Chỉ reset khi giá trị **thật sự đổi**. |
| **Average height + Ridge height** | Desktop hiện average trong panel Building Parameters (`UcShowBuildingParameterss.cs:786-841`), v2 không có. Nay có, cạnh Roof Pitch, read-only. `averageHeightMm` chia **4** (gable) / **2** (skillion) — đúng hệ số desktop, vì đây là số dùng cho hồ sơ council và phải khớp số công ty đã nộp bao năm. Ridge thêm vào vì "average 4 729" không cho biết đỉnh là 5 258, mà đỉnh mới là thứ đụng gầm cầu. |
| **Đơn vị hiện cạnh số đo** | `formatDimension` trả số trần; nay có `mm`/`m` theo công tắc đơn vị. |

### Đo được trong trình duyệt

| | |
|---|---|
| Importance level, options | 4 (`1 — normal` … `4 — exceptional`) |
| Importance level, giá trị mặc định | **2** |
| Chọn 3 → giá trị lưu | **3** (trước đây: 1) |
| Cảnh báo sách thiếu bảng | *"This price book has no frame table for level 3…"* |
| Average height (mặc định) | **4729 mm** |
| Ridge height (mặc định) | **5258 mm** |
| Nút PIN trên form trống | `disabled`, kèm *"Before pinning, fill in the customer's first name, …"* |
| Tick cam kết → đổi scope | tick **bị bỏ** |
| `pageOverflowX` ở 390 px | **0** |

### Bài học

Đặc tả desktop không chỉ nói "có field gì" — nó nói **khi nào control bật** và **dữ liệu chảy từ đâu
tới đâu**. Ba trong bốn lỗi trên chỉ hiện ra khi đọc phần *điều kiện* của đặc tả, không phải bảng field.

Và: **một `catch()` trong schema là một quyết định nghiệp vụ, không phải phòng thủ.** Nó biến "không
biết" thành một con số cụ thể, và con số đó sẽ được in ra giấy.

---

## 13.22 Step 1 — PIN lên cạnh địa chỉ, sáu giá trị read-only (2026-11-10)

Yêu cầu: *"sau 3 cái address thì tới cái PIN ngay… mục đích là lấy được thông số thật từ sitecheck
trước khi qua step 2 (và các thông số đồng bộ, cần hiển thị đầy đủ ngoài UI dạng readonly)"*, và
*"Design parameters phải có đủ: Structure Type edit; Importance Level / Wind Region / Terrain Category /
Building Class / Ground Snow Load / Design Wind Speed readonly; Internal Pressures, End Opening, Side
Opening"*.

### 1. PIN từ `top 3572` xuống `top 1616`

Đo trước: địa chỉ site kết thúc ở `top 916`, nút `Go to ShedSafe` ở **`top 3572`** — cách 2.650 px, với
toàn bộ nhóm Design ở giữa. Ba nhóm địa chỉ tồn tại **để được pin**, và nút mà chúng bật thì ở tận dưới.

Desktop gắn PIN **trong** field Site Address nên "gõ địa chỉ → pin" là một động tác. v2 không gắn trong
field (một nút trong `<input>` là chỗ đặt tồi trên cảm ứng), nên đặt khối ShedSafe **ngay sau Delivery,
trước Design** — đúng chỗ địa chỉ kết thúc và cũng đúng chỗ kết quả của nó được đọc.

`QuoteDetailsPanel` nhận một **slot** `siteCheck` chứ không import panel: panel cần `quoteId`, `session`,
`onImported` — đều sống ở `QuoteEditor`. Truyền xuống sẽ tạo bản sao thứ hai của props, và panel sẽ được
render từ hai nơi.

Sau khi sửa, đo được thứ tự: Delivery `1250` → ShedSafe `1250` → Design `1814`, nút PIN `1616`.

### 2. Sáu giá trị thành read-only, ba trạng thái

Đúng đặc tả §3.5. Nhưng có một chỗ **không thể chỉ đổi sang read-only**:

**`windRegion` là `required` trong validation.** Đổi nó sang read-only mà giữ luật đó thì một báo giá
chưa pin sẽ **không bao giờ** qua được Step 2 — đúng cái bẫy làm desktop không báo giá được trước khi có
site check. Đã bỏ nó khỏi danh sách chặn (`validation.ts` §5), theo lựa chọn **(b)**: cho báo giá nhanh,
nhưng nói rõ giá đó dựa trên **giá trị mặc định**, không phải chứng chỉ.

Chặn còn lại là `stateCode` — và nó **không** readonly, vì nó không phải dữ liệu của ShedSafe:
`stateCode` chọn `setting_price_coeffcient` (hệ số giá vật liệu theo bang) và hệ số mezzanine QLD. Nếu
tắt nó đi thì **không còn** control nào cho giá vật liệu. ShedSafe chứng nhận gió, không chứng nhận lịch
giá của dealer. `internalPressure` cũng editable — đó là lựa chọn thiết kế.

Ba trạng thái, và trạng thái thứ ba là thứ người dùng hành động theo:

| Trạng thái | Hiện | Nhãn dưới |
|---|---|---|
| `unchecked` | `—` | *not from a site check yet* (viền đứt) |
| `provisional` | số ShedSafe đang giữ | *provisional — not auto calculated* (nền vàng nhạt) |
| `certified` | số đã import | *from the site check* |

`DesignValue` là **một** component quyết định cả ba — sáu dòng viết tay là sáu cơ hội để một số
`provisional` in cùng màu với số đã chứng nhận, và một số cùng màu chữ thường là số người ta sẽ báo giá.
`aria-describedby` trỏ tới câu trạng thái để phân biệt đó tới được screen reader.

**Giá trị mặc định KHÔNG nằm trong chuỗi tin cậy đó.** Hiện `A` vì config mặc định `A` sẽ không phân biệt
được với `A` của chứng chỉ, và chỉ một trong hai là sự thật.

### 3. Một provider, không phải hai lần fetch

Panel ShedSafe pin/import; nhóm Design hiển thị cùng sáu giá trị cách đó vài trăm px. Hai lần fetch sẽ
cho phép panel nói "Rating imported" trong khi các field vẫn hiện số **trước** khi import.
`SiteCheckProvider` giữ một object, và import công bố kết quả qua `replace()` nên cả hai đổi trong cùng
một commit.

### 4. Bảng sáu giá trị luôn render

Trước: chỉ render khi `calculated === true`, nên báo giá chưa có check hiện **khoảng trắng** — không phân
biệt được "chưa hỏi ShedSafe" với "hỏi rồi, rỗng". Nay mỗi dòng luôn có, và trạng thái nói nó là gì.
Khối `provisional` riêng đã bị xoá: nó tồn tại chỉ vì bảng kia không render, nay trùng chức năng.

### 5. Bảy thông số địa lý mở sẵn, và đọc được cả trước Auto Calc

`Site readings` (`shielding`, `topographicFactor`, snow region, earthquake, elevation, toạ độ, rainfall)
nay `open` mặc định và đọc được cả từ `provisional` — trước chỉ đọc `check.site`, thứ chỉ có sau import.
Có một dòng nói rõ: *"These describe the place, not the price: nothing here is used to cost the shed."*

### 6. Import xong thì giá tự tính lại

Import đổi `windRegion` và `terrainCategory` — hai field **quyết định giá**. Trước đây `pricedAt` thành
`'stale'` và người dùng được bảo *"Calculate the price again"* ngay sau khi được bảo import thành công:
hai thông báo, một hành động, nút Save bị chặn ở giữa. Nay `onImported` gọi `calculate()` qua
`setTimeout(…, 0)` để mọi `set` của `applyPartial` kịp rơi vào store, và để phép tính không nằm trong
render đã sinh ra nó.

### Đo được trong trình duyệt

| | |
|---|---|
| Thứ tự nhóm | Quote & client `213` · Site `916` · Delivery `1205` · **ShedSafe `1250`** · Design `1814` · Shed `2921` · Colours `3662` |
| Nút PIN | `1616` (trước: `3572`) |
| Sáu field, chưa pin | `—` + *not from a site check yet*, `tagName = OUTPUT` |
| Sáu field, check `pinned` có readings | `2` / `C` / `2.5` / `Class 10a` / `0.1 kPa` / `45.3 m/s`, nhãn *provisional — not auto calculated* |
| `select#design-windRegion` | **0** (không còn control) |
| `#design-stateCode`, `#design-internalPressure`, `#design-structureType` | enabled |
| `Site readings` | `open = true` |
| `pageOverflowX` ở 390 px | **0** |

### Bài học

**Một field `required` đổi sang read-only là một luật phải đổi theo.** Nếu chỉ đổi control mà giữ
validation, kết quả là một field đỏ không ai sửa được và một nút Save không ai mở được — cái bẫy mà
desktop đang mắc. Đổi hình thức hiển thị và đổi luật là **một** thay đổi, không phải hai.

Và: **giá trị mặc định không phải giá trị chứng nhận.** Chúng có thể bằng nhau, và đó chính là lý do phải
hiển thị chúng khác nhau.

---

## 13.23 Wind region là **mã chứng chỉ**, không phải chữ cái (2026-11-10)

Yêu cầu: *"windRegion từ sitecheck nên có thể có nhiều mã khác nhé. ko phải chỉ trong 1 list combobox"*.

### Đo trước khi sửa: ShedSafe trả gì

Đọc 47 building thật trong `legacy.dbo_building` → gọi `GET /building/get/{SSId}` cho từng cái:

```
"A1" × 16    "A2" × 16    "A5" × 12    "B1" × 5
terrain: 1, 1.5, 2, 2.68, 2.7, 2.81, 2.92, 2.95, 3
```

Bảng `devided` của sách: `A2 A3 A5 A6 B2 B3 B4 B5 B6 B7 C2 C3 C4 D2 D3 D4`.

**Hai điều cùng đúng:** schema v2 chỉ nhận `'A'|'B'|'C'|'D'` + `.catch()`, nên **mọi chứng chỉ thật**
bị hạ về `A`; và các mã **không tương đương** — đo trên sách: `A2` → purlin_span **720**, `A5` → **830**,
`A6` → **1300**. Hạ `A5` về `A` rồi ghép thành `A2` là **purlin nhỏ hơn ở nhịp ngắn hơn** so với chứng
chỉ. Cùng họ với Importance Level 3→1, nặng hơn: đổi **số lượng thép**, không chỉ đổi nhãn.

### Sửa: tách "in chứng chỉ" khỏi "tra bảng"

`packages/core/src/domain/wind.ts` (mới): `WindRegion` thành `string`; schema nhận `[A-D][0-9]{0,2}`
hoặc mã cũ `W41`/`N2`; `windRegionCode(region, terrain, bookCodes)` trả khoá tra `devided`;
`windRegionLetter` đọc vùng; `nearestTerrainCategory` xử lý terrain lẻ (2.68 → 2.5).

**Thứ tự ưu tiên của `windRegionCode`:**

| | |
|---|---|
| 1 | Mã cụ thể (`A5`) — dùng **nguyên văn**, vì đó là thứ sách đánh khoá |
| 2 | Vùng trơn + digit terrain (`A` + 2 → `A2`), khi sách có dòng đó |
| 3 | Digit **gần nhất trong cùng vùng**, khi sách không có mã ghép |
| 4 | Trả nguyên văn — lookup miss, frame báo giả định. **Không thay bằng mã khác** |

Bước 3 là chỗ một hồi quy thật lộ ra: desktop đánh terrain 2.5 là digit **4**, mà sách **không có `A4`**.
Trả `A4` làm lookup miss → cả frame rơi về tiết diện giả định — đúng lý do báo giá `terrainCategory: 2.5`
(trường hợp rất phổ biến ở Úc) ra giá không đầy đủ. Nay lấy `A3`, ghi lại là giả định.

### Ba chỗ so sánh chuỗi phải đổi theo

Khi giá trị thành `"C2"` thay vì `"C"`, ba phép so sánh cũ **im lặng ngừng chạy**:

| Chỗ | Cũ | Nay | Hệ quả nếu không sửa |
|---|---|---|---|
| `purlin.ts` lapFraction | `=== 'C'` | `windRegionLetter(...) === 'C'` | Mất lap 15% → **thiếu mét purlin** |
| `schema.ts` windlock | `=== 'C' \|\| === 'D'` | letter ∈ {C, D} | Cửa cuốn thiếu windlock ở vùng cyclonic |
| `optimise.ts` windCode | `region + floor(terrain)` | `windRegionCode(...)` | `"A52"` — không khớp gì |

### Đo được

| | |
|---|---|
| `normaliseShedConfig({windRegion:'A5'})` | `'A5'` (trước: `'A'`) |
| `A5` / terrain 3 | tra **`A5`** (trước: `A2` — sai vùng) |
| `A2` / terrain 2.92 | terrain → 3, tra `A2` |
| legacy default `A` / terrain 2.5 | tra `A3` (không còn `A4` miss) |
| vùng `B` không mượn dòng `A` | giữ trong vùng `B` |

### Dữ liệu thật: tài khoản demo → tài khoản thật

`apps/api/scripts/import-legacy-accounts.ts` (mới, `pnpm --filter @sq/api legacy:accounts`):
`dbo_salesman.FranchiseId` → tenants (6 salesman → 2 company); `dbo_account.Email` → role
(RoleId=1 Admin → `company_admin`).

Kết quả: `HEADOFFICE` (`hoangduy7617@gmail.com` = company_admin), `BRANCH01`
(`hoangduy7617+1@gmail.com`). Đăng nhập thật: `HEADOFFICE` / `hoangduy7617` → **200**, membership
`company_admin`. Mật khẩu dùng chung `Temp-Import-2026!` với `must_change_password = 1` — mật khẩu dùng
chung không được sống quá lần đăng nhập đầu.

### Ba lỗi tôi tự tạo trong lúc làm, và cách chúng lộ ra

1. **Postgres hạ chữ thường alias không trích dẫn.** `"FranchiseId" AS franchiseId` trả cột
   `franchiseid`, nên `row.franchiseId` là `undefined` → 6 salesman gộp vào head office, `Branch_01`
   biến mất. Lộ ra vì output không có `BRANCH01`. Sửa: trích dẫn mọi alias.
2. **Xoá tenant đâm vào trigger append-only.** `quote_revisions` từ chối `DELETE` — đúng thiết kế. Sửa:
   script **từ chối** xoá công ty có quote và nói rõ số lượng, thay vì tắt guard.
3. **`transform` của zod không từ chối được.** Trả `NaN` vẫn là "thành công", nên terrain 9 lọt qua.
   Sửa: `.pipe(z.refine(...))`.

### Còn lại

- **47 quote demo chưa xoá** — đều `draft` do e2e tạo (`Q-2026-0001…0047`, từ 2026-11-01). Xoá được
  nhưng phải tắt trigger append-only trong một transaction: quyết định của người vận hành, và script đã
  từ chối thay vì tự làm.
- **Điều kiện để pin thật:** email user phải khớp một salesman trong `dbo_salesman`. Đó là điều kiện của
  **dữ liệu**, không phải của code; ở production công ty phải đảm bảo user được đăng ký làm salesman.

---

## 13.24 ShedSafe: bốn thứ nó trả về HTTP 200 mà thực ra là từ chối (2026-11-10)

Đọc trace `2026-11-10-sitecheck-map-pin-api-trace.md` + đo API live. Bốn phát hiện, cùng một dạng:
**thành công giả**.

### 1. `POST /building/create` trả 200 khi thất bại

```
salesman không hợp lệ → 200, buildingId "00000000-…-000000000000",
                        message.errorMessage "The salesman provided is not a valid salesman username."
```

Code cũ chỉ kiểm `!response.ok` và `buildingId === ''` — không kiểm `errorMessage`, không nhận ra
UUID toàn số 0. Nên **một lần pin hỏng được lưu là "pinned"** với id giả. Đó chính là dòng
`00000000-…` nằm trong dev DB nhiều tuần.

Nay: `errorMessage` khác rỗng → ném lỗi; UUID toàn số 0 → ném lỗi.

### 2. `GET /building/get/{id}` trả 200 cho building không tồn tại

UUID ngẫu nhiên → `200`, `errorMessage "Building requested not found."`, mọi giá trị `0`. Nhánh
`status === 404` **không bao giờ chạy**, nên "không có building" trông giống "có nhưng chưa tính", và
màn hình hiện `0 kPa`, `0 m/s` như số thật.

Nay: kiểm **message**, không kiểm status. Và `0` chỉ là số thật khi `autoCalc === true` — Brisbane
thật sự có `snowLoad: 0`, nên luật phải có điều kiện, không tuyệt đối.

### 3. `Reference` KHÔNG phải khoá idempotency

Đo: gửi cùng `Reference` hai lần (Height khác) → **hai buildingId khác nhau**. Nên mỗi lần bấm PIN lại
tạo một building rác trên tài khoản ShedSafe của khách.

`PUT /building/update` thì trả 200 và giữ nguyên id. Nay transport chọn `update` khi biết `buildingId`,
và route truyền id của check đã có.

### 4. Danh sách salesman thật: `GET /building/getsalesmanusers`

Tìm thấy trong licence server cũ (`ShedSafeMethods.cs:127`), gọi thử: **9 salesman thật**.

| | |
|---|---|
| Có trên ShedSafe, thiếu trong `legacy.dbo_salesman` | `+3`, `+5`, `+7`, `thienduro@`, `thingo79+1@yahoo.com` |
| Có trong snapshot, **đã bị xoá** khỏi ShedSafe | **`+1`**, **`nguyen.an@`** |

**`legacy.dbo_salesman` là ảnh chụp lỗi thời.** Đó là lý do `+1` báo "not a valid salesman username"
dù vẫn đăng nhập được vào sitecheck.shedsafe.com.au — đăng nhập và làm salesman là hai quyền khác nhau.

### Sửa: kiểm trước khi cho PIN

`GET /shedsafe/salesmen` trả `you: { email, isSalesman, formattedName, franchiseName }`. Panel hiện
**một trong ba** câu, và nút bị chặn khi `isSalesman === false`:

| Trạng thái | Hiện | Nút |
|---|---|---|
| Là salesman | *Registered ShedSafe salesman — Jayy Ngo, Head Office.* | bật (nếu đủ field) |
| Không phải | *This login is not a registered ShedSafe salesman… Ask an administrator…* + danh sách email hợp lệ | **tắt** |
| Không kiểm được | *Could not confirm this login with ShedSafe (…). The pin is still worth trying.* | không chặn |

Ba trạng thái vì **"không kiểm tra được" không phải "không phải salesman"**: pre-flight hỏng không được
chặn một hành động có thể vẫn chạy.

### `sync-shedsafe-salesmen.ts` thay nguồn legacy

`pnpm --filter @sq/api sync:salesmen` — đọc danh sách thật, tạo user/membership theo franchise, và
**suspend** (không xoá) membership khi người đó không còn là salesman. Lần chạy đầu:

```
suspended: owner@demo-sheds.local (DEMOSHEDS), +1@ (BRANCH01), nguyen.an@ (HEADOFFICE)
moved:     +2@ và +6@ rời HEADOFFICE → COMPANYAAA / BRANCH01
```

**Salesman chuyển franchise** là trường hợp riêng: họ vẫn là salesman nên luật "không còn salesman"
không bắt, và họ sẽ giữ membership `active` ở công ty **cũ** mãi mãi — hai công ty, một người. Nay
membership ở tenant khác franchise hiện tại cũng bị suspend.

### E2E phải có tenant riêng

Demo owner bị suspend → suite không đăng nhập được. Không khôi phục demo (nó chính là thứ vừa bị bỏ);
tạo `E2ESHEDS` bằng `seed.ts` với `SEED_COMPANY_CODE=E2ESHEDS`. **Một suite không được phụ thuộc tenant
mà người thật dùng.**

### Ba lỗi trong chính code tôi viết, lộ ra khi đo

1. **`'shedsafe'` không có trong allow-list của bridge** → `/shedsafe/salesmen` trả 404 "No such route",
   panel rơi về "could not confirm" và **không chặn** — đúng thiết kế nhưng vô dụng. Trùng lỗi `members`
   vs `team` đã ghi trong file đó.
2. **Regex `/Registered ShedSafe salesman/i` khớp cả câu "not a registered…"** → test đọc nhánh "được
   phép" trong khi trang cố ý chặn. Phải neo `^`.
3. **Test height dùng `before` từ state còn sót của test trước** → xanh khi chạy riêng, đỏ trong suite.
   Sửa: tự đặt cả hai đầu.

### Đo được

| | |
|---|---|
| `POST /building/create` cùng Reference 2 lần | **2 id khác nhau** (trước khi sửa) |
| `PUT /building/update` | 200, giữ id |
| `getsalesmanusers` | 9 salesman |
| Panel, login hợp lệ | *Registered ShedSafe salesman — Jayy Ngo, Head Office.* |
| Panel, `+1` (đã xoá khỏi ShedSafe) | *not a registered…* + nút **tắt** |
| Login của user bị suspend | 401 |

---

## 13.25 Tự đồng bộ sau khi Auto Calc — không điều khiển được tab ShedSafe, nhưng **hỏi lại** được (2026-11-10)

Vấn đề: `GO TO SITECHECK` mở tab mới, Auto Calc là thao tác của người dùng **bên đó**, nên sản phẩm
không biết khi nào xong và không kiểm soát được gì.

### Đo trước: không có API Auto Calc

Dò 15 tên endpoint khả dĩ (`/autocalc`, `/auto-calc`, `/building/calculate`, `/building/process`,
`/building/pinlocation`…): **tất cả 403**. Và 403 ở đây nghĩa là "route không tồn tại" —
`/building/getsalesmanusers` → 200, thêm một chữ vào tên nó → 403. Licence server cũ cũng chỉ gọi 8
endpoint, không có cái nào tính toán.

**Nhưng `autoCalc` nằm trên cùng record mà `read()` đã đọc**, và nó lật ngay khi người dùng bấm xong.
Một lần đọc: **1 361 bytes, ~300 ms**.

### Cách làm: route nhẹ + polling 10 giây

`GET /site-checks/:id/status` — **không ghi gì**, trả `{ configured, calculated, missing, errorMessage }`.
Tách khỏi import vì import **ghi** (lưu số, ghi lỗi); poll import sẽ viết lại cùng dòng mỗi 10 giây và
biến một lần mạng chập thành một lỗi được lưu.

Client (`siteCheckState.tsx`):
- **10 giây**, không phải 5. Operator chọn vậy: một lần đọc ~300 ms, 5 giây = 720 request/giờ cho một
  panel mở — đúng kiểu traffic làm partner API rate-limit cả công ty.
- **Không poll khi tab ẩn** — người dùng đang ở tab ShedSafe.
- **Poll ngay khi tab hiện lại** (`visibilitychange`) — tín hiệu rẻ và chính xác nhất: họ vừa quay về
  từ chỗ vừa làm xong.
- **Dừng khi có lỗi từ ShedSafe** (`errorMessage`) — Auto Calc hỏng thì poll lại cũng nói vậy, và chờ
  im lặng trông như đang chạy.

### Lỗi tôi tự tạo, và nó chỉ lộ ra khi đo

Lần đầu, khi poll thấy `calculated: true` tôi gọi `reload()`. **Không có gì xảy ra.**

`reload()` đọc `GET /quotes/:id/site-check`, trả từ **cột** của `site_checks` — mà cột đó vẫn null cho
tới khi **import** ghi vào. Nên: poll đúng `true` → `reload()` trả `false` từ DB của chính mình → panel
tiếp tục nói "not Auto Calculated yet" và `watching` đứng mãi ở true.

Đo trong trình duyệt: route status nói `true`, wind vẫn `—`, pill không đổi. Phải **import rồi mới
reload** — import là bước chép số vào dòng, reload đọc thứ nó vừa ghi. Bỏ bước một thì bước hai vô nghĩa.

### Đo được sau khi sửa

| | |
|---|---|
| Trước pin | không có banner "Watching" |
| Sau pin | *"Watching ShedSafe for Auto Calc — checking every 10 seconds. Nothing is saved until it finishes."* + nút **Stop watching** |
| Bước 4 trong hướng dẫn | đổi thành *"Come back to this tab — the rating is picked up automatically."* |
| Khi `autoCalc` lật (đo trên building thật `A5`) | **giây thứ 4**: `windRegion` `—` → **`A5`**, nhãn **"from the site check"**, banner chưa-tính biến mất, nút Stop biến mất |
| Route status, check chưa có building | `missing: true`, không phải lỗi |
| Route status, cross-company | **404** |

### Vẫn không làm được, phải nói rõ

- **Không tự bấm Auto Calc** — không có endpoint, và kể cả có thì đó là hành động thay mặt kỹ sư trên
  hệ thống chứng nhận của họ.
- **Không biết họ pin đúng toạ độ nào** — chỉ biết rating đã được tính.
- **Không poll khi tab ta đóng** — nhưng mở lại thì panel đọc và thấy ngay.

---

## 13.26 Logo: SVG shield → file PNG/ICO thật (2026-11-10)

Yêu cầu: *"icon đang xài svg, bạn replace thành Logo.ico"*, chọn phương án **C** (đổi cả ba chỗ).

### Đo trước: file `Logo.ico` là logo **đã có trong repo**

PNG 256×256 bên trong `Logo.ico` **giống byte-for-byte** với `apps/client/public/logo.png` (cả hai
100.345 byte, `cmp` xác nhận). Không có logo mới — chỉ là cùng một hình ở hai định dạng.

Giải mã `logo.png` (512×512, RGBA, tự viết bộ giải PNG vì không xem được ảnh):

| | |
|---|---|
| Nền | **tấm trắng bo góc**, chiếm **41,9%** pixel |
| Mark | đỏ `rgb(241,37,41)` ở giữa, viền đậm |
| Trong suốt | chỉ **4,0%** — bốn góc bo |
| Độ sáng trung bình | 171,1 / 255 |

Điều đó quyết định cách đặt lên thanh navy: logo **tự mang tấm nền trắng**, nên nó hiện thành một ô
sáng trên nền tối — đọc được, không cần asset thứ hai cho theme tối.

### Ba chỗ, và mỗi chỗ cần một định dạng

| Chỗ | Trước | Sau |
|---|---|---|
| favicon (`layout.tsx` × 3 app) | SVG data-URI **vẽ lại** shield | `/favicon.ico` — **8 kích thước** 32→256, browser tự chọn bản nét |
| `apple-touch-icon` | không có | `/logo.png` 256×256 — iOS **bỏ qua `.ico`**, không có nó thì lưu vào home screen ra ô trắng |
| `BrandMark` (4 component) | SVG shield | `<img src="/logo.png">` |

### `tone` giữ lại nhưng đổi nghĩa

Bitmap không đổi màu được, nên `tone` **không còn tô màu mark**. Nó quyết định **viền**: trên nền
trắng, tấm nền nhạt của logo lẫn vào background nên `ink` thêm hairline `border-sq-line`; trên navy thì
tấm trắng đã là viền. Giữ prop để bốn call site không phải sửa, và ghi rõ trong code để người sau không
tưởng nó nhuộm ảnh.

### Đo được trong trình duyệt (cả ba app)

| | client | admin | site |
|---|---|---|---|
| `link[rel=icon]` | `/favicon.ico`, sizes `32x32 48x48 256x256` | ✓ | ✓ |
| `link[rel=apple-touch-icon]` | `/logo.png` 256×256 | ✓ | ✓ |
| logo render | **28×28** | 22×22 | 24×24 |
| nguồn | `natural 512×512`, HTTP 200 `image/png` | ✓ | ✓ |
| SVG mark còn lại | **0** | 0 | 0 |

Tương phản trên thanh navy `rgb(7,24,50)`: logo có **44,2%** pixel gần trắng (độ sáng 255), tối nhất
52 — tấm trắng nổi rõ trên navy, mark đỏ đọc được. Không cần đổi màu gì.

### Vẫn để nguyên, có chủ ý

`logo.png` ở 28 px từ nguồn 512 px là **thu nhỏ 18×**. Trình duyệt lấy mẫu tốt nên vẫn nét, nhưng một
file 64 px riêng cho thanh bar sẽ còn sạch hơn. Không làm vì: `logo.png` đã dùng cho PDF tài liệu khách,
và thêm một biến thể nữa là thêm một chỗ để hai bản lệch nhau.

---

## 13.27 Save ở góc phải trên, mọi step (2026-11-10)

Yêu cầu: *"làm button save ở trên right-top đi, step nào cũng có thể save quote được ko cần done 3 step"*.

### Trước: nút Save chỉ có ở step 3

Nằm trong thanh `sticky bottom-0`. Step 1–2 có nút **điều hướng** (`Next: the plan`, `Next: cost`) và
một câu giải thích: *"The quote is saved on the last step — step 3, Cost and price."*

Câu đó là **luật do giao diện tự đặt**, không phải của nghiệp vụ: `save()` đọc draft và evaluation từ
store, **không đọc `step`**. Server chưa bao giờ từ chối lưu từ step 1. Chỉ màn hình từ chối.

Hệ quả thật: người dùng điền khách + địa chỉ + công trình ở step 1 rồi bị gọi đi — không có gì để quay
lại. Và ba step không phải wizard phải đi hết; chúng là ba góc nhìn của **một** quote.

### Sửa

| | |
|---|---|
| Vị trí | header step, cạnh `h1`, `justify-between` + `ml-auto` |
| Hiện ở | **cả 3 step**, đúng **một** nút (không hai nút cho một hành động) |
| Nhãn | `Save quote` khi chưa có quote → `Save revision` sau khi lưu |
| Lý do khi tắt | `#save-reason`, nằm **trong trang**, không phải tooltip |
| Thanh bottom | chỉ còn `Back` + `Next`, và câu "This step is ready. Save stays available in the top right on every step." |
| `StatusPill "Saved …"` | cạnh nút, để phản hồi ở đúng chỗ vừa bấm |

### Hai lỗi đo được trong lúc làm

**1. Lý do nghịch với nút.** `gateMessage` rẽ nhánh theo `pricedAt` một mình, nên trên quote **trống**
— giá đã tự tính (`current`) nhưng 6 field còn rỗng — nó in *"Saves revision 1 and freezes the price…"*
cạnh một nút **disabled**. Nay `gate.reasons[0]` là nguồn: chỉ khi không bị chặn mới mô tả lần lưu.

**2. Nút cuộn khỏi màn hình.** Đo ở 1280×900: sau khi điền step 1, header ở `top: −563`. Nút "có ở mọi
step" nhưng cách 563 px phía trên khi người dùng đang gõ. Header thành `sticky top-[3.9rem] z-10`
(offset `3.9rem` để né dải giá cao 61 px ở dưới `xl`; `xl:top-0` vì dải đó không render ở đó). `z-10`
thấp hơn dải giá (`z-20`) vì con số đang báo giá không được bị che.

### Đo được

| | |
|---|---|
| `saveCount` ở cả 3 step | **1** |
| Cuộn 1200 px | Save ở `top: 56`, `onScreen: true` |
| Quote trống, lý do | *"6 fields need attention."* (không phải "Saves revision 1…") |
| Điền đủ → lưu **từ step 1** | URL `/quotes/84d9b25d…/edit`, **step vẫn "Quote details"**, nhãn đổi thành `Save revision` |
| 390 px | nút `111×44`, `overflowX: 0` |
| `pageOverflowX` ở 1280 px | 0 |

### E2E (3 test mới)

- Save có trên cả ba step, đúng một nút, và **vẫn thấy sau khi cuộn 900 px** ở từng step.
- Nút tắt thì lý do nằm trong trang, và **không** phải "Saves revision" khi bị chặn.
- Lưu từ step 1: URL đổi, step **không** đổi, nhãn thành `Save revision`.

Lỗi trong chính test: tôi tìm `getByRole('tab')` nhưng `StepRail` là `<ol>` chứa `<button>` với
`aria-current="step"`. Locator không tồn tại, `.catch()` chờ hết 60 giây. Sửa thành `ol button` + khẳng
định heading của step, để một cú click rail không làm gì cũng không thể "pass".

### Giữ nguyên có chủ ý

**Vẫn chặn lưu khi giá lỗi thời.** Sửa span ở step 1 → giá cũ → nút tắt với lý do *"Calculate the price
again before saving"*. Bỏ luật đó là cho phép đóng băng một revision có giá không khớp công trình.

---

## 13.28 Giá trị gợi ý lấy từ sách, và nút "Use the suggested values" (2026-11-10)

Yêu cầu: *"như desktop thì ko có giá trị default cho các thuộc tính span, height (nhưng có min), toàn bộ
ko có set default sẵn, nhưng có 1 alert thông báo còn bao nhiêu field require chưa điền, và có button
auto fill các field đó > dạng khách hàng chủ động auto fill"*.

### Kiểm chứng đầu tiên: desktop **có** default, và nó ở trong DB

`ServiceStructureData.ShedParameters.cs:184-200`:

```csharp
if (isCreateFile) {
    if (spanDefault == 0) spanItem.DisplayValue = null;
    else                  spanItem.DisplayValue = spanDefault;   // ← ÁP DEFAULT
    ...
}
```

Và `view_system_shed_parameters` (sách thật, 6 dòng, cả 6 đều có giá trị):

| | default | min | max | hints |
|---|---|---|---|---|
| span | **6000** | 1800 | **15000** | 6000 … 15000 (7 giá trị) |
| height | **3000** | 2200 | **6000** | 3000 … 6000 (5) |
| bay | **3000** | 1000 | **4000** | 3000, 3500, 4000 |
| roof pitch | **null** | 7.5 | 15 hoặc 30 | 7.5 … 30 (6) |

Nên desktop tạo quote mới ở **6 m**, không phải trống. Điều **không** đúng: default hard-code trong
code — cả ba đều đọc từ DB.

### Cái thật sự sai trong v2

`DEFAULT_SHED` hard-code `span: 12000, height: 4200, length: 24000, bays: 4`, và editor giới hạn span
`2000..30000`. Trong khi sách **cap ở 15000** — nên một span 24 000 được chấp nhận và sau đó **không có
dòng khung nào** để định giá, lộ ra hai bước sau dưới dạng giả định trong BOM. Cùng họ với wind region bị
thu hẹp: một con số mà engine không có dòng nào cho nó.

### Sửa

**`Catalogue.dimensions`** (mới) — `span/height/baySpacing/roofPitch`, mỗi cái `{ defaultValue, min, max, hints }`,
đọc từ `view_system_shed_parameters`. `hints` **dedupe + sort**: sách lưu một dòng mỗi nhóm nên
`span` có **38 dòng cho 7 giá trị** — dropdown hiện 7 500 mm năm lần trông như dữ liệu hỏng.

Khi 6 dòng mâu thuẫn (nhóm cap pitch 15°, nhóm khác 30°), lấy **hợp rộng nhất**: min của các min, max
của các max. Hẹp hơn sẽ từ chối một nhà mà sách định giá được.

**`suggestedValues(config, dimensions)`** (`domain/suggest.ts`, mới) — trả **phần chênh lệch**:

```
Span: 12,000 → 6,000 mm
Wall height: 4,200 → 3,000 mm
Bay spacing: 6,000 → 3,000 mm
[Use the suggested values]
Nothing changes until you press it — these are the book's defaults, not your building.
```

Danh sách **rỗng** khi màn hình đã khớp sách → không có nút, thay vì một nút bấm không làm gì.
Roof pitch **không bao giờ được gợi ý** vì sách không nói (`NULL`, không phải 0): pitch phụ thuộc span,
đó là lý do desktop lọc danh sách pitch theo span.

**Bounds thật cho field** — `spanBounds`/`heightBounds` từ sách thay `2000..30000` và `2000..12000`.

### Lỗi thứ ba, chỉ lộ ra khi bấm thử

`DimensionField.commit` **từ chối im lặng** giá trị ngoài khoảng: `return` mà không nói gì, rồi `onBlur`
reset text về giá trị đã lưu. Đo được: gõ 24 000 vào span → hộp hiện 24 000, config vẫn 6 000, **không
một chữ nào giải thích**, và blur xoá luôn số vừa gõ. Người dùng chỉ biết gõ lại.

Nay nó nói:

> *"24000 mm is above the largest this book sells (15000 mm)."*

và text **giữ nguyên** khi bị từ chối (chỉ reset khi đã chấp nhận), để câu giải thích và ô field khớp nhau.

### Alert "còn bao nhiêu field" — v2 **đã có nhiều hơn** desktop

`ErrorSummary` hiện `"6 fields need attention"` và mỗi dòng là một **button nhảy tới field**
(`ErrorSummary.tsx:104`). `StepRail` hiện `noticeCount`. Desktop chỉ báo lỗi từng field, không tổng.
Nên đây là chỗ v2 hơn, không phải thiếu.

### Đo được trong trình duyệt

| | |
|---|---|
| Panel trên quote mới | 3 dòng: `12,000 → 6,000` · `4,200 → 3,000` · `6,000 → 3,000` |
| Bấm "Use the suggested values" | span **6000**, height **3000**, panel **biến mất** |
| `outsideBookBounds(24000, span)` | `above` (sách 1800–15000) |
| Gõ 24000 vào span | *"24000 mm is above the largest this book sells (15000 mm)."*, giá trị bị từ chối |

### Không làm trong lượt này

- **`BayLargest` cho BOM.** v2 dùng `ceil(length/bays)`; desktop dùng **bay lớn nhất** làm khoá tra
  kết cấu, nên nếu các bay khác nhau thì member size khác. Chưa cấp bách: v2 chưa cho sửa từng bay.
- **Roof pitch lọc theo span.** Cần bảng span↔pitch; hiện chỉ hiện 6 gợi ý chung.
- **Adjust Bay Spacing** (sửa từng bay).

---

## 14. Kiểm thử hiện tại
| Lớp | Số test |
|---|---|
| `@sq/core` | 1 024 (domain, BOM, giá, tài liệu, catalogue, placement, add-mode, vqu, steelwork, punchings, infill, skylight, mezzanine, door frames, sliding doors, integrity, legacy `.sqd` import, freight, **`averageHeightMm`/`ridgeHeightMm`**, **Importance Level 1–4**, **wind region codes `windRegionCode`/`windRegionLetter`/`nearestTerrainCategory`**, **8 cho `suggestedValues` + `outsideBookBounds`**) |
| `@sq/api` | 293 (auth, quote, evaluate, catalogue, site-check + autoCalc guard, ShedSafe pin payload, **`pinnedFor` — tham số lúc pin được lưu và đọc lại**, send modes, members, punchings, template files, template scope, template file flags, enquiry notification, body limit, pricing, `.sqd` import route, freight minimums, freight minimum **enforced on save**, quote header follows its newest revision, vendor usage route, visitor hashing + activity log, **AES-GCM address + mask/handle**, **5 cho `GET /site-checks/:id/status`** — Auto Calc watch: đọc không ghi, `missing` khác lỗi, cross-company 404) |
| `@sq/db` | 18 |
| `@sq/contracts` | 15 |
| `@sq/client-app` | 50 (form, category dock, `ControlSheet`, unsaved-changes guard, validation rules, editor fragment, `.sqd` import screen) |
| `e2e` (Playwright) | 31 (sign in, create-or-reuse+save, reopen, settings save, send dialog, leave-guard both ways, price visible at every width, strip stays pinned, no sideways scroll, mobile menu, breadcrumb touch target, sign out; 4 legacy `.sqd` import — reads, reports, opens, edits all three steps, saves and reopens; **3 vendor dashboard** — wrong password refused, sign in + read + sign out, docs page; **11 Step 1** — vị trí ShedSafe giữa Delivery và Design, 6 giá trị readonly + nhãn nguồn, State/Internal pressure vẫn sửa được, avg/ridge height, PIN nói rõ thiếu gì, PIN bật khi đủ, đổi scope thì bỏ tick, **2 salesman gate** — trạng thái luôn được nói, login không phải salesman thì chặn kèm lý do; **3 Save từ mọi step** — có mặt cả 3 step đúng 1 nút + vẫn thấy khi cuộn, lý do trong trang, lưu từ step 1 ở lại step 1) — needs `pnpm dev`; **leaves no rows behind** |

Chạy toàn bộ: `npx turbo run test`. Typecheck: `pnpm --filter @sq/<pkg> typecheck`.

## 15. Dev workflow — đừng xoá `dist` khi dev server đang chạy

Script `build` của `@sq/core` và `@sq/contracts` là `rimraf dist && tsup`. Chạy nó trong lúc
`next dev` / API `tsx watch` đang sống sẽ **xoá `dist`** mà hai process đã import từ đó:
client trả 500, API chết (`ECONNREFUSED` ở client vì API đã tắt).

Dùng **`pnpm build:inc`** (tsup không `rimraf`) khi cần rebuild trong lúc dev. Nó ghi đè file,
không xoá thư mục, và đã kiểm: sau khi chạy, client 200 / API 200.

Scripts:

- `pnpm dev` — turbo chạy cả API và client (`dependsOn: ^build` một lần đầu).
- `pnpm build:inc` — core + contracts, không xoá `dist`.
- `pnpm build` — bản sạch, dùng cho CI/release, **đừng chạy khi dev đang mở**.

**Vẫn còn một race nhỏ:** `tsup` ghi đè entry của contracts; nếu API `tsx watch` restart đúng lúc
file đang được ghi, nó log `ERR_MODULE_NOT_FOUND … @sq/contracts/dist/index.js` và đứng chờ thay
đổi. Cách xử: **restart API sau `build:inc`**, hoặc chạy `build:inc` **trước** khi bật dev.

### Migration trên Windows — checksum chuẩn hoá CRLF

`migrate()` băm **nội dung file** để phát hiện sửa đổi. Trên Windows, `core.autocrlf` đổi LF thành
CRLF khi checkout, nên checksum lệch với cái đã ghi và `migrate` từ chối chạy:

```
Migration 009_… has changed since it was applied (recorded 2e0edeeb41d1, file 7c274a3d0328).
```

Không ai sửa file — chỉ là line ending. Đã sửa ở `packages/db/src/migrate.ts`: `checksumOf` đổi
`\r\n` → `\n` trước khi băm. Guard vẫn bắt được **sửa thật**, và nghĩa của nó giống nhau trên cả
hai nền tảng.

**Hệ quả cần biết:** migration 010, 011, 012 chưa từng chạy trên Postgres dev trước 2026-11-05 —
lỗi này đã che chúng. Nếu một route báo `column "…" does not exist`, chạy `pnpm db:migrate` trước
khi tìm lỗi trong code.
