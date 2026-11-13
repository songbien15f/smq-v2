# 3D cửa theo loại — tham khảo Quotec (QuoteItNow)

> **Trạng thái**: **ĐÃ SHIP 2026-11-13** — xem §9 để biết cái gì đã vào luồng chính. Phần §4–§8
> giữ nguyên như bản đề xuất ban đầu, để đọc lại quyết định.
>
> **Đối tượng so sánh**: v2 `apps/client/src/components/editor/Shed3D.tsx` (three.js) với sản phẩm
> thương mại Quotec — https://www.quotec.com.au/quoteitnow/ (app: `quotecnow.quotec.com.au`).

---

## 0. Giới hạn của lần khảo sát này

Phiên làm việc này **không xem được ảnh** (model không nhận image input). Vì vậy mọi kết luận dưới đây
là bằng chứng kỹ thuật — bundle JS, tài nguyên tải về, API, cấu trúc dữ liệu — **không phải** đánh giá
bằng pixel. Những chỗ cần nhìn mắt (bố cục, chất lượng render thực tế) phải do người dùng xác nhận.

Đã đi đúng luồng thật: chọn *Shed* → nhập địa chỉ → *Start Design* → tab **3D** trong trang thiết kế.

---

## 1. Quotec dựng 3D thế nào

### 1.1 Kiến trúc trang

| Thành phần | Ghi nhận |
|---|---|
| Trang marketing | WordPress, nhúng `<iframe src="https://quotecnow.quotec.com.au">` |
| App thiết kế | Vue 3 + Vite, route `/job/design/newbuilding/<id>` |
| 2D/plan | `snap.svg` + `jsclipper` + `lz-string` |
| 3D | three.js **đóng gói trong chunk**, không phải bản global (`window.THREE === undefined`) |
| Canvas 3D | WebGL2, 1252 × 858 (viewport 1280 × 720) |

### 1.2 Bằng chứng three.js

Chunk: `/production/assets/stepdownDesigner.CB2mkr8l.js`, **1,65 MB**. Các ký hiệu tìm thấy trong đó:

```
WebGLRenderer, BufferGeometry, MeshStandardMaterial, MeshPhysicalMaterial,
ShaderMaterial, MeshBasicMaterial, PerspectiveCamera, OrbitControls,
TextureLoader, CylinderGeometry, ExtrudeGeometry, BoxGeometry,
InstancedMesh, PMREMGenerator, ACESFilmicToneMapping, RepeatWrapping,
DirectionalLight, HemisphereLight, AmbientLight, castShadow, shadowMap, sRGB
```

Số lần xuất hiện (dùng như chỉ báo độ dày hình học, không phải số tuyệt đối):

| Ký hiệu | Lần | Ký hiệu | Lần |
|---|---|---|---|
| `BoxGeometry` | 80 | `CylinderGeometry` | 16 |
| `ExtrudeGeometry` | 30 | `TorusGeometry` | 4 |
| `BufferGeometry` | 47 | `InstancedMesh` | 15 |
| `MeshStandardMaterial` | 29 | `ShaderMaterial` | 25 |
| `castShadow` | 67 | `shadowMap` | 91 |
| `DirectionalLight` | 23 | `HemisphereLight` | 12 |
| `PMREMGenerator` | 3 | `ACESFilmicToneMapping` | 3 |

**Không có file GLB/GLTF/OBJ/FBX nào được tải.** Toàn bộ hình học dựng bằng code.

### 1.3 Vật liệu, ánh sáng, bóng

- **6 texture duy nhất**: `tx-sky.png`, `tx-grd.png`, `tx-horiz.png`, `tx-concrete3.jpg`,
  `tx-insulation2.jpg`, `tx-zinc2.jpg` — trời, nền/lưới, tôn ngang, bê tông, cách nhiệt, tôn zinc.
- `RepeatWrapping` + `TextureLoader` → texture lặp theo module tấm, không dán một ảnh cho cả mảng.
- `ACESFilmicToneMapping` + `PMREMGenerator` (environment map) + shadow map: đây là ba thứ làm ảnh
  "đẹp" hơn hẳn một scene ba đèn cơ bản, và **không liên quan gì tới hình học**.
