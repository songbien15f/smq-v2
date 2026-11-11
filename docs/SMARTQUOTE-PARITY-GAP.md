# SmartQuote v2 — mức độ khớp với desktop: đang ở đâu, còn thiếu gì

Viết 2026-11-11, sau khi **bốn trường "đã convert xong"** lộ ra trong cùng một ngày
(`wallProfile`, `roofProfile`, `downpipeType`, `footingType` — đều chọn được, đều được lưu, đều
được in lên tài liệu, và **không cái nào được giá đọc**).

Đây là câu trả lời cho *"bạn đã convert đúng và đủ chưa?"*. **Chưa.** Tài liệu này ghi **ở đâu**,
kèm bằng chứng từ source và từ đo, để phiên sau không phải hỏi lại.

> **Luật của file này:** chỉ ghi dòng nào đã **đọc trong code** hoặc đã **đo**. Chỗ chưa kiểm thì
> ghi *chưa kiểm* — không bao giờ ghi "ok", không bao giờ ghi "thiếu".

---

## 1. Tổng quan

| Khu vực | Trạng thái |
|---|---|
| Step 1 — 3 nhóm đầu | **khớp field**; Quote No. đã bổ sung |
| Step 1 — Design | khớp |
| Step 1 — Shed | khớp; Typical Design + awning đã đúng nhóm |
| Step 1 — Colours | khớp; Horizontal Cladding đã bổ sung |
| Step 2 — Options dock | khớp chức năng (12 loại qua context menu); dock chỉ liệt kê 7+3 |
| Step 3 — Cost | **chưa kiểm** trong đợt này |

**Trạng thái sau khi sửa (2026-11-11):** các mục 1–5 của §6 đã xong. Còn mục 6 (min bays 1 vs 2,
là quyết định không phải lỗi), Show More Parameters, và toàn bộ Step 3 chưa kiểm.

Phát hiện lớn nhất không phải về thứ tự: **ba loại option tồn tại trong domain, được BOM định giá,
và không có cách nào tạo ra chúng từ giao diện.**

---

## 2. Các lỗi conversion đã tìm ra ở các đợt trước (bối cảnh)

Tất cả đều đo được. Mỗi dòng từng được đánh dấu "xong" trước khi bị phát hiện.

| Trường | Đo trước | Đo sau |
|---|---|---|
| `roofProfile` | tổng y hệt | mái Lo-Rib **−$273,63** |
| `roofBmt` (0,48) | tổng y hệt | **+$430,63** |
| `wallProfile` + `wallBmt` | tổng y hệt | tường TL-5 0,35 **−$475,68** |
| `downpipeType` | tổng y hệt | STEEL **−$49,56** |
| `footingType`/`SubType` | cột **28,80 m** mọi tổ hợp | PIG **28,00 m**, slab **24,00 m** |
| `shieldingFactor` | tổng y hệt | **vẫn chưa đọc** (KNOWN-DEVIATIONS 44) |

---

## 3. Step 1 — so từng nhóm

Tham chiếu desktop: `docs/smartquote-analysis/2026-11-10-step1-quote-details-sitecheck-workflow.md` §3.
Tham chiếu v2: `apps/client/src/components/editor/QuoteDetailsPanel.tsx`.

### 3.1 Nhóm 1 — Quote & Client

| # | Desktop | v2 | Kết luận |
|---|---|---|---|
| 1 | Quote No. (read-only, field đầu tiên) | `customer-quoteNumber` — **đã thêm 2026-11-11** | khớp |
| 2 | Quote Rate (dropdown) | `customer-quoteRatePct` (số) | khớp chức năng |
| 4–6 | First / Last / Email (bắt buộc) | `customer-firstName/lastName/email` | khớp |
| 7–9 | Phone / Mobile / Fax | `customer-phone/mobile/fax` | khớp |
| 10 | Address (Places, bắt buộc) | `customer-address` | khớp |
| 11 | State, Postcode (disabled, ghép sẵn) | `customer-suburb/state/postcode` sửa được | **khác hành vi** |
| 3 | Client Name | không có | desktop cũng ẩn (Hidden) |

### 3.2 Nhóm 2 — Site Address

| Desktop | v2 | Kết luận |
|---|---|---|
| Copy from Above (có điều kiện) | nút "Copy from customer" | khớp (điều kiện khác: v2 luôn bật) |
| Address (kèm nút PIN) | `site-address` + `SiteCheckPanel` đặt **sau nhóm Delivery** | **PIN ở vị trí khác** |
| State, Postcode (disabled) | `site-suburb/state/postcode` sửa được | khác hành vi |

### 3.3 Nhóm 3 — Delivery

