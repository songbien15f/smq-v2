# Giọng nói (STT) cho Shed Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách trên trang Guest `/quote` bấm mic, nói một yêu cầu về shed. Server chuyển giọng nói thành chữ, có gợi ý từ vựng shed. Chữ được điền vào ô chat để khách xem lại rồi mới gửi.

**Architecture:** Trình duyệt ghi âm bằng `MediaRecorder` và gửi base64 qua bridge `/api/sq/...` tới route mới `POST /public/guest/assistant/transcribe`. Route gọi `transcribe()` có sẵn trong `apps/api/src/lib/ai/gateway.ts:265` (hiện chưa nối), kèm một *prompt từ vựng shed*. Sau đó transcript được chuẩn hoá và chấm điểm "có đúng chủ đề shed không" bằng luật cố định, không gọi model thêm. Transcript **không tự gửi**: nó đi vào ô chat, rồi lượt chat bình thường (`/assistant/turn`, `SYSTEM_PROMPT` đã giới hạn phạm vi shed) xử lý như chữ gõ tay.

**Tech Stack:** Fastify 5, zod (`@sq/contracts`), Next.js (`apps/site`), Zustand (`assistantStore.ts`), MediaRecorder + Web Audio `AnalyserNode`, gateway OpenAI-compatible vilao (`/audio/transcriptions`, model `VILAO_STT_MODEL`, mặc định `mgr/grok-stt`).

**Spec:** `docs/specs/quote-tiers-guest.md` — dòng 344 (STT phía server, không dùng Web Speech) và dòng 675 (`POST /public/guest/assistant/transcribe`: audio ≤ 60 s, quota riêng, trả `{ text }`, audio không lưu).

## Global Constraints

- Audio **không lưu, không log**: không ghi xuống đĩa, DB hay `request.log`. Chỉ log độ dài và mime khi lỗi.
- Audio dài tối đa **60 s**. Tối đa **1 MB** sau khi giải base64. Route `bodyLimit` là `1.5 MB`. Bản app mặc định là `1024 * 1024` (`apps/api/src/app.ts:88`).
- JSON + base64, **không thêm multipart**. Làm theo mẫu `apps/api/src/routes/templateFiles.ts:61,98`.
- Transcript **không bao giờ tự gửi** cho model trong lượt chat. Khách luôn thấy và sửa được trước khi bấm Send.
- Transcript đi qua `redact()` (`guestAssistant.ts:80`) **trước khi trả về trình duyệt**, giống chữ gõ tay.
- Chủ đề chỉ là shed: prompt STT chỉ chứa từ vựng shed. Kiểm chủ đề bằng từ điển cố định, không gọi model thêm.
- Biến env mới phải thêm vào `turbo.json` `globalPassThroughEnv` và `.env.example` (để rỗng hoặc 0). **Không** in hay commit giá trị `VILAO_*`.
- Giữ thẩm mỹ hiện tại của trang Guest (navy/gold, `design-system/smartquote-v2/MASTER.md`). Nhãn UI bằng tiếng Anh như phần còn lại của trang.
- `guest.css` dùng **CRLF**, `.tsx` dùng LF: giữ đúng line ending của từng file.
- Không đổi `placementRules.ts`, giới hạn 15 m, `GUEST_DEFAULT_TYPES`, `needsConfirm`.
- Dùng `localhost`, không dùng `127.0.0.1`.

## Review Focus

1. **Khách từ chối quyền micro, hoặc trình duyệt không có MediaRecorder.** Không hiện lỗi đỏ. Hiện một dòng "Microphone blocked — allow it in the browser, or type instead". Nếu thiếu API thì ẩn hẳn nút mic. *(test: Task 4, bước kiểm tra bằng tay + e2e stub)*
2. **Safari ghi `audio/mp4`, Firefox ghi `audio/ogg`, Chrome ghi `audio/webm`.** Cả ba phải qua allow-list mime và tới được gateway. *(test: Task 2 `accepts each browser mime`)*
3. **Nói linh tinh, im lặng hoặc nói chủ đề khác** ("thời tiết hôm nay thế nào"). Transcript rỗng thì báo "Didn't catch that". Lạc chủ đề thì vẫn điền vào ô chat, nhưng có gợi ý "I can only help with the shed design". Model không bị gọi cho tới khi khách bấm Send. *(test: Task 1 `isShedTopic`)*
4. **Nói số điện thoại hoặc email.** Số và email phải bị che trước khi transcript về trình duyệt. *(test: Task 2 `redacts contact details in the transcript`)*
5. **Spam ghi âm.** Quota STT riêng theo IP, theo phiên và theo ngày phải chặn trước khi gọi gateway, giống `runAssistantTurn` (`guestAssistant.ts:456-462`). *(test: Task 2 `stops at the per-session voice limit`)*