- `InstancedMesh`: các phần tử lặp (purlin/cột/connector) vẽ một draw call.

### 1.4 Chi tiết được model như hình học, không phải ảnh dán

Tần suất chuỗi trong bundle (chỉ báo phạm vi mô hình hoá):

| Chuỗi | Lần | Chuỗi | Lần |
|---|---|---|---|
| `slat` | 194 | `Rafter` | 567 |
| `Purlin` | 442 | `Jamb` | 416 |
| `Roller` | 372 | `Flashing` | 343 |
| `Mullion` | 265 | `Gutter` | 106 |
| `Window` | 108 | `Downpipe` | 78 |

Kết luận: họ model **từng chi tiết phần cứng** (slat, jamb, mullion, ray, flashing) và dùng texture
cho **bề mặt tấm**. Đây đúng là cách chia mà tôi đề xuất cho v2: texture cho vật liệu, hình học cho
phần cứng — không dán ảnh để giả chi tiết.

### 1.5 Dữ liệu dựng 3D

Không có model dựng sẵn; 3D dựng client-side từ API của job:

```
GET /api/v1/job/designdata?BuildingCategory1Id=…&WindSpeedId=…&EngineeringSetId=…
GET /api/v1/jobengineering/majorframe
GET /api/v1/job/windcheckresult/<lat>-<lng>-<state>-<wind>
GET /api/v1/job/newbuilding?…&addressId=…
```

`designdata` trả các **chuỗi JSON lồng trong JSON**:

| Khoá | Kích thước | Nội dung |
|---|---|---|
| `RollerDoorItemsJson` | 2 979 món | catalogue cửa cuốn |
| `WindowItemsJson` | 678 món | catalogue cửa sổ / cửa trượt |
| `MinorFramesJson` | 4 106 dòng | khung phụ (purlin, eave…) |
| `OtherJson.Doors` | 411 | cửa nói chung |
| `OtherJson.Connectors` | 29 705 | chi tiết liên kết |
| `OtherJson.DependentItems` | 2 069 | phụ thuộc |
| `OtherJson.FlyBracingItems` | 349 | giằng |
| `OtherJson.Openings` | 9 | **luật chọn header/jamb** |
| `OtherJson.ItemProfiles` | 7 | tiết diện |

Một món cửa trong catalogue của họ có các trường quyết định hình vẽ:

```json
{
  "Name": "Sliding Door 2100 x 1810 4mm Clr Tghn S0800 U2000 W300pa w/Trim",
  "Usage": "SLIDING",
  "DrawHint": "SLIDEDOORL",
  "Height": 2100,
  "Width": 1810,
  "DisplayColour": "#DDDDDD",
  "BrandId": "7"
}
```

**`DrawHint` là bài học lớn nhất**: renderer chọn hình theo mã vẽ của SKU, không tự suy từ loại +
kích thước. Cùng một `Usage` có thể có nhiều `DrawHint` (trái/phải, một cánh/hai cánh…).

### 1.6 Bảng `Openings` của họ — dầm đầu và jamb là luật kỹ thuật

9 dòng, mỗi dòng:

```
MinWidth .. MaxWidth, MinHeight .. MaxHeight, MinBuildingHeight .. MaxBuildingHeight
  → HeaderItemId + JambItemId
```

Ba bậc chiều cao nhà: `≤ 3 600`, `3 600–5 000`, `> 5 000`; chiều rộng cửa chia ở `4 500` và `5 000`.
Nghĩa là **tiết diện dầm đầu và cột jamb được chọn theo kích thước cửa và chiều cao nhà**, không suy
từ một cột trong bảng frame schedule.

Đối chiếu: plan v2 hiện định đọc cột `DM` (mullion) / `DH` (header) trong bảng structure. Cả hai đều
là dữ liệu thật; khác nhau ở chỗ Quotec tách thành bảng `openings` chuyên biệt. Đây là **quyết định
cần chốt** (xem §5.1).

