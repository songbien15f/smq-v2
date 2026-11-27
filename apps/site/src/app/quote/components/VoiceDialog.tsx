'use client';

/**
 * "Speak your request": the microphone in a dialog, with a review step before anything is sent.
 *
 * ## The rule this dialog exists to keep
 *
 * **Speech never sends itself.** The guest presses Done in the dialog, having read the words. A
 * recogniser that hears "nine" as "five" would otherwise change a design behind their back, and a
 * design change can be the difference between one door and two.
 *
 * ```
 * (mic) ─▶ ┌ Speak your request ──────────────┐
 *          │ ● 0:07 / 1:00   ▂▅▇▅▂            │  recording
 *          │              [Cancel]  [Done]    │
 *          └─────────────────────────────────┘
 *    Done ─▶ ◌ Listening back…                    transcribing (one request; the server runs
 *                                                  speech-to-text, then the repair pass)
 *         ─▶ ┌ Is this what you said? ─────────┐
 *            │ [ add a 3 metre roller door… ]   │  review: editable, pre-filled
 *            │ Did you mean (3.3 m door) (…)    │
 *            │ ⚠ 30 m is wider than this shed   │
 *            │ [Record again] [Cancel]  [Done]  │
 *            └─────────────────────────────────┘
 *    Done ─▶ the dialog closes and the composer sends the words as the guest's message
 * ```
 *
 * ## Why the recorder lives in here
 *
 * Closing the dialog unmounts this component, and the recorder's teardown stops every track of the
 * stream — so a closed dialog can never hold the microphone open. The panel stays mounted and hidden;
 * this does not.
 *
 * ## What the review step helps with (none of it sends)
 *
 * - **Did you mean…?** — the repair pass's other readings, when it was unsure. A tap swaps them into the
 *   textarea and puts the replaced reading back among the chips.
 * - **Off topic** — when the sentence was not about the shed, the examples the panel offers become chips
 *   that fill the textarea outright.
 * - **Number check** — a size this building cannot take gets an amber line, so "fifty" heard for
 *   "fifteen" is caught before the change, not after.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { isVoiceUnavailable, transcribeVoice } from '../assistantStore';
import { useVoiceRecorder, type VoiceError } from '../useVoiceRecorder';
import { IconStop } from './icons';

type Phase = 'record' | 'review' | 'error';

/** What went wrong, in the words the guest needs. `voice_off` is the service, not their speech. */
type Problem = 'empty' | 'voice_off' | 'offtopic' | 'denied' | 'no_device' | 'too_short' | 'failed';

const PROBLEM_TEXT: Record<Problem, string> = {
  offtopic: 'I can only help design your shed \u2014 try one of these:',
  empty: 'Didn\u2019t catch that \u2014 try again or type it.',
  voice_off: 'Voice input isn\u2019t available right now \u2014 type your request instead.',
  denied: 'Microphone blocked \u2014 allow it in the browser\u2019s address bar, or type instead.',
  no_device: 'No microphone found \u2014 type instead.',
  too_short: 'That was too short \u2014 hold on for a moment and speak.',
  failed: 'Couldn\u2019t make that out \u2014 try again or type it.',
};

