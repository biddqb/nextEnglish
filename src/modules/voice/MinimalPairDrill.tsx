// Minimal-pair pronunciation drill sub-mode of the Voice module.
//
// Curated word pairs (ship/sheep, bit/beat, etc.). User pronounces each
// member of the pair; Whisper transcribes both. If Whisper hears the right
// word for both, your contrast is distinct enough; if it transcribes both
// as the same word or swaps them, that's the sound you're confusing.
//
// Whisper-as-listener is the whole point: we explicitly do NOT score by
// cadence, pitch, or any continuous signal. The discrete check is the
// pedagogical signal — "could a listener tell which one I said?"
//
// One useVoiceRecording instance, alternated between "side A" and "side B"
// captures. The active side is held in component state; the effect that
// watches rec.state collects the transcript into the right slot then
// resets the hook.

import clsx from "clsx";
import { useEffect, useState } from "react";
import { RecordButton } from "../../components/RecordButton";
import { WaveformMeter } from "../../components/WaveformMeter";
import {
  useVoiceRecording,
  type VoiceRecordingResult,
} from "./useVoiceRecording";

export type MinimalPair = {
  a: string;
  b: string;
  contrast: string; // human-readable phonetic contrast, e.g. "ɪ vs iː"
};

// Curated for ESL-typical IT/business voiceover difficulties: ɪ/iː tense
// vowels, ɛ/æ, ʌ/æ, θ/s, v/w, v/b, l/r. Order is roughly easy → hard.
export const MINIMAL_PAIRS: ReadonlyArray<MinimalPair> = [
  { a: "ship", b: "sheep", contrast: "ɪ vs iː" },
  { a: "bit", b: "beat", contrast: "ɪ vs iː" },
  { a: "fit", b: "feet", contrast: "ɪ vs iː" },
  { a: "live", b: "leave", contrast: "ɪ vs iː" },
  { a: "sit", b: "seat", contrast: "ɪ vs iː" },
  { a: "fill", b: "feel", contrast: "ɪ vs iː" },
  { a: "pitch", b: "peach", contrast: "ɪ vs iː" },
  { a: "then", b: "than", contrast: "ɛ vs æ" },
  { a: "send", b: "sand", contrast: "ɛ vs æ" },
  { a: "bet", b: "bat", contrast: "ɛ vs æ" },
  { a: "men", b: "man", contrast: "ɛ vs æ" },
  { a: "cup", b: "cap", contrast: "ʌ vs æ" },
  { a: "cut", b: "cat", contrast: "ʌ vs æ" },
  { a: "luck", b: "lack", contrast: "ʌ vs æ" },
  { a: "think", b: "sink", contrast: "θ vs s" },
  { a: "three", b: "tree", contrast: "θ vs t" },
  { a: "mouth", b: "mouse", contrast: "θ vs s" },
  { a: "vest", b: "west", contrast: "v vs w" },
  { a: "very", b: "berry", contrast: "v vs b" },
  { a: "lock", b: "rock", contrast: "l vs r" },
];

type Side = "a" | "b";

type Capture = {
  heard: string;
  matched: boolean;
};

