# Plan — Guest `/quote` theo yêu cầu khách: G-a2 (bước đầu + BUILDING), G-f (3D), G-g (AI)

> **Nguồn:**
> - Phân tích: [quote-tiers-guest-customer-gap.md](../specs/quote-tiers-guest-customer-gap.md), viết 2026-11-19.
> - Spec gốc: [quote-tiers-guest.md](../specs/quote-tiers-guest.md).
> - Plan trước: [quote-tiers-guest-ga.md](quote-tiers-guest-ga.md), đã xong S1–S8, **chưa commit**.
> - Checkpoint: [docs/state/quote-tiers.md](../state/quote-tiers.md).
>
> **Cỡ:** *large*, **một coder**, làm tuần tự. Mỗi bước build và chạy được một mình. Tests và git tắt (mặc định); coder tự kiểm tra từng bước.

## 0. Đọc trước khi làm (bắt buộc cho agent thực thi)

1. **Đọc các file sau:** `CLAUDE.md` ở gốc repo (hai bẫy: dùng `localhost`; package build ra `dist`), file phân tích ở trên, và mục 1 của file này.
2. **Không commit, không push.** Không tạo branch hay worktree. Chỉ được commit khi người dùng bảo rõ.
3. **Không sửa migration đã có.** Migration 001–020 đã được áp dụng ở máy local và có checksum, nên mọi thay đổi DB phải là file mới `021_*`.
4. **Thuật ngữ.** Tên trong code bằng tiếng Anh, theo thuật ngữ hiện có (`span`, `bayWidth`, `GuestDesignInput`…). Văn bản cho người dùng viết tiếng Việt.
5. **Không làm lộ bí mật.** Không in, không chép giá trị `GOOGLE_PLACES_API_KEY`, `SHEDSAFE_*`, `VILAO_API_KEY` hay nội dung `.env`. Gọi Google thật chỉ bằng `node scripts/probe-guest-places.mjs`, một lần, chạy tay.
6. **Dữ liệu thử.** Chỉ dùng: Test Guest, `test.guest+<n>@example.com`, 0412 345 678, địa chỉ 2 GEORGE ST, BRISBANE CITY QLD 4000. Không gửi mail thật.
7. **Server.** Chạy server bằng preview tool hoặc `pnpm dev`, không chạy nền bằng Bash. Trang guest ở http://localhost:3063/quote.
8. **Kỷ luật khẳng định.** Khi thấy thiếu dữ liệu thì làm theo `docs/CLAIM-DISCIPLINE.md`:
   - soi sổ giá `data/price-books/fe5a7cae*.db`;
   - mở code desktop `../smq-code-smartquote` và trích file:line;
   - chưa soi thì ghi "chưa kiểm tra".
   - Đọc sổ giá bằng `import('node:' + 'sqlite')` (`readOnly: true`), chạy với `< /dev/null`.
9. **Cập nhật checkpoint.** Xong mỗi bước, thêm một dòng vào `docs/state/quote-tiers.md`: bước nào, file chính, đã kiểm tra gì. Số liệu chỉ ghi khi đã chạy thật.

## 1. Quyết định — **đã chốt 2026-11-19**

Người dùng đã trả lời Q1–Q8 và chọn đúng đề xuất cho cả tám câu.

- Đây là quyết định cuối, agent không hỏi lại.
- Nếu trong lúc làm gặp dữ kiện làm một quyết định không làm được, dừng và báo người dùng; không tự đổi quyết định.

| # | Quyết định (mặc định) | Ảnh hưởng tới bước |
|---|---|---|
| Q1 | Có 6 loại công trình (bảng mục 3.1). **Riding Arena** dựa trên Gable nhịp lớn. **Class 1 House** là loại *chỉ gửi yêu cầu* (`mode: 'enquiry'`): không có bước thiết kế, không có dòng 10a | S1, S4 |
| Q2 | **Liên hệ hỏi ở bước ①** (đảo D-T4). Liên hệ chỉ giữ **trong bộ nhớ** của trang, như hiện nay (`store.ts:91` không ghi `contact` xuống `localStorage`). Không lưu lead dở dang | S3, S4 |
| Q3 | Dòng gió/hạng là **ước tính tại chỗ** (phương án b), ghi rõ "Indicative — confirmed in your quote". Không gọi ShedSafe từ trang guest | S2, S5 |
| Q4 | **Skillion có 5° và 10°** như khách muốn. 5° nằm dưới mức tối thiểu 7.5° của sổ giá (shed params 2), nên lead mang cờ `needsReview: ['pitch']` | S1 |
| Q5 | Có "Footing Only" trong lựa chọn. Lưu dưới dạng `slab: 'footing_only'`; **không** ánh xạ sang mã footing của engine. Estimator quyết khi mở quote | S1 |
| Q6 | **Carport mặc định 1 bay × 5.90 m** như khách muốn. Sổ giá không có giới hạn bay cho carport (xem mục 2), nên bay > 4.0 m mang cờ `needsReview: ['bay']` | S1 |
| Q7 | "AI assessment" gồm **trợ lý G-g** và **thẻ "Design check"**. Thẻ chạy bằng luật trong core, không cần model: luôn hiện và luôn đúng. Model chỉ diễn giải và gợi ý | S9–S11 |
| Q8 | Thứ tự: **G-a2** (S1–S6), rồi **G-f** (S7–S8), rồi **G-g** (S9–S12) | — |

