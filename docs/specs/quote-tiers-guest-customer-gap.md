# Guest page: yêu cầu của khách đối chiếu với bản đang có

Ngày kiểm tra: 2026-11-19. Bản đang có là trang `apps/site` `/quote`, đã xong tới S8 của plan G-a. Spec gốc là `docs/specs/quote-tiers-guest.md`.

Price book đã soi là `data/price-books/fe5a7cae…db` (76 bảng). Code desktop là `../smq-code-smartquote`.

## 1. Bảng đối chiếu

| # | Khách yêu cầu | Đang có | Sổ giá / core cho phép | Đề xuất |
|---|---|---|---|---|
| 1 | Bước ①: chọn loại + địa chỉ, bắt buộc | Tab ① chọn loại, ② địa chỉ; chưa chọn thì không đi tiếp | — | Gộp ① và ② thành một bước "Bắt đầu" |
| 2 | 6 loại: Garage / Industrial Building / Riding Arena / Aircraft Hangar / Carport / Class 1 House | 4 loại: shed, garage, carport, skillion (`packages/core/src/domain/guest.ts:180-260`) | **Có cấu trúc:** Gable S4/5/6/Award, Skillion S4, AIRCRAFT HANGAR S6, Gable/Skillion Carport, Custom. **Không có:** Riding Arena, Class 1 House (sổ giá và desktop đều không có) | Xem quyết định Q1 |
| 3 | Một ô "Street number and name", bắt buộc chọn từ gợi ý, không có ô postcode riêng | Có combobox Places, nhưng còn 4 ô sửa tay (street/suburb/state/postcode) và một lối nhập suburb dự phòng | Places trả về đủ các phần (`apps/api/src/lib/guestPlaces.ts`) | Chỉ giữ một ô, bắt buộc chọn gợi ý. Các phần tách ra chỉ để đọc. Lối dự phòng chỉ hiện khi Places lỗi |
| 4 | First/Last name, Email, Phone ở bước đầu, cộng một ô lớn "Additional Request" | Thông tin liên hệ hỏi ở ④ (quyết định D-T4). `notes` tối đa 2000 ký tự ở ④ (`packages/contracts/src/guest.ts:214,240`) | — | Đảo D-T4: hỏi liên hệ ở bước đầu (Q2) |
| 5 | Mobile +61, placeholder "0412 345 678" | Đã có kiểm tra số AU | — | Giữ nguyên; thêm tiền tố +61 hiển thị cố định |
| 6 | Mặc định W 6.00 / H 3.00 / L 6.00 | Shed 9.0 × 3.0, 10°, 2 × 3.0; garage 6.0 / 2.4 / 15° | span 1.8–15 m, cao 2.2–6 m | Đổi mặc định theo khách |
| 7 | Mái GABLE mặc định, Skillion tuỳ chọn | Skillion là một *loại* riêng | Gable và Skillion là hai cấu trúc khác nhau | Chuyển thành công tắc mái trong bước BUILDING; bản chất là đổi cấu trúc |
| 8 | Độ dốc 10° mặc định, chọn 10/15/20/25/30°; Skillion 5°/10° | Gable [10, 12.5, 15, 17.5] (`guest.ts:135`); Skillion [5] | Sổ giá cho 7.5–30° (shed params 2) hoặc 7.5–15° (params 1, 3). **Skillion S4 tối thiểu 7.5°**, nên 5° nằm ngoài sổ | Gable cho 10/15/20/25/30, nhưng chỉ cấu trúc nào cho tới 30° mới hiện đủ. Skillion 5°: Q4 |
| 9 | Slab Connection: In Slab / On Slab / Footing Only | Đã bỏ (spec ~244, bảng lệch ~334) | `shed_footing_type` chỉ có In Slab (1) và On Slab (2). "Footing Only" không có trong sổ; gần nhất có lẽ là "Post in Ground" (thuộc In Slab), chưa xác nhận | Đưa lại In/On Slab. Footing Only: Q5 |
| 10 | Knee Brace / "No Knee Brace – If Possible" | Không có | KB do bảng kỹ thuật quyết (`view_system_lookup_data.KB_type`: NONE/SINGLE/DOUBLE, tra theo cấu trúc, gió, nhịp, cao…). Core không có trường knee brace | Chỉ ghi nhận là *mong muốn* gửi cho estimator, không phải lựa chọn đổi BOM. Đúng chữ "If Possible" của khách |
| 11 | Cladding: Vertical mặc định, Horizontal tuỳ chọn | Không có | Core có option `horizontal_cladding` (`packages/core/src/domain/types.ts:185,305`) | Làm được ngay |
| 12 | Bay Spacing theo từng bay, thêm/sửa/xoá bay. Shed/Garage/Awning 2 × 3.00 m; Carport 1 × 5.90 m | Chỉ cho bay đều (`guest.ts:32`; xoá `bayWidths` ở `guest.ts:359`); bay 2–6 m | Core có `bayWidths?: number[]` (`types.ts:421`). Sổ giá shed: bay **1–4 m**. Carport: params null, và bảng kỹ thuật `view_system_lookup_data` chỉ có `structure_code` 1 (bay 3.0/3.5/4.0 m), nên sổ giá không có giới hạn bay cho carport. **Desktop (kiểm 2026-11-19):** cũng chặn ở 4 m — `ServiceStructureData.cs:313` lấy `shedConfigs.Select(x => x.BayMax).Max()`, và khi danh sách rỗng thì `?? 4000`; đoạn code **không** bị comment out | Mở `bayWidths` cho guest, dùng giới hạn của sổ. Carport 5.9 m: Q6 |
| 13 | Dòng tự tính: "Region B – 45m/s. 10a Enclosed. Importance Level 2." / "10a Roof Only" | WindNote chỉ giải thích; cố ý không gọi ShedSafe (spec ~195) | Xem mục 2 | Q3 |
| 14 | Phải có ảnh 3D | Bản vẽ mặt bằng 2D cộng hình minh hoạ | Client đã có `Shed3D.tsx` (461 dòng), `Render3D.tsx` (293 dòng) và `components/three/*` | Đưa slice G-f lên trước, làm ngay sau G-a |
| 15 | Section "AI assessment" | Chưa có | Spec G-g (`quote-tiers-guest.md` ~366–515): trợ lý chat/giọng nói, thẻ thay đổi, Undo, không gửi hộ, không báo giá | Q7: xác nhận nghĩa |
| 16 | "Linh hoạt, tiện" | 4 tab | — | Xem mục 3 |

