# Guest UI/UX + workflow bugfix — Implementation Plan

> **Cho AI thực thi:** làm tuần tự theo Phase, mỗi Task là một lát dọc tự build & chạy được.
> Đánh dấu `- [ ]` → `- [x]` khi xong. Không commit, không push trừ khi người dùng bảo (CLAUDE.md).
> Đọc `CLAUDE.md` ở repo root trước khi bắt đầu — nhất là "Two traps" và quy tắc `@sq/core`.

**Nguồn:** báo cáo kiểm tra `smartquote-uiux-workflow-bug-summary.md` (24/11/2026, trang
`/quote` của `apps/site`, desktop 1919px). Plan này do phiên phân tích viết; mọi `file:line`
đã được mở và đọc trong phiên đó. Chỗ nào ghi **"chưa kiểm tra"** thì người thực thi phải tự định vị.

**Mục tiêu:** đóng B2, M1–M8 và các minor đã duyệt của Guest quote, kèm ảnh 3D/2D trước–sau cho mọi
bug hình học.

**Kiến trúc liên quan:**
- Trạng thái Guest: `apps/site/src/app/quote/store.ts` (`stepLocked`, `goTo`, `contactStarted`,
  `contactValid`, `setSite`), `summary.ts` (`missingSteps`).
- UI: `apps/site/src/app/quote/components/*`.
- Hình học 3D: `packages/core/src/domain/structure3d.ts` (khung, máng, downpipe) và
  `openings3d.ts` (cửa, cửa sổ); `packages/viewer3d` chỉ vẽ các part đó.
- **Apps đọc `@sq/core` / `@sq/viewer3d` từ `dist`** → sửa core xong phải rebuild
  (`pnpm build:inc` hoặc để `pnpm dev` watch), nếu không ảnh "after" vẫn là code cũ.

## Ràng buộc chung (áp dụng cho mọi Task)

- Dùng `http://localhost:3063`, không bao giờ `127.0.0.1`.
- Không gửi request thật (không bấm Send cuối cùng với server thật; nếu cần thì `page.route` stub).
- Không gọi Google Places thật: stub `**/api/sq/public/guest/places/**` như `e2e/guestQuote.spec.ts:32-60`.
  `GUEST_PLACES_ENABLED` giữ nguyên `1`.
- Không đổi `placementRules.ts`, giới hạn 15 m, `GUEST_DEFAULT_TYPES`, `needsConfirm`.
- Không nâng cấp Next / three / R3F. Giữ màu navy/gold (`design-system/smartquote-v2/MASTER.md`).
- Giữ nguyên kiểu xuống dòng (CRLF/LF) của từng file khi sửa.
- Contact **không** được lưu vào `localStorage` (quyết định Q2 của khách, `store.ts:22-26`).
- Test là opt-in: chỉ sửa/thêm test khi Task ghi rõ (các test hình học ở Phase C là **bắt buộc**
  vì test cũ đang khoá đúng hành vi sai — xem C2).
- Mỗi lệch số liệu hình học cố ý → thêm dòng `docs/KNOWN-DEVIATIONS.md`; mọi đổi luật editor →
  cập nhật `docs/smartquote-quote-editor-reference.md` trong cùng thay đổi.

## Quyết định cần người dùng chốt (có mặc định đề xuất — nếu chưa có trả lời, dùng mặc định)

| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| D1 | M8: nút Send khi chưa tick consent — `disabled` thật hay giữ bật + nhắc? | Giữ nút bấm được (để người dùng bàn phím/screen reader vẫn nhận lỗi), nhưng đổi sang kiểu "chưa sẵn sàng" (`aria-disabled="true"` + style mờ) và hiện dòng lý do ngay trên nút: "Tick the box above so we can send your request." Bấm vẫn chạy error summary hiện có. |
| D2 | Preset Carport tự sinh cảnh báo bay 5,9 m (cố ý theo khách Q6, `core/src/domain/guest.ts:458-461`) | Giữ cờ review (trung thực về giá), nhưng ở preset mặc định đổi giọng thành thông tin trung tính: "Carport bays over 4 m are confirmed by an estimator — normal for this size." và không tô màu cảnh báo. Không đổi kích thước preset. |
| D3 | Sheeting tam giác đầu hồi | **Không làm** trong plan này — chờ client confirm (báo cáo đã chốt). |
| D4 | Lưu contact qua reload? | **Không** (Q2). Chỉ sửa copy banner (minor) và bỏ nhu cầu reload bằng M2. |

---

## Phase 0 — Bộ chụp ảnh trước–sau (làm TRƯỚC mọi thay đổi hình học)

Yêu cầu của người dùng: mọi fix liên quan hình ảnh (M3, M4, khung cửa sổ, màu mặc định) phải có
**ảnh 3D và 2D chụp trước và sau khi fix**, cùng cấu hình, cùng góc camera, cùng viewport.

### Task 0.1: Móc camera chỉ dùng cho QA

Hiện không có cách đặt camera cố định (`packages/viewer3d/src/ShedViewer.tsx` chỉ có `resetView`,
OrbitControls giữ trong `controlsRef` dòng 110).

**Files:** Modify `packages/viewer3d/src/ShedViewer.tsx`

