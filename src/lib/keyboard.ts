import { useEffect } from "react";

// Keyboard shortcuts per UI_DESIGN.md App Shell Extensions.
//   Space          play/pause reference (idle) | toggle record (in session)
//   Cmd/Ctrl+R     start recording attempt
//   Esc            stop recording / close dialog
//   Cmd/Ctrl+1..9  jump to segment N
//   ↑ / ↓          sidebar clip nav
//   Enter          open selected clip
//   Cmd/Ctrl+\\    toggle sidebar collapse
//   Cmd/Ctrl+,     open settings (deferred to v1.1)
//   Cmd/Ctrl+N     focus URL paste

export type Handlers = {
  onSpace?: () => void;
  onRecord?: () => void;
  onEscape?: () => void;
  onSegment?: (n: number) => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onEnter?: () => void;
  onToggleSidebar?: () => void;
  onFocusUrl?: () => void;
  onShowShortcuts?: () => void;
  onOpenSettings?: () => void;
};

export function useKeyboardShortcuts(h: Handlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inForm =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape" && h.onEscape) {
        h.onEscape();
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "r" && h.onRecord) {
        h.onRecord();
        e.preventDefault();
        return;
      }
      if (mod && e.key === "\\" && h.onToggleSidebar) {
        h.onToggleSidebar();
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "n" && h.onFocusUrl) {
        h.onFocusUrl();
        e.preventDefault();
        return;
      }
      if (mod && /^[1-9]$/.test(e.key) && h.onSegment) {
        h.onSegment(parseInt(e.key, 10) - 1);
        e.preventDefault();
        return;
      }
      if (mod && e.key === "," && h.onOpenSettings) {
        h.onOpenSettings();
        e.preventDefault();
        return;
      }

      // ? (Shift+/) opens the shortcuts overlay. Allowed in form fields too,
      // since it's a navigation help action.
      if (e.key === "?" && h.onShowShortcuts) {
        h.onShowShortcuts();
        e.preventDefault();
        return;
      }

      // Below this point, ignore keys when typing in a form field.
      if (inForm) return;

      if (e.code === "Space" && h.onSpace) {
        h.onSpace();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp" && h.onArrowUp) {
        h.onArrowUp();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown" && h.onArrowDown) {
        h.onArrowDown();
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && h.onEnter) {
        h.onEnter();
        e.preventDefault();
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [h]);
}
