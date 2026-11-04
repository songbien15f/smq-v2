# Quote editor parity — Implementation plan, slice 1–2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa tầng domain của editor về đúng mô hình desktop (10 vai trò màu, trường cấu hình mới, migration bản ghi cũ) và dựng tầng catalogue đọc từ sách giá.

**Architecture:** `packages/core/src/domain` là nguồn sự thật duy nhất cho hình dạng dữ liệu; mọi bản ghi cũ đi qua `normaliseShedConfig` và một hàm migrate thuần. Catalogue là interface thuần + adapter SQLite đặt cạnh `createLookup`, nên test chạy không cần sách giá thật.

**Tech Stack:** TypeScript 5.9 strict · zod 4 · vitest 5 · `node:sqlite` · Fastify 5.

**Spec:** `docs/superpowers/specs/2026-11-03-quote-editor-parity-design.md`

## Global Constraints

- Trao đổi với operator bằng **tiếng Việt**; tên code/định danh giữ nguyên tiếng Anh.
- Không commit `.env`, `data/`, `tools/price-dump/out/` — dữ liệu giá là tài sản có bản quyền.
- Tiền là **số nguyên cents**; kích thước là **số nguyên mm**. Không dùng `float` cho tiền.
- `normaliseShedConfig` **không bao giờ throw**; đầu vào xấu trả về default.
- `packages/core` không import HTTP/tenant. Truy cập sách giá theo đúng pattern hiện có trong `packages/core/src/lib/pricing/`.
- `@sq/contracts` được tiêu thụ từ `dist` — sau khi sửa phải chạy `npx turbo run build --filter=@sq/contracts` trước khi test API.
- Revision bất biến: **không** ghi lại revision cũ; migrate chỉ ở lúc đọc.

## Review Focus

1. **Revision cũ 4 vai trò màu** — mở lên phải giữ nguyên ngoại hình (trim cũ vừa là barge, vừa là gutter/downpipe; door cũ là mọi loại cửa). Test: `migrateColors` + một object revision cũ qua `normaliseShedConfig`.
2. **Revision cũ thiếu trường mới** — phải được điền default, không bị bỏ quote. Test trong `migrateShedConfig`.
3. **Sách giá thiếu bảng catalogue** (bản dump cũ) — endpoint trả danh sách rỗng, không 500.
4. **`nomBaySpacing` không khớp `length × bays`** — phải tạo validation issue, không tự làm tròn im lặng.
5. **Chưa publish sách giá** — endpoint trả lỗi rõ ràng (không có book), không crash.

---

# Slice 1 — Domain

## Task 1: `ShedColors` 10 vai trò, end to end

**Files:**
- Modify: `packages/core/src/domain/types.ts` (`ShedColors`, khoảng dòng 88–93)
- Create: `packages/core/src/domain/colors.ts`
- Modify: `packages/core/src/domain/defaults.ts` (`DEFAULT_SHED.colors`, khoảng 101–109)
- Modify: `packages/core/src/domain/schema.ts` (colors trong `shedConfigSchema` khoảng 492–497 và `tolerantShedConfigSchema` khoảng 523–530)
- Modify: `packages/core/src/domain/index.ts` (export `colors.ts`)
- Modify: `packages/core/src/lib/bom/openings.ts:109`
- Modify: `packages/core/src/lib/bom/groups/gutter.ts:116,157`
- Modify: `packages/core/src/lib/bom/groups/fixings.ts:127-128`
- Modify: `packages/core/src/lib/documents/projection.ts:274-277`
- Modify: `apps/client/src/components/editor/Shed3D.tsx:401,418,442,451,485`
- Modify: `apps/client/src/components/editor/validation.ts:69,215`
- Modify: `apps/client/src/components/editor/QuoteDetailsPanel.tsx:621-626`
- Test: `packages/core/src/domain/__tests__/colors.test.ts`

