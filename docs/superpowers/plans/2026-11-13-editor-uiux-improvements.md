# Cải tiến UI/UX trình soạn báo giá — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Cập nhật 2026-11-14:** T2–T6 đã làm (xem `docs/reviews/2026-11-13-ui-ux-review.md`). **T1 bị thay** bởi `docs/superpowers/specs/2026-11-13-ai-assistant-ui-design.md` và **đã làm lại theo spec đó (2026-11-14, khung chưa nối AI, cờ `NEXT_PUBLIC_SQ_ASSISTANT` / `?assistant=1`; xem reference §13.48)**. Toàn bộ T1–T6 đã xong.

**Goal:** Cột giá thứ 3 thu gọn được (không bao giờ mất hẳn con số). Bước Cost lấy lại bề ngang cho form. Thêm bốn chỉnh sửa nhỏ giúp định hướng trong form dài.

**Architecture:**
- Mọi quyết định "cột nào hiện, rộng bao nhiêu, sticky offset bao nhiêu" gom vào một hàm thuần `editorLayout()`. Hàm này trả về các chuỗi class Tailwind viết nguyên văn.
- `QuoteEditor.tsx` chỉ gọi hàm đó, không tự ghép class.
- Bản thu gọn của giá là **dải `PriceSummary` đang có** (hiện chỉ dùng dưới `xl`). Không có component giá thứ ba.
- Cảnh báo của `PricePanel` (blockers, dòng chưa có giá, allowances) tách thành `PriceWarnings` để bước Cost hiển thị lại khi cột giá bị ẩn.

**Tech Stack:** Next.js (App Router), React, Tailwind v4 (token `sq-*`), Zustand, Vitest. Package: `@sq/client-app`.

**Spec:** Chính tài liệu này, phần "Bối cảnh & số đo" và "Quyết định". Đánh giá trước đó: `docs/reviews/2026-11-13-ui-ux-review.md` (mục 1–4 và Bays đã làm xong; không làm lại).

---

## Bối cảnh & số đo (đo trên trình duyệt ngày 2026-11-13)

Bố cục hiện tại (`apps/client/src/components/editor/QuoteEditor.tsx:848`):
`lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]`, `xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,300px)]`.

| Cửa sổ | Form | Bản vẽ | Cột giá | Ghi chú |
|---|---|---|---|---|
| 1440×900 | 380 | **672** | 300 (cao 309, trống ~560 px bên dưới) | Gập cột giá thì bản vẽ rộng ~972 (+45%) |
| 1280×800 | 380 | **537** | 300 | Gập thì bản vẽ rộng ~849 (+58%). Đây là laptop phổ biến nhất (theo `e2e/layout.spec.ts`) |
| 1024×768 | 380 | 593 | nằm cuối cột form (y ≈ 4.6k) | Dải `PriceSummary` sticky đã lo phần này |
| 375×812 | 351 | ở y = 3164, **dưới toàn bộ form** | ở cuối trang | Ở bước Options, bản vẽ là chỗ làm việc mà lại nằm cuối trang |

Chiều cao form theo bước (1440):
- Details: **4674 px**. Customer 775, Site 313, Delivery 45 (đóng), Design 1052, Shed 1442, Colours 730.
- Options: 1858 px.
- Cost: 2892 px. Gồm What the customer pays, Payment terms, Charges, Steelwork schedule, Punching detail.

Ba điều quan sát chính:
1. **Bước Cost lặp lại cột giá.** "What the customer pays" hiện đúng contract, deposit, progress, balance như `PricePanel`. Trong khi đó bảng Charges, Steelwork, Punching bị ép vào 380 px, còn bản vẽ (không tương tác ở bước này) chiếm 672 px.
2. **Bước Options:** bản vẽ là bề mặt làm việc chính nhưng chỉ rộng 537–672 px. Cột giá 300 px là phần ít dùng nhất lúc đặt cửa.
3. **Cột giá không được phép biến mất hẳn.** Docblock của `PricePanel.tsx:3-21` nói giá phải luôn trên màn hình, vì người bán đọc nó cho khách. `e2e/layout.spec.ts:59-85` kiểm tra rằng ở 1440/1279/768/390 luôn thấy `aside[aria-label="Price"]` **hoặc** `aside[aria-label="Price summary"]`.
   - Vì vậy "đóng" nghĩa là **thu về dải một dòng**, không phải ẩn.