## 2. Dòng "Region B – 45m/s. 10a Enclosed. IL2" có liên quan SiteCheck không?

**Có.** Bốn giá trị này đúng là đầu ra của ShedSafe SiteCheck (AS/NZS 1170.2 và NCC):

- **Region B, 45 m/s:** vùng gió và tốc độ gió thiết kế. Việc đối chiếu vùng sang 45 m/s chưa kiểm tra.
- **10a:** hạng công trình theo NCC, tức nhà không để ở. Điều này cũng có nghĩa là **Class 1 House không phải 10a**.
- **Enclosed / Roof Only:** điều kiện kín hay hở, quyết định áp lực gió bên trong.
- **Importance Level 2.**

Ba ràng buộc đã đọc trong code:

1. `pin()` (`apps/api/src/lib/shedsafe.ts`) tạo hoặc sửa một *building* trên tài khoản ShedSafe của công ty. Nó cần `salesman` là email đã đăng ký, và cần có một quote. Mỗi khách vãng lai sẽ tạo một building rác trên tài khoản đó.
2. Giá trị chỉ được chứng nhận sau khi một người bấm **Auto Calc** trên web ShedSafe. `windRegion` có trước bước đó nhưng là giá trị thô.
3. Sổ giá không có bảng suburb → vùng gió: `country_surburb` chỉ có id, tên, mã và bang.

Các phương án:

- **(a) Gọi ShedSafe cho mỗi guest.** Có số thật nhưng chưa được chứng nhận, tốn lượt gọi, làm bẩn tài khoản công ty và cần người duyệt. Không khuyên dùng.
- **(b) Ước tính tại chỗ (khuyên dùng).**
  - Vùng gió lấy từ lat/lng Places, tra vào đa giác vùng A/B/C/D của AS/NZS 1170.2.
  - 10a cộng Enclosed/Roof Only suy ra từ loại công trình (carport/awning là Roof Only).
  - IL2 là mặc định.
  - Ghi rõ "ước tính — xác nhận trong báo giá". Khi estimator mở quote, SiteCheck thật chạy như hiện nay.
- **(c) Giữ ghi chú như hiện tại.** Không đáp ứng yêu cầu.

Nếu chọn (b), bản đồ vùng gió là dữ liệu ngoài repo, nên cần `/research` để lấy nguồn có trích dẫn.

## 3. Đề xuất luồng (gọn, linh hoạt)

```
① Bắt đầu     Loại công trình (thẻ) · Địa chỉ (1 ô, chọn gợi ý) · Họ, Tên, Email, Mobile
              → dòng gió/hạng ước tính hiện ngay khi chọn xong địa chỉ
② Thiết kế    Trái: W/H/L · mái Gable|Skillion · độ dốc · slab · knee brace (mong muốn)
                    · cladding · danh sách bay (thêm/sửa/xoá)
              Giữa: 3D xoay được (2D là tab phụ)
              Phải: Trợ lý AI (drawer/bottom-sheet trên màn nhỏ)
③ Gửi         Tóm tắt · ô lớn "Additional Request" · Gửi
```

- Thông tin liên hệ đã có từ ①, nên khách *có thể gửi sớm* ở bất kỳ bước nào sau ①: "chưa biết kích thước, cứ gửi".
- Có liên hệ sớm thì công ty gọi lại được cả khi khách bỏ dở. Muốn lưu bản dở thì cần đồng ý lưu (consent); việc này phải quyết.

## 4. Quyết định — **đã chốt 2026-11-19**

Người dùng chọn đúng đề xuất cho cả 8 câu, nên cột "Đã chốt" dưới đây là quyết định cuối. Riêng Q4, Q5 và Q6, lead mang cờ "estimator kiểm tra".

| # | Câu hỏi | Đã chốt |
|---|---|---|
| Q1 | Riding Arena và Class 1 House | Riding Arena chuyển sang Gable nhịp lớn (Series 5/6, tối đa 15 m; quá thì gửi estimator). Class 1 House là loại "yêu cầu riêng": không cấu hình, chỉ gửi thông tin và ô Additional Request |
| Q2 | Hỏi liên hệ ở bước ① (đảo D-T4)? | Có, như khách muốn |
| Q3 | Dòng gió/hạng | Phương án (b), ước tính và ghi rõ |
| Q4 | Skillion 5° (sổ giá tối thiểu 7.5°) | Cho chọn 5°, gắn cờ "estimator xác nhận"; hoặc đổi thành 7.5°/10° |
| Q5 | "Footing Only" | Ánh xạ sang Post in Ground; cần anh/chị hoặc khách xác nhận |
| Q6 | Carport 1 bay 5.9 m (shed bay tối đa 4 m; giới hạn carport chưa kiểm tra) | **Đã kiểm 2026-11-19:** sổ giá không có dòng `shed_parameters` nào cho carport (params NULL), và desktop cũng chặn ở 4 m bằng fallback `?? 4000` (`ServiceStructureData.cs:313`). Người dùng đã chốt giữ **1 × 5.90 m** kèm cờ duyệt `needsReview: ['bay']`; không đổi mặc định sang 2 × 2.95 m |
| Q7 | "AI assessment" là trợ lý chat G-g, hay AI *đánh giá* thiết kế (khả thi, rủi ro, gợi ý)? | Làm G-g có thêm một thẻ "Đánh giá" tự cập nhật: cảnh báo vượt sổ giá, gợi ý bay/độ dốc. Không báo giá |
| Q8 | Thứ tự làm | Sửa bước ① + BUILDING (G-a2), rồi 3D (G-f), rồi AI (G-g) |
