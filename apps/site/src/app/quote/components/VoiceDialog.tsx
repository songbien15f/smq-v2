'use client';

/**
 * "Speak your request": live dictation in a dialog, where the words have room to be read.
 *
 * ## Why a dialog again (2026-11-27)
 *
 * Dictating straight into the composer worked, but the composer is one short line beside the mic and
 * Send: a sentence of speech scrolls out of sight and cannot be checked. The dialog gives the words a
 * real box, and the controls (speak again, cancel, send) one place.
 *
 * ```
 * (mic) ─▶ ┌ Speak your request ─────────────────────┐
 *          │ [ make it 9 metres wide and add a      ] │  the words so far: editable between takes
 *          │ [ roller door on the front             ] │
 *          │ ● 0:04 / 1:00  ▂▅▇▅▂                     │  while speaking: the browser's live words,
 *          │   "on the front…"                        │  greyed until the server's text replaces them
 *          │ Did you mean (…)   ⚠ 30 m is wider than… │  review helpers for the last take
 *          │ (🎙 Speak more)        [Cancel]  [Send]  │
 *          └──────────────────────────────────────────┘
 * ```
 *
 * ## The rule it keeps
 *
 * **Speech never sends itself.** Each take is *added to the box*; only Send sends. A recogniser that
 * hears "nine" as "five" would otherwise change a design behind the guest's back.
 *
 * ## The mic button in here: tap or hold
 *
 * - **Tap** — start; tap again (now ⏹) or pause for two seconds to finish.
 * - **Hold** (≥ 300 ms) — push-to-talk: release to finish, and quiet does not end it (a noisy site).
 * - **Keyboard** — Enter toggles; holding Space is push-to-talk.
 *
 * Opening the dialog starts the first take straight away, as a tap.
 *
 * ## Two recognisers, one answer
 *
 * `useLiveSpeech` (the browser's, free) shows words as they are said. The recording (`useVoiceRecorder`)
 * goes to the server when the take ends — Gemini plus the shed-vocabulary repair — and that text is what
 * lands in the box. If the server cannot answer, the browser's words are used instead.
 *
 * ## The microphone goes out
 *
 * Closing the dialog unmounts this component, and both hooks release the device on unmount. A hidden
 * tab ends the take as well; the panel sliding away closes the dialog (the composer's `active`).
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { isVoiceUnavailable, transcribeVoice } from '../assistantStore';
import { useLiveSpeech } from '../useLiveSpeech';
import { useVoiceRecorder, type VoiceError } from '../useVoiceRecorder';
import { IconMic, IconStop } from './icons';

/** A press at least this long is a hold (push-to-talk), shorter is a tap. */
const HOLD_MS = 300;

const RECORDER_TEXT: Record<VoiceError, string> = {
  denied: 'Microphone blocked — allow it in the browser’s address bar, or type instead.',
  no_device: 'No microphone found — type instead.',
  too_short: 'That was too short — speak a moment longer.',
  failed: 'Couldn’t record that — try again or type it.',
};

/** `0:07` — minutes and two-digit seconds. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `base` plus one more take, with a single space between them. */
function appendTake(base: string, take: string): string {
  const head = base.replace(/\s+$/, '');
  return head === '' ? take : `${head} ${take}`;
}

/** What the review helpers say about the last take. Cleared when the guest edits the words. */
interface TakeReview {
  /** The words this take put in the box, so a picked reading replaces exactly those. */
  take: string;
  alternatives: string[];
  warnings: string[];
  offTopic: boolean;
  /** The server could not answer and the browser's words were used. */
  fromBrowser: boolean;
}