export function MinimalPairDrill() {
  const rec = useVoiceRecording();
  const [pairIndex, setPairIndex] = useState(0);
  const [activeSide, setActiveSide] = useState<Side | null>(null);
  const [capturedA, setCapturedA] = useState<Capture | null>(null);
  const [capturedB, setCapturedB] = useState<Capture | null>(null);

  const pair = MINIMAL_PAIRS[pairIndex];

  // Drain a "ready" transcription into the slot the user was recording for,
  // then reset the hook so the next "Say X" button can start cleanly.
  useEffect(() => {
    if (rec.state.kind !== "ready" || activeSide == null) return;
    const heard = transcriptOf(rec.state.result);
    const target = activeSide === "a" ? pair.a : pair.b;
    const cap: Capture = { heard, matched: heardMatches(heard, target) };
    if (activeSide === "a") setCapturedA(cap);
    else setCapturedB(cap);
    setActiveSide(null);
    rec.reset();
  }, [rec, rec.state, activeSide, pair.a, pair.b]);

  function onRecordSide(side: Side) {
    if (rec.state.kind === "recording" && activeSide === side) {
      void rec.stop();
      return;
    }
    if (
      rec.state.kind === "recording" ||
      rec.state.kind === "analyzing" ||
      activeSide != null
    ) {
      return;
    }
    setActiveSide(side);
    void rec.start();
  }

  function onNextPair() {
    setCapturedA(null);
    setCapturedB(null);
    setPairIndex((i) => (i + 1) % MINIMAL_PAIRS.length);
  }

  function onResetPair() {
    setCapturedA(null);
    setCapturedB(null);
  }

  const bothDone = capturedA != null && capturedB != null;
  const contrastClean =
    bothDone && capturedA!.matched && capturedB!.matched;
  const contrastConfused =
    bothDone &&
    !contrastClean &&
    normalize(capturedA!.heard) === normalize(capturedB!.heard);

  return (
    <div className="flex flex-col items-center gap-base">
      <div className="text-caption-uppercase text-muted">
        Pair {pairIndex + 1} of {MINIMAL_PAIRS.length} · {pair.contrast}
      </div>

      <div className="my-base flex items-center gap-xl">
        <PairColumn
          word={pair.a}
          side="a"
          capture={capturedA}
          recording={rec.state.kind === "recording" && activeSide === "a"}
          analyzing={rec.state.kind === "analyzing" && activeSide === "a"}
          disabled={
            (rec.state.kind === "recording" || rec.state.kind === "analyzing") &&
            activeSide !== "a"
          }
          onClick={() => onRecordSide("a")}
        />
        <div className="text-display-md text-muted-soft">vs</div>
        <PairColumn
          word={pair.b}
          side="b"
          capture={capturedB}
          recording={rec.state.kind === "recording" && activeSide === "b"}
          analyzing={rec.state.kind === "analyzing" && activeSide === "b"}
          disabled={
            (rec.state.kind === "recording" || rec.state.kind === "analyzing") &&
            activeSide !== "b"
          }
          onClick={() => onRecordSide("b")}
        />
      </div>

      {rec.state.kind === "recording" && (
        <WaveformMeter active={true} getLevel={rec.meter} />
      )}
      {rec.state.kind === "error" && (
        <div className="text-body-sm text-semantic-error" role="alert">
          {rec.state.message}
        </div>
      )}

      {bothDone && (
        <div className="mt-base flex flex-col items-center gap-sm">
          {contrastClean ? (
            <div className="text-body-md text-semantic-success">
              Clean contrast — Whisper heard both correctly.
            </div>
          ) : contrastConfused ? (
            <div className="text-body-md text-semantic-error">
              Confused — Whisper heard the same word both times. Drill this
              contrast.
            </div>
          ) : (
            <div className="text-body-md text-body">
              Partial — at least one side wasn't heard as the prompt.
            </div>
          )}
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={onResetPair}
              className="rounded-md border border-hairline-strong px-base py-sm text-button text-ink hover:bg-surface-strong"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onNextPair}
              className="rounded-md bg-ink-press px-base py-sm text-button text-on-primary hover:bg-ink"
            >
              Next pair →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PairColumn({
  word,
  capture,
  recording,
  analyzing,
  disabled,
  onClick,
}: {
  word: string;
  side: Side;
  capture: Capture | null;
  recording: boolean;
  analyzing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-sm">
      <div
        className={clsx(
          "text-display-md",
          capture?.matched && "text-semantic-success",
          capture && !capture.matched && "text-semantic-error",
          !capture && "text-ink",
        )}
      >
        {word}
      </div>
      <RecordButton
        state={recording ? "recording" : "idle"}
        onClick={onClick}
        disabled={disabled || analyzing}
      />
      {analyzing && (
        <div className="text-caption-uppercase text-muted listen-pulse">
          Analyzing
        </div>
      )}
      {capture && (
        <div className="text-caption text-muted">
          Heard: <span className="text-body-strong">{capture.heard || "(silence)"}</span>
        </div>
      )}
    </div>
  );
}

// Exported for testing.
export function transcriptOf(result: VoiceRecordingResult): string {
  return result.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

// Exported for testing. Whisper often returns "Ship." or "ship," — strip
// punctuation + case and compare. Also accepts the exact prompt as a
// substring (Whisper sometimes prepends "I", "the", etc. when given a
// single word in isolation).
export function heardMatches(heard: string, prompt: string): boolean {
  const h = normalize(heard);
  const p = normalize(prompt);
  if (h === p) return true;
  // Substring match only when the prompt is the trailing word, to avoid
  // counting "ship" inside "shipping".
  const tokens = h.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] === p;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
