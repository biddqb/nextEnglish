import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type {
  VoiceRecordingApi,
  VoiceRecordingResult,
  VoiceRecordingState,
} from "../useVoiceRecording";

// Test-controlled result that the mocked hook returns from stop().
let nextResult: VoiceRecordingResult = { segments: [], duration_ms: 0 };

vi.mock("../useVoiceRecording", () => ({
  // useState inside the mock factory keeps the hook's state machine alive
  // across renders without needing manual rerender() calls. start() and
  // stop() drive the same idle → recording → analyzing → ready transitions
  // a real recording would, but synchronously through awaited promises.
  useVoiceRecording: (): VoiceRecordingApi => {
    const [state, setState] = useState<VoiceRecordingState>({ kind: "idle" });
    return {
      state,
      start: async () => setState({ kind: "recording" }),
      stop: async () => {
        setState({ kind: "analyzing" });
        await Promise.resolve();
        setState({ kind: "ready", result: nextResult });
      },
      cancel: () => setState({ kind: "idle" }),
      reset: () => setState({ kind: "idle" }),
      meter: () => 0,
    };
  },
}));

import { FillerDetector, countFillers } from "../FillerDetector";

beforeEach(() => {
  nextResult = { segments: [], duration_ms: 0 };
});

// ─────────────────── countFillers (pure helper) ───────────────────

describe("countFillers", () => {
  it("counts single-word fillers across segments", () => {
    const hits = countFillers({
      duration_ms: 3000,
      segments: [
        {
          start_ms: 0,
          end_ms: 1500,
          text: "um well so basically",
          words: [
            { word: "um", start: 0, end: 0.2, score: 1 },
            { word: "well", start: 0.2, end: 0.5, score: 1 },
            { word: "so", start: 0.5, end: 0.7, score: 1 },
            { word: "basically", start: 0.7, end: 1.4, score: 1 },
          ],
        },
        {
          start_ms: 1500,
          end_ms: 3000,
          text: "uh actually right",
          words: [
            { word: "uh", start: 1.5, end: 1.7, score: 1 },
            { word: "actually", start: 1.7, end: 2.3, score: 1 },
            { word: "right", start: 2.3, end: 2.7, score: 1 },
          ],
        },
      ],
    });
    // um, so, basically (seg 0) + uh, actually, right (seg 1) = 6
    expect(hits.map((h) => h.text)).toEqual([
      "um",
      "so",
      "basically",
      "uh",
      "actually",
      "right",
    ]);
  });

  it("matches two-word phrase fillers (you know, kind of)", () => {
    const hits = countFillers({
      duration_ms: 2000,
      segments: [
        {
          start_ms: 0,
          end_ms: 2000,
          text: "you know kind of like that",
          words: [
            { word: "you", start: 0, end: 0.2, score: 1 },
            { word: "know", start: 0.2, end: 0.4, score: 1 },
            { word: "kind", start: 0.4, end: 0.6, score: 1 },
            { word: "of", start: 0.6, end: 0.8, score: 1 },
            { word: "like", start: 0.8, end: 1.0, score: 1 },
            { word: "that", start: 1.0, end: 1.3, score: 1 },
          ],
        },
      ],
    });
    const texts = hits.map((h) => h.text).sort();
    // single-word: like; phrases: "you know", "kind of"
    expect(texts).toEqual(["kind of", "like", "you know"]);
  });

  it("strips punctuation and is case-insensitive", () => {
    const hits = countFillers({
      duration_ms: 1000,
      segments: [
        {
          start_ms: 0,
          end_ms: 1000,
          text: "Um, Uh!",
          words: [
            { word: "Um,", start: 0, end: 0.3, score: 1 },
            { word: "Uh!", start: 0.3, end: 0.6, score: 1 },
          ],
        },
      ],
    });
    expect(hits).toHaveLength(2);
  });

  it("returns no hits when there are no fillers", () => {
    const hits = countFillers({
      duration_ms: 1000,
      segments: [
        {
          start_ms: 0,
          end_ms: 1000,
          text: "ship the build today",
          words: [
            { word: "ship", start: 0, end: 0.25, score: 1 },
            { word: "the", start: 0.25, end: 0.4, score: 1 },
            { word: "build", start: 0.4, end: 0.7, score: 1 },
            { word: "today", start: 0.7, end: 1.0, score: 1 },
          ],
        },
      ],
    });
    expect(hits).toEqual([]);
  });
});

// ─────────────────── component flow ───────────────────

describe("FillerDetector — component", () => {
  it("walks idle → recording → ready and renders filler stats", async () => {
    nextResult = {
      duration_ms: 60_000, // 1 minute → easy to verify per-minute math
      segments: [
        {
          start_ms: 0,
          end_ms: 60_000,
          text: "um well that's it",
          words: [
            { word: "um", start: 0, end: 0.5, score: 1 },
            { word: "well", start: 0.5, end: 1.0, score: 1 },
            { word: "thats", start: 1.0, end: 1.5, score: 1 },
            { word: "it", start: 1.5, end: 2.0, score: 1 },
          ],
        },
      ],
    };

    render(<FillerDetector />);

    // Idle: no stats visible.
    expect(screen.queryByText(/Per minute/i)).toBeNull();

    const button = screen.getByRole("button", { name: /start recording/i });
    await userEvent.click(button); // idle → recording
    await userEvent.click(button); // recording → analyzing → ready

    // Stats surface present.
    expect(screen.getByText("Per minute")).toBeInTheDocument();
    expect(screen.getByText("% of words")).toBeInTheDocument();

    // 1 filler ("um") in 1 minute over 4 words = 1.0/min, 25%.
    expect(screen.getByText("1")).toBeInTheDocument(); // total
    expect(screen.getByText("1.0")).toBeInTheDocument(); // per-min
    expect(screen.getByText("25.0%")).toBeInTheDocument();
  });

  it("renders 'No speech detected' when ready with empty segments", async () => {
    nextResult = { duration_ms: 1000, segments: [] };

    render(<FillerDetector />);

    const button = screen.getByRole("button", { name: /start recording/i });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(screen.getByText(/No speech detected/i)).toBeInTheDocument();
  });
});
