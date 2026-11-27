# Cấp Guest — thiết kế nhanh, gửi yêu cầu qua cổng chung, không cần đăng nhập

Trạng thái: **quyết định đã chốt** (2026-11-17), spec chờ duyệt. Thuộc [quote-tiers.md](quote-tiers.md). Cỡ: *large*, chia 9 lát dọc (G-a)…(G-i). UI/UX theo bản mẫu SSA (cập nhật 2026-11-18).

> **Cập nhật 2026-11-19, yêu cầu mới của khách.** Đã chốt Q1–Q8 trong [quote-tiers-guest-customer-gap.md](quote-tiers-guest-customer-gap.md); plan ở [quote-tiers-guest-ga2.md](../plans/quote-tiers-guest-ga2.md). Những gì đổi so với spec này:
> - **D-T4 đã đảo:** liên hệ hỏi ở bước đầu; trang còn **3 bước** (Start / Building / Send). Liên hệ chỉ nằm trong bộ nhớ trang — không ghi `localStorage`.
> - Có **6 loại công trình**: Garage, Industrial Building, Riding Arena, Aircraft Hangar, Carport, Class 1 House (`mode: 'enquiry'`).
> - **Slab Connection, Knee Brace** (chỉ là mong muốn) và **Cladding** được đưa lại.
> - **Bay sửa từng cái** (`bayWidths[]`), không chia đều nữa.
> - Có **dòng vùng gió ước tính** ("Region B · 10a Enclosed · Importance Level 2 — Indicative — confirmed in your quote"). Không in tốc độ m/s.
> - Bước ③ giữ **Additional Request** (một state dùng chung với ô ở ①).
> - 3D (G-f) làm ngay sau G-a2.
> - AI có thêm thẻ "Design check".
>
> Chỗ nào spec này khác thì file phân tích thắng. Bản đã giao của G-a2: `docs/state/quote-tiers.md` mục 16–19; độ lệch ghi ở `docs/KNOWN-DEVIATIONS.md` dòng 53–57.

Quyết định áp dụng (chi tiết và lý do: [quote-tiers-guest-analysis.md](quote-tiers-guest-analysis.md)):
- **D-T3 / G2 — không giá.** Guest không thấy giá; giá chỉ đến qua báo giá chính thức.
- **D-T4 / G3 — không đăng nhập.** Thiết kế tới cuối không cần đăng nhập. Chỉ ở bước ④ "Send request" mới hỏi 4 trường (First Name, Last Name, Email, Mobile +61); địa chỉ công trình điền sẵn từ bước ②. Sau khi gửi, email về kèm link ma thuật để xem lại mọi yêu cầu. Khách đã mở link thì yêu cầu mới tự lưu vào hồ sơ của họ.
- **D-T5 / D-T6 — cổng chung.** Không chọn công ty, chỉ super admin nhận. Hồ sơ khách ở cấp platform, theo email.
- **G1 — chuyển cho một công ty.** Super admin chuyển lead cho một công ty, kể cả các tenant của chính vendor.
- **G4 — `apps/site`.** Trang `/quote` nằm trong `apps/site`. Web giới thiệu (Next.js riêng, ngoài repo này) chỉ link sang.

## Câu chuyện người dùng

- Là **khách vãng lai**:
  - tôi bấm "Báo giá ngay" trên web giới thiệu và vào `/quote`;
  - tôi chọn loại nhà, chọn suburb từ gợi ý, chỉnh kích thước, cửa và màu trên cùng một trang, mà không phải tạo tài khoản;
  - tải lại trang không mất thiết kế;
  - ở bước ④ tôi xem lại "What you're sending", điền form 4 trường và bấm **Send quote request**; gửi xong tôi thấy số yêu cầu và lời hẹn "báo giá sẽ được gửi qua email".
- Là **khách vãng lai**, tôi nhận email xác nhận có link. Bấm link là tôi vào "Yêu cầu của tôi" và thấy mọi yêu cầu đã gửi bằng email đó, kèm trạng thái.
- Là **khách đã mở link** trên trình duyệt này, lần sau form gửi yêu cầu đã điền sẵn thông tin của tôi, và yêu cầu mới vào thẳng hồ sơ.
- Là **khách**, khi công ty gửi báo giá, tôi nhận email có link xem báo giá. Báo giá cũng hiện trong "Yêu cầu của tôi".
- Là **khách** trên máy khác, tôi nhập email ở "Yêu cầu của tôi" để nhận link mới.
- Là **super admin**:
  - tôi thấy hộp "Lead" trong trang admin, với nhãn "email chưa xác nhận" cho tới khi khách bấm link;
  - tôi mở một lead, đọc thiết kế và liên hệ, rồi **chuyển cho một công ty** (có ghi chú), hoặc từ chối, hoặc đánh dấu spam.

## Dữ kiện (đã kiểm tra 2026-11-17)

| Điều | Ở đâu |
|---|---|
| 4 preset dựng sẵn, có cửa cuốn và cửa đi mẫu | [presets.ts:74](../../packages/core/src/domain/presets.ts:74), [:33](../../packages/core/src/domain/presets.ts:33), [:56](../../packages/core/src/domain/presets.ts:56) |
| Loại lỗ mở core hỗ trợ: `roller_door`, `pa_door`, `sliding_door`, `window` | [types.ts:29-32](../../packages/core/src/domain/types.ts:29) |
| 3D là R3F + three, **chỉ để xem**: không có handler chuột, nằm trong `apps/client` | [Shed3D.tsx](../../apps/client/src/components/editor/Shed3D.tsx), [Render3D.tsx](../../apps/client/src/components/editor/Render3D.tsx) |
| 2D của editor là Konva (1286 dòng), gắn chặt với `useShedStore`; dùng lại nguyên khối thì kéo theo cả editor | [Render2D.tsx:34](../../apps/client/src/components/editor/Render2D.tsx:34), [:229-241](../../apps/client/src/components/editor/Render2D.tsx:229) |
| Nhưng **toàn bộ luật đặt và kéo cửa nằm trong core**: `nearestWall`, `planPointToWallU`, `constrainOpeningU`, `moveOpeningTo`, `resolveOpeningPlacement`, `buildPlanGeometry`, `DEFAULT_OPENING_BY_TYPE`, `placeOpening` | [Render2D.tsx:35-61](../../apps/client/src/components/editor/Render2D.tsx:35), [placementRules.ts:119](../../packages/core/src/domain/placementRules.ts:119) |
| `placeOpening` bỏ qua luật R3 (cửa đè cột infill) khi không có vị trí cột từ bảng giá | [placementRules.ts:125-130](../../packages/core/src/domain/placementRules.ts:125) |
| `apps/site` chưa có `three`, `konva` hay R3F trong dependency | [apps/site/package.json](../../apps/site/package.json) |
| Hình học tường được dựng trong core, không phải trong component 3D | `buildWallGeometries` ([Shed3D.tsx:32](../../apps/client/src/components/editor/Shed3D.tsx:32)) |
| `apps/site` hiện chỉ có trang chủ và `/s` (xem báo giá chia sẻ); **chưa có** bridge `app/api/...` | `apps/site/src/app/` |
| Token ngẫu nhiên, băm, so khớp, băm IP có sẵn | [tokens.ts:16-41](../../apps/api/src/lib/tokens.ts:16) |
| Mẫu route công khai đã chống lạm dụng: rate limit trước khi insert, honeypot trả "thành công" giả | [enquiries.ts:17-20](../../apps/api/src/routes/enquiries.ts:17), [:121](../../apps/api/src/routes/enquiries.ts:121) |
| Bảng `enquiries` (form liên hệ của vendor) không có chỗ cho thiết kế hay vòng đời chuyển lead | [001_init.sql:439](../../packages/db/migrations/001_init.sql:439) |
| Capability platform đã có, gồm `platform:enquiries` và `platform:companies` | [roles.ts:49-55](../../packages/contracts/src/roles.ts:49) |
| Link chia sẻ quote cho người ngoài | [shares.ts:33](../../apps/api/src/routes/shares.ts:33) |
| Mail giao dịch | [auth.ts:49](../../apps/api/src/routes/auth.ts:49), `lib/mail/` |

Trang `/s` của site lấy dữ liệu qua đường nào (fetch phía server hay bridge): *chưa kiểm tra*.

## Trang `/quote` trong `apps/site` (UI/UX theo bản mẫu SSA, 2026-11-18)

**Nguồn:** người dùng gửi 2 file tham khảo, nằm ngoài repo:
- `guest-login-step-by-step.md`: hướng dẫn 10 bước kèm phụ lục A–F;
- `Smart Solutions Australia Guest Login.html`: bản mẫu tĩnh.

Mục này lấy **bố cục, tương tác và giọng văn** từ hai file đó. Chỗ nào hai file mâu thuẫn với quyết định đã chốt (D-T3, D-T4, cổng chung) thì quyết định đã chốt thắng; danh sách nằm cuối mục. Token màu và font: [pages/guest-quote.md](../../design-system/smartquote-v2/pages/guest-quote.md).

### Nguyên tắc (từ hướng dẫn, đã đối chiếu)

1. Không đăng nhập; không giá ở bất kỳ đâu (D-T3), kể cả trong mã nguồn trang: site không gọi `/evaluate`.
2. **2D và 3D là một state.** Đổi ở 2D, ở bảng điều khiển hay qua trợ lý thì mọi chỗ cập nhật cùng lúc.
3. Trợ lý AI chạy suốt trang. Nó sửa thiết kế thật qua cùng reducer, có Hoàn tác và hỏi trước khi đổi lớn, và **không bao giờ gửi yêu cầu** thay khách.
4. Chữ trên trang bằng **tiếng Anh Úc** (en-AU: "colour", "metres"). Gió và chứng nhận được giải thích bằng lời thường, không dùng ký hiệu như N3/C2.
5. Không đụng editor nhân viên (đã chốt 2026-11-17).

### Bố cục: 4 tab, mỗi lần một khung (chốt 2026-11-18)

Người dùng chốt: **không cuộn 4 bước** mà dùng **tab**, cho màn hình gọn. Đây là chỗ lệch có chủ đích với bản mẫu (bản mẫu cuộn một trang).

```
Header gọn: logo · pill "Guest session — no sign-up needed" · (≥ 1024px: Home / Projects / Contact)
Thanh tab: [① Building type] [② Your address] [③ Design] [④ Send request]  ·  tóm tắt "Shed · 9.0 × 12.0 m" · nút đỏ "Send quote request"
Khung của tab đang mở (chỉ một khung)
Chân khung: ‹ Back · "Your design is saved on this device" · Start over · Next: Your address ›
```

