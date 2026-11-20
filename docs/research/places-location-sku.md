# `location` trong Places Details (New): có làm tăng SKU không?

Kiểm tra ngày 2026-11-19, bước S0.3 của plan [quote-tiers-guest-ga2.md](../plans/quote-tiers-guest-ga2.md).

## Câu hỏi

Route `details` hiện gọi Google với `x-goog-fieldmask: formattedAddress,addressComponents`
(`apps/api/src/lib/places.ts:211`). Guest cần **vùng gió ước tính** từ toạ độ, nên phải xin
thêm `location`. Nếu `location` đẩy lần gọi lên SKU đắt hơn thì phải dừng và hỏi người dùng
trước S2.

## Kết quả

**Không tăng SKU.** `location` nằm cùng tier **Place Details Essentials** với `addressComponents`
và `formattedAddress`.

| Tier | Field liên quan |
|---|---|
| Essentials | `formattedAddress`, `addressComponents`, **`location`**, `plusCode`, `postalAddress`, `shortFormattedAddress`, `types`, `viewport` |
| Pro | `displayName`, `primaryType`, `timeZone`, `utcOffsetMinutes`, … |
| Enterprise | `internationalPhoneNumber`, `rating`, `regularOpeningHours`, `websiteUri`, … |

Nguồn: Google Maps Platform, trang *Places API (New) data fields* —
<https://developers.google.com/maps/documentation/places/web-service/data-fields> (bảng
"Field-to-SKU mapping", mục Place Details). Truy cập 2026-11-19.

Trang pricing tổng chỉ liệt kê tên SKU, không có bảng field → tier:
<https://developers.google.com/maps/billing-and-pricing/pricing>.

## Hệ quả cho S2

- Đổi field mask thành `formattedAddress,addressComponents,location`.
- Lần gọi `details` vẫn tính **một** lần Essentials, không đổi chi phí.
- Không cần hỏi người dùng; điều kiện dừng ở S0.3 **không xảy ra**.
- Toạ độ **không được** trả về trình duyệt (chỉ trả `windRegion` đã suy ra), vì Places chỉ cho
  lưu `place_id`; xem mục 3.4 của plan.