**Interfaces:**
- Produces: `interface ShedColors { wall; roof; barge; downpipe; gutter; window; paDoor; rollerDoor; slidingDoor; dividingWall }` — tất cả `string` hex.
- Produces: `const COLOUR_ROLES: readonly (keyof ShedColors)[]` — đúng 10 phần tử, thứ tự trên.
- Produces: `function migrateColors(input: unknown): ShedColors`
- Produces: `function doorColour(colours: ShedColors, type: OpeningType): string`

- [ ] **Step 1: Viết test thất bại**

`packages/core/src/domain/__tests__/colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { COLOUR_ROLES, doorColour, migrateColors } from '../colors';

describe('migrateColors', () => {
  it('giữ nguyên ngoại hình của bản ghi 4 vai trò cũ', () => {
    const c = migrateColors({ wall: '#111111', roof: '#222222', trim: '#333333', door: '#444444' });
    expect(c.wall).toBe('#111111');
    expect(c.roof).toBe('#222222');
    expect([c.barge, c.gutter, c.downpipe]).toEqual(['#333333', '#333333', '#333333']);
    expect([c.window, c.paDoor, c.rollerDoor, c.slidingDoor]).toEqual([
      '#444444', '#444444', '#444444', '#444444',
    ]);
  });

  it('trả default cho đầu vào không đọc được', () => {
    expect(migrateColors(null)).toEqual(DEFAULT_SHED.colors);
    expect(migrateColors({ wall: 42 })).toEqual(DEFAULT_SHED.colors);
  });

  it('mọi vai trò đều có trong default', () => {
    expect(COLOUR_ROLES).toHaveLength(10);
    for (const role of COLOUR_ROLES) {
      expect(DEFAULT_SHED.colors[role]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('doorColour', () => {
  it('chọn vai trò theo loại cửa', () => {
    const c = DEFAULT_SHED.colors;
    expect(doorColour(c, 'window')).toBe(c.window);
    expect(doorColour(c, 'pa_door')).toBe(c.paDoor);
    expect(doorColour(c, 'sliding_door')).toBe(c.slidingDoor);
    expect(doorColour(c, 'roller_door')).toBe(c.rollerDoor);
    expect(doorColour(c, 'opening')).toBe(c.wall);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó fail**

Run: `pnpm --filter @sq/core test -- colors`
Expected: FAIL — `Cannot find module '../colors'`.

- [ ] **Step 3: Tạo `packages/core/src/domain/colors.ts`**

Hai hàm thuần. `migrateColors` nhận cả shape mới lẫn shape cũ; `source.trim` là fallback cho
`barge`/`gutter`/`downpipe`, `source.door` là fallback cho bốn loại cửa. Mọi giá trị không phải hex
hợp lệ rơi về default.

- [ ] **Step 4: Đổi `ShedColors` trong `types.ts` thành 10 khoá** (bỏ `trim`, `door`).

- [ ] **Step 5: Sửa `defaults.ts`** — `DEFAULT_SHED.colors` có đủ 10 khoá:
  `wall: Shale Grey`, `roof: Surfmist`, `barge: Surfmist`, `gutter: Surfmist`,
  `downpipe: Surfmist`, `window: Monument`, `paDoor: Monument`, `rollerDoor: Monument`,
  `slidingDoor: Monument`, `dividingWall: Surfmist`.

- [ ] **Step 6: Sửa hai schema trong `schema.ts`** — `shedConfigSchema.colors` và
  `tolerantShedConfigSchema.colors` liệt kê đủ 10 khoá với cùng `.catch(DEFAULT_SHED.colors.<role>)`.

- [ ] **Step 7: Sửa consumer theo đúng vai trò**

- `openings.ts`: thay `isPainted(shed.colors.door, lookup)` bằng
  `isPainted(doorColour(shed.colors, opening.type), lookup)`.
- `gutter.ts`: hai chỗ `shed.colors.trim` → `shed.colors.gutter` (dòng gutter) và
  `shed.colors.downpipe` (dòng downpipe) theo đúng nhóm đang dựng.
- `fixings.ts`: giữ `roof`/`wall` (đã đúng).
- `projection.ts`: dòng `trim` → `barge`, `door` → `rollerDoor`; thêm 6 dòng còn lại vào projection
  với label lấy từ `COLOUR_ROLES` (việc mở rộng bảng màu trên PDF hoàn tất ở slice 8).
- `Shed3D.tsx`: `trim` → `barge`.
- `validation.ts`: `REQUIRED_COLOUR_ROLES` = `COLOUR_ROLES` (10 vai trò).
- `QuoteDetailsPanel.tsx`: bỏ mảng 4 khoá cục bộ, import `COLOUR_ROLES` và render đủ 10 swatch grid
  với label tiếng Anh như desktop.

- [ ] **Step 8: Chạy test + typecheck**

Run: `pnpm --filter @sq/core test -- colors`
Expected: PASS.

Run: `pnpm --filter @sq/core typecheck && pnpm --filter @sq/client typecheck`
Expected: PASS, 0 error. Nếu còn lỗi ở fixture, sửa fixture bằng cách spread `DEFAULT_SHED`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/domain packages/core/src/lib apps/client/src/components/editor
git commit -m "feat(domain): expand ShedColors to the desktop's ten roles"
```