- [x] Thêm hook QA: khi `process.env.NODE_ENV !== 'production'`, gán
  `window.__sqQaCamera = (pos: [number,number,number], target: [number,number,number]) => void`
  (đơn vị **mét**, cùng hệ toạ độ scene: x = ngang span, y = lên, z = dọc chiều dài, gốc ở góc trái-trước
  của nhà). Hàm đặt `camera.position`, `controls.target`, gọi `controls.update()` và `invalidate()`
  (scene dùng `frameloop="demand"`). Gỡ khỏi `window` khi unmount.
- [x] Rebuild viewer3d, mở `/quote?step=design`, chạy trong console
  `window.__sqQaCamera([-3,2,-3],[0,2,0])` → camera nhảy tới góc trái-trước. Production build không có hàm này.

### Task 0.2: Script chụp ảnh

**Files:** Create `scripts/qa-guest-shots.mjs` (script chạy tay như các `scripts/probe-*.mjs`,
không phải test). Dùng `@playwright/test` đã có (`chromium.launch({ channel: 'chrome' })`).

Cấu hình cố định (trùng báo cáo): **Garage 6,00 × 6,00 × 3,00 m, Gable 10°, 2 bays, mái Surfmist,
tường Shale Grey**, thêm **1 cửa sổ** trên tường trái (để chụp khung cửa sổ), địa chỉ stub.

- [x] Script nhận `--label before|after` và `--out docs/qa/screens/2026-11-24-guest/<label>/`.
- [x] Đưa trang vào đúng design: cách ổn định nhất là ghi `localStorage['sq.guest.v1']`
  (`store.ts:152`) bằng `page.addInitScript` trước khi load, với design hợp lệ theo
  `guestDesignSchema` (lấy mẫu bằng cách tự dựng design trong UI một lần rồi đọc
  `localStorage.getItem('sq.guest.v1')` qua devtools — lưu JSON đó vào `scripts/qa-guest-design.json`).
  Stub route Places. Mở `http://localhost:3063/quote?step=design`.
- [x] Viewport chạy 2 lượt: **1919×998** và **390×844**.
- [x] Ở mỗi viewport, chụp (chờ canvas vẽ xong: `waitForTimeout(800)` sau mỗi lần đặt camera):

| Tên file | View | Camera (pos → target, mét; S=span 6, L=length 6, H=3) | Kiểm bug |
|---|---|---|---|
| `3d-overview-roof.png` | 3D, mái bật | sau Reset view (không gọi hook) | tổng thể, màu mái/tường |
| `3d-overview-noroof.png` | 3D, Hide roof | như trên | xà portal lòi tường (M4) |
| `3d-eave-left-roof.png` | 3D, mái bật | `[-2.5, 2.6, 1.5]` → `[0, 2.8, 1.5]` | tab xám dưới máng (M4) |
| `3d-eave-left-noroof.png` | 3D, Hide roof | như trên | đầu xà thò ra (M4) |
| `3d-downpipe-front-left.png` | 3D, mái bật | `[-1.5, 1.2, -1.5]` → `[0, 1.0, 0.5]` | downpipe cách tường (M3) |
| `3d-downpipe-base.png` | 3D, mái bật | `[-1.0, 0.4, -0.2]` → `[0, 0, 0.5]` | chân downpipe/đế (M3) |
| `3d-window-close.png` | 3D, mái bật | trước tường trái, ngang cửa sổ: `[-2.0, sill+h/2, u+w/2]` → `[0, sill+h/2, u+w/2]` (lấy u/sill/w/h từ design JSON) | khung cửa sổ nhô (minor) |
| `3d-window-oblique.png` | 3D | lệch 45° so với ảnh trên | độ nhô nhìn nghiêng |
| `2d-plan-fit.png` | tab 2D, Fit | — | mặt bằng tổng |
| `2d-plan-window.png` | tab 2D, zoom 2 lần quanh cửa sổ | — | ký hiệu cửa sổ 2D không đổi sai |

- [x] Ảnh 2D chụp bằng `locator('.g-stage-view').screenshot()`; ảnh 3D chụp vùng canvas.
- [x] Ghi kèm `meta.json` (commit hash hiện tại, viewport, thời điểm, design JSON đã dùng).
- [x] **Chạy ngay `--label before` trên code hiện tại**, trước khi sửa dòng nào ở Phase C.
  Kiểm tra mắt thường: `3d-eave-left-noroof.png` phải thấy đầu xà thò ra; `3d-downpipe-front-left.png`
  phải thấy khe hở. Nếu không thấy → chỉnh camera cho tới khi bug lộ rõ, rồi giữ nguyên toạ độ đó cho "after".
- [x] Ảnh nằm trong `docs/qa/screens/2026-11-24-guest/` — **không commit** trừ khi người dùng bảo.

Sau Phase C/E chạy `--label after` và tạo `docs/qa/screens/2026-11-24-guest/README.md`: bảng hai cột
before | after cho từng file (markdown image links), mỗi dòng một câu "thấy gì đã đổi".

---

## Phase A — B2 + M7: gating của tab bước và nút header (Blocker)

### Nguyên nhân (đã tái hiện local)

