# Đánh giá UI/UX trình soạn báo giá (2026-11-13)

Phạm vi: `apps/client` — `/quotes/new` và `/quotes/<id>/edit`, chủ yếu ở Bước 1 (Quote details).
Cách làm:
- Đo trên trình duyệt ở 1280×800 và 1440×900. Ở 1280, ba cột rộng 380 / 537 / 300 px.
- Đối chiếu với bộ quy tắc của skill `ui-ux-pro-max`: kết quả từ `--domain ux` cùng `references/quick-reference.md`. Mã quy tắc được ghi trong ngoặc.
- Không sinh lại design system. `design-system/smartquote-v2/MASTER.md` (navy/gold, đạt AA, font hệ thống) vẫn là chuẩn, nên không mục nào đề xuất đổi màu hay font.

Mức độ: **Cao** = che nội dung hoặc chặn thao tác; **Vừa** = làm chậm hoặc dễ nhầm; **Thấp** = chỉ là đánh bóng.

---

## 1. Popover PIN che cột form — **Cao** (phàn nàn của người dùng, đã tái hiện)

**Hiện trạng.**
- `BuildingParamsPopover.tsx:181-182`: trên desktop, popover treo **dưới** dòng địa chỉ (`lg:absolute lg:right-0 lg:top-full lg:w-[360px]`).
- Ở 1440×900, nó chiếm x 32–392 và y 420–827, tức là nằm đè lên chính cột form. Các ô bị che là Suburb, State, Postcode, nhóm Delivery và đầu nhóm Design. Mép dưới còn chạm footer sticky ("Next: the plan").
- Popover chỉ đóng bằng ✕ hoặc Escape, theo chủ ý: nhập dở thì không mất. Hệ quả là trong lúc mở, người dùng không nhìn thấy những ô form mà các thông số trong popover phụ thuộc vào. Span, Height và Length vốn sao chép từ nhóm Shed.

**Quy tắc vi phạm:**
- `focus-not-obscured` (WCAG 2.2 AA, *High*): phần tử đang focus không được bị lớp phủ cố định che. Skill khuyên "dismiss or move persistent overlays".
- `progressive-disclosure`: phần mở ra không nên đè lên ngữ cảnh mà nó bổ sung.
- `elevation-consistent`: popover dùng z-30, panel giá dùng sticky, footer cũng sticky. Ba lớp chồng nhau trong cùng một cột.

**Vì sao "qua bên phải" là đúng.**
- Ở Bước 1, cột giữa (Plan, 537 px) chỉ để xem trước, không có gì để nhập. Đây là vùng trống lớn nhất màn hình.
- Desktop cũng làm vậy: `UcAdjustBaySize` và các flyout khác bung **sang cạnh** form, không đè lên form.

**Phương án:**

| | Cách làm | Được | Mất |
|---|---|---|---|
| **A (khuyên dùng)** | Flyout neo vào **mép phải cột form**: `left: 100%`, đỉnh ngang dòng PIN, rộng 360 px, nằm đè lên cột Plan. Có mũi nhọn chỉ về nút PIN. Dưới `lg` vẫn giữ bottom sheet như hiện nay. | Form không bị che. Người dùng vừa nhìn thấy ô Span/Length vừa sửa thông số ShedSafe. Ít code: chỉ đổi lớp định vị cùng cách tính `flipUp` thành cách tính "còn chỗ bên phải không". | Che một phần bản vẽ trong lúc mở. Chấp nhận được, vì ở Bước 1 bản vẽ chỉ là xem trước. |
| B | Mở **inline** trong nhóm Site, đẩy nội dung xuống, giống bảng Bays hiện nay (`ShedGroup.tsx` ~648–700). | Không có lớp phủ nào, `focus-not-obscured` tự hết. | Form dài thêm khoảng 400 px. Nút GO TO SHEDSAFE và các ô Delivery bị đẩy khỏi màn hình. |
| C | Tạm **thay cột giá** (300 px) bằng panel ShedSafe. | Không che gì cả. | Giá biến mất đúng lúc người dùng đang chỉnh. Cột 300 px cũng hẹp cho 7 ô và một nút. |

