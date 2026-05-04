import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type {
  VoiceRecordingApi,
  VoiceRecordingResult,
  VoiceRecordingState,
} from "../useVoiceRecording";

let nextResult: VoiceRecordingResult = { segments: [], duration_ms: 0 };

vi.mock("../useVoiceRecording", () => ({
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

import { PacingAnalyzer, computePacing } from "../PacingAnalyzer";

beforeEach(() => {
  nextResult = { segments: [], duration_ms: 0 };
});

// ─────────────────── computePacing (pure helper) ───────────────────

describe("computePacing", () => {
  it("returns zeros for empty input", () => {
    expect(
      computePacing({ segments: [], duration_ms: 0 }),
    ).toEqual({ wpm: 0, silenceRatio: 0, longestPauseMs: 0, totalWords: 0 });
  });

  it("computes WPM from total words / duration", () => {
    // 150 words in 60 seconds = 150 WPM
    const words = Array.from({ length: 150 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.4,
      end: i * 0.4 + 0.3,
      score: 1,
    }));
    const stats = computePacing({
      duration_ms: 60_000,
      segments: [{ start_ms: 0, end_ms: 60_000, text: "...", words }],
    });
    expect(stats.wpm).toBe(150);
    expect(stats.totalWords).toBe(150);
  });

  it("computes silence ratio from speech vs total duration", () => {
    // 2 words covering 0.4s of speech in a 1s clip → 60% silence
    const stats = computePacing({
      duration_ms: 1000,
      segments: [
        {
          start_ms: 0,
          end_ms: 1000,
          text: "hi there",
          words: [
            { word: "hi", start: 0.0, end: 0.2, score: 1 },
            { word: "there", start: 0.6, end: 0.8, score: 1 },
          ],
        },
      ],
    });
    expect(stats.silenceRatio).toBeCloseTo(0.6, 5);
  });

  it("finds the longest pause between word boundaries", () => {
    // Largest internal gap: 0.5 → 2.0 = 1.5s; tail: 3.0 → 3.0 = 0; head: 0
    const stats = computePacing({
      duration_ms: 3000,
      segments: [
        {
          start_ms: 0,
          end_ms: 3000,
          text: "a b c",
          words: [
            { word: "a", start: 0.0, end: 0.5, score: 1 },
            { word: "b", start: 2.0, end: 2.3, score: 1 },
            { word: "c", start: 2.5, end: 3.0, score: 1 },
          ],
        },
      ],
    });
    expect(stats.longestPauseMs).toBeCloseTo(1500, 5);
  });

  it("counts a long bookend silence at the head as longest pause", () => {
    const stats = computePacing({
      duration_ms: 5000,
      segments: [
        {
          start_ms: 0,
          end_ms: 5000,
          text: "hi",
          words: [
            { word: "hi", start: 3.0, end: 3.4, score: 1 },
          ],
        },
      ],
    });
    // head: 3.0s; tail: 5.0 - 3.4 = 1.6s
    expect(stats.longestPauseMs).toBeCloseTo(3000, 5);
  });
});

// ─────────────────── component flow ───────────────────

describe("PacingAnalyzer — component", () => {
  it("walks idle → recording → ready and renders WPM/silence/pause stats", async () => {
    nextResult = {
      duration_ms: 60_000,
      segments: [
        {
          start_ms: 0,
          end_ms: 60_000,
          text: "two words",
          words: [
            { word: "two", start: 0, end: 0.3, score: 1 },
            { word: "words", start: 0.5, end: 0.9, score: 1 },
          ],
        },
      ],
    };

    render(<PacingAnalyzer />);

    expect(screen.queryByText(/WPM/)).toBeNull();

    const button = screen.getByRole("button", { name: /start recording/i });
    await userEvent.click(button);
    await userEvent.click(button);

    // 2 words / 60s × 60s/min = 2 WPM
    expect(screen.getByText("WPM")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Silence")).toBeInTheDocument();
    expect(screen.getByText("Longest pause")).toBeInTheDocument();
  });
});