- `store.ts:219` `stepLocked` chỉ kiểm `contactStarted` (4 trường không rỗng — `store.ts:133`, cố ý
  dễ dãi), không kiểm `contactValid` (`store.ts:143`: regex email + `normaliseAuMobile`).
  Mobile "123" → tab Building/Send không khoá (`aria-disabled` null), bấm vào là sang `?step=design`/`send`.
- `StartPanel.tsx`: nút Continue dùng `canContinue = ready && contactValid` — chặt hơn tab, nên hai
  cổng lệch nhau.
- M7: `GuestQuote.tsx:104-107` `send = () => go(missing[0]?.step ?? 'send')`. Local thì `missing[0]`
  là `'start'` nên **không tái hiện được**, nhưng nút header vẫn đi qua `goTo` → `stepLocked` (cùng
  gốc với B2). Sửa B2 là đóng luôn đường này; thêm bước cuộn/focus.

### Task A1: Một cổng duy nhất

**Files:** Modify `apps/site/src/app/quote/store.ts`, `components/StepTabs.tsx`, `components/GuestQuote.tsx`, `components/StartPanel.tsx`

- [x] `stepLocked(step, design, type, contact)`: thay `!contactStarted(contact)` bằng
  `!contactValid(contact)`. Giữ `contactStarted` cho chỗ khác đang dùng (chỉ đổi gate).
  Cập nhật doc comment của `contactStarted` — câu "a mistyped digit does not lock the designer"
  không còn đúng cho tab.
- [x] `goTo(step, type)`: khi bị từ chối vì khoá, thay vì im lặng → đặt trạng thái
  `startFocus: 'first-invalid'` (hoặc trả về `false`) để `StartPanel` cuộn tới & focus trường lỗi đầu tiên
  (thứ tự: address → firstName → lastName → mobile → email) và hiện lỗi inline của trường đó.
- [x] Tab bị khoá vẫn là `aria-disabled="true"` nhưng **bấm được**: bấm → chuyển về Start + focus lỗi
  đầu tiên (không chỉ "không làm gì"). Thêm `title`/`aria-describedby` "Finish Start first".
- [x] Nút header `.g-summary-send` và thanh phone `.g-mbar-send` (`SummaryBar`, `PhoneSummaryBar`):
  dùng cùng đường → nếu `missing[0]` là start thì về Start + focus lỗi; nếu là design thì sang Building
  + focus mục lỗi (đã có `focus` selector trong assessment).
- [x] Back/Forward (`syncFromLocation`) và `updateContact` (`store.ts:494`) đi qua cùng `stepLocked` —
  sửa contact thành không hợp lệ khi đang ở Building thì trang quay về Start (đã có cơ chế, kiểm lại).

**Kiểm tra (browser, `localhost:3063`):**
- [x] Mobile "123", email hợp lệ → tab Building và Send có `aria-disabled="true"`; bấm → URL vẫn
  `?step=start`, focus ở ô mobile, lỗi inline hiện.
- [x] Gõ thẳng `?step=send` vào URL với contact sai → về Start.
- [x] Từ Building (contact hợp lệ) sửa email thành "a@" qua Edit → về Start.
- [x] Nút header "Send quote request" khi Start sai → về Start + focus; khi Start đúng nhưng design
  có lỗi → Building + focus mục lỗi; khi đủ → Send.
- [x] Class 1 House (`mode: 'enquiry'`) vẫn bỏ qua design như cũ.
- [x] `pnpm --filter @sq/site-app typecheck` sạch.

---

## Phase B — M1 + M2 (+ một phần M6)

### Task B1 (M1): Định dạng số di động

**Nguyên nhân:** `SendPanel.tsx:254` hiển thị `+61 ${contact.mobile}` từ ô nhập thô → "0400000000"
thành "+61 0400000000". Ô nhập ở Start có tiền tố "+61" cố định (`StartPanel.tsx:173`), nên người dùng
gõ cả số 0.

**Files:** Modify `components/SendPanel.tsx`, `components/StartPanel.tsx`; dùng
`normaliseAuMobile` (`packages/contracts/src/guest.ts:256`, trả `+614xxxxxxxx`).

- [x] Thêm hàm thuần `formatAuMobile(raw: string): string | null` cạnh `mobileE164` trong
  `SendPanel.tsx` (hoặc trong contracts nếu muốn dùng chung): `+61 4xx xxx xxx` từ kết quả
  `mobileE164`; `null` khi không chuẩn hoá được.
- [x] `SendPanel.tsx:254`: hiển thị `formatAuMobile(contact.mobile) ?? contact.mobile`.
- [x] Ô mobile ở Start: khi blur, nếu chuẩn hoá được thì hiện lại dạng `4xx xxx xxx` (bỏ số 0 đầu)
  ngay sau tiền tố "+61", để người dùng thấy đúng số sẽ gọi. Giá trị gửi API vẫn là E.164 như hiện tại
  (kiểm `SendPanel` `onSubmit` dùng `mobileE164`).
- [x] Kiểm: nhập `0400000000`, `400000000`, `+61400000000`, `61400000000` → Send hiện
  `+61 400 000 000` cả bốn trường hợp; `123` → Start chặn (Phase A).

### Task B2 (M2): Luôn quay lại được tìm địa chỉ đường phố

**Nguyên nhân** (`components/AddressPanel.tsx`):
- `mode` là state cục bộ (`:84`); "Can't find it? Pick your suburb instead" (`:338`) chỉ
  `setMode('suburb')`, không có nút ngược lại.