---

## Việc cần kiểm trước (claim discipline)

- **Gateway vilao + `mgr/grok-stt` có nhận tham số `prompt` và `language` không: chưa kiểm.** Chuẩn OpenAI `/audio/transcriptions` có hai trường này, nhưng gateway có thể bỏ qua. Task 1 có một probe. Nếu gateway bỏ qua `prompt`, lớp chuẩn hoá (`normaliseShedTranscript`) và lớp kiểm chủ đề vẫn chạy, vì cả hai không phụ thuộc gateway.
- **Máy hiện có `VILAO_API_KEY` không: chưa kiểm** (`docs/state/quote-tiers.md:473` ghi là chưa có). Nếu không có key thì không chạy được probe thật: ghi "chưa kiểm" chứ không ghi "không hỗ trợ".

---

### Task 1: Lớp "chủ đề shed" — prompt STT, chuẩn hoá, kiểm chủ đề

**Files:**
- Create: `apps/api/src/lib/guestVoice.ts`
- Modify: `apps/api/src/lib/ai/gateway.ts:265-290` (`transcribe` nhận thêm `opts`)
- Create: `scripts/probe-stt.mjs` (probe một lần, theo mẫu `scripts/probe-*.mjs`, không phải test)
- Test (nếu bật tests): `apps/api/src/__tests__/guestVoice.test.ts`

**Interfaces:**
- Produces:
  - `shedSttPrompt(type: GuestBuildingTypeSpec): string`: một đoạn tiếng Anh dưới 900 ký tự, chứa từ vựng cố định cộng tên màu Colorbond và tên loại của building type đó.
  - `normaliseShedTranscript(text: string): string`: sửa những lỗi nghe nhầm hay gặp và gom khoảng trắng.
  - `isShedTopic(text: string): boolean`
  - `transcribe(config, audio, mimeType, opts?: { prompt?: string; language?: string }, fetchImpl?)`: thêm `opts` ở vị trí thứ 4, `fetchImpl` lùi xuống vị trí thứ 5. Cập nhật mọi chỗ gọi (hiện chưa có chỗ nào).

- [ ] **Bước 1: Từ vựng cố định** trong `guestVoice.ts`, `const SHED_TERMS`: shed, garage, carport, barn, workshop, span, width, wide, length, long, height, high, tall, bay, bays, metre(s), millimetre(s), roof, gable, skillion, pitch, degrees, slab, footing, knee brace, cladding, vertical, horizontal, wall, front, back, left, right, roller door, PA door, personal access door, sliding door, window, motorised, colour, Colorbond, trim, barge, gutter, downpipe, add, remove, move, bigger, smaller, centre.
- [ ] **Bước 2: `shedSttPrompt(type)`**: một câu mẫu như `"Shed design request: make it 9 metres wide, add a 3 metre roller door on the front wall, Colorbond Monument roof."` cộng danh sách từ ở trên, cộng màu lấy từ type config. Cắt ở 900 ký tự, vì Whisper chỉ đọc khoảng 224 token cuối của prompt.
- [ ] **Bước 3: `normaliseShedTranscript`**: dùng bảng thay thế không phân biệt hoa thường, chỉ khớp nguyên từ. Ví dụ: `role a door|roll a door|roller dor → roller door`, `p a door|pee a door|pa door → PA door`, `sky lion|skill ion → skillion`, `colour bond|color bond → Colorbond`, `meters → metres`, `knee bracing → knee brace`. Bảng nằm trong một hằng số để thêm dòng dễ.
- [ ] **Bước 4: `isShedTopic`**: trả `true` khi có ít nhất một từ trong `SHED_TERMS`, hoặc có mẫu số kèm đơn vị (`/\b\d+(\.\d+)?\s?(m|mm|metres?|metre)\b/i`). Chuỗi rỗng trả `false`.
- [ ] **Bước 5: `transcribe` nhận `opts`**: khi có thì `form.append('prompt', opts.prompt)`, `form.append('language', opts.language)`. Không có thì giữ nguyên hành vi cũ.
- [ ] **Bước 6 (nếu bật tests):** `guestVoice.test.ts`:
  - `isShedTopic('add a roller door at the front') === true`; `isShedTopic('make it 9 m wide') === true`; `isShedTopic('what is the weather today') === false`; `isShedTopic('') === false`.
  - `normaliseShedTranscript('add a role a door and a sky lion roof') === 'add a roller door and a skillion roof'`.
  - `shedSttPrompt(type).length <= 900` và có chứa một tên màu của type.
  - `transcribe` với `fetchImpl` giả: body FormData có `prompt` và `language` khi truyền `opts`, không có khi bỏ `opts`.
