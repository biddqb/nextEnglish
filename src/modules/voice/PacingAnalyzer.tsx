// Pacing analyzer sub-mode of the Voice module.
//
// Records a voiceover take, computes words-per-minute, silence ratio, and
// longest pause from Whisper word-level timestamps. All three derive from
// the same `segments[].words[]` array — no extra backend pass.
//
// Word timestamps are in seconds (per WordTimestamp); duration_ms in ms.
// Mind the units when changing the math.

import clsx from "clsx";
import { useMemo } from "react";
import { RecordButton } from "../../components/RecordButton";
import { WaveformMeter } from "../../components/WaveformMeter";
import {
  useVoiceRecording,
  type VoiceRecordingResult,
} from "./useVoiceRecording";

export type PacingStats = {
  wpm: number;
  silenceRatio: number; // 0..1
  longestPauseMs: number;
  totalWords: number;
};

// Comfortable narration target. Below = too slow, above = too rushed.
// Used only as a visual cue, not a hard pass/fail.
const WPM_LOW = 130;
const WPM_HIGH = 170;
const PAUSE_LONG_MS = 1500;
const SILENCE_HIGH = 0.4;

export function PacingAnalyzer() {
  const rec = useVoiceRecording();

  const stats = useMemo(() => {
    if (rec.state.kind !== "ready") return null;
    return computePacing(rec.state.result);
  }, [rec.state]);

  function onRecordButtonClick() {
    if (rec.state.kind === "idle" || rec.state.kind === "error") {
      void rec.start();
    } else if (rec.state.kind === "recording") {
      void rec.stop();
    } else if (rec.state.kind === "ready") {
      rec.reset();
      void rec.start();
    }
  }

  return (
    <div className="flex flex-col items-center gap-base">
      <RecordButton
        state={rec.state.kind === "recording" ? "recording" : "idle"}
        onClick={onRecordButtonClick}
        disabled={rec.state.kind === "analyzing"}
      />

      {rec.state.kind === "recording" && (
        <WaveformMeter active={true} getLevel={rec.meter} />
      )}
      {rec.state.kind === "analyzing" && (
        <div className="text-caption-uppercase text-muted listen-pulse">
          Analyzing
        </div>
      )}
      {rec.state.kind === "error" && (
        <div className="text-body-sm text-semantic-error" role="alert">
          {rec.state.message}
        </div>
      )}

      {rec.state.kind === "ready" && stats && (
        <PacingResults
          stats={stats}
          onTryAgain={() => {
            rec.reset();
            void rec.start();
          }}
        />
      )}
    </div>
  );
}

function PacingResults({
  stats,
  onTryAgain,
}: {
  stats: PacingStats;
  onTryAgain: () => void;
}) {
  const wpmTone =
    stats.wpm === 0
      ? "neutral"
      : stats.wpm < WPM_LOW
        ? "bad"
        : stats.wpm > WPM_HIGH
          ? "bad"
          : "good";

  const silenceTone = stats.silenceRatio > SILENCE_HIGH ? "bad" : "neutral";
  const pauseTone = stats.longestPauseMs > PAUSE_LONG_MS ? "bad" : "neutral";

  return (
    <div className="mt-base w-full">
      <div className="mb-lg grid grid-cols-3 gap-base text-center">
        <Stat label="WPM" value={Math.round(stats.wpm).toString()} tone={wpmTone} />
        <Stat
          label="Silence"
          value={`${Math.round(stats.silenceRatio * 100)}%`}
          tone={silenceTone}
        />
        <Stat
          label="Longest pause"
          value={formatPause(stats.longestPauseMs)}
          tone={pauseTone}
        />
      </div>

      <p className="text-body-sm text-muted text-center mb-lg">
        Comfortable narration sits between {WPM_LOW}–{WPM_HIGH} WPM.
      </p>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onTryAgain}
          className="rounded-md border border-hairline-strong px-base py-sm text-button text-ink hover:bg-surface-strong"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "neutral" | "bad";
}) {
  return (
    <div>
      <div
        className={clsx(
          "text-display-md",
          tone === "good" && "text-semantic-success",
          tone === "bad" && "text-semantic-error",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </div>
      <div className="text-caption-uppercase text-muted">{label}</div>
    </div>
  );
}

function formatPause(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Exported for testing. WPM, silence ratio, and longest pause from word
// timestamps. word.start/word.end are seconds; duration_ms is ms.
export function computePacing(result: VoiceRecordingResult): PacingStats {
  const allWords = result.segments.flatMap((s) => s.words);
  const totalWords = allWords.length;
  const durationMs = result.duration_ms;

  if (durationMs <= 0 || totalWords === 0) {
    return { wpm: 0, silenceRatio: 0, longestPauseMs: 0, totalWords };
  }

  const wpm = (totalWords / durationMs) * 60000;

  const speechMs = allWords.reduce(
    (sum, w) => sum + Math.max(0, (w.end - w.start) * 1000),
    0,
  );
  const silenceRatio = clamp01(1 - speechMs / durationMs);

  // Longest pause: max gap between consecutive word boundaries, plus the
  // bookends (start of audio → first word, last word → end of audio).
  const sorted = [...allWords].sort((a, b) => a.start - b.start);
  let longestPauseMs = sorted[0].start * 1000;
  for (let i = 1; i < sorted.length; i++) {
    const gapMs = (sorted[i].start - sorted[i - 1].end) * 1000;
    if (gapMs > longestPauseMs) longestPauseMs = gapMs;
  }
  const tailMs = durationMs - sorted[sorted.length - 1].end * 1000;
  if (tailMs > longestPauseMs) longestPauseMs = tailMs;
  longestPauseMs = Math.max(0, longestPauseMs);

  return { wpm, silenceRatio, longestPauseMs, totalWords };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
