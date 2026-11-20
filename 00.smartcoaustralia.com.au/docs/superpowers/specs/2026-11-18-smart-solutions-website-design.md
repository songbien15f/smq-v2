# Smart Solutions Australia — Website Design Spec (DRAFT)

- **Ngày:** 2026-11-18
- **Trạng thái:** DRAFT — chờ chủ dự án duyệt trước khi lập implementation plan
- **Nguồn giao diện:** `docs/Smart Solutions Australia Website.html`
- **Nguồn tham khảo kỹ thuật:** `D:\Docs\09.OS.nam\mti-website` (Payload CMS v3 + Next.js)

---

## 1. Mục tiêu

Xây website marketing cho Smart Solutions Australia bằng Next.js, quản trị nội dung bằng Payload CMS. Giao diện bám sát template HTML hiện có. Phạm vi CMS chỉ gồm **quản lý nội dung**; menu cố định, không xây menu động.

### Success criteria

1. Đủ 8 trang nội dung + trang chi tiết dự án, hoạt động ở URL thật (không hash route).
2. Toàn bộ text, ảnh, dự án, thành viên, sản phẩm, văn phòng, thông tin liên hệ sửa được trong `/admin` mà không cần deploy lại.
3. Form báo giá và form liên hệ lưu vào database và gửi email thông báo; có validate và chống spam cơ bản.
4. Giao diện đạt parity về layout, màu, typography, responsive và dark mode so với template.
5. `npm run build`, typecheck, lint và Playwright smoke test đều pass.
6. Điểm Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95, SEO ≥ 95 (đo trên build production).

### Non-goals

- Menu động nhiều cấp, menu theo từng trang, theme menu.
- Đa ngữ (site chỉ tiếng Anh).
- Blog, tin tức, nghiên cứu, chuyển giao công nghệ.
- Page builder tự do cho khách (không cho tạo/xoá trang, không cho đổi thứ tự section).
- Upload bản vẽ trong form ở phiên bản 1.
- E-commerce, thanh toán, đăng nhập người dùng cuối.
- Analytics và cookie consent banner ở phiên bản 1.

---

## 2. Phạm vi template

Template là một file HTML 9.2MB chứa React app đã build, dùng hash router. Đã trích xuất:

- CSS: 1 block, 32KB.
- JS inline (router, form, filter, count-up): 18KB.
- React bundle: 1.3MB, nhúng base64.
- Ảnh: 29 ảnh base64, gồm logo 1280×360.
- Dữ liệu 6 dự án nằm trong biến `PROJECTS` của JS inline.

### 2.1 Sitemap

| Route mới | View template | Nội dung |
|---|---|---|
| `/` | home | Hero, 3 stats, 6 chứng nhận, 2 văn phòng, 6 card điều hướng, dự án nổi bật |
| `/capabilities` | capabilities | 7 năng lực, mỗi năng lực có mô tả, bullet, ảnh |
| `/process` | process | 5 bước |
| `/quality` | quality | 8 tài liệu QA, ISO 9001/14001/45001 |
| `/projects` | projects | Dự án nổi bật, grid 6 dự án, filter sector + state |
| `/projects/[slug]` | project-detail | 6 trang chi tiết |
| `/products` | products | 2 nhóm, ~17 sản phẩm |
| `/team` | team | 3 thành viên |
| `/quote` | quote | 3 bước + form báo giá |
| `/contact` | contact | 3 văn phòng, giờ làm việc, bản đồ, form liên hệ |
| `/privacy` | — | Trang mới, soạn theo Privacy Act 1988 (Cth) + APPs (Phụ lục A) |

Menu cố định: Home, Capabilities, Process, Quality, Projects, Products, Team, Contact + CTA "Request a Quote".

### 2.2 Design tokens

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f2f4f9` | `#0a1128` |
| `--surface` | `#ffffff` | `#131e42` |
| `--ink` | `#151d38` | `#ebeffc` |
| `--navy` | `#132c6e` | `#081233` |
| `--accent` | `#e83238` | `#ff5a5f` |
| `--accent-strong` | `#bc1220` | `#ff7d78` |
| `--radius` | `16px` | `16px` |

- Font: Archivo (400–900), load qua `next/font/google`.
- Dark mode: tự động theo `prefers-color-scheme`, không có toggle.
- Toàn bộ token và class của template được port vào `src/styles/site.css`; Tailwind v4 dùng cho layout tiện ích, không thay thế CSS marketing hiện có.

