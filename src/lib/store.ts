import { create } from "zustand";
import type { ScoreData, SessionState } from "./types";

// Cross-component UI state. Server data (clips, segments) lives in react-query.
// This store is for selection state, sidebar collapse, recording state.
//
// Per UI_DESIGN.md app-shell decisions: sidebar auto-collapses below 1100px
// width (handled in AppShell with a media query), but user can override via
// Cmd/Ctrl+\\ (handled in keyboard hook).

// Top-level main-pane mode. "browse" is the normal clip-library flow;
// "review" replaces the main pane with the SRS review queue.
export type PaneMode = "browse" | "review";

type Store = {
  selectedClipId: number | null;
  selectedSegmentIndex: number | null;
  sidebarCollapsed: boolean;
  pane: PaneMode;
  session: SessionState;

  selectClip: (id: number | null) => void;
  selectSegment: (index: number | null) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPane: (pane: PaneMode) => void;

  startListening: (segmentIndex: number) => void;
  startRecording: (segmentIndex: number) => void;
  startAnalyzing: (segmentIndex: number, userAudioPath: string) => void;
  setScore: (segmentIndex: number, userAudioPath: string, score: ScoreData) => void;
  reset: () => void;
};

export const useStore = create<Store>((set) => ({
  selectedClipId: null,
  selectedSegmentIndex: null,
  sidebarCollapsed: false,
  pane: "browse",
  session: { kind: "idle" },

  selectClip: (id) =>
    set({
      selectedClipId: id,
      selectedSegmentIndex: null,
      session: { kind: "idle" },
      // Picking a clip exits review mode — clip browsing and review queue
      // are mutually exclusive top-level modes.
      pane: "browse",
    }),
  selectSegment: (index) =>
    set({ selectedSegmentIndex: index, session: { kind: "idle" } }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setPane: (pane) => set({ pane }),

  startListening: (segmentIndex) =>
    set({ session: { kind: "listening", segmentIndex } }),
  startRecording: (segmentIndex) =>
    set({ session: { kind: "recording", segmentIndex } }),
  startAnalyzing: (segmentIndex, userAudioPath) =>
    set({ session: { kind: "analyzing", segmentIndex, userAudioPath } }),
  setScore: (segmentIndex, userAudioPath, score) =>
    set({
      session: { kind: "scored", segmentIndex, userAudioPath, score },
    }),
  reset: () => set({ session: { kind: "idle" } }),
}));