## Trả lời câu hỏi: cột 3 đóng/mở được không?

**Được, và nên làm.** Điều kiện là khi đóng thì con số vẫn hiện ở dải sticky phía trên (giống hệt dưới 1280 px hôm nay). Dải này dùng đúng component `PriceSummary` đang có.

Ở bước Cost, cột giá **tự ẩn** (không cần nút), vì form Cost đã là bản đầy đủ của nó. Phần cảnh báo chỉ cột giá mới có sẽ được đưa lên đầu form Cost.

## Quyết định (**đã duyệt ngày 2026-11-13**: dùng cột "Mặc định" cho cả D1–D4)

| # | Câu hỏi | Mặc định (khuyên dùng) | Phương án khác | Vì sao chọn mặc định |
|---|---|---|---|---|
| D1 | Trạng thái đóng/mở có được nhớ qua lần tải lại không? | **Không.** `useState` trong `QuoteEditor`, giữ nguyên khi chuyển bước, mặc định là mở. | `localStorage` (nhớ theo máy) | Repo đã từ chối `localStorage` cho tuỳ chọn hiển thị, vì máy dùng chung (`components/workspace/QuoteTable.tsx:83-85`). Mở mặc định giữ đúng cam kết "giá luôn ở đó". |
| D2 | Bố cục bước Cost | **Ẩn cột giá. Form rộng `minmax(0,640px)`, bản vẽ chiếm phần còn lại.** Dải `PriceSummary` hiện ở mọi bề rộng. | Giữ 3 cột như cũ | Hai bản cùng một con số trên một màn hình, trong khi bảng bị ép hẹp. Bản vẽ ở bước này chỉ để xem. |
| D3 | Dạng thu gọn ở `xl` | **Dải `PriceSummary` sticky trên đầu** (cùng dạng dưới `xl`), có thêm nút "Show price panel" | Rail dọc 48 px ở mép phải | Một hình thức duy nhất cho "giá gọn" ở mọi bề rộng. Rail dọc không đọc được "$12,803.91". |
| D4 | Bước Options có tự gập cột giá không? | **Không tự gập.** Người dùng tự bấm. | Tự gập khi vào Options | Tự đổi bố cục khi chuyển bước làm người dùng mất phương hướng. Gập/mở chỉ cần một cú bấm. |

## Global Constraints

- Màu/chữ: chỉ dùng token `sq-*`. Bảng navy/gold đạt AA (`design-system/smartquote-v2/MASTER.md`). Không quay lại giao diện glass xanh/cam. Font hệ thống, không dùng `next/font`.
- Không dùng emoji làm icon. Icon lấy từ `@sq/ui`; nếu thêm icon mới vào `packages/ui` thì chạy `pnpm --filter @sq/ui build` trước khi xem app.
- Vùng chạm tối thiểu 44 px (`min-h-11`) cho mọi nút mới.
- Class Tailwind phải là **chuỗi nguyên văn** (Tailwind v4 quét source). Không ghép kiểu `` `xl:top-${x}` ``.
- Dùng `localhost`, không dùng `127.0.0.1`.
- Không đổi `aria-label="Price"` / `aria-label="Price summary"`, heading "Contract price" và id `sitecheck-params-title`, vì e2e dựa vào chúng.
- Test và git là opt-in: không tạo file test mới trừ khi yêu cầu có `tests=on`, không commit, không push. Coder tự kiểm (typecheck, test hiện có, xem trên trình duyệt).
- Khi thử trên trình duyệt, **không lưu** quote `8f0c1f05-6c92-4208-a964-63c72bbb9e3c`. Chặn mọi request không phải GET tới `/quotes` bằng cách override `fetch`, trừ `.../evaluate`.
- Comment trong code viết bằng tiếng Anh, theo giọng docblock "vì sao" của repo. Tài liệu `docs/smartquote-quote-editor-reference.md` (tiếng Việt) được cập nhật trong cùng thay đổi.

## Review Focus

