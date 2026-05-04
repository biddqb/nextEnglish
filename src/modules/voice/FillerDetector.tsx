// Filler-word detector sub-mode of the Voice module.
//
// Records a voiceover take, transcribes via existing Whisper ASR, counts
// occurrences of curated filler words ("um", "uh", "like", "you know", etc.)
// and surfaces a per-take total + per-word marks on the transcript view.
//
// Filler list is intentionally curated (not user-editable yet) — these are
// the high-frequency English fillers most relevant to IT/AI YouTube
// voiceover work. Multi-word phrases ("you know", "kind of") are matched
// against adjacent word pairs in the segment.

import clsx from "clsx";
import { useMemo } from "react";
import { RecordButton } from "../../components/RecordButton";
import { WaveformMeter } from "../../components/WaveformMeter";
import type { Segment } from "../../lib/types";
import { useVoiceRecording, type VoiceRecordingResult } from "./useVoiceRecording";

const FILLERS_SINGLE = new Set([
  "um",
  "uh",
  "uhh",
  "umm",
  "er",
  "ah",
  "like",
  "right",
  "so",
  "basically",
  "actually",
  "literally",
]);

const FILLERS_PHRASE: ReadonlyArray<string[]> = [
  ["you", "know"],
  ["kind", "of"],
  ["sort", "of"],
  ["i", "mean"],
];

export type FillerHit = {
  segmentIndex: number;
  wordIndex: number;
  length: number; // 1 for single-word fillers, 2 for phrases
  text: string;
};

export function FillerDetector() {
  const rec = useVoiceRecording();

  const hits = useMemo(() => {
    if (rec.state.kind !== "ready") return [];
    return countFillers(rec.state.result);
  }, [rec.state]);

  const totalWords = useMemo(() => {
    if (rec.state.kind !== "ready") return 0;
    return rec.state.result.segments.reduce((n, s) => n + s.words.length, 0);
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

      {rec.state.kind === "ready" && (
        <FillerResults
          result={rec.state.result}
          hits={hits}
          totalWords={totalWords}
          onTryAgain={() => {
            rec.reset();
            void rec.start();
          }}
        />
      )}
    </div>
  );
}

function FillerResults({
  result,
  hits,
  totalWords,
  onTryAgain,
}: {
  result: VoiceRecordingResult;
  hits: FillerHit[];
  totalWords: number;
  onTryAgain: () => void;
}) {
  const durationMin = result.duration_ms / 60000;
  const fillerPerMin = durationMin > 0 ? hits.length / durationMin : 0;
  const fillerPercent = totalWords > 0 ? (hits.length / totalWords) * 100 : 0;

  const hitsBySegment = new Map<number, FillerHit[]>();
  for (const h of hits) {
    const arr = hitsBySegment.get(h.segmentIndex) ?? [];
    arr.push(h);
    hitsBySegment.set(h.segmentIndex, arr);
  }

  return (
    <div className="mt-base w-full">
      <div className="mb-lg grid grid-cols-3 gap-base text-center">
        <Stat
          label="Fillers"
          value={hits.length.toString()}
          tone={hits.length === 0 ? "good" : hits.length > 6 ? "bad" : "neutral"}
        />
        <Stat label="Per minute" value={fillerPerMin.toFixed(1)} />
        <Stat label="% of words" value={`${fillerPercent.toFixed(1)}%`} />
      </div>

      {result.segments.length === 0 ? (
        <div className="text-body-sm text-muted text-center">
          No speech detected.
        </div>
      ) : (
        <div className="flex flex-col gap-sm">
          {result.segments.map((seg, i) => (
            <SegmentLine
              key={i}
              segment={seg}
              hits={hitsBySegment.get(i) ?? []}
            />
          ))}
        </div>
      )}

      <div className="mt-lg flex justify-center">
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

function SegmentLine({
  segment,
  hits,
}: {
  segment: Segment;
  hits: FillerHit[];
}) {
  // Mark word indices that fall inside any filler hit. For phrase hits,
  // every word in the span is marked.
  const marked = new Set<number>();
  for (const h of hits) {
    for (let i = 0; i < h.length; i++) marked.add(h.wordIndex + i);
  }

  return (
    <p className="text-body-md text-body leading-relaxed">
      {segment.words.map((w, i) => (
        <span
          key={i}
          className={clsx(
            marked.has(i) &&
              "rounded-xs bg-gradient-peach/40 px-xxs text-body-strong",
          )}
        >
          {w.word}
          {i < segment.words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "neutral" | "bad";
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

// Exported for testing. Walks all segments' word arrays, matches each word
// (lowercased, stripped of trailing punctuation) against the single-word
// filler set, then re-walks for two-word phrases.
export function countFillers(result: VoiceRecordingResult): FillerHit[] {
  const out: FillerHit[] = [];
  result.segments.forEach((seg, segIdx) => {
    const norm = seg.words.map((w) => normalize(w.word));

    for (let i = 0; i < norm.length; i++) {
      if (FILLERS_SINGLE.has(norm[i])) {
        out.push({
          segmentIndex: segIdx,
          wordIndex: i,
          length: 1,
          text: norm[i],
        });
      }
    }

    for (let i = 0; i < norm.length - 1; i++) {
      for (const phrase of FILLERS_PHRASE) {
        if (norm[i] === phrase[0] && norm[i + 1] === phrase[1]) {
          out.push({
            segmentIndex: segIdx,
            wordIndex: i,
            length: 2,
            text: phrase.join(" "),
          });
        }
      }
    }
  });
  return out;
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}
