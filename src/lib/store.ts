import { create } from "zustand";

// Cross-module UI state. Server data (clips, segments) lives in react-query.
// Per Issue 3A from /plan-eng-review, per-module session state (recording /
// analyzing / scored) now lives inside each module — not here. This store
// only holds genuinely global concerns: which clip + segment is selected,
// sidebar collapse, and which top-level pane is active.

// Top-level main-pane mode. "browse" is the clip-library flow (renders the
// Shadow module against a selected clip+segment, or the empty state).
// "review" routes to the SRS module. "voice" routes to the Voice module
// (clip-free production studio). "speak" routes to the Speak module
// (LLM-judged conversational practice).
export type PaneMode = "browse" | "review" | "voice" | "speak";

type Store = {
  selectedClipId: number | null;
  selectedSegmentIndex: number | null;
  sidebarCollapsed: boolean;
  pane: PaneMode;

  selectClip: (id: number | null) => void;
  selectSegment: (index: number | null) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPane: (pane: PaneMode) => void;
};

export const useStore = create<Store>((set) => ({
  selectedClipId: null,
  selectedSegmentIndex: null,
  sidebarCollapsed: false,
  pane: "browse",

  selectClip: (id) =>
    set({
      selectedClipId: id,
      selectedSegmentIndex: null,
      // Picking a clip exits review mode — clip browsing and review queue
      // are mutually exclusive top-level modes.
      pane: "browse",
    }),
  selectSegment: (index) => set({ selectedSegmentIndex: index }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setPane: (pane) => set({ pane }),
}));