### 2.3 Tương tác phải port

- Sticky header + mobile drawer.
- Reveal animation khi scroll.
- Count-up cho 3 stats ở trang chủ.
- Filter dự án theo sector và state.
- Form validate phía client + trạng thái success/error.
- Sticky sub-nav không có trong template; không thêm.

---

## 3. Kiến trúc kỹ thuật

| Thành phần | Lựa chọn |
|---|---|
| Framework | Next.js 15.4 (App Router) |
| UI | React 19 |
| CMS | Payload CMS 3.88, code-first |
| Database | PostgreSQL 18 qua `@payloadcms/db-postgres`, database `smartcoa` |
| Styling | CSS template port + Tailwind CSS v4 |
| Rich text | Lexical (`@payloadcms/richtext-lexical`) |
| Media | Local disk `media/`, sharp resize |
| Email | SMTP qua Nodemailer |
| Validation | Zod |
| Test | Playwright + `tsc --noEmit` + ESLint |
| Runtime | Node.js ≥ 20.9 |

### 3.1 Cấu trúc thư mục

```text
src/
  app/
    (frontend)/
      layout.tsx
      page.tsx
      capabilities/page.tsx
      process/page.tsx
      quality/page.tsx
      projects/page.tsx
      projects/[slug]/page.tsx
      products/page.tsx
      team/page.tsx
      quote/page.tsx
      contact/page.tsx
      privacy/page.tsx
      api/inquiries/route.ts
      error.tsx
      not-found.tsx
    (payload)/
      admin/...
      api/...
    sitemap.ts
    robots.ts
  collections/
    Users.ts
    Media.ts
    Projects.ts
    TeamMembers.ts
    ProductGroups.ts
    Offices.ts
    Inquiries.ts
  globals/
    SiteSettings.ts
    Header.ts
    Footer.ts
    HomePage.ts
    CapabilitiesPage.ts
    ProcessPage.ts
    QualityPage.ts
    ProjectsPage.ts
    ProductsPage.ts
    TeamPage.ts
    QuotePage.ts
    ContactPage.ts
    PrivacyPage.ts
  components/
    layout/        Header, Footer, MobileNav
    sections/      Hero, Stats, Certifications, OfficeSplit, ExploreCards,
                   CapabilityGrid, ProcessSteps, QaList, ProjectGrid,
                   ProductGroups, TeamGrid, QuoteSteps, ContactOffices,
                   CtaBand, RichText
    forms/         QuoteForm, ContactForm
    ui/            Button, Field, SectionHead, Reveal, CountUp, MapEmbed
  lib/
    payload.ts     Local API wrappers + cache tags
    seo.ts         metadata helpers, JSON-LD
    inquiry.ts     zod schemas, email template
    constants.ts   fixed menu, select options
  styles/
    site.css
  seed/
    index.ts
    content.ts
```

### 3.2 Luồng dữ liệu

1. Server Component gọi hàm trong `lib/payload.ts`, dùng Payload Local API (không HTTP nội bộ).
2. Mỗi hàm bọc `cache()` của React để dedupe trong một request.
3. `afterChange` / `afterDelete` hook gọi `revalidateTag()` theo tag của collection/global tương ứng.
4. Route dự án dùng `generateStaticParams` từ collection `projects`; bài mới được revalidate theo tag khi publish.
5. Form POST tới `/api/inquiries`, validate Zod, ghi collection `inquiries`, gửi email, trả JSON.

### 3.3 Nguyên tắc layout khoá

- 8 trang là 8 route tĩnh, không dùng `[slug]` cho trang nội dung.
- Section trên mỗi trang do component React quyết định thứ tự; CMS chỉ cấp dữ liệu.
- Không có block builder. Thêm/bớt/đổi thứ tự section là thay đổi code.
- Menu là hằng số `MAIN_NAV` trong `lib/constants.ts`; admin chỉ sửa nhãn và CTA.

---

## 4. Content model

### 4.1 Collections

#### `projects`