### 1.7 Chế độ xem

Thanh công cụ của họ: `FRONT / LEFT / BACK / RIGHT / PLAN / 3D / FULL / NO ROOF / FRAME / DIMENSION`.

`NO ROOF`, `FRAME`, `DIMENSION` chỉ là lọc hiển thị + đường đo — rẻ, và rất hữu ích khi bán hàng
(cho khách thấy khung, thấy kích thước).

---

## 2. v2 hiện tại

### 2.1 Stack

| Thư viện | Phiên bản | Dùng ở đâu |
|---|---|---|
| `three` | 0.186.1 | `Shed3D.tsx` |
| `@react-three/fiber` | 9.8.1 | `Render3D.tsx` (`<Canvas>`) |
| `@react-three/drei` | 10.7.9 | chỉ `OrbitControls` |
| `@types/three` | 0.186.0 | type |
| `konva` / `react-konva` | 10.9.1 / 19.3.2 | 2D |

Chỉ hai file chạm 3D: `Render3D.tsx` (camera, đèn, đất, grid, orbit) và `Shed3D.tsx` (toàn bộ hình học).

### 2.2 Vật liệu và ánh sáng hiện có

`Render3D.tsx`:

- `hemisphereLight` cường độ 1.1 + `directionalLight` 1.4.
- Bóng đổ **chỉ desktop** (`useMediaQuery`), shadow map 2048.
- Nền: một `planeGeometry` màu phẳng `#cfd8dc` + `gridHelper`.
- Không có texture, không có tone mapping, không có environment map.

### 2.3 Cửa trong 3D hiện tại

`Shed3D.tsx:293-383` — mỗi lỗ đúng **một tấm hộp**, không có mảnh nào nhô ra ngoài mặt phẳng tường:

| Loại | Hiện có | Hệ quả thị giác |
|---|---|---|
| `roller_door` | tấm 20 mm + gờ ngang 18 × 8 mm mỗi ~450 mm | gờ quá mảnh ở tỉ lệ 1:1000 ⇒ đọc thành tấm phẳng |
| `window` | kính 12 mm opacity 0.35 + **khối đặc lớn hơn lỗ 60 mm mỗi cạnh** đặt **phía sau** kính (`z = +8`, tức hướng vào trong nhà) | khung không lộ ra; kính nằm trên một tấm đặc ⇒ cửa sổ đọc thành hình chữ nhật |
| `pa_door` / `sliding_door` | tấm 25 mm + hộp nhỏ hơn 60 mm màu barge; sliding thêm 1–2 ray trên đầu | đọc thành tấm có viền |
| `opening` | chỉ khoét lỗ | đúng |

### 2.4 Khác biệt then chốt: 2D có ký hiệu, 3D không

`packages/core/src/domain/plan.ts:229-298` vẽ ký hiệu riêng cho từng loại:

- `opening`: hình chữ nhật nét đứt (lỗ trống).
- `window`: khung + **2 đường inset dọc + 1 ngang**.
- `roller_door`: curtain + **2 ray hai bên** + stack mark.
- `pa_door` / `sliding_door`: jamb hai đầu + cánh 45° + **cung quay**; sliding thêm **đường ray**
  (`TRACK_INSET`, ray thứ hai khi `track = 'double'`).

Các hằng số 2D (`plan.ts:133-147`):

```
JAMB = 90                WINDOW_DEPTH = 90      WINDOW_INSET = 45
OPENING_HOLE_DEPTH = 90  ROLLER_DEPTH = 180     ROLLER_INSET = 45
ROLLER_TRACK_WIDTH = 45  TRACK_INSET = 60
```

3D **không dùng** các hằng số này; nó tự đặt `WALL_DEPTH = 50` và các con số rời (60, 20, 25, 12).
Vì vậy 2D và 3D hiện không khớp nhau về cùng một chi tiết.

### 2.5 Lỗi và khoảng trống đã xác định

