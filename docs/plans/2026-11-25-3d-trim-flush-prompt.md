Bạn sửa mô hình 3D của SmartQuote v2 theo góp ý của client (repo `D:\Docs\OS.mr.Thi\02.smartquote_v2`). Mục tiêu: 3D giống nhà thật, không còn chi tiết nào nhô ra sai chỗ hay thiếu nẹp.

Góp ý gốc của client (giữ nguyên văn):
> WID, PAD vẽ trồi ra ngoài mặt sheeting cũng sai nha, phải bằng mặt ngoài
> cái viền trim đỏ trên top mới có, ko có bottom
> cái viền trim đỏ bottom của cái shed cũng ko có
> thiếu viền trim ridge trên roof, corner trim trên wall
> tham khảo lại 3D của Quotec là chuẩn nhất nha e

Giải nghĩa:
- **WID** là Window, **PAD** là PA Door: desktop dùng `using WID = …Window; using PAD = …PADoor` ở `Layer/Function/Option/.../Wall/WallCombo.cs:13-14`.
- **"Trim đỏ"** là màu trim client đã chọn (ví dụ Manor Red), **không phải màu cứng**. Mặc định của Guest là Surfmist (`packages/core/src/domain/guest.ts:209`).
  - Mọi mảnh trim lấy màu từ `colors.barge`, tức `colours.trim.barge` của thiết kế.
  - Không viết mã màu đỏ cứng vào code.

## Ràng buộc

- Không commit, không push.
- Không đụng `.env`, `docs/note.md`, `data/`, `note_private_ignore/`, `.claude/`.
- Dùng `localhost`, không dùng `127.0.0.1`.
- Giữ line ending từng file, **đo theo byte bằng Python** trước khi sửa (grep trong Git Bash đếm sai).
- `@sq/core` không import DB/HTTP (A9).
- Sau khi sửa core, chạy `pnpm build:inc`, vì app đọc `dist`.
- Không đổi:
  - kích thước nhà, vị trí hay kích thước cửa, màu tường/mái;
  - BOM, giá, `ENGINE_VERSION`;
  - UI, AI, luồng Guest, `placementRules.ts`.
- File được sửa:
  - `packages/core/src/domain/openings3d.ts`
  - `packages/core/src/domain/structure3d.ts`
  - test của chúng trong `packages/core/src/domain/__tests__/`
  - `packages/viewer3d/src/Shed3D.tsx`, **chỉ khi** phần mới không tự vẽ ra được. Hiện `Shed3D` vẽ mọi part từ `structureParts`/`openingParts`, nên có lẽ không cần sửa file này.
- Editor nội bộ (`apps/client`) dùng chung các hàm này nên cũng sẽ đổi theo. Như vậy là đúng.
- Không sửa `buildWallGeometries` (hình tôn tường). Base trim **phủ lên** chân tôn, không cắt tôn.

## Đọc trước

- `packages/core/src/domain/openings3d.ts`:
  - Hệ toạ độ ở dòng 15 và 32: tôn chạy từ `z = 0` (mặt ngoài) tới `z = WALL_DEPTH` (mặt trong), `z` âm là phía ngoài nhà.
  - `paDoorParts` khoảng dòng 235–260.
  - Cửa sổ khoảng dòng 388–445.
- `packages/core/src/domain/structure3d.ts`:
  - `roofParts` và ridge cap khoảng dòng 112–165.
  - Gable ends, gutter, cột.
- `packages/core/src/domain/__tests__/openings3d.test.ts`: có sẵn "window flushness test" (Phase C) đang chốt −25/−45. Test này **phải sửa theo luật mới**, không được xoá.
- `docs/state/guest-uiux-bugfix.md` mục "Phase C": lý do của các số cũ.
- `docs/2026-11-13-3d-quotec-reference.md`: tài liệu Quotec. Nó chỉ nói về cửa, chưa có gì về trim vỏ nhà.
  - Không dùng asset của Quotec.
  - Nếu cần xem Quotec thật thì chỉ xem, không tạo job.

