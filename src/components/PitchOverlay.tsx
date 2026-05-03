import { useMemo, useState } from "react";
import { usePitchContour } from "../lib/queries";
import type { PitchContour, ScoreData } from "../lib/types";

// "Show details" panel under the ScoreCard. Hidden by default; the user can
// expand to see the verbatim ASR transcript, per-component scores, and a
// real f0 contour A/B between reference and the current attempt.
//
// The contour is fetched lazily — only when the user opens details — so
// silent attempts and uninterested users don't pay the parselmouth cost.
type Props = {
  score: ScoreData;
  clipId: number;
  segmentIndex: number;
  attemptAudioPath: string;
};

export function PitchOverlay({
  score,
  clipId,
  segmentIndex,
  attemptAudioPath,
}: Props) {
  const [open, setOpen] = useState(false);
  const { data: pitch, isLoading: pitchLoading } = usePitchContour(
    clipId,
    segmentIndex,
    attemptAudioPath,
    open,
  );

  return (
    <div className="border-t border-hairline pt-xl mt-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-caption-uppercase text-muted hover:text-ink"
      >
        {open ? "Hide details" : "Show details"}
      </button>

      {open && (
        <div className="mt-xl">
          <PitchChart pitch={pitch} loading={pitchLoading} />

          <dl className="mt-xl space-y-base text-body-md">
            <div className="grid grid-cols-[120px_1fr] gap-base">
              <dt className="text-caption-uppercase text-muted self-center">
                You said
              </dt>
              <dd className="text-body italic">
                {score.user_transcript || "(silence)"}
              </dd>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-base">
              <dt className="text-caption-uppercase text-muted self-center">
                Words
              </dt>
              <dd className="text-body">
                {score.word_flags.filter((f) => f.matched).length} matched of{" "}
                {score.word_flags.length} reference words ({pct(score.word_accuracy)}).
              </dd>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-base">
              <dt className="text-caption-uppercase text-muted self-center">
                Cadence
              </dt>
              <dd className="text-body">
                {pct(score.cadence)} similarity. DTW over RMS energy contours,
                with silence trimmed via VAD before alignment.
              </dd>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-base">
              <dt className="text-caption-uppercase text-muted self-center">
                Pitch
              </dt>
              <dd className="text-body">
                {score.pitch_corr == null
                  ? "Not measured (too few voiced frames or constant pitch)."
                  : `${score.pitch_corr >= 0 ? "+" : ""}${score.pitch_corr.toFixed(
                      2,
                    )} correlation. Pearson on z-normalized f0 contours, voiced frames only.`}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

// Two overlaid f0 contours: reference (hairline ink) and user (peach orb
// color from UI_DESIGN). Each contour is drawn proportionally — both start
// at x=0 and run to their own endpoints, so a duration mismatch is visible.
// Unvoiced frames break the path into separate segments (no interpolation).
function PitchChart({
  pitch,
  loading,
}: {
  pitch: { ref: PitchContour; user: PitchContour } | undefined;
  loading: boolean;
}) {
  const W = 480;
  const H = 80;
  const padX = 8;
  const padY = 8;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const refPath = useMemo(
    () => pitch && contourPath(pitch.ref, padX, padY, innerW, innerH),
    [pitch, padX, padY, innerW, innerH],
  );
  const userPath = useMemo(
    () => pitch && contourPath(pitch.user, padX, padY, innerW, innerH),
    [pitch, padX, padY, innerW, innerH],
  );

  if (loading) {
    return (
      <div className="text-caption-uppercase text-muted">
        Computing pitch contour…
      </div>
    );
  }
  if (!pitch || (refPath === "" && userPath === "")) {
    return (
      <div className="text-caption-uppercase text-muted">
        Pitch unavailable for this attempt.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-sm flex items-center gap-base text-caption-uppercase text-muted">
        <LegendKey label="Reference" colorClass="text-ink" />
        <LegendKey label="You" colorClass="text-gradient-peach" />
        <span aria-hidden="true">·</span>
        <span>Z-normalized f0, voiced frames only</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Pitch contour A/B"
        className="overflow-visible"
      >
        {/* Center axis. */}
        <line
          x1={padX}
          y1={padY + innerH / 2}
          x2={W - padX}
          y2={padY + innerH / 2}
          stroke="currentColor"
          strokeWidth={0.5}
          className="text-hairline-strong"
        />
        {refPath && (
          <path
            d={refPath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink"
          />
        )}
        {userPath && (
          <path
            d={userPath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gradient-peach"
          />
        )}
      </svg>
    </div>
  );
}

function LegendKey({
  label,
  colorClass,
}: {
  label: string;
  colorClass: string;
}) {
  return (
    <span className="inline-flex items-center gap-xxs">
      <span className={`inline-block h-[2px] w-[16px] bg-current ${colorClass}`} />
      <span>{label}</span>
    </span>
  );
}

// Build an SVG path for a pitch contour. f0_z is on a fixed [-3, +3] visual
// range (z-scores typically fall in [-2.5, +2.5] for natural speech). x maps
// linearly to the contour's index range; unvoiced frames split the path so
// silent stretches don't get interpolated.
function contourPath(
  contour: PitchContour,
  padX: number,
  padY: number,
  innerW: number,
  innerH: number,
): string {
  const n = contour.f0_z.length;
  if (n < 2) return "";
  const VISUAL_Z_RANGE = 3.0;
  let path = "";
  let pen = "M";
  for (let i = 0; i < n; i++) {
    if (!contour.voiced[i]) {
      // Lift the pen on the next voiced frame.
      pen = "M";
      continue;
    }
    const x = padX + (i / (n - 1)) * innerW;
    const z = contour.f0_z[i];
    const norm = clamp((-z) / VISUAL_Z_RANGE, -1, 1); // negate so positive z plots upward
    const y = padY + (norm + 1) * 0.5 * innerH;
    path += `${pen} ${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = "L";
  }
  return path.trim();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(v: number): string {
  return `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
}
