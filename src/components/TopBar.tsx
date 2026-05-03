import { useClips, useClip } from "../lib/queries";
import { useStore } from "../lib/store";

type Props = {
  onShowShortcuts?: () => void;
  onOpenSettings?: () => void;
};

export function TopBar({ onShowShortcuts, onOpenSettings }: Props) {
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectedSegmentIndex = useStore((s) => s.selectedSegmentIndex);
  const { data: clips } = useClips();
  const { data: clipPayload } = useClip(selectedClipId);

  const selectedClip = clips?.find((c) => c.id === selectedClipId);
  const segmentCount = clipPayload?.segments.length ?? 0;
  const breadcrumb = breadcrumbFor(
    selectedClip?.title,
    segmentCount,
    selectedSegmentIndex,
  );

  return (
    <header className="flex h-[64px] items-center justify-between border-b border-hairline bg-canvas px-lg">
      <div className="text-title-md text-ink">nextEnglish</div>
      <div className="text-body-md text-muted truncate max-w-[60%]">
        {breadcrumb}
      </div>
      <div className="flex items-center gap-xs">
        {onShowShortcuts && (
          <button
            onClick={onShowShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-caption-uppercase text-muted hover:bg-surface-strong hover:text-ink"
          >
            ?
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-strong hover:text-ink"
          >
            <span aria-hidden="true" className="text-body-md leading-none">
              ⚙
            </span>
          </button>
        )}
      </div>
    </header>
  );
}

function breadcrumbFor(
  clipTitle: string | undefined,
  segmentCount: number,
  selectedIndex: number | null,
): string {
  if (!clipTitle) return "";
  if (selectedIndex == null) return clipTitle;
  return `${clipTitle} · Segment ${selectedIndex + 1} of ${segmentCount}`;
}
