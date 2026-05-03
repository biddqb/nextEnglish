import { useEffect, useMemo, useRef, useState } from "react";
import { useAttempts } from "../lib/queries";
import { tauriFileUrl } from "../lib/audio";
import type { AttemptRow } from "../lib/types";

// Score history strip rendered under the ScoreCard once a segment has been
// attempted. Sparkline of recent overall scores (fixed 0-100 scale — the
// number is the message, not relative trend), plus a list of rows where each
// attempt can be played back, A/B against the reference segment.
//
// Editorial 3A voice: hairline ink, no color cues, no encouragement copy.
// Treats the user as an adult; the audio comparison is the feedback.
type Source = "attempt" | "reference";

type Playing = { rowId: number; source: Source } | null;

type Props = {
  clipId: number;
  segmentIndex: number;
  // Reference audio for the clip + segment time range (ms). Used to play the
  // original phrase scrubbed to the segment for A/B comparison.
  clipAudioPath: string;
  refStartMs: number;
  refEndMs: number;
  // Force-stop history playback while the parent is in a state that owns the
  // audio output (listening / recording / analyzing). Without this, hitting
  // Record while a row is playing would have two audio sources fighting.
  paused?: boolean;
  // Fired when the user starts any playback. The parent uses this to cancel
  // the auto-re-record countdown — if the user is listening back, they're
  // not waiting to record.
  onPlaybackStart?: () => void;
};

export function AttemptHistory({
  clipId,
  segmentIndex,
  clipAudioPath,
  refStartMs,
  refEndMs,
  paused = false,
  onPlaybackStart,
}: Props) {
  const { data: attempts } = useAttempts(clipId, segmentIndex, 10);

  const attemptAudioRef = useRef<HTMLAudioElement | null>(null);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<Playing>(null);

  const refSrc = useMemo(() => tauriFileUrl(clipAudioPath), [clipAudioPath]);

  // Pause everything on unmount.
  useEffect(() => {
    return () => {
      attemptAudioRef.current?.pause();
      refAudioRef.current?.pause();
    };
  }, []);

  // Force-stop when the parent claims the audio output.
  useEffect(() => {
    if (!paused) return;
    attemptAudioRef.current?.pause();
    refAudioRef.current?.pause();
    setPlaying(null);
  }, [paused]);

  // Auto-stop reference at segment end.
  function onRefTimeUpdate() {
    const a = refAudioRef.current;
    if (!a) return;
    if (a.currentTime >= refEndMs / 1000) {
      a.pause();
      a.currentTime = refStartMs / 1000;
      setPlaying((p) => (p?.source === "reference" ? null : p));
    }
  }

  function play(row: AttemptRow, source: Source) {
    const att = attemptAudioRef.current;
    const ref = refAudioRef.current;
    if (!att || !ref) return;

    // Toggle: clicking the currently-playing row+source pauses it.
    if (playing && playing.rowId === row.id && playing.source === source) {
      (source === "attempt" ? att : ref).pause();
      setPlaying(null);
      return;
    }

    // Stop whatever is currently playing.
    att.pause();
    ref.pause();

    if (source === "attempt") {
      att.src = tauriFileUrl(row.attempt_audio_path);
      att.currentTime = 0;
      void att.play();
    } else {
      ref.currentTime = refStartMs / 1000;
      void ref.play();
    }
    setPlaying({ rowId: row.id, source });
    onPlaybackStart?.();
  }

  // Best-attempt highlight shared between the sparkline and the row list:
  // ties resolved in favor of the most recent so a current high attempt
  // isn't demoted below an older twin.
  const bestId = useMemo(() => {
    if (!attempts || attempts.length === 0) return null;
    // attempts is most-recent-first; iterate in reverse so equal scores
    // resolve to the most recent.
    let best = attempts[0];
    for (let i = 1; i < attempts.length; i++) {
      if (attempts[i].score_overall > best.score_overall) best = attempts[i];
    }
    return best.id;
  }, [attempts]);

  if (!attempts || attempts.length === 0) return null;

  return (
    <section
      aria-label="Recent attempts"
      className="mx-auto mt-xxl max-w-md border-t border-hairline pt-xl"
    >
      <div className="text-caption-uppercase text-muted mb-base">Recent</div>

      <Sparkline
        attempts={attempts}
        bestId={bestId}
        playingId={playing?.rowId ?? null}
        onSelect={(row) => play(row, "attempt")}
      />

      <ul className="mt-xl">
        {attempts.map((a) => {
          const isPlayingAttempt =
            playing?.rowId === a.id && playing.source === "attempt";
          const isPlayingRef =
            playing?.rowId === a.id && playing.source === "reference";
          return (
            <li
              key={a.id}
              className="flex items-center gap-base border-t border-hairline py-base text-body-md"
            >
              <span className="text-caption-uppercase text-muted w-[88px] shrink-0">
                {relativeTime(a.recorded_at)}
              </span>
              <span className="text-ink tabular-nums w-[40px] shrink-0">
                {a.score_overall}
              </span>
              {a.id === bestId && attempts.length > 1 && (
                <span
                  className="text-caption-uppercase text-muted"
                  aria-label="Best attempt"
                >
                  Best
                </span>
              )}
              <span className="ml-auto flex items-center gap-xs">
                <PlayPill
                  label="You"
                  active={isPlayingAttempt}
                  disabled={paused}
                  onClick={() => play(a, "attempt")}
                />
                <PlayPill
                  label="Ref"
                  active={isPlayingRef}
                  disabled={paused}
                  onClick={() => play(a, "reference")}
                />
              </span>
            </li>
          );
        })}
      </ul>

      <audio
        ref={attemptAudioRef}
        onEnded={() =>
          setPlaying((p) => (p?.source === "attempt" ? null : p))
        }
        preload="none"
      />
      <audio
        ref={refAudioRef}
        src={refSrc}
        onTimeUpdate={onRefTimeUpdate}
        preload="auto"
      />
    </section>
  );
}

function PlayPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        "inline-flex h-[28px] items-center gap-xxs rounded-full border px-sm text-caption-uppercase transition disabled:opacity-40 disabled:cursor-not-allowed " +
        (active
          ? "border-ink bg-ink text-on-primary"
          : "border-hairline text-ink hover:border-ink")
      }
    >
      <span aria-hidden="true">{active ? "❚❚" : "▷"}</span>
      <span>{label}</span>
    </button>
  );
}

// Sparkline of overall scores on a fixed 0-100 scale. Fixed scale is honest:
// a flat line means "you scored the same," not auto-zoomed false drama.
// Hairline ink path, hollow circles for past attempts, filled circle for the
// most recent. Click a dot to play that attempt.
function Sparkline({
  attempts,
  bestId,
  playingId,
  onSelect,
}: {
  attempts: AttemptRow[];
  bestId: number | null;
  playingId: number | null;
  onSelect: (a: AttemptRow) => void;
}) {
  // Sparkline is rendered chronologically (oldest left → newest right). The
  // attempts array is most-recent-first, so reverse for display.
  const ordered = useMemo(() => [...attempts].reverse(), [attempts]);

  const W = 240;
  const H = 40;
  const padX = 6;
  const padY = 4;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const points = ordered.map((a, i) => {
    const x =
      ordered.length === 1
        ? W / 2
        : padX + (i / (ordered.length - 1)) * innerW;
    const y = padY + (1 - clamp01(a.score_overall / 100)) * innerH;
    return { x, y, attempt: a };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const newest = ordered[ordered.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={`Score trend, ${attempts.length} attempts, latest ${newest.score_overall}`}
      className="overflow-visible"
    >
      {ordered.length > 1 && (
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          className="text-hairline-strong"
        />
      )}
      {points.map((p) => {
        const isNewest = p.attempt.id === newest.id;
        const isPlaying = p.attempt.id === playingId;
        const isBest = p.attempt.id === bestId;
        // Visual hierarchy: best attempt is the largest filled dot, newest
        // is filled (mid), playing temporarily filled (mid), rest hollow.
        const filled = isBest || isNewest || isPlaying;
        const r = isBest ? 4 : isPlaying ? 4 : 3;
        return (
          <g key={p.attempt.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={r}
              fill={filled ? "currentColor" : "white"}
              stroke="currentColor"
              strokeWidth={1}
              className="text-ink cursor-pointer"
              onClick={() => onSelect(p.attempt)}
            >
              <title>{`${p.attempt.score_overall}${isBest ? " · best" : ""} · ${relativeTime(p.attempt.recorded_at)}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const deltaSec = Math.max(0, (Date.now() - t) / 1000);
  if (deltaSec < 45) return "just now";
  const min = deltaSec / 60;
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 7) return `${Math.round(day)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
