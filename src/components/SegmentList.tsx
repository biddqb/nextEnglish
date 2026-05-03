import clsx from "clsx";
import {
  useClip,
  useSaveCard,
  useSavedSegments,
  useSegmentBestScores,
  useUnsaveCard,
} from "../lib/queries";
import { useStore } from "../lib/store";

// Segment list — second view in the main pane. Shows all auto-segmented
// sentences from the selected clip with timestamps, your best historical
// score per segment (when attempted), and a save toggle for SRS review.
// Click anywhere except the save toggle selects the segment and transitions
// to ShadowSession.
export function SegmentList({ clipId }: { clipId: number }) {
  const { data, isLoading, isError } = useClip(clipId);
  const { data: bestScores } = useSegmentBestScores(clipId);
  const { data: saved } = useSavedSegments(clipId);
  const saveCard = useSaveCard();
  const unsaveCard = useUnsaveCard();
  const selectedSegmentIndex = useStore((s) => s.selectedSegmentIndex);
  const selectSegment = useStore((s) => s.selectSegment);

  const bestByIndex = new Map<number, { best: number; count: number }>();
  for (const b of bestScores ?? []) {
    bestByIndex.set(b.segment_index, {
      best: b.best_overall,
      count: b.attempt_count,
    });
  }
  const savedSet = new Set(saved ?? []);

  if (isLoading) {
    return <SegmentListSkeleton />;
  }
  if (isError || !data) {
    return (
      <div className="px-xl py-xxl text-body-md text-semantic-error">
        Couldn't load clip.
      </div>
    );
  }

  function toggleSave(segmentIndex: number) {
    if (savedSet.has(segmentIndex)) {
      unsaveCard.mutate({ clipId, segmentIndex });
    } else {
      saveCard.mutate({ clipId, segmentIndex });
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-xl py-app-section">
      <h2 className="text-display-md text-ink mb-base">{data.clip.title}</h2>
      <p className="text-body-md text-muted mb-xxl">
        {data.segments.length} segments · {formatDuration(data.clip.duration_ms)}
        . Pick one to shadow.
      </p>
      <ul className="divide-y divide-hairline">
        {data.segments.map((seg, i) => {
          const best = bestByIndex.get(i);
          const isSaved = savedSet.has(i);
          return (
            <li
              key={seg.id}
              className={clsx(
                "group flex w-full items-baseline gap-base px-base py-sm transition-colors",
                "hover:bg-surface-strong/50",
                selectedSegmentIndex === i &&
                  "bg-surface-strong border-l-2 border-ink pl-[14px]",
              )}
            >
              <button
                onClick={() => selectSegment(i)}
                className="flex flex-1 items-baseline gap-base text-left min-w-0"
              >
                <span className="text-caption-uppercase text-muted shrink-0 tabular-nums w-[120px]">
                  {formatRange(seg.start_ms, seg.end_ms)}
                </span>
                <span className="text-body-md text-ink truncate flex-1">
                  {seg.text}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSave(i);
                }}
                aria-pressed={isSaved}
                aria-label={
                  isSaved ? "Remove from review queue" : "Save for review"
                }
                title={
                  isSaved ? "Saved · click to remove" : "Save for review"
                }
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition",
                  isSaved
                    ? "text-ink"
                    : "text-muted-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink",
                )}
              >
                <span aria-hidden="true" className="text-body-md leading-none">
                  {isSaved ? "★" : "☆"}
                </span>
              </button>
              <span
                aria-label={
                  best
                    ? `Best score ${best.best} across ${best.count} attempts`
                    : "Not attempted yet"
                }
                className={clsx(
                  "shrink-0 w-[64px] text-right tabular-nums",
                  best
                    ? "text-caption-uppercase text-ink"
                    : "text-caption-uppercase text-muted-soft",
                )}
              >
                {best ? best.best : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SegmentListSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-xl py-app-section" aria-hidden>
      <div className="h-9 w-1/2 animate-pulse rounded bg-surface-strong mb-base" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-surface-strong mb-xxl" />
      <ul className="divide-y divide-hairline">
        {[...Array(8)].map((_, i) => (
          <li key={i} className="flex items-center gap-base px-base py-sm">
            <div className="h-3 w-[110px] animate-pulse rounded bg-surface-strong shrink-0" />
            <div className="h-3 flex-1 animate-pulse rounded bg-surface-strong" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function formatRange(startMs: number, endMs: number): string {
  return `${formatTimestamp(startMs)} → ${formatTimestamp(endMs)}`;
}

function formatTimestamp(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
