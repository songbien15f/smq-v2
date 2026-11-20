# Tài khoản Guest (tuỳ chọn) — spec

Trạng thái: **nháp, chờ duyệt** · 2026-11-20 · thay phần "link ma thuật" của lát G-b trong
[quote-tiers-guest.md](quote-tiers-guest.md) (xem "Quyết định" bên dưới).

## Mục tiêu

Trang Guest (`apps/site` `/quote`) có hai chế độ, cả hai đều gửi được yêu cầu báo giá:

1. **Vãng lai** — như hiện tại: không cần tài khoản, thiết kế rồi gửi. Lịch sử 5 yêu cầu gần nhất
   vẫn nằm trong localStorage của trình duyệt (`sentHistory.ts`).
2. **Đăng nhập** — ai muốn thì tạo tài khoản nhanh hoặc đăng nhập. Khi đó:
   - **Hồ sơ** có: thông tin liên hệ (sửa được), các yêu cầu **đã gửi**, các thiết kế **làm dở**.
   - Bước ① tự điền tên / mobile / email từ hồ sơ. Khách vẫn sửa được trước khi bấm Next sang bước
     thiết kế; sửa ở bước ① **không** đổi hồ sơ.
   - Thiết kế đang làm được lưu lên server, nên mở lại được trên máy khác.

Không bắt buộc đăng nhập ở bất kỳ bước nào.

## Quyết định

- **Đăng nhập bằng email + mật khẩu**, không dùng link ma thuật. Lý do: tạo xong dùng được ngay,
  không phụ thuộc mail (môi trường dev không gửi mail thật). Ghi một dòng vào `docs/DECISIONS.md`.
- **Tài khoản là bảng riêng `guest_accounts`**, không gắn mật khẩu vào `guest_contacts`.
  `guest_contacts` được tạo theo email mà bất kỳ ai cũng gõ được khi gửi vãng lai, nên "đã có dòng
  với email này" không chứng minh ai là chủ.
- **Không tự nhận các yêu cầu vãng lai cũ** cùng email vào tài khoản. Lý do như trên: chưa xác thực
  email thì người tạo tài khoản bằng email người khác sẽ đọc được yêu cầu của họ. Hồ sơ chỉ chứa yêu
  cầu gửi **khi đang đăng nhập**. Danh sách localStorage của trình duyệt vẫn hiện như cũ.
- Email chưa xác thực trong v1. Admin vẫn thấy nhãn "email chưa xác nhận" như hiện tại.

## Hành vi

### Header
- Chưa đăng nhập: pill "Guest session — no sign-up needed" giữ nguyên, thêm nút **Sign in**.
- Đã đăng nhập: thay pill bằng tên khách + menu: **My profile**, **Sign out**.

### Đăng nhập / tạo tài khoản (hộp thoại trên trang, không rời thiết kế đang làm)
- Hai tab: **Sign in** (email, mật khẩu) · **Create account** (họ, tên, mobile AU, email, mật khẩu ≥ 8 ký tự).
- Tạo tài khoản xong là đã đăng nhập.
- Sai email hoặc mật khẩu: một câu chung "Email or password is incorrect", không lộ email nào tồn tại.
- Email đã có tài khoản khi tạo mới: "An account with this email already exists — sign in instead".
  (Câu này lộ sự tồn tại của tài khoản; chấp nhận được vì có rate limit, giống hầu hết trang thương mại.)
- Đăng nhập khi đang có thiết kế dở trên máy: thiết kế đó trở thành một bản dở của tài khoản.

### Bước ① khi đã đăng nhập
- Ô liên hệ trống thì điền từ hồ sơ (một lần mỗi lần vào trang, hoặc khi vừa đăng nhập). Ô khách đã gõ
  thì không ghi đè.
- Khách sửa thoải mái rồi Next; giá trị gửi đi là giá trị trên form.

### Bản dở (draft)
- Đã đăng nhập: thiết kế hiện tại tự lưu lên server (debounce ~2 s sau mỗi thay đổi) thành **một bản dở**.
  Id bản dở nằm trong localStorage cùng thiết kế.
- Hồ sơ liệt kê bản dở: loại nhà, kích thước, địa chỉ (suburb), lần sửa cuối · **Continue** (mở vào
  editor ở bước đã dừng) · **Delete**.
- Gửi yêu cầu thành công thì bản dở đó bị xoá (nó đã thành yêu cầu đã gửi).
- Tối đa 20 bản dở mỗi tài khoản; vượt thì bản cũ nhất bị xoá.
- Bản dở chỉ chứa thiết kế, bước, nguồn chiến dịch và `revisionOf` — giống localStorage. Không chứa liên hệ.

### Hồ sơ (`/quote/account`)
- **Details**: họ, tên, mobile, email (chỉ đọc trong v1), **Save**. Đổi mật khẩu (mật khẩu cũ + mới).
- **Sent requests**: số, loại nhà, kích thước, suburb, ngày gửi, trạng thái khách thấy
  ("Received" = new, "Being quoted" = transferred, "Closed" = declined/spam). **Open** mở lại thiết kế
  như "reopen" của lịch sử localStorage (gửi lại thành bản sửa `revisionOf`).
