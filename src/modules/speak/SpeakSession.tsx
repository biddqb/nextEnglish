// Speak conversational practice studio.
//
// Flow (single-turn with optional go-deeper, per design):
//   1. Pick a scenario (curated dropdown or freeform topic).
//   2. App synthesizes the prompt via Piper TTS, plays it.
//   3. User records their reply.
//   4. Whisper transcribes; LLM judges (score / feedback / strengths /
//      improvements / optional follow-up question).
//   5. User can "Go deeper" to do one follow-up turn against the same
//      scenario, or pick a new scenario.
//
// State machine (FlowState below). The recording + transcription substep
// is delegated to useVoiceRecording (the same hook the Voice module uses)
// — when its state hits "ready" with a transcript, we move ourselves to
// "judging" and fire the LLM call.

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { tauriFileUrl } from "../../lib/audio";
import {
  useSpeakJudge,
  useSpeakScenarios,
  useSpeakTts,
} from "../../lib/queries";
import type {
  SpeakCritique,
  SpeakHistoryTurn,
  SpeakScenario,
} from "../../lib/api";
import { RecordButton } from "../../components/RecordButton";
import { WaveformMeter } from "../../components/WaveformMeter";
import { useVoiceRecording } from "../voice/useVoiceRecording";
import { setBusy, setCancelImpl } from "./state";

type FlowState =
  | { kind: "picking" }
  | {
      kind: "loading_prompt";
      promptText: string;
      history: SpeakHistoryTurn[];
      turn: number;
    }
  | {
      kind: "ready";
      promptText: string;
      promptAudioPath: string;
      history: SpeakHistoryTurn[];
      turn: number;
    }
  | {
      kind: "judging";
      promptText: string;
      userTranscript: string;
      history: SpeakHistoryTurn[];
      turn: number;
    }
  | {
      kind: "critique";
      promptText: string;
      userTranscript: string;
      critique: SpeakCritique;
      history: SpeakHistoryTurn[];
      turn: number;
    }
  | { kind: "error"; message: string };