- **Tab theo mẫu WAI-ARIA Tabs:**
  - `role="tablist"`; mỗi tab là `role="tab"` có `aria-selected` và `aria-controls`; khung là `role="tabpanel"`;
  - ←/→ chuyển focus giữa các tab, Home/End về tab đầu/cuối (roving tabindex);
  - Enter/Space mới mở tab (kích hoạt thủ công), vì khung ③ nặng.
- **Khóa tab:**
  - chưa chọn loại nhà thì ②③④ ở trạng thái `aria-disabled`, kèm lời "Choose a building type first";
  - đã chọn loại thì đi tự do giữa các tab; thiếu địa chỉ không chặn ③;
  - ④ liệt kê những gì còn thiếu (ví dụ địa chỉ), và khóa nút gửi tới khi đủ.
- **Dấu trên tab:**
  - tab đủ dữ liệu có dấu tích;
  - tab còn thiếu thứ ④ cần có chấm cam, kèm chữ cho trình đọc màn hình ("needs your address").
- **Chân khung** có Back / Next; ở ③ nút là "Next: Send request". Chuyển tab thì focus vào tiêu đề của khung mới, và khung về đầu.
- **URL giữ tab:** `/quote?step=type|address|design|send`.
  - Đổi tab bằng `history.pushState`, nên nút Back của trình duyệt về tab trước.
  - Mở link sâu thì vào đúng tab, vẫn theo luật khóa ở trên.
- **Thanh tóm tắt** nằm ở phần phải của thanh tab khi ≥ 768px; < 768px nó tách thành một dòng dính đáy (mục "Thanh tóm tắt").
- **Chiều cao:**
  - ở ≥ 1024px, khung ③ cao đúng phần còn lại của màn hình (`100dvh` trừ header và thanh tab); trang không cuộn, cột điều khiển và hội thoại tự cuộn bên trong;
  - khung ①②④ ngắn, cuộn bình thường nếu cần.
- Hero (một dòng tiêu đề cộng 3 dấu tích "No sign-up", "Design in 2D & 3D", "Quote by email") chỉ hiện ở tab ① khi chưa chọn loại.
- Thiết kế và tab đang mở lưu trong `localStorage` sau mỗi thay đổi; gửi xong thì **giữ** (xem "Keep designing"). "Start over" hỏi xác nhận, và hỏi có xóa cả hội thoại với trợ lý không.
- Mọi chỗ trước đây "cuộn tới" nay là **chuyển tab rồi đặt focus vào field tương ứng**: link "Edit" ở ④, nút gửi trên thanh tóm tắt, trợ lý đưa tới bước còn thiếu, "View on plan".

### ① Building type: loại nhà do super admin định nghĩa (chốt 2026-11-18)

Người dùng chốt: **super admin định nghĩa thông số mẫu cho từng loại nhà, trong admin site**. Trang Guest không giữ cỡ hay khoảng cho phép trong code; nó đọc các loại đang bật từ `GET /public/guest/building-types`.

**Một loại nhà gồm:**

| Nhóm | Trường | Ràng buộc |
|---|---|---|
| Hiển thị | tên thẻ, mô tả một dòng, biểu tượng (chọn trong bộ SVG có sẵn), thứ tự, bật/tắt | tên ≤ 40 ký tự |
| Nền kết cấu | dựa trên **preset core** nào: Domestic Garage, Farm Machinery, Skillion Workshop, Open Carport ([presets.ts:74-161](../../packages/core/src/domain/presets.ts:74)) | bắt buộc; preset quyết định mái hai mái hay mái đơn, nhà kín hay hở |
| Cỡ khởi đầu | span, eave, pitch, số bay, cỡ bay | nằm trong khoảng cho phép của chính loại đó |
| Khoảng cho phép | min/max span, eave, cỡ bay; min/max số bay; danh sách pitch khách được chọn | không vượt giới hạn cứng của core: bay 2..30, pitch 0..45° ([types.ts:380-421](../../packages/core/src/domain/types.ts:380)) |
| Cửa | loại nào được dùng (roller, PA, sliding, window), số tối đa mỗi loại, các cỡ chip, cửa mẫu khi khách mới chọn loại | cỡ phải định giá được trong bảng giá đang dùng (kiểm khi lưu); Open Carport mặc định tắt hết |
| Màu | màu mặc định walls / roof / trim; danh sách màu khách được chọn | tên trong `COLORBOND` ([defaults.ts:11-42](../../packages/core/src/domain/defaults.ts:11)) |
| Extras (G-h) | extras nào được bật | chỉ những mục có trong bảng ở bước ③ |
| Lý do khóa | câu hiện khi một nhóm bị tắt, ví dụ "Carports are open — no doors or windows" | tùy chọn |

**Kiểm khi lưu (ở server, bằng core):**
- Server dựng `ShedConfig` từ preset nền, cỡ khởi đầu và cửa mẫu, rồi chạy `normaliseShedConfig` và `placeOpening`.
- Không hợp lệ thì từ chối, kèm lý do theo từng field. Admin không lưu được một loại mà khách không đặt được cửa.
- `Preset` hiện chỉ có `name` ([presets.ts:21-22](../../packages/core/src/domain/presets.ts:21)). Thêm một `id` ổn định để DB tham chiếu, không dựa vào tên hiển thị.

**Phiên bản và xóa:**
- Mỗi lần lưu tăng `version`; `audit_events` ghi phần thay đổi. Lead ghi `typeId` và `typeVersion`, nên estimator biết khách đã thấy loại nào, dù sau đó admin sửa. Không giữ bản sao từng version: thiết kế trong lead đã đủ để báo giá.
- Loại đã có lead thì **không xóa được**, chỉ tắt.

**Khi chưa có dòng nào** (cài mới): API trả 4 loại mặc định từ một hằng số trong `@sq/core`, theo cỡ của hướng dẫn (phụ lục C). Admin bấm "Customise" thì mặc định được chép thành dòng trong DB.

| Loại mặc định | Dựa trên preset | Cỡ khởi đầu (hướng dẫn, phụ lục C) | Cỡ của preset core |
|---|---|---|---|
| Shed | Farm Machinery | 9 × 6 m, eave 3.0 m, pitch 10° | 12 × 24 m, 4.2 m, 10° |
| Garage | Domestic Garage | 6 × 6 m, eave 2.4 m | 6 × 6 m, 2.4 m, 15° |
| Carport | Open Carport | 6 × 5.9 m, pitch 15° | 6 × 6 m, 2.4 m, 15° |
| Skillion | Skillion Workshop | 3 × 6 m, pitch 5° | 9 × 15 m, 3.6 m, 5° |

- Thẻ "Awning" của hướng dẫn: core chỉ có nhà mái đơn đứng riêng, nên loại mặc định thứ tư là "Skillion — single-slope roof". Admin đổi tên và mô tả được, nhưng không tạo được kết cấu mà core không có.
- Tắt hết mọi loại thì trang hiện "Online design is unavailable right now", kèm form liên hệ hiện có của site.

**Màn hình admin `/guest-types`** (nhóm "Guest" trên sidebar, cạnh "Lead"):
- bảng các loại (`DataTable`): tên, dựa trên preset nào, cỡ khởi đầu, bật/tắt, version, lần sửa cuối;
- trang sửa một loại: form theo các nhóm trên; bên phải là **xem trước** bằng chính `GuestPlan` 2D và thẻ như khách thấy;
- cần capability `platform:templates`, cùng nhóm người đang quản lý catalogue template; tách riêng khi cần.

**Ở trang Guest:**
- Thẻ hiện theo thứ tự admin đặt, biểu tượng nét SVG (không emoji). Thẻ đang chọn có viền đỏ, dấu tích và `aria-pressed="true"`.
- Đổi thẻ khi thiết kế đã có cửa thì hỏi xác nhận ("Your doors will be reset to the Garage layout").
- Dưới các thẻ có lối vào **"Or describe it to the assistant"**: một ô lớn cộng nút mic (mục Trợ lý AI).

### ② Your address: Google Places, có chống spam (chốt 2026-11-18)

Người dùng chốt: **phải dùng Google Places** cho Guest, và tìm cách chống spam. Gợi ý suburb từ bảng giá chuyển thành **đường dự phòng**.

**Đã kiểm tra 2026-11-18:**
- Proxy Places đã có, khóa nằm ở server: `GET /places/autocomplete` và `GET /places/details` ([routes/places.ts](../../apps/api/src/routes/places.ts)). Cả hai đòi `quote:write` ([places.ts:59-61](../../apps/api/src/routes/places.ts:59)).
- Transport gọi Places API (New), chỉ Úc (`includedRegionCodes: ['au']`), field mask tối thiểu ([lib/places.ts:145-158](../../apps/api/src/lib/places.ts:145)). Transport **chưa gửi `sessionToken`**.
- `details` tách địa chỉ thành street / suburb / state / postcode ở server (`splitAddress`, [lib/places.ts:96-110](../../apps/api/src/lib/places.ts:96)), đúng các field `design.site` cần.
- Rate limiter nằm trong DB: `consume(db, key, limit, windowMs)` ([lib/rateLimit.ts](../../apps/api/src/lib/rateLimit.ts)). Form liên hệ đã dùng nó theo IP ([enquiries.ts:121](../../apps/api/src/routes/enquiries.ts:121)).

**Route công khai mới** (qua bridge của site). Các route này dùng lại `PlacesTransport` và không đụng route của công ty:

| Route | Việc làm |
|---|---|
| `POST /public/guest/places/session` | Cấp một **phiên tìm địa chỉ**: id ngẫu nhiên có chữ ký HMAC, hạn 3 phút. Server dùng id này làm `sessionToken` gửi Google. |
| `GET /public/guest/places/autocomplete?q=&s=` | Cần phiên hợp lệ. Trả tối đa 5 gợi ý. |
| `GET /public/guest/places/details?id=&s=` | Cần phiên hợp lệ, **một lần mỗi phiên**, rồi phiên đóng. Trả `{ street, suburb, state, postcode }`. |

**Các lớp chống spam.** Mọi giới hạn tiêu `consume()` **trước** khi gọi Google:
1. **Phiên tìm địa chỉ:** mỗi phiên tối đa 12 lần autocomplete (điểm gãy giá theo phiên của Google, xem plan G-a mục 3) và 1 lần details. Muốn gọi tiếp thì phải xin phiên mới, mà xin phiên bị giới hạn theo IP.
2. **Theo IP** (bản băm, lấy từ `request.ip`):
   - xin phiên ≤ 10 lần/giờ;
   - autocomplete ≤ 60 lần/giờ và ≤ 200 lần/ngày;
   - details ≤ 20 lần/ngày.
