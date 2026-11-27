# Plan: Gemini direct as primary, vilao as fallback, chosen in admin

- **Date:** 2026-11-27
- **Status:** draft, decisions D1–D6 all answered by the user. Not started.
- **Size:** standard (one coder, sequential slices).
- **Research and sources:** `docs/research/2026-11-27-gemini-3.5-flash-lite.md`, cited below as **R§n**.

## Goal

Make **Google Gemini direct, model `gemini-3.5-flash-lite`**, the primary provider for the Guest AI
Assistant's three jobs:

1. **Assistant turn:** chat in, JSON `{message, ops, needsConfirm}` out.
2. **Transcript repair:** raw STT text in, JSON `{text, onTopic, confidence, alternatives}` out.
3. **Voice STT:** audio in, text out.

Keep **vilao** (the current OpenAI-compatible gateway) as an **automatic fallback**. The provider
choice is **configurable in the admin app** by a platform admin. API keys stay in `.env`, never in
the database.

What the guest sees does not change: contracts, routes, quotas, redaction and the transcript tables
stay as they are.

## Decisions (answered 2026-11-27)

| id | Decision | Answer |
|---|---|---|
| D1 | API surface | **`generateContent`**: stateless, stores nothing (R§4) |
| D2 | Billing tier | **The key is on a Tier 1 (paid) project.** Data is not used to improve Google's products. Rolling spend limit is $10 per 10 min and the billing cap is $250 (R§7) |
| D3 | Voice pipeline | **Two calls** (STT returns text, then repair returns JSON). Confirmed by the user 2026-11-27. See "D3 explained" |
| D4 | Fallback | **Gemini first. If it fails, fall back to vilao.** Primary and fallback are chosen in admin |
| D5 | Thinking level | **`minimal`** |
| D6 | Legacy `AI_*` env vars | **Remove them** (no runtime code reads them) |

### D3 explained

**Two calls (recommended).** This is how voice works today:

```
audio ──(1) STT──▶ "nine by six shed three metre wall"
                 ──normalise + redact──▶ "9 x 6 shed 3 m wall"
                 ──(2) repair (JSON)──▶ {text, onTopic, confidence, alternatives}
```

**One call.** Audio goes straight to the model, which returns the repair JSON:

```
audio ──(1) STT + repair (JSON)──▶ {text, onTopic, confidence, alternatives}
```

How they compare:

| | Two calls | One call |
|---|---|---|
| Latency | one extra round trip (about 1–2 s more) | faster |
| Cost | about the same: audio is ~1,920 tokens/min in both; repair is a small text call (≈ $0.0003) | about the same |
| Redaction | `redact()` runs on the raw transcript **before** the second model sees it | the model sees unredacted speech in one go. Still redacted after, but one stage of the pipeline is lost |
| Fallback to vilao | **each stage falls back on its own.** vilao STT only returns text, so the two-call shape is exactly what vilao can stand in for | vilao has no audio-to-JSON call. The fallback would need a different pipeline anyway, so you keep two code paths |
| Code change | smallest: `guestVoice.ts` and the route do not change | the route and `guestVoice.ts` are reshaped |
| Testability | each stage tested alone (as today) | one opaque step |

Because D4 keeps vilao as the fallback, **two calls is clearly the better fit**. One call can be
revisited later as an optimisation, once Gemini proves stable.

## Current state (facts, file:line)

