# Phân tích sâu: Guest qua cổng chung, đối chiếu với Quotec QuoteItNow

Ngày: 2026-11-17. Nguồn: bài phân tích Quotec của người dùng (kiểm tra trực tiếp ngày 16/11), đối chiếu với code v2 hiện tại. Mọi dữ kiện về v2 đều có file:line; chỗ nào chưa kiểm tra thì ghi rõ.

## 1. Hướng mới, theo câu trả lời ngày 2026-11-17

- **Guest không chọn công ty.** Có một cổng chung của platform, và chỉ **super admin (vendor)** nhận yêu cầu.
- Guest biết tới platform qua **web giới thiệu công ty** (Next.js riêng, không nằm trong repo này). Web app v2 vẫn là sản phẩm cho nhiều công ty.
- Như vậy yêu cầu của Guest là **lead của vendor**, không phải của một tenant. Điều này đảo ngược phần cốt lõi của spec Guest cũ (bảng `quote_requests` có `tenant_id`, link `/q/<CODE>`).

**Tin tốt: v2 đã có sẵn khung cho lead của vendor.**

| Đã có | Ở đâu |
|---|---|
| Bảng `enquiries`, không có `tenant_id`, đúng là lead của vendor | [001_init.sql:439](../../packages/db/migrations/001_init.sql:439) |
| Form công khai có rate limit, honeypot, IP băm | [enquiries.ts:121](../../apps/api/src/routes/enquiries.ts:121), [EnquiryForm.tsx](../../apps/site/src/components/EnquiryForm.tsx) |
| Capability `platform:enquiries` và route đọc lead cho vendor | [admin.ts:467](../../apps/api/src/routes/admin.ts:467), [:508](../../apps/api/src/routes/admin.ts:508) |
| Trang `/enquiries` trong admin | `apps/admin/src/app/enquiries/` |

Vậy Guest = **nâng cấp `enquiries`** từ "form liên hệ" thành "yêu cầu báo giá có thiết kế", chứ không phải dựng hệ thống mới.

## 2. Đọc lại bài Quotec: chỗ nào đúng, chỗ nào phải điều chỉnh cho v2

### Đúng, và v2 làm được ngay

| Khuyến nghị trong bài | v2 đã có gì |
|---|---|
| Thẻ loại công trình có hình, chọn một cú bấm; có preset kích thước phổ biến | `@sq/core` có sẵn 4 preset: Domestic Garage, Farm Machinery, Skillion Workshop, Open Carport ([presets.ts:74](../../packages/core/src/domain/presets.ts:74)). Tương ứng gần đúng với Shed/Garage/Carport/Awning của Quotec. |
| Mô hình 3D đổi màu và kích thước là thấy ngay | Client đã có `Shed3D`/`Render3D` ([Shed3D.tsx](../../apps/client/src/components/editor/Shed3D.tsx)) và một trang 3D **công khai, không cần phiên** `/demo` ([demo/page.tsx](../../apps/client/src/app/demo/page.tsx)). Dùng lại được cho Guest. |
| Giá đã gồm GST | Giá hợp đồng trong engine **đã gồm GST**, và GST là hằng số 10% ([price.ts:6-18](../../packages/core/src/lib/pricing/price.ts:6)). |
| Wizard có tiến trình, nút Quay lại | Editor nhân viên đã là 3 bước. Guest cần một wizard riêng, ngắn hơn, nhưng dùng chung engine. |
| Form lấy thông tin nhẹ: 4 trường, không SMS | Khớp với form `enquiries` hiện có. |

### Phải điều chỉnh — bài phân tích chưa tính tới những điều này

**(a) "Cho giá ngay" — đúng hướng, nhưng là giá của ai?**

Quotec là **một nhà sản xuất**, nên giá của họ là giá của chính họ. v2 là **platform cho nhiều công ty**, và mỗi công ty có margin và override giá riêng. Khi Guest gửi qua cổng chung thì chưa có công ty nào, nên con số hiện ra phải là **giá của platform**: bảng giá đã publish × một "margin cho Guest" do vendor đặt × 1.1 GST.

Rủi ro: lead được chuyển cho công ty X, và báo giá thật của X khác con số Guest đã thấy. Khách mất niềm tin.

Cách giảm rủi ro:
- hiện **khoảng giá làm tròn** (ví dụ $18,000 – $21,000), không hiện con số chính xác;
- ghi rõ "Giá tham khảo, đã gồm GST, phụ thuộc kiểm tra kỹ thuật và vị trí";
- **không bao giờ** trả dòng chi tiết hay đơn giá — chỉ trả hai đầu của khoảng.

**(b) Gió theo địa chỉ — Quotec làm, v2 không nên làm cho khách vãng lai.**

