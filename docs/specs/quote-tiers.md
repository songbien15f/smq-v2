# Ba cấp báo giá: Guest, Dealer, Đầy đủ — spec chung

Trạng thái: **quyết định đã chốt** (2026-11-17), spec chờ duyệt.

Các spec con:
- [quote-tiers-dealer.md](quote-tiers-dealer.md) — vai trò tùy biến do admin công ty quản lý, kèm mẫu Dealer (không thấy BOM).
- [quote-tiers-guest.md](quote-tiers-guest.md) — khách vãng lai thiết kế và gửi yêu cầu qua cổng chung, không cần đăng nhập.
- [quote-tiers-full.md](quote-tiers-full.md) — những gì bản đầy đủ và trang admin phải thêm để nhận hai cấp kia.
- [quote-tiers-guest-analysis.md](quote-tiers-guest-analysis.md) — phân tích đối thủ Quotec QuoteItNow và lý do cho các lựa chọn của Guest.

## Mục tiêu

| Cấp | Là ai | Làm gì | Không được thấy |
|---|---|---|---|
| **Guest** | Người muốn mua nhà xưởng, biết tới platform qua web giới thiệu | Chọn vài field cơ bản, để lại 4 thông tin liên hệ, gửi **yêu cầu báo giá**, nhận báo giá qua email, xem lại bằng link email | Mọi thứ của công ty; giá (cho tới khi nhận báo giá chính thức) |
| **Dealer** (và mọi vai trò tùy biến) | Người bán lại, hoặc bất kỳ nhân viên nào admin công ty muốn giới hạn quyền | Dùng editor theo đúng những quyền vai trò của họ có | Những gì vai trò không có: BOM, giá bán, margin, quote của người khác… |
| **Đầy đủ** | `company_admin`, `estimator` | Như hiện nay, cộng hộp thư yêu cầu do vendor chuyển tới, và quản lý vai trò | — |

Luồng của một yêu cầu Guest:

```
web giới thiệu (Next.js riêng) ──"Báo giá ngay"──▶ apps/site /quote (wizard, không login)
        ──gửi──▶ hộp lead của vendor (apps/admin, super admin)
        ──chuyển cho một công ty──▶ hộp thư "Yêu cầu" của công ty (apps/client)
        ──tạo quote, gửi──▶ khách nhận báo giá qua email + xem lại bằng link
```

## Nguyên tắc (không thương lượng)

1. **Một engine, một kiểu quote.** Giá chỉ được tính trong `@sq/core` (A13). Không viết editor thứ hai. Thiết kế của Guest phải chuyển thành quote đầy đủ mà không mất dữ liệu.
2. **Server quyết định, UI chỉ che.** Dữ liệu bị giấu được lọc ở API theo capability ([roles.ts:12](../../packages/contracts/src/roles.ts:12)).
3. **Capability, không phải tên vai trò.** Không route nào được so sánh tên vai trò. Chỗ duy nhất đang làm vậy, [quotes.ts:143](../../apps/api/src/routes/quotes.ts:143), sẽ được sửa.
4. **Guest không phải thành viên công ty.** Guest không có dòng `memberships`, không chiếm seat, không có cookie `sq_session`. Lead của Guest thuộc **vendor** cho tới khi được chuyển cho một công ty.
5. **Cô lập theo công ty giữ nguyên.** Vai trò tùy biến và yêu cầu đã chuyển đều có `tenant_id`, và [isolation.test.ts](../../apps/api/src/__tests__/isolation.test.ts) được mở rộng cho các bảng mới.

## Quyết định đã chốt (2026-11-17)

| # | Câu hỏi | Đã chọn |
|---|---|---|
| D-T1 | Dealer là gì? | **Vai trò trong công ty.** Thêm hệ **vai trò tùy biến**: admin công ty tạo vai trò bằng cách tick quyền (thấy BOM, thấy giá bán, thấy margin, xem mọi quote…). Các vai trò có sẵn (admin, estimator, viewer, dealer) là **mẫu khóa**, không sửa được. |
| D-T2 | Dealer thấy quote nào? | **Chỉ quote mình tạo.** Tổng quát hơn: vai trò không có `quote:all` thì chỉ thấy quote mình tạo. |
| D-T3 / G2 | Guest có thấy giá không? | **Không.** Giá chỉ đến qua báo giá chính thức. Đã cân nhắc lại sau bài phân tích Quotec, và vẫn giữ lựa chọn này. |
| D-T4 / G3 | Đăng nhập và xác thực của Guest | **Không đòi đăng nhập.** Khách làm tới cuối rồi để lại tên, họ, email, mobile. Email gửi về có link ma thuật để xem lại mọi yêu cầu. Khách đã mở link (đã "đăng nhập") thì yêu cầu mới tự lưu vào hồ sơ của họ. Bấm link cũng là xác thực email. Yêu cầu tới vendor **ngay**, gắn nhãn "email chưa xác nhận" cho tới khi khách bấm link. |
| D-T5 | Guest tới đâu? | **Một cổng chung của platform**, không chọn công ty. Chỉ super admin nhận. |
| D-T6 | Tài khoản Guest | **Dùng chung platform** (theo email), không thuộc công ty nào. |
| G1 | Super admin làm gì với lead? | **Chuyển cho một công ty** trên platform. Vendor có thể có một hoặc nhiều tenant riêng (hiện có 2), và chúng được chọn như mọi công ty khác. |
| G4 | Wizard nằm ở đâu? | **`apps/site` của v2**, chỉ vài field. Web giới thiệu link sang. |
| D-T7 | Dealer có chiếm seat không? | **Có**, như mọi thành viên (D3). |

