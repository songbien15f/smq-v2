'use client';

/**
 * Recording a sentence in the browser for the Guest assistant's composer.
 *
 * ## What it guarantees
 *
 * - **The microphone light goes out.** Every stop path — Done, Cancel, the auto-stop, an error, and
 *   unmounting the panel — calls `track.stop()` on each track of the stream. A recorder that "stops"
 *   only stops its own state, not the device.
 * - **A clip that is too short is not sent.** Under 300 ms is a tap, not a sentence; `too_short` is
 *   reported instead, so a stray click cannot spend a transcription.
 * - **It stops on its own.** At `maxMs` (60 s, the server's ceiling) and after `silenceMs` of quiet
 *   *once somebody has spoken*. Silence detection is an `AnalyserNode` RMS, not a guess from the clock.
 * - **Every browser's container is handled.** Chrome records `audio/webm`, Firefox `audio/ogg`, Safari
 *   `audio/mp4`; the first supported is chosen, and the server is told only the part before `;`, so a
 *   `codecs=opus` suffix never fails the allow-list.
 *
 * ## Why `setInterval` and not `requestAnimationFrame`
 *
 * The meter and the auto-stop must run in every pane the page is opened in — including the automation
 * pane this product is tested in, where `requestAnimationFrame` is never scheduled. A 100 ms interval is
 * plenty for a level meter and cannot be starved the same way.
 *
 * ## What it does not do
 *
 * It never uploads and never knows what a sentence means. `onDone` hands the blob to the caller
 * (`VoiceComposer`), which asks the server to transcribe it. No audio is stored anywhere.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';
export type VoiceError = 'denied' | 'no_device' | 'too_short' | 'failed';

export interface VoiceRecorderApi {
  /** `navigator.mediaDevices` and `MediaRecorder` both exist — without them the mic is not drawn. */
  supported: boolean;
  state: VoiceState;
  error: VoiceError | null;
  elapsedMs: number;
  /** 0–1, for the wave bars. Zero when nothing is being said. */
  level: number;
  maxMs: number;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  /** Back to `idle` after the caller has handled the transcript or decided to give up. */
  reset(): void;
  onDone(cb: (blob: Blob, mimeType: string, durationMs: number) => void): void;
}

/** Containers in order of preference. The server's allow-list accepts all three. */
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

/** Below this the clip is a tap, not a sentence. */
const MIN_MS = 300;
/** RMS below this counts as quiet. Speech sits well above it; room tone sits below. */
const SILENCE_RMS = 0.02;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** The part before `;` — `audio/webm;codecs=opus` → `audio/webm`. */
export function baseMimeType(mimeType: string): string {
  const semi = mimeType.indexOf(';');
  return (semi === -1 ? mimeType : mimeType.slice(0, semi)).trim();
}

