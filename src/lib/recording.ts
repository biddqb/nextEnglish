// Shared record-and-score flow used by every skill module that captures
// user audio and scores it against a reference. Pre-extraction (before this
// file existed), ShadowSession.tsx and ReviewMode.tsx each implemented the
// same five-step sequence inline:
//
//   1. acquire mic via navigator.mediaDevices.getUserMedia
//   2. start MediaRecorder + register data/stop handlers
//   3. on stop: collect blob, encode base64
//   4. POST blob to Rust → save_attempt → returns wav path
//   5. POST wav path to Rust → score_attempt → returns ScoreData
//
// The two callers diverge only in WHERE they store the resulting state:
// Shadow writes into the global zustand session; SRS writes into a local
// Phase useState. The hook below handles steps 1-5 and surfaces lifecycle
// callbacks so each caller can update its own state machine.
//
// Per /plan-eng-review issue 2A. Step 4 of the modular-architecture plan.

import { useRef } from "react";
import { useSaveAttempt, useScoreAttempt } from "./queries";
import { startRecording, type RecorderHandle } from "./audio";
import type { ScoreData } from "./types";

export type UseRecordAndScoreOptions = {
  clipId: number;
  segmentIndex: number;

  // Fired after the mic is acquired and MediaRecorder is recording. The
  // caller transitions its state machine to "recording" here.
  onRecordingStarted?: () => void;

  // Fired after the user stops, before the score round-trip completes.
  // The caller transitions to its "analyzing" state here.
  onAnalyzing?: () => void;

  // Fired after score_attempt returns. The caller transitions to "scored"
  // and surfaces the ScoreCard.
  onScored?: (userAudioPath: string, score: ScoreData) => void;

  // Fired on any failure in start() or stop() — mic denied, recording
  // aborted, save/score returned an error envelope. The caller is
  // responsible for resetting its own state machine; the hook does not
  // assume a destination state.
  onError?: (message: string) => void;
};

export type RecordAndScoreApi = {
  // Acquire the mic and begin recording. Resolves when MediaRecorder is
  // running (or when an error fires onError). Does NOT play the reference
  // audio — that's the caller's concern (they own the audio element).
  start: () => Promise<void>;

  // Stop the recorder, encode, save, score. Resolves after onScored or
  // onError has fired. No-op if start() was never called.
  stop: () => Promise<void>;

  // Tear down a live recorder without going through the save/score path.
  // Used in useEffect cleanup when the component unmounts mid-recording.
  cancel: () => void;

  // Returns the current input RMS in [0, 1] for live waveform visualization.
  // Returns 0 when no recorder is active. Read this on every animation
  // frame from the WaveformMeter.
  meter: () => number;
};

export function useRecordAndScore(
  options: UseRecordAndScoreOptions,
): RecordAndScoreApi {
  const recorderRef = useRef<RecorderHandle | null>(null);
  const saveAttempt = useSaveAttempt();
  const scoreAttempt = useScoreAttempt();

  async function start() {
    try {
      const handle = await startRecording();
      recorderRef.current = handle;
      options.onRecordingStarted?.();
    } catch (e) {
      options.onError?.(messageOf(e));
    }
  }

  async function stop() {
    const handle = recorderRef.current;
    recorderRef.current = null;
    if (!handle) return;

    const audio = await handle.stop();
    const b64 = await audio.base64;

    options.onAnalyzing?.();
    try {
      const path = await saveAttempt.mutateAsync({
        clipId: options.clipId,
        segmentIndex: options.segmentIndex,
        audioBase64: b64,
        extension: audio.extension,
      });
      const score = await scoreAttempt.mutateAsync({
        clipId: options.clipId,
        segmentIndex: options.segmentIndex,
        attemptAudioPath: path,
      });
      options.onScored?.(path, score);
    } catch (e) {
      options.onError?.(messageOf(e));
    }
  }

  function cancel() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }

  function meter(): number {
    return recorderRef.current?.meter() ?? 0;
  }

  return { start, stop, cancel, meter };
}

// Mirrors the `messageOf` helper that was duplicated in both ShadowSession
// and ReviewMode. CmdError from the Rust side comes through as
// {code, message, retryable}; surface both pieces so the user can see the
// underlying failure without DevTools.
function messageOf(e: unknown): string {
  const x = e as { message?: string; code?: string };
  if (x.code) return `${x.code}: ${x.message ?? "error"}`;
  return x.message ?? String(e);
}

// Re-exported so callers can show the error message without re-implementing
// the discriminated-union case analysis. Used by tests too.
export { messageOf };