3. **Trần toàn hệ thống mỗi ngày** cho autocomplete và cho details, đặt bằng env. Chạm trần thì route trả `unavailable`, trang tự chuyển sang đường dự phòng, và vendor nhận một mail cảnh báo (một lần mỗi ngày).
4. **Kiểm đầu vào ở server:** 3–100 ký tự sau trim; bỏ câu toàn chữ số hoặc toàn một ký tự lặp lại. Dưới 3 ký tự thì trả rỗng, không gọi Google.
5. **Ở trình duyệt:** debounce 300 ms; hủy request cũ khi khách gõ tiếp; chỉ xin phiên khi khách focus vào ô địa chỉ lần đầu.
6. **`sessionToken`:** gửi cho Google ở cả autocomplete và details. Việc này thêm một tham số tùy chọn vào transport, và editor cũng dùng lại được. Google gom các lần gõ trong một phiên khi tính tiền; mức giảm cụ thể *chưa kiểm tra* — giao `/research` trước khi chốt trần.
7. **Phía Google Cloud** (việc vận hành, ghi vào `docs/OPERATIONS.md`):
   - giới hạn khóa chỉ cho Places API (New) và IP của server;
   - đặt quota mỗi ngày trong console, làm trần cứng;
   - bật cảnh báo ngân sách.
8. **Công tắc env `GUEST_PLACES_ENABLED`:** tắt thì chỉ còn đường dự phòng.

Các con số ở lớp 1–3 là mặc định, đặt bằng env, chốt lại trong plan sau khi đo lưu lượng thật. Biến mới thêm vào `.env.example` và `turbo.json` `globalPassThroughEnv`.

**Đường dự phòng** dùng khi Places tắt, lỗi, chạm trần, hoặc khách gõ mà không ra kết quả:
- ô suburb gợi ý từ bảng `country_surburb` của bảng giá (16 741 dòng, đã kiểm tra), qua `GET /public/guest/suburbs?q=` có rate limit;
- không có nữa thì nhập tay suburb, bang (chọn) và postcode (4 chữ số);
- trang ghi rõ "Address search is unavailable — type your suburb instead".

**Ô nhập:**
- Một ô "Site address" dạng combobox WAI-ARIA; mỗi gợi ý có dòng chính và dòng phụ.
- Chọn xong thì hiện 4 field đã tách (street, suburb, state, postcode), khách sửa được.
- Không lưu gì từ Google ngoài các field đã tách vào thiết kế. Điều khoản cache của Google: *chưa kiểm tra*.

**Hộp "Wind check happens here":**
- nền `--ai-bg`, biểu tượng gió, 2–3 câu thường, ví dụ: "Every shed is engineered for the wind at its exact address. Our team confirms the wind rating when they prepare your quote — you don't need to know it.";
- **không gọi ShedSafe**: ShedSafe cần một quote ([shedsafe.ts:510](../../apps/api/src/routes/shedsafe.ts:510)), và vùng gió do estimator xác định ([quote-tiers-full.md](quote-tiers-full.md) §3).

### Thanh tóm tắt

- Hiện từ khi đã chọn loại nhà.
- Ở ≥ 768px, thanh nằm ở phần phải của thanh tab. Nội dung:
  - "Shed · 9.0 × 12.0 m · 2 roller doors";
  - nút "Design summary" mở danh sách đầy đủ trong một popover;
  - nút đỏ **"Send quote request"** chuyển sang tab ④.
- `< 768px`: thanh thành một dòng dính **đáy**, chỉ còn tóm tắt ngắn và nút gửi, chừa `env(safe-area-inset-bottom)`.
  - FAB của trợ lý nằm **trên** dòng này, không che.
  - Khi bàn phím ảo mở (đo bằng `visualViewport`), dòng này ẩn để không che ô nhập.

### ③ Design: vùng 3 cột, responsive (duyệt 2026-11-18)

Người dùng duyệt bố cục và yêu cầu **phải responsive**. Bố cục theo bề rộng, và theo chiều cao khi điện thoại xoay ngang:

| Màn hình | Bố cục khung ③ |
|---|---|
| ≥ 1280px | Điều khiển 320px · sân khấu (co giãn) · trợ lý 340px, thu gọn được. Khung cao vừa màn hình; mỗi cột tự cuộn |
| 1024–1279px | Điều khiển 320px · sân khấu; trợ lý là ngăn trượt 380px từ phải |
| 768–1023px | Sân khấu ở trên (cao 55dvh), accordion điều khiển ở dưới, trang cuộn; trợ lý là FAB cộng bottom sheet 85dvh |
| < 768px | Sân khấu ở trên (cao 45dvh, tối thiểu 260px), rồi accordion; FAB nằm trên dòng tóm tắt ở đáy |
| Điện thoại xoay ngang (cao < 500px) | Sân khấu bên trái 60%, điều khiển bên phải 40%, tự cuộn; header rút còn 44px |

- 2D co theo khung (SVG `viewBox`, không có cỡ cố định).
- Cảm ứng trên 2D:
  - chụm hai ngón để phóng, kéo hai ngón để dời khung nhìn;
  - kéo một ngón để dời cửa;
  - tay nắm cửa có vùng chạm ≥ 44px dù nét vẽ nhỏ.
- Slider luôn đi kèm một ô số gõ được, vì slider khó chỉnh chính xác trên điện thoại.
- Các cỡ phải thử: 360, 390, 768, 1024, 1280, 1440, và 844 × 390 (ngang). Không cuộn ngang ở bất kỳ cỡ nào.

**Sân khấu:**
- Tab **"2D plan"** và **"3D model"**. 2D là tab mặc định cho tới (G-f); trước đó tab 3D hiện hình minh họa của preset kèm chữ "3D preview coming".
- Nút góc nhìn của 3D (3D / Front / Side / Plan / Frame) theo bản mẫu. `Shed3D` có sẵn góc camera nào: *chưa kiểm tra*, chốt ở (G-f).
- **2D** là `GuestPlan` SVG đã chốt: chạm tường thì mở popover thêm cửa, kéo cửa dọc tường, chạm cửa để đổi cỡ hoặc xóa. Có nhãn kích thước (rộng, dài, khoảng bay), và tên tường (Front/Back/Left/Right) ở mép.
- **Chip dưới sân khấu:** chiều cao nóc · số bay × cỡ bay · màu mái/tường · "Wind: confirmed in your quote".
  - Chiều cao nóc **lấy từ core**, trang không tự tính: hướng dẫn ghi công thức nhà hai mái, còn nhà mái đơn khác.
  - Core đã có hàm này chưa: *chưa kiểm tra*. Chưa có thì thêm vào `@sq/core/domain`.

**Khối điều khiển** (accordion, mỗi nhóm một `<details>`, mở nhóm 1 mặc định):

1. **Size & structure**
   - Rộng (span): slider + ô số, bước 0.1 m, trong khoảng của loại nhà (bước ①).
   - Chiều cao eave: slider + ô số, trong khoảng của loại nhà.
   - Pitch: chip lấy từ danh sách pitch của loại nhà (mặc định 10° · 12.5° · 15° · 17.5° cho nhà hai mái, 5° cho Skillion). Core nhận 0..45° ([types.ts:380-421](../../packages/core/src/domain/types.ts:380)). Bảng giá có định giá được 12.5° và 17.5° không: *chưa kiểm tra*.
   - Bay: số bay (bước cộng/trừ) và cỡ bay (≤ 6 m). Chiều dài = tổng các bay, **chỉ đọc**. Core cho 2..30 bay, có `bayWidths` ([types.ts:380-421](../../packages/core/src/domain/types.ts:380)); Guest chỉ có bay đều.
   - Khoảng cho phép lấy từ loại nhà do super admin đặt (bước ①). Vượt khoảng thì hiện câu "Need something bigger? Add it to your notes".
   - Hướng dẫn còn có kiểu móng, knee brace và profile tôn. Spec **bỏ** ba thứ này: đó là lựa chọn kỹ thuật của estimator, và khách lẻ không có căn cứ để chọn.
2. **Colours — Colorbond®**
   - Tab phần: Walls · Roof · Trim. Trim gồm barge, gutter, downpipe, đi cùng nhau; có công tắc "Choose trim parts separately".
   - Swatch lấy từ `COLORBOND` của core: 30 tên, gồm Z450/Z600 Galv và Zinc ([defaults.ts:11-42](../../packages/core/src/domain/defaults.ts:11)).
   - Hướng dẫn liệt kê 22 màu (phụ lục D). Trang hiện **giao** của hai danh sách; Galv/Zinc gộp thành nhóm "Unpainted".
   - Mỗi swatch có tên hiện dưới ô, `aria-label` là tên, và trạng thái chọn **không chỉ bằng màu** (có dấu tích và viền).
   - `ShedColors` còn có màu cửa sổ, cửa đi, cửa cuốn ([types.ts:156-168](../../packages/core/src/domain/types.ts:156)). Guest không hiện: `configFromGuestDesign` lấy mặc định.
3. **Doors & windows**
   - Mỗi loại một bước cộng/trừ, kèm chip cỡ:
     - cửa cuốn (0–3; cỡ chip, ví dụ 3.0 × 2.1 m; công tắc "Motorised");
     - cửa đi (0–2, 820 × 2040 mm theo [defaults.ts:56](../../packages/core/src/domain/defaults.ts:56));
     - cửa lùa (0–2);
     - cửa sổ (0–4).

     Loại nào được dùng, trần số lượng và các cỡ chip lấy từ loại nhà (bước ①).
   - Thêm bằng bước cộng/trừ thì core `placeOpening` đặt cửa vào chỗ hợp lệ đầu tiên trên tường mặc định của loại đó.
   - Mỗi cửa có một dòng: chip tường (Front · Back · Left · Right) và chip vị trí (Left · Centre · Right), hoặc kéo trên 2D. Bản mẫu có 7 nút vị trí; spec rút còn 3, vì kéo trên 2D đã cho vị trí chính xác.
   - Hướng dẫn ghi "PA door Larnec 820". Bảng giá không có chữ "Larnec" (đã tìm 2026-11-18), nên trang chỉ ghi "Personal access door 820 mm".
