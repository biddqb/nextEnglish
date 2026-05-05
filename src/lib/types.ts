// Type mirror of src-tauri/src/models.rs and sidecar/sidecar/pipeline/models.py.
// Keep all three in sync; eng review C1 specifies a contract test for it.

export type WordTimestamp = {
  word: string;
  start: number;
  end: number;
  score: number;
};

export type Segment = {
  start_ms: number;
  end_ms: number;
  text: string;
  words: WordTimestamp[];
};

export type Clip = {
  title: string;
  source_uri: string;
  audio_path: string;
  duration_ms: number;
  segments: Segment[];
};

export type ClipRow = {
  id: number;
  title: string;
  source_uri: string;
  audio_path: string;
  duration_ms: number;
  created_at: string;
};

export type SegmentRow = {
  id: number;
  clip_id: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

export type WordFlag = {
  word: string;
  matched: boolean;
};

export type ScoreData = {
  overall: number;
  word_accuracy: number;
  cadence: number;
  pitch_corr: number | null;
  word_flags: WordFlag[];
  user_transcript: string;
};

export type ProbeResult = {
  duration_s: number;
  title: string;
};

export type PitchContour = {
  f0_z: number[];
  voiced: boolean[];
  sr_hz: number;
};

export type PitchContoursResponse = {
  ref: PitchContour;
  user: PitchContour;
};

export type SettingPair = {
  key: string;
  value: string;
};

export type CacheStats = {
  bytes: number;
  clip_count: number;
};

// Mirror of the user-tunable settings (see SettingsPanel). Defaults live in
// `defaultAppSettings` in lib/settings.ts. Persistence is keyed on the
// `key` string in the SQLite settings table.
export type AppSettings = {
  whisperModel: string;
  maxDurationS: number;
  autoLoopMs: number;
  obsidianVaultPath: string;
  captureHotkey: string;
  // Speak module: which LLM judges replies. Provider is one of
  // ollama / anthropic / openai. Model is provider-specific (empty
  // means the provider's default). API key is required for
  // anthropic/openai; ignored for ollama.
  speakLlmProvider: "ollama" | "anthropic" | "openai";
  speakLlmModel: string;
  speakLlmApiKey: string;
};

export type ExportResult = {
  cards_exported: number;
  audio_files_copied: number;
  vault_path: string;
};

export type CardRow = {
  id: number;
  segment_id: number;
  saved_at: string;
  due_at: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: string;
  last_review_at: string | null;
  cloze_word_indices: number[];
};

export type DueCard = {
  card: CardRow;
  clip_id: number;
  clip_title: string;
  clip_audio_path: string;
  segment_index: number;
  segment_text: string;
  segment_start_ms: number;
  segment_end_ms: number;
};

export type SegmentBest = {
  segment_index: number;
  best_overall: number;
  attempt_count: number;
};

export type AttemptRow = {
  id: number;
  session_id: number;
  attempt_audio_path: string;
  asr_transcript: string;
  score_overall: number;
  score_word_accuracy: number;
  score_cadence: number;
  score_pitch_corr: number | null;
  recorded_at: string;
};

export type CmdError = {
  code: string;
  message: string;
  retryable: boolean;
};

// In-memory app state used by the zustand store. Distinct from server data
// (clips/segments/attempts) which lives in react-query cache.
export type SessionState =
  | { kind: "idle" }
  | { kind: "playing"; segmentIndex: number }
  | { kind: "listening"; segmentIndex: number }
  | { kind: "recording"; segmentIndex: number }
  | { kind: "analyzing"; segmentIndex: number; userAudioPath: string }
  | {
      kind: "scored";
      segmentIndex: number;
      userAudioPath: string;
      score: ScoreData;
    };
