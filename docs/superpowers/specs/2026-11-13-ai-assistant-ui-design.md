# Trợ lý AI trong trình soạn quote — định nghĩa giao diện

> Trạng thái: **đã duyệt ngày 2026-11-13** (D-AI1–D-AI7 theo mặc định đề xuất). Chỉ là giao diện. Phần backend (chọn LLM, prompt, danh sách tool, lưu trữ) cần một spec riêng.
> Liên quan: `docs/superpowers/plans/2026-11-13-editor-uiux-improvements.md` (T1–T6). Xem mục 12 về ảnh hưởng.

## 1. Mục tiêu

Người dùng có thể **gõ hoặc nói** yêu cầu và trợ lý tự điền quote theo yêu cầu đó. Ví dụ: "thêm 2 cửa cuốn 3×3 mặt trước", "đổi mái sang Colorbond Monument", "vì sao chưa bấm Get report được?".

Trợ lý dành cho hai nhóm:
- Người không biết option nằm ở đâu.
- Người ngại bấm từng ô.

Mỗi quote có **một phiên hội thoại**. Phiên được lưu cùng quote, nên mở lại quote thì thấy lại toàn bộ lịch sử.

**Không phải mục tiêu:**
- AI không tự tính giá. Engine `@sq/core` vẫn là nơi duy nhất tính giá (A13).
- AI không tự Save, Send, pin ShedSafe hay xoá quote.
- AI không thay thế form. Form vẫn là nguồn sự thật và vẫn sửa tay được.

## 2. Bỏ cột 3, thay bằng AI: có hợp lý không?

**Hợp lý, với một điều kiện: giá phải luôn nằm trên màn hình.** Người bán đọc giá cho khách khi đang gọi điện (docblock của `PricePanel`). Test `e2e/layout.spec.ts:59-85` cũng yêu cầu luôn có `aside[aria-label="Price"]` hoặc `aside[aria-label="Price summary"]` hiển thị.

**Phương án chọn:** ở xl, cột 3 trở thành **Assistant**. Giá chuyển lên dải `PriceSummary` dính ở trên cùng.
- Dải này hiện là `xl:hidden`; từ nay nó hiện ở mọi bề rộng.
- Dải hiển thị: giá hợp đồng, GST, khối lượng, delta của thay đổi gần nhất, và nút **Price details**.
- **Price details** mở toàn bộ `PricePanel` trong một drawer bên phải. Drawer phủ lên cột Assistant, đóng bằng ✕ hoặc Esc.
- Ở bước **Cost**, phần breakdown giá đã là nội dung chính (T2), nên không cần cột giá riêng.

**Các phương án đã loại:**

| Phương án | Lý do loại |
|---|---|
| Cột 3 có tab Giá / AI | Mở tab AI thì mất giá, vi phạm điều kiện trên. |
| Chat nổi (bubble) đè lên plan | Che plan, mà plan là nơi người dùng kiểm tra AI vừa làm gì. |
| Cột thứ 4 | Ở 1280 px thì plan còn dưới 500 px, quá hẹp. |
| AI nằm trong cột form | Form đã dài; chat và form tranh nhau chỗ cuộn. |

Mockup xl: form 380 px | plan ~1fr | Assistant 340 px, dải giá ở trên.

## 3. Bố cục theo breakpoint

| Bề rộng | Assistant | Giá |
|---|---|---|
| **≥1280 (xl)** | Cột 3 `minmax(0,340px)`, sticky, cao `calc(100dvh - dải giá)`. Thu gọn được thành một rail 48 px (icon ✦ + chấm báo tin chưa đọc), và plan rộng ra theo. | Dải trên cùng; **Price details** mở drawer. |
| **1024–1279 (lg)** | Drawer bên phải rộng 380 px, **không modal**: plan vẫn thao tác được. Mở bằng nút **Assistant** ở header editor hoặc phím `Ctrl+/`. | Dải trên cùng (như hiện nay). |
| **<1024** | Nút nổi (FAB) 56 px ở góc dưới phải, nằm trên safe-area. Bấm vào mở **bottom sheet** cao 85 dvh. Nhấn giữ FAB để nói luôn. | Dải trên cùng (như hiện nay). |

- Trạng thái mở/thu gọn **không lưu vào localStorage**, vì máy dùng chung (tiền lệ `QuoteTable.tsx:83`). Lưu theo người dùng phía server, hoặc mặc định "mở" ở xl.
- Khi drawer hoặc sheet mở, `SideFlyout` (Building parameters) vẫn phải nằm trên cùng. Thứ tự z-index: SideFlyout 40 > Assistant drawer 35 > dải giá 30.

## 4. Giải phẫu panel

