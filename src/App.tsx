import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyStateHero } from "./components/EmptyStateHero";
import { SegmentList } from "./components/SegmentList";
import { getModule } from "./lib/modules";

// Active-pane components, resolved through the module registry. The shell
// no longer hard-codes specific component imports — adding a fourth skill
// module is now a registry edit, not a shell edit.
const ShadowSession = getModule("shadow")!.ui.Session;
const ReviewModeView = getModule("srs")!.ui.Session;
const VoiceSessionView = getModule("voice")!.ui.Session;
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { SettingsPanel } from "./components/SettingsPanel";
import { DropOverlay } from "./components/DropOverlay";
import { CaptureToast } from "./components/CaptureToast";
import { useStore } from "./lib/store";
import {
  useCaptureChunk,
  useClips,
  useIngestFile,
  useSettings,
} from "./lib/queries";
import { api, isInTauri } from "./lib/api";
import { useKeyboardShortcuts } from "./lib/keyboard";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isRegistered,
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

export default function App() {
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectedSegmentIndex = useStore((s) => s.selectedSegmentIndex);
  const selectClip = useStore((s) => s.selectClip);
  const selectSegment = useStore((s) => s.selectSegment);
  // Note: session state moved out of the store per Issue 3A — modules own
  // their own session machines now. The shell reads/cancels via the module
  // registry instead.
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const pane = useStore((s) => s.pane);
  const setPane = useStore((s) => s.setPane);

  const { data: clips } = useClips();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const ingestFile = useIngestFile();
  const captureChunk = useCaptureChunk();
  const settings = useSettings();
  const [captureToast, setCaptureToast] = useState<
    | { kind: "capturing"; preview: string }
    | { kind: "captured"; preview: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  // Auto-select the most-recent clip on first load if nothing's selected.
  // Skipped while in review mode — entering review with no prior clip
  // selection would otherwise flip us back to browse on the next render.
  useEffect(() => {
    if (pane !== "browse") return;
    if (selectedClipId == null && clips && clips.length > 0) {
      selectClip(clips[0].id);
    }
  }, [clips, selectedClipId, selectClip, pane]);

  // Tauri-native drag-and-drop: the webview surfaces enter / over / leave /
  // drop with absolute file paths. We accept the first dropped file (audio
  // or video) and route through ingest_file. Multi-file drops in v1 take
  // only the first; queueing is a v2 concern.
  useEffect(() => {
    if (!isInTauri()) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const t = event.payload.type;
        if (t === "enter" || t === "over") {
          setDropHover(true);
        } else if (t === "leave") {
          setDropHover(false);
        } else if (t === "drop") {
          setDropHover(false);
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) return;
          setDropError(null);
          ingestFile.mutate(
            {
              filePath: paths[0],
              maxDurationS: settings.maxDurationS,
              modelName: settings.whisperModel,
            },
            {
              onError: (err) => {
                const e = err as { code?: string; message?: string };
                setDropError(e.message ?? "Couldn't ingest that file.");
              },
            },
          );
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          cleanup = unlisten;
        }
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [ingestFile, settings.maxDurationS, settings.whisperModel]);

  // Auto-clear the drop error banner after 6s.
  useEffect(() => {
    if (!dropError) return;
    const t = setTimeout(() => setDropError(null), 6000);
    return () => clearTimeout(t);
  }, [dropError]);

  // Capture-to-Obsidian global hotkey. Default Ctrl+Alt+C (overridable in
  // Settings). Flow on press:
  //   1. Read clipboard (snapshot A).
  //   2. Fire Ctrl+C in the focused app via enigo so any *selected* text
  //      lands in the clipboard — eliminates the "Ctrl+C, then hotkey"
  //      two-step.
  //   3. Read clipboard again (snapshot B). If different, the user had a
  //      live selection; use B. Otherwise fall back to A (whatever was
  //      already in the clipboard before).
  //   4. Capture that text.
  //
  // captureChunk's mutate function is held in a ref so it isn't a useEffect
  // dependency — react-query returns a new mutation object every render,
  // and depending on it caused the effect to re-fire constantly, which
  // racy-unregistered/re-registered the shortcut and surfaced false
  // "already registered" errors.
  const captureChunkRef = useRef(captureChunk.mutateAsync);
  captureChunkRef.current = captureChunk.mutateAsync;

  useEffect(() => {
    if (!isInTauri()) return;
    const shortcut = settings.captureHotkey;
    if (!shortcut) return;
    let cancelled = false;

    // Tauri's readText() throws when the clipboard is empty or holds non-
    // text content (image, file paths). For our flow that's a normal state
    // — we just need an empty string and to keep going. Wrapping in a
    // forgiving helper keeps the auto-Ctrl+C dance working.
    async function safeReadClipboard(): Promise<string> {
      try {
        const text = await readText();
        return (text ?? "").trim();
      } catch {
        return "";
      }
    }

    async function handler() {
      try {
        // The hotkey is system-wide and fires even when nextEnglish itself
        // is focused. Capture-from-our-own-UI is never what the user wants
        // (most-common bad case: focus is in the Settings hotkey input,
        // simulate-Ctrl+C copies the input's own value, we capture our own
        // setting as a card). Bail with a friendly hint instead.
        let appHasFocus = false;
        try {
          appHasFocus = await getCurrentWindow().isFocused();
        } catch {
          // If we can't tell, assume external — better to capture than
          // silently no-op.
        }
        if (appHasFocus) {
          setCaptureToast({
            kind: "error",
            message:
              "Capture is for other apps. Switch to your browser/Slack/etc., select a phrase, then press the hotkey.",
          });
          return;
        }

        const before = await safeReadClipboard();
        try {
          await api.simulateCopyKeystroke();
        } catch {
          // Non-fatal: the copy simulation can fail on apps that block
          // synthetic input; we'll just use whatever was already in the
          // clipboard.
        }
        // Wait for the OS clipboard to settle. 80ms is enough for most
        // apps to commit a copy.
        await new Promise((r) => setTimeout(r, 80));
        const after = await safeReadClipboard();
        const text = after && after !== before ? after : before;
        if (!text) {
          setCaptureToast({
            kind: "error",
            message:
              "Nothing to capture. Select some text first, then press the hotkey.",
          });
          return;
        }
        setCaptureToast({ kind: "capturing", preview: text });
        const result = await captureChunkRef.current(text);
        setCaptureToast({ kind: "captured", preview: result.text });
      } catch (e) {
        // Surface every shred of detail so the user doesn't need DevTools.
        // CmdError from Rust comes through as {code, message, retryable}.
        // Unknown shapes get JSON-stringified.
        const err = e as { code?: string; message?: string };
        let detail: string;
        if (err.code && err.message) {
          detail = `${err.code}: ${err.message}`;
        } else if (err.message) {
          detail = err.message;
        } else if (err.code) {
          detail = err.code;
        } else if (typeof e === "string") {
          detail = e;
        } else {
          try {
            detail = JSON.stringify(e);
          } catch {
            detail = String(e);
          }
        }
        console.warn("Capture failed:", e);
        setCaptureToast({
          kind: "error",
          message: `Capture failed: ${detail}`,
        });
      }
    }

    async function setup() {
      try {
        // Defensive: a stale registration from a previous session (or
        // from a prior render of this effect) keeps Tauri's global state
        // bound and makes register() throw. Always clear first.
        if (await isRegistered(shortcut)) {
          await unregister(shortcut);
        }
        if (cancelled) return;
        await register(shortcut, (event) => {
          // Tauri 2 fires both Pressed and Released — only act on Pressed.
          if (event.state === "Pressed") {
            void handler();
          }
        });
      } catch (err) {
        if (cancelled) return;
        // Surface the underlying OS / plugin error verbatim so the user
        // doesn't need DevTools to diagnose. Tauri 2 typically returns a
        // string for global-shortcut errors; cover other shapes too.
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : (err as { message?: string })?.message ?? String(err);
        console.warn("Capture hotkey registration failed:", err);
        setCaptureToast({
          kind: "error",
          message: `Hotkey ${shortcut} failed: ${detail}`,
        });
      }
    }

    void setup();

    return () => {
      cancelled = true;
      void unregister(shortcut).catch(() => {});
    };
  }, [settings.captureHotkey]);

  // Auto-clear the capture toast after 4s.
  useEffect(() => {
    if (!captureToast) return;
    const t = setTimeout(() => setCaptureToast(null), 4000);
    return () => clearTimeout(t);
  }, [captureToast]);

  // Global keyboard shortcuts (UI_DESIGN.md keyboard map). Esc has a layered
  // priority: close overlay first, then stop recording.
  useKeyboardShortcuts({
    onEscape: () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      // Active module's busy state replaces the old store.session.kind read
      // (per Issue 3A — module session state is now local to its component).
      // The shell renders exactly one module at a time; resolve which one
      // is visible from the pane and ask it whether it's busy.
      const moduleId =
        pane === "review" ? "srs" : pane === "voice" ? "voice" : "shadow";
      const active = getModule(moduleId);
      if (active?.isBusy()) {
        active.cancel?.();
        return;
      }
      if (pane === "review" || pane === "voice") {
        setPane("browse");
      }
    },
    onSegment: (n) => {
      if (selectedClipId != null) selectSegment(n);
    },
    onToggleSidebar: toggleSidebar,
    onShowShortcuts: () => setShortcutsOpen((v) => !v),
    onOpenSettings: () => setSettingsOpen(true),
  });

  if (!isInTauri()) {
    return <NotInTauriBanner />;
  }

  return (
    <>
      <AppShell
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {pane === "review" ? (
          <ReviewModeView />
        ) : pane === "voice" ? (
          <VoiceSessionView />
        ) : selectedClipId == null ? (
          <EmptyStateHero />
        ) : selectedSegmentIndex == null ? (
          <SegmentList clipId={selectedClipId} />
        ) : (
          <ShadowSession
            clipId={selectedClipId}
            segmentIndex={selectedSegmentIndex}
          />
        )}
      </AppShell>
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <DropOverlay
        open={dropHover}
        ingesting={ingestFile.isPending}
        errorMessage={dropError}
      />
      <CaptureToast state={captureToast} />
    </>
  );
}

function NotInTauriBanner() {
  return (
    <main className="mx-auto max-w-2xl px-xl py-app-section">
      <h1 className="text-display-md text-ink mb-base">
        Not running in Tauri
      </h1>
      <p className="text-body-md text-body">
        You're viewing this page in a regular browser tab
        (<code>http://localhost:1420</code>). The Tauri runtime only injects
        itself into its native webview — invoke() calls won't work here.
      </p>
      <p className="text-body-md text-body mt-base">
        Look for the desktop window titled "nextEnglish" that{" "}
        <code>npm run tauri dev</code> opened separately. If it didn't appear,
        check the terminal for build errors.
      </p>
    </main>
  );
}
