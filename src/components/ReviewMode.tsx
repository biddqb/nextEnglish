import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  useDueCards,
  useRecordReview,
  useSaveAttempt,
  useScoreAttempt,
} from "../lib/queries";
import { useStore } from "../lib/store";
import { startRecording, tauriFileUrl, type RecorderHandle } from "../lib/audio";
import { applyReview, previewIntervals, type RatingButton } from "../lib/fsrs";
import { clozeBlankFor, tokenizeForCloze } from "../lib/cloze";
import { RecordButton } from "./RecordButton";
import { WaveformMeter } from "./WaveformMeter";
import { ScoreCard } from "./ScoreCard";
import type { DueCard, ScoreData } from "../lib/types";

// SRS review queue. Pulls due cards, presents them one at a time inside a
// trimmed-down ShadowSession, then surfaces four FSRS rating buttons after
// the user scores their attempt. The ts-fsrs scheduler computes the next
// state in TS; the Rust side just persists.
type Phase =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "recording" }
  | { kind: "analyzing" }
  | { kind: "scored"; userAudioPath: string; score: ScoreData };

export function ReviewMode() {
  const setPane = useStore((s) => s.setPane);
  const { data: queue, isLoading, isError } = useDueCards(50);
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [recordError, setRecordError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);

  const saveAttempt = useSaveAttempt();
  const scoreAttempt = useScoreAttempt();
  const recordReview = useRecordReview();

  const card: DueCard | undefined = queue?.[cursor];

  const refSrc = useMemo(
    () => (card ? tauriFileUrl(card.clip_audio_path) : undefined),
    [card],
  );

  // Reset session state on card advance.
  useEffect(() => {
    setPhase({ kind: "idle" });
    setRecordError(null);
    if (audioRef.current && card) {
      audioRef.current.pause();
      audioRef.current.currentTime = card.segment_start_ms / 1000;
    }
  }, [card?.card.id]);

  // Tear down recorder + audio on unmount.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="px-xl py-xxl text-body-md text-muted">
        Loading review queue…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-xl py-xxl text-body-md text-semantic-error">
        Couldn't load review queue.
      </div>
    );
  }
  if (!queue || queue.length === 0) {
    return <AllCaughtUp onBack={() => setPane("browse")} />;
  }
  if (!card) {
    // Walked off the end of the queue this session.
    return <AllCaughtUp onBack={() => setPane("browse")} />;
  }

  function playReference() {
    const a = audioRef.current;
    if (!a || !card) return;
    if (
      a.currentTime < card.segment_start_ms / 1000 ||
      a.currentTime >= card.segment_end_ms / 1000
    ) {
      a.currentTime = card.segment_start_ms / 1000;
    }
    void a.play();
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !card) return;
    if (a.currentTime >= card.segment_end_ms / 1000) {
      a.pause();
      a.currentTime = card.segment_start_ms / 1000;
    }
  }

  async function startRecordingFlow() {
    if (!card) return;
    setRecordError(null);
    try {
      playReference();
      const handle = await startRecording();
      recorderRef.current = handle;
      setPhase({ kind: "recording" });
    } catch (e) {
      setRecordError(messageOf(e));
      setPhase({ kind: "idle" });
    }
  }

  async function stopRecordingFlow() {
    if (!card) return;
    const handle = recorderRef.current;
    recorderRef.current = null;
    if (!handle) return;

    const audio = await handle.stop();
    const b64 = await audio.base64;

    setPhase({ kind: "analyzing" });
    try {
      const path = await saveAttempt.mutateAsync({
        clipId: card.clip_id,
        segmentIndex: card.segment_index,
        audioBase64: b64,
        extension: audio.extension,
      });
      const score = await scoreAttempt.mutateAsync({
        clipId: card.clip_id,
        segmentIndex: card.segment_index,
        attemptAudioPath: path,
      });
      setPhase({ kind: "scored", userAudioPath: path, score });
    } catch (e) {
      setRecordError(messageOf(e));
      setPhase({ kind: "idle" });
    }
  }

  function onRecordButtonClick() {
    if (phase.kind === "idle" || phase.kind === "scored") {
      void startRecordingFlow();
    } else if (phase.kind === "recording" || phase.kind === "listening") {
      void stopRecordingFlow();
    }
  }

  async function rate(rating: RatingButton) {
    if (!card) return;
    const result = applyReview(card.card, rating);
    try {
      await recordReview.mutateAsync({
        cardId: card.card.id,
        dueAt: result.due_at,
        stability: result.stability,
        difficulty: result.difficulty,
        reps: result.reps,
        lapses: result.lapses,
        cardState: result.card_state,
      });
    } catch (e) {
      // The user already attempted; just log + advance. The card stays "due"
      // and they'll see it again next time the queue refetches.
      console.error("recordReview failed", e);
    }
    setCursor((i) => i + 1);
  }

  const intervals = previewIntervals(card.card);
  const remaining = queue.length - cursor;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-xl py-app-section">
      <div className="mb-base flex items-baseline justify-between">
        <div className="text-caption-uppercase text-muted">
          Review · {remaining} of {queue.length} remaining
        </div>
        <button
          onClick={() => setPane("browse")}
          className="button-tertiary"
        >
          Exit review
        </button>
      </div>
      <div className="text-caption-uppercase text-muted mb-xs truncate">
        {card.clip_title} · Segment {card.segment_index + 1}
      </div>
      <h2 className="text-display-md text-ink mb-xxl">
        <ClozeText
          text={card.segment_text}
          clozeIndices={card.card.cloze_word_indices}
          reveal={phase.kind === "scored"}
        />
      </h2>

      <audio
        ref={audioRef}
        src={refSrc}
        onTimeUpdate={onTimeUpdate}
        preload="auto"
      />

      <div className="mb-xxl flex items-center gap-base">
        <button
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            a.paused ? playReference() : a.pause();
          }}
          aria-label="Play reference"
          className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-ink-press text-on-primary"
        >
          ▶
        </button>
        <span className="text-caption-uppercase text-muted">
          Reference · {formatRange(card.segment_start_ms, card.segment_end_ms)}
        </span>
      </div>

      <div className="flex flex-col items-center gap-base">
        <RecordButton
          state={
            phase.kind === "recording" || phase.kind === "listening"
              ? "recording"
              : "idle"
          }
          onClick={onRecordButtonClick}
          disabled={phase.kind === "analyzing"}
        />
        {phase.kind === "recording" && (
          <WaveformMeter
            active={true}
            getLevel={() => recorderRef.current?.meter() ?? 0}
          />
        )}
        {phase.kind === "analyzing" && (
          <div className="text-caption-uppercase text-muted listen-pulse">
            Analyzing
          </div>
        )}
        {recordError && (
          <div className="text-body-sm text-semantic-error" role="alert">
            {recordError}
          </div>
        )}
      </div>

      {phase.kind === "scored" && (
        <div className="mt-xxl">
          <ScoreCard
            score={phase.score}
            referenceText={card.segment_text}
            onTryAgain={() => {
              setPhase({ kind: "idle" });
              void startRecordingFlow();
            }}
          />
          <div className="mt-xxl">
            <div className="text-caption-uppercase text-muted text-center mb-base">
              How did that feel?
            </div>
            <div className="mx-auto flex max-w-md justify-center gap-xs">
              {(["Again", "Hard", "Good", "Easy"] as RatingButton[]).map(
                (r) => (
                  <RatingPill
                    key={r}
                    label={r}
                    interval={intervals[r]}
                    tone={ratingTone(r)}
                    onClick={() => void rate(r)}
                    disabled={recordReview.isPending}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renders segment text with cloze blanks. Before scoring, blanked words are
// shown as length-proportional underscores; after scoring, the full text
// reveals so the user can see what they were saying. Blanks stay visually
// distinct (hairline color) even when revealed, so the recall vs read
// distinction is preserved.
function ClozeText({
  text,
  clozeIndices,
  reveal,
}: {
  text: string;
  clozeIndices: number[];
  reveal: boolean;
}) {
  const tokens = tokenizeForCloze(text);
  const clozed = new Set(clozeIndices);
  return (
    <>
      {tokens.map((t, i) => {
        if (!t.isWord) return <span key={i}>{t.text}</span>;
        const isClozed = clozed.has(t.wordIndex!);
        if (!isClozed) return <span key={i}>{t.text}</span>;
        if (reveal) {
          return (
            <span
              key={i}
              className="text-muted"
              title="This word was blanked during review"
            >
              {t.text}
            </span>
          );
        }
        return (
          <span key={i} className="text-ink">
            {clozeBlankFor(t.text)}
          </span>
        );
      })}
    </>
  );
}

function RatingPill({
  label,
  interval,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  interval: string;
  tone: "warning" | "muted" | "ink";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex flex-1 flex-col items-center gap-xxs rounded-md border px-base py-sm transition",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        tone === "warning" &&
          "border-hairline-strong text-ink hover:border-semantic-error hover:text-semantic-error",
        tone === "muted" &&
          "border-hairline-strong text-ink hover:border-ink",
        tone === "ink" &&
          "border-ink bg-ink text-on-primary hover:bg-ink-press",
      )}
    >
      <span className="text-button">{label}</span>
      <span className="text-caption-uppercase tabular-nums opacity-70">
        {interval}
      </span>
    </button>
  );
}

function ratingTone(r: RatingButton): "warning" | "muted" | "ink" {
  if (r === "Again") return "warning";
  if (r === "Good") return "ink";
  return "muted";
}

function AllCaughtUp({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-xl py-app-section text-center">
      <div className="text-display-md text-ink mb-base">All caught up.</div>
      <p className="text-body-md text-body mb-xxl">
        Save more segments from the clip view, or come back when more cards
        come due.
      </p>
      <button onClick={onBack} className="button-primary">
        Back to clips
      </button>
    </div>
  );
}

function formatRange(startMs: number, endMs: number): string {
  return `${formatTimestamp(startMs)} → ${formatTimestamp(endMs)}`;
}

function formatTimestamp(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function messageOf(e: unknown): string {
  const x = e as { message?: string; code?: string };
  if (x.code) return `${x.code}: ${x.message ?? "error"}`;
  return x.message ?? String(e);
}
