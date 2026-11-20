# Bản vẽ kỹ thuật — v2 so với desktop (2026-11-20)

Phân tích ban đầu; **đã sửa 2026-11-20** — xem §5. Đường dẫn desktop tính từ `D:\Docs\OS.mr.Thi\smq-code-smartquote`;
`Elms2D/` = `Layer/Bus/ServiceDisplay/SmartQuote.Bus.Elms2D/Providers/`.

## 1. Desktop in gì

Hai tờ A4 ngang, in qua `PrintDocument` và cũng nhúng PNG vào báo giá HTML
(`PlanReportService`, `[[PlanView]]` / `[[ElevationView]]`).

### 1.1 Khung tên (title block) — cả hai tờ
- `XDrawingPlanViewService.DrawFrame` (`Framework/Service/.../XDrawingPlanViewService.cs:140-151`):
  vẽ **ảnh template** (`FrameTemplatePlanView` / `FrameTemplateElevations`) rồi ghi đè 5 trường:
  ClientName (chữ lớn), Address (= SiteStreet), State (SiteStateFull), JobNo (= QuoteNo), Date.
  Font "ARIAL NARROW".
- Title, DwgNo, Drawn "SQ", Rev, SheetNo đều **bị comment** (`:145-151`) — chữ tĩnh nằm trong ảnh template.
- `PlanViewDocument.printFooter` (khung tên cũ, có SCALE "NTS", "01 of 01") là code chết (`flag = false`).
- Ảnh template là resource nhị phân — **chưa kiểm tra** nội dung chữ in sẵn trong đó.

### 1.2 Tờ PLAN VIEW (`Modules/PLan2D/SmartQuote.Module.Plan2D/Print/PlanViewDocument.cs`)
- Bố cục: hộp danh sách option bên trái (`FACTOR_OPTION_BOX_WIDTH = 4.4516556`), mặt bằng bên phải,
  cao vùng vẽ = paintBox.Height / 1.101.
- Hướng: **Length nằm ngang**, Width (+ mái hiên) nằm dọc, trục Y lật (`printPlanDesign`).
- `House2D.PrintLayout` (`Elms2D/House2D.cs:263-285`) theo thứ tự:
  1. `DrawRoof` — **chỉ mái gable** (`House2D.Frames.cs:58-64`, skillion thoát sớm): đường tấm lợp + đường nóc.
  2. `DrawFrame` — hình chữ nhật khung (`:37-45`).
  3. `DrawFront/Rear/Left/RightSheetings` — vạch nhỏ dọc mỗi tường, mỗi `WallSheetingSize` (`:144-158`).
  4. `DrawBayDimensions` — **chỉ khi các bay khác cỡ** (`:266-286`), tại `-3/5·distance`.
  5. `DrawRoofDimensions` — mũi tên hướng dốc ở giữa bay đầu: gable 2 mũi (mỗi nửa span), skillion 1 mũi hết span (`:345-367`).
  6. `DrawVerticalDimension` — kích thước Width ở bên phải, cách `Length + 1000` (+W2 nếu tường phải có cửa lùa) (`:422-439`).
  7. `DrawVertical{Front,Rear}AwningDimension` — bề rộng mái hiên, cùng cột (`:379-411`).
  8. `DrawHorizontalDimension` — Length tổng ở trên, cách `distance/2` (hoặc `distance` nếu bay khác cỡ; cộng thêm nếu tường trước có cửa lùa) (`:454-463`).
  9. `DrawTextHeight` — chữ `H. = {Height}mm` cạnh đầu phải đường kích thước Length (`:465-476`).
- Phần tử con (`base.Print`):
  - Tường dọc: máng xối là dải chữ nhật ngoài tường, ống xả là ô bo tròn ghi "DP" tại `DownPipePosition`; máng luôn vẽ hết chiều dài; chỉ bỏ DP nằm dưới mái hiên gắn sát mái (`HighHeight` ≥ cao tường − 200) (`SideWall2D.Print.cs`).
  - Tường hồi: chữ nhật xoay 90°, lỗ mở, tường ngăn (`EndWall2D.DrawPrint.cs`).
  - Cửa/cửa sổ: ký hiệu + tên ngắn trong hình thoi, ghi chú prep (`PADoor2D.Print.cs:54-94`, `RDoor2D.cs:273-297`, `Window2D.Print.cs`).
- Danh sách option: `Quotation.GetPrintOptionString` (`Layer/Entity/BuildingPlan/.../Quotation.cs:1016-1046`):
  mái hiên, option theo loại (Window, PA Door, Roller Door, Outrigger, Skylight, Carry Beam, Sliding Door, Mezzanine, Stable — `:1283-1298`),
  tường ngăn, đầu/bay mở, Horizontal Cladding, Gable Infill, Cantilever, ghi chú misc.