## 2. Sự thật đã kiểm tra (2026-11-19)

**Sổ giá** (`data/price-books/fe5a7cae…db`):

- `view_system_shed_parameters` có ba bộ. Bộ 1 và 3: span 1800–15000, cao 2200–6000, **bay 1000–4000**, độ dốc **7.5–15**. Bộ 2: như trên nhưng độ dốc **7.5–30**.
- `view_system_structure` → `shed_parameters`:
  - **Params 2:** Gable S4 (3 dòng), Gable S5, S6, Cyclonic S4, **Skillion S4**, **Aircraft Hangar S6**.
  - **Params 1:** Gable S4 (1 dòng).
  - **Params 3:** Award.
  - **Null:** Gable Carport (id 25), Skillion Carport (id 26), Custom Gable, Custom Skillion, Durastall, Awning.
- `view_system_lookup_data` (bảng kỹ thuật, quyết định KB): **chỉ có `structure_code` 1**, span 6000–15000, bay 3000/3500/4000 (2752 dòng). `internal_pressure` có hai giá trị là "+0.7, -0.65" và "+0.2, -0.3" (chắc là Enclosed và Roof Only, chưa xác nhận). Không có dòng nào cho carport.
- `shed_footing_type`: In Slab (1), On Slab (2). Không có "Footing Only".
- `country_surburb` không có cột gió.

**Core:**

- `GuestSizeMm` ở `packages/core/src/domain/guest.ts:27-33`: chỉ có bay đều.
- `GABLE_PITCHES = [10, 12.5, 15, 17.5]` ở `guest.ts:135`.
- `GUEST_DEFAULT_TYPES` ở `guest.ts:180-286`: shed, garage, carport, skillion.
- `configFromGuestDesign` ở `guest.ts:336-363`. Dòng `delete config.bayWidths` ở `:359`.
- `validateGuestDesign` ở `guest.ts:387`.
- `ShedConfig.bayWidths?: number[]` ở `types.ts:421`. Option `horizontal_cladding` ở `types.ts:185,305`.
- Preset: `domestic_garage` và `farm_machinery` là gable; `skillion_workshop` là skillion; `open_carport` là gable_carport (`presets.ts:92-177`).
- `StructureType` có `aircraft_hangar` (`types.ts:44-60`).

**Contracts:**

- `guestContactSchema` ở `packages/contracts/src/guest.ts:212-224`, có `normaliseAuMobile`.
- `guestRequestBody` ở `:235-247`: `notes` tối đa 2000; `design.site` bắt buộc; `consent: true`.
- Ở cuối file có các assert đảm bảo kiểu của contracts và core khớp nhau. Đổi core thì phải đổi zod cùng lúc, không thì build báo lỗi.

**Site:**

- `apps/site/src/app/quote/store.ts`: `STEPS = ['type','address','design','send']` (`:25`). `localStorage` chỉ giữ `design`, `step`, `source`, `revisionOf` (`:91`).
- Có các component `AddressPanel.tsx` (chế độ `places` | `suburb`, cộng 4 ô sửa tay), `ControlAccordion.tsx`, `GuestPlan.tsx` (2D SVG), `Stage.tsx`, `SendPanel.tsx`, `StepTabs.tsx`, `SummaryBar.tsx` và `WindNote.tsx`.

**3D ở client:**

- `Render3D.tsx` đọc `useShedStore` ở `:146`, `useMediaQuery` ở `:154`, `useContainerSize` ở `:158`. Nó có `cameraFrameFor` (`:76`).
- `Shed3D.tsx` có `buildOptionMeshes` (`:76`), `buildWallShape` (`:192`) và `Shed3D` (`:223`). Thư mục `components/three/` có `PartMesh.tsx`, `StudioEnvironment.tsx`, `useSheetingTexture.ts`.
- Phụ thuộc: `three` 0.186.1, `@react-three/fiber` 9.8.1, `@react-three/drei` 10.7.9, `@types/three` 0.186.0 (`apps/client/package.json`).

**ShedSafe:** `apps/api/src/lib/shedsafe.ts`. `pin()` tạo building trên tài khoản công ty; giá trị chỉ được chứng nhận sau Auto Calc. **Không dùng cho guest** (Q3).

