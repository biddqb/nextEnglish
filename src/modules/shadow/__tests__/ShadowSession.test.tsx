import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mocks must be declared BEFORE the import that uses them — vi.mock is
// hoisted, so source order doesn't determine evaluation order, but readability
// does. Top-of-file mock block keeps fixture wiring discoverable.

const saveCardMutate = vi.fn();
const unsaveCardMutate = vi.fn();
let savedIndices: number[] = [];
const settings = {
  whisperModel: "small.en",
  maxDurationS: 900,
  autoLoopMs: 2000,
  obsidianVaultPath: "",
  captureHotkey: "Ctrl+Alt+C",
};

vi.mock("../../lib/queries", () => ({
  useClip: (clipId: number | null) => ({
    data: clipId == null ? undefined : SAMPLE_CLIP_PAYLOAD,
  }),
  useSavedSegments: () => ({ data: savedIndices }),
  useSaveCard: () => ({ mutate: saveCardMutate }),
  useUnsaveCard: () => ({ mutate: unsaveCardMutate }),
  useSaveAttempt: () => ({
    mutateAsync: vi.fn(async () => "/tmp/fake-attempt.wav"),
  }),
  useScoreAttempt: () => ({
    mutateAsync: vi.fn(async () => SAMPLE_SCORE),
  }),
  useSettings: () => settings,
  useAttempts: () => ({ data: [] }),
  useCard: () => ({ data: null }),
  useSetCardCloze: () => ({ mutate: vi.fn() }),
}));

// Stub out the children that pull their own data — we test ShadowSession's
// own behavior here, not theirs. ClozeEditor / PitchOverlay / AttemptHistory
// each have their own characterization tests (or are pinned by integration
// in App.test.tsx, deferred to step 7).
vi.mock("../../components/ClozeEditor", () => ({
  ClozeEditor: () => <div data-testid="cloze-editor">cloze stub</div>,
}));
vi.mock("../../components/PitchOverlay", () => ({
  PitchOverlay: () => null,
}));
vi.mock("../../components/AttemptHistory", () => ({
  AttemptHistory: () => null,
}));
vi.mock("../../lib/audio", () => ({
  tauriFileUrl: (p: string) => `mock://${p}`,
  startRecording: vi.fn(),
}));

import { ShadowSession } from "../ShadowSession";
import { useStore } from "../../lib/store";
import type { ClipPayload } from "../../lib/api";

// ─────────────────── fixture data ───────────────────

const SAMPLE_CLIP_PAYLOAD: ClipPayload = {
  clip: {
    id: 1,
    title: "test clip",
    source_uri: "https://example.com/v",
    audio_path: "/tmp/clip.wav",
    duration_ms: 5000,
    created_at: "2026-05-04T00:00:00Z",
  },
  segments: [
    {
      id: 10,
      clip_id: 1,
      start_ms: 0,
      end_ms: 2500,
      text: "touch base soon",
      words: [
        { word: "touch", start: 0, end: 0.5, score: 1 },
        { word: "base", start: 0.5, end: 1, score: 1 },
        { word: "soon", start: 1, end: 1.5, score: 1 },
      ],
    },
  ],
};

const SAMPLE_SCORE = {
  overall: 75,
  word_accuracy: 0.9,
  cadence: 0.7,
  pitch_corr: 0.6,
  word_flags: [
    { word: "touch", matched: true },
    { word: "base", matched: true },
    { word: "soon", matched: true },
  ],
  user_transcript: "touch base soon",
};

// Reset shared state between tests so the global zustand store + per-fixture
// mocks don't leak across cases.
beforeEach(() => {
  saveCardMutate.mockClear();
  unsaveCardMutate.mockClear();
  savedIndices = [];
  settings.autoLoopMs = 2000;
  useStore.getState().reset();
});

// ─────────────────── Test 4: save-card star toggle ───────────────────

describe("ShadowSession — save-card star toggle", () => {
  it("calls saveCard.mutate when an unsaved star is clicked", async () => {
    savedIndices = [];
    render(<ShadowSession clipId={1} segmentIndex={0} />);

    const star = screen.getByLabelText("Save for review");
    expect(star.textContent).toBe("☆");
    expect(star).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(star);

    expect(saveCardMutate).toHaveBeenCalledTimes(1);
    expect(saveCardMutate).toHaveBeenCalledWith({
      clipId: 1,
      segmentIndex: 0,
    });
    expect(unsaveCardMutate).not.toHaveBeenCalled();
  });

  it("calls unsaveCard.mutate when an already-saved star is clicked", async () => {
    savedIndices = [0];
    render(<ShadowSession clipId={1} segmentIndex={0} />);

    const star = screen.getByLabelText("Remove from review queue");
    expect(star.textContent).toBe("★");
    expect(star).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(star);

    expect(unsaveCardMutate).toHaveBeenCalledTimes(1);
    expect(unsaveCardMutate).toHaveBeenCalledWith({
      clipId: 1,
      segmentIndex: 0,
    });
    expect(saveCardMutate).not.toHaveBeenCalled();
  });
});

// ─────────────────── Test 5: auto-loop countdown ───────────────────

describe("ShadowSession — auto-loop countdown", () => {
  it("shows the Hold control once the session is in scored state", () => {
    const { container } = render(
      <ShadowSession clipId={1} segmentIndex={0} />,
    );

    // Idle: no countdown surface.
    expect(container.textContent).not.toMatch(/Hold/i);

    // Force the store into scored state directly — same shape ShadowSession
    // produces after a real score round-trip, without needing MediaRecorder.
    act(() => {
      useStore
        .getState()
        .setScore(0, "/tmp/fake-attempt.wav", SAMPLE_SCORE);
    });

    expect(container.textContent ?? "").toMatch(/Hold/i);
  });

  it("hides the Hold control when autoLoopMs is 0 (auto-loop disabled)", () => {
    settings.autoLoopMs = 0;
    const { container } = render(
      <ShadowSession clipId={1} segmentIndex={0} />,
    );

    act(() => {
      useStore
        .getState()
        .setScore(0, "/tmp/fake-attempt.wav", SAMPLE_SCORE);
    });

    // ScoreCard should still render (the user can Try again manually), but
    // no Hold/countdown surface.
    expect(container.textContent ?? "").not.toMatch(/Hold/i);
  });
});