---

## Task 2: Trường `ShedConfig` mới + `reconcileBays`

**Files:**
- Modify: `packages/core/src/domain/types.ts` (`ShedConfig`)
- Modify: `packages/core/src/domain/defaults.ts` (`DEFAULT_SHED`)
- Modify: `packages/core/src/domain/bays.ts`
- Modify: `packages/core/src/domain/schema.ts` (`tolerantShedConfigSchema`)
- Test: `packages/core/src/domain/__tests__/bays.test.ts` (thêm case)
- Test: `packages/core/src/domain/__tests__/config-fields.test.ts`

**Interfaces:**
- Produces: các trường `ShedConfig`: `wallProfile: string`, `roofProfile: string`,
  `downpipeType: string`, `footingType: string`, `footingSubType: string`,
  `nomBaySpacing: number`, `endOpening: { left: boolean; right: boolean }`,
  `sideOpening: { front: boolean; back: boolean }`, `buildingClass: string | null`,
  `snowLoad: number | null`, `designWindSpeed: number | null`.
- Produces: `function reconcileBays(input: { length: number; bays: number; nomBaySpacing: number }): { length: number; bays: number; nomBaySpacing: number }`
- Produces: `function baySpacingMismatch(config: Pick<ShedConfig, 'length'|'bays'|'nomBaySpacing'>): boolean`

- [ ] **Step 1: Viết test thất bại**