| What | Where |
|---|---|
| vilao gateway config: `VILAO_API_KEY` / `VILAO_BASE_URL` (default `https://api.vilao.ai/v1`) / `VILAO_MODEL` (`wiki`) / `VILAO_STT_MODEL` (`mgr/grok-stt`) | `apps/api/src/lib/ai/gateway.ts:27-45` |
| `TIMEOUT_MS = 20_000` | `gateway.ts:25` |
| `OPS_SCHEMA`: array, `maxItems: 10`, `anyOf` of 15 `opBranch` | `gateway.ts:93-148` |
| `REPLY_JSON_SCHEMA` (`guest_assistant_reply`, strict) | `gateway.ts:150-171` |
| `completeReply()`: `/chat/completions`, `response_format: json_schema`, `temperature: 0.2` | `gateway.ts:190-259` |
| `REPAIR_JSON_SCHEMA`; `repairTranscript()`: `REPAIR_TIMEOUT_MS 8_000`, `REPAIR_MAX_CHARS 1000` | `gateway.ts:266-389` |
| `transcribe()`: multipart `/audio/transcriptions`; `promptRejected` retries once without `prompt` | `gateway.ts:410-450` |
| Assistant turn builds the messages, then makes one corrective retry when ops were dropped | `apps/api/src/lib/guestAssistant.ts:41, 494, 505-528` |
| `assistantEnabled(env)` = `GUEST_ASSISTANT_ENABLED` and a config | `guestAssistant.ts:556-560` |
| Turn route (`not_configured`) and transcribe route (1.5 MB body, voice quotas, `unavailable:true`) | `apps/api/src/routes/guest.ts:100, 462+, 558-668` |
| STT and repair prompts, normaliser, `isShedTopic`, `numberWarnings` | `apps/api/src/lib/guestVoice.ts` |
| `GUEST_VOICE_MIME = webm, ogg, mp4, mpeg, wav` | `packages/contracts/src/assistant.ts:151, 164+` |
| Env template: legacy `AI_*` (L157-161); `VILAO_*` and `GUEST_ASSISTANT_*` (L163-180) | `.env.example` |
| Turbo pass-through: `AI_*` (L52-54); `VILAO_*` and `GUEST_ASSISTANT_*` (L77-87) | `turbo.json` |
| **Secrets must not live in tables.** Migration 008 dropped `platform_settings` for that reason ("Credentials live in .env, not in a table") | `packages/db/migrations/008_drop_platform_settings.sql:1-3` |
| Platform capabilities (`platform:*`), `platform_admin` and `platform_support` policies | `packages/contracts/src/roles.ts:34-56, 87-96` |
| Guard for vendor routes | `apps/api/src/lib/guard.ts:65` `requirePlatformCapability` |
| Pattern for an admin route with a capability constant | `apps/api/src/routes/guestTypesAdmin.ts:50, 206+` |
| Audit helper | `apps/api/src/lib/audit.ts:34` `audit(tx, entry)` |
| Tests: fake-fetch gateway tests | `apps/api/src/__tests__/guestAssistant.test.ts` |
| Probe that reads `VILAO_*` | `scripts/probe-stt.mjs` |
| Docs that name vilao | `docs/OPERATIONS.md:294-325`, `docs/state/quote-tiers.md:41,462,473,496`, comment in `packages/core/src/domain/jsonSchema.ts` |

**Not yet checked:** whether the site bridge (`apps/site/src/app/api/sq/[...path]/route.ts:79`) or the
client (`apps/site/src/app/quote/assistantStore.ts`) puts its own timeout on the upstream fetch. The
fallback adds time, so the coder must read both and make sure no client-side timeout is shorter than
the API budget below.

## Architecture

```
site UI ─▶ /api/sq bridge ─▶ routes/guest.ts ─▶ guestAssistant.ts / guestVoice.ts
                                             └─▶ lib/ai/index.ts   (router: primary → fallback)
                                                   ├─▶ lib/ai/gemini.ts  ─▶ generativelanguage.googleapis.com (x-goog-api-key)
                                                   └─▶ lib/ai/vilao.ts   ─▶ api.vilao.ai/v1 (today's gateway.ts, renamed)
                                                   ▲
                                 lib/ai/settings.ts (ai_settings row + env defaults, cached)
                                                   ▲
admin UI /ai ─▶ /api/sq bridge ─▶ routes/aiSettingsAdmin.ts (platform:ai)
```

### Providers

There are two adapters with the **same interface**, `AiProvider`:

```ts
interface AiProvider {
  id: 'gemini' | 'vilao';
  configured: boolean;   // its key is present in env
  completeReply(messages, opts: {deadline}): Promise<ReplyResult>;
  repairTranscript(system, transcript, opts: {deadline}): Promise<RepairResult | null>;
  transcribe(audio, mimeType, {prompt, language, deadline}): Promise<string>;
}
```

The failure contract does not change: `{ok:false, reason}`, `null` or `''`, never a throw.

- `lib/ai/vilao.ts` is `gateway.ts` moved and wrapped. Its behaviour stays as it is, including
  `temperature` and the `promptRejected` retry.
- `lib/ai/gemini.ts` is new (details below).

**The shared schemas** (`REPLY_JSON_SCHEMA`, `OPS_SCHEMA`, `REPAIR_JSON_SCHEMA`) move to
`lib/ai/schemas.ts`. Each adapter wraps them in its own way:
- vilao: `response_format.json_schema` (`name`, `strict`).
- Gemini: `responseJsonSchema`.

The system prompts (`SYSTEM_PROMPT`, `shedSttPrompt`, `shedRepairPrompt`) do not change.

### Router `lib/ai/index.ts`

The router exports the three functions under the names callers use today. Callers only change their
import path.

For each call:

1. Read the effective settings (below). If `primary` is not configured, use the fallback as primary.
   If neither is configured, return failure. The routes already turn that into `not_configured` or
   `unavailable:true`.
2. Call the primary with a deadline.
3. On a **fallback-worthy failure**, call the fallback once, if all of these hold:
   - a fallback is configured;
   - it is enabled in settings;
   - enough budget remains.

   Fallback-worthy failures:
   - timeout or network error;
   - HTTP 429, 5xx, 402 or 403 (key or billing);
   - 400 (for example a schema rejection specific to one provider);
   - unparseable or invalid JSON;
   - an empty STT result **while the audio duration is ≥ 1.5 s**.

   **Not fallback-worthy:** content blocked by safety (`blockReason`, `finishReason: SAFETY`, …).
   The guest's text was the problem, not the provider.