export function SpeakSession() {
  const scenarios = useSpeakScenarios();
  const synthesize = useSpeakTts();
  const judge = useSpeakJudge();
  const rec = useVoiceRecording();

  const [flow, setFlow] = useState<FlowState>({ kind: "picking" });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Bridge: report busy-ness to the module-level state so the shell's Esc
  // handler can ask speakModule.isBusy() and call cancel(). Speak is busy
  // whenever we're loading a prompt, recording/transcribing, or judging.
  useEffect(() => {
    setBusy(
      flow.kind === "loading_prompt" ||
        flow.kind === "judging" ||
        rec.state.kind === "recording" ||
        rec.state.kind === "analyzing",
    );
  }, [flow.kind, rec.state.kind]);
  useEffect(() => () => setBusy(false), []);

  // Cancel impl: tear down recording, abort flow, return to picker.
  useEffect(() => {
    setCancelImpl(() => {
      rec.cancel();
      audioRef.current?.pause();
      setFlow({ kind: "picking" });
    });
    return () => setCancelImpl(null);
    // rec.cancel is stable (closes over a ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drain a "ready" recording into the judge call. Only fire when we're
  // in "ready" flow state — otherwise this would re-fire if the user
  // clicked record from a stale component tree.
  useEffect(() => {
    if (rec.state.kind !== "ready" || flow.kind !== "ready") return;
    const userTranscript = transcriptOf(rec.state.result);
    if (!userTranscript) {
      // Whisper heard nothing useful — surface a friendly error and let
      // the user re-record without losing the loaded prompt.
      setFlow({
        kind: "ready",
        promptText: flow.promptText,
        promptAudioPath: flow.promptAudioPath,
        history: flow.history,
        turn: flow.turn,
      });
      rec.reset();
      return;
    }
    setFlow({
      kind: "judging",
      promptText: flow.promptText,
      userTranscript,
      history: flow.history,
      turn: flow.turn,
    });
    rec.reset();
    judge
      .mutateAsync({
        scenario: flow.promptText,
        userTranscript,
        history: flow.history,
      })
      .then((critique) => {
        setFlow({
          kind: "critique",
          promptText: flow.promptText,
          userTranscript,
          critique,
          history: flow.history,
          turn: flow.turn,
        });
      })
      .catch((e) => {
        const err = e as { message?: string };
        setFlow({
          kind: "error",
          message: `Judge failed: ${err.message ?? "unknown error"}`,
        });
      });
    // judge / rec are stable; promptText/audio/history change with flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.state, flow.kind]);

  function startScenario(promptText: string) {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    setFlow({
      kind: "loading_prompt",
      promptText: trimmed,
      history: [],
      turn: 1,
    });
    synthesize
      .mutateAsync(trimmed)
      .then((tts) => {
        setFlow({
          kind: "ready",
          promptText: trimmed,
          promptAudioPath: tts.audio_path,
          history: [],
          turn: 1,
        });
      })
      .catch((e) => {
        const err = e as { message?: string };
        setFlow({
          kind: "error",
          message: `Couldn't synthesize prompt: ${err.message ?? "unknown error"}`,
        });
      });
  }

  function goDeeper() {
    if (flow.kind !== "critique") return;
    const followUp = flow.critique.follow_up_question.trim();
    if (!followUp) return;
    // Append the prior turn to history. The next "scenario" passed to
    // the LLM is the follow-up question itself, which keeps the prompt
    // template clean.
    const nextHistory: SpeakHistoryTurn[] = [
      ...flow.history,
      { role: "user", content: flow.userTranscript },
      { role: "assistant", content: followUp },
    ];
    setFlow({
      kind: "loading_prompt",
      promptText: followUp,
      history: nextHistory,
      turn: flow.turn + 1,
    });
    synthesize
      .mutateAsync(followUp)
      .then((tts) => {
        setFlow({
          kind: "ready",
          promptText: followUp,
          promptAudioPath: tts.audio_path,
          history: nextHistory,
          turn: flow.turn + 1,
        });
      })
      .catch((e) => {
        const err = e as { message?: string };
        setFlow({
          kind: "error",
          message: `Couldn't synthesize follow-up: ${err.message ?? "unknown error"}`,
        });
      });
  }

  function tryAgain() {
    if (flow.kind !== "critique") return;
    setFlow({
      kind: "ready",
      promptText: flow.promptText,
      // Re-use the same audio path (Piper cache is keyed on text, so this
      // is the exact same file as before — no need to re-synthesize).
      promptAudioPath: tauriPathOfLastSynthesis(flow.promptText, synthesize),
      history: flow.history,
      turn: flow.turn,
    });
  }

  function newScenario() {
    rec.cancel();
    setFlow({ kind: "picking" });
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-xl py-app-section">
      <div className="text-caption-uppercase text-muted mb-xs">
        Speak practice
      </div>

      {flow.kind === "picking" && (
        <ScenarioPicker
          scenarios={scenarios.data ?? []}
          loading={scenarios.isLoading}
          error={scenarios.isError ? "Couldn't load scenarios." : null}
          onPick={(prompt) => startScenario(prompt)}
        />
      )}

      {flow.kind !== "picking" && flow.kind !== "error" && (
        <ActiveScenarioView
          flow={flow}
          recState={rec.state.kind}
          recMeter={rec.meter}
          audioRef={audioRef}
          onStartRecording={() => void rec.start()}
          onStopRecording={() => void rec.stop()}
          onTryAgain={tryAgain}
          onGoDeeper={goDeeper}
          onNewScenario={newScenario}
        />
      )}

      {flow.kind === "error" && (
        <div className="mt-base flex flex-col gap-base">
          <div
            className="rounded-md border border-semantic-error/40 bg-semantic-error/10 p-base text-body-md text-semantic-error"
            role="alert"
          >
            {flow.message}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setFlow({ kind: "picking" })}
              className="rounded-md border border-hairline-strong px-base py-sm text-button text-ink hover:bg-surface-strong"
            >
              Back to scenarios
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────── ScenarioPicker ───────────────────

function ScenarioPicker({
  scenarios,
  loading,
  error,
  onPick,
}: {
  scenarios: SpeakScenario[];
  loading: boolean;
  error: string | null;
  onPick: (prompt: string) => void;
}) {
  const [freeform, setFreeform] = useState("");

  // Group by category; categories appear in the order their first scenario
  // appears, which keeps the layout deterministic across renders.
  const grouped = useMemo(() => {
    const map = new Map<string, SpeakScenario[]>();
    for (const s of scenarios) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return [...map.entries()];
  }, [scenarios]);

  return (
    <div className="flex flex-col gap-xxl">
      <div>
        <h2 className="text-display-md text-ink mb-base">
          Pick a scenario, or invent your own
        </h2>
        <p className="text-body-md text-body">
          The app will read the prompt aloud, you reply, and the LLM
          critiques you. Single turn by default — go deeper if the model
          asks a follow-up worth answering.
        </p>
      </div>

      <section>
        <label className="text-caption-uppercase text-muted">
          Freeform topic
        </label>
        <div className="mt-xs flex items-stretch gap-sm">
          <input
            type="text"
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeform.trim()) {
                e.preventDefault();
                onPick(freeform.trim());
              }
            }}
            placeholder="Explain what an embedding is to a non-technical PM."
            className="text-input flex-1"
          />
          <button
            type="button"
            disabled={!freeform.trim()}
            onClick={() => onPick(freeform.trim())}
            className="rounded-md bg-ink-press px-base py-sm text-button text-on-primary hover:bg-ink disabled:opacity-40"
          >
            Start
          </button>
        </div>
        <div className="mt-xxs text-caption text-muted">
          Whatever you type becomes the prompt the app reads aloud.
        </div>
      </section>

      <section>
        <div className="text-caption-uppercase text-muted mb-sm">
          Curated scenarios
        </div>
        {loading && (
          <div className="text-body-sm text-muted">Loading…</div>
        )}
        {error && (
          <div className="text-body-sm text-semantic-error">{error}</div>
        )}
        {!loading && !error && grouped.length === 0 && (
          <div className="text-body-sm text-muted">
            No scenarios returned by the sidecar.
          </div>
        )}
        <div className="flex flex-col gap-lg">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <div className="text-caption-uppercase text-muted mb-xs">
                {humanCategory(category)}
              </div>
              <div className="grid grid-cols-1 gap-xs sm:grid-cols-2">
                {items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPick(s.prompt)}
                    className="text-left rounded-md border border-hairline p-sm hover:border-ink hover:bg-surface-strong/40 transition-colors"
                  >
                    <div className="text-body-md text-ink">{s.title}</div>
                    <div className="text-body-sm text-muted line-clamp-2 mt-xxs">
                      {s.prompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────── ActiveScenarioView ───────────────────

function ActiveScenarioView({
  flow,
  recState,
  recMeter,
  audioRef,
  onStartRecording,
  onStopRecording,
  onTryAgain,
  onGoDeeper,
  onNewScenario,
}: {
  flow: Exclude<FlowState, { kind: "picking" } | { kind: "error" }>;
  recState: ReturnType<typeof useVoiceRecording>["state"]["kind"];
  recMeter: () => number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTryAgain: () => void;
  onGoDeeper: () => void;
  onNewScenario: () => void;
}) {
  const audioSrc =
    flow.kind === "ready" ? tauriFileUrl(flow.promptAudioPath) : undefined;

  function playPrompt() {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    void a.play();
  }

  const recButtonState = recState === "recording" ? "recording" : "idle";

  return (
    <div className="flex flex-col gap-xl">
      <div>
        <div className="text-caption-uppercase text-muted">
          Turn {flow.turn}
        </div>
        <h2 className="text-display-md text-ink mb-base">{flow.promptText}</h2>
      </div>

      {flow.kind === "loading_prompt" && (
        <div className="text-caption-uppercase text-muted listen-pulse">
          Synthesizing prompt audio…
        </div>
      )}

      {flow.kind === "ready" && (
        <div className="flex flex-col gap-lg">
          <audio ref={audioRef} src={audioSrc} preload="auto" />
          <div className="flex items-center gap-sm">
            <button
              type="button"
              onClick={playPrompt}
              aria-label="Play prompt"
              className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-ink-press text-on-primary hover:bg-ink"
            >
              ▶
            </button>
            <span className="text-caption text-muted">Hear the prompt</span>
          </div>
          <div className="flex flex-col items-center gap-base">
            <RecordButton
              state={recButtonState}
              onClick={
                recState === "recording" ? onStopRecording : onStartRecording
              }
              disabled={false}
            />
            {recState === "recording" && (
              <WaveformMeter active={true} getLevel={recMeter} />
            )}
          </div>
        </div>
      )}

      {flow.kind === "judging" && (
        <div className="flex flex-col gap-base">
          <div className="text-caption-uppercase text-muted listen-pulse">
            Judging your reply…
          </div>
          <div className="rounded-md border border-hairline bg-canvas-soft p-base">
            <div className="text-caption-uppercase text-muted mb-xxs">
              Your reply (transcribed)
            </div>
            <div className="text-body-md text-body">"{flow.userTranscript}"</div>
          </div>
        </div>
      )}

      {flow.kind === "critique" && (
        <CritiqueCard
          critique={flow.critique}
          userTranscript={flow.userTranscript}
          onTryAgain={onTryAgain}
          onGoDeeper={onGoDeeper}
          onNewScenario={onNewScenario}
        />
      )}
    </div>
  );
}

// ─────────────────── CritiqueCard ───────────────────

function CritiqueCard({
  critique,
  userTranscript,
  onTryAgain,
  onGoDeeper,
  onNewScenario,
}: {
  critique: SpeakCritique;
  userTranscript: string;
  onTryAgain: () => void;
  onGoDeeper: () => void;
  onNewScenario: () => void;
}) {
  const score = critique.score_overall;
  const tone = score >= 80 ? "good" : score >= 60 ? "neutral" : "bad";
  const hasFollowUp = critique.follow_up_question.trim().length > 0;

  return (
    <div className="flex flex-col gap-lg">
      <div className="rounded-lg border border-hairline-strong bg-surface-card p-lg">
        <div className="flex items-baseline gap-base mb-base">
          <div
            className={clsx(
              "text-display-lg tabular-nums",
              tone === "good" && "text-semantic-success",
              tone === "bad" && "text-semantic-error",
              tone === "neutral" && "text-ink",
            )}
          >
            {score}
          </div>
          <div className="text-caption-uppercase text-muted">/ 100</div>
        </div>
        <p className="text-body-md text-body">{critique.feedback}</p>

        {(critique.strengths.length > 0 || critique.improvements.length > 0) && (
          <div className="mt-lg grid grid-cols-1 gap-lg sm:grid-cols-2">
            {critique.strengths.length > 0 && (
              <div>
                <div className="text-caption-uppercase text-semantic-success mb-xs">
                  Strengths
                </div>
                <ul className="list-disc pl-md text-body-sm text-body space-y-xxs">
                  {critique.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {critique.improvements.length > 0 && (
              <div>
                <div className="text-caption-uppercase text-semantic-error mb-xs">
                  Improvements
                </div>
                <ul className="list-disc pl-md text-body-sm text-body space-y-xxs">
                  {critique.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {hasFollowUp && (
          <div className="mt-lg rounded-md border border-hairline bg-canvas-soft p-base">
            <div className="text-caption-uppercase text-muted mb-xxs">
              Follow-up question
            </div>
            <div className="text-body-md text-ink">{critique.follow_up_question}</div>
          </div>
        )}
      </div>

      <details className="rounded-md border border-hairline">
        <summary className="cursor-pointer p-sm text-caption-uppercase text-muted hover:bg-surface-strong/40">
          Show transcript
        </summary>
        <div className="border-t border-hairline p-sm text-body-sm text-body">
          "{userTranscript}"
        </div>
      </details>

      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={onTryAgain}
          className="rounded-md border border-hairline-strong px-base py-sm text-button text-ink hover:bg-surface-strong"
        >
          Try again
        </button>
        {hasFollowUp && (
          <button
            type="button"
            onClick={onGoDeeper}
            className="rounded-md bg-ink-press px-base py-sm text-button text-on-primary hover:bg-ink"
          >
            Go deeper →
          </button>
        )}
        <button
          type="button"
          onClick={onNewScenario}
          className="rounded-md border border-hairline px-base py-sm text-button text-muted hover:text-ink hover:border-hairline-strong"
        >
          New scenario
        </button>
      </div>
    </div>
  );
}

// ─────────────────── helpers ───────────────────

function transcriptOf(result: {
  segments: { text: string }[];
}): string {
  return result.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function humanCategory(c: string): string {
  return c
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Try-again should reuse the same audio path the synthesize call returned
// last time. Since Piper caches per-text on disk, the most recent
// synthesize().data response for the same prompt is guaranteed to point
// at the same file. We grab it from the mutation result instead of
// re-firing the call.
function tauriPathOfLastSynthesis(
  promptText: string,
  synthesize: ReturnType<typeof useSpeakTts>,
): string {
  return synthesize.data?.audio_path ?? promptText;
}