export function VoiceDialog({
  typeId,
  initialText,
  examples,
  onSend,
  onClose,
}: {
  typeId: string;
  /** What was already in the composer: speech is added after it. */
  initialText: string;
  /** Next steps that make sense for this design, offered when the words were off topic. */
  examples: string[];
  /** The guest pressed Send: these words are the message. */
  onSend: (text: string) => void;
  /** Cancel or Escape: the words are dropped and the composer keeps what it had. */
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useVoiceRecorder();
  const live = useLiveSpeech();
  const id = useId();

  const [text, setText] = useState(initialText);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<TakeReview | null>(null);
  const [holding, setHolding] = useState(false);
  const [announce, setAnnounce] = useState('');

  /* The latest values, for callbacks that finish after the render that made them. */
  const textRef = useRef(text);
  textRef.current = text;
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

  /* Open on mount; Escape is handled on the element (see `onKeyDown`) so there is one close path. */
  useEffect(() => {
    const d = dialog.current;
    if (d !== null && !d.open) d.showModal();
  }, []);

  /* The box grows with its text, up to the CSS max-height, so several takes stay readable. */
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const clearHoldTimer = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const beginTake = () => {
    if (checking || (stateRef.current !== 'idle' && stateRef.current !== 'error')) return;
    setProblem(null);
    setReview(null);
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
  };

  /* The first take starts as the dialog opens — once the recorder knows the mic exists. */
  const started = useRef(false);
  useEffect(() => {
    if (!recorder.supported || started.current) return;
    started.current = true;
    beginTake();
    // Only availability matters; `beginTake` reads the latest state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.supported]);

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
        setText(appendTake(textRef.current, take));
        setReview({
          take,
          alternatives: serverText !== '' && result !== null && result.onTopic ? result.alternatives : [],
          warnings: serverText !== '' && result !== null ? result.numberWarnings : [],
          offTopic: serverText !== '' && result !== null && !result.onTopic,
          fromBrowser: serverText === '',
        });
        setAnnounce(`Added: ${take}. Check it, then press Send.`);
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

  /* A hidden tab ends the take and gives the microphone back; the words so far stay. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && (stateRef.current === 'recording' || stateRef.current === 'requesting')) {
        cancelTake();
        setAnnounce('Recording cancelled');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  /* ---- gestures on the dialog's mic ---- */

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
      // Released while the browser still asks for the microphone: that press becomes a tap.
      holdRef.current = false;
      setHolding(false);
      recorder.setAutoStop(true);
      return;
    }
    if (wasHold) finishTake();
    // A tap leaves the take running; the next press on ⏹, or a pause, finishes it.
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || checking) return;
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

  const onMicKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    keyHandled.current = true;
    if (event.repeat || checking) return;
    if (event.key === 'Enter') {
      if (recording) finishTake();
      else beginTake();
      return;
    }
    pressStart();
    keyHandled.current = true;
  };
  const onMicKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ') return;
    event.preventDefault();
    keyHandled.current = true;
    pressEnd();
  };

  /* A click with no pointer or key behind it is assistive technology: treat it as a tap. */
  const onMicClick = (event: React.MouseEvent<HTMLButtonElement>) => {
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
    const current = textRef.current;
    const at = current.lastIndexOf(old);
    setText(at === -1 ? appendTake(current, alt) : current.slice(0, at) + alt + current.slice(at + old.length));
    setReview({ ...review, take: alt, alternatives: [...review.alternatives.filter((a) => a !== alt), old], warnings: [] });
    setAnnounce(`Changed to: ${alt}`);
  };

  /** Off topic: the example replaces the take — those words were not a shed request. */
  const pickExample = (example: string) => {
    if (review === null) return;
    const current = textRef.current;
    const at = current.lastIndexOf(review.take);
    setText(at === -1 ? appendTake(current, example) : current.slice(0, at) + example + current.slice(at + review.take.length));
    setReview(null);
    setAnnounce(`Filled in: ${example}`);
  };

  /* ---- closing ---- */

  const close = () => {
    cancelTake();
    const d = dialog.current;
    if (d !== null && d.open) d.close();
    onClose();
  };

  const send = () => {
    const value = textRef.current.trim();
    if (value === '' || recording || checking) return;
    const d = dialog.current;
    if (d !== null && d.open) d.close();
    onSend(value);
  };

  const onTextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  /** Ten seconds left is when the clock turns amber: enough time to finish a sentence. */
  const nearLimit = recorder.elapsedMs >= recorder.maxMs - 10_000;

  return (
    <dialog
      ref={dialog}
      className="g-dialog g-voice-dialog"
      aria-labelledby={`${id}-title`}
      /*
       * Escape closes only this dialog. `preventDefault` stops the browser's own close (which would leave
       * the component mounted and hidden); `stopPropagation` stops the page's global handler, which would
       * also close the assistant column behind it.
       */
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <h2 id={`${id}-title`}>Speak your request</h2>
      <p>Say what you want for the shed. Speak again to add more. Nothing is sent until you press Send.</p>

      <label className="g-sr-only" htmlFor={`${id}-text`}>
        Your request
      </label>
      <textarea
        ref={textarea}
        id={`${id}-text`}
        className="g-input g-voice-textarea"
        rows={3}
        maxLength={1000}
        placeholder={recording ? 'Listening…' : 'Your words appear here'}
        value={text}
        readOnly={recording || checking}
        onChange={(e) => {
          setText(e.target.value);
          if (review !== null) setReview(null);
          if (problem !== null) setProblem(null);
        }}
        onKeyDown={onTextKey}
      />

      {recording ? (
        <div className="g-voice-live" role="group" aria-label="Recording your request">
          <div className="g-voice-live-meter">
            {recorder.state === 'requesting' ? (
              <>
                <span className="g-voice-spinner" aria-hidden="true" />
                <span>Asking for the microphone…</span>
              </>
            ) : (
              <>
                <span className="g-voice-dot" aria-hidden="true" />
                <span className={`g-voice-clock${nearLimit ? ' g-voice-clock-warn' : ''}`} aria-hidden="true">
                  {clock(recorder.elapsedMs)} / {clock(recorder.maxMs)}
                </span>
                <span className="g-voice-wave" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, i) => (
                    <span
                      key={i}
                      style={{ transform: `scaleY(${0.15 + Math.min(1, recorder.level) * (0.35 + ((i * 7) % 10) / 12)})` }}
                    />
                  ))}
                </span>
                <span className="g-voice-live-hint">{holding ? 'Release to finish' : 'Tap ■ or pause to finish'}</span>
              </>
            )}
          </div>
          {live.text !== '' ? (
            <p className="g-voice-live-text" aria-hidden="true">
              {live.text}
            </p>
          ) : null}
        </div>
      ) : null}

      {checking ? (
        <div className="g-voice-live g-voice-live-busy" role="status">
          <div className="g-voice-live-meter">
            <span className="g-voice-spinner" aria-hidden="true" />
            <span>Checking the words…</span>
          </div>
          {live.text !== '' ? <p className="g-voice-live-text">{live.text}</p> : null}
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

      <div className="g-dialog-actions g-voice-actions">
        <button
          type="button"
          className={`g-btn g-btn-outline g-voice-mic${recording ? ' g-voice-mic-live' : ''}`}
          aria-label={recording ? 'Stop recording' : 'Speak — tap, or hold to talk'}
          aria-pressed={recording}
          disabled={checking}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onMicKeyDown}
          onKeyUp={onMicKeyUp}
          onClick={onMicClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {recording ? <IconStop /> : <IconMic />}
          <span aria-hidden="true">{recording ? 'Stop' : text.trim() === '' ? 'Speak' : 'Speak more'}</span>
        </button>
        <span className="g-voice-actions-gap" />
        <button type="button" className="g-btn g-btn-outline" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="g-btn g-btn-primary"
          disabled={recording || checking || text.trim() === ''}
          onClick={send}
        >
          Send
        </button>
      </div>

      <p className="g-sr-only" aria-live="polite">
        {announce}
      </p>
    </dialog>
  );
}
