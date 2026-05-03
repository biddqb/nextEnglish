import { useId, useState } from "react";
import {
  useIngestUrl,
  useIngestUrlTrimmed,
  useProbeUrl,
  useSettings,
} from "../lib/queries";
import { useStore } from "../lib/store";
import { TrimDialog } from "./TrimDialog";

// Inline URL paste form. Lives inside EmptyStateHero (when no clips exist or
// "+ Add clip" was clicked). On success, selects the newly-created clip.
// File drag-and-drop is handled globally in App.tsx via Tauri's webview
// onDragDropEvent — drop a file anywhere over the window.
//
// CLIP_TOO_LONG handling: probe the URL, open the TrimDialog with the total
// duration, let the user pick a window up to the user's configured cap,
// then ingest the trimmed range. The trim flow keeps the user in the
// moment instead of bouncing them out to an external editor.

export function ClipPicker() {
  const id = useId();
  const [url, setUrl] = useState("");
  const settings = useSettings();
  const ingest = useIngestUrl();
  const ingestTrimmed = useIngestUrlTrimmed();
  const probe = useProbeUrl();
  const selectClip = useStore((s) => s.selectClip);

  const [trimState, setTrimState] = useState<{
    url: string;
    durationS: number;
  } | null>(null);
  const [trimError, setTrimError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    const target = url.trim();
    try {
      await ingest.mutateAsync({
        url: target,
        maxDurationS: settings.maxDurationS,
        modelName: settings.whisperModel,
      });
      setUrl("");
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "CLIP_TOO_LONG") {
        // Probe to get duration, then open the trim dialog.
        try {
          const info = await probe.mutateAsync(target);
          setTrimState({ url: target, durationS: info.duration_s });
          setTrimError(null);
        } catch {
          // Probe failed — fall through to the regular error rendering.
        }
      }
    }
  }

  async function handleTrimSubmit(startS: number, endS: number) {
    if (!trimState) return;
    setTrimError(null);
    try {
      await ingestTrimmed.mutateAsync({
        url: trimState.url,
        trimStartS: startS,
        trimEndS: endS,
        maxDurationS: settings.maxDurationS,
        modelName: settings.whisperModel,
      });
      setTrimState(null);
      setUrl("");
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setTrimError(e.message ?? "Couldn't ingest trimmed clip.");
    }
  }

  const errorMsg = errorFrom(ingest.error);
  // Hide the inline error while the trim dialog is open — it'd be redundant.
  const showInlineError = errorMsg && !trimState;

  return (
    <>
      <form onSubmit={onSubmit} className="w-full max-w-lg">
        <label
          htmlFor={id}
          className="text-caption-uppercase text-muted block mb-xs"
        >
          Paste a URL
        </label>
        <div className="flex gap-sm">
          <input
            id={id}
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={ingest.isPending || probe.isPending}
            className="text-input flex-1"
            aria-invalid={!!showInlineError}
            aria-describedby={showInlineError ? `${id}-err` : undefined}
          />
          <button
            type="submit"
            disabled={!url.trim() || ingest.isPending || probe.isPending}
            className="button-primary"
          >
            {ingest.isPending
              ? "Ingesting…"
              : probe.isPending
                ? "Probing…"
                : "Add clip"}
          </button>
        </div>
        {showInlineError && (
          <div id={`${id}-err`} className="text-body-sm text-semantic-error mt-xs">
            {errorMsg}
          </div>
        )}
        {ingest.isPending && (
          <div className="text-caption text-muted mt-xs">
            Downloading and transcribing… first run can take a few minutes.
          </div>
        )}
        {!ingest.isPending && !probe.isPending && (
          <div className="text-caption text-muted mt-sm">
            Or drop an audio / video file anywhere on the window.
          </div>
        )}
        <p
          onClick={() => selectClip(null)}
          className="hidden"
        />
      </form>

      <TrimDialog
        open={trimState != null}
        url={trimState?.url ?? ""}
        totalDurationS={trimState?.durationS ?? 0}
        maxWindowS={settings.maxDurationS}
        ingesting={ingestTrimmed.isPending}
        errorMessage={trimError}
        onCancel={() => {
          if (ingestTrimmed.isPending) return;
          setTrimState(null);
          setTrimError(null);
        }}
        onSubmit={handleTrimSubmit}
      />
    </>
  );
}

function errorFrom(err: unknown): string | null {
  if (!err) return null;
  const e = err as { code?: string; message?: string };
  if (!e.code && !e.message) return null;
  if (e.code === "CLIP_TOO_LONG") return null; // Suppressed; trim dialog opens.
  if (e.code === "DOWNLOAD_FAILED")
    return e.message ?? "Couldn't download — try a different URL.";
  if (e.code === "INVALID_URL") return e.message ?? "Not a valid URL.";
  return e.message ?? "Something went wrong.";
}
