# Tài khoản Guest (tuỳ chọn) — plan

Spec: [../specs/guest-accounts.md](../specs/guest-accounts.md). Nháp, chờ duyệt cùng spec.

Mỗi lát chạy được từ đầu tới cuối. Kiểm tra sau mỗi lát: `pnpm --filter @sq/api typecheck`,
`pnpm --filter @sq/site typecheck`, chạy thử qua trình duyệt trên 3063. `pnpm --filter @sq/api test`
cuối cùng (các test hiện có phải còn xanh).

## Ràng buộc chung

- Postgres; placeholder `?`; không `? IS NULL`; id uuid TEXT; thời gian ISO TEXT (CLAUDE.md).
- Migration mới, không sửa file đã chạy. Biến env mới (nếu có) thêm vào `turbo.json` `globalPassThroughEnv`.
- Liên hệ không bao giờ vào localStorage (giữ nguyên quy tắc của `store.ts`).
- Không đổi `placementRules.ts`, giới hạn 15 m, `GUEST_DEFAULT_TYPES`, `needsConfirm`.
- Giữ line ending của từng file (apps/site CRLF, api LF).

## Lát 1 — Tài khoản và phiên (API + bridge + header)

- `packages/db/migrations/024_guest_accounts.sql`: ba bảng và cột `guest_requests.account_id` (spec §Dữ liệu),
  index `guest_drafts (account_id, updated_at)`, `guest_account_sessions (expires_at)`.
- `packages/contracts`: `guestSignUpSchema`, `guestSignInSchema`, `guestProfileSchema`, `GuestProfileView`.
- `apps/api/src/lib/guestAccount.ts`: `createGuestSession(db, accountId) → token`,
  `guestAccountFromRequest(db, request) → account | null` (đọc `sq_guest`, kiểm hạn, gia hạn),
  `endGuestSession`, hằng `GUEST_ACCOUNT_COOKIE = 'sq_guest'`, tuổi 90 ngày.
- `apps/api/src/routes/guestAccount.ts`: sign-up, sign-in, sign-out, `GET`/`PATCH /public/guest/account`,
  `POST …/password`. Rate limit: sign-in 10 / 15 phút theo IP và theo email; sign-up 5 / giờ theo IP.
  Đăng ký trong `app.ts`.
- Bridge site: chuyển tiếp cookie `sq_guest` (vào) và `Set-Cookie: sq_guest` (ra), cạnh `sq_ga`.
- `apps/site/src/app/quote/account.ts`: store nhỏ `useGuestAccount()` (`profile | null`, `loading`),
  `signIn`, `signUp`, `signOut`, `refresh`.
- `components/AccountDialog.tsx` (2 tab) và header: nút Sign in / menu tên khách.
- Kiểm: tạo tài khoản → reload vẫn đăng nhập → sign out → header về Sign in.

## Lát 2 — Bước ① tự điền

- `store.ts`: `prefillContact(profile)` chỉ điền ô trống; gọi khi hồ sơ tải xong hoặc vừa đăng nhập.
  Sign out gọi `set({ contact: EMPTY_CONTACT })`.
- Kiểm: đăng nhập → ① có sẵn tên/mobile/email, sửa được, Next sang ②; gửi đi giá trị đã sửa.

## Lát 3 — Gửi khi đăng nhập, "Sent requests"

- `routes/guest.ts` POST `/public/guest-requests`: có phiên thì ghi `account_id`; `draftId` hợp lệ của
  chính tài khoản thì xoá bản dở đó trong cùng transaction.
- `GET /public/guest/account/requests` (tối đa 100, mới nhất trước; trạng thái khách thấy theo spec).
- Trang `apps/site/src/app/quote/account/page.tsx` (client), tab Details + Sent requests; Open dùng lại
  `reopenSent` của `store.ts` (đã có cho lịch sử localStorage).
- Kiểm: gửi khi đăng nhập → hiện trong hồ sơ và trong admin `/guest-requests`.

## Lát 4 — Bản dở

- `GET/PUT/DELETE /public/guest/account/drafts[/:id]`; PUT upsert theo `(id, account_id)`, id của tài
  khoản khác → 404; giữ 20 bản mới nhất; rate limit 120 / 10 phút theo tài khoản.
- `store.ts`: `draftId` lưu cùng thiết kế trong localStorage; khi đã đăng nhập, debounce 2 s sau thay
  đổi thiết kế/bước thì PUT. Đăng nhập khi đang có thiết kế → PUT ngay. `openDraft(draft)` nạp vào editor.
- Hồ sơ: tab Drafts (Continue, Delete). Gửi thành công → body có `draftId`, `draftId` bị xoá khỏi store.
- Kiểm: tiêu chí 3 và 4 của spec, bằng hai profile trình duyệt.

## Lát 5 — Tài liệu và kiểm cuối

- `docs/DECISIONS.md`: dòng "Guest: email + mật khẩu thay link ma thuật (G-b)".
- `docs/smartquote-quote-editor-reference.md` mục Guest; `docs/OPERATIONS.md` (bảng mới, cách xoá phiên hết hạn).
- `pnpm --filter @sq/api test` và `pnpm test:e2e` phần Guest còn xanh.

## Test (mặc định tắt — đề xuất bật cho phần này)

Đây là phần đăng nhập, rủi ro cao. Nếu bật `tests=on`, thêm vào `apps/api/src/__tests__/`:
- `sq_guest` gọi một route công ty → 401; `sq_session` gọi `/public/guest/account` → 401.
- Tài khoản A đọc / PUT / DELETE bản dở của B → 404; danh sách yêu cầu của A không có yêu cầu của B.
- Sai mật khẩu và email không tồn tại trả cùng mã và cùng câu.
- Gửi khi đăng nhập ghi `account_id` và xoá đúng bản dở.

## Rủi ro cần để ý khi review

- Hai tab cùng đăng nhập sửa cùng bản dở: bản lưu sau thắng (chấp nhận trong v1).
- Đăng xuất ở tab A, tab B vẫn tưởng đang đăng nhập đến lần gọi API kế tiếp (401 → store về `null`).
- Cookie `Secure` chỉ khi https: dev chạy http trên localhost.
