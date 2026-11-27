# Plan — live voice dictation for the Guest assistant (Web Speech + Gemini)

Status: implemented 2026-11-27, uncommitted. The user chose "Web Speech + Gemini". Checked in the browser with a stubbed microphone, recogniser and transcribe call (no real speech, no paid call). Departures from the design below: no separate `VoiceCapture` child — both hooks release the mic on unmount and the composer cancels on `active=false` / hidden tab; `setAutoStop()` instead of `start({ autoStop })`; the mic still hides when the server reports voice unavailable; `GUEST_ASSISTANT_DAILY_VOICE` default raised 100 → 300.

## Goal
- Words appear **while the guest speaks**, from the browser's free Web Speech API (`SpeechRecognition`, interim results).
- When they stop, the recording goes to the existing `POST public/guest/assistant/transcribe` endpoint (Gemini flash-lite, about $0.0005 a minute). The accurate text replaces the live draft.
- Each take is **appended** to the composer text. Speaking again adds more.
- **Speech never sends itself**: the guest still presses Send.

## Facts read (2026-11-27)
- `gemini-3.5-transcribe-live`: about $0.009/min, over WebSocket. Not chosen.
- `SpeechRecognition` support (MDN BCD):
  - Chrome/Edge 139+, Chrome Android 139, Firefox 160; Safari 14.1 / iOS 14.5 with the `webkit` prefix.
  - Interim results work in all of them.
  - `processLocally` works only on desktop Chrome/Edge 139+ and Firefox 160. By default Chrome sends the audio to Google.
- The current flow:
  - `components/VoiceDialog.tsx`: record, Done, transcribe, review (alternatives, number warnings, off-topic chips), Done, send.
  - `useVoiceRecorder.ts`: stops by itself after 2 s of silence and at 60 s.
  - Server limits in `apps/api/src/lib/guestAssistant.ts:61`: `voicePerIpDay` 30, `voicePerSession` 20. The platform cap is `GUEST_ASSISTANT_DAILY_VOICE`, default 100.

## Design
1. **One mic button in `VoiceComposer`, two gestures:**
   - **Tap** (press under 300 ms): start. The button turns into ⏹. Tap again, or 2 s of silence, stops.
   - **Hold** (300 ms or more): push-to-talk. Releasing stops, and silence does not stop it, for noisy sites.
   - **Keyboard:** Enter toggles. Holding Space on the mic is push-to-talk.
   - Ignore the synthetic `click` after pointer or key handling (`event.detail === 0` is the keyboard case).
2. **Recording UI replaces the dialog**, in a strip under the input:
   - red dot, clock, wave;
   - the live interim text shown greyed.
   - Show the strip while recording and while transcribing.
3. **The mic must go out when the strip unmounts.** Keep the recorder and the recogniser in a child `VoiceCapture` component that is mounted only while a take is active.
   - `AssistantPanel` is hidden, not unmounted, so also stop when the panel hides. `DesignPanel.tsx:185` `closeAssistant` passes the hide.
4. **New `useLiveSpeech.ts`:**
   - Wraps `SpeechRecognition` / `webkitSpeechRecognition` with `lang='en-AU'` (check: the en-AU vs en-US choice), `interimResults=true`, `continuous=true`.
   - Returns `{ supported, interim, final, start, stop }`.
   - Runs alongside `MediaRecorder` on the same take. If the two conflict on iOS Safari, skip live text there.
5. **On stop:**
   - Call `transcribeVoice`.
   - Success: append `result.text` to the composer value, with a space between takes.
   - Show the alternatives, number-warning and off-topic chips under the composer until the guest edits or sends. Move the logic from `VoiceDialog` (`pickAlternative` replaces only the last take).
   - `null` (failed or rate-limited): append the Web Speech final text if there is any, otherwise show an error line.
   - `unavailable`: Web Speech alone still works, so do not hide the mic when live speech is supported.
6. **`useVoiceRecorder.start({ autoStop })`:** silence auto-stop is on for tap and off for hold.
7. **Limits:** each take is one paid call, so raise `voicePerIpDay` to 60 and `voicePerSession` to 40. Check `GUEST_ASSISTANT_DAILY_VOICE` on prod (`/opt/smartquote-v2/app.env.production`).
8. **Clean-up:**
   - Remove `VoiceDialog.tsx`, or keep it only if nothing else uses it.
   - Update the comments in `AssistantPanel.tsx:291` and `VoiceComposer.tsx`, the `guest.css` voice styles, and `docs/smartquote-quote-editor-reference.md`.

## Verify
- `pnpm --filter @sq/site typecheck` and `pnpm --filter @sq/api typecheck`.
- `pnpm dev`, then open `http://localhost:3063/quote`. Try a tap take, a hold take and two takes appended. Check that hiding the panel turns the mic off and that nothing is sent without Send.
- No e2e spec covers voice yet.