4. **Extras** — lát (G-h), tùy chọn, cắt đầu tiên nếu thiếu thời gian (phụ lục F của hướng dẫn). Đã đối chiếu bảng giá 2026-11-18:

   | Hướng dẫn | Có trong core / bảng giá | Guest |
   |---|---|---|
   | Skylight | `OptionKind` `skylight`; bảng `skylight` | Số tấm skylight (0–4) |
   | Insulation Air-Cell | `misc_option`: "Aircell - Glareshield …", 10 dòng insulation | Công tắc "Roof insulation"; estimator chọn loại |
   | Vermin proof | Không có; có "Bird Proofing …" | "Bird proofing" |
   | Eaves 450/600 | `OptionKind` `overhang`; "Eaves Filler" chỉ là nẹp | Chip mái chìa None · 450 · 600 |
   | Awnings | `OptionKind` `awning` | Công tắc mái hiên theo tường |
   | Whirlybird, gutter guard | **Không thấy** trong `misc_option` (125 dòng) | Không hiện; khách ghi vào ghi chú |

- **Nhóm mà loại nhà tắt thì bị khóa, kèm lý do** do admin viết (bước ①), theo phụ lục C. Ví dụ Carport: Doors & windows và Extras có chữ "Carports are open — no doors or windows". Khóa dùng `aria-disabled` cộng lời giải thích, không ẩn hẳn, để khách hiểu vì sao.

### ④ Send request

- **"What you're sending"**: bảng chỉ đọc gồm loại, kích thước, pitch, địa chỉ, cửa, màu, extras, ghi chú. Mỗi dòng có link "Edit" chuyển về đúng tab và đặt focus vào field đó.
- **"What happens next"**: 3 ý.
  1. We check your design and site.
  2. A local team prepares a formal quote, including the wind rating for your address.
  3. You get the quote by email — usually within 2 business days.

  Thời hạn "2 business days" là câu của vendor, đặt trong cấu hình nội dung, không ghi cứng.
- **Form** (giữ D-T4, bố cục theo bản mẫu: hai cột ≥ 768px, một cột dưới đó):
  - First name, Last name, Mobile (+61, kiểm số di động Úc), Email (bắt buộc, vì link ma thuật gửi qua email);
  - địa chỉ công trình điền sẵn từ ②, chỉ đọc, có link "Change";
  - ô ghi chú;
  - ô đồng ý nhận liên lạc; honeypot ẩn.

  Lỗi hiện **ngay dưới field** và có tóm tắt lỗi ở đầu form. Có phiên `sq_guest` thì điền sẵn.
- **Nút "Send quote request"**: nền `--red-dark`, chữ trắng (5.8:1). Đang gửi thì khóa nút và hiện spinner.
- **Màn xác nhận** (thay chỗ form, không chuyển trang):
  - dấu tích xanh, "Request received", số yêu cầu (`GR-000123`, xem câu hỏi mở về tiền tố);
  - "Check your email to see all your requests";
  - nút **"Keep designing"** (giữ thiết kế để sửa) và "Start a new design".

  Gửi lại sau "Keep designing" tạo một lead **mới**, có ghi chú "Revised design of GR-000123". Super admin thấy hai lead cùng một liên hệ.

### Đáp ứng và truy cập

- Chạy được ở **360px**: không cuộn ngang, nút ≥ 44px, chữ ≥ 16px trong ô nhập (iOS không phóng to).
- Thứ tự tab đi theo thứ tự đọc. Focus luôn thấy được (vòng 3px `--navy`); chuyển tab thì focus vào tiêu đề của khung mới.
- Trợ lý: **Ctrl+M** bật/tắt mic khi focus ở trong khung trợ lý; Esc đóng ngăn hoặc sheet và trả focus về nút mở.
- Trợ lý không dùng được → dải "The assistant is unavailable — the designer still works as normal".
- `prefers-reduced-motion`: tắt hiệu ứng chuyển tab và hiệu ứng trượt.
- Có giao diện tối theo bản mẫu (`[data-theme="dark"]` cộng `prefers-color-scheme`). Mọi cặp màu trong file token đều đạt 4.5:1.

### Kịch bản kiểm thử đầu cuối (theo mục 10 của hướng dẫn)

1. Mở `/quote` không có cookie → tab ②③④ bị khóa. Chọn Garage → thanh tóm tắt hiện "Garage · 6.0 × 6.0 m", các tab mở khóa.
2. Ở tab ②, gõ "Ballar" → chọn "Ballarat VIC 3350". E2E chạy với `GUEST_PLACES_ENABLED` tắt, tức đi đường dự phòng, để không tốn tiền Google; Places thật kiểm bằng một probe riêng trong `scripts/`.
3. Đổi rộng thành 7.5 m → nhãn trên 2D và chip tóm tắt đổi cùng lúc.
4. Thêm 2 cửa cuốn bằng bước cộng; kéo cửa thứ hai dọc tường trước → nó không chồng cửa thứ nhất.
5. Chọn Roof = Monument → swatch có dấu tích và chip màu đổi.
6. Chọn Carport → hỏi xác nhận → nhóm Doors & windows bị khóa, có lý do.
7. (G-g) Gõ cho trợ lý "make it 9 metres wide" → thẻ thay đổi "6.0 → 9.0 m" → Hoàn tác trả lại 6.0.
8. Ở tab ④, gửi với mobile sai → lỗi dưới field; sửa → màn xác nhận có số yêu cầu; "Keep designing" giữ nguyên thiết kế.

Bài e2e của (G-a) chạy các bước 1–6 và 8; bước 7 thuộc (G-g).

### Lệch với bản mẫu: đã chọn theo quyết định đã chốt

| Bản mẫu / hướng dẫn | Spec | Vì sao |
|---|---|---|
| 3 trường: phone và address bắt buộc, email tùy chọn | 4 trường cộng địa chỉ điền sẵn, email bắt buộc | D-T4: link ma thuật và "Yêu cầu của tôi" cần email |
| Phone AU +61 hoặc NZ +64 | +61 | Bảng `country_surburb` và vùng gió chỉ cho Úc; NZ là câu hỏi mở |
| Một trang cuộn có thanh tiến trình | 4 tab, mỗi lần một khung | Người dùng chốt 2026-11-18: màn hình gọn hơn |
| Google Places cộng kiểm gió từ địa chỉ | Google Places qua proxy có chống spam; gió chỉ giải thích | Places: người dùng chốt 2026-11-18. ShedSafe cần quote |
| Cỡ khởi đầu ghi cứng theo loại | Super admin định nghĩa từng loại trong admin | Người dùng chốt 2026-11-18 |
| Số tham chiếu `SSA-####` | `GR-000123` (câu hỏi mở) | Cổng chung là của platform, không riêng một công ty |
| Hội thoại đi trong payload gửi lead | Hội thoại ở server, nối bằng `assistant_session_id` | Không tin bản chép do trình duyệt gửi lên |
| Giọng nói bằng Web Speech (bản mẫu) | STT phía server | Web Speech gửi âm thanh tới nhà cung cấp của trình duyệt, không kiểm soát được và không có trên Firefox |
| "Latest request is the one quoted" | Mỗi lần gửi là một lead, có ghi chú bản sửa | Không ghi đè lead mà super admin có thể đã chuyển đi |
| Kiểu móng, knee brace, profile tôn | Bỏ | Lựa chọn kỹ thuật của estimator |

### Trang riêng cho Guest, tương tác 2D, 3D chỉ xem (đã chốt 2026-11-17)

**Quyết định:** khách tương tác trên **2D** vì dễ; **3D chỉ để xem**. Guest có **trang riêng** (`apps/site` `/quote`), thiết kế riêng cho đẹp và bắt mắt. Trang này **không dùng lại component của editor**, để không đụng tới editor của nhân viên.

**Dùng chung gì, viết riêng gì:**

| Phần | Cách làm | Ảnh hưởng tới editor |
|---|---|---|
| Luật hình học và đặt cửa | Dùng nguyên `@sq/core/domain`: `buildPlanGeometry`, `nearestWall`, `planPointToWallU`, `constrainOpeningU`, `moveOpeningTo`, `placeOpening`, `PRESETS` | Không |
| Mặt bằng 2D | **Viết mới** `GuestPlan` bằng SVG (không Konva): vừa khung, không pan/zoom; chạm tường → popover "+ Cửa cuốn / + Cửa đi / + Cửa sổ"; kéo cửa **dọc theo tường** (một chiều, snap bằng core); chạm cửa → đổi cỡ hoặc xóa | Không |
| State | Store nhỏ riêng của site (thiết kế Guest), không dùng `useShedStore` | Không |
| 3D xem | Chuyển `Shed3D`, `Render3D`, `components/three/*` sang package dùng chung (đề xuất `@sq/viewer3d`). Site truyền vào `ShedConfig` dựng từ thiết kế Guest | Chỉ đổi đường import trong `apps/client`; không đổi hành vi |
| Giao diện | Bộ component riêng của trang Guest (thẻ loại nhà, slider, chip, swatch, accordion, thanh tóm tắt dính), dùng token SSA của [pages/guest-quote.md](../../design-system/smartquote-v2/pages/guest-quote.md), không đổi token của `@sq/ui` | Không |

**Vì sao kéo trên 2D dễ hơn trên 3D:**
- Kéo dọc một bức tường là thao tác **một chiều**, nên ngón tay trên điện thoại vẫn chính xác.
- Core đã có sẵn hàm chuyển điểm chạm thành vị trí trên tường và ép vào chỗ hợp lệ, nên trang Guest không phải viết lại luật.
- 3D bên cạnh cập nhật theo, nên khách vẫn thấy ngôi nhà của mình.

**Giới hạn cho Guest** (để trang đơn giản và dữ liệu sạch):
- tối đa một số cửa mỗi loại; con số chốt trong plan;
- cỡ cửa chọn từ vài cỡ phổ biến, không nhập mm;
- extras chỉ gồm những gì có trong core và bảng giá (bảng ở bước ③), làm ở lát (G-h).

Luật R3 (cửa đè cột infill) cần dữ liệu từ bảng giá, mà Guest không có, nên bị bỏ qua ([placementRules.ts:125-130](../../packages/core/src/domain/placementRules.ts:125)). Estimator chạy lại `placeOpening` đầy đủ khi tạo quote; `configFromGuestDesign` dời cửa nếu cần và ghi chú lại.

**Thứ tự:** 2D có từ lát (G-a), vì đó là cách khách nhập cửa. 3D xem là lát (G-f), làm sau khi luồng gửi chạy được. Trước khi có 3D, tab "3D model" hiện hình minh họa của preset.

