import { useEffect } from "react";
import { useSettings } from "../lib/queries";

// Editorial keyboard reference modal — opens via `?`, closes on Esc, click
// outside, or the × button. Two columns: keys on the left, what they do on
// the right. Hairline divider rows; no chrome.
type Props = {
  open: boolean;
  onClose: () => void;
};

type Row = {
  keys: string[];
  label: string;
};

type Group = {
  title: string;
  rows: Row[];
};

const isMac =
  typeof navigator !== "undefined" && /Mac|iP(hone|od|ad)/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const GROUPS: Group[] = [
  {
    title: "Practice",
    rows: [
      { keys: ["Space"], label: "Play reference / toggle record" },
      { keys: [MOD, "R"], label: "Start recording attempt" },
      { keys: ["Esc"], label: "Stop recording / close dialog" },
    ],
  },
  {
    title: "Navigation",
    rows: [
      { keys: ["↑"], label: "Previous clip" },
      { keys: ["↓"], label: "Next clip" },
      { keys: ["Enter"], label: "Open selected clip" },
      { keys: [MOD, "1-9"], label: "Jump to segment N" },
    ],
  },
  {
    title: "App",
    rows: [
      { keys: [MOD, "\\"], label: "Toggle sidebar" },
      { keys: [MOD, "N"], label: "Focus URL paste" },
      { keys: [MOD, ","], label: "Open settings" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
  // Capture group is rendered separately inside the component so it can
  // pick up the user's configured hotkey from settings.
];

export function ShortcutsOverlay({ open, onClose }: Props) {
  const settings = useSettings();
  const captureKeys = settings.captureHotkey
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s === "CommandOrControl" ? MOD : s === "Option" && !isMac ? "Alt" : s,
    );

  useEffect(() => {
    if (!open) return;
    // Lock background scroll while the overlay is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-base"
      onMouseDown={(e) => {
        // Close when the backdrop itself is clicked (not the card).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-canvas-deep/30"
        onMouseDown={onClose}
      />
      <div className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl border border-hairline-strong bg-surface-card p-xl shadow-soft">
        <div className="mb-xl flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-display-sm text-ink">
            Keyboard
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

        <div className="space-y-xl">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-caption-uppercase text-muted mb-base">
                {g.title}
              </h3>
              <ul>
                {g.rows.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-base border-t border-hairline py-base last:border-b text-body-md"
                  >
                    <span className="flex shrink-0 items-center gap-xs">
                      {r.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-hairline-strong bg-surface-strong px-xs text-caption text-ink"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-body">{r.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h3 className="text-caption-uppercase text-muted mb-base">
              Capture (system-wide)
            </h3>
            <ul>
              <li className="flex items-center gap-base border-t border-hairline border-b py-base text-body-md">
                <span className="flex shrink-0 items-center gap-xs">
                  {captureKeys.map((k, j) => (
                    <kbd
                      key={j}
                      className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-hairline-strong bg-surface-strong px-xs text-caption text-ink"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
                <span className="text-body">
                  Capture selected text as a review card · change in Settings
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
