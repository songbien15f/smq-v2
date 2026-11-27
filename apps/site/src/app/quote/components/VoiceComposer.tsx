'use client';

/**
 * The assistant's composer: a text box, a microphone and Send — and live dictation into that box.
 *
 * ## The rule this component exists to keep
 *
 * **Speech never sends itself.** Each spoken take is turned into words and *added to the box*; only Send
 * sends. A recogniser that hears "nine" as "five" would otherwise change a design behind the guest's
 * back, and a design change can be the difference between one door and two.
 *
 * ```
 * [ make it 9 metres wide and add a roller door|  ]  (mic)  [Send]
 *  ● 0:04  ▂▅▇▅▂  "on the front…"            (×)      ← while speaking: live words, greyed
 *  ◌ Checking the words…                              ← after: the server's accurate transcript
 *  Did you mean (…) (…)      ⚠ 30 m is wider than…    ← review helpers for the last take
 * ```
 *
 * ## One mic, two gestures (2026-11-27)
 *
 * - **Tap** — start; tap again (the mic is now ⏹) or pause for two seconds to finish. The web's habit
 *   (ChatGPT, Gemini dictation).
 * - **Hold** (≥ 300 ms) — push-to-talk: release to finish, and quiet does not end it, because a noisy
 *   site is never quiet. The phone's habit.
 * - **Keyboard** — Enter toggles; holding Space on the mic is push-to-talk.
 *
 * ## Two recognisers, one answer
 *
 * The browser's recogniser (`useLiveSpeech`, free) shows words as they are said. The recording
 * (`useVoiceRecorder`) goes to the server when the take ends — Gemini plus the shed-vocabulary repair —
 * and that text is what lands in the box. If the server cannot answer, the browser's words are used
 * instead, so a take is never lost to a quota.
 *
 * ## The microphone goes out
 *
 * The panel is hidden, not unmounted, when it slides away. `active` goes false then, and so does a
 * hidden tab; either ends the take and stops every track. Unmounting does the same (both hooks).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isVoiceUnavailable, transcribeVoice, useAssistant } from '../assistantStore';
import { useLiveSpeech } from '../useLiveSpeech';
import { useVoiceRecorder, type VoiceError } from '../useVoiceRecorder';
import { IconMic, IconStop } from './icons';

/** A press at least this long is a hold (push-to-talk), shorter is a tap. */
const HOLD_MS = 300;

const RECORDER_TEXT: Record<VoiceError, string> = {
  denied: 'Microphone blocked — allow it in the browser’s address bar, or type instead.',
  no_device: 'No microphone found — type instead.',
  too_short: 'That was too short — hold the mic a moment longer while you speak.',
  failed: 'Couldn’t record that — try again or type it.',
};

/** `0:07` — minutes and two-digit seconds. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The end of a long live line: the newest words are the ones the guest is watching for. */
function tail(text: string): string {
  return text.length > 60 ? `…${text.slice(-60)}` : text;
}

/** `base` plus one more take, with a single space between them. */
function appendTake(base: string, take: string): string {
  const head = base.replace(/\s+$/, '');
  return head === '' ? take : `${head} ${take}`;
}

/** What the review helpers say about the last take. Cleared when the guest edits or sends. */
interface TakeReview {
  /** The words this take put in the box, so a picked reading replaces exactly those. */
  take: string;
  alternatives: string[];
  warnings: string[];
  offTopic: boolean;
  /** The server could not answer and the browser's words were used. */
  fromBrowser: boolean;
}