| Field | Kiểu | Ghi chú |
|---|---|---|
| `title` | text, required | |
| `slug` | text, unique, required | sinh từ title, khoá sau khi publish |
| `location` | text, required | vd "Newcastle, NSW" |
| `state` | select | NSW, QLD, SA, WA, VIC, TAS, NT, ACT, PNG |
| `sector` | select | industrial, agricultural, community |
| `structure` | text | vd "Large-span warehouse frame" |
| `intro` | textarea | dùng cho card và meta description |
| `overview` | rich text | 2–3 đoạn |
| `scope` | array of text | 3–6 bullet |
| `facts` | array `{ label, value }` | khối Project facts |
| `heroImage` | upload → media | |
| `gallery` | array upload → media | max 8 |
| `featured` | checkbox | tối đa 1 bản ghi bật; hook tự tắt bản ghi cũ |
| `order` | number | sắp xếp grid |
| `meta` | group `{ title, description }` | SEO |
| `_status` | drafts + versions | autosave 375ms, max 25 bản |

Access: public read chỉ bản published; admin full.

#### `team-members`

`name`, `role`, `bio` (rich text), `photo` (upload), `initials` (text, fallback), `order`, `_status`.

#### `product-groups`

`title`, `eyebrow`, `description`, `items` array `{ name, description?, image? }`, `order`, `_status`.

#### `offices`

`name`, `countryCode` (AU/VN), `role` (vd "Australian Head Office"), `addressLines` (array text), `phone`, `email`, `hours` array `{ label, value }`, `mapQuery` (địa chỉ tìm trên bản đồ), `directionsUrl`, `order`.

Dùng chung cho trang chủ, Contact và Footer. Không lặp dữ liệu văn phòng ở global.

#### `inquiries`

| Field | Kiểu |
|---|---|
| `type` | select: `quote`, `contact` |
| `status` | select: `new`, `read`, `replied`, `archived` |
| `name`, `company`, `email`, `phone` | text |
| `projectType`, `tonnage`, `siteLocation` | text (chỉ quote) |
| `office`, `enquiryType`, `message` | text/textarea (chỉ contact; `message` dùng cho cả hai) |
| `sourcePath` | text |
| `consent` | checkbox, required |
| `createdAt` | auto |

Access: create public; read/update/delete chỉ admin. Không hiển thị IP hay user-agent để giảm dữ liệu cá nhân.

#### `media`

Upload collection, `alt` bắt buộc, focal point bật, sizes: `thumbnail` 400px, `card` 800px, `hero` 1920px (webp + jpg).

#### `users`

`email`, `password`, `name`, `role` (admin/editor). Chỉ admin tạo user. Editor sửa nội dung, không sửa users/site settings.

### 4.2 Globals

| Global | Nội dung chính |
|---|---|
| `site-settings` | siteName, legalName, tagline, logo, logoDark, favicon, defaultSeo, email, phoneAU, phoneVN, phoneWA, social links, analytics ID (để trống) |
| `header` | 8 nhãn menu cố định, `ctaLabel`, `ctaHref` |
| `footer` | description, compliance items, copyright, modern slavery contact |
| `home-page` | hero, stats×3, certifications, office split, explore cards×6, featured project relation |
| `capabilities-page` | hero, intro, capabilities×7 `{ title, body, features[], image, icon }` |
| `process-page` | hero, steps×5, CTA |
| `quality-page` | hero, intro, image, qaItems×8, management systems |
| `projects-page` | hero, note; nhãn filter và giá trị sector/state là hằng số trong code |
| `products-page` | hero, intro, thứ tự nhóm sản phẩm |
| `team-page` | hero, intro, quote band |
| `quote-page` | hero, steps×3, project type options, tonnage options, online tool link, fallback contact |
| `contact-page` | hero, intro, what-happens-next×3, form options, map section tiêu đề |
| `privacy-page` | rich text (nội dung Phụ lục A) + `lastUpdated` |

Tất cả global đều bật drafts/versions. Nhóm admin: "Trang" cho các trang, "Cấu hình" cho site settings/header/footer.

### 4.3 Dữ liệu seed lấy từ template

- 6 dự án: warehouse-newcastle, feedlot-bega, manufacturing-sa, church-esperance, warehouse-brisbane, industrial-newcastle.
- 3 thành viên: John Walker, Quynh Pham, Lionel Trotman.
- 2 nhóm sản phẩm với ~17 item.
- 3 văn phòng: Sydney, Western Australia (enquiry line), Ho Chi Minh City.
- Toàn bộ copy của 8 trang.
- 29 ảnh base64 tách thành file trong `public/seed/` rồi upload qua seed script vào Media.