4. Log one line per call: job, provider used, primary status, whether the fallback fired, latency and
   `usageMetadata` tokens. **Never log bodies, audio or keys.**

The corrective retry in `guestAssistant.ts:505-528` stays where it is. It calls `completeReply` again
through the router, which picks the provider again. This is fine.

### Time budgets (one deadline per job, computed once)

| Job | Total budget | Primary share | Fallback |
|---|---|---|---|
| Assistant turn | 25 s (was 20 s) | Gemini gets up to 14 s | vilao gets what remains, if ≥ 5 s |
| STT | 25 s (was 20 s) | 14 s | remaining, if ≥ 5 s |
| Repair | 8 s (unchanged) | 5 s | remaining, if ≥ 2 s; otherwise `null` (the raw transcript is used, as today) |

- **When a fallback is enabled, Gemini does no internal retry.** The fallback is the retry.
- **With no fallback, Gemini retries once** on 429/500/503/504 or a network error, after a 500–1000 ms
  jittered backoff (or `Retry-After` / `RetryInfo.retryDelay` when it fits). It has the whole budget.
- Never retry 400/402/403/404 against the same provider.

### Gemini adapter `lib/ai/gemini.ts`

The adapter sends `POST {base}/models/{model}:generateContent` with the header `x-goog-api-key`. The
key never goes in the URL.

| OpenAI shape (today) | Gemini |
|---|---|
| 2 system messages (prompt, design context) | `systemInstruction.parts = [{text}, {text}]` |
| `user` / `assistant` | `contents[].role = 'user'` / `'model'`, `parts:[{text}]` |
| `response_format.json_schema` | `generationConfig.responseMimeType='application/json'`, `responseJsonSchema` |
| `temperature` | **not sent**: deprecated, and later models return 400 (R§6) |
| — | `thinkingConfig.thinkingLevel` (from settings, default `minimal`) and `maxOutputTokens` (~1024 for a turn, ~512 for repair) |
| `choices[0].message.content` | join the `candidates[0].content.parts[].text`, skipping `thought` parts |

- **Never send contents whose last turn is `model`.** Gemini answers that with 400 (R§6). Guard
  against it in the adapter.
- **Content blocked:** `promptFeedback.blockReason`, or a `finishReason` of `SAFETY`, `RECITATION`,
  `BLOCKLIST`, `PROHIBITED_CONTENT` or `SPII`. The adapter returns `reason: 'blocked'`. **`MAX_TOKENS`
  or bad JSON** returns `reason: 'invalid'`.
- **STT:** `parts = [{inlineData:{mimeType, data}}, {text: instruction + shedSttPrompt(type)}]`,
  where the instruction is:

  > "Transcribe this English (Australian) audio verbatim. Output only the words spoken, no commentary. If there is no speech, output an empty string."

  - The output is plain text. Trim it, strip wrapping quotes and a `Transcript:` prefix, and cap it at
    `REPAIR_MAX_CHARS`.
  - **The vocabulary hint finally reaches the model.** grok-stt rejected it.
- **MIME types:**
  - `audio/mp4` → `audio/m4a`. `audio/mp4` is not on Gemini's list (R§3); the probe must confirm the
    mapping.
  - `webm`, `ogg`, `mpeg` and `wav` pass through as they are.
- **`OPS_SCHEMA` size risk** (R§5). Gemini expands `maxItems: 10` over 15 `anyOf` branches, which may
  hit "schema too complex", HTTP 400. The probe sends the schema unchanged first.
  - If it is rejected, drop `maxItems` from the Gemini copy only.
  - `parseOps` must cap ops at 10; add `.slice(0, 10)` if it does not already.
  - Meanwhile the router would fall back to vilao on that 400. That is safe, but it means Gemini never
    answers, so this must be fixed before release.

### Admin configuration (D4: "config trong admin")

**Rule kept from migration 008: no secret in any table.**

- Keys (`GEMINI_API_KEY`, `VILAO_API_KEY`) stay in `.env`.
- Admin shows only **"key set ✓ / not set ✗"** per provider, never the value. It cannot edit keys.
- Rotating a key means editing `.env` and restarting the API. `docs/OPERATIONS.md` must say so.

**Database:** migration `packages/db/migrations/025_ai_settings.sql` adds a single-row table:

```sql
CREATE TABLE ai_settings (
  id               TEXT PRIMARY KEY,          -- always 'global'
  primary_provider TEXT NOT NULL,             -- 'gemini' | 'vilao'
  fallback_provider TEXT NOT NULL,            -- 'vilao' | 'gemini' | 'none'
  gemini_model     TEXT NOT NULL,
  gemini_stt_model TEXT NOT NULL,
  gemini_thinking  TEXT NOT NULL,             -- 'minimal'|'low'|'medium'|'high'
  vilao_model      TEXT NOT NULL,
  vilao_stt_model  TEXT NOT NULL,
  updated_at       TEXT NOT NULL,             -- ISO-8601
  updated_by       TEXT NOT NULL              -- platform user id
);
```