- [ ] **Bước 7: `scripts/probe-stt.mjs <file.webm>`**: gọi gateway hai lần, có và không có `prompt`, rồi in hai transcript để so. Đọc key từ env, **không in key**. Chỉ chạy khi máy có key, và ghi kết quả (hoặc "chưa kiểm") vào `docs/state/`.
- [ ] **Bước 8: Tự kiểm**: `pnpm --filter @sq/api typecheck`.

### Task 2: Route `POST /public/guest/assistant/transcribe`

**Files:**
- Modify: `packages/contracts/src/assistant.ts` (thêm schema và kiểu)
- Modify: `apps/api/src/routes/guest.ts` (gần route `/assistant/turn`, dòng 455)
- Modify: `apps/api/src/lib/guestAssistant.ts:51` (`ASSISTANT_LIMITS` thêm `voicePerIpDay: 30`, `voicePerSession: 20`)
- Modify: `.env.example`, `turbo.json` (`GUEST_ASSISTANT_VOICE`, `GUEST_ASSISTANT_DAILY_VOICE`)
- Test (nếu bật tests): `apps/api/src/__tests__/guestAssistant.test.ts` (thêm `describe('transcribe')`)

**Interfaces:**
- Consumes: Task 1 (`shedSttPrompt`, `normaliseShedTranscript`, `isShedTopic`, `transcribe(..., opts)`).
- Produces (`@sq/contracts`):
  ```ts
  export const GUEST_VOICE_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] as const;
  export const GUEST_VOICE_MAX_MS = 60_000;
  export const guestAssistantTranscribeRequest = z.object({
    audio: z.string().min(1).max(1_400_000),          // base64 của ≤ 1 MB
    mimeType: z.enum(GUEST_VOICE_MIME),               // trình duyệt gửi phần trước dấu ';'
    durationMs: z.number().int().min(300).max(GUEST_VOICE_MAX_MS + 2_000),
    typeId: z.string().min(1).max(64),
  }).strict();
  export interface GuestAssistantTranscribeResponse {
    text: string;        // đã normalise + redact; '' = không nghe được
    onTopic: boolean;    // isShedTopic(text)
    unavailable?: boolean; // voice tắt hoặc hết quota ngày → UI ẩn mic cho phiên này
  }
  ```

