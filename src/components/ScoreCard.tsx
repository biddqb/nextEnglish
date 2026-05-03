import { useEffect, useState } from "react";
import type { ScoreData } from "../lib/types";

type Props = {
  score: ScoreData;
  referenceText: string;
  onTryAgain: () => void;
  // Auto-loop: when set, ShadowSession is counting down to an automatic
  // re-record. The card shows a tick-down + Hold control under Try Again.
  autoLoopRemainingMs?: number | null;
  onHoldAutoLoop?: () => void;
};

// Editorial / instrument-panel layout per design 3A.
//
// Big display-mega number (Waldenburg Light substitute = EB Garamond 300),
// three caption-uppercase sub-metrics underneath, reference text below with
// mispronounced words rendered as a hairline underline (no color), missed
// words struck through. Tone: "here's what we measured, you decide what
// to do with it" — treats the user as an adult.
export function ScoreCard({
  score,
  referenceText,
  onTryAgain,
  autoLoopRemainingMs,
  onHoldAutoLoop,
}: Props) {
  // Tween the number from 0 to score.overall over 600ms ease-out.
  const display = useTween(score.overall, 600);

  return (
    <section
      aria-live="polite"
      className="mx-auto max-w-md text-center score-rise"
    >
      <div className="text-display-mega text-ink tabular-nums">
        {display}
      </div>
      <div className="text-caption-uppercase text-muted mt-sm">Overall</div>

      <div className="mt-xl flex items-baseline justify-center gap-xl">
        <Stat label="Words" value={pct(score.word_accuracy)} />
        <Stat label="Cadence" value={pct(score.cadence)} />
        <Stat
          label="Pitch"
          value={
            score.pitch_corr == null
              ? "—"
              : (score.pitch_corr >= 0 ? "+" : "") + score.pitch_corr.toFixed(2)
          }
        />
      </div>

      <p className="text-body-md text-body mt-xxl text-left">
        <ReferenceWithFlags
          text={referenceText}
          flags={score.word_flags}
          userTranscript={score.user_transcript}
        />
      </p>

      <div className="mt-xl flex flex-col items-center gap-sm">
        <button onClick={onTryAgain} className="button-primary">
          Try again · Space
        </button>
        {autoLoopRemainingMs != null && (
          <div className="flex items-center gap-xs text-caption-uppercase text-muted">
            <span className="tabular-nums">
              Auto re-record in {(autoLoopRemainingMs / 1000).toFixed(1)}s
            </span>
            <span aria-hidden="true">·</span>
            <button
              onClick={onHoldAutoLoop}
              className="hover:text-ink underline-offset-2 hover:underline"
            >
              Hold
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption-uppercase text-muted">{label}</div>
      <div className="text-title-md text-ink mt-xxs tabular-nums">{value}</div>
    </div>
  );
}

function pct(v: number): string {
  return `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
}

function useTween(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

// Render the reference text with each word's match/miss state visualized:
//   - matched word: plain text
//   - reference word NOT heard in user attempt: hairline-strong underline,
//     no color (per design 3A — informational, not punitive)
//
// Words are matched against the WordFlag list returned by the score module,
// which uses the same tokenization (lowercase, strip punctuation). We
// preserve the original-cased text from the reference for readability.
function ReferenceWithFlags({
  text,
  flags,
  userTranscript: _userTranscript,
}: {
  text: string;
  flags: { word: string; matched: boolean }[];
  userTranscript: string;
}) {
  // Tokenize same way the Rust/Python score does.
  const refTokens = text.split(/(\s+)/);
  const flagsByNormalized = new Map<string, boolean>();
  flags.forEach((f) => {
    if (!flagsByNormalized.has(f.word)) {
      flagsByNormalized.set(f.word, f.matched);
    }
  });

  const consumedKeys = new Set<string>();

  return (
    <>
      {refTokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const norm = normalize(tok);
        const matchedKey = `${norm}-${i}`;
        const matched = flagsByNormalized.get(norm);
        consumedKeys.add(matchedKey);
        const className =
          matched === false
            ? "underline decoration-hairline-strong decoration-[1px] underline-offset-[3px]"
            : "";
        return (
          <span key={i} className={className}>
            {tok}
          </span>
        );
      })}
    </>
  );
}

function normalize(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .replace(/'/g, "");
}