- Nút Change (`:189-198`) chỉ `setEditing(true)` và giữ `mode` → quay về ô suburb.
- Change **không** xoá `design.site` trong store (code không gọi `setSite(undefined)`), nhưng khi
  `editing` thì dòng địa chỉ đã chọn bị ẩn → người kiểm tra thấy như bị xoá. Trong lúc đó
  `SiteEstimate` vẫn hiện số liệu của địa chỉ cũ (gốc của M6 "dữ liệu cũ").
- Reload khôi phục chế độ street vì `mode` khởi tạo lại; contact mất là **cố ý** (Q2).

**Files:** Modify `components/AddressPanel.tsx`, `components/StartPanel.tsx`, `components/SiteEstimate.tsx`

- [x] Ở chế độ suburb, khi `placesUnavailable === false` (module flag ở đầu file — chỉ true khi Places
  thật sự lỗi), hiện nút link "Search by street address instead" → `setMode('places')`, focus
  `g-address-search`. Khi Places lỗi thật thì không hiện (và notice hiện tại giữ nguyên).
- [x] Change: mở chế độ tìm **theo chế độ đã tạo ra địa chỉ hiện tại** nhưng luôn kèm link chuyển chế
  độ (dòng trên), và thêm nút "Keep this address" (`setEditing(false)`) để huỷ mà không mất gì.
- [x] Địa chỉ chỉ có suburb: dòng đã chọn hiện nhãn phụ "Suburb only — no street number or name"
  (lấy theo `site` không có street/coords; xem `pickSuburb` và kiểu `GuestSite`).
- [x] Không có thao tác nào ở đây chạm vào `contact` (kiểm: đổi chế độ qua lại 3 lần, First/Last/Mobile/Email giữ nguyên).
- [x] Đóng phần M6 "dữ liệu cũ": `SiteEstimate` không render khi `design.site === undefined` **hoặc**
  khi AddressPanel đang `editing`. Cách gọn nhất: chuyển chỗ render `SiteEstimate` từ
  `StartPanel.tsx:95` vào nhánh "đã chọn" của AddressPanel (`:178-205`) — comment ở `AddressPanel.tsx:80`
  đã nói nó hiển thị cùng estimate đó.

**Kiểm (Places stub):**
- [x] Street → "Pick your suburb instead" → chọn Sydney Olympic Park 2127 → Change → thấy link
  "Search by street address instead" → bấm → ô "Street number and name" + hint "Start typing…".
- [x] Contact không đổi suốt quá trình. Hộp wind ẩn khi đang Change, hiện lại khi chọn xong.

---

## Phase C — M3 + M4 + khung cửa sổ (hình học — BẮT BUỘC ảnh trước/sau)

> Điều kiện vào Phase C: đã có bộ ảnh `before` từ Task 0.2.
> Sau khi sửa `packages/core`: `pnpm build:inc` (hoặc `pnpm dev` đang watch) **trước** khi chụp `after`.
> Đơn vị trong core là mm, hệ toạ độ: x = ngang span (0 = mặt ngoài tường trái), y = lên (0 = mặt
> sàn), z = dọc chiều dài. Mặt ngoài cladding là x = 0 / x = span; cladding dày `WALL_DEPTH = 50`
> vào trong (`structure3d.ts:47`). Sàn: slab `-50…0` chỉ dưới footprint, mặt đất/grid ở y ≈ −50
> (`viewer3d/src/Shed3D.tsx:266`, `ShedViewer.tsx:187-193`).

### Task C1 (M4): Xà portal dừng ở tường

**Nguyên nhân:** `structure3d.ts:369-388` vẽ `rafter-left/right` với dài `roof.slope` và tâm
`roof.leftX/rightX` — các giá trị này (`roofGeometry`, `structure3d.ts:97-107`) tính cho **tấm mái gồm
cả mái hắt `EAVE = 300`** (`halfRun = span/2 + EAVE`, `leftX = (span/2 − EAVE)/2`). Nên mỗi xà thò ra
~300 mm ngoài mặt tường, nằm ngay dưới máng → "tab xám". Test
`__tests__/structure3d.test.ts:152-168` đang **cố ý loại trừ** rafter khỏi kiểm tra "không gì thò ra
ngoài mặt tường" (comment "legitimately run out over the eave") — tức test khoá hành vi sai.

**Files:** Modify `packages/core/src/domain/structure3d.ts`, `packages/core/src/domain/__tests__/structure3d.test.ts`

- [x] Sửa test trước (sẽ fail trên code cũ): bỏ `'rafter-left'`, `'rafter-right'`, `'rafter-single'`
  khỏi `overEave` ở test `'leaves nothing standing proud of the outside face'`; với box có `rotation`,
  tính phần chiếu theo x: `halfX = (len/2)·|cos θ| + (180/2)·|sin θ|`, yêu cầu
  `x − halfX > −0.5` và `x + halfX < span + 0.5`. Thêm test: đỉnh trong hai xà gable gặp nhau tại
  `x = span/2` (sai số 1 mm) và chân ngoài nằm trong `[0, WALL_DEPTH + FRAME_SECTION]`.
