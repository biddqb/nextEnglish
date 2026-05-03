// Editorial drop-target overlay. Fades in when the user drags any file over
// the window, fades out when they leave or drop. Also shows an "Ingesting…"
// state while the sidecar is processing the file, and a brief error banner
// if the ingest fails (auto-clears in App after 6s).
type Props = {
  open: boolean;
  ingesting?: boolean;
  errorMessage?: string | null;
};

export function DropOverlay({ open, ingesting, errorMessage }: Props) {
  // Show the overlay when the user is actively dragging OR when an ingest
  // is in flight (so the user gets feedback after the drop). Errors render
  // independently in the bottom-right toast slot.
  const showOverlay = open || ingesting;

  return (
    <>
      {showOverlay && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas-deep/20 backdrop-blur-[2px]"
        >
          <div className="rounded-xl border border-hairline-strong bg-surface-card px-xxl py-xl text-center shadow-soft">
            <div className="text-display-sm text-ink">
              {ingesting ? "Ingesting clip…" : "Drop to ingest"}
            </div>
            <div className="mt-xs text-caption-uppercase text-muted">
              {ingesting
                ? "Transcribing — first run can take a few minutes"
                : "Audio or video files up to 15 minutes"}
            </div>
          </div>
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="fixed bottom-lg right-lg z-50 max-w-sm rounded-md border border-hairline-strong bg-surface-card px-base py-sm text-body-sm text-semantic-error shadow-soft"
        >
          {errorMessage}
        </div>
      )}
    </>
  );
}