| Desktop | v2 | Kết luận |
|---|---|---|
| Copy from Above | "Copy from above" | khớp |
| Address | `site-deliveryAddress` | khớp |
| Delivery Scope | `site-deliveryScope` | khớp |
| Switch cam kết | `site-deliveryAcknowledged`, reset khi đổi scope | khớp |

### 3.4 Nhóm 4 — Design Parameters

| # | Desktop | v2 | Kết luận |
|---|---|---|---|
| 24 | GET SITECHECK REPORT (button) | panel ShedSafe riêng | khác vị trí, chức năng có |
| 25 | Structure Type (dropdown) | `design-structureType` | khớp — **11 lựa chọn**, gồm 2 dòng custom |
| 26–31 | 6 giá trị chứng chỉ, disabled | 6 read-only, 3 trạng thái | khớp (v2 hơn: nói rõ nguồn) |
| 32 | Show More Parameters (7 field địa lý) | n/d | **THIẾU** — v2 chỉ hiện 6 |
| 33 | Internal Pressures (dropdown) | `design-internalPressure` read-only, suy ra | **cố ý** (§13.29.1) |
| 34–35 | End/Side Opening (2 switch mỗi cái) | 4 switch "Walls left open" | khớp |
| 36 | Cantilever (checkbox tổng) | không có checkbox; 0 = bỏ | khác nhỏ |
| 37–38 | Front/Rear Cantilever, max 1400 | `design-cantilever-front/back`, luật 1400 | khớp |
| 39 | Gable Infill (1 checkbox) | 2 checkbox (front/back) | khớp, chi tiết hơn |
| — | — | `design-stateCode` | **v2 thêm** |
| 43–44 | Front/Rear Awning (read-only, từ ShedSafe) | **đã chuyển về Shed** 2026-11-11 | khớp |

### 3.5 Nhóm 5 — Shed Parameters

| # | Desktop | v2 | Kết luận |
|---|---|---|---|
| 42 | Span / Width | `shed-span` | khớp |
| 43–44 | Front/Rear Awning | ở Design (§3.4) | **KHÁC NHÓM** |
| 46 | Height | `shed-height` | khớp |
| 47 | **Typical Design** (knee brace, read-only) | `shed-kneeBrace` — **đã thêm**, đọc từ cut list | khớp |
| 48 | Overall Length | `shed-length` | khớp |
| 49 | Adjust Bay Spacing (nút → flyout) | panel inline, thu gọn | khớp |
| 50 | No. of Bays (min 1, default 2) | `shed-bays` (**min 2**) | **min khác** (1 vs 2) |
| 51 | Nom. Bay Spacing | `shed-nomBaySpacing` | khớp |
| 52 | Roof Pitch | `shed-roofPitchDeg` + datalist theo sách | khớp (v2 hơn: lọc theo span) |
| 53–54 | Wall/Roof Profile Type | `shed-wallProfile` + `shed-wallBmt` | khớp, **thêm BMT** |
| 55 | Downpipe Type | `shed-downpipeType` + lọc màu | khớp |
| 56–57 | Footing Type / Sub Type | `shed-footingType/SubType` | khớp, và nay **đến được giá** |

**Thứ tự v2:** Span · Height · Length · Bays · Nom. Spacing · panel Bay · Wall · Roof · Downpipe · Footing · Pitch · hai chiều cao.
**Thứ tự desktop:** Span · Awnings · Height · Typical Design · Length · Adjust · Bays · Nom · Pitch · Wall · Roof · Downpipe · Footing.

Khác: awning đã rời nhóm, Typical Design không có, và **pitch đứng sau footing** ở v2 nhưng đứng
trước Wall ở desktop.

### 3.6 Nhóm 6 — Colours

| # | Desktop | v2 | Kết luận |
|---|---|---|---|
| 59 | Assign Wall Colour for All | nút có | khớp |
| 60 | Wall | `colours-wall` | khớp |
| 61 | **Horizontal Cladding** (boolean, con của Wall) | `colours-horizontalCladding` — **đã thêm** | khớp |
| 62–70 | Roof · Barge · Downpipe · Gutter · Window · PA · Roller · Sliding · Dividing | 10 vai trò trong `COLOUR_ROLES` | khớp |

---

## 4. Step 2 — Options dock

Sách khai **21** category trong `system_structure_option`; v2 có **15** trong `CATEGORY_DOCK`.