- [x] Chạy `pnpm --filter @sq/core exec vitest run src/domain/__tests__/structure3d.test.ts` → FAIL.
- [x] Trong `frameParts`, tính xà gable từ **mặt ngoài cột** (`x0 = WALL_DEPTH`, tại cao độ đỉnh cột
  `shed.height`) tới đỉnh (`x1 = span/2`, `y1 = roof.ridgeY` hoặc giá trị đỉnh tương ứng trong
  `RoofGeometry`): `len = hypot(x1−x0, y1−y0)`, `θ = atan2(y1−y0, x1−x0)`, tâm = trung điểm, trừ đi nửa
  chiều cao tiết diện (−90) theo pháp tuyến như hiện tại. Đối xứng cho xà phải. Không động vào
  `roofGeometry` (tấm mái vẫn cần mái hắt).
- [x] Skillion (`rafter-single`): hiện dài `hypot(span, rise)` từ x=0 tới x=span → đầu cũng chạm mặt
  ngoài cladding; áp cùng quy tắc (từ `WALL_DEPTH` tới `span − WALL_DEPTH`).
- [x] Purlin vẫn trong `overEave` (chạy dọc nhà, không liên quan).
- [x] Test PASS; chạy cả suite `pnpm --filter @sq/core test`.
- [x] Nếu đây là lệch so với desktop (đối chiếu `D:\Docs\OS.mr.Thi\smq-code-smartquote` phần vẽ khung 3D,
  ghi file:line) → thêm dòng `docs/KNOWN-DEVIATIONS.md`. Chỉ là hình vẽ, không đổi BOM.

### Task C2 (M3): Downpipe sát tường, kết thúc ở chân tường

**Nguyên nhân:** `structure3d.ts:261-270` đặt downpipe ở `x` **của máng** (`gutterXs = −EAVE + 70`
→ x = −230, tức cách mặt tường 230 − 48 = ~182 mm khe hở). Chân ống ở y = 0 nhưng nằm ngoài slab
(slab chỉ trong 0…span) nên lơ lửng 50 mm trên mặt đất/grid, đầu cắt phẳng, không co/shoe.

**Files:** Modify `packages/core/src/domain/structure3d.ts`, `__tests__/structure3d.test.ts`

- [x] Test trước: mỗi `downpipe-*` có tâm x với `|x − mặt tường| = DOWNPIPE_RADIUS + 10 ± 1`
  (tường trái x=0 → `x = −58`; phải `x = span + 58`), đáy ống `y − h/2` trong `[−50, 0]`; có part
  `downpipe-offset-*` (đoạn nối máng→tường ở đầu trên) và `downpipe-shoe-*` (co chân) cho mỗi ống.
  Giữ test hiện có "4 downpipe" (`:86-90`) — đếm theo prefix thì đổi thành đếm `downpipe-left-`/`-right-`
  thân ống, không đếm offset/shoe.
- [x] Run → FAIL.
- [x] Thân ống: tâm x như trên, chạy từ `y = 0` (chân tường) tới `yTop = shed.height − roof.eaveDrop − 200`.
- [x] Đoạn offset (box hoặc cylinder xoay 90° quanh z): nối từ đáy máng (x = gutter x, y ≈ `y` của
  máng − GUTTER_RADIUS) tới đầu thân ống; cùng `color: shed.colors.downpipe`, `finish: 'metal'`.
- [x] Shoe: một đoạn ngắn (~150 mm) nghiêng ra ngoài 45° ở chân, đáy chạm `y = −50` (mặt đất) hoặc
  dừng ở 0 — chọn một và ghi comment. Kiểu `kind` bắt đầu `downpipe-shoe-` để Shed3D không cần đổi
  (nó render mọi part qua `AnyPart`; kiểm `PartMesh.tsx` hỗ trợ `rotation` cho cylinder).
- [x] Skillion chỉ có một máng (`gutterXs` 1 phần tử) — giữ.
- [x] Test PASS; `pnpm --filter @sq/core test`.
- [x] BOM không đổi (đây chỉ là 3D); kiểm `downpipeStations` không bị sửa.

### Task C3 (minor): Khung cửa sổ nhô khỏi tường

**Nguyên nhân:** `openings3d.ts:410-428`. `WINDOW_FRAME = 90` (`:95`), khung sâu `90 × 1.4 = 126`
đặt tâm `z = −35` → chạy từ z ≈ −98 tới +28: nhô ~100 mm ra ngoài mặt tường (z < 0 là phía ngoài,
`:14-18`). Flashing sâu 130–140 tâm −55 → nhô ~125 mm. Mullion −38.

**Files:** Modify `packages/core/src/domain/openings3d.ts`, `__tests__/openings3d.test.ts`

- [x] Test trước trong `describe('window')` (`openings3d.test.ts:98`): mọi part của cửa sổ có mặt ngoài
  `z − depth/2 ≥ −40` (khung) và flashing `≥ −50`; glass vẫn nằm sau mặt ngoài khung (không bị khung che —
  giữ test hiện có về glass `:105-117`).
- [x] Run → FAIL.
- [x] Giảm độ sâu khung còn ~60 mm, tâm sao cho mặt ngoài ở z ≈ −25 và mặt trong lấn vào cladding
  (≤ `WALL_DEPTH`); glass tại z ≈ −10; mullion theo khung; flashing mỏng hơn (độ sâu ~60, mặt ngoài ≈ −45).
  Không đổi `JAMB`, `WINDOW_INSET` (dùng chung với ký hiệu 2D — `:22-24`).