`packages/core/src/domain/__tests__/config-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { baySpacingMismatch, reconcileBays } from '../bays';
import { normaliseShedConfig } from '../schema';

describe('reconcileBays', () => {
  it('tính bays và spacing từ length', () => {
    expect(reconcileBays({ length: 24000, bays: 4, nomBaySpacing: 0 }))
      .toEqual({ length: 24000, bays: 4, nomBaySpacing: 6000 });
  });

  it('tính length từ spacing × bays', () => {
    const r = reconcileBays({ length: 0, bays: 6, nomBaySpacing: 5000 });
    expect(r.length).toBe(30000);
    expect(r.bays).toBe(6);
    expect(r.nomBaySpacing).toBe(5000);
  });

  it('báo lệch khi spacing × bays khác length', () => {
    expect(baySpacingMismatch({ length: 24000, bays: 4, nomBaySpacing: 5000 })).toBe(true);
    expect(baySpacingMismatch({ length: 24000, bays: 4, nomBaySpacing: 6000 })).toBe(false);
  });
});

describe('normaliseShedConfig với trường mới', () => {
  it('điền default cho config cũ thiếu hết', () => {
    const c = normaliseShedConfig({ span: 9000, length: 18000, bays: 3 });
    expect(c.span).toBe(9000);
    expect(c.nomBaySpacing).toBe(6000);
    expect(c.wallProfile).toBe(DEFAULT_SHED.wallProfile);
    expect(c.footingType).toBe(DEFAULT_SHED.footingType);
    expect(c.endOpening).toEqual({ left: false, right: false });
    expect(c.buildingClass).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó fail**

Run: `pnpm --filter @sq/core test -- config-fields`
Expected: FAIL — `reconcileBays is not a function`.

- [ ] **Step 3: Thêm hai hàm vào `bays.ts`**

`reconcileBays`: nếu `bays > 0 && nomBaySpacing > 0` → `length = nomBaySpacing × bays`; ngược lại
`nomBaySpacing = Math.floor(length / clampBays(bays))`. `baySpacingMismatch` = `nomBaySpacing > 0 &&
nomBaySpacing * bays !== length`.

- [ ] **Step 4: Thêm trường vào `ShedConfig` + `DEFAULT_SHED`**

Default: `wallProfile: 'Corro'`, `roofProfile: 'Corro'`, `downpipeType: ''`, `footingType: ''`,
`footingSubType: ''`, `nomBaySpacing: Math.floor(24000 / 4)` (= 6000), `endOpening`/`sideOpening`
false, ba trường ShedSafe `null`.

- [ ] **Step 5: Thêm vào `tolerantShedConfigSchema`** — mỗi trường `.catch(DEFAULT_SHED.<field>)`;
  `endOpening`/`sideOpening` là object boolean với `.catch(...)`; `buildingClass`/`snowLoad`/
  `designWindSpeed` dùng `z.union([...]).nullable().catch(null)`.
  Trong `normaliseShedConfig`, sau khi parse: `nomBaySpacing = parsed.nomBaySpacing > 0 ? parsed.nomBaySpacing : Math.floor(finalShed.length / finalShed.bays)`.

- [ ] **Step 6: Chạy test + typecheck**

Run: `pnpm --filter @sq/core test -- config-fields bays`
Expected: PASS.

Run: `pnpm --filter @sq/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/domain
git commit -m "feat(domain): add the desktop's design and shed parameters"
```

---

## Task 3: Migration bản ghi cũ + `migrateShedConfig`

**Files:**
- Modify: `packages/core/src/domain/schema.ts` (`normaliseShedConfig`)
- Modify: `packages/core/src/domain/index.ts`
- Test: `packages/core/src/domain/__tests__/migrate.test.ts`

**Interfaces:**
- Consumes: `migrateColors` (Task 1), `reconcileBays` (Task 2).
- Produces: `function migrateShedConfig(input: unknown): ShedConfig` — alias của
  `normaliseShedConfig`, tên dùng ở biên đọc revision.

- [ ] **Step 1: Viết test thất bại**

`packages/core/src/domain/__tests__/migrate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHED } from '../defaults';
import { migrateShedConfig } from '../schema';

