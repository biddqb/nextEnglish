// Shared record-and-transcribe flow for the Voice sub-modes (filler /
// pacing / minimal-pair). Higher-level than src/lib/recording.ts'
// useRecordAndScore — this owns the full state machine the sub-modes
// consume + the busy/cancel wiring the shell reads via voiceModule in
// src/lib/modules.tsx.
//
// State machine:
//   idle → recording → analyzing → ready
//                                    ↓
//                                  reset() → idle
//   any state → error → reset() → idle
//
// Per Issue 3A from /plan-eng-review, busy state is local + reported via
// ./state. Cancel impl too.

import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, type RecorderHandle } from "../../lib/audio";
import { useTranscribeVoiceAudio } from "../../lib/queries";
import type { Segment } from "../../lib/types";
import { setBusy, setCancelImpl } from "./state";

export type VoiceRecordingResult = {
  segments: Segment[];
  duration_ms: number;
};

export type VoiceRecordingState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "analyzing" }
  | { kind: "ready"; result: VoiceRecordingResult }
  | { kind: "error"; message: string };

export type VoiceRecordingApi = {
  state: VoiceRecordingState;
  /** Acquire mic, start MediaRecorder. */
  start: () => Promise<void>;
  /** Stop, encode, transcribe. Resolves when state moves to ready/error. */
  stop: () => Promise<void>;
  /** Tear down the recorder without transcribing. */
  cancel: () => void;
  /** Live RMS in [0, 1] for waveform visualization. */
  meter: () => number;
  /** Discard the result, return to idle (for Try-again). */
  reset: () => void;
};

export function useVoiceRecording(): VoiceRecordingApi {
  const [state, setState] = useState<VoiceRecordingState>({ kind: "idle" });
  const recorderRef = useRef<RecorderHandle | null>(null);
  const transcribe = useTranscribeVoiceAudio();

  // Report busy state to the module-level singleton so voiceModule.isBusy()
  // returns the right answer for the shell's Esc handler.
  useEffect(() => {
    setBusy(state.kind === "recording" || state.kind === "analyzing");
  }, [state.kind]);
  useEffect(() => () => setBusy(false), []);

  const reset = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setState({ kind: "idle" });
  }, []);

  // Register cancel impl so the shell's Esc handler can call it.
  useEffect(() => {
    setCancelImpl(cancel);
    return () => setCancelImpl(null);
  }, [cancel]);

  const start = useCallback(async () => {
    try {
      const handle = await startRecording();
      recorderRef.current = handle;
      setState({ kind: "recording" });
    } catch (e) {
      setState({ kind: "error", message: messageOf(e) });
    }
  }, []);

  const stop = useCallback(async () => {
    const handle = recorderRef.current;
    recorderRef.current = null;
    if (!handle) return;

    const audio = await handle.stop();
    const b64 = await audio.base64;

    setState({ kind: "analyzing" });
    try {
      const result = await transcribe.mutateAsync({
        audioBase64: b64,
        extension: audio.extension,
      });
      setState({
        kind: "ready",
        result: { segments: result.segments, duration_ms: result.duration_ms },
      });
    } catch (e) {
      setState({ kind: "error", message: messageOf(e) });
    }
  }, [transcribe]);

  const meter = useCallback(() => {
    return recorderRef.current?.meter() ?? 0;
  }, []);

  // Cleanup on unmount: kill any live recorder.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  return { state, start, stop, cancel, meter, reset };
}

function messageOf(e: unknown): string {
  const x = e as { message?: string; code?: string };
  if (x.code) return `${x.code}: ${x.message ?? "error"}`;
  return x.message ?? String(e);
}