---

## 5. Giao diện và component

### 5.1 Layout

- `Header`: logo, 8 link, CTA; sticky; mobile drawer đóng khi đổi route; active state theo pathname.
- `Footer`: mô tả, 2 cột link, compliance list, copyright, modern slavery contact.
- Không có floating contact button (template không có).

### 5.2 Component theo trang

| Trang | Component |
|---|---|
| Home | `HeroHome`, `StatStrip`, `CertificationStrip`, `OfficeSplit`, `ExploreCards`, `FeaturedProject` |
| Capabilities | `PageHero`, `SectionHead`, `CapabilityGrid` |
| Process | `PageHero`, `ProcessSteps`, `CtaBand` |
| Quality | `PageHero`, `QaList`, `ManagementSystems` |
| Projects | `PageHero`, `FeaturedProject`, `ProjectFilterBar` (client), `ProjectGrid` |
| Project detail | `ProjectHero`, `ProjectOverview`, `ScopeList`, `ProjectFacts`, `ProjectGallery` |
| Products | `PageHero`, `ProductGroup` ×2 |
| Team | `PageHero`, `TeamGrid`, `QuoteBand` |
| Quote | `PageHero`, `QuoteSteps`, `QuoteForm` (client) |
| Contact | `PageHero`, `ContactOffices`, `MapEmbed`, `WhatsNext`, `ContactForm` (client) |

### 5.3 Chi tiết hành vi

- Filter dự án lưu trạng thái trên URL (`?sector=industrial&state=NSW`) để share và back/forward đúng; lọc client-side trên dữ liệu đã render.
- Reveal dùng `IntersectionObserver`, tự tắt khi `prefers-reduced-motion: reduce`.
- Count-up chạy một lần khi vào viewport, giữ nguyên số cuối nếu JS lỗi.
- Ảnh dùng `next/image`, `sizes` theo breakpoint, ưu tiên `priority` cho hero.
- Bản đồ: iframe OpenStreetMap embed (miễn phí, không cần API key), kèm link "Get Directions" tới Google Maps.
- Không dùng static map của Facebook.

---

## 6. Form và email

### 6.1 Endpoint

`POST /api/inquiries` — body JSON:

```ts
type QuotePayload = {
  type: 'quote'
  name: string
  company?: string
  email: string
  phone?: string
  projectType: string
  tonnage: string
  siteLocation?: string
  message?: string
  consent: true
  sourcePath: string
}

type ContactPayload = {
  type: 'contact'
  name: string
  company?: string
  email: string
  phone?: string
  office: 'sydney' | 'wa' | 'hcmc'
  enquiryType: string
  message: string
  consent: true
  sourcePath: string
}
```

### 6.2 Xử lý

1. Zod validate; lỗi trả 400 kèm map field → message.
2. Honeypot field ẩn + kiểm tra thời gian submit tối thiểu 2 giây.
3. Rate limit theo IP: 5 request / 10 phút, lưu in-memory (đủ cho single instance). Ghi chú: nếu scale nhiều instance phải chuyển Redis.
4. Lưu `inquiries` với `status: 'new'`.
5. Gửi email tới địa chỉ theo `type`: quote → Sydney, contact → theo office đã chọn. Reply-To là email người gửi.
6. Nếu gửi email lỗi, inquiry vẫn được lưu; response trả 201 kèm cờ `emailSent: false`, UI hiện fallback "email trực tiếp".
7. Trả 201 `{ ok: true }`.

### 6.3 Nội dung email

- Tiêu đề: `[Quote] <name> — <projectType> — <siteLocation>` hoặc `[Contact] <name> — <office>`.
- Body: bảng field + message + sourcePath + link tới bản ghi trong admin.
- Text + HTML, không đính kèm file.