- [ ] **Bước 1: Thêm schema** như trên, export trong `packages/contracts/src/index.ts`, rồi `pnpm --filter @sq/contracts build`.
- [ ] **Bước 2: Route**, đăng ký với `{ bodyLimit: 1.5 * 1024 * 1024 }`. Thứ tự xử lý:
  1. `assistantEnabled()` và `GUEST_ASSISTANT_VOICE === '1'` và `assistantConfigFromEnv()` khác null. Thiếu một trong ba thì trả `200 { text: '', onTopic: false, unavailable: true }`.
  2. `parseBody`.
  3. Building type theo `typeId` (lấy giống route turn). Không có type thì trả 400.
  4. `resolveAssistantSession` cho cookie `ASSISTANT_COOKIE`.
  5. `consume` lần lượt `ga:voice:ip:<ipHash>` (30/ngày), `ga:voice:s:<sessionId>` (20/ngày), `ga:voice:day:<yyyy-mm-dd>` (`GUEST_ASSISTANT_DAILY_VOICE`, mặc định 100). Vượt IP hoặc phiên thì trả 429 kèm câu tiếng Anh như turn. Vượt quota ngày thì trả `unavailable: true`.
  6. `Buffer.from(audio, 'base64')`, quá 1 MB thì trả 413.
  7. `transcribe(config, bytes, mimeType, { prompt: shedSttPrompt(type), language: 'en' })`.
  8. `text = redact(normaliseShedTranscript(raw))`, `onTopic = isShedTopic(text)`.
  - **Không** gọi `recordTurn`: transcript chỉ vào hội thoại khi khách bấm Send, qua route turn.
  - IP lấy bằng `clientIp(request)` (`lib/http.ts`), không đọc `X-Forwarded-For`.
- [ ] **Bước 3: Env**: `.env.example` thêm `GUEST_ASSISTANT_VOICE=0` và `GUEST_ASSISTANT_DAILY_VOICE=100` cạnh `GUEST_ASSISTANT_DAILY_TURNS`, rồi thêm cả hai vào `turbo.json` `globalPassThroughEnv`.
- [ ] **Bước 4 (nếu bật tests):** dùng `fetchImpl` giả của gateway, giống các test turn hiện có:
  - `returns unavailable when GUEST_ASSISTANT_VOICE is off`: `unavailable === true` và gateway không bị gọi.
  - `accepts each browser mime`: lặp `audio/webm`, `audio/ogg`, `audio/mp4` → 200. `audio/x-evil` → 400.
  - `redacts contact details in the transcript`: gateway trả `"call me on 0412 345 678 and add a window"` → `text` không chứa `0412`, `onTopic === true`.
  - `marks off-topic speech`: gateway trả `"what's the footy score"` → `onTopic === false`.
  - `stops at the per-session voice limit`: lần gọi thứ 21 trả 429 và gateway được gọi đúng 20 lần.
  - `refuses audio over 1 MB`: 413.
- [ ] **Bước 5: Tự kiểm**: `pnpm --filter @sq/api typecheck`. Gọi route bằng `curl` tới `http://localhost:3060/api/v1/public/guest/assistant/transcribe` với `GUEST_ASSISTANT_VOICE=0` → `unavailable: true`.

### Task 3: Ghi âm phía trình duyệt + store

**Files:**
- Modify: `apps/site/next.config.ts:31` — `microphone=()` → `microphone=(self)`. **Không có bước này thì trình duyệt chặn mic trước cả khi xin quyền.**
- Create: `apps/site/src/app/quote/useVoiceRecorder.ts`
- Modify: `apps/site/src/app/quote/assistantStore.ts` (thêm `transcribeVoice`, `voiceUnavailable`)

**Interfaces:**
- Produces:
  ```ts
  type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
  type VoiceError = 'denied' | 'no_device' | 'too_short' | 'failed';
  function useVoiceRecorder(opts?: { maxMs?: number; silenceMs?: number }): {
    supported: boolean;               // có navigator.mediaDevices + MediaRecorder
    state: VoiceState; error: VoiceError | null;
    elapsedMs: number; level: number; // level 0..1 cho thanh sóng
    start(): Promise<void>; stop(): void; cancel(): void;
    onDone(cb: (blob: Blob, mimeType: string, durationMs: number) => void): void;
  };
  // assistantStore
  transcribeVoice(blob: Blob, mimeType: string, durationMs: number, typeId: string):
    Promise<{ text: string; onTopic: boolean } | null>;  // null = lỗi hoặc unavailable
  voiceUnavailable: boolean;
  ```

