'use client';

/**
 * The browser's own speech recogniser (Web Speech API), used only to show words **while** the guest
 * speaks.
 *
 * ## Where it sits
 *
 * It runs beside `useVoiceRecorder` on the same take. The recorder's clip is what the server transcribes
 * (Gemini, with the shed-vocabulary repair pass); that text replaces this one when it arrives. This hook
 * is the preview, and the fallback when the server cannot answer — never the source of truth, because it
 * cannot be told what a "roller door" or a "bay" is.
 *
 * ## What it costs and where the audio goes
 *
 * Nothing to SmartQuote: it never calls our API. Chrome sends the audio to Google's recogniser by
 * default; Safari uses Apple's. That is the browser's service, the same one its own dictation uses.
 *
 * ## Browsers
 *
 * - Chrome, Edge, Firefox 160+: `SpeechRecognition`; Safari: `webkitSpeechRecognition`.
 * - **iOS is skipped.** Safari on iPhone and iPad shares one audio session between the recogniser and
 *   `getUserMedia`; running both on one take risks the recorder losing the microphone, and the recorder
 *   is the part that must work. An iPhone gets the recording without the live line.
 * - Every error is swallowed: a recogniser that fails leaves the take exactly as it was before this hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** The slice of the Web Speech API this hook touches. Not in TypeScript's DOM library yet. */
interface Recogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecogniserEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecogniserEvent {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecogniserCtor = new () => Recogniser;

/** Australian English: the product's guests are in Australia. */
const LANG = 'en-AU';

function recogniserCtor(): RecogniserCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecogniserCtor; webkitSpeechRecognition?: RecogniserCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** iPhone, iPad (which reports itself as a Mac with touch), iPod. */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export interface LiveSpeechApi {
  /** Whether live words can be shown here at all. */
  supported: boolean;
  /** Everything heard so far in this take, final and interim. */
  text: string;
  start(): void;
  /** End the take and return what was heard (may be ''). */
  stop(): string;
  /** End the take and drop what was heard. */
  abort(): void;
}

export function useLiveSpeech(): LiveSpeechApi {
  const [supported, setSupported] = useState(false);
  const [text, setText] = useState('');
  const recRef = useRef<Recogniser | null>(null);
  /** Whether the take is still going: a recogniser that ends on its own is restarted while it is. */
  const wantedRef = useRef(false);
  /** Final text from earlier recogniser sessions in this take (a restart starts its results afresh). */
  const earlierRef = useRef('');
  /** The latest text, for `stop()`, which must not wait for a render. */
  const textRef = useRef('');

  useEffect(() => {
    setSupported(recogniserCtor() !== null && !isIos());
  }, []);

  const show = (value: string) => {
    textRef.current = value;
    setText(value);
  };

  const open = useCallback(() => {
    const Ctor = recogniserCtor();
    if (Ctor === null) return;
    let rec: Recogniser;
    try {
      rec = new Ctor();
    } catch {
      return;
    }
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finals = '';
    rec.onresult = (event) => {
      finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        if (result.isFinal) finals += result[0].transcript;
        else interim += result[0].transcript;
      }
      show(`${earlierRef.current} ${finals} ${interim}`.replace(/\s+/g, ' ').trim());
    };
    rec.onerror = () => undefined;
    rec.onend = () => {
      // Chrome ends a "continuous" session after a pause; keep listening while the take is open.
      earlierRef.current = `${earlierRef.current} ${finals}`.trim();
      if (recRef.current === rec) recRef.current = null;
      if (wantedRef.current) open();
    };
    try {
      rec.start();
      recRef.current = rec;
    } catch {
      recRef.current = null;
    }
  }, []);

  const end = useCallback((how: 'stop' | 'abort') => {
    wantedRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec === null) return;
    rec.onend = null;
    rec.onresult = null;
    try {
      if (how === 'stop') rec.stop();
      else rec.abort();
    } catch {
      /* already ended */
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    end('abort');
    earlierRef.current = '';
    show('');
    wantedRef.current = true;
    open();
  }, [end, open, supported]);

  const stop = useCallback(() => {
    const heard = textRef.current;
    end('stop');
    return heard;
  }, [end]);

  const abort = useCallback(() => {
    end('abort');
    earlierRef.current = '';
    show('');
  }, [end]);

  // Unmounting ends any take, so a recogniser never outlives the composer.
  useEffect(() => () => end('abort'), [end]);

  return { supported, text, start, stop, abort };
}