## 3. Mô hình dữ liệu mới

### 3.1 Sáu loại mặc định (`GUEST_DEFAULT_TYPES`)

| id | Tên hiển thị | basePreset | Mái | Kín/hở | Mặc định W × H × L | Bay | Độ dốc cho chọn |
|---|---|---|---|---|---|---|---|
| `garage` | Garage | `domestic_garage` | gable (skillion tuỳ chọn) | Enclosed | 6.0 × 3.0 × 6.0 | 2 × 3.0 | 10/15/20/25/30 |
| `industrial` | Industrial Building | `farm_machinery` | gable (skillion tuỳ chọn) | Enclosed | 12.0 × 4.5 × 12.0 | 4 × 3.0 | 10/15/20/25/30 |
| `riding_arena` | Riding Arena | `farm_machinery` | gable | Enclosed | 15.0 × 4.5 × 30.0 | 8 × 3.75 | 10/15/20/25/30 |
| `aircraft_hangar` | Aircraft Hangar | **preset mới** `aircraft_hangar` | gable | Enclosed | 15.0 × 4.5 × 12.0 | 4 × 3.0 | 10/15/20/25/30 |
| `carport` | Carport | `open_carport` | gable (skillion tuỳ chọn) | Roof Only | 6.0 × 3.0 × 5.9 | 1 × 5.9 | 10/15/20/25/30 |
| `house` | Class 1 House | — (`mode: 'enquiry'`) | — | — | — | — | — |

- Kích thước của Industrial, Riding Arena và Hangar chỉ là **giá trị khởi đầu đề xuất**, chưa xác nhận với khách. Ghi rõ điều này trong comment code.
- Giới hạn chung: span 1800–15000, cao 2200–6000 (theo sổ giá). Bay 1000–4000; carport cho tới 6000 kèm cờ duyệt.
- Skillion: độ dốc chỉ có 5 và 10.
- Đổi mái gable ↔ skillion = đổi cấu trúc engine:
  - gable → `gable` / `gable_carport`;
  - skillion → `skillion` / `skillion_carport`.
- Nếu khách đổi mái mà độ dốc đang chọn không có trong danh sách của mái mới, đặt lại về mặc định của mái mới (gable 10, skillion 5).

### 3.2 `GuestDesignInput` v2 (core; zod twin ở contracts)

```ts
interface GuestBuildingSpec {           // mới, thay GuestSizeMm
  span: number; height: number; pitchDeg: number;
  roof: 'gable' | 'skillion';
  bayWidths: number[];                  // độ dài từng bay, mm; length = tổng
  slab: 'in_slab' | 'on_slab' | 'footing_only';
  kneeBrace: 'standard' | 'none_if_possible';   // chỉ là mong muốn, không đổi BOM
  cladding: 'vertical' | 'horizontal';
}
interface GuestDesignInput { v: 2; typeId; typeVersion; site?; building: GuestBuildingSpec; openings; colours; }
```

- **Đọc bản v1 cũ.** `localStorage` của khách có thể còn bản `v: 1`. Thêm `upgradeGuestDesign(raw)`: chuyển `size.{bays,bayWidth}` sang `bayWidths`, và điền mặc định `roof` / `slab` / `kneeBrace` / `cladding`. `store.ts` gọi hàm này lúc hydrate. API **chỉ nhận v2**.
- **`configFromGuestDesign`:**
  - đặt `bayWidths`, `bays = bayWidths.length`, `length = tổng`, `nomBaySpacing = bayWidths[0]`; **bỏ** `delete config.bayWidths`;
  - đặt `structureType` theo mái và theo loại;
  - `cladding === 'horizontal'` → thêm option `horizontal_cladding`, theo đúng hình dạng option ở `types.ts:305`;
  - `slab` và `kneeBrace` **không** vào `ShedConfig`; chúng nằm trong `design_json` cho estimator đọc.
- **Hàm mới `guestReviewFlags(design, type): ('pitch' | 'bay' | 'span')[]`**: những chỗ nằm trong giới hạn của trang nhưng ngoài sổ giá (Q4, Q6). Không chặn gửi.
- **`GuestBuildingTypeConfigSpec` thêm:**
  - `mode: 'design' | 'enquiry'`;
  - `enclosure: 'enclosed' | 'roof_only'`;
  - `roofs: ('gable' | 'skillion')[]`;
  - `limits.pitches` đổi thành `limits.pitchesByRoof: Record<roof, number[]>`.
- **Validate v2:** thêm cho từng bay `bayWidths.N`, giới hạn số bay (1–12), và roof phải nằm trong `roofs`. Với `mode: 'enquiry'`, bỏ qua mọi kiểm tra kích thước, cửa và màu.

### 3.3 Hợp đồng gửi yêu cầu

