import { useState } from "react";
import clsx from "clsx";
import type { ClipRow as ClipRowT } from "../lib/types";

type Props = {
  clip: ClipRowT;
  segmentCount?: number;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
  onDelete: () => Promise<void> | void;
};

export function ClipRow({
  clip,
  segmentCount,
  selected,
  collapsed,
  onClick,
  onDelete,
}: Props) {
  const isCapture = clip.source_uri.startsWith("capture://");
  const initials = isCapture ? "✎" : initialsFor(clip.title);
  const subline = isCapture
    ? `Capture · ${relativeTime(clip.created_at)}`
    : subLine(clip.created_at, segmentCount);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function commitDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
      // No need to reset state — the row will unmount when the list refetches.
    } catch {
      // Roll back the inline state so the user can retry; no toast — the
      // useDeleteClip mutation surface is enough for v1.
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div
      className={clsx(
        "group flex items-center gap-xxs rounded-md px-sm py-xs transition-colors",
        selected ? "bg-surface-strong" : "hover:bg-surface-strong/50",
      )}
    >
      <button
        onClick={onClick}
        title={collapsed ? clip.title : undefined}
        className="flex min-w-0 flex-1 items-center gap-sm text-left"
      >
        <div
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            // Captures get a hairline outline (no fill) so they read as
            // a different "kind" at a glance vs YouTube/file ingests.
            isCapture
              ? "border border-hairline-strong text-ink text-body-md"
              : "bg-surface-strong text-caption-uppercase text-ink",
            // When the row already has a strong bg (selected), give the
            // avatar a hairline border so it doesn't visually disappear.
            selected && !isCapture && "ring-1 ring-hairline-strong",
          )}
        >
          {initials}
        </div>
        {!collapsed && !confirming && (
          <div className="min-w-0 flex-1">
            <div className="text-body-strong truncate text-ink">
              {clip.title}
            </div>
            <div className="text-caption truncate text-muted">{subline}</div>
          </div>
        )}
        {!collapsed && confirming && (
          <div className="min-w-0 flex-1 truncate text-body-sm text-ink">
            Delete this clip?
          </div>
        )}
      </button>

      {!collapsed && !confirming && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          aria-label={`Delete ${clip.title}`}
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted",
            "opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "hover:bg-surface-strong hover:text-ink focus-visible:opacity-100",
          )}
        >
          {/* Inline × glyph keeps the editorial "no icons" aesthetic. */}
          <span aria-hidden="true" className="text-body-md leading-none">
            ×
          </span>
        </button>
      )}

      {!collapsed && confirming && (
        <span className="flex shrink-0 items-center gap-xxs">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
            disabled={deleting}
            className="text-caption-uppercase text-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed px-xs"
          >
            Cancel
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void commitDelete();
            }}
            disabled={deleting}
            className={clsx(
              "h-7 rounded-full bg-ink px-sm text-caption-uppercase text-on-primary",
              "hover:bg-ink-press disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </span>
      )}
    </div>
  );
}

function initialsFor(title: string): string {
  const parts = title.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function subLine(createdAt: string, segmentCount: number | undefined): string {
  const ago = relativeTime(createdAt);
  if (segmentCount != null) return `${segmentCount} segments · ${ago}`;
  return ago;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const seconds = Math.max(0, (Date.now() - t) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
