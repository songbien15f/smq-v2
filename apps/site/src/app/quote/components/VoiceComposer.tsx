'use client';

/**
 * The assistant's composer: the text field, the microphone, and the recording bar that replaces them.
 *
 * ## The rule this component exists to keep
 *
 * **Speech never sends itself.** A transcript lands in the text field with the cursor at the end, and
 * the visitor reads it and presses Send. A recogniser that hears "nine" as "five" would otherwise change
 * a design behind their back, and a design change can be the difference between one door and two.
 *
 * ## The four shapes of the row
 *
 * ```
 * idle / error   [ e.g. make it 9 metres wide ]  (mic)  [Send]
 * recording      [ ● 0:07 / 1:00  ▂▅▇▅▂  ]  [Cancel] [Done]
 * transcribing   [ ◌ Listening back… ]
 * done           [ add a 3 metre roller door on the f ]  (mic)  [Send]
 * ```
 *
 * ## Why it is not in `AssistantPanel`
 *
 * The panel owns the thread; this owns the microphone, its permission errors and the words it produced.
 * Keeping the recorder out of the panel is what lets the panel stay mounted and hidden without holding a
 * live stream.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isVoiceUnavailable, transcribeVoice, useAssistant } from '../assistantStore';
import { useVoiceRecorder, type VoiceError } from '../useVoiceRecorder';
import { IconMic, IconStop } from './icons';

/** What the hint under the row is saying. `null` is the standing AI disclaimer. */
type Hint = 'ready' | 'offtopic' | 'empty' | 'voice_off' | 'denied' | 'no_device' | 'too_short' | 'failed' | null;

const HINTS: Record<Exclude<Hint, null>, string> = {
  ready: 'Check the words, then press Send.',
  offtopic: 'I can only help with the shed design \u2014 try \u201cadd a window on the left wall\u201d.',
  empty: 'Didn\u2019t catch that \u2014 try again or type it.',
  voice_off: 'Voice input isn\u2019t available right now \u2014 type your request instead.',
  denied: 'Microphone blocked \u2014 allow it in the browser\u2019s address bar, or type instead.',
  no_device: 'No microphone found \u2014 type instead.',
  too_short: 'That was too short \u2014 hold on for a moment and speak.',
  failed: 'Couldn\u2019t make that out \u2014 try again or type it.',
};

const ERROR_HINT: Record<VoiceError, Exclude<Hint, null>> = {
  denied: 'denied',
  no_device: 'no_device',
  too_short: 'too_short',
  failed: 'failed',
};

