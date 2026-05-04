import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Module mocks must be declared BEFORE the import that uses them.

const saveAttemptMutateAsync = vi.fn(async () => "/tmp/fake-attempt.wav");
const scoreAttemptMutateAsync = vi.fn(async () => SAMPLE_SCORE);

vi.mock("../queries", () => ({
  useSaveAttempt: () => ({ mutateAsync: saveAttemptMutateAsync }),
  useScoreAttempt: () => ({ mutateAsync: scoreAttemptMutateAsync }),
}));

let mockStop: ReturnType<typeof vi.fn>;
let mockCancel: ReturnType<typeof vi.fn>;
let startRecordingShouldThrow = false;
let stopShouldReject = false;

vi.mock("../audio", () => ({
  startRecording: vi.fn(async () => {
    if (startRecordingShouldThrow) {
      throw {
        code: "PERMISSION_DENIED",
        message: "mic permission denied",
        retryable: false,
      };
    }
    return {
      stop: mockStop,
      cancel: mockCancel,
      meter: () => 0,
    };
  }),
  tauriFileUrl: (p: string) => `mock://${p}`,
}));

import { useRecordAndScore } from "../recording";

const SAMPLE_SCORE = {
  overall: 75,
  word_accuracy: 0.9,
  cadence: 0.7,
  pitch_corr: 0.6,
  word_flags: [],
  user_transcript: "touch base",
};

beforeEach(() => {
  saveAttemptMutateAsync.mockClear();
  scoreAttemptMutateAsync.mockClear();
  startRecordingShouldThrow = false;
  stopShouldReject = false;
  mockStop = vi.fn(async () => {
    if (stopShouldReject) throw new Error("stop boom");
    return {
      bytes: new Blob([new Uint8Array(8)]),
      base64: Promise.resolve("AAAA"),
      extension: "webm",
      durationMs: 1000,
    };
  });
  mockCancel = vi.fn();
});

describe("useRecordAndScore", () => {
  it("fires onRecordingStarted after mic is acquired", async () => {
    const onRecordingStarted = vi.fn();
    const { result } = renderHook(() =>
      useRecordAndScore({
        clipId: 1,
        segmentIndex: 0,
        onRecordingStarted,
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(onRecordingStarted).toHaveBeenCalledTimes(1);
  });

  it("fires onAnalyzing then onScored with path + score on stop", async () => {
    const order: string[] = [];
    const onAnalyzing = vi.fn(() => order.push("analyzing"));
    const onScored = vi.fn(() => order.push("scored"));

    const { result } = renderHook(() =>
      useRecordAndScore({
        clipId: 1,
        segmentIndex: 0,
        onAnalyzing,
        onScored,
      }),
    );

    await act(async () => {
      await result.current.start();
      await result.current.stop();
    });

    expect(order).toEqual(["analyzing", "scored"]);
    expect(onScored).toHaveBeenCalledWith(
      "/tmp/fake-attempt.wav",
      SAMPLE_SCORE,
    );
  });

  it("calls saveAttempt then scoreAttempt with the provided clip + segment", async () => {
    const { result } = renderHook(() =>
      useRecordAndScore({ clipId: 42, segmentIndex: 7 }),
    );

    await act(async () => {
      await result.current.start();
      await result.current.stop();
    });

    expect(saveAttemptMutateAsync).toHaveBeenCalledWith({
      clipId: 42,
      segmentIndex: 7,
      audioBase64: "AAAA",
      extension: "webm",
    });
    expect(scoreAttemptMutateAsync).toHaveBeenCalledWith({
      clipId: 42,
      segmentIndex: 7,
      attemptAudioPath: "/tmp/fake-attempt.wav",
    });
  });

  it("fires onError with a CmdError-shaped message when mic permission is denied", async () => {
    startRecordingShouldThrow = true;
    const onError = vi.fn();
    const onRecordingStarted = vi.fn();

    const { result } = renderHook(() =>
      useRecordAndScore({
        clipId: 1,
        segmentIndex: 0,
        onError,
        onRecordingStarted,
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith(
      "PERMISSION_DENIED: mic permission denied",
    );
    expect(onRecordingStarted).not.toHaveBeenCalled();
  });

  it("fires onError when score_attempt rejects", async () => {
    scoreAttemptMutateAsync.mockRejectedValueOnce({
      code: "SIDECAR_DOWN",
      message: "scorer not ready",
    });
    const onScored = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useRecordAndScore({
        clipId: 1,
        segmentIndex: 0,
        onScored,
        onError,
      }),
    );

    await act(async () => {
      await result.current.start();
      await result.current.stop();
    });

    expect(onScored).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("SIDECAR_DOWN: scorer not ready");
  });

  it("stop() is a no-op if start() was never called", async () => {
    const onAnalyzing = vi.fn();
    const onScored = vi.fn();
    const { result } = renderHook(() =>
      useRecordAndScore({
        clipId: 1,
        segmentIndex: 0,
        onAnalyzing,
        onScored,
      }),
    );

    await act(async () => {
      await result.current.stop();
    });

    expect(onAnalyzing).not.toHaveBeenCalled();
    expect(onScored).not.toHaveBeenCalled();
  });

  it("cancel() tears down the recorder without calling save/score", async () => {
    const onScored = vi.fn();
    const { result } = renderHook(() =>
      useRecordAndScore({ clipId: 1, segmentIndex: 0, onScored }),
    );

    await act(async () => {
      await result.current.start();
      result.current.cancel();
    });

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledTimes(1);
    });
    expect(saveAttemptMutateAsync).not.toHaveBeenCalled();
    expect(onScored).not.toHaveBeenCalled();
  });
});