**Lưu ý về chữ "giống Bay":** bảng Bays hiện **không** nằm bên phải. Nó mở inline trong nhóm Shed (phương án B). Nếu muốn mọi panel phụ cùng một kiểu, có hai hướng:
- Dùng A cho PIN, giữ Bays inline. Bays chỉ là một lưới ô số ngắn, inline vẫn hợp.
- Chuyển Bays sang flyout phải luôn cho đồng bộ (`consistency`). Nếu theo hướng này, nên tách thành một component `SideFlyout` dùng chung cho cả hai.

**Chi tiết cần giữ khi làm A** (đã có sẵn, không được làm mất):
- Focus vào `#sitecheck-params-importanceLevel` khi mở, trả focus về nút PIN hoặc `#sitecheck-status` khi đóng.
- Escape đóng popover. Không đóng khi bấm ra ngoài.
- `aria-expanded` và `aria-controls`.
- Tự đóng khi nhóm Site gập lại.
- Bổ sung: nếu cột Plan hẹp hơn 360 px (khoảng lg đến 1100 px), rơi về kiểu treo dưới như hiện nay, hoặc dùng bottom sheet.

Phác thảo A ở 1280:

```
┌ form 380 ─────────────┐┌ plan 537 ──────────────────────┐┌ giá 300 ┐
│ Address  [.......][PIN]◄┤ Building parameters        ✕  │ │         │
│ Suburb   [.......]    ││ Importance  [2 ▾]              │ │         │
│ State    [..] Pc [...]││ Span 6000   Height 3000        │ │         │
│ Delivery ...          ││ Length ...  Pitch ...          │ │         │
│                       ││ [ GO TO SHEDSAFE ]             │ │         │
│                       │└────────────────────────────────┘ │         │
└───────────────────────┘                                    └─────────┘
```

---

## 2. Dùng emoji làm icon — **Vừa**

- `SiteCheckPin.tsx:56` dùng `📍`. `BuildingParamsPopover.tsx:205` dùng `✕` làm nút đóng.
- Quy tắc `no-emoji-icons` (quick-reference §4) yêu cầu dùng SVG. Emoji hiển thị khác nhau giữa Windows, macOS và Android. Màu của emoji không theo token navy/gold, và độ đậm không khớp chữ bên cạnh.
- Repo **chưa có thư viện icon**: `@sq/ui` chỉ có brand, button, field và surface. Một số chỗ đã vẽ `<svg>` tay, như `StepRail.tsx` và `DimensionField.tsx`.
- Đề xuất: một file `icons.tsx` nhỏ trong `@sq/ui`, gồm pin, close, chevron và check, vẽ bằng SVG inline với `stroke="currentColor"`. Không nhất thiết phải thêm `lucide-react`; nếu thêm thì đó là một dependency mới, cần duyệt.

## 3. Hai nút cùng "trọng lượng chính" — **Vừa**

- Nút "Save revision" (`QuoteEditor.tsx:917`) và nút đang chọn "Plan" của toggle Plan/3D (`PlanView.tsx:84`) đều dùng nền `bg-sq-brand` đặc, chữ trắng. StepRail đang-chọn (`StepRail.tsx:113`) cũng vậy.
- Quy tắc `primary-action`: mỗi màn hình chỉ một CTA chính. Hiện mắt người dùng có ba điểm navy đặc cạnh tranh nhau.
- Đề xuất: toggle Plan/3D và StepRail chuyển sang kiểu "segmented". Mục đang chọn dùng nền `sq-brand/10`, chữ `sq-brand`, viền `sq-brand`. Nền đặc chỉ dành cho nút Save. Không phải thêm màu mới, chỉ dùng token sẵn có.

## 4. Danh sách allowances luôn mở trong cột 300 px — **Vừa**

- `PricePanel.tsx:165-181` liệt kê hết các mục, ví dụ "15 allowances in this price". Mỗi mục gồm một dòng mô tả và một dòng `code`, nên chiếm quá nửa chiều cao cột giá. Con số giá chính bị đẩy thành một phần nhỏ của panel.
- Quy tắc `progressive-disclosure`: giữ tiêu đề kèm số lượng và câu "indicative, not firm", còn danh sách thì gập lại bằng `<details>`/`<summary>`, mặc định đóng.
- Dòng `code` (ví dụ `bom.assumption.x`) là thông tin kỹ thuật. Nên chuyển nó vào `title`, hoặc chỉ hiện khi danh sách đang mở.

## 5. Ghi chú nhỏ — **Thấp**