export function VoiceComposer({
  typeId,
  busy,
  active = true,
  value,
  onChange,
  onSend,
  inputRef,
  examples,
}: {
  typeId: string;
  busy: boolean;
  /** False while the panel is off screen: any take in progress is cancelled. */
  active?: boolean;
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Next steps that make sense for this design, offered when the guest's words were off topic. */
  examples: string[];
}) {
  const voiceUnavailable = useAssistant((s) => s.voiceUnavailable);
  const recorder = useVoiceRecorder();
  const live = useLiveSpeech();

  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<TakeReview | null>(null);
  const [holding, setHolding] = useState(false);
  const [announce, setAnnounce] = useState('');

  /* The latest values, for callbacks that finish after the render that made them. */
  const valueRef = useRef(value);
  valueRef.current = value;
  const stateRef = useRef(recorder.state);
  stateRef.current = recorder.state;

  /* Press bookkeeping: when it began, whether it became a hold, and whether this press stops a take. */
  const pressAt = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(false);
  const stopOnRelease = useRef(false);
  /** A key already handled this press, so the button's synthetic click does not toggle a second time. */
  const keyHandled = useRef(false);

  const recording = recorder.state === 'recording' || recorder.state === 'requesting';
  const showMic = recorder.supported && !voiceUnavailable;

  /* The box grows with its text, up to the CSS max-height, so several takes stay readable. */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const beginTake = () => {
    if (busy || checking || stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    setProblem(null);
    setAnnounce('Recording');
    holdRef.current = false;
    setHolding(false);
    live.start();
    void recorder.start();
  };

  const finishTake = () => {
    clearHoldTimer();
    holdRef.current = false;
    setHolding(false);
    recorder.stop();
  };

  const cancelTake = () => {
    clearHoldTimer();
    holdRef.current = false;
    setHolding(false);
    live.abort();
    recorder.cancel();
    setAnnounce('Recording cancelled');
  };

  /* A take ends however it ends — tap, release, quiet, the 60 s ceiling: transcribe and add. */
  useEffect(() => {
    recorder.onDone((blob, mimeType, durationMs) => {
      const heard = live.stop();
      setChecking(true);
      setAnnounce('Checking the words');
      void (async () => {
        const result = await transcribeVoice(blob, mimeType, durationMs, typeId);
        recorder.reset();
        setChecking(false);
        const serverText = result === null ? '' : result.text.trim();
        const take = serverText !== '' ? serverText : heard.trim();
        if (take === '') {
          setProblem(
            result === null && isVoiceUnavailable()
              ? 'Voice input isn’t available right now — type your request instead.'
              : 'Didn’t catch that — try again or type it.',
          );
          setAnnounce('No words heard');
          return;
        }
        onChange(appendTake(valueRef.current, take));
        setReview({
          take,
          alternatives: serverText !== '' && result !== null && result.onTopic ? result.alternatives : [],
          warnings: serverText !== '' && result !== null ? result.numberWarnings : [],
          offTopic: serverText !== '' && result !== null && !result.onTopic,
          fromBrowser: serverText === '',
        });
        setAnnounce(`Added: ${take}. Check it, then press Send.`);
        inputRef.current?.focus({ preventScroll: true });
      })();
    });
    // `recorder` and `live` are fresh objects each render; the callback is only stored, never run here.
  });

  /* The recorder's own permission and device errors. */
  useEffect(() => {
    if (recorder.error === null) return;
    live.abort();
    setProblem(RECORDER_TEXT[recorder.error]);
    setAnnounce('Microphone unavailable');
    recorder.reset();
    // Only the error changing matters; `live`/`recorder` are new objects every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.error]);

  /* Off screen or a hidden tab: end the take and give the microphone back. */
  useEffect(() => {
    if (active || !recording) return;
    cancelTake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, recording]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && (stateRef.current === 'recording' || stateRef.current === 'requesting')) {
        cancelTake();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  /* ---- gestures ---- */

  const pressStart = () => {
    keyHandled.current = false;
    if (recording) {
      // A press on ⏹ finishes the take when it is released, like any button.
      stopOnRelease.current = true;
      return;
    }
    stopOnRelease.current = false;
    pressAt.current = performance.now();
    beginTake();
    clearHoldTimer();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdRef.current = true;
      setHolding(true);
      recorder.setAutoStop(false);
    }, HOLD_MS);
  };

  const pressEnd = () => {
    const wasHold = holdRef.current;
    clearHoldTimer();
    pressAt.current = null;
    if (stopOnRelease.current) {
      stopOnRelease.current = false;
      finishTake();
      return;
    }
    if (wasHold && stateRef.current === 'requesting') {
      // Released while the browser still asks for the microphone (a first visit's prompt): that press
      // becomes a tap, so the take is not lost to the prompt and quiet still ends it.
      holdRef.current = false;
      setHolding(false);
      recorder.setAutoStop(true);
      return;
    }
    if (wasHold) finishTake();
    // A tap leaves the take running; the next press on ⏹, or a pause, finishes it.
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || busy || checking) return;
    // Keep receiving the release when the finger slides off the button.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
    pressStart();
  };
  const onPointerUp = () => {
    if (pressAt.current === null && !stopOnRelease.current) return;
    pressEnd();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    keyHandled.current = true;
    if (event.repeat || busy || checking) return;
    if (event.key === 'Enter') {
      if (recording) finishTake();
      else beginTake();
      return;
    }
    pressStart();
    keyHandled.current = true;
  };
  const onKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ') return;
    event.preventDefault();
    keyHandled.current = true;
    pressEnd();
  };

  /*
   * Pointer and keys are handled above. A click with no pointer or key behind it is assistive
   * technology activating the button: treat it as a tap.
   */
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return;
    if (keyHandled.current) {
      keyHandled.current = false;
      return;
    }
    if (recording) finishTake();
    else beginTake();
  };

  /* ---- review helpers for the last take ---- */

  const pickAlternative = (alt: string) => {
    if (review === null) return;
    const old = review.take;
    const current = valueRef.current;
    const at = current.lastIndexOf(old);
    onChange(at === -1 ? appendTake(current, alt) : current.slice(0, at) + alt + current.slice(at + old.length));
    setReview({ ...review, take: alt, alternatives: [...review.alternatives.filter((a) => a !== alt), old], warnings: [] });
    setAnnounce(`Changed to: ${alt}`);
  };

  /** Off topic: the example replaces the take — those words were not a shed request. */
  const pickExample = (example: string) => {
    if (review === null) return;
    const current = valueRef.current;
    const at = current.lastIndexOf(review.take);
    onChange(at === -1 ? appendTake(current, example) : current.slice(0, at) + example + current.slice(at + review.take.length));
    setReview(null);
    setAnnounce(`Filled in: ${example}`);
  };

  const onText = (next: string) => {
    onChange(next);
    if (review !== null) setReview(null);
    if (problem !== null) setProblem(null);
  };

  const send = () => {
    if (recording || checking) return;
    setReview(null);
    onSend();
  };

  const onTextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  /** Ten seconds left is when the clock turns amber: enough time to finish a sentence. */
  const nearLimit = recorder.elapsedMs >= recorder.maxMs - 10_000;

  return (
    <>
      <label className="g-sr-only" htmlFor="g-assistant-input">
        Message the assistant
      </label>

      <div className="g-assistant-row">
        <textarea
          ref={inputRef}
          id="g-assistant-input"
          className="g-input g-assistant-text"
          rows={1}
          maxLength={1000}
          placeholder={recording ? 'Listening…' : 'e.g. make it 9 metres wide'}
          value={value}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={onTextKey}
          disabled={busy}
        />
        {showMic ? (
          <button
            type="button"
            className={`g-mic-btn${recording ? ' g-mic-btn-live' : ''}`}
            aria-label={recording ? 'Stop recording' : 'Speak your request — tap, or hold to talk'}
            aria-pressed={recording}
            disabled={busy || checking}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onClick={onClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            {recording ? <IconStop /> : <IconMic />}
          </button>
        ) : null}
        {/*
          A plain button, not a submit: the form's onSubmit and this onClick would otherwise both run
          send() for one click.
        */}
        <button
          type="button"
          className="g-btn g-btn-primary"
          disabled={busy || recording || checking || value.trim() === ''}
          onClick={send}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>

      {recording ? (
        <div className="g-voice-live" role="group" aria-label="Recording your request">
          {recorder.state === 'requesting' ? (
            <>
              <span className="g-voice-spinner" aria-hidden="true" />
              <span className="g-voice-live-text">Asking for the microphone…</span>
            </>
          ) : (
            <>
              <span className="g-voice-dot" aria-hidden="true" />
              <span className={`g-voice-clock${nearLimit ? ' g-voice-clock-warn' : ''}`} aria-hidden="true">
                {clock(recorder.elapsedMs)}
              </span>
              <span className="g-voice-wave" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    style={{ transform: `scaleY(${0.15 + Math.min(1, recorder.level) * (0.35 + ((i * 7) % 10) / 12)})` }}
                  />
                ))}
              </span>
              <span className="g-voice-live-text" aria-hidden="true">
                {live.text !== '' ? tail(live.text) : holding ? 'Release to finish' : 'Speaking… tap ■ or pause to finish'}
              </span>
            </>
          )}
          <button type="button" className="g-voice-cancel" aria-label="Cancel recording" onClick={cancelTake}>
            {'×'}
          </button>
        </div>
      ) : null}

      {checking ? (
        <div className="g-voice-live g-voice-live-busy" role="status">
          <span className="g-voice-spinner" aria-hidden="true" />
          <span className="g-voice-live-text">
            Checking the words{live.text !== '' ? `: “${tail(live.text)}”` : '…'}
          </span>
        </div>
      ) : null}

      {problem !== null ? (
        <p className="g-voice-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {review !== null && !recording && !checking ? (
        <div className="g-voice-review">
          {review.fromBrowser ? (
            <p className="g-voice-note">Added from your browser&rsquo;s transcript &mdash; check the numbers.</p>
          ) : null}
          {review.alternatives.length > 0 ? (
            <div className="g-voice-alts">
              <span className="g-voice-alts-label">Did you mean</span>
              <ul className="g-voice-chips" aria-label="Did you mean">
                {review.alternatives.map((alt) => (
                  <li key={alt}>
                    <button type="button" className="g-chip-ask" onClick={() => pickAlternative(alt)}>
                      {alt}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {review.offTopic ? (
            <>
              <p className="g-voice-note">I can only help design your shed &mdash; try one of these:</p>
              {examples.length > 0 ? (
                <ul className="g-voice-chips" aria-label="Things you can ask">
                  {examples.map((example) => (
                    <li key={example}>
                      <button type="button" className="g-chip-ask" onClick={() => pickExample(example)}>
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          {review.warnings.length > 0 ? (
            <ul className="g-voice-warn" role="status">
              {review.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="g-hint">AI can make mistakes — check the words and the plan. Nothing is sent until you press Send.</p>
      {showMic && value.trim() === '' && !recording && !checking ? (
        <p className="g-voice-invite">
          Tap the mic (or hold it) and say what you want — e.g. <em>add a roller door on the front</em>.
        </p>
      ) : null}

      <p className="g-sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}