1. **Sticky chồng lên nhau ở `xl` khi dải giá hiện.** Khi cột giá gập (hoặc đang ở bước Cost), dải sticky `top-0` cao khoảng 61 px. Bản vẽ phải dùng offset `4.5rem`, header form phải dùng `3.9rem`, giống dưới `xl`.
   - Đây đúng là lỗi từng xảy ra: bản vẽ trượt xuống dưới dải và mất 49 px kích thước ở mép trên (`QuoteEditor.tsx:1160-1163`, `e2e/layout.spec.ts:87`).
2. **Flyout PIN/Bays đo mép phải cột form** (`details/SideFlyout.tsx:66`). Đổi bề rộng form chỉ xảy ra ở bước Cost, nơi không có flyout.
   - Gập cột giá trong lúc flyout đang mở không được làm flyout lệch: flyout đo một lần khi mở, còn cột form vẫn rộng 380.
3. **Nút "Hide"/"Show" phải trả focus.** Bấm Hide thì nút Show trên dải nhận focus; bấm Show thì nút Hide trong panel nhận focus. Focus không được rơi về `body`.
4. **Bước Cost khi có blocker hoặc dòng chưa có giá.** Hôm nay chỉ cột giá cho biết "One thing blocks this quote" và "N lines have no price". Khi cột ẩn, đúng các câu đó phải nằm ở đầu form Cost.
5. **Canvas 2D/3D đổi kích thước khi gập hoặc mở.** `Render2D.tsx:318` và `hooks/useContainerSize.ts` đã dùng `ResizeObserver`. Cần xác nhận bằng mắt rằng bản vẽ được vẽ lại ở bề rộng mới mà không phải tải lại trang (mở/gập 3 lần, cả tab Plan lẫn 3D).

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `apps/client/src/components/editor/editorLayout.ts` (**mới**) | Hàm thuần: (step, priceOpen) → các chuỗi class cho grid, header form, bản vẽ và dải giá, cùng các cờ hiển thị. |
| `apps/client/src/components/editor/PricePanel.tsx` | Thêm prop `onCollapse`. Tách `PriceWarnings`. `PriceSummary` có thêm prop `onExpand`. |
| `apps/client/src/components/editor/QuoteEditor.tsx` | State `priceOpen`. Dùng `editorLayout()`. Truyền `onCollapse` / `onExpand`. Ở bước Cost, render `PriceWarnings` ở đầu form. |
| `apps/client/src/components/editor/details/SectionJump.tsx` (**mới**, Task 4) | Hàng chip nhảy tới từng nhóm ở bước Details. |
| `apps/client/src/components/editor/details/shared.tsx` | `Group` nhận thêm `id` và mở được từ bên ngoài (Task 4). |
| `apps/client/src/components/editor/StepRail.tsx` | Chữ "N items need attention" trở thành nút (Task 5). |
| `docs/smartquote-quote-editor-reference.md`, `docs/reviews/2026-11-13-ui-ux-review.md` | Ghi lại hành vi mới. |

---

### Task 1: Cột giá thu gọn được ở `xl` (ưu tiên **Cao**)

**Files:**
- Create: `apps/client/src/components/editor/editorLayout.ts`
- Modify: `apps/client/src/components/editor/QuoteEditor.tsx:837` (dải), `:848` (grid), `:869` (header form), `:1165` (bản vẽ), `:1169-1182` (cột giá)
- Modify: `apps/client/src/components/editor/PricePanel.tsx` (header của 3 nhánh return, `PriceSummary`)
- Test (chỉ khi `tests=on`): `apps/client/src/components/editor/__tests__/editorLayout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EditorLayout {
    /** The full PricePanel is rendered as the third column at xl. */
    showPanel: boolean;
    /** The one-line PriceSummary strip is visible at xl too (it is always visible below xl). */
    stripAtXl: boolean;
    /** Classes for the strip wrapper, the grid, the sticky form header and the sticky plan box. */
    stripClass: string;
    gridClass: string;
    formHeaderClass: string;
    planBoxClass: string;
  }
  export function editorLayout(step: EditorStep, priceOpen: boolean): EditorLayout;
  ```
  - `EditorStep` import từ nơi `QuoteEditor.tsx:110` đang lấy.
  - `PricePanelProps.onCollapse?: () => void`
  - `PriceSummary` prop mới: `onExpand?: () => void`