describe('migrateShedConfig', () => {
  it('đọc được revision cũ 4 vai trò màu, giữ ngoại hình', () => {
    const old = {
      structureType: 'gable', span: 12000, length: 24000, height: 4200,
      roofPitchDeg: 10, bays: 4, openings: [], options: [], charges: [],
      internalPressure: 'closed', windRegion: 'A', terrainCategory: 2.5,
      shieldingFactor: 1, importanceLevel: 1, topographyFactor: 1,
      stateCode: 'QLD', displayUnit: 'm',
      colors: { wall: '#111111', roof: '#222222', trim: '#333333', door: '#444444' },
    };
    const c = migrateShedConfig(old);
    expect(c.colors.wall).toBe('#111111');
    expect(c.colors.gutter).toBe('#333333');
    expect(c.colors.rollerDoor).toBe('#444444');
    expect(c.colors.barge).toBe('#333333');
  });

  it('điền trường mới cho revision cũ thiếu', () => {
    const c = migrateShedConfig({ span: 9000, length: 18000, bays: 3 });
    expect(c.wallProfile).toBe(DEFAULT_SHED.wallProfile);
    expect(c.nomBaySpacing).toBe(6000);
    expect(c.sideOpening).toEqual({ front: false, back: false });
  });

  it('không throw với đầu vào rác', () => {
    expect(migrateShedConfig('not a config').span).toBe(DEFAULT_SHED.span);
    expect(migrateShedConfig(null).bays).toBe(DEFAULT_SHED.bays);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó fail**

Run: `pnpm --filter @sq/core test -- migrate`
Expected: FAIL — `migrateShedConfig is not a function`.

- [ ] **Step 3: Sửa `normaliseShedConfig`**

Trước khi gọi `tolerantShedConfigSchema.parse(rest)`, thay `rest.colors` bằng
`migrateColors(rest.colors)`. Sau khi parse, tính `nomBaySpacing` như Task 2 Step 5.
Export thêm `export const migrateShedConfig = normaliseShedConfig;` (hoặc một hàm gọi lại, kèm
doc-comment nói rõ nó là biên đọc revision cũ).

- [ ] **Step 4: Chạy test**

Run: `pnpm --filter @sq/core test -- migrate config-fields colors`
Expected: PASS.

- [ ] **Step 5: Chạy toàn bộ test core**

Run: `pnpm --filter @sq/core test`
Expected: PASS. Sửa fixture nếu có test dựa vào `colors.trim`/`colors.door`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain
git commit -m "feat(domain): migrate pre-parity revisions at read time"
```

---

# Slice 2 — Catalogue

## Task 4: `CatalogueSource` + adapter SQLite

**Files:**
- Create: `packages/core/src/lib/pricing/catalogues.ts`
- Modify: `packages/core/src/lib/pricing/index.ts` (export)
- Test: `packages/core/src/lib/pricing/__tests__/catalogues.test.ts`

**Interfaces:**
- Produces: `interface Catalogue` với các mảng:
  `colours: { name: string; hex: string }[]`,
  `miscOptions: { name: string; code: string; unit: string }[]`,
  `engineeringCharges: { name: string; code: string; unit: string }[]`,
  `structureOptions: { code: string; name: string; description: string; displayPriority: number; min: number | null; defaultValue: number | null; max: number | null }[]`,
  `windRegions: { value: string; label: string }[]`,
  `terrainCategories: { value: string; label: string }[]`,
  `importanceLevels: { value: string; label: string }[]`,
  `profiles: { profile: string; description: string; bmt: number; isWall: boolean; isRoof: boolean }[]`,
  `footingTypes: { code: string; label: string }[]`,
  `footingSubTypes: { code: string; label: string }[]`,
  `deliveryScopes: { name: string; value: number; indexOrder: number; stateValues: Record<string, number> | null }[]`,
  `spanHints: number[]`, `heightHints: number[]`, `roofPitchHints: number[]`, `bayHints: number[]`.
- Produces: `interface CatalogueSource { load(): Catalogue }`
- Produces: `function createSqliteCatalogueSource(db: DatabaseSync): CatalogueSource`

- [ ] **Step 1: Viết test thất bại**

`packages/core/src/lib/pricing/__tests__/catalogues.test.ts` — dùng một SQLite in-memory
(`new DatabaseSync(':memory:')`) tạo đúng các bảng cần thiết với 2–3 dòng mỗi bảng:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteCatalogueSource } from '../catalogues';

function emptyBook(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE system_colour (colour_name TEXT, colour_value TEXT, colour_status INTEGER);
    CREATE TABLE misc_option (option_name TEXT, product_code TEXT, price REAL, unit TEXT, type TEXT, indexSort INTEGER);
    CREATE TABLE system_structure_option (code TEXT, name TEXT, description TEXT, display_priority INTEGER, min_value REAL, default_value REAL, max_value REAL, is_active INTEGER);
  `);
  return db;
}

describe('createSqliteCatalogueSource', () => {
  it('đọc màu đang bật', () => {
    const db = emptyBook();
    db.exec(`INSERT INTO system_colour VALUES ('Shale Grey','#bcbdc0',1),('Old','#000000',0)`);
    expect(createSqliteCatalogueSource(db).load().colours).toEqual([
      { name: 'Shale Grey', hex: '#bcbdc0' },
    ]);
  });

  it('tách misc khỏi engineering theo type', () => {
    const db = emptyBook();
    db.exec(`INSERT INTO misc_option VALUES
      ('Insulation','INS',12.5,'m','MicsellaneousOptions',1),
      ('Engineering QLD','ENG',99,'ea','EngineeringCharges',2)`);
    const c = createSqliteCatalogueSource(db).load();
    expect(c.miscOptions.map((o) => o.name)).toEqual(['Insulation']);
    expect(c.engineeringCharges.map((o) => o.name)).toEqual(['Engineering QLD']);
  });

  it('trả rỗng khi sách giá thiếu bảng', () => {
    const db = new DatabaseSync(':memory:');
    const c = createSqliteCatalogueSource(db).load();
    expect(c.colours).toEqual([]);
    expect(c.structureOptions).toEqual([]);
    expect(c.spanHints).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó fail**

Run: `pnpm --filter @sq/core test -- catalogues`
Expected: FAIL — `Cannot find module '../catalogues'`.

- [ ] **Step 3: Viết `catalogues.ts`**

Mỗi bảng đọc bằng một `try/catch` riêng để thiếu bảng trả `[]` (Review Focus #3). Truy vấn:

| Catalogue | Nguồn | Lọc / sắp xếp |
|---|---|---|
| `colours` | `system_colour` | `colour_status = 1`, `ORDER BY colour_index` |
| `miscOptions` | `misc_option` | `type = 'MicsellaneousOptions'`, `ORDER BY indexSort` |
| `engineeringCharges` | `misc_option` | `type = 'EngineeringCharges'`, `ORDER BY indexSort` |
| `structureOptions` | `system_structure_option` | `is_active = 1`, `ORDER BY display_priority` |
| `windRegions` | `design_wind_region` | `is_active = 1`, `ORDER BY index_sort` |
| `terrainCategories` | `design_terrain_category` | `is_active = 1`, `ORDER BY index_sort` |
| `importanceLevels` | `design_importance_level` | `is_active = 1`, `ORDER BY index_sort` |
| `profiles` | `material_sheeting` | `is_active = 1`, `ORDER BY index_sort` |
| `footingTypes` | `shed_footing_type` | `is_active = 1`, `ORDER BY index_sort` |
| `footingSubTypes` | `shed_footing_sub_type` | `is_active = 1`, `ORDER BY index_sort` |
| `deliveryScopes` | `delivery_data` | `status = 1`, `ORDER BY index_order`; parse `state_value_array` dạng `"NSW:123;VIC:456;"` thành record |
| `spanHints` | `shed_hint_span` | `hint_value` |
| `heightHints` | `shed_hint_height` | `hint_value` |
| `roofPitchHints` | `shed_hint_roof_pitch` | `hint_value` |
| `bayHints` | `shed_hint_bay` | `hint_value` |

- [ ] **Step 4: Chạy test**

Run: `pnpm --filter @sq/core test -- catalogues`
Expected: PASS.

- [ ] **Step 5: Chạy toàn bộ test core + typecheck**

Run: `pnpm --filter @sq/core test && pnpm --filter @sq/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lib/pricing
git commit -m "feat(pricing): read the studio catalogues from the price book"
```

---

## Task 5: `GET /price-books/:id/catalogues`

**Files:**
- Modify: `apps/api/src/lib/priceBook.ts` (thêm `openBookDatabase`)
- Create: `apps/api/src/routes/catalogues.ts`
- Modify: `apps/api/src/app.ts` (đăng ký route)
- Test: `apps/api/src/__tests__/cataloguesRoute.test.ts`

**Interfaces:**
- Consumes: `createSqliteCatalogueSource` (Task 4), `requireCompanyCapability`, `sendOk`, `sendFail`, `activeBookHash`, `openBookDatabase`.
- Produces: `function openBookDatabase(hash: string): DatabaseSync`
- Produces: `function registerCatalogues(app: FastifyInstance, db: Db): void`
- Endpoint: `GET /price-books/:id/catalogues` — `:id` là hash 64 ký tự hoặc `active`;
  trả `{ bookHash, catalogue }`.

- [ ] **Step 1: Viết test thất bại**

`apps/api/src/__tests__/cataloguesRoute.test.ts` — dựng app test như các test route hiện có
(`apps/api/src/__tests__/pricing.test.ts` làm mẫu), publish một book tối thiểu, gọi
`GET /price-books/active/catalogues` với cookie hợp lệ, khẳng định 200 và `catalogue.colours`
có phần tử. Thêm case thứ hai: chưa publish book → 503 `not_configured`; `:id` là hash không có
trên đĩa → 409 `conflict`. Không case nào được 500.

- [ ] **Step 2: Chạy test để thấy nó fail**

Run: `pnpm --filter @sq/api test -- cataloguesRoute`
Expected: FAIL — 404 route not found.

- [ ] **Step 3: Thêm `openBookDatabase`**

Trong `priceBook.ts`, export hàm trả `openBooks.get(hash)?.db` sau khi gọi `openBook(hash)` để bảo
đảm đã mở; nếu chưa có thì mở rồi trả `db`. Không đóng handle (book bất biến, giống `openBook`).

- [ ] **Step 4: Viết route**

`registerCatalogues(scope, db)`:

```ts
scope.get('/price-books/:id/catalogues', async (request, reply) => {
  const session = requireCompanyCapability(request, reply, 'quote:read');
  if (session === null) return reply;
  const id = (request.params as { id: string }).id;
  const hash = id === 'active' ? await activeBookHash(db) : id;
  if (hash === null) {
    return sendFail(reply, 'not_configured', 'No price book has been published yet.');
  }
  try {
    const catalogue = createSqliteCatalogueSource(openBookDatabase(hash)).load();
    return sendOk(reply, { bookHash: hash, catalogue });
  } catch (error) {
    if (error instanceof BookMissingError) return sendFail(reply, 'conflict', error.message);
    throw error;
  }
});
```

`sendFail` nhận `ErrorCode`, không phải HTTP status: `not_configured` → 503, `conflict` → 409.

- [ ] **Step 5: Đăng ký route trong `app.ts`**

Thêm import và `registerCatalogues(scope, db);` cạnh `registerPriceBooks`.

- [ ] **Step 6: Chạy test**

Run: `npx turbo run build --filter=@sq/contracts && pnpm --filter @sq/api test -- cataloguesRoute`
Expected: PASS.

- [ ] **Step 7: Chạy toàn bộ test API**

Run: `pnpm --filter @sq/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): expose the price book catalogues to the editor"
```

---

## Self-review

**Spec coverage (slice 1–2):**

| Spec § | Task |
|---|---|
| 5.2 `ShedColors` 10 vai trò | Task 1 |
| 5.1 trường `ShedConfig` mới | Task 2 |
| 5.1 thứ tự `nomBaySpacing` | Task 2, Task 3 |
| 10 `migrateShedConfig` | Task 3 |
| 4.2 `CatalogueSource` | Task 4 |
| 8.1 `GET /price-books/:id/catalogues` | Task 5 |
| 11 unit tests domain/catalogue | Task 1–4 |

Ngoài phạm vi plan này (slice 3–8): 4 `OptionKind` mới, rule engine, layout, Step 1/2/3 UI,
PDF/BOM parity, golden test.

**Type consistency:** `migrateColors`/`doorColour` (Task 1) được dùng ở Task 1 Step 7 và Task 3;
`reconcileBays`/`baySpacingMismatch` (Task 2) được dùng ở Task 3; `Catalogue` (Task 4) được dùng ở
Task 5. Không có tên trùng nghĩa.

**Review Focus → test:** mỗi mục 1–5 có test ở Task 1 (`colors.test.ts`), Task 3
(`migrate.test.ts`), Task 4 (`catalogues.test.ts`), Task 2 (`config-fields.test.ts`), Task 5
(`cataloguesRoute.test.ts`).