- [ ] **Bước 1: Permissions-Policy** → `microphone=(self)`. Giữ nguyên `camera=()` và `geolocation=()`.
- [ ] **Bước 2: `useVoiceRecorder`**:
  - Chọn mime theo thứ tự `audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg;codecs=opus` bằng `MediaRecorder.isTypeSupported`. Gửi lên server phần trước dấu `;`.
  - Tự dừng khi tới `maxMs` (mặc định 60 000), hoặc khi im lặng `silenceMs` (mặc định 2 000) **sau khi đã có tiếng**. Đo bằng `AnalyserNode` RMS, ngưỡng khoảng 0.02.
  - Dưới 300 ms thì báo `too_short` và không gửi.
  - Lỗi `NotAllowedError` → `denied`, `NotFoundError` → `no_device`.
  - `cancel()` và unmount đều phải dừng mọi track (`stream.getTracks().forEach(t => t.stop())`) để đèn mic tắt.
- [ ] **Bước 3: `transcribeVoice`**: chuyển blob sang base64 bằng `FileReader.readAsDataURL` rồi cắt bỏ phần đầu, sau đó gọi `api('public/guest/assistant/transcribe', ...)`. Nếu nhận `unavailable` thì đặt `voiceUnavailable = true`.
- [ ] **Bước 4: Tự kiểm**: `pnpm --filter @sq/site-app typecheck`. Mở `http://localhost:3063/quote` và kiểm header bằng `read_network_requests`: phải có `microphone=(self)`.

### Task 4: UI/UX giọng nói trong khung Shed Assistant

**Files:**
- Create: `apps/site/src/app/quote/components/VoiceComposer.tsx` (nút mic + thanh đang ghi)
- Modify: `apps/site/src/app/quote/components/AssistantPanel.tsx:276-303` (form composer)
- Modify: `apps/site/src/app/quote/guest.css` (CRLF), thêm các class `g-voice-*`

**Interfaces:**
- Consumes: Task 3 (`useVoiceRecorder`, `transcribeVoice`, `voiceUnavailable`).
- Produces: `VoiceComposer({ typeId, disabled, onTranscript(text: string, onTopic: boolean): void })`.

**Thiết kế (luồng một khách):**

```
 idle         [ e.g. make it 9 metres wide        ] (🎤) [Send]
 recording    [ ● 0:07 / 1:00  ▂▅▇▅▂▁▃▆  ]  [✕ Cancel] [■ Done]
 transcribing [ ◌ Listening back…                  ]
 done         [ add a 3 metre roller door on the f ] (🎤) [Send]   ← chữ đã điền, con trỏ ở cuối
              ⓘ Check the words, then press Send.
 off-topic    ⓘ I can only help with the shed design — try "add a window on the left wall".
```

- [ ] **Bước 1: Nút mic** nằm trong `.g-assistant-row`, giữa ô nhập và Send. Đây là nút chỉ có icon (SVG micro, không dùng emoji), cỡ **44×44**, viền gold khi focus. `aria-label="Speak your request"`, `aria-pressed` theo trạng thái ghi.
  - Ẩn khi `!supported || voiceUnavailable`.
  - Disable khi `busy`, tức là lúc assistant đang trả lời.
- [ ] **Bước 2: Thanh đang ghi** thay chỗ ô nhập (cùng chiều cao, để layout không nhảy):
  - Chấm đỏ nhấp nháy + đồng hồ `0:07 / 1:00` + 8 vạch sóng chạy theo `level`.
  - Hai nút: `Cancel` (bỏ, không gửi) và `Done` (dừng và chuyển chữ).
  - Bàn phím: **Esc** = Cancel, **Enter/Space** trên nút Done = Done.
  - `prefers-reduced-motion`: tắt nhấp nháy và sóng, chỉ giữ đồng hồ.
  - Còn 10 s thì đồng hồ đổi màu cảnh báo.
- [ ] **Bước 3: Đang chuyển chữ**: spinner nhỏ + "Listening back…" trong ô, có `role="status"`.
- [ ] **Bước 4: Xong**:
  - Điền transcript vào ô nhập: nối thêm nếu ô đã có chữ, thay thế nếu ô trống. Focus ô và đặt con trỏ ở cuối. **Không tự gửi.**
  - Hint dưới form: "Check the words, then press Send."
  - Nếu `onTopic === false`, hint đổi thành câu off-topic kèm một ví dụ.
  - Transcript rỗng: "Didn't catch that — try again or type it."
