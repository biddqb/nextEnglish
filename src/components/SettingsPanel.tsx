import { useEffect, useState } from "react";
import {
  useCacheStats,
  useClearAllClips,
  useExportToObsidian,
  useSetSetting,
  useSettings,
} from "../lib/queries";
import {
  SETTING_KEYS,
  WHISPER_MODELS,
  defaultAppSettings,
  isValidHotkey,
} from "../lib/settings";

// Editorial settings modal — opens via Cmd/Ctrl+, or the gear in TopBar.
// Four sections: transcription model, default ingest cap, auto re-record
// pause, and a cache eviction control. Saves are write-through (no Apply
// button); the next ingest / next attempt picks them up automatically.
type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsPanel({ open, onClose }: Props) {
  const settings = useSettings();
  const setSetting = useSetSetting();
  const cacheStats = useCacheStats();
  const clearAll = useClearAllClips();
  const exportToObsidian = useExportToObsidian();
  const [confirmClear, setConfirmClear] = useState(false);
  const [vaultPathDraft, setVaultPathDraft] = useState(settings.obsidianVaultPath);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [captureHotkeyDraft, setCaptureHotkeyDraft] = useState(
    settings.captureHotkey,
  );
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  // Local mirrors so the user can edit numeric inputs without each keystroke
  // hitting SQLite. Synced from settings on open and on background updates.
  const [maxDurationMin, setMaxDurationMin] = useState(
    Math.round(settings.maxDurationS / 60),
  );
  const [autoLoopS, setAutoLoopS] = useState(settings.autoLoopMs / 1000);

  useEffect(() => {
    if (open) {
      setMaxDurationMin(Math.round(settings.maxDurationS / 60));
      setAutoLoopS(settings.autoLoopMs / 1000);
      setVaultPathDraft(settings.obsidianVaultPath);
      setCaptureHotkeyDraft(settings.captureHotkey);
      setConfirmClear(false);
      setExportFeedback(null);
      setHotkeyError(null);
    }
  }, [
    open,
    settings.maxDurationS,
    settings.autoLoopMs,
    settings.obsidianVaultPath,
    settings.captureHotkey,
  ]);

  // Lock background scroll while the modal is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  function commitMaxDuration() {
    const next = Math.max(1, Math.min(60, Math.round(maxDurationMin)));
    setMaxDurationMin(next);
    setSetting.mutate({
      key: SETTING_KEYS.maxDurationS,
      value: String(next * 60),
    });
  }

  function commitAutoLoop() {
    const next = Math.max(0, Math.min(10, autoLoopS));
    setAutoLoopS(next);
    setSetting.mutate({
      key: SETTING_KEYS.autoLoopMs,
      value: String(Math.round(next * 1000)),
    });
  }

  function chooseModel(modelId: string) {
    setSetting.mutate({ key: SETTING_KEYS.whisperModel, value: modelId });
  }

  function commitVaultPath() {
    const next = vaultPathDraft.trim();
    setSetting.mutate({
      key: SETTING_KEYS.obsidianVaultPath,
      value: next === "" ? null : next,
    });
  }

  function commitHotkey() {
    const next = captureHotkeyDraft.trim();
    if (!isValidHotkey(next)) {
      setHotkeyError(
        "Format: modifier(s)+key, e.g. CommandOrControl+Alt+C",
      );
      return;
    }
    setHotkeyError(null);
    setSetting.mutate({ key: SETTING_KEYS.captureHotkey, value: next });
  }

  function resetHotkey() {
    setCaptureHotkeyDraft(defaultAppSettings.captureHotkey);
    setHotkeyError(null);
    setSetting.mutate({
      key: SETTING_KEYS.captureHotkey,
      value: defaultAppSettings.captureHotkey,
    });
  }

  async function runExport() {
    setExportFeedback(null);
    const path = vaultPathDraft.trim();
    if (!path) {
      setExportFeedback("Set a vault path first.");
      return;
    }
    try {
      const result = await exportToObsidian.mutateAsync(path);
      setExportFeedback(
        `Exported ${result.cards_exported} card${result.cards_exported === 1 ? "" : "s"} (${result.audio_files_copied} audio file${result.audio_files_copied === 1 ? "" : "s"} copied) to ${result.vault_path}/nextEnglish/`,
      );
    } catch (e) {
      const err = e as { message?: string };
      setExportFeedback(err.message ?? "Export failed.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-base"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-canvas-deep/30" onMouseDown={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-hairline-strong bg-surface-card p-xl shadow-soft">
        <div className="mb-xl flex items-center justify-between">
          <h2 id="settings-title" className="text-display-sm text-ink">
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-strong hover:text-ink"
          >
            <span aria-hidden="true" className="text-body-md leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="space-y-xxl">
          <Section
            title="Transcription model"
            hint="Larger models transcribe more accurately but are slower and use more disk."
          >
            <div className="space-y-xs">
              {WHISPER_MODELS.map((m) => (
                <label
                  key={m.id}
                  className="flex items-baseline gap-sm cursor-pointer rounded-md p-xs hover:bg-surface-strong/50"
                >
                  <input
                    type="radio"
                    name="whisper-model"
                    checked={settings.whisperModel === m.id}
                    onChange={() => chooseModel(m.id)}
                    className="accent-ink"
                  />
                  <span className="text-body-md text-ink">{m.label}</span>
                </label>
              ))}
            </div>
          </Section>

          <Section
            title="Default ingest cap"
            hint="Maximum duration accepted at first ingest. Longer clips are sent through the trim dialog."
          >
            <div className="flex items-center gap-sm">
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                value={maxDurationMin}
                onChange={(e) => setMaxDurationMin(parseInt(e.target.value, 10) || 0)}
                onBlur={commitMaxDuration}
                className="text-input w-[100px] tabular-nums"
              />
              <span className="text-caption-uppercase text-muted">
                minutes
              </span>
            </div>
          </Section>

          <Section
            title="Auto re-record pause"
            hint="Seconds between a finished score and the next automatic recording. 0 disables the auto-loop."
          >
            <div className="flex items-center gap-sm">
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={autoLoopS}
                onChange={(e) => setAutoLoopS(parseFloat(e.target.value) || 0)}
                onBlur={commitAutoLoop}
                className="text-input w-[100px] tabular-nums"
              />
              <span className="text-caption-uppercase text-muted">
                seconds
              </span>
            </div>
          </Section>

          <Section
            title="Capture hotkey"
            hint="System-wide shortcut that grabs your selected text (or clipboard) and adds it as an SRS card. Format is modifier(s) + a single key, separated by +. Examples: CommandOrControl+Alt+C, Ctrl+Shift+F1, Alt+Space."
          >
            <div className="flex items-center gap-sm">
              <input
                type="text"
                value={captureHotkeyDraft}
                onChange={(e) => setCaptureHotkeyDraft(e.target.value)}
                onBlur={commitHotkey}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="CommandOrControl+Alt+C"
                className="text-input flex-1 font-mono"
              />
              <button onClick={resetHotkey} className="button-tertiary">
                Reset
              </button>
            </div>
            {hotkeyError && (
              <div className="mt-sm text-body-sm text-semantic-error">
                {hotkeyError}
              </div>
            )}
            <div className="mt-sm text-caption text-muted">
              Tip: if a combo doesn't fire, another app may already own it.
              Try Alt+Space, Ctrl+Shift+F1, or Ctrl+Shift+;.
            </div>
          </Section>

          <Section
            title="Obsidian vault"
            hint="Saved cards (★) and captures get mirrored as plain markdown into <vault>/nextEnglish/. Leave blank to disable export."
          >
            <div className="flex items-center gap-sm">
              <input
                type="text"
                value={vaultPathDraft}
                onChange={(e) => setVaultPathDraft(e.target.value)}
                onBlur={commitVaultPath}
                placeholder="e.g. C:/Users/you/Obsidian/MyVault"
                className="text-input flex-1"
              />
              <button
                onClick={runExport}
                disabled={exportToObsidian.isPending || !vaultPathDraft.trim()}
                className="button-primary"
              >
                {exportToObsidian.isPending ? "Exporting…" : "Export now"}
              </button>
            </div>
            {exportFeedback && (
              <div className="mt-sm text-body-sm text-body">
                {exportFeedback}
              </div>
            )}
          </Section>

          <Section
            title="Cache"
            hint="Audio, segment slices, and attempts live under sidecar/_work/clips."
          >
            <div className="flex items-baseline gap-sm">
              <span className="text-body-md text-ink tabular-nums">
                {cacheStats.data
                  ? `${formatBytes(cacheStats.data.bytes)} · ${cacheStats.data.clip_count} clip${cacheStats.data.clip_count === 1 ? "" : "s"}`
                  : "Computing…"}
              </span>
            </div>
            <div className="mt-base">
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  disabled={!cacheStats.data || cacheStats.data.clip_count === 0}
                  className="button-outline"
                >
                  Delete all clips
                </button>
              ) : (
                <div className="flex items-center gap-sm">
                  <span className="text-body-sm text-ink">
                    Delete every clip and attempt? This can't be undone.
                  </span>
                  <button
                    onClick={() => setConfirmClear(false)}
                    disabled={clearAll.isPending}
                    className="button-tertiary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      await clearAll.mutateAsync();
                      setConfirmClear(false);
                    }}
                    disabled={clearAll.isPending}
                    className="button-primary"
                  >
                    {clearAll.isPending ? "Deleting…" : "Delete all"}
                  </button>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-caption-uppercase text-muted">{title}</h3>
      {hint && <p className="text-body-sm text-body mt-xxs mb-sm">{hint}</p>}
      <div className="mt-base">{children}</div>
    </section>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = b / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}