- [ ] **Step 1: Viết `editorLayout()` với đúng bảng giá trị sau.**
  - `showPanel = step !== 'cost' && priceOpen`
  - `stripAtXl = !showPanel`
  - Phần class dùng chung giữ **nguyên văn** từ code hiện tại; chỉ những phần ghi dưới đây thay đổi.

  | Trường | `showPanel` = true (như hôm nay) | `showPanel` = false, step ≠ cost | step = cost |
  |---|---|---|---|
  | `stripClass` | `sticky top-0 z-20 border-b border-sq-line bg-sq-ground/95 backdrop-blur xl:hidden` | giống bên trái nhưng **bỏ** `xl:hidden` | giống cột giữa |
  | `gridClass` (phần cột) | `lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,300px)]` | `lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]` | `lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]` |
  | `formHeaderClass` (offset) | `top-[3.9rem] … xl:top-0` | `top-[3.9rem]` (bỏ `xl:top-0`) | `top-[3.9rem]` |
  | `planBoxClass` (offset/cao) | `… lg:top-[4.5rem] … lg:h-[calc(100dvh-5.5rem)] … xl:top-sq-3 xl:h-[calc(100dvh-2rem)]` | bỏ hai class `xl:` | bỏ hai class `xl:` |

  Phần còn lại của `gridClass` (`mx-auto grid w-full max-w-[1400px] flex-1 gap-sq-3 px-sq-3 py-sq-3`) và của hai class kia chép nguyên từ `QuoteEditor.tsx:848`, `:869`, `:1165`.

- [ ] **Step 2: (tests=on) Viết test `editorLayout.test.ts`.**
  - `editorLayout('details', true)`:
    - `showPanel === true`
    - `stripClass` chứa `xl:hidden`
    - `planBoxClass` chứa `xl:top-sq-3`
  - `editorLayout('options', false)`:
    - `showPanel === false`
    - `stripClass` không chứa `xl:hidden`
    - `planBoxClass` không chứa `xl:top-sq-3`
    - `gridClass` không chứa `_minmax(0,300px)]`
  - `editorLayout('cost', true)`:
    - `showPanel === false` (cost luôn ẩn panel, kể cả khi `priceOpen`)
    - `gridClass` chứa `xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]`
  - Chạy: `pnpm --filter @sq/client-app exec vitest run src/components/editor/__tests__/editorLayout.test.ts`. Kỳ vọng: FAIL trước Step 1, PASS sau Step 1.

- [ ] **Step 3: Nối vào `QuoteEditor.tsx`.**
  - Thêm `const [priceOpen, setPriceOpen] = useState(true);` cạnh `step` (`:110`). Gọi `const layout = editorLayout(step, priceOpen);`.
  - Thay bốn chuỗi class ở `:837`, `:848`, `:869`, `:1165` bằng `layout.*`.
  - Cột giá `:1169-1182` chỉ render khi `layout.showPanel`. Phải bỏ hẳn phần tử grid, không chỉ ẩn nội dung: grid 2 cột với 3 con sẽ đẩy cột giá xuống hàng mới.
  - Truyền:
    - `onCollapse={() => setPriceOpen(false)}` cho `PricePanel`
    - `onExpand={step === 'cost' ? undefined : () => setPriceOpen(true)}` cho `PriceSummary`
  - Cập nhật comment tại `:1150-1163` và ở docblock đầu file (`:19-21`) để nói: dải giá giờ cũng hiện ở `xl` khi panel không có mặt.

- [ ] **Step 4: Nút trong `PricePanel` và `PriceSummary`.**
  - **`PricePanel`:** cả ba nhánh return (lỗi `:58`, chưa có giá `:76`, có giá `:101`) có một hàng tiêu đề.
    - Khi `onCollapse` có giá trị, đặt bên phải tiêu đề một nút ghost: `id="price-panel-collapse"`, `aria-label="Hide price panel"`, `aria-controls="price-panel"`, `aria-expanded="true"`, icon mũi tên sang phải (chevron), kích thước `h-11 w-11`, `hidden xl:inline-flex` (dưới `xl` panel đã ở trong luồng, không gập).
    - `<aside>` gốc nhận `id="price-panel"`.
    - Với nhánh có giá, h2 "Contract price" nằm trong card đầu (`:103-108`). Nút đặt cạnh `StatusPill`.
  - **`PriceSummary`:** khi có `onExpand`, render nút viền `id="price-panel-expand"`, nhãn "Show price panel", `aria-expanded="false"`, `aria-controls="price-panel"`, `hidden xl:inline-flex min-h-11`. Đặt trước nút "Cost step".
    - Ở bước Cost, `onExpand` là undefined nên nút không hiện.
  - **Focus:**
    - Sau khi bấm Hide: `requestAnimationFrame(() => document.getElementById('price-panel-expand')?.focus())`.
    - Sau khi bấm Show: focus `#price-panel-collapse`.
    - Đặt logic này trong hai handler ở `QuoteEditor`, không trong component con.