- The table is platform-wide, so it has **no `tenant_id`**, like the other vendor tables.
- No row means use the env defaults. Existing installs need no seed.
- Follow the portable subset: TEXT ids, ISO TEXT timestamps, `?` placeholders.

**Contracts:** add `packages/contracts/src/aiSettings.ts`.
- `aiSettingsSchema` (zod).
  - `fallback !== primary`, unless it is `none`.
  - Model ids match `^[a-z0-9][a-z0-9._/-]{1,63}$`.
- `aiSettingsView` = settings plus `{geminiKeySet: boolean, vilaoKeySet: boolean, source: 'db'|'env'}`.

**API:** add `apps/api/src/routes/aiSettingsAdmin.ts`, registered in `app.ts`.
- `GET /admin/ai-settings` returns the view.
- `PUT /admin/ai-settings` validates, upserts, writes `audit(tx, {action:'ai_settings.update', …})`
  in the same transaction, and invalidates the in-process cache.
- Both routes use `requirePlatformCapability(request, reply, 'platform:ai')`.
- The new capability `'platform:ai'` is added to `CAPABILITIES` and to `platform_admin` only, not to
  `platform_support` (`roles.ts`).

**Settings reader:** `lib/ai/settings.ts` provides `effectiveAiSettings(db)`.
- It merges the DB row over the env defaults.
- It caches for 30 s and is invalidated by the PUT.

**Admin UI:** add `apps/admin/src/app/ai/page.tsx`, titled "AI assistant", plus a nav entry next to
the other platform pages. It holds:
- a primary provider select and a fallback select (including "None");
- model text fields for each provider and the Gemini thinking select;
- a key status badge for each provider;
- a Save button.

Use `@sq/ui` components and the navy/gold tokens. Do not use a new style.