## 1. WID và PAD bằng mặt ngoài tôn

- **Luật:** mọi part của cửa sổ và PA door có mặt ngoài `z ≥ 0` (cho sai số `1e-6`).
  - Tức là mặt ngoài của khung, flashing, sill, ngưỡng và bản lề **nằm đúng trên mặt phẳng tôn hoặc lùi vào trong**.
  - Hiện tại:
    - khung cửa sổ ra tới −25, flashing tới −45;
    - khung PA door ra tới khoảng −84, ngưỡng tới khoảng −126.
- **Chống z-fighting:**
  - Viền nằm trong lỗ của tôn, nên không trùng mặt với tôn.
  - Phần viền đè lên mép tôn quanh lỗ (nếu có) thì lùi vào `z = +1` hoặc `+2`, hoặc chỉ nằm trong lỗ.
  - Kiểm bằng ảnh: không được nhấp nháy khi xoay.
- **Cánh PA door mở ra ngoài** (`z` âm, `PA_OPEN_ANGLE`) là chuyển động của cánh, không phải khung. **Cánh được phép** vượt `z = 0`.
  - Ghi rõ ngoại lệ này trong test.
  - Nếu thấy nên vẽ cánh đóng thì **hỏi trước**, đừng tự đổi.
- Roller door và sliding door **không nằm trong góp ý**, không sửa.
  - Nhưng ghi lại trong báo cáo part nào của chúng đang nhô khỏi `z = 0` và nhô bao nhiêu, để quyết định sau.

## 2. Viền trim quanh cửa đủ 4 cạnh

- Client nói viền trên có mà viền dưới không có. Đây là **cách hiểu của chúng tôi, chưa được client xác nhận**: viền quanh WID/PAD thiếu cạnh dưới.
  - PA door chỉ có ngưỡng cao 20 mm nên gần như không thấy.
  - Cửa sổ có sill flashing nhưng không cùng kiểu với viền trên.
- Mỗi cửa sổ và PA door có **một khung trim khép kín 4 cạnh**: trên, dưới, trái, phải.
  - Cùng tiết diện nhìn từ ngoài (cùng bề rộng mặt), cùng màu `colors.barge`.
  - Cửa đi: cạnh dưới là ngưỡng, cao bằng các cạnh kia, nằm sát sàn, bằng mặt như mục 1.
- Khung PA door hiện dùng `colors.paDoor`.
  - Chuyển **viền ngoài** sang `colors.barge`.
  - Giữ `colors.paDoor` cho cánh cửa.

## 3. Base trim chân shed

- Một dải trim chạy suốt chân mỗi bức tường **có tôn**, cao khoảng 50–75 mm.
  - Ghi số đã chọn và lý do vào comment.
  - Dày vài mm, nằm ngay ngoài mặt tôn (`z` âm nhỏ, ví dụ −3 tới 0).
  - Màu `colors.barge`.
- **Ngắt dải ở các ô cửa chạm sàn:** PA door, roller door, sliding door. Không vẽ dải băng ngang qua lỗ cửa.
- Tường để trống (carport, mặt không có tôn) thì không có base trim.
- Nếu desktop có vật tư base trim, ghi `file:line` vào báo cáo.
  - Không có thì ghi "3D only, không có trong BOM".
  - Không thêm vào BOM.

## 4. Ridge cap, corner trim, barge

- **Ridge cap:** đã có (`structure3d.ts` khoảng dòng 158) nhưng quá mảnh.
  - Làm thành nẹp úp chữ V hoặc hai cánh, rộng mỗi bên khoảng 150–200 mm, chạy suốt chiều dài đỉnh mái.
  - Màu `colors.barge`.
  - Mái skillion không có ridge, giữ nguyên.
- **Corner trim:** nẹp đứng chữ L ôm **mặt ngoài** mọi góc nơi hai bức tường có tôn gặp nhau.
  - Mỗi cánh khoảng 50–75 mm, từ chân tường lên tới eave.
  - Góc có một phía là tường mở thì không có.
