import type { ReactNode } from "react";
import { useEffect } from "react";
import { useStore } from "../lib/store";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";

// Two-pane app shell per UI_DESIGN.md App Shell Extensions.
// Sidebar auto-collapses below 1100px window width; user can toggle via
// Cmd/Ctrl+\\ (handled in App-level keyboard hook).
export function AppShell({
  children,
  onShowShortcuts,
  onOpenSettings,
}: {
  children: ReactNode;
  onShowShortcuts?: () => void;
  onOpenSettings?: () => void;
}) {
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => setSidebarCollapsed(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setSidebarCollapsed]);

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopBar
        onShowShortcuts={onShowShortcuts}
        onOpenSettings={onOpenSettings}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