**Optional, a separate button:** "Test connection". It sends one tiny text-only request ("reply with
OK") to the chosen provider and shows the status and latency. It costs a fraction of a cent, runs
only when clicked, and is audited. This is **left out of the first cut** unless the user wants it.

## Voice confirmation dialog (site UI, requested 2026-11-27)

The user asked for this: *"voice thì nó ra 1 modal → STT (2 lần) ra văn, đúng ý user, user bấm OK thì mới vào khung chat"*
(voice opens a modal → STT runs (2 calls) and produces text → only when the user is satisfied and
presses OK does it go into the chat).

Restated by the user (final): *"Bấm mic thì mở modal Speak your request: có đồng hồ, thanh âm lượng, nút Cancel và Done > user nói: thì STT -> sau đó tự repair lại -> show text ra modal cho khách review + edit nếu cần (có vài gợi ý nếu câu đó nhiều nghĩa), sau đó done -> vào khung hội thoại"*.
So the review step's confirm button is labelled **Done**, the same word as the recording step's Done. The
"Did you mean" chips are the repair pass's `alternatives`; they are shown only when the sentence is
ambiguous: the repair prompt returns up to 2 only with `confidence: "low"` (`apps/api/src/lib/guestVoice.ts:177-178`), otherwise none. No change is needed there.

**Today:** voice works inline. The recording bar replaces the composer row, and the transcript lands in
the text field. The guest then presses Send (`apps/site/src/app/quote/components/VoiceComposer.tsx:8-28`,
`:128-154`). There is no modal.

**New flow:** a native `<dialog>` opened with `showModal()`, the same pattern as
`components/AccountDialog.tsx:34,79` (class `g-dialog`):

```
(mic) ─▶ ┌ Speak your request ───────────────────┐
         │ ● 0:07 / 1:00   ▂▅▇▅▂                 │   recording
         │                      [Cancel] [Done]  │
         └───────────────────────────────────────┘
   Done ─▶ ◌ Listening back…                          transcribing (one request to /transcribe; the
                                                      server makes the 2 calls: STT, then repair)
        ─▶ ┌ Is this what you said? ─────────────────┐
           │ [ add a 3 metre roller door on the ]   │   review: editable textarea, pre-filled
           │ Did you mean: (3.3 m door) (3 m doors) │   chips swap the text (same as today)
           │ ⚠ 30 m is wider than this shed allows  │   numberWarnings (amber)
           │ [Record again] [Cancel]          [Done]│
           └────────────────────────────────────────┘
   Done ─▶ dialog closes, the text is posted to the chat thread as the guest's message (the assistant answers)
   Cancel / Esc ─▶ dialog closes, nothing reaches the chat
```

Rules:

- **Nothing enters the chat without Done.** The component's rule changes from "speech never sends itself
  (the guest presses Send)" to "speech never sends itself (the guest presses Done in the dialog)". Update
  the header comment.
- Done is disabled while the textarea is empty. **Ctrl/⌘+Enter** means Done; Enter inserts a new line.
- **Off-topic** (`onTopic:false`): the dialog shows the existing hint and the panel's `examples` as
  chips; a tap fills the textarea. Done still works after the guest edits the text.
- **Errors shown inside the dialog:**
  - `denied`, `no_device`, `too_short`, `failed`, `unavailable` and empty, using the existing `HINTS`
    texts;
  - buttons **Try again** and **Type instead**. Type instead closes the dialog and focuses the chat
    text field.
- **Record again** throws away the reading and starts a new recording inside the same dialog.
- The recorder lives **inside the dialog component**. Closing the dialog unmounts it, which stops the
  microphone stream. This keeps today's guarantee that a mounted, hidden panel holds no live stream
  (`VoiceComposer.tsx:30-34`).
- **A11y:**
  - `aria-labelledby` on the title;
  - focus moves to the textarea in review;
  - the existing `aria-live` announcements stay ("Transcript ready — check it, then press Done");
  - focus returns to the mic button on close.
- The composer row keeps its text field, mic and Send. The mic now only opens the dialog, and the
  inline recording bar is removed.
- **No API or contract change.** The client still makes one `POST /public/guest/assistant/transcribe`
  call. Quotas and the `unavailable` path are unchanged.

Files:
- new `apps/site/src/app/quote/components/VoiceDialog.tsx`, which takes over the recorder, the result
  state, the chips and the warnings from `VoiceComposer.tsx`;
- `VoiceComposer.tsx`, simplified so it holds only the mic button and the dialog's open state;
- dialog styles next to the existing `g-dialog` styles (navy/gold tokens, `design-system/smartquote-v2/MASTER.md`).

On Done the dialog calls `onChange(text)` and then the composer's `onSend()`. No new send path is added.

**Verify** (coder self-check, no new tests unless asked):
- `pnpm --filter @sq/site build`.
- Then in the browser at `localhost:3063`: stub `/api/sq/public/guest/assistant/transcribe` with a
  fixed JSON (Playwright `page.route` or devtools override) and walk through record, review, Done; check
  that one message appears in the thread. Walk Cancel and check that nothing appears. Check the
  off-topic case and an error case.
- Use Chrome's fake microphone (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`)
  so no real recording is needed.

## Env vars

| Var | Default | Note |
|---|---|---|
| `GEMINI_API_KEY` | empty (provider not configured) | **new.** The key from the user's private note goes **only into the local `.env`, by hand.** It must be an authorization key or a restricted standard key (R§4) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | new; default when no DB row |
| `GEMINI_STT_MODEL` | equals `GEMINI_MODEL` | new |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | new; for tests and proxies |
| `GEMINI_THINKING_LEVEL` | `minimal` | new |
| `AI_PRIMARY` | `gemini` | new; default when no DB row |
| `AI_FALLBACK` | `vilao` | new; `vilao \| gemini \| none` |
| `VILAO_API_KEY`, `VILAO_BASE_URL`, `VILAO_MODEL`, `VILAO_STT_MODEL` | as today | **kept** (fallback) |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | — | **removed** (D6) |

- Unchanged: `GUEST_ASSISTANT_ENABLED`, `NEXT_PUBLIC_SQ_ASSISTANT`, `GUEST_ASSISTANT_DAILY_TURNS`,
  `GUEST_ASSISTANT_VOICE`, `GUEST_ASSISTANT_DAILY_VOICE`, and `GUEST_PLACES_ENABLED=1`.
- **`turbo.json` `globalPassThroughEnv`:** add the 5 `GEMINI_*` vars plus `AI_PRIMARY` and
  `AI_FALLBACK`; remove the 3 legacy `AI_*`; keep the `VILAO_*` vars.
- **`.env.example`:** add a GEMINI block with an empty key, add `AI_PRIMARY` and `AI_FALLBACK`, and
  remove the legacy `AI_*` block.
- `assistantEnabled(env)` changes: `GUEST_ASSISTANT_ENABLED` must be on **and at least one provider
  key is set**.

## Contract changes

- **Guest contracts:** none (`assistant.ts` is unchanged).
- **New:** `aiSettings.ts`, and `'platform:ai'` in `roles.ts`.
- If the probe shows `audio/mp4` fails even when sent as `audio/m4a`, do not touch the contract.
  Safari's mp4 audio would then go to vilao by fallback, which accepts it today.

## Tests (default is development-only; these are the existing gateway tests rewritten plus the new paths)

The API tests inject `fetchImpl`, so they make no network calls.

1. **Gemini adapter: outgoing request.** Assert:
   - the URL;
   - the header (and that the key is not in the URL);
   - `systemInstruction`;
   - `user`/`model` roles;
   - `responseJsonSchema`;
   - **no `temperature`**;
   - the last turn is never `model`.
2. **Gemini adapter: response parsing.**
   - multiple parts;
   - a `thought` part is skipped;
   - `SAFETY` → `blocked`;
   - `blockReason` → `blocked`;
   - bad JSON → `invalid`;
   - `transcribe` sends `inlineData` with `audio/mp4` mapped to `audio/m4a` and includes the vocabulary
     hint.
3. **vilao adapter:** port the existing gateway tests unchanged. This is the regression proof that the
   fallback still behaves like today.
4. **Router:**
   - Gemini 503 → vilao answers, and the result is vilao's.
   - Gemini `blocked` → **no** fallback.
   - Gemini times out with < 5 s left → no fallback, failure returned.
   - Primary not configured → the fallback acts as primary.
   - `fallback: none` → Gemini retries once on 503.
   - Neither provider configured → failure.
5. **Admin settings route:**
   - `platform_support` gets 403;
   - `platform_admin` can GET and PUT;
   - PUT validates (fallback equal to primary is rejected) and writes an audit row;
   - GET never contains a key value, only booleans.
6. **Route tests** for turn, transcribe, quotas and `unavailable` pass **unchanged**.

Commands:

```bash
TEST_DATABASE_URL=postgres://…/smartquote_test pnpm --filter @sq/api test
pnpm typecheck
pnpm --filter @sq/admin build
```

E2E needs no change.

## Limited real probe (needs the user's OK; costs fractions of a cent)

`scripts/probe-gemini.mjs` sits next to the existing `probe-stt.mjs`, which stays because vilao
stays.
- It reads `.env` and never prints the key. With no key it exits 0.
- It makes **at most 3 calls**:
  1. an assistant turn with the real `REPLY_JSON_SCHEMA`, to check the schema size and the ops;
  2. STT of a short local clip given with `--file` (webm, or m4a to test the Safari mapping);
  3. optionally `--repair`.
- It prints status, `finishReason`, `usageMetadata` and the result.
- Never run it in CI, and never on guest data.
- Write the results into the research note's "Open items".

## Slices (each builds and runs on its own)

1. **Refactor with no behaviour change.**
   - Split `gateway.ts` into `ai/schemas.ts` + `ai/vilao.ts` + `ai/index.ts`. The router has only
     vilao in it.
   - Callers import from `./ai/index.js`.
   - Existing tests pass. This step is "make the change easy".
2. **Gemini adapter, probe and tests.**
   - Add `ai/gemini.ts` and `probe-gemini.mjs`, plus the adapter tests.
   - Run the probe after the user approves; apply the `maxItems` mitigation if it is needed.
3. **Router fallback and env.**
   - Add the primary/fallback logic and the budgets from env (`AI_PRIMARY`/`AI_FALLBACK`), plus the
     router tests.
   - Edit `.env.example` and `turbo.json`.
   - Smoke-check `pnpm dev` and one real turn (only with the key in `.env` and the user's OK).
4. **Admin config.**
   - Add migration 025, the contracts and capability, `settings.ts` with its cache, the admin route,
     the admin page and the route tests.
   - Check `pnpm db:migrate`, then open `localhost:3062/ai`: change the primary, save, and confirm the
     next turn uses it (the log line shows which provider answered).
5. **Voice confirmation dialog** (site only; independent of slices 1–4).
   - Add `VoiceDialog.tsx` and simplify `VoiceComposer.tsx`, as in "Voice confirmation dialog".
   - Run the site build, then walk the browser flow with a stubbed transcribe response.
6. **Docs.**
   - `docs/OPERATIONS.md`: providers, keys in `.env` only, key rotation means a restart, reading rate
     limits in AI Studio, Tier 1 spend limits, the admin page.
   - Any spec in `docs/specs/` that describes the voice composer: record → dialog → Done.
   - `docs/state/quote-tiers.md`.
   - The comment in `jsonSchema.ts`.
   - A `docs/DECISIONS.md` row: Gemini primary via `generateContent`, vilao fallback, provider chosen
     in admin, secrets stay in env.
   - CHANGELOG.
7. **Review.** Check spec and standards separately. Confirm `git diff` has no secret.

Leave everything uncommitted unless the user says otherwise. Never push.

## Risks

| Risk | Mitigation |
|---|---|
| `OPS_SCHEMA` is rejected by Gemini (400), so every turn silently falls back to vilao | probe in slice 2; log a warning when the fallback fires on a 400; drop `maxItems` from the Gemini copy |
| Safari `audio/mp4` is refused | map it to `audio/m4a`; otherwise the router falls back to vilao for that clip |
| The key is an unrestricted standard key, so Gemini always returns 403 | the probe shows it; the user restricts the key in AI Studio or Cloud console |
| Longer worst-case latency (up to 25 s) | primary share of 14 s; the client and bridge timeouts must be checked (see "Not yet checked") |
| An admin mis-sets a model id, so the primary always fails | the fallback still answers; the log shows it; the optional "Test connection" button |
| Fallback hides a dead primary for weeks | the log line names the provider; add a count of fallback firings to the admin page later (not in scope) |
| Tier 1 spend limit ($10 per 10 min) or burst 429 | the existing per-IP, per-session and daily quotas; the vilao fallback covers a 429 |
| vilao is itself unstable | it is only the fallback; worst case is today's "unavailable" path |

## Definition of done

- Gemini answers turn, repair and STT by default.
- Making Gemini fail (for example with a bad model id in admin) makes vilao answer.
- Admin can switch primary and fallback, and the change is audited.
- No key is stored in the database or shown in the UI.
- API tests pass, the typecheck is clean, and the admin build passes.
- The probe ran once with the user's consent.
- Docs, DECISIONS and CHANGELOG are updated.
- Nothing is pushed.

---

## Execution prompt (copy into the coding AI)

```text
You are working in the SmartQuote v2 monorepo (pnpm + Turborepo, Node >= 22, Fastify API in apps/api,
Next.js front-ends incl. apps/admin). Read CLAUDE.md, docs/plans/2026-11-27-gemini-migration.md and
docs/research/2026-11-27-gemini-3.5-flash-lite.md first. Implement the plan exactly; do not widen scope.

Goal: Google Gemini direct (model gemini-3.5-flash-lite, generateContent API) becomes the PRIMARY provider
for the Guest AI Assistant turn (JSON), transcript repair (JSON) and voice STT; the existing vilao gateway
stays as automatic FALLBACK. A platform admin chooses primary/fallback/models in apps/admin. Guest
contracts, routes, quotas and redaction do not change. Voice stays two calls (STT text, then repair JSON).

Hard rules:
- Never print, log or write any API key or the contents of .env, docs/note.md or note_private_ignore/.
  Keys live ONLY in .env (GEMINI_API_KEY, VILAO_API_KEY). Never store a key in the database (migration 008
  dropped platform_settings for exactly this reason); admin shows only "key set: yes/no".
- Never push. Do not commit unless the user explicitly says so. Keep each file's existing line endings.
- Use localhost, never 127.0.0.1. GUEST_PLACES_ENABLED stays 1.
- No real (paid) Gemini/vilao call without the user's explicit OK; tests use injected fetchImpl only.
- Applied migrations are checksummed: add a new file, never edit an old one. Use ? placeholders,
  TEXT uuid ids, ISO-8601 TEXT timestamps.

Slices (each must typecheck/run before the next):
1. Refactor, no behaviour change: split apps/api/src/lib/ai/gateway.ts into ai/schemas.ts (REPLY_JSON_SCHEMA,
   OPS_SCHEMA, REPAIR_JSON_SCHEMA), ai/vilao.ts (today's code, unchanged behaviour) and ai/index.ts (router
   exporting completeReply, repairTranscript, transcribe, assistantConfigFromEnv-equivalent). Point
   guestAssistant.ts and routes/guest.ts at ./ai/index.js. Existing tests must pass.
2. ai/gemini.ts implementing the same AiProvider interface: POST {GEMINI_BASE_URL}/models/{model}:generateContent,
   header x-goog-api-key; system messages -> systemInstruction.parts, user -> 'user', assistant -> 'model';
   never end contents with a 'model' turn; JSON jobs use generationConfig.responseMimeType='application/json'
   + responseJsonSchema (schema without OpenAI name/strict) + thinkingConfig.thinkingLevel + maxOutputTokens
   (~1024 turn, ~512 repair); NEVER send temperature/topP/topK/candidateCount. Parse candidates[0].content.parts
   text, skip thought parts; blockReason or finishReason SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT/SPII ->
   reason 'blocked'; MAX_TOKENS or bad JSON -> 'invalid'. STT: parts [{inlineData:{mimeType,data}},
   {text:"Transcribe this English (Australian) audio verbatim. Output only the words spoken, no commentary. If
   there is no speech, output an empty string.\n"+shedSttPrompt}], plain text, trim, strip quotes/"Transcript:",
   cap REPAIR_MAX_CHARS; map audio/mp4 -> audio/m4a. Add scripts/probe-gemini.mjs (reads .env, never prints the
   key, exits 0 without key, max 3 calls: turn with real REPLY_JSON_SCHEMA, STT of --file, optional --repair).
   DO NOT run it unless the user says so. If the reply schema gets a 400, drop maxItems in the Gemini copy only
   and ensure parseOps caps ops at 10. Write adapter tests.
3. Router: primary then fallback. Fallback fires on timeout/network/429/5xx/402/403/400/invalid JSON/empty STT
   with audio >= 1.5 s; NOT on 'blocked'. Budgets: turn and STT 25 s total (primary up to 14 s, fallback only
   if >= 5 s left); repair 8 s (primary 5 s, fallback only if >= 2 s left). With a fallback enabled Gemini does
   no internal retry; with fallback 'none' retry once on 429/500/503/504/network after 500-1000 ms jitter.
   Never retry 400/402/403/404. If primary has no key, use the fallback as primary. One log line per call
   (job, provider, status, fallbackFired, latency, usage tokens) - never bodies, audio or keys.
   assistantEnabled = GUEST_ASSISTANT_ENABLED on AND at least one provider key set.
   Env: add GEMINI_API_KEY, GEMINI_MODEL=gemini-3.5-flash-lite, GEMINI_STT_MODEL (defaults to GEMINI_MODEL),
   GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta, GEMINI_THINKING_LEVEL=minimal,
   AI_PRIMARY=gemini, AI_FALLBACK=vilao; keep VILAO_*; remove legacy AI_BASE_URL/AI_API_KEY/AI_MODEL.
   Update .env.example (empty keys) and turbo.json globalPassThroughEnv accordingly. Router tests.
   Also read apps/site/src/app/api/sq/[...path]/route.ts and apps/site/src/app/quote/assistantStore.ts and make
   sure no client-side timeout is shorter than 25 s.
4. Admin config: migration packages/db/migrations/025_ai_settings.sql (single row id='global': primary_provider,
   fallback_provider, gemini_model, gemini_stt_model, gemini_thinking, vilao_model, vilao_stt_model, updated_at,
   updated_by; no tenant_id; no row = env defaults). packages/contracts/src/aiSettings.ts (zod; fallback != primary
   unless 'none'; model id ^[a-z0-9][a-z0-9._/-]{1,63}$; view adds geminiKeySet, vilaoKeySet, source).
   Add 'platform:ai' to CAPABILITIES and to platform_admin only (packages/contracts/src/roles.ts).
   apps/api/src/lib/ai/settings.ts effectiveAiSettings(db) with a 30 s cache invalidated on save.
   apps/api/src/routes/aiSettingsAdmin.ts: GET/PUT /admin/ai-settings with requirePlatformCapability(...,
   'platform:ai'), PUT audited via lib/audit.ts in the same transaction; register in app.ts.
   apps/admin/src/app/ai/page.tsx "AI assistant" (primary/fallback selects incl. None, model fields, thinking
   select, key-set badges, Save) using @sq/ui and the navy/gold tokens, plus a nav link. Route tests
   (support role 403, admin ok, validation, audit row, no key value in GET). Run pnpm db:migrate and check
   localhost:3062/ai.
5. Voice confirmation dialog (apps/site only, no API/contract change). Today the transcript lands inline in the
   composer field (apps/site/src/app/quote/components/VoiceComposer.tsx). Change it to: mic button opens a native
   <dialog> via showModal() (same pattern/class g-dialog as components/AccountDialog.tsx) with states
   recording (timer, level bars, Cancel/Done) -> transcribing ("Listening back...", still ONE POST to
   /public/guest/assistant/transcribe; the server does STT + repair) -> review (editable textarea pre-filled,
   "Did you mean" chips that swap text, amber numberWarnings, off-topic hint + example chips, buttons
   Record again / Cancel / Done). Done (disabled when empty; Ctrl/Cmd+Enter) closes the dialog, calls onChange(text)
   then the existing onSend() so the text is posted to the chat thread; Cancel/Esc closes and nothing reaches
   the chat. Errors (denied/no_device/too_short/failed/unavailable/empty) show inside the dialog with existing
   HINTS texts and Try again / Type instead (closes, focuses the chat field). Put the recorder inside a new
   VoiceDialog.tsx so closing unmounts it and stops the mic stream; VoiceComposer keeps text field, mic, Send.
   A11y: aria-labelledby, focus textarea on review, keep aria-live announcements, return focus to mic on close.
   Update the component header comment ("speech never sends itself - the guest presses Done"). Navy/gold tokens.
   Verify: pnpm --filter @sq/site build; at localhost:3063 stub the transcribe route with fixed JSON (page.route
   or devtools) and Chrome fake media flags; check Done -> exactly one message in the thread, Cancel -> none,
   off-topic and an error case.
6. Docs: docs/OPERATIONS.md (providers, keys only in .env + restart to rotate, Tier 1 spend limits, AI Studio
   rate-limit page, admin page), docs/state/quote-tiers.md, comment in packages/core/src/domain/jsonSchema.ts,
   docs/DECISIONS.md row, any docs/specs voice-composer description, CHANGELOG.
7. Verify: TEST_DATABASE_URL=postgres://.../smartquote_test pnpm --filter @sq/api test ; pnpm typecheck ;
   pnpm --filter @sq/admin build ; pnpm --filter @sq/site build ; git diff contains no key. Leave everything uncommitted and report a short
   summary with file:line references.
```
