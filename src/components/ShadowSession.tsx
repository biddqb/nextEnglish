import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  useClip,
  useSaveAttempt,
  useSaveCard,
  useSavedSegments,
  useScoreAttempt,
  useSettings,
  useUnsaveCard,
} from "../lib/queries";
import { useStore } from "../lib/store";
import { startRecording, tauriFileUrl, type RecorderHandle } from "../lib/audio";
import { RecordButton } from "./RecordButton";
import { Scrubber } from "./Scrubber";
import { ScoreCard } from "./ScoreCard";
import { AttemptHistory } from "./AttemptHistory";
import { ClozeEditor } from "./ClozeEditor";
import { PitchOverlay } from "./PitchOverlay";
import { WaveformMeter } from "./WaveformMeter";

// The shadowing loop. Plays reference audio for the selected segment, captures
// user audio via MediaRecorder, sends to Rust for scoring, shows ScoreCard.
//
// State machine in zustand store:
//   idle → listening (auto-plays reference) → recording → analyzing → scored
//                                                                       ↓
//                                                                  try-again → idle
export function ShadowSession({
  clipId,
  segmentIndex,
}: {
  clipId: number;
  segmentIndex: number;
}) {
  const { data } = useClip(clipId);
  const session = useStore((s) => s.session);
  const startRecord = useStore((s) => s.startRecording);
  const startAnalyzing = useStore((s) => s.startAnalyzing);
  const setScore = useStore((s) => s.setScore);
  const reset = useStore((s) => s.reset);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [refTime, setRefTime] = useState({ currentMs: 0, durationMs: 0 });
  const [recordError, setRecordError] = useState<string | null>(null);
  // Auto re-record countdown: a configurable editorial pause after scoring
  // before the app fires another attempt. The duration comes from user
  // settings (`autoLoopMs`); 0 disables the auto-loop entirely. `null` means
  // inactive (no scored result, or the user pressed Hold). User can also
  // short-circuit by clicking Try again — the session.kind transition tears
  // the timer down on its own.
  const settings = useSettings();
  const [autoLoopRemainingMs, setAutoLoopRemainingMs] = useState<number | null>(
    null,
  );
  const AUTO_LOOP_TICK_MS = 100;

  const saveAttempt = useSaveAttempt();
  const scoreAttempt = useScoreAttempt();
  const { data: saved } = useSavedSegments(clipId);
  const saveCard = useSaveCard();
  const unsaveCard = useUnsaveCard();
  const isSaved = (saved ?? []).includes(segmentIndex);

  function toggleSaveCard() {
    if (isSaved) {
      unsaveCard.mutate({ clipId, segmentIndex });
    } else {
      saveCard.mutate({ clipId, segmentIndex });
    }
  }

  const seg = data?.segments[segmentIndex];
  const refSrc = useMemo(() => {
    if (!data) return undefined;
    // Tauri asset URL for the clip's normalized 16k mono WAV. The audio
    // element will scrub to the segment range via currentTime.
    return tauriFileUrl(data.clip.audio_path);
  }, [data]);

  const refStartS = (seg?.start_ms ?? 0) / 1000;
  const refEndS = (seg?.end_ms ?? 0) / 1000;
  const refSegDurationMs = (seg?.end_ms ?? 0) - (seg?.start_ms ?? 0);

  // Keep audio element scrubbed within the segment range; auto-stop at end.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !seg) return;
    a.currentTime = refStartS;
    a.pause();
    setRefTime({ currentMs: 0, durationMs: refSegDurationMs });
    setRecordError(null);
  }, [seg, refStartS, refSegDurationMs]);

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a) return;
    if (a.currentTime >= refEndS) {
      a.pause();
      a.currentTime = refStartS;
    }
    setRefTime({
      currentMs: Math.max(0, (a.currentTime - refStartS) * 1000),
      durationMs: refSegDurationMs,
    });
  }

  function playReference() {
    const a = audioRef.current;
    if (!a) return;
    if (a.currentTime < refStartS || a.currentTime >= refEndS) {
      a.currentTime = refStartS;
    }
    void a.play();
  }

  async function startRecordingFlow() {
    setRecordError(null);
    try {
      // Auto-play reference at the start of recording (UI_DESIGN flow).
      playReference();
      const handle = await startRecording();
      recorderRef.current = handle;
      startRecord(segmentIndex);
    } catch (e) {
      setRecordError(messageOf(e));
      reset();
    }
  }

  async function stopRecordingFlow() {
    const handle = recorderRef.current;
    recorderRef.current = null;
    if (!handle) return;

    const audio = await handle.stop();
    const b64 = await audio.base64;

    startAnalyzing(segmentIndex, "");
    try {
      const path = await saveAttempt.mutateAsync({
        clipId,
        segmentIndex,
        audioBase64: b64,
        extension: audio.extension,
      });
      const score = await scoreAttempt.mutateAsync({
        clipId,
        segmentIndex,
        attemptAudioPath: path,
      });
      setScore(segmentIndex, path, score);
    } catch (e) {
      setRecordError(messageOf(e));
      reset();
    }
  }

  function onRecordButtonClick() {
    if (session.kind === "idle" || session.kind === "scored") {
      void startRecordingFlow();
    } else if (session.kind === "recording" || session.kind === "listening") {
      void stopRecordingFlow();
    }
  }

  // Cleanup on unmount: kill recorder + audio playback.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  // Start the auto-loop countdown when entering scored; tear it down on any
  // other state. (Switching segments resets the session via the store, so
  // this also covers segment changes.) `autoLoopMs <= 0` disables the loop.
  useEffect(() => {
    if (session.kind === "scored" && settings.autoLoopMs > 0) {
      setAutoLoopRemainingMs(settings.autoLoopMs);
    } else {
      setAutoLoopRemainingMs(null);
    }
  }, [session.kind, settings.autoLoopMs]);

  // Tick the countdown. When it hits zero, fire a re-record. Each tick is
  // its own setTimeout so React state updates batch normally.
  useEffect(() => {
    if (autoLoopRemainingMs == null) return;
    if (autoLoopRemainingMs <= 0) {
      setAutoLoopRemainingMs(null);
      reset();
      void startRecordingFlow();
      return;
    }
    const t = setTimeout(() => {
      setAutoLoopRemainingMs((v) =>
        v == null ? null : Math.max(0, v - AUTO_LOOP_TICK_MS),
      );
    }, AUTO_LOOP_TICK_MS);
    return () => clearTimeout(t);
  }, [autoLoopRemainingMs]);

  function holdAutoLoop() {
    setAutoLoopRemainingMs(null);
  }

  if (!data || !seg) {
    return (
      <div className="px-xl py-app-section text-body-md text-muted">Loading…</div>
    );
  }

  const recordState = recordStateOf(session.kind);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-xl py-app-section">
      <div className="mb-xs flex items-center gap-sm">
        <span className="text-caption-uppercase text-muted">
          Segment {segmentIndex + 1} of {data.segments.length}
        </span>
        <button
          onClick={toggleSaveCard}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Remove from review queue" : "Save for review"}
          title={isSaved ? "Saved · click to remove" : "Save for review"}
          className={clsx(
            "flex h-6 w-6 items-center justify-center rounded-md transition",
            isSaved
              ? "text-ink"
              : "text-muted-soft hover:text-ink",
          )}
        >
          <span aria-hidden="true" className="text-body-md leading-none">
            {isSaved ? "★" : "☆"}
          </span>
        </button>
      </div>
      <h2 className="text-display-md text-ink mb-base">{seg.text}</h2>

      {isSaved && (
        <ClozeEditor
          clipId={clipId}
          segmentIndex={segmentIndex}
          segmentText={seg.text}
        />
      )}

      <div className="mb-xxl" />

      <audio
        ref={audioRef}
        src={refSrc}
        onTimeUpdate={onTimeUpdate}
        preload="auto"
      />

      <div className="mb-xxl flex items-center gap-base">
        <button
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            a.paused ? playReference() : a.pause();
          }}
          aria-label="Play reference"
          className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-ink-press text-on-primary"
        >
          ▶
        </button>
        <Scrubber
          currentMs={refTime.currentMs}
          durationMs={refTime.durationMs}
          onSeek={(ms) => {
            const a = audioRef.current;
            if (!a) return;
            a.currentTime = refStartS + ms / 1000;
            setRefTime((s) => ({ ...s, currentMs: ms }));
          }}
        />
      </div>

      <div className="flex flex-col items-center gap-base">
        <RecordButton
          state={recordState}
          onClick={onRecordButtonClick}
          disabled={session.kind === "analyzing"}
        />
        {session.kind === "recording" && (
          <WaveformMeter
            active={true}
            getLevel={() => recorderRef.current?.meter() ?? 0}
          />
        )}
        {session.kind === "analyzing" && (
          <div className="text-caption-uppercase text-muted listen-pulse">
            Analyzing
          </div>
        )}
        {recordError && (
          <div className="text-body-sm text-semantic-error" role="alert">
            {recordError}
          </div>
        )}
      </div>

      {session.kind === "scored" && (
        <div className="mt-xxl">
          <ScoreCard
            score={session.score}
            referenceText={seg.text}
            onTryAgain={() => {
              reset();
              void startRecordingFlow();
            }}
            autoLoopRemainingMs={autoLoopRemainingMs}
            onHoldAutoLoop={holdAutoLoop}
          />
          <div className="mx-auto max-w-md">
            <PitchOverlay
              score={session.score}
              clipId={clipId}
              segmentIndex={segmentIndex}
              attemptAudioPath={session.userAudioPath}
            />
          </div>
        </div>
      )}

      <AttemptHistory
        clipId={clipId}
        segmentIndex={segmentIndex}
        clipAudioPath={data.clip.audio_path}
        refStartMs={seg.start_ms}
        refEndMs={seg.end_ms}
        paused={
          session.kind === "listening" ||
          session.kind === "recording" ||
          session.kind === "analyzing"
        }
        onPlaybackStart={holdAutoLoop}
      />
    </div>
  );
}

function recordStateOf(kind: string): "idle" | "listening" | "recording" {
  if (kind === "listening") return "listening";
  if (kind === "recording") return "recording";
  return "idle";
}

function messageOf(e: unknown): string {
  const x = e as { message?: string; code?: string };
  if (x.code) return `${x.code}: ${x.message ?? "error"}`;
  return x.message ?? String(e);
}