```
┌ Assistant  [AI]                ⋯  ⟨ ┐  header: tên, badge "AI", menu phiên, thu gọn
│ ─ Hôm nay ─                        │
│                Thêm 2 cửa cuốn… 🎤 │  tin người dùng (🎤 = gửi bằng giọng nói)
│ Đã thêm 2 cửa cuốn ở tường trước.  │  tin AI (stream)
│ ┌ 2 thay đổi ──────────────────┐   │  thẻ thay đổi
│ │ + Roller door 3000×3000 ×2   │   │
│ │ Giá +$1,240                  │   │
│ │ [Hoàn tác] [Xem trên plan]   │   │
│ └──────────────────────────────┘   │
│ [Thêm cửa sổ] [Vì sao bị chặn?]    │  gợi ý theo bước
│ ┌──────────────────────────┐ 🎤 ➤  │  ô nhập + mic + gửi
│ └──────────────────────────┘       │
│ AI có thể sai. Kiểm tra giá trước khi gửi. │
└────────────────────────────────────┘
```

**Menu phiên (⋯):**
- *Xem phiên từ đầu*: lịch sử tải theo trang.
- *Xuất transcript*.
- *Tắt trợ lý cho quote này*.

Không có "Xoá phiên" ở bản đầu (xem quyết định D-AI5).

## 5. Các loại tin nhắn

| Loại | Hiển thị | Ghi chú |
|---|---|---|
| Người dùng — gõ | Bubble canh phải, nền `sq-brand/10` | Có tên người gửi khi quote có >1 người từng chat. |
| Người dùng — giọng nói | Như trên, thêm icon mic | Nội dung là transcript đã được người dùng duyệt. |
| AI — văn bản | Không bubble, chữ thường, stream từng đoạn | Markdown giới hạn: đậm, list, không ảnh, không link ngoài. |
| **Thẻ thay đổi** | Khung viền, danh sách field cũ → mới, delta giá, nút Hoàn tác / Xem trên plan | Mục 6. |
| **Thẻ xác nhận** | Khung viền `sq-attention`, mô tả hậu quả, nút **Áp dụng** / **Huỷ** | Cho thay đổi phá huỷ (mục 7). |
| Câu hỏi làm rõ | Văn bản + 2–4 chip lựa chọn | "Cửa ở tường trước hay hông?" Chip chỉ gửi lựa chọn đó làm tin người dùng. |
| Chỉ đường | Văn bản + nút "Mở Openings" | Khi AI không làm được (ví dụ cần ShedSafe): nhảy tới đúng field. |
| Lỗi | Dòng `sq-danger`, nút **Thử lại** | Mạng, hết quota, AI từ chối. |
| Ghi chú hệ thống | Chữ nhỏ canh giữa, `sq-ink-muted` | "Quote đã lưu bởi Nam · 14:02", "Giá thay đổi vì sửa tay". |

## 6. Thẻ thay đổi và mô hình hoàn tác

- AI **không ghi thẳng vào store**. AI trả về một tập thao tác (ví dụ `QuoteChangeSet`). Client chạy tập đó qua **cùng các writer** mà form đang dùng (`applyPartial`, `useShedDimensions`, writer của draft). Vì vậy validation, ràng buộc price book và câu hỏi "xoá mọi option" vẫn áp dụng như khi sửa tay.
- **Mỗi lượt AI là một mục undo** trong `useShedStore` (giới hạn 50, `HISTORY_LIMIT`). `Ctrl+Z` của editor hoàn tác lượt AI đó y như một lần sửa tay.
- **Field của draft** (khách hàng, ghi chú…) không nằm trong history. Thẻ thay đổi tự giữ snapshot giá trị cũ, và nút Hoàn tác ghi lại các giá trị đó.
- Thẻ có ba trạng thái: **Đã áp dụng** · **Đã hoàn tác** · **Đã bị ghi đè** (người dùng sửa tay đúng field đó sau khi AI áp dụng). Ở trạng thái "đã bị ghi đè", nút Hoàn tác đổi thành "Khôi phục giá trị AI" và hỏi xác nhận.
- **Delta giá** lấy từ engine sau khi áp dụng, không lấy từ AI. Khi engine đang tính, hiện skeleton. Nếu quote đang bị chặn tính giá, ghi "Chưa có giá: thiếu …".
- **Phản hồi trên form và plan:**
  - Field bị đổi có viền accent khoảng 2 giây và nhãn nhỏ "AI".
  - Phần tử mới trên plan nhấp nháy một lần.
  - Khi `prefers-reduced-motion`, bỏ animation và chỉ giữ viền tĩnh.
- **Xem trên plan:** chọn phần tử trên plan và cuộn form tới field tương ứng.

## 7. Khi nào tự áp dụng, khi nào hỏi