1. **Cửa sổ không có khung nhìn thấy được** (`Shed3D.tsx:347-350`): "khung" là box kích thước
   `hole + 60` cả hai chiều, dày 20, tại `z = +8`. Trong hệ toạ độ tường do `buildWallGeometries`
   đặt ra, **`+z` là hướng vào trong nhà** (phần extrude chạy vào phía trong), nên tấm này nằm **sau**
   kính; phần viền thừa 60 mm bị chôn trong tường nên không lộ ra. Kết quả: không thấy khung, kính
   nằm trên một tấm đặc — đọc thành một hình chữ nhật. Đây là lỗi, không chỉ thiếu chi tiết.
2. **Comment dẫn test không tồn tại**: `Shed3D.tsx:11` nói hình học được "pinned by
   `__tests__/walls3d.test.ts`" nhưng file đó không có. `hasOpeningPanel`, `hasTrackRail`,
   `buildOptionMeshes` không có test ở client.
3. **Cửa cuốn không có phần cứng**: không ray dẫn, không khung đầu, không tang cuốn, không bracket.
4. **PA door không thể hiện hướng mở** dù `Opening.swing` đã có.
5. **Sliding door không có số cánh**: `Opening` chỉ có `track: 'none' | 'single' | 'double'` (nói về
   ray), không nói 1 hay 2 cánh; desktop có `SDType` (`DoubleInSingleBay`…).

### 2.6 Desktop (tham chiếu thứ hai)

`smq-code-smartquote/Modules/PLan3D` — 37 element, 8 709 dòng. Cửa có node riêng:

- `RDoor3D.cs`: mặt cửa dán texture tôn, khung đầu, 2 ray dẫn, tang cuốn, lò xo, bracket, trục.
  Hằng số: `RDOOR_FRAME_THICK = 30`, `ROLLER_RADIUS = 150`, `RDOOR_BRACKET_HEIGHT = 200`,
  `RDOOR_BRACKET_SIZE = 20`.
- `PADoor3D.cs`: khung 4 cạnh (`PADOOR_COLUMN_THICK = 30`), cánh mở theo `PADOOR_ROTATE_ANGLE`,
  giằng chéo.
- `SLDoor3D.cs`: nhiều cánh trên ray `SLDOOR_TRACK1 = 40` / `TRACK2 = 80`, jamb flashing.
- `Window3D.cs`: 2 thanh dọc + 2 ngang + **đố giữa**, kính, viền, flashing trên.

---

## 3. Đối chiếu tổng hợp

| Hạng mục | v2 | Quotec | Desktop cũ |
|---|---|---|---|
| Renderer | three.js qua R3F | three.js đóng gói | OpenTK/OpenGL tự viết |
| Vật liệu | màu phẳng | 6 texture lặp + ACES + PMREM | texture tôn nhúng |
| Bóng đổ | có (desktop) | có, cấu hình đầy đủ | có |
| Cửa: slat | gờ 8 mm | slat model thật | texture |
| Cửa: ray/jamb/mullion | không | có | có |
| Dữ liệu chọn hình | suy từ `type` | `DrawHint` per SKU | class per loại |
| Dầm đầu/mullion thép | chưa (plan DM/DH) | bảng `Openings` → header/jamb | cột DM/DH |
| Chế độ xem | 2D/3D | 10 chế độ (NO ROOF, FRAME, DIMENSION…) | nhiều |
| Kích thước bundle 3D | ~600 dòng TSX | 1,65 MB JS | 8,7k dòng C# |

---

## 4. Đề xuất (chưa làm)

Nguyên tắc: **texture cho bề mặt, hình học cho phần cứng, dùng chung hằng số với 2D**.

### Slice A — Vật liệu & ánh sáng (không đổi dữ liệu, đổi nhiều cảm giác nhất)

- `Canvas gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}`, giữ `dpr [1,2]`.
- Nền: gradient trời sinh bằng `CanvasTexture` (không tải HDR từ CDN) + mặt đất có texture lặp nhẹ.
- Tôn tường/mái: **texture sinh bằng code** (sọc lặp theo bước sóng tôn) làm `map` + `roughnessMap`,
  `RepeatWrapping` theo kích thước thật (cover 762 mm đã có trong catalogue), UV theo diện tích tấm.
