// Editorial capture-result toast. Shown briefly after Ctrl+Shift+C grabs
// the clipboard and pushes it through the capture pipeline. Auto-dismisses.
type Props = {
  state:
    | { kind: "capturing"; preview: string }
    | { kind: "captured"; preview: string }
    | { kind: "error"; message: string }
    | null;
};

export function CaptureToast({ state }: Props) {
  if (!state) return null;

  const headline =
    state.kind === "capturing"
      ? "Capturing…"
      : state.kind === "captured"
        ? "Captured for review"
        : "Capture failed";

  const body =
    state.kind === "error"
      ? state.message
      : truncate((state as { preview: string }).preview, 80);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-lg right-lg z-50 max-w-md rounded-md border border-hairline-strong bg-surface-card px-base py-sm shadow-soft"
    >
      <div className="text-caption-uppercase text-muted mb-xxs">{headline}</div>
      <div
        className={
          "text-body-sm " +
          (state.kind === "error" ? "text-semantic-error" : "text-ink")
        }
      >
        {body}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