- [ ] **Step 5: Tự kiểm.**
  - Chạy `pnpm --filter @sq/ui build`, rồi `pnpm --filter @sq/client-app typecheck`. Kỳ vọng: không lỗi.
  - Chạy `pnpm --filter @sq/client-app test`. Kỳ vọng: 81/81 pass (82+ nếu có test mới).
  - Trình duyệt, `http://localhost:3061/quotes/7110b986-e597-4c8d-9505-8529bfaa2a67/edit` (quote E2E Smoke đi được cả 3 bước), đã chặn lưu:
    - **1440×900, bước Options, bấm Hide:**
      - Không còn `aside[aria-label="Price"]`.
      - Dải `Price summary` hiện ở y≈0.
      - Bản vẽ rộng ≥ 950 px.
      - Sau khi cuộn 1500 px: `planTop ≥ stripBottom` (cùng phép đo như `e2e/layout.spec.ts:96-110`).
    - **Bấm "Show price panel":** quay về 3 cột, focus nằm trên `#price-panel-collapse`.
    - **1280×800:** lặp lại hai bước trên.
    - **1024 và 375:** không có nút Hide/Show. Bố cục giống hệt hôm nay; không có cuộn ngang.
    - **Ở Details:** mở PIN flyout rồi bấm Hide trên cột giá. Flyout vẫn bám mép phải cột form.

---

### Task 2: Bước Cost: form rộng, cảnh báo giá đưa vào form (ưu tiên **Cao**)

**Files:**
- Modify: `apps/client/src/components/editor/PricePanel.tsx`. Tách khối `:139-204` (blockers, mocked, allowances) thành `export function PriceWarnings`.
- Modify: `apps/client/src/components/editor/QuoteEditor.tsx`, nhánh `step === 'cost'` (gần `:1065`, ngay trước `<CostPanel`).

**Interfaces:**
- Consumes: `editorLayout()` từ Task 1 (đã cho `gridClass` 640 px ở bước Cost).
- Produces: `export function PriceWarnings({ evaluation }: { evaluation: EvaluationView }): JSX.Element | null`. Trả `null` khi không có blocker, dòng `mocked` hay assumption nào.

- [ ] **Step 1:** Tách `PriceWarnings` ra khỏi `PricePanel`.
  - `PricePanel` gọi lại `<PriceWarnings evaluation={evaluation} />` ở đúng chỗ cũ. DOM và chữ không đổi.
  - Giữ nguyên comment về key `${issue.code}-${index}` và về `<details>` đóng sẵn.
- [ ] **Step 2:** Ở bước Cost, render `{evaluation !== null && <PriceWarnings evaluation={evaluation} />}` ngay trên `CostPanel`.
  - Thêm comment: cột giá ẩn ở bước này (D2), nên đây là nơi duy nhất còn nói quote bị chặn hoặc có allowance.
- [ ] **Step 3:** Xem lại `CostPanel.tsx` ở bề rộng 640.
  - Các lưới `sm:grid-cols-2` (`:235`, `:292`, `:333`) giờ có chỗ thở.
  - Bảng Charges (`:332-474`) và Additions (`:483-593`) không được tràn ngang ở 640 và ở 380 (bề rộng `lg`).
  - Không đổi gì nếu không tràn. Nếu tràn, bọc bảng bằng `overflow-x-auto`.
- [ ] **Step 4: Tự kiểm.**
  - Typecheck và test như Task 1.
  - Trình duyệt 1440 và 1280, bước Cost:
    - Form rộng 640.
    - Bản vẽ chiếm phần còn lại.
    - Không có cột giá.
    - Dải giá hiện và sticky.
    - Không có nút "Show price panel".
    - Cuộn hết form: dải không che header form (header ở `top-[3.9rem]`).
    - Bỏ `xl` (1024): bố cục Cost giống hôm nay.
  - Để có blocker mà xem: dùng quote `8f0c1f05-…` (bay 6000 mm vượt book). Nếu không vào được bước Cost, xác nhận bằng quote E2E có allowances: khối "N allowances in this price" phải hiện ở đầu form Cost.

