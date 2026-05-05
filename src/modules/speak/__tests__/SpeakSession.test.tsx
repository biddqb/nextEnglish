import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type {
  VoiceRecordingApi,
  VoiceRecordingResult,
  VoiceRecordingState,
} from "../../voice/useVoiceRecording";
import type {
  SpeakCritique,
  SpeakHistoryTurn,
  SpeakScenario,
} from "../../../lib/api";

// ─────────────────── shared mock state ───────────────────

let nextRecResult: VoiceRecordingResult = { segments: [], duration_ms: 0 };
let nextCritique: SpeakCritique = {
  score_overall: 80,
  feedback: "Strong reply.",
  strengths: ["clear pacing"],
  improvements: ["add a metric"],
  follow_up_question: "What metric would prove it?",
};
let judgeCalls: Array<{
  scenario: string;
  userTranscript: string;
  history: SpeakHistoryTurn[];
}> = [];
let ttsCalls: string[] = [];
const SCENARIOS: SpeakScenario[] = [
  {
    id: "demo-1",
    category: "demo_pitch",
    title: "Demo intro",
    prompt: "Open today's sprint demo for stakeholders.",
  },
  {
    id: "dbg-1",
    category: "debugging",
    title: "Race conditions",
    prompt: "Explain a race condition to a junior engineer.",
  },
];

vi.mock("../../../lib/queries", () => ({
  useSpeakScenarios: () => ({
    data: SCENARIOS,
    isLoading: false,
    isError: false,
  }),
  useSpeakTts: () => ({
    mutateAsync: vi.fn(async (text: string) => {
      ttsCalls.push(text);
      return { audio_path: "/tmp/fake-prompt.wav", duration_ms: 1500 };
    }),
    data: { audio_path: "/tmp/fake-prompt.wav", duration_ms: 1500 },
  }),
  useSpeakJudge: () => ({
    mutateAsync: vi.fn(async (args: typeof judgeCalls[number]) => {
      judgeCalls.push(args);
      return nextCritique;
    }),
  }),
}));

vi.mock("../../voice/useVoiceRecording", () => ({
  // Same useState-backed mock pattern as the Voice sub-mode tests so the
  // record button can drive idle → recording → analyzing → ready by clicks
  // alone.
  useVoiceRecording: (): VoiceRecordingApi => {
    const [state, setState] = useState<VoiceRecordingState>({ kind: "idle" });
    return {
      state,
      start: async () => setState({ kind: "recording" }),
      stop: async () => {
        setState({ kind: "analyzing" });
        await Promise.resolve();
        setState({ kind: "ready", result: nextRecResult });
      },
      cancel: () => setState({ kind: "idle" }),
      reset: () => setState({ kind: "idle" }),
      meter: () => 0,
    };
  },
}));

vi.mock("../../../lib/audio", () => ({
  tauriFileUrl: (p: string) => `mock://${p}`,
  startRecording: vi.fn(),
}));

import { SpeakSession } from "../SpeakSession";

beforeEach(() => {
  judgeCalls = [];
  ttsCalls = [];
  nextRecResult = {
    segments: [
      {
        start_ms: 0,
        end_ms: 2000,
        text: "We shipped X for Y because Z.",
        words: [],
      },
    ],
    duration_ms: 2000,
  };
  nextCritique = {
    score_overall: 80,
    feedback: "Strong reply.",
    strengths: ["clear pacing"],
    improvements: ["add a metric"],
    follow_up_question: "What metric would prove it?",
  };
});

// ─────────────────── picker ───────────────────