### 6.4 Cấu hình

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO_QUOTE`, `MAIL_TO_CONTACT`. Thiếu SMTP thì log cảnh báo và bỏ qua bước gửi, không làm hỏng submit.

### 6.5 UI

- Validate on blur, thông báo lỗi gắn với field, `aria-invalid` + `aria-describedby`.
- Nút disable khi đang gửi; success panel thay form.
- Giữ dữ liệu người dùng khi lỗi server.

---

## 7. SEO và metadata

- `metadataBase` từ `NEXT_PUBLIC_SERVER_URL`.
- Title template `%s | Smart Solutions Australia`.
- Mỗi trang có `meta.title`, `meta.description`, OG image từ global hoặc ảnh hero.
- `projects/[slug]`: metadata từ project, canonical theo slug.
- `sitemap.ts`: 10 trang (gồm `/privacy`) + toàn bộ project published.
- `robots.ts`: cho phép index, chặn `/admin` và `/api`.
- JSON-LD `Organization` + hai `LocalBusiness` (Sydney, HCMC) với `address`, `telephone`, `openingHours`.
- Ảnh: alt bắt buộc; ảnh trang trí `alt=""`.

---

## 8. Migration từ template

1. Extract CSS 32KB → `src/styles/site.css`, giữ nguyên token và class.
2. Extract 29 ảnh base64 thành file thật trong `public/images/seed/`; đặt tên theo vị trí và alt text (`home-hero.jpg`, `logo.png`, `project-warehouse-newcastle.jpg`, ...). Giữ đúng định dạng MIME gốc (png/jpeg/webp).
3. Dùng chính các ảnh này cho production, không chờ bản gốc. Ghi lại danh sách ảnh có độ phân giải thấp để thay sau nếu khách cung cấp.
4. Seed script upload các file trong `public/images/seed/` vào collection `media`, gắn vào đúng field và alt text của từng trang/dự án.
5. Chuyển markup từng view thành component React, giữ class CSS.
6. Copy toàn bộ text từ template vào seed; không viết lại nội dung.
7. Chuyển `PROJECTS` trong JS thành 6 bản ghi seed.
8. Chuyển `mailto` form thành API + email.
9. Thay bản đồ Facebook bằng OSM iframe.
10. Chuyển hash route thành `Link` của Next. Không cần redirect URL cũ vì đây là site mới, chưa từng được index.

---

## 9. Triển khai

- Triển khai bằng Next standalone + systemd/PM2 trên VPS với PostgreSQL 16+ (local hoặc Docker). Docker Compose tuỳ chọn, gồm `app` + `postgres`.
- Media nằm ở `media/` và là thư mục persistent, không nằm trong image.
- Local dev dùng PostgreSQL 18 sẵn có: `postgresql://postgres:123456@127.0.0.1:5432/smartcoa`.
- `.env.example` khai đủ `DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO_QUOTE`, `MAIL_TO_CONTACT`, `MAIL_ENABLED`. Repo chỉ chứa placeholder; giá trị thật do khách điền sau.
- `MAIL_ENABLED=false` hoặc thiếu `SMTP_HOST` → bỏ qua bước gửi mail, vẫn lưu inquiry và trả success; log warning một lần mỗi process.
- Khi khởi động: chạy `payload migrate` rồi `next start`.
- Backup hằng ngày: `pg_dump -Fc "$DATABASE_URI" > backups/smartcoa-YYYYMMDD.dump` + copy thư mục `media/`.
- Healthcheck: `GET /api/health` trả 200 và kiểm tra DB.
- Không chạy `seed` trên production.
- TLS và domain do khách cung cấp tại thời điểm deploy.

---

## 10. Kiểm thử và tiêu chí nghiệm thu

### Automated