- `contact.mobile` vẫn qua `normaliseAuMobile`.
- Đổi `notes` thành **`additionalRequest`**, tối đa 4000 ký tự. Trường `notes` cũ giữ làm alias một bản (chấp nhận, ghi vào cùng cột), rồi bỏ.
- `design` vẫn bắt buộc. Với loại `house`, trang gửi `guestDesignFromType(type, site)`.
- Server **tính lại** `siteEstimate` và `reviewFlags`; không tin giá trị trình duyệt gửi lên.

### 3.4 Migration `021_guest_site_estimate.sql` (+ `pg/` nếu cần)

```sql
ALTER TABLE guest_requests ADD COLUMN site_estimate_json TEXT;   -- {region, regionSource, buildingClass, enclosure, importanceLevel, windSpeedMs?}
ALTER TABLE guest_requests ADD COLUMN review_flags TEXT;         -- JSON array, có thể null
```

- **Không lưu lat/lng** của Google. Policy của Places chỉ cho lưu `place_id` (plan G-a §3). Vùng gió là giá trị *suy ra*, nên lưu được.

## 4. Các bước

### G-a2 — bước đầu + BUILDING

#### S0 — Kiểm tra ba điểm còn mở (đọc, không sửa code)

1. **Giới hạn carport ở desktop.** Grep `Carport` / `bay` / `MaxBay` trong `../smq-code-smartquote` (*.cs). Trích file:line, và ghi rõ đoạn đó có bị comment out không. Kết quả ghi vào bảng Q6 của file phân tích.
   - Đây chỉ là thông tin để chỉnh ngưỡng cờ: Q6 đã chốt là 1 × 5.90 m kèm cờ duyệt, không đổi mặc định.
2. **Preset hangar.** Mở `packages/core/src/domain/presets.ts`: có preset nào dùng `structureType: 'aircraft_hangar'` không? Nếu không, ghi lại; S1 sẽ thêm.
3. **Field mask của Places details.** Tìm trong `apps/api/src/lib/places.ts` (trước đây là `formattedAddress,addressComponents`). Đọc trang chính thức của Places API (New) "Place Details": thêm `location` thì SKU có đổi không. Ghi kết quả vào `docs/research/places-location-sku.md` kèm nguồn.
   - Nếu đổi lên SKU đắt hơn, **dừng và hỏi người dùng** trước S2.

**Xong khi:** ba kết quả đã ghi vào file, mỗi cái có trích dẫn.

#### S1 — Core + contracts: thiết kế v2 và 6 loại

**File:** `packages/core/src/domain/guest.ts`, `presets.ts` (preset `aircraft_hangar` nếu S0 nói thiếu), `packages/core/src/domain/index.ts` (export), `packages/contracts/src/guest.ts`.

1. Viết các kiểu ở mục 3.2, `upgradeGuestDesign`, `guestReviewFlags`, và `guestLengthMm` (đổi thành tổng `bayWidths`).
2. Viết lại `GUEST_DEFAULT_TYPES` theo bảng 3.1. `GABLE_PITCHES = [10, 15, 20, 25, 30]`, `SKILLION_PITCHES = [5, 10]`.
3. Viết hàm thuần cho thao tác bay (để site và trợ lý dùng chung):
   - `addBay(design, type, atIndex?)`: thêm một bay bằng bay cuối;
   - `setBayWidth(design, i, mm)`;
   - `removeBay(design, i)`: không cho xuống dưới `limits.bays.min`;
   - `setRoof(design, type, roof)`: đặt lại độ dốc khi cần.
   - Sau mỗi thao tác chạy `placeOpening` để cửa không rơi khỏi tường. Cửa không còn vừa thì đánh dấu, **không** xoá im lặng.
4. Sửa zod ở contracts cho khớp. Assert ở cuối file phải compile được.
5. Viết `guestSiteEstimate({ region | null, enclosure, mode })`: trả `{ buildingClass: '10a', enclosure, importanceLevel: 2, region, windSpeedMs? }`. Với `mode: 'enquiry'` trả `null` (nhà Class 1 không phải 10a). Phần region lấy từ S2.

**Tự kiểm tra:**
- `pnpm --filter @sq/core build && pnpm --filter @sq/contracts build && pnpm --filter @sq/core typecheck`.
- Script nháp `npx tsx` gọi `configFromGuestDesign` cho cả 6 loại × 2 mái, in `structureType`, `length`, `bays`, `bayWidths` và `validateGuestDesign(...)` (phải rỗng với mặc định).
- Chạy thêm `pnpm --filter @sq/core test`: suite core không cần DB. Test cũ của guest sẽ hỏng vì đổi v2; sửa test cho khớp hành vi mới, **không xoá test**.

#### S2 — API: vùng gió ước tính + migration 021 + nhận v2