- Vùng gió của v2 lấy từ **ShedSafe**, một dịch vụ bên ngoài. Cấu hình nằm ở env của platform ([shedsafe.ts:151](../../apps/api/src/lib/shedsafe.ts:151)). Gọi ShedSafe cho mỗi khách vô danh tốn tiền và mở đường lạm dụng.
- Bảng giá **không có dòng cho vùng A1 và B1** ([wind.ts](../../packages/core/src/domain/wind.ts), phần chú thích đầu file). Các địa điểm đó không tính giá được bằng bảng này.
- Đề xuất: Guest **không gọi ShedSafe**. Giá tham khảo tính với một vùng gió giả định thận trọng theo bang, và ghi "đã giả định vùng gió X; sẽ xác nhận khi báo giá chính thức". Grep trong code không thấy bảng "postcode → vùng gió"; chưa kiểm tra kỹ, nên bảng giả định theo bang sẽ là dữ liệu mới, do vendor quản lý.

**(c) Autocomplete địa chỉ có giá tiền.**

- Route Places đã có, nhưng đòi phiên công ty với `quote:write` ([places.ts:60](../../apps/api/src/routes/places.ts:60), [:96](../../apps/api/src/routes/places.ts:96)) và gọi Google Places, là dịch vụ trả phí ([places.ts:50](../../apps/api/src/routes/places.ts:50)).
- Cho Guest dùng thì cần một route công khai riêng, có giới hạn tốc độ chặt.
- Fallback nhập postcode tay là bắt buộc. Bài phân tích cũng nói vậy ở điểm 4.
- Phương án rẻ nhất cho giai đoạn 1: chỉ hỏi **suburb + bang + postcode**. Địa chỉ đầy đủ để nhân viên hỏi sau.

**(d) "Không bắt đăng nhập" so với lựa chọn "xác thực email" của bạn.**

Hai ý này không mâu thuẫn nếu bỏ mật khẩu:
- khách điền 4 trường (họ, tên, email, mobile) rồi gửi;
- email gửi về một **link ma thuật**: bấm vào là vừa xác thực email, vừa mở trang "Yêu cầu của tôi";
- muốn xem lại sau này thì nhập email để nhận link mới.

Không mật khẩu, không SMS, mà vẫn chặn được email giả.

**(e) Click-to-place cửa trên tường.**

Đẹp, nhưng đắt và khó dùng trên điện thoại. Giai đoạn 1 chỉ hỏi **số lượng** cửa cuốn và cửa đi; nhân viên đặt vị trí. Click-to-place để sau.

**(f) Chống đối thủ cào giá.**

Một route trả giá công khai là cái máy cho đối thủ dò bảng giá. Cần:
- rate limit theo IP;
- làm tròn khoảng giá;
- giới hạn kích thước trong vùng preset;
- không trả dòng chi tiết;
- ghi log mỗi lần tính giá để phát hiện bất thường.

## 3. Luồng Guest đề xuất (5 bước, theo bài phân tích, chỉnh cho v2)

| Bước | Khách làm | Ánh xạ v2 |
|---|---|---|
| 1. Loại | Chọn 1 trong 4 thẻ preset | `PRESETS` |
| 2. Nơi đặt | Suburb, bang, postcode | `siteInput`, `stateCode`, vùng gió giả định |
| 3. Kích thước | Preset kích thước (6×6, 9×6, 12×6…) hoặc chỉnh rộng/dài/cao | `span`, `length`, `height`; khoảng bay lấy theo preset |
| 4. Cửa + màu | Số cửa cuốn, số cửa đi; màu mái và tường | `openings` vị trí mặc định, `colors` |
| 5. Giá + gửi | Thấy khoảng giá (nếu chọn D-T3 mới), điền 4 trường, gửi | lead của vendor |

- Mô hình 3D luôn hiện bên cạnh. Trên điện thoại, nó nằm trên đầu, có thể thu gọn.
- Nút "Xem giá / Gửi yêu cầu" dính ở đáy màn hình trên điện thoại.
- Thiết kế được giữ trong trình duyệt, nên tải lại trang không mất.
- Nút "Làm lại" hỏi xác nhận.

## 4. Sau khi super admin nhận — chỗ còn trống lớn nhất

Bạn nói "chỉ super admin nhận". Nhưng super admin (trang admin) **không có editor** và không phải một công ty, nên không tự lập được báo giá. Có ba khả năng:

1. **Super admin chuyển lead cho một công ty trên platform** (phân phối lead). Công ty đó báo giá bằng editor, và dùng lại hộp thư cùng nút "Tạo quote từ yêu cầu" trong spec bản đầy đủ. Platform có thêm giá trị bán cho các công ty: "chúng tôi mang khách tới cho bạn".
2. **Công ty của chính vendor báo giá.** Vendor có một tenant của mình, và mọi lead đi thẳng vào đó. Đây là trường hợp đặc biệt của (1), với một công ty cố định.
3. **Super admin chỉ liên hệ khách ngoài hệ thống** (gọi điện, email). Đơn giản nhất, nhưng lead không bao giờ thành quote trong v2.

