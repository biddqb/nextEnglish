import { useEffect, useReducer, useRef } from "react";

// Live waveform shown during recording — replaces the 5-tick LevelMeter
// while `kind === "recording"`. Reads instantaneous mic level via the
// `getLevel` callback (mirrors what LevelMeter already consumed via the
// store), buffers ~4 seconds of samples at 30fps, draws each as a vertical
// hairline mirrored around the center.
//
// Editorial styling: ink bars on canvas, no axis, no grid, no chrome.
type Props = {
  getLevel: () => number;
  active: boolean;
  durationMs?: number;
  fps?: number;
};

const DEFAULT_DURATION_MS = 4000;
const DEFAULT_FPS = 30;

export function WaveformMeter({
  getLevel,
  active,
  durationMs = DEFAULT_DURATION_MS,
  fps = DEFAULT_FPS,
}: Props) {
  // Capture the latest callback in a ref so the RAF loop doesn't need to
  // re-subscribe on every parent re-render.
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  const samples = Math.max(8, Math.round((durationMs / 1000) * fps));
  const bufferRef = useRef<number[]>([]);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!active) {
      bufferRef.current = [];
      forceRender();
      return;
    }
    let rafId = 0;
    let lastSampleAt = 0;
    const sampleEveryMs = 1000 / fps;

    const tick = (now: number) => {
      if (now - lastSampleAt >= sampleEveryMs) {
        lastSampleAt = now;
        const buf = bufferRef.current;
        buf.push(clamp01(getLevelRef.current()));
        if (buf.length > samples) buf.shift();
        forceRender();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active, fps, samples]);

  const buf = bufferRef.current;
  // Right-anchored: newest sample on the right edge so the waveform "scrolls"
  // toward the current moment. A buffer that hasn't filled yet is left-padded
  // with zeros to keep the right anchor stable visually.
  const padded =
    buf.length < samples ? [...new Array(samples - buf.length).fill(0), ...buf] : buf;

  const W = 240;
  const H = 32;
  const halfH = H / 2;
  const barGap = 1;
  const barW = Math.max(1, (W - barGap * (samples - 1)) / samples);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={padded[padded.length - 1] ?? 0}
      aria-label="Microphone input"
      className="text-ink"
    >
      {/* Hairline center axis — gives the waveform an anchor when input is silent. */}
      <line
        x1={0}
        y1={halfH}
        x2={W}
        y2={halfH}
        stroke="currentColor"
        strokeWidth={0.5}
        className="text-hairline-strong"
      />
      {padded.map((v, i) => {
        // Mirror around center: each bar is 2× the level on each side.
        const h = Math.max(1, v * (H - 2));
        const x = i * (barW + barGap);
        const y = halfH - h / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill="currentColor"
            className="text-ink"
          />
        );
      })}
    </svg>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