export function useVoiceRecorder(opts?: { maxMs?: number; silenceMs?: number }): VoiceRecorderApi {
  const maxMs = opts?.maxMs ?? 60_000;
  const silenceMs = opts?.silenceMs ?? 2_000;

  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<VoiceError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const samplesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const startedAtRef = useRef(0);
  const spokeRef = useRef(false);
  const quietSinceRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef<((blob: Blob, mimeType: string, durationMs: number) => void) | null>(null);
  /** `stop()` decides whether to emit; `cancel()` sets this so the discard is not reported. */
  const discardRef = useRef(false);

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices !== undefined &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        typeof MediaRecorder !== 'undefined',
    );
  }, []);

  /** Stop every track and drop the graph. The single place that turns the mic light off. */
  const release = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder !== null) {
      /*
       * Detach before stopping: `stop()` queues a `stop` event, and a handler that is still attached
       * calls `finish` again — one recording, two transcripts, the second with no chunks. Detaching is
       * what makes a teardown stop stay a teardown.
       */
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    recorderRef.current = null;
    const stream = streamRef.current;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;
    const audio = audioRef.current;
    if (audio !== null) void audio.close().catch(() => undefined);
    audioRef.current = null;
    analyserRef.current = null;
    samplesRef.current = null;
  }, []);

  // Unmounting the panel must not leave the microphone open. The panel is hidden rather than
  // unmounted in normal use, so this is the safety net for a real teardown.
  useEffect(() => release, [release]);

  const finish = useCallback(() => {
    const durationMs = Math.round(performance.now() - startedAtRef.current);
    const mimeType = recorderRef.current?.mimeType ?? '';
    const chunks = chunksRef.current;
    release();
    setLevel(0);
    setElapsedMs(durationMs);

    if (discardRef.current) {
      discardRef.current = false;
      chunksRef.current = [];
      setState('idle');
      return;
    }
    if (durationMs < MIN_MS) {
      chunksRef.current = [];
      setState('error');
      setError('too_short');
      return;
    }
    const blob = new Blob(chunks, { type: mimeType });
    chunksRef.current = [];
    if (blob.size === 0) {
      setState('error');
      setError('failed');
      return;
    }
    setState('transcribing');
    doneRef.current?.(blob, baseMimeType(mimeType), durationMs);
  }, [release]);

  const stop = useCallback(() => {
    discardRef.current = false;
    if (state !== 'recording') return;
    finish();
  }, [finish, state]);

  const cancel = useCallback(() => {
    discardRef.current = true;
    if (state === 'recording') finish();
    else {
      release();
      setState('idle');
    }
  }, [finish, release, state]);

  const start = useCallback(async () => {
    if (!supported || state === 'requesting' || state === 'recording') return;
    setError(null);
    setElapsedMs(0);
    setLevel(0);
    setState('requesting');
    discardRef.current = false;
    spokeRef.current = false;
    quietSinceRef.current = null;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      setState('error');
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no_device' : 'failed');
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType === '' ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setState('error');
      setError('failed');
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => finish();

    // A level meter, so the wave bars move with the voice and the auto-stop has a real signal.
    try {
      const AudioCtor: typeof AudioContext | undefined =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor !== undefined) {
        const audio = new AudioCtor();
        const source = audio.createMediaStreamSource(stream);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioRef.current = audio;
        analyserRef.current = analyser;
        samplesRef.current = new Uint8Array(analyser.fftSize);
      }
    } catch {
      // No meter is a cosmetic loss; recording and the max-duration stop still work.
      analyserRef.current = null;
    }

    startedAtRef.current = performance.now();
    recorder.start(250);
    setState('recording');

    tickRef.current = setInterval(() => {
      const elapsed = performance.now() - startedAtRef.current;
      setElapsedMs(Math.round(elapsed));

      const analyser = analyserRef.current;
      const samples = samplesRef.current;
      let rms = 0;
      if (analyser !== null && samples !== null) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const v = (samples[i]! - 128) / 128;
          sum += v * v;
        }
        rms = Math.sqrt(sum / samples.length);
      }
      setLevel(Math.min(1, rms * 6));

      const now = performance.now();
      if (rms > SILENCE_RMS) {
        spokeRef.current = true;
        quietSinceRef.current = null;
      } else if (spokeRef.current) {
        if (quietSinceRef.current === null) quietSinceRef.current = now;
        else if (now - quietSinceRef.current >= silenceMs) {
          // Somebody spoke and then stopped: finish rather than record the room.
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
          return;
        }
      }

      if (elapsed >= maxMs && recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
    }, 100);
  }, [maxMs, silenceMs, state, supported, finish]);

  const onDone = useCallback((cb: (blob: Blob, mimeType: string, durationMs: number) => void) => {
    doneRef.current = cb;
  }, []);

  /**
   * Return to `idle` once the caller has dealt with the transcript — or given up on it. Kept separate
   * from `finish` because the caller, not this hook, knows when the transcription is over.
   */
  const reset = useCallback(() => {
    release();
    setLevel(0);
    setElapsedMs(0);
    setState('idle');
  }, [release]);

  return { supported, state, error, elapsedMs, level, maxMs, start, stop, cancel, reset, onDone };
}