const FROM_RECORDER: Record<VoiceError, Problem> = {
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

export function VoiceDialog({
  typeId,
  examples,
  onDone,
  onClose,
  onTypeInstead,
}: {
  typeId: string;
  /** Next steps that make sense for this design, offered when the words were off topic. */
  examples: string[];
  /** The guest pressed Done in review: these words are the message. */
  onDone: (text: string) => void;
  onClose: () => void;
  /** "Type instead" on an error: close, and put the cursor in the chat field. */
  onTypeInstead: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useVoiceRecorder();
  const id = useId();

  const [phase, setPhase] = useState<Phase>('record');
  const [problem, setProblem] = useState<Problem>('empty');
  const [text, setText] = useState('');
  /** Other readings of the transcript ("Did you mean…?") and size warnings for it. */
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [offTopic, setOffTopic] = useState(false);
  /** The reading now in the textarea, so a picked alternative replaces exactly those words. */
  const [lastTranscript, setLastTranscript] = useState('');
  /** What a screen reader is told, in words rather than every tick of the clock. */
  const [announce, setAnnounce] = useState('Recording');

  /*
   * The close handler, read through a ref so the key handler attached once still calls the latest one.
   */
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  /*
   * Open on mount. Escape is handled on the element (see `onKeyDown`) rather than through the native
   * `close` event, because that event and React's double-invoked development effects do not compose:
   * the browser closes the element, the component stays mounted and hidden, and the mic then cannot open
   * it again. One path for every close keeps the state and the element in step.
   */
  useEffect(() => {
    const d = dialog.current;
    if (d !== null && !d.open) d.showModal();
  }, []);

  /* Start recording as soon as the microphone is known to be available — `start()` refuses before. */
  const started = useRef(false);
  useEffect(() => {
    if (!recorder.supported || started.current) return;
    started.current = true;
    void recorder.start();
  }, [recorder.supported, recorder]);

  /** Move to the review step with the transcript in the box; the caller adds its chips and warnings. */
  const announceReady = (value: string) => {
    setLastTranscript(value);
    setText(value);
    setPhase('review');
    setAnnounce('Transcript ready — check it, then press Done');
  };

  useEffect(() => {
    recorder.onDone((blob, mimeType, durationMs) => {
      void (async () => {
        const result = await transcribeVoice(blob, mimeType, durationMs, typeId);
        if (result === null) {
          /*
           * Two different truths. If the server answered `unavailable`, the recording was never heard at
           * all — saying "didn't catch that" would blame the guest's speech for a switched-off service.
           * `isVoiceUnavailable()` reads the store after the call, because the sticky flag is set there.
           */
          const off = isVoiceUnavailable();
          setProblem(off ? 'voice_off' : 'empty');
          setPhase('error');
          setAnnounce(off ? 'Voice input is unavailable' : 'No transcript');
        } else if (result.text.trim() === '') {
          setProblem('empty');
          setPhase('error');
          setAnnounce('No transcript');
        } else {
          announceReady(result.text);
          setAlternatives(result.onTopic ? result.alternatives : []);
          setWarnings(result.numberWarnings);
          setOffTopic(!result.onTopic);
        }
        recorder.reset();
      })();
    });
    // `recorder` is a fresh object each render by design; the callback is only stored, never run here.
  });

  /* The recorder's own permission and library errors become the dialog's error step. */
  useEffect(() => {
    if (recorder.error === null) return;
    setProblem(FROM_RECORDER[recorder.error]);
    setPhase('error');
    setAnnounce(recorder.error === 'too_short' ? 'Too short' : 'Microphone unavailable');
  }, [recorder.error]);

  /* Review puts the cursor at the end of the words, ready to correct them. */
  useEffect(() => {
    if (phase !== 'review') return;
    const el = textarea.current;
    if (el === null) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* some browsers refuse selection; the cursor is at the end anyway */
    }
  }, [phase]);

  /*
   * The one way out. The element is closed first so it leaves the top layer before the parent unmounts
   * it, then the caller decides what happens next; `onKeyDown` calls this for Escape.
   */
  const close = useCallback(() => {
    const d = dialog.current;
    if (d !== null && d.open) d.close();
    closeHandler.current();
  }, []);

  const recordAgain = () => {
    recorder.reset();
    setText('');
    setAlternatives([]);
    setWarnings([]);
    setOffTopic(false);
    setLastTranscript('');
    setPhase('record');
    setAnnounce('Recording');
    void recorder.start();
  };

  const tryAgain = () => {
    recorder.reset();
    setPhase('record');
    setAnnounce('Recording');
    void recorder.start();
  };

  const done = () => {
    const value = text.trim();
    if (value === '') return;
    close();
    onDone(value);
  };

  /** Swap the reading in the textarea for another; the old one becomes a chip. */
  const pickAlternative = (alt: string) => {
    const old = lastTranscript;
    const next = old !== '' && text.includes(old) ? text.replace(old, alt) : alt;
    setText(next);
    setLastTranscript(alt);
    setAlternatives((list) => [...list.filter((a) => a !== alt), ...(old === '' ? [] : [old])]);
    setWarnings([]);
    setAnnounce(`Changed to: ${alt}`);
  };

  /** Off topic: an example replaces the text outright — the words there were not a shed request. */
  const pickExample = (example: string) => {
    setText(example);
    setLastTranscript('');
    setOffTopic(false);
    setAlternatives([]);
    setAnnounce(`Filled in: ${example}`);
  };

  const onTextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    done();
  };

  const recording = recorder.state === 'recording' || recorder.state === 'requesting';
  const transcribing = recorder.state === 'transcribing';
  /** Ten seconds left is when the clock turns amber: enough time to finish a sentence. */
  const nearLimit = recorder.elapsedMs >= recorder.maxMs - 10_000;

  return (
    <dialog
      ref={dialog}
      className="g-dialog g-voice-dialog"
      aria-labelledby={`${id}-title`}
      /*
       * Escape belongs to this dialog, and closes only it. `preventDefault` stops the browser's own
       * `close` (which would leave the component mounted and hidden); `stopPropagation` stops the page's
       * global handler (`panels.ts` `handleEscape`), which would also close the assistant column behind
       * it. The guest cancelling a recording loses the recording, nothing else.
       */
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <h2 id={`${id}-title`}>{phase === 'review' ? 'Is this what you said?' : 'Speak your request'}</h2>

      {phase === 'record' ? (
        <>
          <p>Say what you want for the shed. Nothing is sent until you check the words and press Done.</p>
          {recorder.state === 'requesting' ? (
            <div className="g-voice-busy" role="status">
              <span className="g-voice-spinner" aria-hidden="true" />
              Asking for the microphone…
            </div>
          ) : (
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
            </div>
          )}
          <div className="g-dialog-actions">
            <button type="button" className="g-btn g-btn-outline" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="g-btn g-btn-primary"
              disabled={!recording || recorder.state === 'requesting'}
              onClick={() => recorder.stop()}
            >
              <IconStop />
              Done
            </button>
          </div>
        </>
      ) : null}

      {transcribing ? (
        <>
          <p>Turning your voice into words.</p>
          <div className="g-voice-busy" role="status">
            <span className="g-voice-spinner" aria-hidden="true" />
            Listening back…
          </div>
          <div className="g-dialog-actions">
            <button type="button" className="g-btn g-btn-outline" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {phase === 'review' ? (
        <>
          <label className="g-sr-only" htmlFor={`${id}-text`}>
            Your request
          </label>
          <textarea
            ref={textarea}
            id={`${id}-text`}
            className="g-input g-voice-textarea"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setWarnings([]);
            }}
            onKeyDown={onTextKey}
          />
          {alternatives.length > 0 ? (
            <div className="g-voice-alts">
              <span className="g-voice-alts-label">Did you mean</span>
              <ul className="g-voice-chips" aria-label="Did you mean">
                {alternatives.map((alt) => (
                  <li key={alt}>
                    <button type="button" className="g-chip-ask" onClick={() => pickAlternative(alt)}>
                      {alt}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {offTopic ? (
            <>
              <p className="g-voice-problem">{PROBLEM_TEXT.offtopic}</p>
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
          {warnings.length > 0 ? (
            <ul className="g-voice-warn" role="status">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <p className="g-hint">Ctrl+Enter also means Done. Fix the words first if it misheard you.</p>
          <div className="g-dialog-actions">
            <button type="button" className="g-btn g-btn-ghost" onClick={recordAgain}>
              Record again
            </button>
            <button type="button" className="g-btn g-btn-outline" onClick={close}>
              Cancel
            </button>
            <button type="button" className="g-btn g-btn-primary" disabled={text.trim() === ''} onClick={done}>
              Done
            </button>
          </div>
        </>
      ) : null}

      {phase === 'error' ? (
        <>
          <p role="alert" className="g-voice-problem">
            {PROBLEM_TEXT[problem]}
          </p>
          <div className="g-dialog-actions">
            <button
              type="button"
              className="g-btn g-btn-outline"
              onClick={() => {
                close();
                onTypeInstead();
              }}
            >
              Type instead
            </button>
            <button type="button" className="g-btn g-btn-primary" onClick={tryAgain}>
              Try again
            </button>
          </div>
        </>
      ) : null}

      <p className="g-sr-only" aria-live="polite">
        {announce}
      </p>
    </dialog>
  );
}