### 1.3 Tờ ELEVATIONS (`.../Print/ElevationDocument.cs`)
- Lưới 2×2 (`PrintPlanNewDesign`):
  - trên-trái **Front**, trên-phải **Right**;
  - dưới-trái **Back**, dưới-phải **Left**.
  Front/Back dùng chung một tỉ lệ; Right/Left dùng chung một tỉ lệ.
- Desktop gọi tường **dọc** (Length) là Front/Back, tường **hồi** (Width) là Left/Right.
- Chiều cao nóc: `Height + (Width / (SingleRoof ? 1 : 2)) · tan(pitch)`. Cỡ chữ = bề rộng vùng / 50.
- Mặt tường dọc (`SideWall2D.cs:109+`):
  - chữ nhật;
  - vạch tôn dọc mỗi `WallSheetingSize`, bỏ qua bay mở (hoặc vạch ngang nếu Horizontal Cladding);
  - nét mảnh hơn khi tường kín.
- Mái nhìn từ mặt dọc (`Roof2D.cs:134+`): dải chữ nhật từ `LowPos` tới `HightPos`, vạch tấm lợp mỗi `RoofSheetingSize`.
- Mặt hồi (`EndWall2D.cs:378`, `PrintOnHouseElevation :732+`):
  - đa giác gable/skillion;
  - vạch tôn cắt theo dốc mái;
  - hộp máng xối ở mép mái;
  - ống xả;
  - mái hiên hai bên;
  - gable infill.
- Cửa/cửa sổ (`Window2D.cs:166-199`, `RDoor2D.cs:381-415`, `PADoor2D.Print.cs:183`, `SlidingDoor2D.cs:834`): khi bật
  `IsOptionDimensionShow`, có kích thước vị trí từ đầu tường (`-SPACE_DIMENSION_Y`) và kích thước cửa.
- Kích thước tổng (`House2D.cs:287+`, `DrawDimensionElevation1`):
  - Front/Back: bề rộng tường;
  - Left/Right: bề rộng hồi, chiều cao tường và chiều cao nóc (desktop xếp các cột kích thước cách nhau 1100 mm, `House2D.cs:287-345`; v2 cùng giá trị, cách 700 mm);
  - mái hiên: rộng và cao.
- Mezzanine, Outrigger, Carry Beam, Skylight, Stable, Awning đều có `PrintElevation` riêng —
  **chưa kiểm tra** chi tiết từng cái.

## 2. v2 đang in gì

| Tờ | File | Nội dung |
|---|---|---|
| Plan | `packages/core/src/lib/documents/planPage.ts` | Tiêu đề "Plan — {số báo giá}", một dòng meta, SVG chỉ có **khung ngoài + hình lỗ mở**, ghi chú "Indicative only". Span nằm ngang, Length nằm dọc. |
| Elevations | `.../documents/elevationsPage.ts` | Mỗi tường là chữ nhật + một vạch mái dày cố định `RISE_MM = 220` + lỗ mở. Caption ghi bề rộng. "roofline is schematic". |
| Dữ liệu | `.../documents/projection.ts` | `plan` chỉ giữ `outline` + `openings{lines,rects}`; **bỏ** `dims`, `bayLines`, `roofArrow`, `options`, `arc` mà `buildPlanGeometry` (`domain/plan.ts`) đã tính sẵn. |

Editor (`PlanCanvas`) dùng đủ `PlanGeometry`. Chỉ trang in là nghèo.

## 3. Chênh lệch (ưu tiên cao → thấp)

| # | Hạng mục | Desktop | v2 | Mức |
|---|---|---|---|---|
| 1 | Tên mặt đứng | Front/Back = tường dọc, Left/Right = hồi | `front`→"Front" là tường **hồi** (v2 `placement.ts` `wallLength`) | **Sai nghĩa** — khách đọc "Front" thấy khác desktop |
| 2 | Hình mái ở mặt hồi | Đa giác gable/skillion, cao nóc thật | Vạch 220 mm cố định | Sai hình |
| 3 | Kích thước mặt đứng | Rộng, cao tường, cao nóc, mái hiên; vị trí cửa (tuỳ chọn) | Chỉ caption bề rộng | Thiếu |
| 4 | Kích thước mặt bằng | Length (trên), Width (phải), bay nếu khác cỡ, `H. = …mm` | Không có (dù `PlanGeometry.dims` có) | Thiếu |
| 5 | Khung tên | Template + Client, Site address, State, Job no., Date | Không có | Thiếu |
| 6 | Danh sách option | Hộp bên trái theo `GetPrintOptionString` | Không có | Thiếu |
| 7 | Hướng mặt bằng | Length ngang | Span ngang | Khác |
| 8 | Bố cục mặt đứng | Front TL · Right TR · Back BL · Left BR; cặp dùng chung tỉ lệ | Thứ tự SIDES, mỗi ô tỉ lệ riêng | Khác |
| 9 | Ký hiệu mặt bằng | Mũi tên dốc mái, đường nóc (gable), vạch tôn, máng xối, "DP", tên cửa trong hình thoi, cung mở cửa | Chỉ hình lỗ mở, bỏ cung | Thiếu |
| 10 | Vạch tôn mặt đứng | Tôn tường + tấm lợp, bỏ bay mở, cladding ngang | Không | Thiếu (thẩm mỹ) |
| 11 | Mái hiên, mezzanine, outrigger, skylight | Có trên cả hai tờ | Không | Thiếu — **chưa kiểm tra** v2 có đủ dữ liệu các option này chưa |

