import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type {
  VoiceRecordingApi,
  VoiceRecordingResult,
  VoiceRecordingState,
} from "../useVoiceRecording";

// Queue of results stop() returns in order. Tests push one entry per
// expected recording cycle (one for side A, one for side B, etc.).
let resultQueue: VoiceRecordingResult[] = [];

vi.mock("../useVoiceRecording", () => ({
  useVoiceRecording: (): VoiceRecordingApi => {
    const [state, setState] = useState<VoiceRecordingState>({ kind: "idle" });
    return {
      state,
      start: async () => setState({ kind: "recording" }),
      stop: async () => {
        setState({ kind: "analyzing" });
        await Promise.resolve();
        const next = resultQueue.shift() ?? { segments: [], duration_ms: 0 };
        setState({ kind: "ready", result: next });
      },
      cancel: () => setState({ kind: "idle" }),
      reset: () => setState({ kind: "idle" }),
      meter: () => 0,
    };
  },
}));

import {
  MINIMAL_PAIRS,
  MinimalPairDrill,
  heardMatches,
  transcriptOf,
} from "../MinimalPairDrill";

beforeEach(() => {
  resultQueue = [];
});

function makeResult(text: string): VoiceRecordingResult {
  return {
    duration_ms: 1000,
    segments: [
      {
        start_ms: 0,
        end_ms: 1000,
        text,
        words: text
          .split(/\s+/)
          .filter(Boolean)
          .map((w, i) => ({ word: w, start: i * 0.2, end: i * 0.2 + 0.18, score: 1 })),
      },
    ],
  };
}

// ─────────────────── pure helpers ───────────────────

describe("transcriptOf + heardMatches", () => {
  it("joins multi-segment text trimmed", () => {
    expect(
      transcriptOf({
        duration_ms: 2000,
        segments: [
          { start_ms: 0, end_ms: 1000, text: "  ship.  ", words: [] },
          { start_ms: 1000, end_ms: 2000, text: "Sheep!", words: [] },
        ],
      }),
    ).toBe("ship. Sheep!");
  });

  it("matches case-insensitively, ignoring punctuation", () => {
    expect(heardMatches("Ship.", "ship")).toBe(true);
    expect(heardMatches("ship,", "ship")).toBe(true);
    expect(heardMatches("SHIP", "ship")).toBe(true);
  });

  it("matches when the prompt is the trailing word", () => {
    expect(heardMatches("the ship", "ship")).toBe(true);
    expect(heardMatches("I said sheep", "sheep")).toBe(true);
  });

  it("rejects when prompt is a substring of a longer word", () => {
    expect(heardMatches("shipping", "ship")).toBe(false);
  });

  it("rejects on a different word", () => {
    expect(heardMatches("sheep", "ship")).toBe(false);
  });
});

// ─────────────────── pair list integrity ───────────────────

describe("MINIMAL_PAIRS", () => {
  it("has at least 20 pairs", () => {
    expect(MINIMAL_PAIRS.length).toBeGreaterThanOrEqual(20);
  });
  it("never has identical a/b within a pair", () => {
    for (const p of MINIMAL_PAIRS) {
      expect(p.a).not.toBe(p.b);
    }
  });
});

// ─────────────────── component flow ───────────────────

describe("MinimalPairDrill — component", () => {
  it("shows clean-contrast verdict when both sides are heard correctly", async () => {
    // First pair is ship/sheep
    resultQueue = [makeResult("ship"), makeResult("sheep")];

    render(<MinimalPairDrill />);

    expect(screen.getByText(/Pair 1 of/)).toBeInTheDocument();

    // Side A (ship)
    const recordButtons = screen.getAllByRole("button", {
      name: /start recording/i,
    });
    expect(recordButtons.length).toBe(2);
    await userEvent.click(recordButtons[0]); // start A
    const stopA = await screen.findByRole("button", { name: /stop recording/i });
    await userEvent.click(stopA); // stop A → ready → captured

    // Side B (sheep)
    const recordButtonsB = await screen.findAllByRole("button", {
      name: /start recording/i,
    });
    await userEvent.click(recordButtonsB[1]); // start B
    const stopB = await screen.findByRole("button", { name: /stop recording/i });
    await userEvent.click(stopB);

    expect(
      await screen.findByText(/Clean contrast/i),
    ).toBeInTheDocument();
  });

  it("shows confused-contrast verdict when both sides transcribe the same", async () => {
    // Both attempts heard as "ship" → user confuses ship/sheep
    resultQueue = [makeResult("ship"), makeResult("ship")];

    render(<MinimalPairDrill />);

    const recordButtonsA = screen.getAllByRole("button", {
      name: /start recording/i,
    });
    await userEvent.click(recordButtonsA[0]);
    const stopA = await screen.findByRole("button", { name: /stop recording/i });
    await userEvent.click(stopA);

    const recordButtonsB = await screen.findAllByRole("button", {
      name: /start recording/i,
    });
    await userEvent.click(recordButtonsB[1]);
    const stopB = await screen.findByRole("button", { name: /stop recording/i });
    await userEvent.click(stopB);

    expect(await screen.findByText(/Confused/i)).toBeInTheDocument();
  });

  it("advances to the next pair on Next pair", async () => {
    resultQueue = [makeResult("ship"), makeResult("sheep")];
    render(<MinimalPairDrill />);

    const recordButtonsA = screen.getAllByRole("button", {
      name: /start recording/i,
    });
    await userEvent.click(recordButtonsA[0]);
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );

    const recordButtonsB = await screen.findAllByRole("button", {
      name: /start recording/i,
    });
    await userEvent.click(recordButtonsB[1]);
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );

    const next = await screen.findByRole("button", { name: /next pair/i });
    await userEvent.click(next);

    expect(screen.getByText(/Pair 2 of/)).toBeInTheDocument();
  });
});