---

### Task 3: Bước Options trên điện thoại: bản vẽ lên trước (ưu tiên **Vừa**)

Nguyên tắc `content-priority`: đưa nội dung chính lên trước trên điện thoại. Hôm nay ở 375 px, bản vẽ nằm ở y = 3164, dưới cả danh mục option dài 1858 px. Bản vẽ lại chính là nơi đặt cửa (có `ControlSheet` bottom sheet riêng cho điện thoại).

**Files:** Modify `QuoteEditor.tsx:1165` (thêm vào `planBoxClass` qua `editorLayout`).

- [ ] **Step 1:** Trong `editorLayout`, khi `step === 'options'`, thêm `order-first lg:order-none` vào `planBoxClass`. Các bước khác giữ nguyên.
  - (tests=on: thêm một assertion vào test của Task 1.)
- [ ] **Step 2: Tự kiểm ở 375×812, bước Options.**
  - Bản vẽ nằm ngay dưới header (y < 300).
  - Header form có nút Save và nút Next sticky ở đáy vẫn đúng chỗ.
  - Chạm vào một phần tử trên bản vẽ mở `ControlSheet`.
  - Ở `lg` trở lên thì không đổi gì.

---

### Task 4: Bước Details: hàng chip nhảy nhóm (ưu tiên **Vừa**)

Form Details dài 4674 px với 6 nhóm. Người dùng không biết nhóm lỗi nằm đâu, ngoài cách đọc `ErrorSummary`. Nguyên tắc `progressive-disclosure` và wayfinding: thêm một hàng chip trong header sticky của form.

**Files:**
- Create: `apps/client/src/components/editor/details/SectionJump.tsx`
- Modify: `details/shared.tsx`. `Group` nhận `id: string` (gắn vào `<section>`) và mở ra khi nhận sự kiện.
- Modify: `QuoteDetailsPanel.tsx` (truyền id cho từng nhóm), `QuoteEditor.tsx:869-…` (render `SectionJump` trong header sticky, chỉ khi `step === 'details'`).

**Interfaces:**
- `Group` thêm prop bắt buộc `id: string`. Các id: `group-customer`, `group-site`, `group-delivery`, `group-design`, `group-shed`, `group-colour`.
- Cơ chế mở từ ngoài: `SectionJump` phát `window.dispatchEvent(new CustomEvent('sq:open-group', { detail: id }))`. `Group` lắng nghe và gọi `setOpen(true)` khi `detail === id`.
  - Chọn cách này để không phải nâng state của 6 nhóm lên trên. Docblock `Group` nói nhóm "remembering nothing between visits on purpose", và cách này không đổi điều đó.
- `SectionJump({ counts }: { counts: Record<string, number> })`. Bộ đếm lấy từ `issuesByPath` đang truyền cho `QuoteDetailsPanel`, theo cùng cách đếm các nhóm đang dùng (`countIn([...])`).

- [ ] **Step 1:** Thêm `id` vào `Group` và vào 6 lần gọi.
  - Tìm bằng `grep -n "<Group" apps/client/src/components/editor/details/*.tsx`. Hôm nay có `CustomerGroup.tsx:83`, `SiteGroup.tsx:79`, `DesignGroup.tsx:251`, `ColourGroup.tsx:130`, `DeliveryGroup.tsx`, `ShedGroup.tsx`.
  - Thêm listener `sq:open-group`.
- [ ] **Step 2:** Viết `SectionJump`.
  - Là `<nav aria-label="Jump to section">`, gồm một `<ul>` chip có thể cuộn ngang (`flex gap-1 overflow-x-auto`).
  - Mỗi chip là `<a href="#group-…">`, cao `min-h-11`, chữ `text-sq-micro`.
  - Nhãn: Customer, Site, Delivery, Design, Shed, Colours. Nhóm có lỗi thì kèm số đỏ `text-sq-danger` (không chỉ dựa vào màu: số đứng cạnh chữ).
  - Khi bấm:
    - `preventDefault`.
    - Phát sự kiện mở nhóm.
    - `scrollIntoView({ block: 'start' })`, kèm `scroll-margin-top` đủ cho header sticky. Thêm `scroll-mt-[9rem]` lên `<section>` của `Group`.
    - Focus nút tiêu đề của nhóm.
