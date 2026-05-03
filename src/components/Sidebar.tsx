import clsx from "clsx";
import { useClips, useDeleteClip, useDueCardsCount } from "../lib/queries";
import { useStore } from "../lib/store";
import { ClipRow } from "./ClipRow";

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const pane = useStore((s) => s.pane);
  const setPane = useStore((s) => s.setPane);

  const { data: clips, isLoading, isError } = useClips();
  const deleteClip = useDeleteClip();
  const { data: dueCount = 0 } = useDueCardsCount();

  async function handleDelete(clipId: number) {
    await deleteClip.mutateAsync(clipId);
    if (selectedClipId === clipId) {
      // Right pane was showing this clip; drop the selection so it falls
      // back to the empty-state hero.
      selectClip(null);
    }
  }

  return (
    <nav
      aria-label="Clip library"
      className={clsx(
        "flex flex-col border-r border-hairline-strong bg-canvas-soft transition-[width] duration-200",
        collapsed ? "w-[56px]" : "w-[280px]",
      )}
    >
      <div className="border-b border-hairline p-sm space-y-xs">
        {dueCount > 0 && (
          <button
            onClick={() => setPane("review")}
            aria-label={`Open review queue, ${dueCount} due`}
            title={`${dueCount} card${dueCount === 1 ? "" : "s"} due for review`}
            className={clsx(
              "flex w-full items-center justify-between rounded-full border px-md h-[40px] text-button transition-colors",
              pane === "review"
                ? "border-ink bg-ink text-on-primary"
                : "border-hairline-strong text-ink hover:border-ink",
              collapsed && "px-0 justify-center",
            )}
          >
            {collapsed ? (
              <span className="tabular-nums">{dueCount}</span>
            ) : (
              <>
                <span>Reviews due</span>
                <span className="tabular-nums">{dueCount}</span>
              </>
            )}
          </button>
        )}
        <button
          onClick={() => selectClip(null)}
          className={clsx(
            "button-outline w-full",
            collapsed && "px-0",
          )}
          aria-label="Add a new clip"
        >
          {collapsed ? "+" : "+ Add clip"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-xs">
        {isLoading && <SidebarSkeleton collapsed={collapsed} />}
        {isError && !collapsed && (
          <div className="px-sm py-base text-body-sm text-semantic-error">
            Couldn't load clips.
          </div>
        )}
        {clips && clips.length === 0 && !collapsed && (
          <div className="px-sm py-base text-body-sm text-muted">
            No clips yet. Paste a URL to get started.
          </div>
        )}
        {clips?.map((c) => (
          <ClipRow
            key={c.id}
            clip={c}
            selected={c.id === selectedClipId}
            collapsed={collapsed}
            onClick={() => selectClip(c.id)}
            onDelete={() => handleDelete(c.id)}
          />
        ))}
      </div>

      <div className="border-t border-hairline p-xs">
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={clsx(
            "w-full rounded-md px-sm py-xs text-caption-uppercase text-muted hover:text-ink",
            "hover:bg-surface-strong/50",
          )}
        >
          {collapsed ? "›" : "‹ Collapse"}
        </button>
      </div>
    </nav>
  );
}

function SidebarSkeleton({ collapsed }: { collapsed: boolean }) {
  const widths = ["w-3/4", "w-1/2", "w-2/3"];
  return (
    <div className="space-y-xs p-xs" aria-hidden>
      {widths.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-sm rounded-md p-xs"
        >
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-strong" />
          {!collapsed && (
            <div className="flex-1 space-y-1">
              <div className={clsx("h-3 animate-pulse rounded bg-surface-strong", w)} />
              <div className="h-2 w-1/3 animate-pulse rounded bg-surface-strong" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