- `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Playwright:
  - 10 route trả 200, không lỗi console.
  - Menu active đúng theo route.
  - Filter dự án đổi kết quả và cập nhật URL.
  - Form quote: submit thiếu field → lỗi; submit hợp lệ → 201 và bản ghi xuất hiện trong admin.
  - Form contact: chọn office → email nhận đúng địa chỉ (kiểm tra qua SMTP test double).
  - Mobile viewport 375px: mở/đóng drawer, không tràn ngang.

### Manual

- So sánh từng trang với template ở 375 / 768 / 1440px, light và dark.
- Keyboard navigation toàn bộ header, form, filter.
- Lighthouse mobile trên production build.

---

## 11. Phases

| Phase | Nội dung | Exit criteria |
|---|---|---|
| 0 | Scaffold Next + Payload, PostgreSQL, media, users, git | `/admin` đăng nhập được, migration chạy sạch |
| 1 | Design system, Header/Footer, Home | Trang chủ parity, responsive, dark mode |
| 2 | 7 trang còn lại + 9 page globals | Mọi text sửa được trong admin |
| 3 | Collections projects/team/products/offices + list/detail/filter | 6 dự án render, filter đúng |
| 4 | Forms + inquiries + email + chống spam | Submit lưu DB, email tới đúng hộp thư |
| 5 | Seed toàn bộ nội dung + ảnh + SEO + privacy | Không còn placeholder, sitemap/robots/JSON-LD đúng |
| 6 | Docker, backup, Playwright, Lighthouse, QA | Build production pass, nghiệm thu |

Ước lượng: 13–20 ngày công, tuỳ chất lượng ảnh gốc và số vòng feedback thiết kế.

---

## 12. Quyết định đã chốt (mặc định khi chưa có phản hồi)

| Vấn đề | Quyết định |
|---|---|
| Content model | Globals typed theo trang + collections cho dữ liệu lặp |
| Database | PostgreSQL 18 local (`smartcoa`), production PostgreSQL 16+ |
| Phạm vi | Full 8 trang ngay từ đầu |
| Ngôn ngữ admin | English |
| Upload bản vẽ | Không có ở v1; hiển thị email để gửi kèm |
| Ảnh | Dùng 29 ảnh base64 hiện có, convert thành file thật trong `public/images/seed/`; thay sau nếu khách có bản gốc |
| Bản đồ | OpenStreetMap iframe + link Google Maps directions |
| Analytics | Không có ở v1 |
| Trang privacy | Có route, nội dung soạn sẵn theo Privacy Act 1988 (Cth) + APPs (Phụ lục A) |
| SMTP | Prepare `.env.example`; mailer tự tắt khi chưa cấu hình, inquiry vẫn lưu DB |

---

## 13. Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| Ảnh base64 bị nén sẵn, mờ khi phóng to | Dùng ảnh hiện có; ghi danh sách ảnh độ phân giải thấp để thay sau, không chặn launch |
| Privacy policy chưa được luật sư rà | Nội dung soạn theo APPs, cấu trúc tham chiếu policy ngành thép Úc; khuyến nghị khách rà trước launch, không chặn triển khai |
| SMTP của khách chưa sẵn sàng | Inquiry vẫn lưu DB; mailer tắt im lặng có log; UI fallback email trực tiếp |
| Spam form | Honeypot + time check + rate limit; nâng cấp captcha nếu vượt ngưỡng |
| Dark mode lệch tương phản | Test AA ở cả hai chế độ; giữ token gốc |
| Thay đổi section cần dev | Ghi rõ trong tài liệu bàn giao; không hứa khách tự thêm section |
| Mất media khi deploy lại | Volume riêng + backup; không build media vào image |
| PostgreSQL local tắt hoặc sai mật khẩu | Kiểm tra service `postgresql-x64-18`, test `psql`, healthcheck trả 503 rõ ràng |

---

## 14. Bàn giao

- Source code + README hướng dẫn chạy local, migrate, seed, deploy.
- Tài khoản admin đầu tiên và hướng dẫn tạo user.
- Tài liệu ngắn: sửa nội dung ở đâu, xuất bản/draft, xem inquiry.
- Docker Compose (tuỳ chọn) + `.env.example`.
- Script backup `pg_dump` + media.
- Bộ Playwright test và checklist nghiệm thu.

---

## Phụ lục A — Nội dung trang Privacy (seed nguyên văn)

Nội dung dưới đây được seed vào global `privacy-page`. Cấu trúc tham chiếu policy của các công ty thép/industrial Úc (InfraBuild, Southern Steel) và tuân theo Privacy Act 1988 (Cth) + Australian Privacy Principles. Khách nên cho luật sư rà lại trước launch, nhưng nội dung đã đủ để publish.

**Last updated:** 18 November 2026

### 1. Who we are

Smart Solutions Australia ("we", "us", "our") is a structural steel specialist. Our head office is in Sydney, Australia, and our office and drafting team are in Ho Chi Minh City, Vietnam. We provide structural steel design, fabrication, inspection, logistics and door-to-door delivery to sites across Australia.

### 2. Scope of this policy

This policy explains how we collect, hold, use, disclose and protect personal information in accordance with the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs). It applies to our website, enquiries, quotations, contracts, project communications and any other dealings with us.

### 3. What personal information we collect

We may collect:

- identity and contact details, such as your name, company, role, email address, phone number and office location;
- project information, such as project type, tonnage, site location, drawings, specifications, delivery requirements and correspondence about a project;
- communications, such as enquiries, quote requests, messages, complaints and records of our responses;
- website usage information, such as IP address, browser type, device type, pages visited, time on site, referring page and cookie identifiers;
- recruitment information, if you apply for a role with us, including your application, qualifications and work history.

We do not collect sensitive information (such as health or biometric information) unless it is required for a lawful purpose and you have consented, or the law otherwise permits it.

### 4. How we collect personal information

We collect personal information:

- directly from you, when you submit a form on our website, email or call us, meet with us, or enter into a contract with us;
- from your representatives, such as architects, engineers, builders and contractors involved in a project;
- from public sources, referees or other people you have authorised, where relevant;
- automatically through cookies, server logs and similar technologies when you use our website.

If you provide personal information about another person, you must be authorised to do so and ensure that person is aware of this policy.

### 5. Why we use personal information

We use personal information to:

- respond to enquiries and prepare quotations;
- provide structural steel design, fabrication, inspection, logistics and related services;
- manage contracts, deliveries, invoicing, warranties and project records;
- communicate with you about a project and respond to complaints;
- improve our website, services and customer experience;
- comply with legal, tax, insurance, work health and safety, and record-keeping obligations;
- protect against fraud, misuse and security incidents.

If you do not provide information we reasonably require, we may not be able to respond to your enquiry or provide our services.

### 6. Cookies and website usage

We use essential cookies to operate our website. We may also use aggregate analytics to understand how the site is used and to improve it. We do not use cookies for third-party advertising.

You can block or delete cookies through your browser settings. If you disable cookies, some parts of the website may not work as intended.

### 7. Disclosure of personal information

We may disclose personal information to:

- our related office and drafting team in Vietnam;
- fabrication partners, subcontractors and suppliers involved in your project;
- freight, logistics, shipping and customs providers;
- IT, hosting, email, document management and professional service providers;
- our professional advisers, including lawyers, accountants, insurers and auditors;
- government authorities, courts and regulators where required or authorised by law;
- a buyer or successor in the event of a business sale or restructure.

We do not sell or rent personal information.

### 8. Overseas disclosure

Our office and drafting team are located in Vietnam, and some of our service providers may store or process information outside Australia. Where we disclose personal information overseas, we take reasonable steps to ensure the recipient handles it consistently with the APPs, and we rely on your consent where appropriate.

Overseas laws may not provide the same level of protection as Australian law. If you have questions about an overseas disclosure, contact our Privacy Officer.

### 9. Security of personal information

We take reasonable technical and organisational steps to protect personal information, including access controls, role-based permissions, staff confidentiality obligations, secure storage and destruction or de-identification when information is no longer needed.

No method of transmission over the internet or electronic storage is completely secure, and we cannot guarantee absolute security.

### 10. Retention

We retain personal information only for as long as it is needed for the purpose for which it was collected, for our contractual and legal obligations (including tax, insurance, work health and safety and project record requirements), or as required by law. When information is no longer required, we destroy or de-identify it within a reasonable period.

### 11. Access and correction

You may request access to the personal information we hold about you, or ask us to correct information that is inaccurate, incomplete or out of date, by contacting our Privacy Officer.

We will respond within a reasonable period, usually within 30 days. We may refuse access where the law permits us to do so, and we will explain the reason for any refusal.

### 12. Direct marketing

We may send you project updates or information about our services where you have consented or where the law permits. You can opt out at any time using the unsubscribe link in a message or by contacting us. We do not sell or rent contact lists.

### 13. Complaints

If you believe we have breached the APPs or handled your personal information incorrectly, please contact our Privacy Officer with details of your concern. We will acknowledge your complaint and investigate it, usually within 30 days.

If you are not satisfied with our response, you may contact the Office of the Australian Information Commissioner (OAIC):

- Website: https://www.oaic.gov.au
- Phone: 1300 363 992

### 14. Links to other websites

Our website may link to third-party websites. We are not responsible for the privacy practices, content or security of those websites. We encourage you to read their privacy policies.

### 15. Changes to this policy

We may update this policy from time to time. The current version is published on this page and the "Last updated" date is revised. Continued use of our website or services after a change means you accept the updated policy.

### 16. Contact us

Privacy Officer
Smart Solutions Australia
Level 29, 66 Goulburn St
Sydney NSW 2000, Australia

- Email: info@smartsolutionsaustralia.com.au
- Phone: +61 412 239 259 (Australia)
- Phone: +84 908 275 404 (Vietnam)