1. **Nghiên cứu.** Chạy `/research`, hoặc agent researcher, về ranh giới vùng gió A/B/C/D của AS/NZS 1170.2:2021 (Figure 3.1(A)), và về con số "45 m/s" ứng với gì.
   - Nghi ngờ: đó là V_des sau hệ số địa hình của ShedSafe, chứ không phải V_R của vùng. Theo bảng 3.1 thì V_500 vùng A là 45 m/s, vùng B lớn hơn; **chưa kiểm tra**.
   - Ghi `docs/research/wind-regions-as1170-2.md` kèm nguồn.
   - **Nếu không có nguồn tin được cho tốc độ, chỉ hiện vùng, không hiện m/s.**
2. **Core: `estimateWindRegion(lat, lng): 'A' | 'B' | 'C' | 'D' | null`.**
   - Đặt ở `packages/core/src/domain/windRegion.ts`. Dữ liệu là đa giác đơn giản hoá do bước nghiên cứu cung cấp, lưu thành hằng số TS.
   - Điểm sát ranh giới (< 10 km), hoặc không chắc, trả `null`; trang sẽ hiện "confirmed in your quote".
   - Ghi giới hạn này trong comment và trong `docs/KNOWN-DEVIATIONS.md`.
3. **Places details** trả thêm `location` (tuỳ kết quả S0.3). Route `details` **không** trả lat/lng cho trình duyệt; chỉ trả `region` đã tính, kiểu `GuestPlaceDetails.windRegion?: 'A'|'B'|'C'|'D'|null`.
4. **Migration** `packages/db/migrations/021_guest_site_estimate.sql` theo mục 3.4. Chạy `pnpm db:migrate`.
5. **Route gửi** (`apps/api/src/routes/guest.ts`):
   - nhận v2;
   - `additionalRequest`, kèm alias `notes`;
   - với `mode: 'enquiry'`, không validate thiết kế;
   - tính `siteEstimate` từ `place_id`: gọi lại details, hoặc dùng region đã ký trong session token; **chọn cách ít gọi Google hơn và ghi lý do**;
   - lưu `site_estimate_json` và `review_flags`;
   - mail xác nhận (`apps/api/src/lib/mail/guestMail.ts`) có thêm dòng ước tính và cờ duyệt, nhưng chỉ ở mail gửi nội bộ, không ở mail gửi khách.
6. **Thêm env mới (nếu có)** vào `turbo.json` `globalPassThroughEnv` và `.env.example`.

**Tự kiểm tra:**
- `pnpm --filter @sq/api typecheck`.
- `TEST_DATABASE_URL=postgres://…/smartquote_test pnpm --filter @sq/api exec vitest run src/__tests__/guest*`, nếu có file. Transport Google là bản giả.
- `curl -s -X POST localhost:3060/api/v1/public/guest/requests -H 'content-type: application/json' -d @<payload v2 thử>` phải trả 202; payload v1 phải trả 400.
- Gọi `estimateWindRegion` cho Brisbane CBD (−27.47, 153.03) bằng script nháp và in kết quả. So với khẳng định "Region B" của khách: nếu lệch, ghi lại, không sửa dữ liệu cho khớp.

#### S3 — Site: store + bước "Bắt đầu"

**File:** `apps/site/src/app/quote/store.ts`, `components/GuestQuote.tsx`, `StepTabs.tsx`, `StepFooter.tsx`, `summary.ts`, `content.ts`.

1. Đổi `STEPS` thành `['start', 'design', 'send']`.
   - `hydrate` đọc `?step=type|address` cũ thì chuyển sang `start`.
   - `?type=<id>` vẫn chọn sẵn loại.
   - Gọi `upgradeGuestDesign` cho bản đã lưu.
2. **Khoá bước:** `design` và `send` mở khi đã có loại + địa chỉ đã chọn từ gợi ý + liên hệ hợp lệ. Với loại `house`, bỏ qua `design`: ① chuyển thẳng tới ③.
3. **Liên hệ:** vẫn chỉ trong bộ nhớ. Thêm câu dưới form: "Your details stay on this page until you send." Reload thì mất liên hệ; ghi điều đó vào chú thích của form.

**Tự kiểm tra:** `pnpm --filter @sq/site typecheck && pnpm --filter @sq/site build`. Mở trang, reload với `?step=address` thì phải vào `start`.

#### S4 — Site: panel "Bắt đầu" (loại + địa chỉ + liên hệ)

**File:** `components/TypeCard.tsx`, `icons.tsx` (thêm icon industrial, arena, hangar, house), `AddressPanel.tsx` (viết lại gọn), panel mới `StartPanel.tsx`, `guest.css`, `WindNote.tsx` (thay bằng `SiteEstimate.tsx`).

