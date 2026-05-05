import { invoke } from "@tauri-apps/api/core";
import type {
  AttemptRow,
  CacheStats,
  CardRow,
  Clip,
  ClipRow,
  CmdError,
  DueCard,
  ExportResult,
  PitchContoursResponse,
  ProbeResult,
  ScoreData,
  Segment,
  SegmentBest,
  SegmentRow,
  SettingPair,
} from "./types";

// Typed wrappers around Tauri's invoke(). Each maps 1:1 to a #[tauri::command]
// in src-tauri/src/commands.rs. Errors come back as CmdError objects.

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function isInTauri(): boolean {
  return inTauri;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) {
    throw {
      code: "NOT_IN_TAURI",
      message: `invoke('${cmd}') called outside the Tauri webview`,
      retryable: false,
    } satisfies CmdError;
  }
  return invoke<T>(cmd, args);
}

export const api = {
  health: () => call<string>("health"),

  ingestUrl: (url: string, maxDurationS = 900, modelName?: string) =>
    call<Clip>("ingest_url", { url, maxDurationS, modelName }),

  ingestFile: (filePath: string, maxDurationS = 900, modelName?: string) =>
    call<Clip>("ingest_file", { filePath, maxDurationS, modelName }),

  probeUrl: (url: string) => call<ProbeResult>("probe_url", { url }),

  ingestUrlTrimmed: (
    url: string,
    trimStartS: number,
    trimEndS: number,
    maxDurationS = 900,
    modelName?: string,
  ) =>
    call<Clip>("ingest_url_trimmed", {
      url,
      trimStartS,
      trimEndS,
      maxDurationS,
      modelName,
    }),

  listClips: () => call<ClipRow[]>("list_clips"),

  listSegments: (clipId: number) =>
    call<SegmentRow[]>("list_segments", { clipId }),

  getClip: (clipId: number) => call<ClipPayload>("get_clip", { clipId }),

  saveAttempt: (
    clipId: number,
    segmentIndex: number,
    audioBase64: string,
    extension: string,
  ) =>
    call<string>("save_attempt", {
      clipId,
      segmentIndex,
      audioBase64,
      extension,
    }),

  scoreAttempt: (
    clipId: number,
    segmentIndex: number,
    attemptAudioPath: string,
  ) =>
    call<ScoreData>("score_attempt", {
      clipId,
      segmentIndex,
      attemptAudioPath,
    }),

  listAttempts: (clipId: number, segmentIndex: number, limit = 10) =>
    call<AttemptRow[]>("list_attempts", { clipId, segmentIndex, limit }),

  listSegmentBestScores: (clipId: number) =>
    call<SegmentBest[]>("list_segment_best_scores", { clipId }),

  deleteClip: (clipId: number) =>
    call<void>("delete_clip", { clipId }),

  pitchContour: (
    clipId: number,
    segmentIndex: number,
    attemptAudioPath: string,
  ) =>
    call<PitchContoursResponse>("pitch_contour", {
      clipId,
      segmentIndex,
      attemptAudioPath,
    }),

  listSettings: () => call<SettingPair[]>("list_settings"),

  setSetting: (key: string, value: string | null) =>
    call<void>("set_setting", { key, value }),

  cacheStats: () => call<CacheStats>("cache_stats"),

  clearAllClips: () => call<void>("clear_all_clips"),

  saveCard: (clipId: number, segmentIndex: number) =>
    call<CardRow>("save_card", { clipId, segmentIndex }),

  unsaveCard: (clipId: number, segmentIndex: number) =>
    call<void>("unsave_card", { clipId, segmentIndex }),

  listSavedSegments: (clipId: number) =>
    call<number[]>("list_saved_segments", { clipId }),

  countDueCards: () => call<number>("count_due_cards"),

  listDueCards: (limit = 50) =>
    call<DueCard[]>("list_due_cards", { limit }),

  recordReview: (
    cardId: number,
    dueAt: string,
    stability: number,
    difficulty: number,
    reps: number,
    lapses: number,
    cardState: string,
  ) =>
    call<void>("record_review", {
      cardId,
      dueAt,
      stability,
      difficulty,
      reps,
      lapses,
      cardState,
    }),

  setCardCloze: (
    clipId: number,
    segmentIndex: number,
    indices: number[],
  ) =>
    call<CardRow>("set_card_cloze", { clipId, segmentIndex, indices }),

  getCard: (clipId: number, segmentIndex: number) =>
    call<CardRow | null>("get_card", { clipId, segmentIndex }),

  captureChunk: (text: string) =>
    call<{
      clip_id: number;
      segment_index: number;
      text: string;
      audio_path: string;
    }>("capture_chunk", { text }),

  exportToObsidian: (vaultPath: string) =>
    call<ExportResult>("export_to_obsidian", { vaultPath }),

  simulateCopyKeystroke: () =>
    call<void>("simulate_copy_keystroke"),

  transcribeVoiceAudio: (audioBase64: string, extension: string) =>
    call<VoiceTranscribeData>("transcribe_voice_audio", {
      audioBase64,
      extension,
    }),

  speakTts: (text: string) => call<SpeakTtsData>("speak_tts", { text }),

  speakJudge: (
    scenario: string,
    userTranscript: string,
    history: SpeakHistoryTurn[],
  ) =>
    call<SpeakCritique>("speak_judge", {
      scenario,
      userTranscript,
      history,
    }),
};

export type VoiceTranscribeData = {
  segments: Segment[];
  duration_ms: number;
};

// Speak module: synthesized prompt audio (absolute path + duration). The
// path is already resolved on the Rust side, so the frontend can pass it
// straight to tauriFileUrl() for an HTMLAudioElement.
export type SpeakTtsData = {
  audio_path: string;
  duration_ms: number;
};

// Speak module: one prior turn in a go-deeper conversation. The current
// turn travels separately as the `userTranscript` arg.
export type SpeakHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

// Speak module: structured critique. Bullet lists may be empty.
export type SpeakCritique = {
  score_overall: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  follow_up_question: string;
};

// Returned by get_clip — includes the full segments list (with words) plus
// the segment-row IDs from SQLite, so the UI can map index ↔ segment_id.
export type ClipPayload = {
  clip: ClipRow;
  segments: (SegmentRow & { words: { word: string; start: number; end: number; score: number }[] })[];
};
