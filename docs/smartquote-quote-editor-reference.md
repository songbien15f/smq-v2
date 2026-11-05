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
| R6 track/sliding/carry beam xung đột | ⚠️ **một phần** | Xoá cửa gỡ `carry_beam.openingId` (`removeOpeningWithCascade`); rule "track bị chiếm thì từ chối" **chưa có** — cần model track như một đối tượng, v2 có `opening.track` là thuộc tính. Xem §12 |
| R7 carry beam > 15 m | ✅ | `carryBeamRefusal` |
| R8 cửa cao hơn sàn mezzanine | ✅ | `optionsUnderMezzanine` — §6 |
| R9 (cùng R8 — xem ghi chú §6.3) | ✅ | `optionsUnderMezzanine` |
| R10 roller door tối thiểu | ✅ | `placeOpening` |
| R11 track 1000–6000 | ✅ | `placeOpening` |
| R12 snap theo tấm mái | ✅ | `skylightSnap.ts` — §6.2 |

**R6 là rule duy nhất còn một nửa**, và nửa còn lại cần model track như đối tượng — xem §12.

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
| 1 | Phiếu punchings cho **roller-door column/header** | Cần model mullion/header của `RDoor` — chưa có trong v2 |
| 2 | **R6 nửa còn lại: track bị chiếm thì từ chối** | Cần model **track như một đối tượng** có vị trí riêng; v2 có `opening.track` là thuộc tính của cửa, nên "cửa khác đè lên track" không diễn đạt được |
| 3 | **Đặt cột infill quanh cửa không cuốn** (PA, cửa sổ) | Desktop chỉ re-space cho cửa cuốn; cửa nhỏ thì cột nằm nguyên. Chưa rõ desktop có ý định khác không |
| 4 | **Nhóm 4** | Rate table xong; ba mục còn lại **không phải việc port** — xem kết luận dưới |
| 5 | Hướng outrigger (left/right) | Chỉ là field hiển thị; `wall` đã bao trùm ngữ nghĩa |

> **Ba lần tôi kết luận "bị chặn" và cả ba lần đều sai:** Punchings (§12.4), R12 skylight, và R9.
> Mỗi lần nguyên nhân giống nhau — tôi tin một ghi chú cũ của chính mình thay vì đọc code desktop.
> Khi một mục có vẻ bị chặn, việc đầu tiên là **tra bảng dữ liệu và đọc hàm desktop**, không phải
> viết "cần model mới".

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

**Còn một phần chưa làm của form gốc:** `PunchingDetailForm` cũng in phiếu cho **infill column**,
**roller-door column** và **roller-door header**. Ba loại này cần model cột infill (R3/R5) — xem
bảng "Chưa có" ở §6. Phiếu cho **C1/R1/C2/R2** thì đã đủ, và đó là 4 thanh của mọi khung.

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

### Chưa làm — vì model chưa có

Phiếu cho **roller-door column** và **roller-door header** (hai nhánh cuối của `PunchingDetailForm`)
cần model `RDoor` có mullion/header như desktop. Xem R5 ở §6.

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
| `@sq/core` | 886 (domain, BOM, giá, tài liệu, catalogue, placement, add-mode, vqu, steelwork, punchings, infill, skylight, mezzanine headroom) |
| `@sq/api` | 180 (auth, quote, evaluate, catalogue, site-check, send modes, members, punchings, pricing) |
| `@sq/contracts` | 15 |
| `@sq/client-app` | 8 (form + category dock) |

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