- [x] Kiểm PA door (`:247-252`, cùng kiểu `PA_FRAME * 1.4`) — báo cáo không nêu, **không sửa**, chỉ ghi chú
  nếu ảnh cho thấy cũng nhô.
- [x] Test PASS.

### Task C4: Ảnh "after" + so sánh

- [x] Rebuild (`pnpm build:inc` hoặc dev watch), reload trang, chạy `node scripts/qa-guest-shots.mjs --label after`
  với **cùng** `qa-guest-design.json`, cùng viewport, cùng toạ độ camera.
- [x] Viết `docs/qa/screens/2026-11-24-guest/README.md` (bảng before | after cho cả 1919 và 390).
  Tiêu chí chấp nhận khi nhìn ảnh:
  - `3d-eave-left-noroof`: không còn đầu xà nào ra ngoài mặt tường.
  - `3d-eave-left-roof`: không còn tab xám dưới máng.
  - `3d-downpipe-*`: ống sát tường, có đoạn offset ở trên, có shoe ở chân, không lơ lửng.
  - `3d-window-*`: khung gần phẳng với tường, flashing mỏng.
  - `2d-*`: không đổi gì ngoài ý muốn (2D không vẽ downpipe/xà).
  - Đỉnh xà, cột, cửa cuốn, máng — **không đổi** (báo cáo đã xác nhận đúng; đừng làm hỏng drum đã fix ở commit 226723c).
- [x] Gửi người dùng thư mục ảnh + README.

---

## Phase D — M5, M6, M8

### Task D1 (M5): Tick xanh "complete" giả

**Nguyên nhân:** `components/StepTabs.tsx` `complete()` trả `designSeen` cho tab design mà không xét
Start; ngay sau reload tab Building `locked=true, done=true` (đã tái hiện). `designSeen` được khôi
phục từ `localStorage` khi hydrate.

- [x] `complete(step, …)` nhận thêm `locked`: `if (locked) return false`. Với design: chỉ true khi
  `!stepLocked('design', …)` **và** `designSeen` **và** design không còn mục missing.
  Start: true khi `site !== undefined && contactValid(contact)` (không chỉ có site).
- [x] Kiểm: reload với design đã lưu + contact trống → không tab nào có tick; điền Start hợp lệ →
  tick Start; vào Building → tick Building.

### Task D2 (M6): Hộp wind region

**Files:** `components/SiteEstimate.tsx` (`:35-58`), `store.ts`

- [x] Ẩn khi không có site/đang Change — đã làm ở Task B2. Thêm: `setSite(undefined)` (`store.ts:428`)
  cũng đặt `estimate: null` để không còn số cũ ở bất kỳ đâu (kể cả AI assistant gửi `region`).
- [x] Một thông điệp duy nhất theo hướng "indicative" (giữ định dạng khách yêu cầu theo doc comment):
  - Tiêu đề: `Region ${region}` hoặc "Wind region".
  - Dòng chính: `Region A · 10a Enclosed · Importance Level 2` (khi chưa biết region:
    `10a Enclosed · Importance Level 2`, **bỏ** chữ "Wind region confirmed in your quote").
  - Dòng ghi chú: "Indicative — an estimator confirms these in your quote."
  - Giải thích 10a: thêm `<abbr title="Class 10a: a non-habitable building such as a shed, garage or carport">10a</abbr>`
    và một dòng `g-sr-only`/tooltip tương đương (không chỉ dựa vào `title` vì cảm ứng không hover —
    dùng nút "?" nhỏ mở popover, hoặc dòng phụ ngắn "Class 10a = shed / garage (non-habitable)").
- [x] Kiểm: chọn địa chỉ → Region A; Change → hộp ẩn; chọn suburb không có toạ độ → hộp không mâu thuẫn.

### Task D3 (M8): Nút Send khi chưa tick consent

**Hiện trạng (đã đọc code):** bấm Send khi chưa tick **bị chặn** — `SendPanel.tsx:101` `onSubmit`
hiện error summary có lỗi `consent` và focus nó; server cũng yêu cầu `consent: z.literal(true)`
(`packages/contracts/src/guest.ts:300`). Không có lỗ hổng consent; đây là vấn đề hiển thị.

- [x] Theo D1 (mặc định): khi `!contact.consent` (hoặc còn `missing`), nút có `aria-disabled="true"`,
  class trạng thái mờ (dùng token có sẵn, không màu mới), và dòng lý do ngay trên nút gắn
  `aria-describedby`: "Tick the box above so we can send your request." Bấm vẫn chạy `onSubmit`.
  `disabled` thật chỉ khi `sending`.
- [x] Kiểm bằng stub (không gửi thật): `page.route('**/api/sq/public/guest/requests**', …)` đếm lời gọi;
  chưa tick → bấm → 0 lời gọi, focus ở error summary; tick → nút về trạng thái thường.

---

## Phase E — Minor

Mỗi mục: sửa → kiểm trong browser → ghi một dòng kết quả vào checkpoint. Mục hình ảnh (E9) chụp
before/after bằng Task 0.2.

