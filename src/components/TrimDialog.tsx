import { useEffect, useState } from "react";

// Editorial trim picker. Opens after a CLIP_TOO_LONG ingest error: the user
// gets the total clip duration + two start/end inputs constrained so the
// trim window stays within the 15-min cap. Submitting calls
// useIngestUrlTrimmed; cancelling closes without ingesting.
type Props = {
  open: boolean;
  url: string;
  totalDurationS: number;
  maxWindowS: number;
  ingesting: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (startS: number, endS: number) => void;
};

export function TrimDialog({
  open,
  url,
  totalDurationS,
  maxWindowS,
  ingesting,
  errorMessage,
  onCancel,
  onSubmit,
}: Props) {
  const [startS, setStartS] = useState(0);
  const [endS, setEndS] = useState(Math.min(maxWindowS, totalDurationS));

  // Reset bounds whenever a new clip is being trimmed.
  useEffect(() => {
    if (open) {
      setStartS(0);
      setEndS(Math.min(maxWindowS, totalDurationS));
    }
  }, [open, totalDurationS, maxWindowS]);

  if (!open) return null;

  const windowS = Math.max(0, endS - startS);
  const tooLong = windowS > maxWindowS;
  const inverted = endS <= startS;
  const canSubmit = !tooLong && !inverted && !ingesting && totalDurationS > 0;

  function clampStart(v: number) {
    const next = Math.max(0, Math.min(v, totalDurationS - 1));
    setStartS(next);
    if (endS - next > maxWindowS) setEndS(next + maxWindowS);
    if (endS <= next) setEndS(Math.min(next + maxWindowS, totalDurationS));
  }

  function clampEnd(v: number) {
    const next = Math.max(1, Math.min(v, totalDurationS));
    setEndS(next);
    if (next - startS > maxWindowS) setStartS(next - maxWindowS);
    if (next <= startS) setStartS(Math.max(0, next - maxWindowS));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trim-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-base"
    >
      <div
        className="absolute inset-0 bg-canvas-deep/30"
        onMouseDown={onCancel}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-hairline-strong bg-surface-card p-xl shadow-soft">
        <h2 id="trim-title" className="text-display-sm text-ink mb-xs">
          Trim to fit
        </h2>
        <p className="text-body-md text-body mb-xl">
          The clip is {formatDuration(totalDurationS)}. Pick a window up to{" "}
          {formatDuration(maxWindowS)} to ingest.
        </p>

        <div className="text-caption text-muted mb-xs truncate" title={url}>
          {url}
        </div>

        <div className="space-y-base">
          <RangeRow
            label="Start"
            valueS={startS}
            maxS={Math.max(0, totalDurationS - 1)}
            onChange={clampStart}
            disabled={ingesting}
          />
          <RangeRow
            label="End"
            valueS={endS}
            maxS={totalDurationS}
            onChange={clampEnd}
            disabled={ingesting}
          />
        </div>

        <div className="mt-base flex items-baseline gap-base text-caption-uppercase text-muted">
          <span className="tabular-nums text-ink">
            Window {formatDuration(windowS)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            of {formatDuration(maxWindowS)} max
          </span>
        </div>

        {(tooLong || inverted) && (
          <div className="mt-sm text-body-sm text-semantic-error">
            {inverted
              ? "End must be after start."
              : `Window exceeds the ${formatDuration(maxWindowS)} cap.`}
          </div>
        )}

        {errorMessage && (
          <div className="mt-sm text-body-sm text-semantic-error">
            {errorMessage}
          </div>
        )}

        <div className="mt-xl flex justify-end gap-sm">
          <button
            onClick={onCancel}
            disabled={ingesting}
            className="button-tertiary"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(startS, endS)}
            disabled={!canSubmit}
            className="button-primary"
          >
            {ingesting ? "Ingesting…" : "Trim and ingest"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RangeRow({
  label,
  valueS,
  maxS,
  onChange,
  disabled,
}: {
  label: string;
  valueS: number;
  maxS: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-base">
      <span className="w-[60px] shrink-0 text-caption-uppercase text-muted">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(maxS))}
        step={1}
        value={Math.round(valueS)}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        className="flex-1 accent-ink"
      />
      <input
        type="text"
        inputMode="numeric"
        value={formatDuration(valueS)}
        onChange={(e) => {
          const parsed = parseDuration(e.target.value);
          if (parsed != null) onChange(parsed);
        }}
        disabled={disabled}
        className="w-[80px] text-body-md text-ink tabular-nums bg-transparent border-b border-hairline-strong focus:border-ink outline-none px-xxs py-xxs text-right"
        aria-label={`${label} time`}
      />
    </div>
  );
}

function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function parseDuration(input: string): number | null {
  const m = input.match(/^\s*(\d+)\s*:\s*(\d{1,2})\s*$/);
  if (m) {
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    if (sec >= 60) return null;
    return min * 60 + sec;
  }
  const plain = parseInt(input.trim(), 10);
  return Number.isFinite(plain) ? plain : null;
}
