"""Pydantic models. Mirrored shapes are documented in src-tauri/src/models.rs.
Per eng review C1: integration test asserts a real Python response deserializes
into the Rust type. If types drift, that test breaks."""
from __future__ import annotations
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ErrorCode(str, Enum):
    INVALID_URL = "INVALID_URL"
    DOWNLOAD_FAILED = "DOWNLOAD_FAILED"
    CLIP_TOO_LONG = "CLIP_TOO_LONG"
    NO_SPEECH_DETECTED = "NO_SPEECH_DETECTED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    SCORE_FAILED = "SCORE_FAILED"
    INTERNAL = "INTERNAL"


class ErrorEnvelope(BaseModel):
    code: ErrorCode
    message: str
    retryable: bool = False


class ApiError(BaseModel):
    """Failure response envelope. Per eng review A4."""
    ok: Literal[False] = False
    error: ErrorEnvelope


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float
    score: float = 1.0


class Segment(BaseModel):
    start_ms: int
    end_ms: int
    text: str
    words: list[WordTimestamp] = Field(default_factory=list)


class Clip(BaseModel):
    title: str
    source_uri: str
    audio_path: str
    duration_ms: int
    segments: list[Segment]


class TrimRange(BaseModel):
    start_s: float = 0.0
    end_s: float


class IngestRequest(BaseModel):
    source_uri: str
    kind: Literal["url", "file"]
    max_duration_s: int = 900
    # When present, bypass the duration cap and download/extract only the
    # requested [start_s, end_s] window. Used by the trim dialog after a
    # CLIP_TOO_LONG error on the first ingest attempt.
    trim: Optional[TrimRange] = None
    # Override the default Whisper model. The sidecar lazy-loads on first use
    # and caches per-name, so switching models incurs a one-time load cost.
    model_name: Optional[str] = None


class IngestResponse(BaseModel):
    ok: Literal[True] = True
    clip: Clip


class WordFlag(BaseModel):
    word: str
    matched: bool


class ScoreRequest(BaseModel):
    ref_audio_path: str
    ref_text: str
    user_audio_path: str


class ScoreData(BaseModel):
    overall: int
    word_accuracy: float
    cadence: float
    pitch_corr: Optional[float]
    word_flags: list[WordFlag]
    user_transcript: str


class ScoreResponse(BaseModel):
    ok: Literal[True] = True
    score: ScoreData


class PitchContour(BaseModel):
    """Per-frame z-normalized pitch + voiced mask. Frames are 10ms (100 Hz).
    Unvoiced frames carry f0_z=0 with voiced=False; z-normalization happens
    on voiced frames only (eng A8) so different speakers' pitch ranges
    don't dominate the visual."""
    f0_z: list[float]
    voiced: list[bool]
    sr_hz: float = 100.0


class PitchRequest(BaseModel):
    ref_audio_path: str
    user_audio_path: str


class PitchResponse(BaseModel):
    ok: Literal[True] = True
    ref: PitchContour
    user: PitchContour


class TtsRequest(BaseModel):
    text: str
    # Two-letter language tag passed to gTTS (en, es, fr, ...). Default
    # English; the app's wedge is English shadowing.
    lang: str = "en"


class TtsResponse(BaseModel):
    ok: Literal[True] = True
    audio_path: str
    duration_ms: int


class VoiceTranscribeRequest(BaseModel):
    """Voice module: transcribe a standalone recording (no reference text).
    Used by the Voice studio's filler / pacing / minimal-pair sub-modes."""
    audio_path: str
    model_name: Optional[str] = None


class VoiceTranscribeResponse(BaseModel):
    ok: Literal[True] = True
    # Sentence-level segments with word-level timestamps; matches the same
    # Segment shape Whisper returns for /ingest, just without clip wrapper.
    segments: list[Segment]
    # Total audio duration (ms) — useful for WPM calculations even when the
    # last word's `end` doesn't reach the end of the recording.
    duration_ms: int