| # | Category (sách) | v2 | Đường tạo |
|---|---|---|---|
| 1–3 | Window · PA Door · Roller Door | ✅ dock | dock |
| 4 | Outrigger | ✅ dock | dock |
| 5 | Track | ✅ view | dock (view) |
| 6 | Sliding Door | ✅ dock | dock |
| 7 | Dividing Wall | ✅ dock | dock |
| 8 | Opening | ✅ dock | dock |
| 9 | Skylight | ✅ dock | dock |
| 10 | Mezzanine | ✅ dock | dock |
| 11 | Awning | ✅ dock | dock |
| 12 | Carry Beam | ✅ dock | dock |
| 13 | Misc. Options | ✅ dock | dock |
| 14–15 | Extra / Engineering Charges | ✅ view | dock (view) |
| 16 | Internal Pressures | n/d | **cố ý** — suy ra (§13.29.1) |
| 17 | Quick Opening | n/d | trùng Opening |
| 18 | **Cantilever** | có type + BOM | **chỉ Step 1** (2 ô số) |
| 19 | **Gable Infill** | có type + BOM | **chỉ Step 1** (2 checkbox) |
| 20 | **Overhang** | có type + BOM | **KHÔNG CÓ** |
| 21 | **Horizontal Cladding** | có type + BOM | **KHÔNG CÓ** |
| — | **Stable** | có type + BOM | **KHÔNG CÓ** |

### 4.1 Sửa sai: ba loại đó **có** đường tạo — qua context menu, không qua dock

Bản đầu của tài liệu này ghi `stable`, `overhang`, `horizontal_cladding` là "KHÔNG CÓ" đường tạo.
**Sai.** Tôi chỉ grep `defaultOptionsFor` và đọc `CATEGORY_DOCK`, không kiểm context menu của plan.

`Render2D.tsx:836-846` dựng menu "Add option" từ **`OPTION_KIND_OPTIONS`** — chính danh sách trong
`domain/selection.ts` có đủ **12** loại kèm nhãn và nhóm. `:953-959` gọi `addOption(kind)`, và
`defaultOptionsFor` có nhánh cho từng loại (`options.ts:260-295`).

Nên đường tạo là:

| Đường | Loại phủ |
|---|---|
| Dock (`CATEGORY_DOCK`) | 12 loại + 3 view |
| Context menu trên plan ("Add option") | **cả 12** `OptionKind` |
| Step 1 (Design) | `cantilever`, `gable_infill` |

Điều còn **thật**: dock **không** liệt kê `stable`, `overhang`, `horizontal_cladding`, `cantilever`,
`gable_infill` — nên chúng chỉ tạo được qua menu chuột phải trên plan. Một người dùng màn hình cảm
ứng hoặc bàn phím không mở được menu đó sẽ không tìm ra. Đó là **lỗ về khả năng tiếp cận**, không
phải lỗ về chức năng, và nhẹ hơn nhiều so với điều tôi đã viết.

Xác nhận cần làm: mở menu đó trong trình duyệt và đếm 12 dòng.

---

## 5. Những gì **chưa** kiểm

- **Step 3 (Cost)** toàn bộ: chưa so trong đợt này.
- **Nhóm 2/3 desktop** ở các field Hidden (`SuburbName`/`State`/`Postcode`) — v2 để cả ba sửa được;
  nếu desktop ẩn chúng vì Places điền vào, việc mở ba ô tự do có thể tạo địa chỉ không nhất quán.
  **Chưa kiểm.**
- **Quote Rate**: desktop là danh sách (`XCustomerRate`, `RateCode`); v2 là số 0–100. Có thể là đơn
  giản hoá đúng, có thể là mất dữ liệu. **Chưa kiểm.**
- **Steelwork Schedule**, **RESET**, **SAVE && NEXT** ở top bar: v2 có Save và Reset ở chỗ khác;
  phiếu steelwork có thành `SteelworkPanel`. Mapeamento **chưa kiểm**.

---

## 6. Thứ tự sửa đề xuất

1. **Ba loại option không có giao diện** (§4.1) — đây là lỗ hổng chức năng, không phải thứ tự.
2. ~~**Horizontal Cladding trong nhóm Colours**~~ — **XONG 2026-11-11**: switch trong Colours tạo/xoá
   option `horizontal_cladding`.
3. ~~**Typical Design (knee brace) read-only** (§3.5 #47)~~ — **XONG 2026-11-11**: `shed-kneeBrace`,
   đọc từ `evaluation.members` (cùng nguồn với cut list).
4. ~~**Quote No. và nhóm của awning**~~ — **XONG 2026-11-11**: số quote vào đầu Quote & client;
   awning về Shed đúng #43-44.
5. **Show More Parameters (7 field địa lý)** (§3.4 #32) — v2 đã đọc và lưu; chỉ chưa hiện.
6. **Min bays 1 vs 2** — quyết định, không phải lỗi: desktop cho phép 1.
