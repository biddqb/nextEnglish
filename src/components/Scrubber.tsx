// Audio scrubber per UI_DESIGN.md `scrubber`. 4px hairline track, 12px ink
// thumb. We render the play/pause button as a sibling in ShadowSession.
//
// Built on a styled <input type="range"> for keyboard-accessibility free.
// Tailwind doesn't have first-class range support, so the styling is in
// inline classes via a CSS-in-style block.

type Props = {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
};

export function Scrubber({ currentMs, durationMs, onSeek }: Props) {
  const max = Math.max(1, durationMs);
  return (
    <div className="flex w-full items-center gap-sm">
      <span className="text-caption text-muted shrink-0 tabular-nums">
        {formatTimestamp(currentMs)}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(max, currentMs)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
        className="scrubber-input flex-1"
      />
      <span className="text-caption text-muted shrink-0 tabular-nums">
        {formatTimestamp(durationMs)}
      </span>
      <style>{`
        .scrubber-input {
          appearance: none;
          background: transparent;
          height: 16px;
        }
        .scrubber-input::-webkit-slider-runnable-track {
          height: 4px;
          background: linear-gradient(
            to right,
            #0c0a09 0%,
            #0c0a09 ${(currentMs / max) * 100}%,
            #e7e5e4 ${(currentMs / max) * 100}%,
            #e7e5e4 100%
          );
          border-radius: 2px;
        }
        .scrubber-input::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          margin-top: -4px;
          background: #0c0a09;
          border-radius: 9999px;
          cursor: pointer;
        }
        .scrubber-input::-moz-range-track {
          height: 4px;
          background: #e7e5e4;
          border-radius: 2px;
        }
        .scrubber-input::-moz-range-progress {
          height: 4px;
          background: #0c0a09;
          border-radius: 2px;
        }
        .scrubber-input::-moz-range-thumb {
          width: 12px;
          height: 12px;
          background: #0c0a09;
          border: none;
          border-radius: 9999px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