- Dòng trạng thái ShedSafe (`#sitecheck-status`) và nút PIN cùng mở một popover. Hai lối vào cho cùng một chỗ là hợp lệ, không cần sửa.
- Biểu tượng "N" ở góc dưới trái đè lên footer là dev indicator của Next.js. Nó không có trong bản build, bỏ qua.
- `ControlSheet.tsx` (bottom sheet ở Bước 2 trên điện thoại) đã đủ các yêu cầu: `aria-modal`, focus vào và trả focus, Escape, bấm nền để đóng, vùng chạm 44 px. Đây là mẫu chuẩn trong repo cho phiên bản điện thoại của mọi panel phụ.

---

## Thứ tự đề xuất

1. **Mục 1, phương án A.** Đây là phàn nàn trực tiếp và mức Cao. Chỉ đụng `BuildingParamsPopover.tsx` (định vị và cách đo chỗ trống) cùng phần bọc trong `QuoteEditor.tsx` (cột form cần `relative`).
2. Mục 3: chỉ đổi class, rủi ro thấp.
3. Mục 4: một `<details>` trong `PricePanel.tsx`.
4. Mục 2: cần quyết định có tạo bộ icon trong `@sq/ui` hay không.

Chưa làm mục nào. Tài liệu này chỉ để chọn.

---

## Đã làm mục 1, 3, 4 (2026-11-13)

- **Mục 1 (phương án A):**
  - `BuildingParamsPopover.tsx` đo mép phải của cột form (`data-editor-column="form"` đặt ở `QuoteEditor.tsx`) rồi mở flyout **bên phải**, cách 12 px, ngang dòng PIN. Nếu thấp quá cửa sổ thì được kéo lên đúng mức cần. Mũi tên nhỏ chỉ về phía PIN.
  - Đo ở 1440×900: form kết thúc ở x=405, flyout nằm x 417–777, nên Suburb/State/Postcode/Delivery không còn bị che. Ở 1024×768 flyout x 404–764, không có cuộn ngang.
  - Dưới `lg` vẫn là bottom sheet như cũ. Esc, trả focus về nút PIN, chỉ đóng bằng ✕/Esc: giữ nguyên.
  - Bảng Bays đã chuyển sang cùng kiểu flyout (xem mục "Đã làm: Bays sang flyout phải" bên dưới).
- **Mục 3:** toggle Plan/3D đang chọn đổi sang viền + nền nhạt (`bg-sq-brand/10 text-sq-brand`); số bước hiện tại ở StepRail đổi sang viền. Nền navy đặc chỉ còn ở nút Save.
- **Mục 4:** "N allowances in this price" thành `<details>` đóng sẵn, kèm mũi tên xoay. Tiêu đề, số lượng và câu "indicative, not firm" luôn hiện.
- Mục 2 (thay emoji bằng SVG) chưa làm, chờ quyết định.
- Client typecheck sạch, vitest 81/81 pass. Không thêm test mới.

## Đã làm mục 2 (2026-11-13)

- Thêm `packages/ui/src/icons.tsx` (SVG inline, `currentColor`, `aria-hidden`): `PinIcon`, `CloseIcon`, `ExternalLinkIcon`, `WarningIcon`. Xuất qua `@sq/ui`. Không thêm dependency.
- Thay 📍 (nút PIN), ✕ (đóng popover), ↗ (hai link mở ShedSafe) và ⚠ (hai dòng "Differs from the certified dimensions" ở `ShedGroup.tsx`, `DesignGroup.tsx`).
- Nút PIN lúc popover mở cũng bỏ nền navy đặc, dùng nền nhạt như toggle Plan/3D (mục 3).
- Typecheck sạch, vitest 81/81. Đã kiểm tra trình duyệt: PIN và nút đóng là SVG, không còn emoji trong trang.
- Apps đọc `@sq/ui` từ `dist`: sau khi sửa phải `pnpm --filter @sq/ui build` (đã chạy).

## Đã làm: Bays sang flyout phải