- Bóng: `PCFSoftShadowMap`, giữ gate desktop; cân nhắc `ContactShadows` (drei) cho nền.
- Không đụng hình học; tiêu chí: 60 fps trên desktop, không tăng chi phí mobile.

### Slice B — Cửa cuốn có phần cứng

- Ray dẫn 2 bên: tiết diện dùng `ROLLER_TRACK_WIDTH = 45`, sâu `ROLLER_DEPTH = 180` (khớp 2D).
- Khung đầu, tang cuốn Ø300 (`ROLLER_RADIUS = 150` như desktop), 2 bracket, trục.
- Slat: thay gờ 18 × 8 bằng profile sâu hơn (sâu ≥ 25 mm, nhô ≥ 12 mm) hoặc texture gân + normal —
  chọn theo kết quả Slice A.
- Không cần field mới.

### Slice C — Sửa cửa sổ (đang là lỗi)

- Bỏ khối đặc; dựng **4 thanh khung** tiết diện 45 (`WINDOW_INSET`), kính lùi vào 20 mm, 1 đố giữa
  khi `width > 900`, sill nhô 20 mm.
- Test: khung là ring (không có mặt phẳng che kính), đố xuất hiện đúng ngưỡng.

### Slice D — PA door

- Khung 4 thanh 30 mm, cánh dày 40 mm, mở theo `swing` (ví dụ 25°), tay nắm + 3 bản lề.
- Cần chốt: **hướng bản lề** (xem §5.2).

### Slice E — Sliding door

- Mỗi cánh một tấm riêng, lệch khỏi tường theo `TRACK_INSET = 60` (double: 120), chồng nhau ~50 mm.
- Cần chốt: **số cánh** (xem §5.3).

### Slice F — Chế độ xem (sau cùng)

- `NO ROOF`: ẩn group mái. `DIMENSION`: đường đo + nhãn (drei `Line`/`Text`, không cần asset).
- `FRAME`: chỉ vẽ được khi có hình học khung (rafter/purlin/column) — phụ thuộc việc mở rộng 3D ra
  ngoài vỏ nhà, nên để sau.

### Cách triển khai để test được

- Tạo `packages/core/src/domain/openings3d.ts` (thuần, mm) trả về danh sách mảnh:
  `{ kind, position, size, rotation, shape? }` — theo đúng mẫu `buildOptionMeshes`.
- 2D và 3D cùng import hằng số từ một chỗ (`openings.ts`), xoá các con số rời trong `Shed3D`.
- Test đơn vị: đối xứng, số mảnh tối thiểu mỗi loại, tang cuốn nằm trên đỉnh cửa, ray không lấn lỗ,
  cửa sổ không có mảnh nào phủ kính.

---

## 5. Quyết định cần chốt

### 5.1 Dầm đầu/mullion: đọc `DM`/`DH` hay bảng `openings` riêng?

- **DM/DH** (plan hiện tại): ít dữ liệu mới, nhưng một tiết diện cho mọi kích thước cửa.
- **Bảng `openings`** (Quotec): chọn header/jamb theo bề rộng/cao cửa và chiều cao nhà — đúng kỹ
  thuật hơn, nhưng cần bảng mới + dữ liệu + luật chọn.

Đề xuất: làm DM/DH trước để có thép trong BOM; tách bảng `openings` thành slice riêng nếu khách cần
độ chính xác theo kích thước.

### 5.2 Hướng bản lề PA door

`Opening` hiện không có. Lựa chọn: suy từ `align`/`offset` (sai khi cửa giữa), hoặc thêm
`hinge: 'left' | 'right'`. Desktop dùng `Vector` ±1.

### 5.3 Số cánh cửa trượt

Thêm `leaves: 1 | 2` (mặc định 1) hay suy từ `width` (≥ 2 400 ⇒ 2)? Suy từ width là đoán; thêm field
là đúng nhưng phải sửa schema, `.sqd` import và UI.