Khác biệt v2 cố ý giữ: `PlanGeometry` ghi kích thước từng bay **luôn luôn**, desktop chỉ ghi khi
bay khác cỡ (`House2D.Frames.cs:274`). Nếu theo desktop thì trang in phải lọc theo điều kiện này.

## 4. Đề xuất sửa (theo thứ tự)

1. **Projection**: đưa đủ `PlanGeometry` (dims, bayLines, roofArrow, arc, options) và một
   `ElevationGeometry` mới tính trong `@sq/core` (A13: core là nơi duy nhất tính hình học).
2. **Elevations** (sửa #1, #2, #3, #8):
   - đặt tên theo desktop (tường dọc = Front/Back);
   - vẽ đa giác mái thật (gable: nóc ở giữa; skillion: thấp→cao theo `skillionRiseMm`);
   - kích thước rộng, cao tường, cao nóc;
   - lưới 2×2 với cặp dùng chung tỉ lệ.
3. **Plan** (sửa #4, #7, #9): xoay để Length nằm ngang, vẽ dims, mũi tên dốc, đường nóc gable, cung cửa, `H. = …mm`.
4. **Khung tên + danh sách option** (sửa #5, #6): khung HTML/SVG với 5 trường như desktop; danh sách
   option theo đúng thứ tự `GetPrintOptionString`.
5. Vạch tôn, máng xối/DP, mái hiên và các option khác (#10, #11): làm sau, sau khi kiểm tra dữ liệu.

Mỗi bước nên kèm ảnh chụp so với bản in desktop của cùng một file `.sqd`.

## 5. Đã sửa (2026-11-20)

| # | Trạng thái | Ở đâu |
|---|---|---|
| 1 | Xong — Front/Back = tường dọc, Right/Left = hồi; caption ghi tường editor | `domain/elevation.ts` |
| 2 | Xong — đa giác gable/skillion, cao nóc thật | `domain/elevation.ts` |
| 3 | Xong — chuỗi lỗ cửa, rộng tổng, cao tường + nóc, mái hiên | `domain/elevation.ts` |
| 4 | Xong — Length + `H. = …mm`, Width, bay chỉ khi khác cỡ, bề sâu mái hiên | `documents/planPage.ts` |
| 5 | Xong — 5 trường như desktop (State tên đầy đủ) | `documents/drawingSheet.ts` `titleBlockHtml` |
| 6 | Xong — thứ tự `GetPrintOptionString` | `drawingSheet.ts` `optionListLines` |
| 7 | Xong — Length nằm ngang | `planPage.ts` |
| 8 | Xong — lưới 2×2, cặp chung tỉ lệ | `documents/elevationsPage.ts` |
| 9 | Xong — mũi tên dốc, nóc, vạch tôn, máng xối, DP, hình thoi, cung cửa | `planPage.ts` |
| 10 | Xong — tôn tường, tấm lợp, bỏ tường mở, cladding ngang | `domain/elevation.ts` |
| 11 | Xong — mái hiên, outrigger, mezzanine, skylight, carry beam, stable, tường ngăn | cả hai tờ |

Khác biệt cố ý: `KNOWN-DEVIATIONS.md` dòng 59–64.

Đã kiểm tra thêm (2026-11-20): kích thước mở `End Opening` / `Side Opening` / `Double Side Opening` (`GetListOpeningName`), chi tiết mái hiên `H…xL…xW… @…deg - Opened`, khối `-Cantilever:` chỉ khi có cantilever, máng/DP dưới mái hiên, các bậc kích thước mặt hồi.

Còn **chưa kiểm tra** (cần mở desktop/ảnh, không đoán):
- chữ in sẵn trong ảnh template khung tên (`FrameTemplatePlanView` / `FrameTemplateElevations`);
- so ảnh với bản in desktop của cùng một file `.sqd` (chưa có ảnh desktop để so).