Mặc định (D-AI1): **tự áp dụng kèm hoàn tác** cho thay đổi đảo ngược được. **Hỏi trước** khi:
- Thay đổi xoá dữ liệu khác. Ví dụ đổi span, chiều cao hoặc pitch làm mất option, giảm số bay, xoá cửa.
- Một lượt có hơn 10 thao tác.
- Giá giảm hơn 10%. Ngưỡng này để admin cấu hình.
- AI không chắc. AI tự đánh dấu, hoặc yêu cầu mơ hồ.

**Không bao giờ** tự làm: Save, Send/Email, tạo PDF gửi khách, PIN/GO TO SHEDSAFE, Get report, xoá quote, đổi người phụ trách. AI chỉ có thể *đề xuất* các việc này bằng nút "chỉ đường".

**Quote chỉ đọc** (`canWrite = false`): AI vẫn trả lời câu hỏi, nhưng không có thẻ thay đổi. Composer ghi "Quote chỉ đọc — trợ lý chỉ trả lời câu hỏi".

## 8. Giọng nói

**Tương tác:** bấm mic để bắt đầu, bấm lần nữa hoặc ngừng nói 2 giây để dừng. Trên mobile, giữ FAB để nói. Transcript **điền vào ô nhập để người dùng sửa**, không tự gửi. Mặc định D-AI3; có tuỳ chọn "Gửi ngay khi dừng".

| Trạng thái | Hiển thị | ARIA |
|---|---|---|
| Rảnh | Icon mic, tooltip "Nói (Ctrl+M)" | `aria-label="Start voice input"`, `aria-pressed="false"` |
| Xin quyền | Hướng dẫn ngắn bên dưới: "Cho phép micro trên trình duyệt" | live region polite |
| Đang nghe | Nút đỏ `sq-danger` + sóng âm + đồng hồ 0:07; transcript tạm hiện mờ trong ô nhập | `aria-pressed="true"`, "Listening" |
| Đang xử lý | Spinner trên nút | `aria-busy` |
| Lỗi | "Không nghe thấy gì" / "Micro bị chặn — mở cài đặt trang" / "Mất mạng" | `role="alert"` |

- Giới hạn 60 giây mỗi lần nói, kèm cảnh báo ở giây 50.
- Ngôn ngữ nhận dạng mặc định là `en-AU`; menu phiên cho phép đổi sang `vi-VN`.
- Đọc câu trả lời thành tiếng (TTS) **tắt mặc định** (D-AI4), vì người bán thường đang nghe điện thoại.
- Mic chỉ bật khi người dùng bấm, không bao giờ nghe nền. Khi tab bị ẩn hoặc panel đóng thì tự dừng.

## 9. Phiên và lịch sử

- **Một phiên cho mỗi quote**, lưu phía server, có `tenant_id` và `quote_id`. Mỗi tin lưu: người gửi (user id hoặc "assistant"), thời điểm, nguồn (gõ/giọng nói), nội dung, change set và trạng thái thẻ.
- Mở quote thì tải 30 tin gần nhất và cuộn tới cuối; cuộn lên thì tải thêm. Có dải ngày ("Hôm nay", "12 Nov").
- **Quote mới chưa lưu:** phiên giữ trong bộ nhớ và được ghi cùng lần Save đầu tiên. Rời trang mà chưa Save thì mất phiên. Câu "rời trang?" hiện có của editor đã bao trường hợp này.
- **Nhân bản quote:** phiên mới, trống. Thêm ghi chú "Nhân bản từ Q-1234".
- **Nhiều người cùng quote:** tin có tên người gửi. Tin của người khác chỉ hiện khi tải lại, không realtime ở bản đầu.
- AI chỉ đọc phiên **của quote này**, cộng với trạng thái quote hiện tại. Nó không thấy quote khác hay khách khác.

## 10. Gợi ý theo bước

Hiện tối đa 3 chip phía trên ô nhập. Chip ẩn khi người dùng bắt đầu gõ.

| Bước | Ví dụ chip |
|---|---|
| Details | "Điền địa chỉ từ email khách" · "Kích thước phổ biến cho xe 2 chiếc" · "Vì sao chưa PIN được?" |
| Options | "Thêm cửa cuốn" · "Thêm cửa sổ hai bên" · "Đổi màu mái" |
| Cost | "Giải thích giá" · "Giảm giá 5%" (→ thẻ xác nhận) · "Còn thiếu gì trước khi gửi?" |

Khi có lỗi validation (`ErrorSummary`), chip đầu tiên là "Sửa giúp: {lỗi đầu tiên}".

## 11. Khả năng tiếp cận và chi tiết tương tác

