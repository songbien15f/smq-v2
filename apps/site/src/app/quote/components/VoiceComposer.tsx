'use client';

/**
 * The assistant's composer: a text field, a microphone and Send.
 *
 * ## The rule this component exists to keep
 *
 * **Speech never sends itself.** The microphone opens `VoiceDialog`, where the guest records, then reads
 * and edits the words, then presses Done in the dialog. Only that Done hands the text here, and here it
 * is sent as their message. A recogniser that hears "nine" as "five" would otherwise change a design
 * behind their back, and a design change can be the difference between one door and two.
 *
 * ```
 * [ e.g. make it 9 metres wide ]  (mic)  [Send]
 * ```
 *
 * ## Why the recorder is not in here
 *
 * The recorder lives inside `VoiceDialog`, which unmounts when the dialog closes and therefore stops the
 * microphone stream. This panel stays mounted, sometimes hidden; a stream left open by a closed dialog
 * would be a live microphone nobody can see. Keeping the two apart is what makes closing mean "stopped".
 *
 * The dialog also owns the review step — "Did you mean…?" chips, off-topic examples and spoken-size
 * warnings — because those only make sense next to the words they describe.
 */

import { useEffect, useRef, useState } from 'react';
import { useAssistant } from '../assistantStore';
import { VoiceDialog } from './VoiceDialog';
import { IconMic } from './icons';

export function VoiceComposer({
  typeId,
  busy,
  value,
  onChange,
  onSend,
  inputRef,
  examples,
}: {
  typeId: string;
  busy: boolean;
  value: string;
  onChange: (next: string) => void;
  /** `override` is the dialog's text: state set a moment earlier is not visible to this callback yet. */
  onSend: (override?: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Next steps that make sense for this design, offered when the guest's words were off topic. */
  examples: string[];
}) {
  const voiceUnavailable = useAssistant((s) => s.voiceUnavailable);
  const [open, setOpen] = useState(false);
  /** Whether the browser can record at all; read once, so a browser without `MediaRecorder` shows no mic. */
  const [supported, setSupported] = useState(false);
  const micRef = useRef<HTMLButtonElement>(null);
  /** Whether the guest came out of the dialog, so focus is owed to the mic once the send finishes. */
  const restoreFocus = useRef(false);

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices !== undefined &&
        typeof MediaRecorder !== 'undefined',
    );
  }, []);

  /*
   * Focus moves back to the mic after the dialog closes — but not immediately: the send starts in the
   * same tick, which disables the composer, and a `focus()` on a disabled button does nothing. So the
   * request is remembered and honoured when the panel is enabled again.
   */
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    micRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const showMic = supported && !voiceUnavailable;

  /** Closing returns the cursor to the mic, so a keyboard user is not dropped at the top of the page. */
  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
    if (!busy) micRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <label className="g-sr-only" htmlFor="g-assistant-input">
        Message the assistant
      </label>

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
            ref={micRef}
            type="button"
            className="g-mic-btn"
            aria-label="Speak your request"
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            <IconMic />
          </button>
        ) : null}
        {/*
          A plain button, not a submit: the form's onSubmit and this onClick would otherwise both run
          send() for one click.
        */}
        <button
          type="button"
          className="g-btn g-btn-primary"
          disabled={busy || value.trim() === ''}
          onClick={() => onSend()}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>

      <p className="g-hint">AI can make mistakes — check the plan. It never sends your request.</p>
      {showMic && value.trim() === '' ? (
        <p className="g-voice-invite">
          Tap the mic and say what you want — e.g. <em>add a roller door on the front</em>.
        </p>
      ) : null}

      {/*
        Mounted only while open, so closing the dialog tears the recorder down and the microphone light
        goes out. The field is set before the send so a send that is refused (the assistant is busy)
        keeps the words rather than dropping them.
      */}
      {open ? (
        <VoiceDialog
          typeId={typeId}
          examples={examples}
          onDone={(text) => {
            onChange(text);
            onSend(text);
          }}
          onClose={close}
          onTypeInstead={() => {
            setOpen(false);
            inputRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </>
  );
}