Đề xuất: **(1)**, vì nó bao luôn (2). Lead là bản ghi của vendor; khi được chuyển, một bản `quote_requests` có `tenant_id` của công ty nhận được tạo ra, và lead ghi lại đã chuyển cho ai. Phần lớn spec Guest và spec bản đầy đủ cũ dùng lại được — chỉ đổi **ai tạo ra request trong tenant**: không phải khách, mà là vendor.

## 5. Luồng Guest đặt ở đâu

- **Web giới thiệu (Next.js riêng)** dẫn khách vào bằng nút "Báo giá ngay".
- Wizard nên nằm trong **`apps/site` của v2**:
  - cùng design system (`@sq/ui`, navy/gold);
  - cùng API và cookie;
  - dùng được 3D và engine mà không phải chép code sang repo khác.

  Web giới thiệu chỉ cần link sang (hoặc nhúng iframe).
- Nếu muốn wizard nằm ngay trong web giới thiệu, web đó phải gọi API công khai của v2 và tự dựng UI. Như vậy có hai bản UI để bảo trì, và 3D phải được tách ra thành package dùng chung.
- Dù chọn cách nào, 3D hiện nằm trong `apps/client` nên phải chuyển vào một package dùng chung (`@sq/ui` hoặc package 3D mới) thì `apps/site` mới dùng được.

## 6. Ảnh hưởng tới các spec đã viết

| Spec | Thay đổi |
|---|---|
| [quote-tiers.md](quote-tiers.md) | D-T1: vai trò tùy biến do admin công ty quản lý. D-T5/D-T6: cổng chung, lead của vendor. |
| [quote-tiers-dealer.md](quote-tiers-dealer.md) | "Dealer" không còn là vai trò cứng, mà là một **mẫu** trong hệ vai trò tùy biến. Phần tách `bom:read`, phạm vi `quote:all` và bịt lộ dữ liệu giữ nguyên. |
| [quote-tiers-guest.md](quote-tiers-guest.md) | Viết lại: cổng chung, không mật khẩu, nâng cấp `enquiries`, wizard 5 bước, 3D. |
| [quote-tiers-full.md](quote-tiers-full.md) | Hộp thư nhận **lead do vendor chuyển tới**. Trang admin có thêm màn hình phân phối lead. |

## 7. Quyết định cần chốt thêm

- **G1.** Super admin làm gì với lead? Đề xuất: chuyển cho một công ty (bao cả trường hợp công ty của chính vendor).
- **G2.** Mở lại D-T3: Guest có thấy khoảng giá không? Bài phân tích coi đây là lợi thế lớn nhất so với Quotec; trước đó bạn chọn "không". Đề xuất: **có, khoảng giá làm tròn**, nhưng làm sau khi luồng gửi yêu cầu chạy được.
- **G3.** Tài khoản Guest: không mật khẩu, dùng link ma thuật (đề xuất), hay có mật khẩu?
- **G4.** Wizard đặt trong `apps/site` (đề xuất), hay trong web giới thiệu?

### Đã chốt (2026-11-17)

- **G1:** chuyển cho một công ty. Vendor có thể có một hoặc nhiều tenant riêng (hiện có 2), và chúng được chọn như mọi công ty khác.
- **G2:** **không giá**, giữ D-T3. Các mục (a), (b) và (f) ở trên — giá platform, vùng gió giả định, chống cào giá — vì vậy chưa cần làm. Giữ lại phân tích phòng khi mở lại.
- **G3:** không đòi đăng nhập. Chỉ khi bấm QUOTE mới hỏi First Name, Last Name, Email, Mobile (+61); email về kèm link ma thuật để xem lại mọi yêu cầu. Khách đã mở link thì yêu cầu mới lưu vào hồ sơ của họ. Lead tới vendor ngay, nhãn "email chưa xác nhận" cho tới khi khách bấm link.
- **G4:** `apps/site` của v2, chỉ vài field.
- **2D hay 3D** (chốt sau): khách đặt cửa trên **mặt bằng 2D** (chạm tường, kéo dọc tường), và **3D chỉ để xem**. Guest có **trang riêng** với 2D viết mới bằng SVG; luật đặt cửa dùng chung `@sq/core`, nên không đụng tới editor của nhân viên. Mục (e) ở trên — chỉ hỏi số lượng cửa — vì vậy không còn đúng. Chi tiết ở [quote-tiers-guest.md](quote-tiers-guest.md).

Spec đã viết lại theo các lựa chọn này: [quote-tiers.md](quote-tiers.md), [quote-tiers-dealer.md](quote-tiers-dealer.md), [quote-tiers-guest.md](quote-tiers-guest.md), [quote-tiers-full.md](quote-tiers-full.md).