1. **Sáu thẻ loại.** Bố cục lưới 3 × 2 trên desktop, 2 × 3 trên điện thoại. Thẻ House có nhãn phụ "We'll contact you to discuss".
2. **Địa chỉ:**
   - **một ô** "Street number and name", combobox Places;
   - **bắt buộc chọn từ gợi ý**: gõ mà không chọn thì báo lỗi "Pick your address from the list";
   - sau khi chọn, hiện một dòng chỉ đọc "2 George St, Brisbane City QLD 4000" kèm nút "Change";
   - bỏ 4 ô sửa tay;
   - chế độ suburb dự phòng **chỉ** hiện khi Places báo lỗi hoặc hết lượt; đó là hành vi hiện có ở `AddressPanel.tsx:96-131`, giữ nguyên.
3. **Liên hệ:**
   - First Name, Last Name, Email Address, Mobile;
   - Mobile có tiền tố cố định "+61" bên trái ô, placeholder "0412 345 678", `inputMode="tel"`, `autoComplete="tel-national"`;
   - các ô khác dùng `given-name`, `family-name`, `email`;
   - kiểm tra lúc blur, báo lỗi ngay dưới ô.
4. **Additional Request:** ô lớn (6 dòng), tuỳ chọn, đặt ở ① (khách muốn).
   - Nội dung dùng chung một state với ô ở ③, không phải hai ô riêng; ③ hiện lại để sửa.
5. **`SiteEstimate`:** hiện ngay khi có địa chỉ, ví dụ "Region B · 10a Enclosed · Importance Level 2", kèm chữ nhỏ "Indicative — confirmed in your quote".
   - Carport hiện "10a Roof Only".
   - Không có vùng thì hiện "Wind region confirmed in your quote".
   - House không hiện dòng này.
6. **Nút "Continue"** đi tới ②, hoặc tới ③ với House.

**Tự kiểm tra:** chạy trên trang thật với Places thật, một lần: gõ "2 George St Brisbane", chọn gợi ý đầu, thấy dòng ước tính. Đo lại tương phản bằng script `contrast.js` cũ trong scratchpad (hoặc axe), cả sáng lẫn tối; phải đạt AA. Thử điện thoại 375px, không có cuộn ngang.

#### S5 — Site: BUILDING (②)

**File:** `components/ControlAccordion.tsx` (tách thành `BuildingControls.tsx` nếu quá 600 dòng), `designOps.ts`, `GuestPlan.tsx`, `SummaryBar.tsx`, `summary.ts`.

Thứ tự điều khiển theo danh sách của khách:

1. **Width / Height:** ô số bước 0.1 m, hiện 2 số lẻ ("6.00"); nhập bằng mét, lưu mm.
2. **Length:** chỉ đọc, bằng tổng bay; bấm vào thì cuộn tới danh sách bay.
3. **Roof:** segmented control Gable | Skillion, chỉ hiện các mái loại đó cho.
4. **Roof Pitch:** chip, lấy từ `pitchesByRoof[roof]`.
5. **Slab Connection:** radio In Slab / On Slab / Footing Only.
6. **Knee Brace:** radio "Knee Brace" / "No Knee Brace – If Possible", kèm chú thích "Final bracing is set by engineering".
7. **Cladding:** Vertical | Horizontal.
8. **Bay Spacing:**
   - danh sách từng bay "Bay 1 — 3.00 m" với ô sửa và nút xoá;
   - nút "+ Add bay";
   - mọi thao tác qua hàm core của S1;
   - xoá bay mà làm cửa không còn vừa thì hiện cảnh báo tại cửa đó; 2D tô đỏ.
   - **Giữ nguyên** phần cửa và màu hiện có, đặt sau Bay Spacing.

**2D:**
- `GuestPlan` vẽ đường bay theo `bayWidths`, không chia đều nữa.
- Kéo cửa vẫn theo `placeOpening`.

**Thanh tóm tắt:**
- hiện "6.00 × 6.00 × 3.00 m · Gable 10° · 2 bays";
- có cờ duyệt thì thêm chấm vàng "Needs estimator check".

**Tự kiểm tra:** chạy tay trên trang:
- thêm, sửa, xoá bay;
- đổi mái; đổi Carport sang skillion;
- đặt độ dốc 5° thì cờ hiện.
- Không có lỗi trong console; điện thoại 375px dùng được bằng chạm.

#### S6 — Site: ③ Gửi + E2E + tài liệu

1. **`SendPanel.tsx`:**
   - bỏ form liên hệ (đã ở ①), chỉ hiện tóm tắt liên hệ kèm nút "Edit";
   - tóm tắt BUILDING đầy đủ;
   - ô Additional Request;
   - consent; nút Send.
   - House: tóm tắt chỉ có loại + địa chỉ + liên hệ + yêu cầu.