Editor của nhân viên (Dealer, Đầy đủ) không đổi: vẫn chỉnh trên 2D, 3D để kiểm tra.

### Trợ lý AI: tạo và sửa thiết kế bằng chat hoặc giọng nói (đề xuất 2026-11-17)

**Mục đích:** khách có thể *kể* ngôi nhà mình muốn thay vì bấm từng bước, ví dụ "I need a 6 by 9 garage in Ballarat with two roller doors at the front". Trợ lý dựng thiết kế (**define**), rồi sửa theo từng câu tiếp theo (**update**). Toàn bộ là **một phiên, một đoạn hội thoại** cho mỗi thiết kế.

Dựa trên spec UI trợ lý của editor ([2026-11-13-ai-assistant-ui-design.md](../superpowers/specs/2026-11-13-ai-assistant-ui-design.md)), rút gọn cho khách vãng lai: không giá, không lưu/gửi thay khách, không dữ liệu cá nhân tới model.

**Đã kiểm tra (2026-11-17):** trợ lý của editor mới có **vỏ giao diện**:
- `AssistantPanel` chưa nói chuyện với model nào: `connected` mặc định `false`, và `send()` chỉ là chỗ chờ nối ([AssistantPanel.tsx:8](../../apps/client/src/components/editor/assistant/AssistantPanel.tsx:8), [:43-51](../../apps/client/src/components/editor/assistant/AssistantPanel.tsx:43));
- bật/tắt bằng `NEXT_PUBLIC_SQ_ASSISTANT` hoặc `?assistant=1` ([useAssistantEnabled.ts](../../apps/client/src/components/editor/assistant/useAssistantEnabled.ts));
- `apps/api`, `@sq/contracts` và migrations không có route, schema hay bảng nào cho trợ lý; `.env.example` và `turbo.json` không có biến LLM/STT nào.

Hệ quả: Guest có thể là nơi **đầu tiên** dựng phần backend của trợ lý (gọi model, stream, quota). Phần đó nên viết để editor dùng lại sau. Bộ công cụ (tool) của Guest thì **riêng**, chỉ sửa được thiết kế Guest. Theo nguyên tắc trang riêng, trang Guest **không** dùng lại `AssistantPanel`; chỉ dùng chung *từ vựng* (loại tin nhắn, change set, thẻ thay đổi).

#### Vị trí trên trang

| Màn hình | Cách hiện |
|---|---|
| ≥ 1280px | Ở tab ③: cột thứ ba, rộng 340px, tên "Shed Assistant", thu gọn được thành một dải. Ở tab ①②④: ngăn trượt như hàng dưới |
| 1024–1279px | Ngăn trượt 380px từ phải, mở bằng nút "Ask the AI" trên thanh tóm tắt |
| < 1024px | FAB đỏ 56px "Ask the AI" ở góc dưới, nằm **trên** thanh tóm tắt dính đáy, không che nó. Bấm thì mở bottom sheet cao 85dvh |

**Lối vào "define" ở bước ①:** dưới 4 thẻ có một ô lớn "Or describe it to the assistant", kèm nút mic. Gửi thì mở trợ lý với câu đó làm tin đầu tiên. Trợ lý điền những gì suy ra được (loại nhà, suburb, kích thước, cửa, màu), rồi chuyển sang tab **đầu tiên còn thiếu**, hoặc tab ③ nếu đủ.

**Chip gợi ý đổi theo tab đang mở** (theo hướng dẫn):
- ①: "6 × 9 garage with 2 roller doors", "What's the difference between a shed and a garage?";
- ②: "Why do you need my address?", "What is a wind rating?";
- ③: "Make it 9 metres wide", "Add a window on the left", "Dark roof, light walls";
- ④: "What happens after I send?", "Can I change it later?".

Hỏi về gió khi chưa có địa chỉ → trả lời ngắn cộng chip "Take me to Step 2". Câu mơ hồ → hỏi lại kèm 2–4 chip.

#### Một phiên = một đoạn hội thoại

- Mỗi thiết kế có **một phiên trợ lý**, lưu trên server (giống spec editor):
  - cookie ẩn danh `sq_ga` (HttpOnly, SameSite=Lax, hạn 30 ngày) mang token phiên; server chỉ lưu bản băm, như `guest_tokens`;
  - tải lại trang thì nạp lại hội thoại, 30 tin gần nhất, cuộn lên để xem thêm.
- **"Làm lại"** thiết kế thì hỏi có xóa cả hội thoại không. Đồng ý → phiên mới.
- **Gửi yêu cầu thành công** → phiên đóng và nối vào lead (`guest_requests.assistant_session_id`). Thiết kế tiếp theo mở phiên mới.
- Khách đã có phiên `sq_guest` (đã mở link ma thuật) thì phiên trợ lý gắn thêm `contact_id`, để "Yêu cầu của tôi" hiện lại hội thoại của từng yêu cầu (chỉ đọc).
- Thiết kế vẫn nằm trong `localStorage` như hiện tại. Mỗi lượt, trình duyệt gửi kèm **thiết kế hiện tại**, nên các thay đổi khách tự làm trên 2D luôn được trợ lý thấy.

#### Trợ lý được làm gì

Mỗi lượt, trợ lý trả lời bằng chữ (stream) và **nhiều nhất một** `GuestDesignChangeSet`. Change set chỉ gồm các thao tác trên `guestDesignSchema`:

| Thao tác | Ví dụ câu của khách |
|---|---|
| `setPreset` | "make it a carport instead" |
| `setSite { suburb, state, postcode }` | "it's going in Ballarat, 3350" |
| `setSize { span?, height?, pitch?, bays?, bayWidth? }` | "make it 9 metres wide", "steeper roof" |
| `addOpening { type, wall, offset?, size }` (cửa cuốn, cửa đi, cửa lùa, cửa sổ) | "add a window on the left side" |
| `moveOpening { id, wall?, offset }` | "move the PA door closer to the corner" |
| `resizeOpening { id, size }` | "bigger roller door" |
| `removeOpening { id }` | "drop the second window" |
| `setColours { walls?, roof?, trim? }` (tên trong `COLORBOND`) | "dark grey roof, cream walls" |
| `setExtras { … }` (chỉ khi đã có lát G-h) | "add two skylights" |

- **Một đường ghi duy nhất.** Change set đi qua **cùng reducer** của store Guest mà 2D và các điều khiển ở bước ③ dùng, và qua cùng hàm core (`placeOpening`, `constrainOpeningU`, khoảng kích thước của preset). Trợ lý không có đường tắt.
- **Server kiểm trước, client áp sau.** Server parse change set bằng zod và áp thử lên thiết kế khách gửi. Thao tác nào sai (cỡ ngoài khoảng, cửa chồng cửa, tường không tồn tại) bị bỏ, và model được báo để nói lại cho khách ("cửa đó không vừa tường bên trái, tôi đặt ở tường sau nhé?").
- **Mỗi lượt của trợ lý là một mục undo.** Store Guest cần một ngăn undo nhỏ; 2D cũng dùng nó (Ctrl+Z, và nút hoàn tác trên điện thoại).
- **Hỏi lại khi không chắc**, bằng chip trả lời nhanh: "Cửa cuốn ở tường nào?" → `Trước` · `Sau` · `Trái` · `Phải`.
- **Trả lời câu hỏi về sản phẩm** (loại nhà, cỡ phổ biến, loại cửa, màu) từ một bộ kiến thức cố định của vendor. Không bịa thông số.

**Trợ lý không bao giờ:**
- nói **giá**, ước lượng hay khoảng giá (D-T3). Hỏi giá → câu cố định "Pricing comes in your formal quote by email", kèm nút "Go to Send request";
- gửi yêu cầu, hỏi hay điền 4 trường liên hệ, hay hứa thời gian giao hàng;
- gọi ShedSafe, Places hay `/evaluate`. Vùng gió → "bên báo giá sẽ xác định";
- thêm thứ ngoài giới hạn Guest (whirlybird, gutter guard, kiểu móng, quá số cửa tối đa, extras khi chưa có G-h). Khi khách xin → trả lời rằng bên báo giá có thể thêm, và gợi ý ghi vào ô ghi chú.

#### Tự áp dụng hay hỏi trước

| Trường hợp | Cách làm |
|---|---|
| Thay đổi nhỏ, hoàn tác được (thêm/dời/đổi cỡ một cửa, đổi màu, đổi nơi đặt) | Áp ngay, hiện thẻ thay đổi |
| Đổi preset (cửa bị đặt lại theo preset mới) | Thẻ xác nhận |
| Đổi kích thước làm cửa bị dời hoặc xóa | Thẻ xác nhận, liệt kê cửa bị ảnh hưởng |
| Xóa từ 2 cửa trở lên, hoặc change set > 10 thao tác | Thẻ xác nhận |
| Lượt "define" đầu tiên khi thiết kế còn trống | Áp ngay: chưa có gì để mất |

#### Loại tin nhắn

Theo spec editor, bỏ những gì liên quan tới giá:
- tin của khách: chữ, hoặc giọng nói (hiện kèm biểu tượng mic);
- lời chào đầu phiên của "Shed Assistant", kèm chip theo bước;
- tin của trợ lý, stream từng phần;
- **thẻ thay đổi**: mỗi dòng dạng cũ → mới ("Width 6.0 → 9.0 m", "Added roller door 3.0 × 2.1 m, front wall"), nút **Undo** và **View on plan** (chuyển sang tab ③, chọn 2D, tô sáng cửa trên `GuestPlan`). Ba trạng thái: đã áp · đã hoàn tác · đã bị thay đổi sau đó ("Overwritten", kèm nút "Restore AI value"). **Không có dòng chênh lệch giá**;
- thẻ xác nhận (Áp dụng / Bỏ qua);
- câu hỏi lại kèm chip;
- nút "Đi tới bước…";
- lỗi, và ghi chú hệ thống ("Bạn đã sửa cửa này trên plan").

#### Giọng nói (đổi 2026-11-27: đọc chính tả trực tiếp vào ô chat)

- Nhận dạng giọng nói **phía server** (như D-AI3 của spec editor); bản ghi âm **không lưu**. Trong lúc
  nói, trình duyệt tự nhận dạng (Web Speech, miễn phí) để **hiện chữ trực tiếp** — chỉ để xem trước và
  làm dự phòng, không phải nguồn chính.
- Một nút mic, hai cách: **chạm** để bắt đầu, chạm ⏹ hoặc im 2 giây để kết thúc; **đè** (≥ 300 ms) để
  nói, thả ra là xong, im lặng không cắt (công trường ồn). Enter bật/tắt; giữ Space = đè.
