// MediaRecorder helpers for the shadowing loop.
//
// Per eng A1A: frontend records at the browser's native sample rate (typically
// 48kHz on Windows) as WebM/Opus. The Python sidecar resamples to 16k mono
// (via librosa) before feeding faster-whisper / parselmouth. The user audio
// gets normalized at score time, so we don't have to worry about format here.

export type RecorderHandle = {
  stop: () => Promise<RecordedAudio>;
  cancel: () => void;
  meter: () => number;
};

export type RecordedAudio = {
  bytes: Blob;
  base64: Promise<string>;
  extension: string;
  durationMs: number;
};

/**
 * Start recording from the default microphone. Returns a handle whose `stop()`
 * resolves to the encoded blob. `meter()` returns the current input RMS in
 * [0, 1] for a level visualization.
 *
 * Throws if the user denies mic permission or no input device is available.
 */
export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const startedAt = performance.now();
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMimeType(),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  // Level meter via Web Audio AnalyserNode.
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  function level(): number {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3);
  }

  let stopped = false;

  function teardown() {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }

  return {
    meter: level,
    stop: () =>
      new Promise<RecordedAudio>((resolve) => {
        if (stopped) return;
        stopped = true;
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          teardown();
          resolve({
            bytes: blob,
            base64: blobToBase64(blob),
            extension: extensionForMime(recorder.mimeType),
            durationMs: performance.now() - startedAt,
          });
        };
        recorder.stop();
      }),
    cancel: () => {
      stopped = true;
      try {
        recorder.stop();
      } catch {}
      teardown();
    },
  };
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "audio/webm";
}

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // chunked encode to avoid maxArguments overflow on large inputs
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}

/** Build a Tauri-asset URL for an absolute local file path so the webview
 * can stream it via `<audio src=...>`. Requires the `assetProtocol` to be
 * enabled in tauri.conf.json with the relevant scope. */
export { convertFileSrc as tauriFileUrl } from "@tauri-apps/api/core";