2. **Mail xác nhận** cho khách liệt kê thông số BUILDING. Không có giá, không có cờ duyệt.
3. **Sửa `e2e/guestQuote.spec.ts`** theo luồng 3 bước: stub các route Places như hiện có, không gọi Google. Thêm một ca House.
   - Chạy `pnpm test:e2e -- e2e/guestQuote.spec.ts` khi `pnpm dev` đang chạy.
4. **Tài liệu:**
   - `docs/specs/quote-tiers-guest.md`: ghi D-T4 đã đảo, các trường mới, và mục bỏ "footing/knee brace/cladding" thành có;
   - `docs/smartquote-quote-editor-reference.md` nếu luật editor đổi (bay không đều cho guest);
   - `docs/KNOWN-DEVIATIONS.md`: Skillion 5°, carport 5.9 m, vùng gió ước tính;
   - `docs/FEATURE-COVERAGE.md`;
   - checkpoint.

**Xong G-a2 khi:**
- cả 6 loại gửi được từ đầu tới cuối trên trang thật;
- `pnpm build` và `pnpm typecheck` toàn workspace đều qua;
- E2E guest qua.

### G-f — 3D trên trang guest

#### S7 — Tách package `@sq/viewer3d`

1. **Tạo `packages/viewer3d`.** Theo mẫu `packages/ui`: tsup, `dist`, `"use client"` ở đầu entry, peer deps `react`, `three`, `@react-three/fiber`, `@react-three/drei`, **đúng các bản client đang dùng** (mục 2). Không nâng phiên bản nào; không nâng Next.
2. **Chuyển sang package:**
   - `Shed3D.tsx`, `components/three/*`;
   - phần thuần của `Render3D.tsx`, thành `ShedViewer({ config: ShedConfig, shadows?: boolean, view?: 'iso'|'front'|'side'|'plan' })`;
   - `cameraFrameFor`;
   - `useContainerSize`, `useMediaQuery` (chép sang package hoặc nhận qua prop).
3. **Ở client:**
   - `Render3D.tsx` còn là lớp mỏng: đọc `useShedStore`, rồi gọi `<ShedViewer>`;
   - `PlanView.tsx` giữ import cũ, hoặc đổi sang package.
   - **Không đổi hành vi editor.** AC 1a của spec: ngoài import 3D, không sửa file nào khác trong `apps/client/src/components/editor/`.
4. **Thêm `@sq/viewer3d`** vào `transpilePackages` của client và site, và vào `pnpm-workspace` nếu cần.

**Tự kiểm tra:**
- `pnpm build`.
- Mở editor client (3061, đăng nhập bằng phiên E2E đã lưu, hoặc tài khoản thử theo `docs/TEST-ACCESS.md`): 3D vẫn xoay được, màu, cửa và bóng như trước. Chụp màn hình trước và sau để so.

#### S8 — 3D trong `Stage.tsx` của guest

1. Tab "3D model" thành **tab mặc định** khi máy hỗ trợ WebGL; 2D là tab thứ hai. Nạp bằng `next/dynamic` (`ssr: false`), để trang đầu không phải tải three.js.
2. `config = configFromGuestDesign(design, type)` được memo theo `design`. Đổi bất kỳ điều khiển nào, hoặc kéo cửa ở 2D, thì 3D cập nhật (AC 1c).
3. Có các nút góc nhìn 3D / Front / Side / Plan.
4. Không có WebGL thì quay về 2D, hiện một dòng thông báo.
5. Tôn trọng `prefers-reduced-motion`: không tự xoay.

**Tự kiểm tra:**
- Đổi width ở ② thì 3D đổi theo.
- Điện thoại 375px: kéo xoay được và trang không cuộn theo.
- Đo kích thước JS trang `/quote` trước và sau (`next build` in ra), ghi vào checkpoint.

### G-g — AI: "Design check" + trợ lý

#### S9 — "Design check" (luật, không cần model)

1. **Core: `assessGuestDesign(design, type, estimate) → AssessmentItem[]`**, mỗi mục có `{ level: 'ok' | 'note' | 'review', title, detail, path? }`. Luật ban đầu:
   - kích thước nằm trong giới hạn sổ giá;
   - cờ duyệt (độ dốc, bay);
   - knee brace "none if possible": "Engineering may still require bracing at this span/height";
   - Footing Only: estimator xác nhận;
   - cửa sát mép;
   - Roof Only với carport;
   - vùng gió C/D: "Cyclonic region — a cyclonic-rated frame will be quoted".
   - Mỗi luật một hàm nhỏ, và có test khi bật `tests=on`.
2. **Site:** thẻ "Design check" ở cột phải của ②, ngay dưới trợ lý khi có trợ lý.
   - Cập nhật trực tiếp; không có giá.
   - Bấm một mục có `path` thì focus vào điều khiển đó.

