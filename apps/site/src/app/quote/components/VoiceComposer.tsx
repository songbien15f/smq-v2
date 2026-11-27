'use client';

/**
 * The assistant's composer: a text box, a microphone and Send.
 *
 * The microphone opens `VoiceDialog`, where speech is dictated with live words and a box big enough to
 * read them (2026-11-27: dictating straight into this one-line box was too cramped to check). The dialog
 * is mounted only while open, so closing it releases the microphone.
 *
 * **Speech never sends itself**: the dialog's Send, pressed by the guest after reading the words, is the
 * only way spoken words become a message.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { useAssistant } from '../assistantStore';
import { IconMic } from './icons';
import { VoiceDialog } from './VoiceDialog';

/** Whether this browser can record at all — the dialog's recorder checks the same two things. */
function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function VoiceComposer({
  typeId,
  busy,
  active = true,
  value,
  onChange,
  onSend,
  onSendText,
  inputRef,
  examples,
}: {
  typeId: string;
  busy: boolean;
  /** False while the panel is off screen: an open voice dialog closes. */
  active?: boolean;
  value: string;
  onChange: (next: string) => void;
  /** Send what is in the box. */
  onSend: () => void;
  /** Send the voice dialog's words. */
  onSendText: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Next steps that make sense for this design, offered when the guest's words were off topic. */
  examples: string[];
}) {
  const voiceUnavailable = useAssistant((s) => s.voiceUnavailable);
  const [supported, setSupported] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => setSupported(canRecord()), []);

  /* The panel slid away: close the dialog, which releases the microphone as it unmounts. */
  useEffect(() => {
    if (!active) setVoiceOpen(false);
  }, [active]);

  /* The box grows with its text, up to the CSS max-height. */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);

  const showMic = supported && !voiceUnavailable;

  const onTextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  };

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
          placeholder="e.g. make it 9 metres wide"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onTextKey}
          disabled={busy}
        />
        {showMic ? (
          <button
            type="button"
            className="g-mic-btn"
            aria-label="Speak your request"
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setVoiceOpen(true)}
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

      <p className="g-hint">AI can make mistakes — check the words and the plan. Nothing is sent until you press Send.</p>
      {showMic && value.trim() === '' ? (
        <p className="g-voice-invite">
          Tap the mic and say what you want — e.g. <em>add a roller door on the front</em>.
        </p>
      ) : null}

      {voiceOpen ? (
        <VoiceDialog
          typeId={typeId}
          initialText={value}
          examples={examples}
          onClose={() => {
            setVoiceOpen(false);
            inputRef.current?.focus({ preventScroll: true });
          }}
          onSend={(text) => {
            setVoiceOpen(false);
            onSendText(text);
          }}
        />
      ) : null}
    </>
  );
}