## Dữ kiện đã kiểm tra (2026-11-17)

- **Capability được giải ở đúng 4 chỗ:**
  - guard [guard.ts:49](../../apps/api/src/lib/guard.ts:49);
  - danh sách capability trả cho UI ở [auth.ts:92](../../apps/api/src/routes/auth.ts:92);
  - hai cờ ở [evaluations.ts:380-383](../../apps/api/src/routes/evaluations.ts:380).

  Cộng thêm một chỗ so sánh tên vai trò ([quotes.ts:143](../../apps/api/src/routes/quotes.ts:143)). Vì vậy vai trò tùy biến khả thi mà không phải sửa rộng.
- **`cost:read` đang gộp giá bán và dữ liệu xưởng** (BOM, .vqu, cut list khung, punching): [bomExport.ts:86](../../apps/api/src/routes/bomExport.ts:86), [vquExport.ts:24](../../apps/api/src/routes/vquExport.ts:24), [evaluations.ts:383](../../apps/api/src/routes/evaluations.ts:383). Phải tách ra để "thấy BOM" và "thấy giá bán" thành hai ô tick riêng.
- **Lỗi có sẵn:** `GET /quotes/:id/revisions` trả giá vốn (`total_cost_cents`, `price_json`) cho mọi người có `quote:read`, kể cả viewer ([quotes.ts:167-178](../../apps/api/src/routes/quotes.ts:167)).
- `quotes.created_by` lưu `session.userId` ([quotes.ts:324-334](../../apps/api/src/routes/quotes.ts:324)). `memberships.role` là TEXT, không có CHECK ([001_init.sql:64](../../packages/db/migrations/001_init.sql:64)).
- **`enquiries`** là form liên hệ chung của vendor (name, email, message, `source`), không có `tenant_id` ([001_init.sql:439](../../packages/db/migrations/001_init.sql:439)). Đọc qua `platform:enquiries` ([admin.ts:467](../../apps/api/src/routes/admin.ts:467)). Bảng này không có chỗ cho thiết kế hay vòng đời chuyển lead, nên Guest dùng bảng mới, cùng kiểu bảo vệ.
- **Có sẵn để dùng lại:**
  - 4 preset trong core ([presets.ts:74](../../packages/core/src/domain/presets.ts:74));
  - 3D và một trang 3D công khai ([demo/page.tsx](../../apps/client/src/app/demo/page.tsx));
  - editor nhận cấu hình ban đầu qua fragment ([fragment.ts:43](../../apps/client/src/components/editor/fragment.ts:43));
  - link chia sẻ quote `/s` ([shares.ts:33](../../apps/api/src/routes/shares.ts:33));
  - mail giao dịch ([auth.ts:49](../../apps/api/src/routes/auth.ts:49));
  - giới hạn tốc độ ([enquiries.ts:121](../../apps/api/src/routes/enquiries.ts:121)).

## Mô hình chung

- **Danh mục capability cố định trong code** ([roles.ts](../../packages/contracts/src/roles.ts)). Thêm:
  - `bom:read` — dữ liệu xưởng;
  - `quote:all` — mọi quote của công ty;
  - `request:manage` — hộp thư yêu cầu.

  Vai trò tùy biến chỉ chọn được trong danh mục này; không ai tạo được capability mới.
- **Mẫu khóa (built-in):**

  | Capability | company_admin | estimator | viewer | dealer |
  |---|---|---|---|---|
  | quote:read / write / send | ✓ ✓ ✓ | ✓ ✓ ✓ | ✓ – – | ✓ ✓ ✓ |
  | quote:all | ✓ | ✓ | ✓ | – |
  | cost:read (giá bán) | ✓ | ✓ | – | ✓ |
  | bom:read (dữ liệu xưởng) | ✓ | ✓ | – | – |
  | cost:margin | ✓ | – | – | – |
  | price:manage | ✓ | ✓ | – | – |
  | request:manage | ✓ | ✓ | – | – |
  | members / settings / usage | ✓ | – | – | – |

- **Guest nằm ngoài hệ vai trò.** Guest có bảng, cookie và route riêng ở cấp platform.
- **Thiết kế Guest → cấu hình đầy đủ:** một hàm thuần duy nhất `configFromGuestDesign(design, base)` trong `@sq/core`.

## Thứ tự làm

1. **Giai đoạn 1 — Quyền và vai trò** (cỡ *standard*/*large*):
   - (a) tách `bom:read`, bịt hai chỗ lộ dữ liệu, thêm `quote:all` và phạm vi "quote của tôi";
   - (b) mẫu `dealer`;
   - (c) vai trò tùy biến.

   (a) đáng làm ngay, kể cả khi chưa làm gì khác, vì nó sửa một lỗi lộ giá vốn.
2. **Giai đoạn 2 — Guest** (cỡ *large*, chia lát dọc):
   - wizard và gửi yêu cầu;
   - hộp lead của vendor;
   - chuyển cho công ty và hộp thư công ty;
   - tạo quote từ yêu cầu;
   - trả báo giá và link xem lại.
3. **Sau đó, tùy chọn:** 3D trong wizard; autocomplete địa chỉ; giá riêng cho dealer.

## Ngoài phạm vi

- Thanh toán hoặc đặt cọc online.
- Dealer là một công ty riêng.
- Giá tham khảo cho Guest (đã chọn không).
- SMS.
- App di động.
- Đổi engine BOM hay bảng giá.