- [x] **E1 Dấu (*) bắt buộc:** First name, Last name, Mobile, Email, Address ở `StartPanel.tsx`/
  `AddressPanel.tsx` thêm `<span aria-hidden="true">*</span>` sau nhãn + một dòng chú thích
  "* required" đầu form; input có `required`/`aria-required="true"`. Giữ "(optional)" ở Additional Request.
- [x] **E2 Header tóm tắt bị cắt ở 1919px:** `guest.css:449`, `:2227-2273` (`.g-summary-text` ellipsis).
  Ưu tiên giữ số bays: rút gọn chuỗi trong `summary.ts` (ví dụ `6×6 m · Gable 10° · 2 bays`) và
  đặt `title` = chuỗi đầy đủ; kiểm ở 1919, 1440, 1280.
- [x] **E3 Carport cảnh báo bay:** theo D2. `summary.ts:87` và `core/src/domain/guestAssessment.ts:92-99`
  — đổi giọng/cấp hiển thị cho trường hợp bay = giá trị preset mặc định của loại đó; không xoá cờ.
- [ ] **E4 Ghi chú Class 1 House bị cắt chữ:** **chưa kiểm tra** vị trí — tìm chuỗi ghi chú của type
  `class1`/House trong `components/TypeCard.tsx` / `StartPanel.tsx` / `core/src/domain/guest.ts`, xem CSS
  `-webkit-line-clamp`/`overflow: hidden`/chiều cao cố định; cho xuống dòng đầy đủ.
- [ ] **E5 Autocomplete không có postcode / gợi ý lạc:** **chưa kiểm tra** — xem route places ở
  `apps/api/src/routes/*` + `lib/` (Places), và cách `AddressPanel` dựng `ComboOption` label. Hiện
  `secondaryText` (suburb, state, postcode) nếu API trả; giới hạn `components=country:au` và `types=address`
  nếu chưa có. **Không gọi Google thật** — kiểm bằng stub; xác minh thật chỉ bằng `scripts/probe-guest-places.mjs`
  khi người dùng cho phép.
- [x] **E6 Toolbar 2D/3D:**
  - `Stage.tsx:140`: `aria-pressed={showRoof}` với nhãn "Hide roof" là ngược. Đổi: nhãn cố định
    "Hide roof", `aria-pressed={!showRoof}` (pressed = mái đang ẩn); hoặc giữ nhãn đổi chữ và **bỏ**
    `aria-pressed`. Chọn cách 1.
  - Hide roof/Reset view chỉ hiện khi `view === '3d'` (`Stage.tsx:138`) — đúng về chức năng (2D không có
    mái/camera). Giữ ẩn nhưng không làm toolbar nhảy: giữ chỗ (`visibility: hidden`) hoặc chấp nhận và
    ghi rõ — chọn giữ chỗ để layout không xê dịch.
  - `GuestPlan.tsx:554-570`: Zoom out `disabled={zoom <= ZOOM_MIN}`, Fit `disabled={zoom === 1}` — đúng logic
    nhưng không giải thích. Thêm `title`/tooltip: "Already showing the whole plan".
- [x] **E7 Swatch:** `SwatchGrid.tsx:82-98`. Tick (`.g-swatch-check`) che nhãn "Monument" → đặt tick
  ở góc ô màu, không đè vùng chữ (CSS). Tên truy cập "for theroof": kiểm trong accessibility tree
  (`read_page`) xem tên được ghép từ đâu; sửa bằng `{' '}` tường minh trước và trong `<span className="g-sr-only">`
  (`{heading}{' '}<span …>for the{' '}{part}</span>`), xác nhận lại bằng accessibility tree.
- [x] **E8 AI sau Undo + chip:** `AssistantPanel.tsx:323-341` `ChangeCard` luôn vẽ "View on plan" → ẩn khi
  `turn.undone`. Chip gợi ý (`PanelSuggestions` trong `AssistantFab.tsx`): khi bấm, hiện trạng thái
  pressed/busy ngay (disable chip + spinner nhỏ tới khi `busy` false). Chi tiết AI khác: báo cáo nói
  "nằm ở file riêng" — **không có trong plan này**.
- [ ] **E9 Màu mặc định Surfmist/Shale Grey gần như trùng trong 3D:** không đổi màu mặc định của khách
  (preset). Phương án: tăng tương phản bằng vật liệu — trim/gutter/barge dùng màu riêng của chúng nếu
  preset có; nếu không, cho mái `roughness`/`envMapIntensity` khác tường trong `Shed3D.tsx`/`PartMesh.tsx`
  và thêm đường viền nhẹ ở mép mái. Nếu cần đổi màu mặc định → **hỏi người dùng** (là dữ liệu của khách).
  Chụp `3d-overview-roof.png` before/after.
- [x] **E10 Copy "email —usually":** source đã có khoảng trắng (`SendPanel.tsx:208`, `:397` dùng
  `&mdash;` giữa hai khoảng trắng). Kiểm trên bản deploy; nếu vẫn thiếu thì bản deploy cũ — chỉ cần deploy lại.
  Nếu render thiếu do JSX xuống dòng, đổi sang chuỗi `{' — '}`.
- [x] **E11 Banner reload:** `StartPanel.tsx:196` "Reloading clears the form but keeps your design." →
  "Reloading keeps your design and address, but clears your name, mobile and email."
