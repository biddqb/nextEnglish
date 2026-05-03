import clsx from "clsx";

type Props = {
  state: "idle" | "listening" | "recording";
  onClick: () => void;
  disabled?: boolean;
};

// Per UI_DESIGN.md `record-button`. 64px idle → 80px listening with peach orb
// pulse → recording (level meter handles activity below). Glyph stays the same
// (white mic on ink fill); the surrounding pulse + size carries the state.
export function RecordButton({ state, onClick, disabled }: Props) {
  const captionByState = {
    idle: "Press to record · Space",
    listening: "Listening…",
    recording: "Recording…",
  };

  return (
    <div className="flex flex-col items-center gap-sm">
      <div className="relative">
        {state === "listening" && (
          <div
            className="gradient-orb-peach pointer-events-none absolute left-1/2 top-1/2 h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 opacity-50"
            aria-hidden
          />
        )}
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={
            state === "recording" ? "Stop recording" : "Start recording"
          }
          className={clsx(
            "relative flex items-center justify-center rounded-full bg-ink-press text-on-primary",
            "hover:bg-ink active:bg-ink",
            "transition-[width,height] duration-200 disabled:opacity-40",
            state === "idle" && "h-[64px] w-[64px]",
            state === "listening" && "h-[80px] w-[80px] listen-pulse",
            state === "recording" && "h-[80px] w-[80px]",
          )}
        >
          <MicGlyph />
        </button>
      </div>
      <div className="text-caption text-muted">{captionByState[state]}</div>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg
      width="20"
      height="28"
      viewBox="0 0 20 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="6" y="2" width="8" height="14" rx="4" fill="currentColor" />
      <path
        d="M2 12c0 4.418 3.582 8 8 8s8-3.582 8-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1="10"
        y1="20"
        x2="10"
        y2="26"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