- Thread dùng `role="log"` với `aria-live="polite"`. Khi đang stream, chỉ thông báo lúc tin hoàn tất, không đọc từng token.
- Ô nhập là textarea, tự cao 1–6 dòng. **Enter gửi, Shift+Enter xuống dòng.** Bỏ qua Enter khi `e.isComposing || e.keyCode === 229`, để gõ tiếng Việt bằng IME không gửi nhầm. Luôn có nút Gửi.
- **Phím tắt:**
  - `Ctrl+/` chuyển focus vào ô nhập, hoặc mở drawer.
  - `Esc` trong ô nhập trả focus về form.
  - `Ctrl+M` bật/tắt mic.
  - Không phím tắt nào được trùng với undo (`Ctrl+Z`).
- Mọi nút có kích thước tối thiểu 44×44, icon SVG từ `@sq/ui` (không emoji). Nút chỉ có icon phải có `aria-label`.
- Badge "AI" và dòng "AI có thể sai…" luôn hiện. Nội dung AI phải được nhận ra là của AI, không chỉ nhờ màu.
- Màu dùng token `sq-*` của MASTER.md (navy/gold, đạt AA). Không thêm gradient hay glass.
- Đang stream thì có nút **Dừng**. Có 👍/👎 trên tin AI (chỉ ghi nhận, không bắt buộc).

## 12. Ảnh hưởng tới kế hoạch T1–T6 (đã duyệt)

| Task | Thay đổi |
|---|---|
| **T1** — thu gọn cột giá ở xl | **Thay bằng:** cột 3 = Assistant (thu gọn thành rail); dải giá hiện ở mọi bề rộng; drawer Price details. Logic `editorLayout()` vẫn dùng được, chỉ đổi nội dung cột. |
| **T2** — Cost 640 px, ẩn cột giá | Giữ nguyên. Ở Cost, cột 3 vẫn là Assistant, hoặc thu gọn mặc định (D-AI6). |
| T3, T4, T5 | Không đổi. T4 (chip nhảy section) dùng chung cơ chế cuộn với "Xem trên plan". |
| T6 — docs | Thêm mục Assistant vào `docs/smartquote-quote-editor-reference.md` khi làm. |

**Đề xuất:** làm T2–T6 trước, vì chúng độc lập với AI. T1 làm lại theo spec này, như bước giao diện đầu tiên của Assistant: dựng khung panel trống, dải giá và drawer, chưa nối AI.

## 13. Trạng thái rỗng và lỗi

- **Phiên trống:** một câu giới thiệu ("Mô tả nhà kho bạn cần, hoặc hỏi về bất kỳ ô nào") và 3 chip của bước hiện tại.
- **Đang tải lịch sử:** 3 dòng skeleton.
- **API AI không khả dụng:** banner trong panel "Trợ lý tạm không dùng được — form vẫn hoạt động bình thường". Ô nhập bị disable. Editor không bị ảnh hưởng.
- **Công ty chưa bật AI** (cờ theo tenant): không có cột Assistant. Bố cục quay về 3 cột như hiện nay.

## 14. Quyết định (**đã duyệt ngày 2026-11-13**: dùng cột "Mặc định" cho cả D-AI1–D-AI7)

| # | Câu hỏi | Mặc định |
|---|---|---|
| D-AI1 | Tự áp dụng kèm hoàn tác, hay luôn đề xuất rồi bấm Áp dụng? | Tự áp dụng; hỏi trước với thay đổi phá huỷ (mục 7). |
| D-AI2 | Gửi dữ liệu khách (tên, địa chỉ, điện thoại) cho nhà cung cấp LLM? | Không gửi PII. AI chỉ thấy cấu hình nhà kho và field ở dạng tên. Muốn AI điền thông tin khách thì phải bật riêng theo công ty. |
| D-AI3 | Engine nhận dạng giọng nói: Web Speech của trình duyệt, hay STT phía server? | STT phía server (qua API, ghi âm không lưu). Web Speech gửi âm thanh tới Google/Microsoft ngoài tầm kiểm soát và không chạy trên Firefox. |
| D-AI4 | Đọc câu trả lời thành tiếng? | Tắt mặc định; bật được trong menu phiên. |
| D-AI5 | Người dùng được xoá phiên? | Không ở bản đầu. Phiên là một phần lịch sử quote. Admin xoá theo chính sách lưu trữ. |
| D-AI6 | Ở bước Cost, Assistant mở hay thu gọn? | Mở; giữ nguyên trạng thái người dùng đã chọn. |
| D-AI7 | Ngôn ngữ giao diện của panel | Tiếng Anh như phần còn lại của app. AI trả lời theo ngôn ngữ người dùng gõ. |

## 15. Để lại cho spec backend

Các mục sau thuộc spec backend: nhà cung cấp và model LLM, danh sách tool/thao tác cùng schema `QuoteChangeSet` (đặt trong `@sq/contracts`), bảng lưu phiên và migration, route `/api/v1/quotes/:id/assistant` qua bridge `app/api/sq/[...path]`, streaming (SSE), quota theo công ty, log và chính sách lưu trữ.