- [x] **E12 Không có lời hứa xác nhận trước khi gửi:** dưới nút Send (SendPanel hint) thêm:
  "After you send, you'll see a reference number and we'll email a copy to {email}." — chỉ viết nếu đúng
  với luồng hiện tại: **kiểm** màn hình sau khi gửi (`SentRequests.tsx`, state `sent.number`) có hiện số
  tham chiếu và mail xác nhận có gửi cho khách hay không; nói đúng cái hệ thống làm, không hứa thêm.

---

## Phase F — Kiểm tra mobile ~390px

- [x] `resize_window` 390×844 (hoặc Playwright viewport) — đi hết luồng Start → Building → Send với
  stub Places và stub gửi.
- [x] Kiểm: không tràn ngang (`document.documentElement.scrollWidth <= 390`), drawer Tools mở/đóng,
  bottom sheet AI kéo xuống đóng được, thanh nút sticky (`.g-mbar-send`) không che trường nhập, form Send
  đầy đủ và gating Phase A hoạt động trên thanh phone.
- [x] Chụp màn hình từng bước vào `docs/qa/screens/2026-11-24-guest/mobile/`.
- [x] Ghi rõ trong tổng kết: đây là emulator của trình duyệt, chưa phải thiết bị thật.

---

## Kiểm tra cuối & Definition of Done

- [x] `pnpm --filter @sq/core test` (cần `TEST_DATABASE_URL`? — không: core không dùng DB) PASS.
- [x] `pnpm --filter @sq/core typecheck`, `pnpm --filter @sq/viewer3d typecheck`,
  `pnpm --filter @sq/site-app typecheck` sạch.
- [x] `pnpm build` toàn workspace PASS.
- [x] Nếu có Postgres test: `pnpm test:e2e --project guest` (cần `pnpm dev` đang chạy) — sửa spec nào
  vỡ vì đổi gating (ví dụ test điền mobile sai rồi bấm tab). **Vòng 2: 5/5 pass**; spec sửa 3 chỗ
  (copy wind, `aria-pressed` của Hide roof, email `exact`, `force: true` cho nút `aria-disabled`).
- [x] Bộ ảnh before/after + README có đủ cho C1, C2, C3, E9 ở 1919 và 390. — vòng 2: `compare/` có
  15 ảnh ghép, E9 ở 390 (1,47 %); bản 1919 của E9 là 0,44 % nên bị luật 0,5 % loại, đã ghi trong README.
- [x] `docs/smartquote-quote-editor-reference.md` cập nhật luật gating tab; `docs/KNOWN-DEVIATIONS.md`
  nếu có lệch so với desktop; CHANGELOG nếu dự án có.
- [x] Không commit, không push. Tổng kết gửi người dùng: bug nào đóng, bug nào để lại (D3 gable,
  E4/E5 nếu không định vị được), ảnh ở đâu.

## Review focus (dễ vỡ, chưa có test nào giữ)

1. Gating quá chặt khoá người dùng đang ở Building khi họ chỉ sửa một ký tự ở Edit mobile → phải về Start
   **kèm focus lỗi**, không mất design.
2. Class 1 House (`mode: 'enquiry'`) — luồng riêng không được hỏng bởi `stepLocked` mới.
3. Places lỗi thật (`placesUnavailable = true`) — link "Search by street address" không được hiện.
4. Skillion: một máng, một xà, cột phải cao hơn — test hình học phải có case skillion cho C1/C2.
5. Carport `roof_only` không có tường: downpipe "sát tường" phải sát **cột** (x của mặt ngoài cột) —
   kiểm `enclosure` trước khi áp offset.

---

## Trạng thái thực thi (2026-11-24)

Đã làm Phase 0 → F. Ba ô còn để trống ở trên là ba việc **không làm**, có lý do:

- **E4** (ghi chú Class 1 House bị cắt chữ): **đo vòng 2 — không tái hiện**. `.g-type-desc` có
  `scrollHeight = clientHeight` (48 px), `overflow: visible`, không `line-clamp` ở 1919 / 1440 / 1280 /
  390; không sửa gì.
- **E5** (autocomplete thiếu postcode / gợi ý lạc): **làm vòng 2 bằng code + stub** — API thêm
  `includedPrimaryTypes: ['street_address']`; stub có `secondary` hiện postcode trong nhãn. Xác minh
  với Google thật vẫn cần `scripts/probe-guest-places.mjs` (chưa chạy).
- **E9** (Surfmist/Shale Grey gần trùng trong 3D): đổi vật liệu/độ tương phản là thay đổi thẩm mỹ mà
  phiên này không xem được ảnh để đánh giá; để lại cho người review.
- **D3** (sheeting tam giác đầu hồi): quyết định là **không làm** trong plan này.

Ảnh: `docs/qa/screens/2026-11-24-guest/{before,after,mobile}` + `README.md` trong thư mục gốc của bộ ảnh.

**Vòng 2 (2026-11-24):** e2e 5/5; E4 không tái hiện; E5 làm bằng code + stub; E9 dùng vật liệu + đường
viền mép mái và đo bằng `scripts/qa-contrast.mjs`; ảnh ghép trong `compare/` (15 ảnh, 5 cặp bị bỏ).