- **Barge flashing:** chạy dọc mép mái ở đầu hồi.
  - Gable có 4 đoạn dốc.
  - Skillion có 2 đoạn dốc cộng mép cao.
  - Theo đúng mô tả của BOM trong `docs/KNOWN-DEVIATIONS.md` dòng 58.
  - Màu `colors.barge`. Không để đè lên gutter.
- **Màu:** toàn bộ hệ trim dùng **một màu**, `colors.barge`. Gutter và downpipe giữ màu riêng của chúng.

## Kiểm tra (bắt buộc)

**Test**, trong `packages/core/src/domain/__tests__/`:
1. **WID/PAD không nhô:** với mọi part của cửa sổ và PA door, trừ cánh cửa đang mở, mặt ngoài `z ≥ −1e-6`. Viết là `position.z − size.z/2 ≥ 0`, có tính rotation nếu có.
2. **Viền 4 cạnh:** cửa sổ và PA door mỗi cái có đủ 4 part viền màu `colors.barge`, bao kín lỗ.
3. **Base trim:** có ở mọi tường có tôn, bị ngắt đúng ở ô cửa chạm sàn, không có ở tường mở.
4. **Corner trim:** số góc đúng cho garage kín 4 tường (4 góc) và cho carport (0 góc).
5. **Ridge và barge:**
   - ridge cap có trên gable, không có trên skillion;
   - barge có đủ số đoạn (gable 4; skillion 2 đoạn dốc cộng 1 mép cao).
6. **Màu:** mọi part trim mới dùng `colors.barge`.

**Lệnh:**
- `pnpm --filter @sq/core test` phải pass hết. Ghi số test trước và sau.
- `pnpm --filter @sq/core typecheck`
- `pnpm build:inc`
- `pnpm --filter @sq/site-app typecheck`

**Ảnh, trước và sau:**
- Chụp ảnh "trước" **trước khi sửa code**.
- Cấu hình: Garage 6,00 × 6,00 m, có một cửa sổ và một PA door, trim đổi sang Manor Red (hoặc màu đỏ có sẵn) để dễ thấy.
- Cùng góc camera, cùng cỡ 1919.
- Các góc chụp:
  - cận cửa sổ;
  - cận PA door (thấy cả trên và dưới);
  - chân tường;
  - đỉnh mái;
  - góc tường;
  - cận mép đầu hồi (barge);
  - toàn cảnh.
- Lưu vào `docs/qa/screens/2026-11-25-3d-trim/{before,after}/`, kèm `README.md` có bảng trước/sau.
- Script chụp tự viết phải stub `**/api/sq/public/guest-requests` và `**/api/sq/public/guest/places/**`. Xoá script khi xong.
- **Tự mở từng ảnh "sau" ra xem**, mỗi ảnh mô tả một câu.
  - Nếu phiên của bạn không xem được ảnh thì nói rõ, không mô tả như thể đã thấy.

**Guest e2e:** `pnpm test:e2e --project=guest`, cần `pnpm dev` đang chạy. Bản này tự xoá GR nó tạo ra.

## Tài liệu

- `docs/smartquote-quote-editor-reference.md`: thêm một đoạn ngắn mô tả hệ trim 3D.
- `docs/state/3d-trim-flush.md`: checkpoint gồm mục tiêu, quyết định, số đo, việc còn lại.

## Báo cáo (tiếng Việt, ngắn)

- Từng mục 1–4: xong hay để lại, kèm lý do.
- Các số đã chọn: độ cao base trim, cánh corner, cánh ridge.
- Số test trước và sau, kết quả e2e.
- Danh sách part của roller door và sliding door còn nhô khỏi `z = 0`.
- Danh sách ảnh, mỗi ảnh một câu.
- Danh sách file đã đổi, kèm line ending từng file.
- Điều gì cần client xác nhận, ví dụ cách hiểu mục 2.