- [ ] **Step 3: Tự kiểm.**
  - Typecheck.
  - Ở 1440 và 375: bấm từng chip thì nhóm được mở, tiêu đề nằm ngay dưới header sticky (không bị che, theo `focus-not-obscured`), focus ở nút tiêu đề.
  - Delivery (mặc định đóng) mở ra khi bấm chip.
  - Header sticky không cao quá 160 px ở 375.

---

### Task 5: "N items need attention" trên StepRail bấm được (ưu tiên **Thấp**)

**Files:**
- Modify: `StepRail.tsx:96-102`. Thêm prop `onShowNotices?: () => void`.
- Modify: `QuoteEditor.tsx`. Truyền `onShowNotices={revealIssues}` (`revealIssues` ở `:300`). Hàm này đã đưa focus tới `ErrorSummary`.

- [ ] **Step 1:** Khi có `onShowNotices`, `<span>` thành `<button type="button" className="min-h-11 cursor-pointer rounded-md px-sq-2 text-sq-micro font-medium text-sq-attention underline-offset-2 hover:underline">`. Chữ giữ nguyên.
- [ ] **Step 2: Tự kiểm.**
  - Mở quote `8f0c1f05-…` (có 1 lỗi).
  - Bấm vào chữ. Trang cuộn tới `ErrorSummary` và focus ở đó.
  - Chữ vẫn đạt tương phản AA (token `sq-attention` đã đạt).

---

### Task 6: Tài liệu

- [ ] `docs/smartquote-quote-editor-reference.md`: thêm vào phần bố cục editor (tìm "PriceSummary" hoặc "cột giá"), bằng tiếng Việt:
  1. Cột giá gập được ở ≥1280 px, khi gập thì giá lên dải trên. Không nhớ trạng thái qua lần tải lại (D1).
  2. Bước Cost không có cột giá: form rộng 640, cảnh báo giá ở đầu form (D2).
  3. Bước Options trên điện thoại: bản vẽ lên trước.
  4. Hàng chip nhảy nhóm ở Details.
  5. "N items need attention" bấm được.
- [ ] `docs/reviews/2026-11-13-ui-ux-review.md`: thêm mục "Đã làm: cột giá gập được + bố cục Cost", liệt kê số đo trước và sau (bề rộng bản vẽ ở 1440 và 1280).
- [ ] E2E: `e2e/layout.spec.ts` vẫn đúng mà không cần sửa, vì nó chấp nhận panel **hoặc** dải. Nếu `tests=on`, thêm một case: ở 1440, bấm `#price-panel-collapse` thì `Price summary` hiện và bản vẽ rộng > 900. Chạy bằng `pnpm test:e2e -- layout.spec.ts`, cần `pnpm dev` đang chạy.

---

## Thứ tự làm và rủi ro

1. **Task 1** rồi **Task 2**: cùng đụng `editorLayout`, làm liền nhau. Đây là giá trị lớn nhất: bản vẽ +45–58% bề ngang, và bước Cost hết bị lặp.
2. **Task 3**: một class, dựa trên Task 1.
3. **Task 5**: nhỏ và độc lập.
4. **Task 4**: nhiều file nhất. Có thể bỏ nếu muốn giữ phạm vi nhỏ.
5. **Task 6**: cuối cùng.

**Rủi ro chính:** sticky offset (Review Focus 1). Mọi offset nằm trong `editorLayout`, nên khi sửa chỉ có một chỗ phải xem.

## Ngoài phạm vi (đã cân nhắc, không làm)

- **Rail dọc 48 px cho giá:** không đọc được con số (D3).
- **Nhớ trạng thái gập bằng `localStorage`:** trái tiền lệ của repo về máy dùng chung (D1).
- **Dùng khoảng trống dưới cột giá** (~560 px ở 1440) để hiện thêm thông tin: YAGNI. Gập cột là cách dùng chỗ đó tốt hơn.
- **Đổi accordion `CategoryDock`:** đã là một-mở-một-lúc, ổn.