### 5.4 Có thêm `drawHint`?

v2 không có catalogue SKU cho cửa (người dùng tự khai báo), nên `drawHint` sẽ là giá trị suy ra
(`ROLLERDOOR`, `PADOORL`, `SLIDEDOOR2`…). Giá trị thật nằm ở việc **lưu nó cùng cửa** để 2D, 3D,
punchings và PDF dùng chung một quyết định, thay vì mỗi nơi suy lại.

---

## 6. Không nên copy

- **Không dùng asset của Quotec**: 6 texture `tx-*`, logo, tên. Sinh texture bằng code hoặc mua bản
  quyền. Đây là sản phẩm thương mại của đối thủ.
- **Không copy cấu trúc bundle 1,65 MB**: họ gộp cả designer vào một chunk. v2 nên lazy-load 3D
  (đã tách component, chỉ cần `dynamic import` khi mở tab 3D).
- **Không port OpenGL desktop**: 8,7k dòng + texture nhúng là chi phí lớn mà kết quả không hơn
  three.js ở góc nhìn thông thường.

---

## 7. Ước lượng

| Slice | Nội dung | Ước lượng | Đổi dữ liệu |
|---|---|---|---|
| A | Vật liệu + ánh sáng | 0,5–1 ngày | Không |
| B | Cửa cuốn phần cứng | 0,5 ngày | Không |
| C | Sửa cửa sổ | 0,5 ngày | Không |
| D | PA door | 0,5–1 ngày | Có thể (`hinge`) |
| E | Sliding door | 0,5–1 ngày | Có (`leaves`) |
| F | Chế độ xem NO ROOF/DIMENSION | 0,5 ngày | Không |
| — | Test + kiểm tra trình duyệt | 0,5 ngày | — |

Thứ tự đề xuất: **A → C → B → D → E → F**.

---

## 8. Phụ lục — bằng chứng thô

### 8.1 Luồng đã đi

```
https://www.quotec.com.au/quoteitnow/
  iframe → https://quotecnow.quotec.com.au/job/start
  chọn Shed, nhập "1 George Street Sydney"
  → chọn gợi ý "1 GEORGE ST, LIDCOMBE NSW 2141"
  → Start Design
  → https://quotecnow.quotec.com.au/job/design/newbuilding/113212653
  → bấm tab 3D → canvas WebGL2
```

### 8.2 Tài nguyên 3D

```
/production/assets/stepdownDesigner.CB2mkr8l.js    1 650 KB   (three.js + hình học)
images/tx-sky.png  images/tx-grd.png  images/tx-horiz.png
images/tx-concrete3.jpg  images/tx-insulation2.jpg  images/tx-zinc2.jpg
```

### 8.3 API của job

```
GET /api/v1/job/newbuilding?…&addressId=GANSW705209634&…
GET /api/v1/job/windcheckresult/<lat>-<lng>-<state>-<wind>
GET /api/v1/job/designdata?BuildingCategory1Id=12&BuildingCategory2Id=20&WindSpeedId=1&…
GET /api/v1/jobengineering/majorframe     (gọi trực tiếp trả HTML — cần phiên/đúng cách)
```

### 8.4 Mẫu bảng `Openings` của Quotec

| Id | MinWidth | MaxWidth | MinHeight | MaxHeight | MinBuildingHeight | MaxBuildingHeight | HeaderItemId | JambItemId |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 4 500 | 1 500 | 3 600 | 0 | 3 600 | 1270 | 1271 |
| 2 | 0 | 5 000 | 1 500 | 3 600 | 3 600 | 5 000 | 1273 | 1274 |
| 5 | 4 501 | 5 000 | 1 500 | 3 600 | 0 | 3 600 | 1271 | 1271 |
| 6 | 5 001 | 6 100 | 1 500 | 3 600 | 0 | 3 600 | 1274 | 1274 |
| 9 | 5 001 | 6 100 | 1 500 | 6 000 | 5 001 | 6 000 | 1274 | 1277 |