describe("SpeakSession — picker", () => {
  it("renders curated scenarios grouped by category", () => {
    render(<SpeakSession />);
    expect(screen.getByText(/Pick a scenario/i)).toBeInTheDocument();
    expect(screen.getByText("Demo intro")).toBeInTheDocument();
    expect(screen.getByText("Race conditions")).toBeInTheDocument();
    // Categories are humanized (snake_case → Title Case).
    expect(screen.getByText("Demo Pitch")).toBeInTheDocument();
    expect(screen.getByText("Debugging")).toBeInTheDocument();
  });

  it("synthesizes the chosen prompt and moves into the active flow", async () => {
    render(<SpeakSession />);
    await userEvent.click(screen.getByText("Demo intro"));
    expect(ttsCalls).toContain("Open today's sprint demo for stakeholders.");
    expect(
      await screen.findByText(/Open today's sprint demo for stakeholders/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Turn 1/i)).toBeInTheDocument();
  });

  it("uses the freeform topic verbatim as the prompt", async () => {
    render(<SpeakSession />);
    const input = screen.getByPlaceholderText(/Explain what an embedding/i);
    await userEvent.type(input, "Define microservices");
    await userEvent.click(screen.getByRole("button", { name: /^Start$/ }));
    expect(ttsCalls).toContain("Define microservices");
  });
});

// ─────────────────── full flow ───────────────────

describe("SpeakSession — record → judge → critique", () => {
  it("walks the full conversation and shows the critique", async () => {
    render(<SpeakSession />);

    // Pick a scenario.
    await userEvent.click(screen.getByText("Demo intro"));

    // Wait for the recording button (which only renders once flow.kind === "ready").
    const recordButton = await screen.findByRole("button", {
      name: /start recording/i,
    });

    // Click record → start, then stop → analyze → ready → judge fires.
    await userEvent.click(recordButton);
    const stopButton = await screen.findByRole("button", {
      name: /stop recording/i,
    });
    await userEvent.click(stopButton);

    // Critique surfaces.
    expect(await screen.findByText("Strong reply.")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("clear pacing")).toBeInTheDocument();
    expect(screen.getByText("add a metric")).toBeInTheDocument();
    expect(screen.getByText("What metric would prove it?")).toBeInTheDocument();

    // Judge was called with the right shape.
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]).toEqual({
      scenario: "Open today's sprint demo for stakeholders.",
      userTranscript: "We shipped X for Y because Z.",
      history: [],
    });
  });

  it("Go deeper chains the follow-up as the next prompt + appends history", async () => {
    render(<SpeakSession />);

    await userEvent.click(screen.getByText("Demo intro"));
    await userEvent.click(
      await screen.findByRole("button", { name: /start recording/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );

    // Wait for critique then click Go deeper.
    await screen.findByText("Strong reply.");
    await userEvent.click(screen.getByRole("button", { name: /Go deeper/i }));

    // Second turn synthesizes the follow-up and shows it as the prompt.
    expect(ttsCalls).toContain("What metric would prove it?");
    expect(
      await screen.findByText(/Turn 2/i),
    ).toBeInTheDocument();

    // Now do another full record cycle on turn 2.
    nextRecResult = {
      segments: [
        {
          start_ms: 0,
          end_ms: 2000,
          text: "Time to first response in minutes.",
          words: [],
        },
      ],
      duration_ms: 2000,
    };
    nextCritique = {
      ...nextCritique,
      feedback: "Good metric choice.",
    };

    await userEvent.click(
      await screen.findByRole("button", { name: /start recording/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );

    await screen.findByText("Good metric choice.");

    // History sent on turn 2 contains the prior user reply + the follow-up.
    expect(judgeCalls).toHaveLength(2);
    expect(judgeCalls[1].scenario).toBe("What metric would prove it?");
    expect(judgeCalls[1].history).toEqual([
      { role: "user", content: "We shipped X for Y because Z." },
      { role: "assistant", content: "What metric would prove it?" },
    ]);
  });

  it("hides Go deeper when the critique has no follow-up question", async () => {
    nextCritique = {
      ...nextCritique,
      follow_up_question: "",
    };
    render(<SpeakSession />);
    await userEvent.click(screen.getByText("Demo intro"));
    await userEvent.click(
      await screen.findByRole("button", { name: /start recording/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );
    await screen.findByText("Strong reply.");
    expect(
      screen.queryByRole("button", { name: /Go deeper/i }),
    ).toBeNull();
  });

  it("New scenario returns to the picker", async () => {
    render(<SpeakSession />);
    await userEvent.click(screen.getByText("Demo intro"));
    await userEvent.click(
      await screen.findByRole("button", { name: /start recording/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );
    await screen.findByText("Strong reply.");
    await userEvent.click(screen.getByRole("button", { name: /New scenario/i }));
    expect(screen.getByText(/Pick a scenario/i)).toBeInTheDocument();
  });
});

// ─────────────────── empty transcript guard ───────────────────

describe("SpeakSession — empty transcript", () => {
  it("does not call judge when Whisper returns nothing", async () => {
    nextRecResult = { segments: [], duration_ms: 0 };
    render(<SpeakSession />);
    await userEvent.click(screen.getByText("Demo intro"));
    await userEvent.click(
      await screen.findByRole("button", { name: /start recording/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /stop recording/i }),
    );
    // Wait a tick for the would-be judge call.
    await new Promise((r) => setTimeout(r, 20));
    expect(judgeCalls).toHaveLength(0);
    // Still in the ready state — record button is back.
    expect(
      screen.getByRole("button", { name: /start recording/i }),
    ).toBeInTheDocument();
  });
});