- [ ] **Bước 5: Lỗi quyền**:
  - `denied`: "Microphone blocked — allow it in the browser's address bar, or type instead."
  - `no_device`: "No microphone found — type instead."
  - Cả hai hiện ở dòng hint, không dùng modal. Lần bấm sau thử lại.
- [ ] **Bước 6: Trạng thái trống** (log chưa có tin nhắn): thêm một dòng mời "Tap the mic and say what you want — e.g. *add a roller door on the front*". Chỉ hiện khi nút mic đang hiện.
- [ ] **Bước 7: Mobile (sheet)**: nút mic vẫn 44 px. Khi đang ghi, thanh ghi chiếm cả hàng và nút Send ẩn. Kiểm ở 375 px và 390 px: không có thanh cuộn ngang. Bấm mic **không** mở bàn phím ảo.
- [ ] **Bước 8: Screen reader**: `aria-live="polite"` báo "Recording", "Transcribing", "Transcript ready — check it, then send". Không báo từng giây của đồng hồ.
- [ ] **Bước 9: Tự kiểm** bằng trình duyệt trong app, với dev server `pnpm dev` và `GUEST_ASSISTANT_VOICE=1`:
  - Chrome: ghi → Done → chữ hiện trong ô → Send → lượt chat chạy.
  - Từ chối quyền mic → dòng hint đúng.
  - `GUEST_ASSISTANT_VOICE=0` → nút mic biến mất sau lần bấm đầu tiên (nhận `unavailable`).
  - Chụp màn hình desktop và 390 px làm bằng chứng.
  - Nếu không có key thật thì không kiểm được transcript thật: ghi "chưa kiểm với gateway thật".
- [ ] **Bước 10 (nếu bật tests):** e2e Playwright: stub route `**/api/sq/public/guest/assistant/transcribe` trả `{ text: 'add a window on the left wall', onTopic: true }`. Giả `getUserMedia` bằng `--use-fake-device-for-media-stream` và `--use-fake-ui-for-media-stream`. Kiểm: bấm mic → Done → ô nhập có chữ đó và chưa có request `/assistant/turn` nào.

### Task 5: Tài liệu

- [ ] `docs/smartquote-quote-editor-reference.md`: thêm mục Guest assistant / voice (tiếng Việt): luồng, quota, audio không lưu, transcript không tự gửi.
- [ ] `docs/OPERATIONS.md`: mô tả `GUEST_ASSISTANT_VOICE` và `GUEST_ASSISTANT_DAILY_VOICE`, kèm cách tắt riêng giọng nói khi tốn chi phí.
- [ ] `docs/state/quote-tiers.md`: ghi kết quả probe `prompt` (hoặc "chưa kiểm").
- [ ] CHANGELOG nếu repo có.

---

## Quyết định đã chọn (có thể đổi trước khi làm)

| Quyết định | Chọn | Lý do |
|---|---|---|
| Bấm để nói hay giữ để nói | **Bấm bật / bấm tắt**, tự dừng khi im 2 s | Giữ nút khó trên điện thoại và không dùng được bằng bàn phím |
| Tự gửi sau khi nói | **Không**, chỉ điền vào ô | Lượt chat có thể đổi thiết kế; khách phải thấy chữ trước (STT có thể nghe nhầm "9" thành "5") |
| Cách giữ "chủ đề shed" | Prompt từ vựng shed cho STT + bảng sửa lỗi nghe nhầm + kiểm từ khoá (không gọi model) | Rẻ, đoán trước được, test được. `SYSTEM_PROMPT` của lượt chat đã chặn lạc đề ở bước sau |
| Ngôn ngữ STT | `en` cố định | Trang và assistant đều trả lời tiếng Anh Úc |
| Multipart hay base64 | Base64 trong JSON | API chưa có parser multipart; cùng mẫu với `templateFiles.ts` |
| Đọc câu trả lời thành tiếng (TTS) | **Không làm** trong plan này | Không có trong yêu cầu; thêm sau nếu cần |