**Tự kiểm tra:** đặt skillion 5° thì có mục "review"; đặt carport bay 5.9 m thì có mục "review".

#### S10 — Trợ lý: API

Làm đúng spec G-g (`quote-tiers-guest.md`, khoảng dòng 366–515). Trước khi viết code, đọc lại đoạn đó và `docs/superpowers/specs/2026-11-13-ai-assistant-ui-design.md`.

1. **Gateway** tương thích OpenAI như `01.RFQ_PWA_SQ` (spec ghi file:line). Chỉ chép **tên** biến môi trường. Giá trị do người dùng tự đặt vào `.env`; **không đọc, không in**.
2. **Route `POST /public/guest/assistant/turn`:**
   - giới hạn theo IP và theo phiên;
   - env `GUEST_ASSISTANT_ENABLED` và `GUEST_ASSISTANT_DAILY_TURNS` (thêm vào `turbo.json` và `.env.example`);
   - **không gửi dữ liệu cá nhân cho model**: chỉ gửi thiết kế, loại và vùng gió.
3. **Model trả về tool calls** dạng thao tác thiết kế (`setSpan`, `setRoof`, `addBay`, `setBayWidth`, `removeBay`, `setPitch`, `setSlab`, `setKneeBrace`, `setCladding`, `addOpening`, …). Server chạy chúng qua **hàm core của S1**, rồi validate, rồi trả `{ message, ops, design }`.
   - Thay đổi lớn (đổi loại, đổi mái, xoá nhiều hơn 1 bay hoặc cửa) trả `needsConfirm`, không tự áp dụng.
4. **Trợ lý giải thích "Design check".** Mục của S9 được gửi kèm làm ngữ cảnh. Model **không** tự đặt luật kỹ thuật mới; khi được hỏi điều ngoài luật, trả lời "an estimator will confirm".
5. **Migration `022`** cho bảng phiên trợ lý và `guest_requests.assistant_session_id`, theo spec.

**Tự kiểm tra:** chạy bộ câu ở phụ lục E của `guest-login-step-by-step.md` (đường dẫn đã ghi trong spec), mỗi câu một lần, bằng script probe mới `scripts/probe-guest-assistant.mjs`; chạy tay, không lặp. Ghi kết quả vào checkpoint.

#### S11 — Trợ lý: UI

1. **`AssistantPanel` cho site:**
   - ≥ 1280px: cột phải 340px;
   - 1024–1279px: drawer 380px;
   - dưới 1024px: FAB "Ask the AI" cộng bottom sheet 85dvh, không che thanh tóm tắt (spec dòng 384–385).
2. **Thẻ thay đổi:** cũ → mới, Undo, View on plan; các trạng thái applied / undone / overwritten. Không có giá.
3. **Ô "Or describe it to the assistant"** ở bước ①, kèm mic:
   - trợ lý điền loại, kích thước, mái…;
   - **không** tự điền liên hệ hay địa chỉ: địa chỉ vẫn phải chọn từ gợi ý.
4. **Dòng cuối panel:** "AI can make mistakes — check the plan".
5. **Khi trợ lý tắt hoặc lỗi:** dải "The assistant is unavailable — the designer still works as normal". "Design check" vẫn chạy.

#### S12 — Hoàn tất G-g

- Thêm E2E bước 7 của spec ("make it 9 metres wide" → thẻ thay đổi → Undo), stub route assistant.
- Cập nhật tài liệu và checkpoint.

## 5. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Vùng gió ước tính sai, và khách tin là thật | Chữ "Indicative" luôn đi kèm. Ranh giới trả `null`. Estimator chạy SiteCheck thật khi lập quote |
| Thêm `location` làm tăng chi phí Places | S0.3 kiểm tra trước; nếu đắt hơn thì hỏi người dùng |
| Bản v1 trong `localStorage` làm hỏng trang | `upgradeGuestDesign` + try/catch; giá trị hỏng thì bỏ (hành vi sẵn có của `store.ts`) |
| Tách 3D làm hỏng editor | S7 không đổi hành vi, có ảnh trước/sau, AC 1a |
| Kích thước mặc định của Industrial, Arena, Hangar không đúng ý khách | Chỉ là giá trị khởi đầu, đã ghi trong comment. Hỏi khách khi demo |
| Trợ lý gửi dữ liệu cá nhân cho model | Server dựng prompt chỉ từ design, type và region |

## 6. Đề xuất test (tests đang tắt)

Nếu người dùng bật `tests=on`, nên thêm:

- `upgradeGuestDesign`, thao tác bay, `setRoof`;
- `guestReviewFlags`;
- `estimateWindRegion` tại vài điểm đã biết;
- `assessGuestDesign`;
- route gửi v2: từ chối v1; lưu `site_estimate_json`; `house` không cần thiết kế hợp lệ.