/** `0:07` — minutes and two-digit seconds. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function VoiceComposer({
  typeId,
  busy,
  value,
  onChange,
  onSend,
  inputRef,
}: {
  typeId: string;
  busy: boolean;
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const recorder = useVoiceRecorder();
  const voiceUnavailable = useAssistant((s) => s.voiceUnavailable);
  const [hint, setHint] = useState<Hint>(null);
  /** What a screen reader is told, in words rather than every tick of the clock. */
  const [announce, setAnnounce] = useState('');
  const showMic = recorder.supported && !voiceUnavailable;
  /*
   * The draft and its setter, read by the transcript callback. The callback is registered once and must
   * see the field as it is *then*, not as it was when the effect ran.
   */
  const latestRef = useRef({ value, onChange });
  latestRef.current = { value, onChange };

  // The recorder's own errors are what the hint shows; reaching into it once, here, keeps the row free
  // of conditionals spread through its markup.
  useEffect(() => {
    if (recorder.error === null) return;
    setHint(ERROR_HINT[recorder.error]);
    setAnnounce(recorder.error === 'too_short' ? 'Too short' : 'Microphone unavailable');
  }, [recorder.error]);

  const focusEnd = useCallback(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {
      /* some browsers refuse selection on a focused field; the cursor is at the end anyway */
    }
  }, [inputRef]);

  useEffect(() => {
    recorder.onDone((blob, mimeType, durationMs) => {
      void (async () => {
        const result = await transcribeVoice(blob, mimeType, durationMs, typeId);
        if (result === null) {
          /*
           * Two different truths. If the server answered `unavailable`, the recording was never heard at
           * all — saying "didn't catch that" would blame the visitor's speech for a switched-off service.
           * `isVoiceUnavailable()` reads the store after the call, because the sticky flag is set there.
           */
          const off = isVoiceUnavailable();
          setHint(off ? 'voice_off' : 'empty');
          setAnnounce(off ? 'Voice input is unavailable' : 'No transcript');
        } else if (result.text.trim() === '') {
          setHint('empty');
          setAnnounce('No transcript');
        } else {
          /*
           * `latestRef` rather than the closed-over `value`: the effect that registers this callback
           * runs rarely, and a draft typed between two recordings must not be overwritten by a stale
           * copy of the field.
           */
          const current = latestRef.current.value;
          const next = current.trim() === '' ? result.text : `${current.trimEnd()} ${result.text}`;
          latestRef.current.onChange(next);
          setHint(result.onTopic ? 'ready' : 'offtopic');
          setAnnounce('Transcript ready — check it, then send');
          focusEnd();
        }
        recorder.reset();
      })();
    });
    // `recorder` is a fresh object each render by design; the callback is only stored, never run here.
  });

  // Esc cancels a recording wherever focus is inside the panel; the plan asks for it on the row too.
  useEffect(() => {
    if (recorder.state !== 'recording') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        recorder.cancel();
        setAnnounce('Recording cancelled');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recorder]);

  const startRecording = () => {
    setHint(null);
    setAnnounce('Recording');
    void recorder.start();
  };

  const recording = recorder.state === 'recording' || recorder.state === 'requesting';
  const transcribing = recorder.state === 'transcribing';
  /** Ten seconds left is when the clock turns amber: enough time to finish a sentence. */
  const nearLimit = recorder.elapsedMs >= recorder.maxMs - 10_000;

  const hintText = hint === null ? 'AI can make mistakes — check the plan. It never sends your request.' : HINTS[hint];

  return (
    <>
      <label className="g-sr-only" htmlFor="g-assistant-input">
        Message the assistant
      </label>

      {recording ? (
        <div className="g-voice-rec" role="group" aria-label="Recording your request">
          <span className="g-voice-dot" aria-hidden="true" />
          <span className={`g-voice-clock${nearLimit ? ' g-voice-clock-warn' : ''}`} aria-hidden="true">
            {clock(recorder.elapsedMs)} / {clock(recorder.maxMs)}
          </span>
          <span className="g-voice-wave" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <span
                key={i}
                // Eight bars, each with a different share of the level, so it reads as a wave.
                style={{ transform: `scaleY(${0.15 + Math.min(1, recorder.level) * (0.35 + ((i * 7) % 10) / 12)})` }}
              />
            ))}
          </span>
          <button type="button" className="g-voice-cancel" onClick={() => recorder.cancel()}>
            Cancel
          </button>
          <button
            type="button"
            className="g-voice-done"
            disabled={recorder.state === 'requesting'}
            onClick={() => recorder.stop()}
          >
            <IconStop />
            Done
          </button>
        </div>
      ) : null}

      {transcribing ? (
        <div className="g-voice-busy" role="status">
          <span className="g-voice-spinner" aria-hidden="true" />
          Listening back…
        </div>
      ) : null}

      {recording || transcribing ? null : (
        <div className="g-assistant-row">
          <input
            ref={inputRef}
            id="g-assistant-input"
            className="g-input"
            type="text"
            maxLength={1000}
            placeholder="e.g. make it 9 metres wide"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
          />
          {showMic ? (
            <button
              type="button"
              className="g-mic-btn"
              aria-label="Speak your request"
              aria-pressed={false}
              disabled={busy}
              onClick={startRecording}
            >
              <IconMic />
            </button>
          ) : null}
          {/*
            A plain button, not a submit: the form's onSubmit and this onClick would otherwise both run
            send() for one click.
          */}
          <button type="button" className="g-btn g-btn-primary" disabled={busy || value.trim() === ''} onClick={onSend}>
            {busy ? '…' : 'Send'}
          </button>
        </div>
      )}

      <p className={`g-hint${hint === null ? '' : ' g-voice-hint'}`}>{hintText}</p>
      {showMic && value.trim() === '' && hint === null ? (
        <p className="g-voice-invite">
          Tap the mic and say what you want — e.g. <em>add a roller door on the front</em>.
        </p>
      ) : null}
      <p className="g-sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}