- Tách `details/SideFlyout.tsx` dùng chung: đo mép phải cột form, mở bên phải cách 12 px, kéo lên nếu tràn đáy cửa sổ, mũi tên chỉ về nút đã mở nó, Escape và nút ✕ để đóng. `BuildingParamsPopover` (PIN) và bảng Bays đều dùng nó, nên hai panel hành xử như nhau.
- Bảng Bays neo ở hàng "Bay spacing" của nhóm Shed; mũi tên chỉ vào nút "Adjust bay spacing". Đo ở 1440×900: flyout x 417–777 (form kết thúc ở 405); ở 1024×768 x 405–765, không cuộn ngang.
- Khác với PIN, trên điện thoại Bays **không** thành bottom sheet mà vẫn nằm inline dưới hàng đó (`phone="inline"`). Lý do: panel này có thể tự mở khi có bay lỗi (`bayWidthIssue`); một sheet toàn màn hình tự bật khi vừa mở báo giá là quá phiền.
- Hai flyout cùng một chỗ nên chỉ một cái mở tại một thời điểm: mở PIN thì Bays đóng, mở Bays thì PIN đóng (trừ khi Bays đang bị giữ mở vì bay lỗi).
- Focus: mở bằng tay thì focus vào ô Bay 01, đóng thì về nút "Adjust bay spacing"; tự mở vì bay lỗi thì không cướp focus.
- `CommitNumberInput`: Escape trong ô giờ `preventDefault` (ô hoàn về giá trị cũ). Lần Escape thứ nhất chỉ hoàn ô, lần thứ hai mới đóng flyout, giống danh sách pitch.
- Vẫn như cũ: tổng các bay là chiều dài, khoảng cách danh nghĩa không đổi, nút "Divide equally again", nút "Split into N bays" dưới lỗi `shed-nomBaySpacing`, confirm "removes every option".
- Còn lại (minor): khi panel bị giữ mở vì bay lỗi thì nút ✕ / "Hide bays" không đóng được cho đến khi sửa bay đó.


## Đã làm T2–T6 của plan cải tiến UI/UX (2026-11-14)

Plan: `docs/superpowers/plans/2026-11-13-editor-uiux-improvements.md`. Chi tiết quy tắc: `smartquote-quote-editor-reference.md` §13.46.

| Task | Việc | Trước → sau (đo ở trình duyệt) |
|---|---|---|
| T2 | Bước Cost bỏ cột giá, giá ở dải sticky; cảnh báo chuyển lên đầu CostPanel (`PriceWarnings`) | Cột form Cost 380 → **640 px** ở 1440; dải giá 61 px luôn hiện |
| T3 | Options: bản vẽ lên trước dưới `lg` | Đỉnh bản vẽ ở 375×812: y = 3164 → **171** |
| T4 | Details: dải chip nhảy tới nhóm + đếm lỗi, nhóm đóng tự mở | Tiêu đề nhóm sau khi nhảy y = 152, đáy header 145 (đo ở 1440 sau khi thu gọn header) → không bị che (trước: che 49 px) |
| T5 | Thông báo "N item needs attention" ở StepRail thành nút | Bấm → `ErrorSummary` hiện và nhận focus (đã kiểm ở 375) |
| T6 | Cập nhật tài liệu này và reference | — |

- **T1 làm lại theo spec AI** (`specs/2026-11-13-ai-assistant-ui-design.md` §12), xong ngày 2026-11-14: khung Assistant (cột `xl`, drawer `lg`, nút tròn + sheet dưới `lg`), dải giá mọi độ rộng, drawer "Price details". Chưa nối AI; mặc định tắt, bật bằng `NEXT_PUBLIC_SQ_ASSISTANT=1` hoặc `?assistant=1`. Chi tiết và số đo: `smartquote-quote-editor-reference.md` §13.48. Lưu ý: ở 1280 bước Cost, bản vẽ chỉ còn ≈ 317 px khi Assistant mở.
- **Header 193 → 145 px** (cả 375 và 1440; mục tiêu ≤ 160): header sticky đổi từ flex-wrap sang lưới 3 hàng (tiêu đề | Save; trạng thái Saved + lý do Save full-width; chip). Lý do Save vẫn nằm trong header. Chip Delivery ở 1440: nhóm mở, tiêu đề y = 152 ≥ đáy header 145, có focus. Chưa kiểm trạng thái "Saved …" (không bấm Save trên báo giá E2E Smoke).
- Kiểm tra: client typecheck sạch; vitest **66/66** pass (8 file). Con số 81 ghi ở các mục trên là của một thời điểm trước; không test nào bị xóa trong đợt này (diff của `validation.test.ts` chỉ thêm 9 test, xóa 0). Không thêm test cho T2–T5 (tests mặc định tắt).
- Lỗi console 500 ở `components/demo/DemoBuilding.tsx` (thiếu `./parts`, `./textures`) là việc dở dang có sẵn, không liên quan.
