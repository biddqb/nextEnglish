import { useState } from "react";
import clsx from "clsx";
import { FillerDetector } from "./FillerDetector";
import { PacingAnalyzer } from "./PacingAnalyzer";
import { MinimalPairDrill } from "./MinimalPairDrill";

// The Voice production studio. Three sub-modes share the recording surface
// and editorial chrome; each produces its own kind of feedback:
//
//   - Filler detector: count um/uh/like/etc in your transcript
//   - Pacing analyzer: WPM, silence ratio, longest pause
//   - Minimal-pair drill: pronounce a contrast pair, see if Whisper hears
//                         the distinction
//
// Unlike Shadow and SRS, Voice doesn't need a clip — it analyzes whatever
// you record from scratch. That's why the SkillModule.ui.Session prop
// signature has clipId/segmentIndex as optional; Voice ignores them.
type SubMode = "filler" | "pacing" | "minimal-pair";

const SUB_MODES: Array<{ id: SubMode; label: string; tagline: string }> = [
  { id: "filler", label: "Fillers", tagline: "Count um/uh in your takes" },
  { id: "pacing", label: "Pacing", tagline: "Words-per-minute + pause stats" },
  {
    id: "minimal-pair",
    label: "Pair drill",
    tagline: "Sound contrasts (ship/sheep)",
  },
];

export function VoiceSession() {
  const [active, setActive] = useState<SubMode>("filler");

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-xl py-app-section">
      <div className="text-caption-uppercase text-muted mb-xs">
        Voice production
      </div>
      <h2 className="text-display-md text-ink mb-base">
        {SUB_MODES.find((m) => m.id === active)?.tagline}
      </h2>

      <div
        role="tablist"
        aria-label="Voice sub-modes"
        className="mb-xxl flex gap-xs border-b border-hairline"
      >
        {SUB_MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={active === m.id}
            onClick={() => setActive(m.id)}
            className={clsx(
              "px-base py-sm text-button transition border-b -mb-[1px]",
              active === m.id
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {active === "filler" && <FillerDetector />}
      {active === "pacing" && <PacingAnalyzer />}
      {active === "minimal-pair" && <MinimalPairDrill />}
    </div>
  );
}
