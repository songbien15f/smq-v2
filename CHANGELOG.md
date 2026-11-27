# Changelog

Changes that a person running or selling this product would notice. Newest first. Each entry says
*what changed* and *what it means*, in that order — the plan files under `docs/plans/` hold the
reasoning, `docs/DECISIONS.md` holds the decisions that outlive the change.

## 2026-11-27

### The Guest assistant can be answered by Google Gemini, with vilao as a fallback

The assistant on the public quote page (design turns, transcript repair, speech to text) now goes
through a **router** with a primary provider and an optional fallback. Google Gemini
(`gemini-3.5-flash-lite`, via `generateContent`) is the intended primary; the vilao gateway stays as
the fallback and still works on a machine with only `VILAO_API_KEY`. A machine with **neither key**
behaves exactly as before: the route answers 503 `not_configured` and the page says the assistant is
unavailable.

- **Which provider answers, and which models, is set in the admin app** — new **AI assistant** screen,
  `/ai`, gated by the new `platform:ai` capability. The change is audited (`ai_settings.update`), stored
  in the new `ai_settings` table (migration 025) and applies within 30 seconds.
- **The keys are still only in `.env`.** The table has no key column, and the screen shows "key set:
  yes/no" as two booleans. Rotating a key means editing `.env` and restarting the API.
- Every call logs one line naming the provider and whether the fallback fired. No prompt text and no
  key appear in it.
- New environment variables: `AI_PRIMARY`, `AI_FALLBACK`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
  `GEMINI_STT_MODEL`, `GEMINI_BASE_URL`, `GEMINI_THINKING_LEVEL`. `VILAO_*` is unchanged.
- `docs/OPERATIONS.md` gained the provider table, the rotation rule, and Gemini's rate and spend limits
  (Tier 1: $10 per 10 minutes, $250 cap).

**Not yet verified:** a real Gemini call. The machine has no `GEMINI_API_KEY`, so the probe
(`scripts/probe-gemini.mjs`) was written but not run, and every automated test injects a fake `fetch`.

### The microphone opens a confirmation dialog; nothing is sent until the guest presses Done

Bấm mic trên trang báo giá giờ mở hộp thoại **"Speak your request"**: ghi âm (đồng hồ, thanh âm lượng,
Cancel/Done) → server nhận dạng và sửa lại câu → hộp thoại đổi thành **"Is this what you said?"** với
câu trong ô sửa được, chip "Did you mean", cảnh báo kích thước, và **Done mới đưa câu vào khung chat**.
Cancel, Esc hay đóng hộp thoại không gửi gì. Ghi âm nằm trong hộp thoại nên đóng là micro tắt.

Two existing defects were found and fixed while verifying this, both visible only in a browser:

- one recording made **two** transcription requests (and Cancel still made one), because the recorder
  tore itself down in a way that fired its own stop handler twice;
- **Escape** inside a dialog also closed the whole assistant column behind it.

**Not yet verified:** the dialog in a real browser with a real microphone — the walkthrough used Chrome's
fake device and a stubbed transcript.