- Kết thúc một lượt thì server nhận dạng và sửa câu, rồi câu được **nối thêm** vào ô chat. Nói tiếp thì
  nối tiếp. Server không trả lời được thì nối chữ của trình duyệt, kèm ghi chú "check the numbers".
- **Không gì vào khung chat trước khi khách bấm Send.** Nghe nhầm "nine" thành "five" không được tự đổi
  thiết kế; khách luôn đọc lại ô trước khi gửi.
- Dưới ô, cho lượt nói cuối: chip **"Did you mean"** (bấm để thay đúng đoạn đó, câu cũ thành chip);
  câu **lạc chủ đề** thì hiện gợi ý và chip ví dụ; kích thước công trình không nhận được thì **cảnh báo
  màu hổ phách**. Gõ sửa ô hoặc bấm Send thì các chip mất.
- Lỗi (bị chặn quyền, không có mic, quá ngắn, không nghe ra, dịch vụ tắt) hiện thành một dòng dưới ô.
- Ẩn panel, ẩn tab hoặc rời trang thì lượt ghi bị huỷ và micro tắt; không bao giờ nghe nền.
- Tiếng Anh Úc (`en-AU`) mặc định; tối đa 60 giây mỗi lần; mic chỉ mở khi khách bấm, không bao giờ nghe nền.
- Trình duyệt từ chối quyền mic → báo cách bật lại, và chat chữ vẫn chạy.
- Không có đọc to (TTS) ở bản đầu.

#### Dữ liệu cá nhân và minh bạch

- 4 trường liên hệ **không bao giờ** tới model. Model chỉ thấy thiết kế (preset, suburb/bang/postcode, kích thước, cửa, màu) và lời khách.
- Khách tự gõ email hay số điện thoại vào chat → server **che** (regex email, số di động Úc) trước khi gửi model và trước khi lưu.
- Dưới ô nhập luôn có: huy hiệu "AI", câu "Trợ lý có thể nhầm, hãy xem lại plan", và câu "Cuộc trò chuyện được gửi kèm yêu cầu để bên báo giá hiểu ý bạn".

#### Hội thoại đi theo lead

- Trang chi tiết lead trong admin có tab **"Hội thoại với trợ lý"** (chỉ đọc, chỉ chữ).
- Lúc **chuyển** lead, hội thoại được **chép** (chỉ chữ, đã che) vào `quote_requests.assistant_transcript_json`, theo cùng nguyên tắc chép dữ liệu của [quote-tiers-full.md](quote-tiers-full.md). Estimator đọc được ở trang yêu cầu.
- Phiên không thành lead bị xóa sau 30 ngày.

#### Nhà cung cấp model và nhận dạng giọng nói (chốt 2026-11-18)

Theo yêu cầu của người dùng, dùng **cùng cấu hình AI với dự án `01.RFQ_PWA_SQ`**. Đã đọc code của dự án đó 2026-11-18; chỉ đọc tên biến, không đọc giá trị khóa:

| Điều | Ở RFQ_PWA_SQ |
|---|---|
| Gateway vilao **tương thích OpenAI**; dùng SDK `openai` (7.31.0), chỉ đổi `baseURL` | `src/lib/ai/client.ts:1-38`, `package.json:25` |
| 4 biến: `VILAO_BASE_URL` (mặc định `https://api.vilao.ai/v1`), `VILAO_API_KEY`, `VILAO_MODEL`, `VILAO_STT_MODEL` | `.env`, `client.ts:19`, `:31-35` |
| Timeout 20 s, `maxRetries: 0`, để một gateway treo không chặn quá 20 s | `client.ts:9-13`, `:36-37` |
| Đầu ra có cấu trúc bằng `response_format: json_schema` (strict), parse rồi kiểm lại | `src/lib/ai/extract.ts:58-66` |
| Nhận dạng giọng nói: `audio.transcriptions.create`, model mặc định `mgr/grok-stt`; lỗi thì trả chuỗi rỗng, không ném | `src/lib/ai/transcribe.ts:19-37` |

Áp vào SmartQuote v2:
- Client gateway nằm ở `apps/api/src/lib/ai/`, **chỉ phía server**. Khóa không bao giờ vào bundle của site hay vào body phản hồi.
- Change set lấy bằng `json_schema` strict, giống cách RFQ đã chạy được. Không phụ thuộc tool calling: gateway có hỗ trợ không thì *chưa kiểm tra*. Server vẫn parse bằng zod và áp thử qua core như đã ghi ở trên.
- **Stream (SSE)** qua gateway: *chưa kiểm tra*. Không stream được thì trả cả câu một lần, kèm chỉ báo "đang gõ"; giao diện không đổi.
- Thêm 4 tên biến vào `.env.example` (giá trị rỗng) và vào `turbo.json` `globalPassThroughEnv`, cùng `GUEST_ASSISTANT_ENABLED` và các trần quota.
  - Giá trị thật chép từ `.env` của RFQ sang `.env` local lúc làm lát (G-g).
  - Không commit, không in ra log.
- Thiếu **cả hai** khóa (`GEMINI_API_KEY` và `VILAO_API_KEY`) thì trợ lý coi như tắt: dải "unavailable", trang vẫn chạy.