- **Drafts**: như mục trên.
- Chưa đăng nhập mà vào `/quote/account`: hiện hộp đăng nhập.

### Đăng xuất
- Xoá phiên trên server và cookie. Thiết kế đang mở trên máy giữ nguyên (thành thiết kế vãng lai),
  ô liên hệ được xoá trắng.

## Bảo mật

- Mật khẩu: `hashPassword`/`verifyPassword` (scrypt) trong `apps/api/src/lib/password.ts`; tài khoản
  không tồn tại thì vẫn `burnVerificationTime` để thời gian trả lời như nhau.
- Phiên: cookie **`sq_guest`** (HttpOnly, SameSite=Lax, Secure khi https, hạn 90 ngày, gia hạn khi dùng).
  Server chỉ lưu `hashToken(token)`.
- `sq_guest` **không bao giờ** mở được route của công ty; `guard.ts` chỉ nhận `sq_session`.
  `sq_session` cũng không mở được route `/public/guest/account*`.
- Bridge của site (`apps/site/src/app/api/sq/[...path]/route.ts`) chuyển tiếp `sq_guest` vào và
  `Set-Cookie: sq_guest` ra, như đang làm với `sq_ga`.
- Rate limit bằng `consume()`: đăng nhập theo IP và theo email; tạo tài khoản theo IP; lưu bản dở theo tài khoản.
- Mọi truy vấn bản dở / yêu cầu lọc theo `account_id` của phiên; id của người khác trả 404.

## Dữ liệu (migration mới `024_guest_accounts.sql`)

```sql
guest_accounts (id, email_norm UNIQUE, password_hash, first_name, last_name, mobile,
                created_at, updated_at, last_sign_in_at)
guest_account_sessions (id, account_id → guest_accounts ON DELETE CASCADE, token_hash UNIQUE,
                        created_at, last_seen_at, expires_at)
guest_drafts (id, account_id → guest_accounts ON DELETE CASCADE, design_json, step, source_json,
              revision_of, created_at, updated_at)
ALTER TABLE guest_requests ADD COLUMN account_id TEXT REFERENCES guest_accounts(id)   -- null = vãng lai
```

## API (công khai, qua bridge của site)

| Route | Việc làm |
|---|---|
| `POST /public/guest/account/sign-up` | `{firstName, lastName, mobile, email, password}` → tạo tài khoản, đặt cookie, trả hồ sơ |
| `POST /public/guest/account/sign-in` | `{email, password}` → đặt cookie, trả hồ sơ |
| `POST /public/guest/account/sign-out` | Xoá phiên |
| `GET /public/guest/account` | Hồ sơ của phiên, hoặc 401 |
| `PATCH /public/guest/account` | `{firstName, lastName, mobile}` |
| `POST /public/guest/account/password` | `{current, next}` |
| `GET /public/guest/account/requests` | Yêu cầu đã gửi khi đăng nhập |
| `GET /public/guest/account/drafts` · `PUT /public/guest/account/drafts/:id` · `DELETE …/:id` | Bản dở (PUT tạo hoặc cập nhật; id do client sinh, uuid) |
| `POST /public/guest-requests` (đã có) | Có phiên thì ghi `account_id`; body thêm `draftId?` để xoá bản dở đó |

## Ngoài phạm vi v1 (ghi lại, chưa làm)

- **Quên mật khẩu** (cần mail đặt lại mật khẩu). Trong v1, khách quên mật khẩu vẫn gửi vãng lai được;
  admin chưa có nút đặt lại. Đây là lỗ hổng trải nghiệm thật — đề xuất làm ngay sau v1.
- Xác thực email, đổi email, xoá tài khoản.
- Nhận các yêu cầu vãng lai cũ (cần xác thực email trước).
- Trang intro (3065) có nút Sign in — làm khi trang hồ sơ đã chạy, link qua env như `QUOTE_APP_URL`.

## Tiêu chí nghiệm thu

1. Vãng lai gửi được như trước; không có gì mới bắt buộc.
2. Tạo tài khoản → đã đăng nhập → bước ① tự điền, sửa được, Next sang thiết kế.
3. Đang thiết kế dở, mở trình duyệt khác, đăng nhập → thấy bản dở trong hồ sơ → Continue mở đúng thiết kế và bước.
4. Gửi khi đăng nhập → yêu cầu hiện ở "Sent requests", bản dở đó biến mất; admin `/guest-requests` thấy như mọi yêu cầu khác.
5. Sửa mobile trong hồ sơ → lần sau bước ① điền mobile mới.
6. Đăng xuất → header về "Sign in", ô liên hệ trống, `/quote/account` đòi đăng nhập.
7. Cookie `sq_guest` gọi route công ty → 401; tài khoản A không đọc / xoá được bản dở hay yêu cầu của B.