(9 dòng đầy đủ trong response; bảng trên là các dòng đại diện đã đọc.)

---

## 9. Trang demo `/demo` (đã dựng 2026-11-13)

Mục đích: xem hình học trước khi port vào editor. **Không cần đăng nhập**:
`http://localhost:3061/demo`.

| File | Vai trò |
|---|---|
| `apps/client/src/app/demo/page.tsx` | route, metadata, `noindex` |
| `apps/client/src/components/demo/DemoView.tsx` | Canvas, ACES, RoomEnvironment + PMREM, nắng + bóng, đất, overlay, toggle Roof/Doors |
| `apps/client/src/components/demo/DemoBuilding.tsx` | tường **dùng chung** `buildWallGeometries` + `buildWallShape`; gable ends, mái, ridge cap, máng xối, ống thoát, cột + rìa, slab |
| `apps/client/src/components/demo/parts.ts` | hình học cửa theo loại, wall-local mm, thuần dữ liệu |
| `apps/client/src/components/demo/fixture.ts` | nhà cố định 12 × 18 × 4,2 m, 15°, 3 bay; cửa cuốn + PA + trượt + cửa sổ + 1 lỗ trống |
| `apps/client/src/components/demo/textures.ts` | gân tôn sinh bằng canvas, 1 gân / 762 mm |
| `apps/client/src/components/demo/__tests__/parts.test.ts` | 15 test bất biến hình học |
| `apps/client/src/hooks/useContainerSize.ts` | tách từ `Render3D` (R3F không nhận `ResizeObserver` ⇒ canvas 300 × 150 sau reload); editor nay dùng chung |

Đã kiểm bằng số: 15 test xanh, typecheck sạch; canvas 1408 × 792 với WebGL2; tắt mái đổi khung
hình đo được (độ sáng vùng giữa 98 → 209); không lỗi runtime. **Chưa kiểm bằng mắt** — phiên làm
việc không nhận ảnh, nên phần thẩm mỹ cần chủ dự án xem trực tiếp.

---

## 10. Việc tiếp theo

**Đã ship (2026-11-13)** — cả sáu slice của plan:

| Slice | Nội dung | Nơi ở |
|---|---|---|
| 0 | `Opening.leaves` (1\|2) và `Opening.hinge` (left\|right) | `types.ts`, `schema.ts`, `selection.ts`, `CategoryDock.tsx`, `plan.ts`, `legacyPlan.ts` |
| 1 | Hình học thuần vào core | `packages/core/src/domain/openings3d.ts`, `structure3d.ts` (+39 test) |
| 2 | Renderer dùng chung, thay cửa trong editor | `components/three/{PartMesh,StudioEnvironment,useSheetingTexture}`, `Shed3D.tsx` |
| 3 | Mái/phào/máng/khung + toggle Roof | `structure3d.ts`, `Shed3D.tsx`, `PlanView.tsx` |
| 4 | `frameLayout` từ evaluation | `contracts/evaluation.ts`, `bom/build.ts`, `estimating/types.ts`, `routes/evaluations.ts` |
| 5 | Docs + deviation | `KNOWN-DEVIATIONS.md` 49–52, `smartquote-quote-editor-reference.md` §12.6 |

Còn lại, ghi trong `KNOWN-DEVIATIONS.md`: giá cho `leaves`/`hinge`/gable infill; chế độ xem
`NO ROOF / FRAME / DIMENSION` đầy đủ như Quotec (mới có Roof); texture bitmap/HDR; model GLB.

**Chưa kiểm bằng mắt** — phiên làm việc không nhận ảnh. Đã đo bằng số: canvas 587 × 552 WebGL2 trong
editor, 1408 × 792 ở `/demo`, `frameLayout` tới client (`purlinRows: 2, girtRows: 2` trên quote mẫu),
toggle Roof đổi `aria-pressed`, không lỗi runtime. Thẩm mỹ cần chủ dự án xem trực tiếp, rồi lưu ảnh
vào `docs/reviews/` để lần sau so sánh.