> **Cập nhật 2026-11-27 — Gemini là chính, vilao là dự phòng.** Bảng trên vẫn đúng cho vilao, nhưng vilao không còn là nhà cung cấp duy nhất: router (`apps/api/src/lib/ai/index.ts`) gọi **Gemini** (`generateContent`, `x-goog-api-key`) trước và chỉ chuyển sang vilao khi lỗi đáng thử lại (429/5xx/mạng/reply hỏng; **không** khi bị chặn an toàn) và còn đủ hạn. Chọn nhà cung cấp và model là **dữ liệu** trong bảng `ai_settings` sửa ở `apps/admin` `/ai` (quyền `platform:ai`, có audit); **khóa vẫn chỉ ở `.env`** và màn hình chỉ hiện "key set: yes/no". Biến mới: `AI_PRIMARY`, `AI_FALLBACK`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_STT_MODEL`, `GEMINI_BASE_URL`, `GEMINI_THINKING_LEVEL`. Chi tiết vận hành ở `docs/OPERATIONS.md`, quyết định ở `docs/DECISIONS.md` D5.
- Model mặc định của RFQ là `wiki` (`extract.ts:31`). Model đó có hợp cho hội thoại nhiều lượt và trả lời theo ngôn ngữ khách không: *chưa kiểm tra*. Đo thử ở đầu lát (G-g) bằng bộ câu ở phụ lục E của hướng dẫn.

#### Chống lạm dụng và chi phí

Route công khai gọi model là chỗ dễ bị đốt tiền nhất của cả cấp Guest:
- `consume()` theo bản băm IP và theo phiên, tiêu **trước** khi gọi model; tách riêng quota cho nhận dạng giọng nói;
- trần số lượt mỗi phiên và mỗi IP mỗi ngày; giới hạn độ dài một tin nhắn và độ dài lịch sử gửi cho model;
- công tắc tổng và trần ngân sách mỗi ngày cho toàn platform qua env (ví dụ `GUEST_ASSISTANT_ENABLED`, `GUEST_ASSISTANT_DAILY_TURNS`), thêm vào `turbo.json` `globalPassThroughEnv`. Con số cụ thể chọn trong plan;
- **chống prompt injection bằng cấu trúc, không bằng lời dặn:** model chỉ có các tool sửa thiết kế; mọi đầu ra qua zod và core; không tool nào đọc DB hay dữ liệu của người khác.

**Khi trợ lý không dùng được** (tắt, vượt quota, lỗi model): một dải "The assistant is unavailable — the designer still works as normal". Trang, 2D và gửi yêu cầu **không phụ thuộc** trợ lý.

#### Truy cập (theo spec editor)

- Danh sách tin là `role="log"` với `aria-live="polite"`.
- Enter gửi, Shift+Enter xuống dòng; không gửi khi đang gõ IME (`isComposing`, keyCode 229).
- Mọi nút ≥ 44px; biểu tượng SVG, không emoji; nút mic có nhãn đọc được và trạng thái "đang ghi".
- Hiệu ứng tôn trọng `prefers-reduced-motion`.
- Ctrl+M bật/tắt mic khi focus ở trong khung trợ lý.

## Mô hình dữ liệu (migration mới — số thứ tự chọn lúc viết plan; 019 đã dành cho vai trò tùy biến)

Mọi bảng dưới đây ở **cấp platform**, không có `tenant_id`, trừ `quote_requests`.

```sql
CREATE TABLE guest_contacts (            -- hồ sơ khách, một dòng mỗi email
  id                TEXT PRIMARY KEY,
  email_norm        TEXT NOT NULL UNIQUE,  -- chữ thường, đã trim
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  mobile            TEXT NOT NULL,         -- dạng E.164 +61…
  email_verified_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE guest_requests (            -- lead của vendor
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,    -- ví dụ GR-000123
  contact_id      TEXT NOT NULL REFERENCES guest_contacts(id),
  contact_json    TEXT NOT NULL,           -- ảnh chụp 4 trường lúc gửi
  design_json     TEXT NOT NULL,           -- guestDesignSchema, có trường v
  notes           TEXT,
  status          TEXT NOT NULL,           -- new | transferred | declined | spam
  ip_hash         TEXT,
  transferred_tenant_id TEXT REFERENCES tenants(id),
  transferred_at  TEXT,
  transferred_by  TEXT,
  decline_reason  TEXT,
  assistant_session_id TEXT REFERENCES guest_assistant_sessions(id),  -- hội thoại với trợ lý, nếu có
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE guest_tokens (              -- link ma thuật, dùng một lần
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES guest_contacts(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE guest_sessions (            -- cookie sq_guest
  id           TEXT PRIMARY KEY,
  contact_id   TEXT NOT NULL REFERENCES guest_contacts(id),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE guest_building_types (      -- loại nhà của trang Guest, super admin định nghĩa (bước ①)
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  base_preset  TEXT NOT NULL,            -- id ổn định của preset core
  config_json  TEXT NOT NULL,            -- hiển thị, cỡ khởi đầu, khoảng, cửa, màu, extras (zod: guestBuildingTypeSchema)
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Trợ lý AI (lát G-g). Tạo trước guest_requests trong file migration vì guest_requests tham chiếu nó.
CREATE TABLE guest_assistant_sessions (  -- cookie sq_ga, một phiên mỗi thiết kế
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  contact_id  TEXT REFERENCES guest_contacts(id),   -- khi khách đã có phiên sq_guest
  ip_hash     TEXT,
  turns       INTEGER NOT NULL DEFAULT 0,           -- để chặn trần số lượt
  closed_at   TEXT,                                 -- đóng khi gửi yêu cầu thành công
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE guest_assistant_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES guest_assistant_sessions(id),
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,       -- user | assistant | system
  kind        TEXT NOT NULL,       -- text | voice | change | confirm | question | note | error
  body_json   TEXT NOT NULL,       -- chữ đã che email/số điện thoại; change set nếu có
  state       TEXT,                -- thẻ thay đổi: applied | undone | overwritten
  created_at  TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
```

- `quote_requests` (có `tenant_id`, `guest_request_id`) được tạo **lúc chuyển**. Định nghĩa và vòng đời ở [quote-tiers-full.md](quote-tiers-full.md).
- "Email chưa xác nhận" **không phải** một trạng thái của lead. Nó được tính từ `guest_contacts.email_verified_at IS NULL`, nên khách bấm link một lần là mọi lead của họ đổi nhãn.
- **`guestDesignSchema`** trong `@sq/contracts` (zod):

  ```ts
  { v: 1, typeId, typeVersion,                               // loại nhà ở bước ①; preset nền lấy từ loại
    site: { suburb, state, postcode, street? },               // street tự do, không bắt buộc
    size: { span, height, pitchDeg, bays, bayWidth },         // mm và độ, trong khoảng của loại nhà; length = bays × bayWidth
    openings: [{ type: 'roller_door' | 'pa_door' | 'sliding_door' | 'window',
                 wall, offset, size, motorised? }],           // vị trí từ 2D hoặc chip vị trí
    colours: { walls, roof, trim: { barge, gutter, downpipe } },  // tên trong COLORBOND, không phải hex
    extras?: { skylights, insulation, birdProofing, overhangMm, awningWalls } }  // chỉ từ lát G-h
  ```

  Không chứa giá. Server kiểm lại thiết kế với **loại nhà hiện hành** (khoảng, cửa, màu được phép); loại đã bị tắt sau khi khách bắt đầu thì vẫn nhận, nhưng lead có ghi chú. Server kiểm lại vị trí bằng `placeOpening` và từ chối thiết kế có cửa chồng nhau.

## Bảo mật và chống lạm dụng

- **Hồ sơ theo email, không ghi đè khi chưa xác thực.**
  - Gửi lead không cần đăng nhập, nên ai cũng có thể gõ email của người khác.
  - Hệ quả: lead mới được gắn vào hồ sơ theo email, nhưng **không** ghi đè tên hay mobile của một hồ sơ đã xác thực. Tên và mobile lấy từ `contact_json` của chính lead.
  - Xem hồ sơ luôn cần link gửi tới đúng email đó, nên người gõ email giả không đọc được gì.
- **Link ma thuật:**
  - token 32 byte, chỉ lưu bản băm ([tokens.ts](../../apps/api/src/lib/tokens.ts));
  - dùng một lần, hạn 7 ngày;
  - trang mở link **không** tiêu token khi tải (GET); trang tự gửi POST, để máy quét link của hộp thư không đốt token;
  - đổi token lấy cookie `sq_guest` (HttpOnly, SameSite=Lax, hạn 90 ngày) và đặt `email_verified_at`.
- **"Gửi lại link"** luôn trả cùng một câu ("nếu email này có yêu cầu, link đã được gửi"), để không lộ email nào có trong hệ thống.
- **Rate limit** bằng `consume()`, tiêu trước khi insert:
  - gửi lead: theo IP và theo email;
  - xin link: theo IP và theo email.

  Con số cụ thể chọn trong plan. Các biến env mới phải thêm vào `turbo.json` `globalPassThroughEnv`.
- **Honeypot** như `enquiries`: bot điền vào thì nhận "thành công" giả, và không có dòng nào được ghi.
- IP chỉ lấy từ `request.ip` ([http.ts](../../apps/api/src/lib/http.ts) `clientIp`) và chỉ lưu bản băm.
- **Bridge, không CORS.** `apps/site` thêm route bridge `app/api/sq/[...path]/route.ts` giống `apps/client` (A14). Trình duyệt không gọi thẳng API, và cookie `sq_guest` do bridge chuyển tiếp.
- `sq_guest` **không bao giờ** mở được route của công ty. `guard.ts` chỉ nhận `sq_session`. Có test chứng minh.
- **Cookie `sq_ga`** (phiên trợ lý) chỉ mở được các route `/public/guest/assistant*` của chính phiên đó. Nó không phải bằng chứng danh tính: không mở "Yêu cầu của tôi", không gắn email. Quota, che PII và chống prompt injection: mục "Trợ lý AI" ở trên.

## API

**Công khai** (qua bridge của site):

| Route | Việc làm |
|---|---|
| `POST /public/guest-requests` | Body `{ design, contact, notes, consent, website }`. Kiểm schema, rate limit, honeypot. Tạo hoặc tìm `guest_contacts`, ghi `guest_requests`, gửi mail xác nhận có link ma thuật, báo cho vendor. Trả `202 { number }`. |
| `GET /public/guest/building-types` | Các loại đang bật, theo thứ tự (mặc định core khi chưa có dòng). Không có giá |
| `POST /public/guest/places/session`, `GET /public/guest/places/autocomplete`, `GET /public/guest/places/details` | Google Places có chống spam (bước ②) |
| `GET /public/guest/suburbs?q=` | Đường dự phòng của bước ②, từ `country_surburb` |
| `POST /public/guest/magic-link` | Body `{ email }`. Luôn trả 202. |
| `POST /public/guest/session` | Body `{ token }`. Hợp lệ thì đặt cookie `sq_guest`. |
| `GET /public/guest/me` | Hồ sơ, cộng danh sách yêu cầu: số, tóm tắt, trạng thái hiển thị cho khách, link báo giá khi đã có. |
| `POST /public/guest/sign-out` | Xóa phiên Guest. |
| `GET /public/guest/assistant?before=` | Hội thoại của phiên `sq_ga`, 30 tin mỗi trang. Chưa có phiên → danh sách rỗng. |
| `POST /public/guest/assistant/messages` | Body `{ text, design, step }`. Tạo phiên nếu chưa có, rate limit, che PII, gọi model, trả **SSE**: các đoạn chữ, rồi nhiều nhất một change set đã được server kiểm. |
| `POST /public/guest/assistant/changes/:messageId` | Body `{ state }` (`applied` / `undone` / `overwritten`), hoặc quyết định của thẻ xác nhận. Chỉ ghi trạng thái để hội thoại tải lại cho đúng. |
| `POST /public/guest/assistant/transcribe` | Audio ≤ 60 s, quota riêng. Trả `{ text }`; audio không lưu. |
| `DELETE /public/guest/assistant` | "Làm lại": đóng phiên hiện tại. |

Trạng thái khách thấy:
- "Đã nhận" — lead `new`;
- "Đang báo giá" — `transferred`;
- "Đã có báo giá" — `quote_requests` `quoted`;
- "Không thể báo giá" — lead `declined` do super admin từ chối hẳn. Một công ty từ chối thì lead quay về `new` ở platform để chuyển cho công ty khác, và khách vẫn thấy "Đang báo giá" (xem [quote-tiers-full.md](quote-tiers-full.md), câu hỏi mở).

Lead `spam` hiện như "Đã nhận".

**Admin** (cần `platform:enquiries` — cùng nhóm người đang đọc form liên hệ; tách capability riêng khi cần):

| Route | Việc làm |
|---|---|
| `GET /admin/guest-requests?status=&verified=&q=` | Danh sách, có nhãn "email chưa xác nhận" |
| `GET /admin/guest-requests/:id` | Chi tiết: thiết kế, liên hệ, lịch sử, hội thoại với trợ lý nếu có |
| `POST /admin/guest-requests/:id/transfer` | Body `{ tenantId, note? }`. Trong một transaction: tạo `quote_requests` ở tenant đó, đặt lead `transferred`, ghi `audit_events`, báo cho người có `request:manage` ở công ty nhận. Lead đã chuyển → 409. |
| `POST /admin/guest-requests/:id/decline` | Body `{ reason, notifyGuest }` |
| `POST /admin/guest-requests/:id/spam` | Đánh dấu spam; không gửi mail |
| `GET /admin/guest-types`, `POST /admin/guest-types`, `PATCH /admin/guest-types/:id` | Loại nhà (bước ①), cần `platform:templates`. Lưu thì kiểm bằng core; loại đã có lead không xóa được, chỉ tắt (`enabled: false`) |

- Chuyển một lead khi email chưa xác nhận: được, nhưng UI hỏi xác nhận lại.
- **Màn hình admin:** mục "Lead" trong sidebar, có huy hiệu số `new`. Bảng dùng `DataTable` có sẵn trong admin. Trang chi tiết có nút "Chuyển cho công ty", mở một hộp chọn công ty có ô tìm kiếm.

## Khi có báo giá

- Công ty gửi quote đã nối với yêu cầu (`send.ts`) → `quote_requests.status = 'quoted'` → tạo link chia sẻ ([shares.ts](../../apps/api/src/routes/shares.ts)) → mail cho khách: "Báo giá của bạn đã sẵn sàng", kèm link xem báo giá và link "Yêu cầu của tôi".
- Báo giá là tài liệu của công ty nhận, mang thương hiệu của họ. Khách biết công ty nào báo giá cho mình từ lúc này.

## Các lát

| Lát | Nội dung | Chạy được khi xong |
|---|---|---|
| (G-a) | `guestDesignSchema`, migration, `POST /public/guest-requests`, `GET /public/guest/building-types` (mặc định core), Places có chống spam cộng đường dự phòng `suburbs`, bridge của site, trang `/quote` 4 tab (token SSA, thanh tóm tắt, vùng Design responsive với điều khiển và `GuestPlan` 2D, hình minh họa ở 3D), form gửi, màn xác nhận, mail xác nhận | Khách gửi được lead, và lead có trong DB |
| (G-i) | Admin `/guest-types`: bảng, form sửa có xem trước, kiểm bằng core, version, audit. Cần (G-a) | Super admin đổi được cỡ và khoảng của từng loại, khách thấy ngay |
| (G-b) | Link ma thuật, phiên `sq_guest`, trang "Yêu cầu của tôi", gửi lại link, điền sẵn form | Khách xem lại được |
| (G-c) | Hộp Lead trong admin, chuyển / từ chối / spam, mail báo vendor | Super admin phân phối được |
| (G-d) | `quote_requests` và hộp thư công ty, tạo quote từ yêu cầu ([quote-tiers-full.md](quote-tiers-full.md)) | Công ty báo giá được |
| (G-e) | Gửi quote → trạng thái `quoted`, link chia sẻ, mail cho khách | Vòng khép kín |
| (G-f) | 3D chỉ xem: chuyển 3D sang `@sq/viewer3d`, nhúng vào tab "3D model" của sân khấu | Khách thấy 3D cập nhật theo 2D |
| (G-h) | Extras: skylight, insulation, bird proofing, mái chìa, mái hiên; khóa theo loại nhà; ánh xạ trong `configFromGuestDesign` sang `OptionKind` và `misc_option`. Tùy chọn, cắt đầu tiên | Khách chọn được extras |
| (G-g) | Trợ lý AI: phiên `sq_ga`, chat stream, `GuestDesignChangeSet` qua reducer chung, ngăn undo, thẻ thay đổi/xác nhận, giọng nói, quota và công tắc env, hội thoại đi theo lead. Cần (G-a); phần hiện hội thoại ở admin/công ty làm cùng (G-c)/(G-d) nếu chúng đã xong, không thì làm trong (G-g). Backend gọi model dùng chung được với trợ lý editor | Khách tạo và sửa thiết kế bằng lời |

## Tiêu chí chấp nhận

1. Không đăng nhập vẫn đi hết 4 tab. Tải lại trang giữa chừng không mất thiết kế.
1a. Trên điện thoại 375px, khách thêm được cửa cuốn bằng cách chạm tường, và kéo nó dọc tường. Cửa không bao giờ ra ngoài tường hay chồng lên cửa khác. Không file nào trong `apps/client/src/components/editor/` bị sửa, trừ đường import 3D ở (G-f).
1b. Kịch bản đầu cuối ở mục "Kịch bản kiểm thử đầu cuối" chạy qua (bước 7 thuộc G-g).
1c. Đổi kích thước, cửa hay màu ở bất kỳ chỗ nào (điều khiển, 2D, trợ lý) thì 2D, thanh tóm tắt, chip dưới sân khấu (và 3D khi có G-f) đổi cùng lúc.
1e. Tab dùng được hoàn toàn bằng bàn phím (←/→, Home/End, Enter); Back của trình duyệt về tab trước; mở `/quote?step=design` khi chưa chọn loại thì về tab ①.
1f. Super admin sửa cỡ khởi đầu hoặc khoảng của một loại thì lần tải trang sau khách thấy giá trị mới; tắt một loại thì thẻ biến mất. Lưu một loại có cửa mẫu không đặt được → bị từ chối, có lý do theo field.
1g. Places: không có phiên hợp lệ → 401; vượt giới hạn phiên, IP hoặc trần ngày → 429 / `unavailable` mà **không** gọi Google (có test với transport giả đếm số lần gọi); chạm trần thì trang chuyển sang đường dự phòng và vẫn gửi được lead.
1d. Mọi cặp màu chữ/nền trong [pages/guest-quote.md](../../design-system/smartquote-v2/pages/guest-quote.md) đạt 4.5:1, ở cả giao diện sáng và tối.
2. Thiếu một trong 4 trường, email sai, hoặc mobile không phải số Úc → báo lỗi ngay cạnh field. Gửi hợp lệ trả số yêu cầu.
3. Không route nào của site trả giá hay gọi `/evaluate`. Grep bundle của site không có chữ `contractCents`.
4. Lead hiện ngay trong admin với nhãn "email chưa xác nhận". Bấm link trong mail thì nhãn mất ở mọi lead của email đó.
5. Token đã dùng hoặc hết hạn bị từ chối. Mở link bằng GET (như máy quét link) không đốt token.
6. "Gửi lại link" trả cùng một câu cho email có và không có trong hệ thống.
7. Gửi lead với email của một hồ sơ đã xác thực không đổi tên hay mobile của hồ sơ đó.
8. Honeypot bị điền → trả "thành công", không ghi dòng nào. Vượt rate limit → 429.
9. Cookie `sq_guest` gọi route công ty → 401.
10. Chuyển lead tạo đúng một `quote_requests` ở tenant được chọn. Chuyển lần hai → 409. Công ty khác không thấy yêu cầu đó (mở rộng [isolation.test.ts](../../apps/api/src/__tests__/isolation.test.ts)).
11. Công ty gửi quote đã nối → khách nhận mail có link báo giá, và "Yêu cầu của tôi" hiện "Đã có báo giá".
12. Trang dùng được ở 360, 390, 768, 1024, 1280, 1440 px và 844 × 390 ngang: không cuộn ngang, nút ≥ 44px, bố cục khung ③ đúng bảng ở bước ③.
13. `pnpm typecheck`, `pnpm test` xanh; có một bài e2e đi hết trang và gửi lead.

Trợ lý AI (lát G-g):

14. Một câu mô tả ở bước 1 ("6 × 9 garage in Ballarat 3350, two roller doors at the front") dựng được thiết kế qua `guestDesignSchema`, và trang chuyển sang tab đầu tiên còn thiếu.
15. Mọi thay đổi của trợ lý đi qua cùng reducer với 2D: cửa trợ lý thêm không bao giờ ra ngoài tường hay chồng cửa khác. Change set có thao tác sai thì thao tác đó bị bỏ và khách được báo bằng lời.
16. "Hoàn tác" trên thẻ thay đổi trả thiết kế về đúng trạng thái trước lượt đó. Khách sửa cùng cửa trên 2D sau đó thì thẻ chuyển sang "đã bị thay đổi".
17. Đổi preset, hay đổi kích thước làm mất hoặc dời cửa, luôn hỏi trước.
18. Tải lại trang giữa chừng thì hội thoại và thiết kế đều còn. Gửi yêu cầu thành công thì lead có hội thoại; thiết kế mới bắt đầu hội thoại mới.
19. Không phản hồi nào của trợ lý chứa giá. Hỏi giá → câu cố định cộng nút "Go to Send request". Có test với một bộ câu hỏi giá cố định.
20. Email hay số điện thoại khách gõ vào chat bị che trong cả lời gọi model và trong DB. 4 trường liên hệ không có trong lời gọi model.
21. Giọng nói: lời nhận dạng vào ô nhập, không tự gửi; quá 60 s thì dừng ghi; audio không có trên đĩa hay trong DB.
22. Vượt quota hoặc tắt bằng env → dải "The assistant is unavailable…", và vẫn đi hết trang, gửi được lead.
23. Super admin đọc được hội thoại trong lead; công ty nhận lead đọc được bản chép ở trang yêu cầu. Công ty khác không đọc được.

## Câu hỏi mở (có mặc định)

- **Mail báo vendor gửi tới đâu?** Mặc định: một biến env danh sách email (thêm vào `turbo.json`), sau có thể chuyển vào cài đặt platform.
- **Khoảng kích thước cho Guest:** đã chốt 2026-11-18: super admin đặt theo từng loại nhà (bước ①); core chỉ giữ mặc định và giới hạn cứng.
- **Capability cho màn loại nhà:** mặc định `platform:templates`. Tách `platform:guest` nếu người quản lý lead và người quản lý catalogue là hai nhóm khác nhau.
- **Admin tạo được loại mới ngoài 4 loại mặc định** (ví dụ "Large farm shed" dựa trên Farm Machinery)? Mặc định: có, miễn dựa trên một preset core.
- **Điều khoản Google về cache kết quả Places và mức giá theo phiên:** *chưa kiểm tra*, giao `/research` trước khi chốt trần ngày.
- **Bảng màu cho Guest:** mặc định giao của `COLORBOND` trong core ([defaults.ts:11](../../packages/core/src/domain/defaults.ts:11)) và 22 màu của hướng dẫn. Bảng giá có các bảng `system_colour`, `system_drawing_colour`; chúng có khớp tên với `COLORBOND` không: *chưa kiểm tra*.
- **Hội thoại có tới công ty nhận lead không?** Mặc định: có, bản chép chỉ chữ, đã che. Khách được báo ngay dưới ô nhập.
- **Trợ lý có trả lời câu hỏi chung về sản phẩm không?** Mặc định: có, từ bộ kiến thức cố định của vendor; không giá, không thời gian giao hàng.
- **Nhà cung cấp model và nhận dạng giọng nói:** đã chốt 2026-11-18: gateway vilao, như dự án RFQ_PWA_SQ (mục "Nhà cung cấp model"). Backend viết để trợ lý editor dùng lại.
- **3 hay 4 trường liên hệ?** Hướng dẫn SSA muốn 3 trường (phone, địa chỉ bắt buộc; email tùy chọn). Mặc định: giữ D-T4 (4 trường, email bắt buộc), vì link ma thuật và "Yêu cầu của tôi" cần email. Đổi sang email tùy chọn thì khách không email không xem lại được yêu cầu.
- **Nhận số NZ (+64)?** Mặc định: không, vì gợi ý suburb và vùng gió chỉ có cho Úc.
- **Tiền tố số yêu cầu:** hướng dẫn dùng `SSA-####`. Mặc định: `GR-000123`, vì cổng chung là của platform. Nếu platform chỉ phục vụ thương hiệu SSA thì đổi tiền tố bằng một biến env.
- **Thẻ "Awning"** (mái hiên gắn vào nhà) của hướng dẫn: core chỉ có nhà mái đơn đứng riêng. Mặc định: thẻ "Skillion"; mái hiên gắn nhà ghi vào ghi chú.
- **Thương hiệu trên trang Guest:** mặc định theo bản mẫu: logo, đỏ/navy của SSA, font Archivo + Inter tự host. Logo: người dùng đã gửi ngày 2026-11-18, file ở `apps/site/public/brand/ssa-logo.png`. Quy tắc dùng ở mục 4a của override.
- **Trần lượt và ngân sách:** mặc định đặt bằng env; con số chốt trong plan sau khi đo chi phí một lượt thật.
- **Có cần chống bot trước khi cho gọi model hoặc Places** (ví dụ thử thách vô hình như Cloudflare Turnstile)? Mặc định: chưa; phiên tìm địa chỉ, rate limit và trần ngày trước, thêm nếu log cho thấy bị lạm dụng.
- **Giữ dữ liệu khách bao lâu?** Lead bị spam hoặc từ chối: mặc định xóa thông tin liên hệ sau 12 tháng. Cần xem lại theo Privacy Act của Úc trước khi ra mắt.
