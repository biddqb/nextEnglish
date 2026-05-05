"""FastAPI sidecar service.

Started by Rust core via Tauri externalBin in production. Picks a free port,
prints `PORT=NNNN` to stdout on startup so Rust can capture and connect. All
heavy ML imports are lazy (inside handlers) per eng review P1A — this keeps
cold-start under ~1s. First /ingest call pays the ~6s one-time import cost
behind a 'preparing audio engine' UI."""
from __future__ import annotations
import hashlib
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from loguru import logger

from .log import init_logging
from .pipeline.models import (
    ApiError, ErrorEnvelope, IngestRequest, IngestResponse,
    PitchContour, PitchRequest, PitchResponse,
    ScoreRequest, ScoreResponse, ScoreData, Clip,
    SpeakCritique, SpeakJudgeRequest, SpeakJudgeResponse,
    SpeakScenario, SpeakScenariosResponse,
    TtsRequest, TtsResponse,
    VoiceTranscribeRequest, VoiceTranscribeResponse,
)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# Bumped whenever server.py changes meaningfully, so a stale sidecar is
# obvious in the terminal banner. (Tauri's dev-runner only restarts on Rust
# file changes, so a Python edit silently keeps the old process alive.)
SIDECAR_BUILD_TAG = "tts-piper-v2"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_logging()
    port = getattr(app.state, "port", None)
    if port is not None:
        # Stdout is the only contract with the Rust parent process — keep it clean.
        print(f"PORT={port}", flush=True)
    logger.info(
        f"nextenglish sidecar [{SIDECAR_BUILD_TAG}] ready on 127.0.0.1:{port}"
    )
    yield
    logger.info("nextenglish sidecar shutting down")


app = FastAPI(lifespan=lifespan)


def _err(code: str, message: str, retryable: bool = False, status: int = 500) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ApiError(error=ErrorEnvelope(code=code, message=message, retryable=retryable)).model_dump(),
    )


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/probe")
def probe(req: dict):
    """Lightweight metadata probe used by the trim dialog. No download."""
    from .pipeline.ingest import probe_url, IngestError
    url = req.get("url", "")
    try:
        info = probe_url(url)
    except IngestError as e:
        status = 400 if e.code in ("INVALID_URL", "CLIP_TOO_LONG") else 500
        return _err(e.code, e.message, e.retryable, status=status)
    return {"ok": True, "duration_s": info["duration_s"], "title": info["title"]}


@app.post("/ingest")
def ingest(req: IngestRequest):
    from .pipeline.ingest import ingest_url, ingest_file, IngestError
    from .pipeline.transcribe import transcribe

    # Cache key includes the trim window so trimming a different range from
    # the same URL gets its own dir and doesn't collide with a prior ingest.
    cache_key_input = req.source_uri
    if req.trim is not None:
        cache_key_input += f"#trim={req.trim.start_s:.3f}-{req.trim.end_s:.3f}"
    clip_key = hashlib.sha256(cache_key_input.encode("utf-8")).hexdigest()[:12]
    work_dir = Path("./_work/clips") / clip_key
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        if req.kind == "url":
            audio_path = ingest_url(
                req.source_uri,
                work_dir,
                req.max_duration_s,
                trim_start_s=req.trim.start_s if req.trim else None,
                trim_end_s=req.trim.end_s if req.trim else None,
            )
        else:
            file_path_str = req.source_uri.replace("file://", "", 1)
            audio_path = ingest_file(Path(file_path_str), work_dir, req.max_duration_s)
    except IngestError as e:
        status = 400 if e.code in ("INVALID_URL", "CLIP_TOO_LONG") else 500
        return _err(e.code, e.message, e.retryable, status=status)
    except Exception as e:
        logger.exception("Unexpected ingest error")
        return _err("INTERNAL", f"Unexpected error: {e}", status=500)

    try:
        segments = transcribe(audio_path, model_name=req.model_name or "small.en")
    except Exception as e:
        logger.exception("Transcribe failed")
        return _err("TRANSCRIPTION_FAILED", str(e)[:200], retryable=True, status=500)

    if not segments:
        return _err("NO_SPEECH_DETECTED", "No speech detected in this clip.", status=400)

    duration_ms = segments[-1].end_ms
    title = Path(req.source_uri).stem if req.kind == "file" else req.source_uri

    return IngestResponse(clip=Clip(
        title=title,
        source_uri=req.source_uri,
        audio_path=str(audio_path),
        duration_ms=duration_ms,
        segments=segments,
    ))


@app.post("/score")
def score(req: ScoreRequest):
    from .pipeline.score import score_attempt
    from .pipeline.transcribe import transcribe
    from .pipeline.ingest import ensure_wav

    ref_audio = Path(req.ref_audio_path)
    user_audio = Path(req.user_audio_path)

    if not ref_audio.exists():
        return _err("INTERNAL", f"Reference audio not found: {ref_audio}", status=400)
    if not user_audio.exists():
        return _err("INTERNAL", f"User audio not found: {user_audio}", status=400)

    # Normalize user audio to 16k mono WAV (parselmouth can't read WebM/M4A).
    # ensure_wav is a no-op if the file is already .wav.
    try:
        user_audio = ensure_wav(user_audio)
    except Exception as e:
        logger.exception("Normalize user audio failed")
        return _err("INTERNAL", f"Couldn't normalize user audio: {e}", status=500)

    try:
        user_segments = transcribe(user_audio)
        user_text = " ".join(s.text for s in user_segments)
    except Exception as e:
        logger.exception("User transcribe failed")
        return _err("TRANSCRIPTION_FAILED", str(e)[:200], retryable=True, status=500)

    try:
        result = score_attempt(ref_audio, req.ref_text, user_audio, user_text)
    except Exception as e:
        logger.exception("Score failed")
        return _err("SCORE_FAILED", str(e)[:200], retryable=True, status=500)

    return ScoreResponse(score=ScoreData(
        overall=result.overall,
        word_accuracy=result.word_accuracy,
        cadence=result.cadence,
        pitch_corr=result.pitch_corr,
        word_flags=result.word_flags,
        user_transcript=result.user_transcript,
    ))


@app.post("/pitch")
def pitch(req: PitchRequest):
    """Return per-frame z-normalized f0 contours for both reference and user
    audio. Used by the PitchOverlay 'Show details' panel for the visual A/B."""
    from .pipeline.analyze import extract_pitch, z_normalize_voiced
    from .pipeline.ingest import ensure_wav

    ref_path = Path(req.ref_audio_path)
    user_path = Path(req.user_audio_path)
    if not ref_path.exists():
        return _err("INTERNAL", f"Reference audio not found: {ref_path}", status=400)
    if not user_path.exists():
        return _err("INTERNAL", f"User audio not found: {user_path}", status=400)

    try:
        # Parselmouth needs a real WAV; user attempts often arrive as webm/m4a.
        user_path = ensure_wav(user_path)
    except Exception as e:
        logger.exception("Normalize user audio failed (pitch)")
        return _err("INTERNAL", f"Couldn't normalize user audio: {e}", status=500)

    def contour(path: Path) -> PitchContour:
        f0, voiced = extract_pitch(path)
        z = z_normalize_voiced(f0, voiced)
        if z is None:
            return PitchContour(f0_z=[], voiced=[])
        return PitchContour(
            f0_z=[float(x) for x in z],
            voiced=[bool(v) for v in voiced],
        )

    try:
        return PitchResponse(ref=contour(ref_path), user=contour(user_path))
    except Exception as e:
        logger.exception("Pitch contour failed")
        return _err("INTERNAL", f"Pitch contour failed: {e}", status=500)


@app.post("/tts")
def tts(req: TtsRequest):
    """Render `text` to a 16k-mono WAV via Piper (fully offline neural TTS).
    Cached per (text, lang) hash so the same chunk doesn't re-synthesize
    on every capture. Output goes to `_work/captures/<sha12>/audio.wav`.
    Returns the absolute path and measured duration.

    First call ever pays a one-time ~63MB voice download into
    `~/.cache/nextenglish/piper/`. Subsequent calls (and all subsequent
    app launches) are 100% offline — see memory/project_offline_first.md.
    `req.lang` is currently ignored: only en_US is wired up.

    Top-level try/except so import errors, voice-download failures, and
    Piper crashes all surface as a structured ApiError response instead
    of a bare 'Internal Server Error' string."""
    try:
        from .pipeline.ingest import normalize_audio, get_duration_s
        from .pipeline.tts import synthesize
    except Exception as e:
        logger.exception("TTS import failed")
        return _err(
            "TTS_FAILED",
            f"sidecar TTS modules failed to import: {type(e).__name__}: {e}",
            status=500,
        )

    text = req.text.strip()
    if not text:
        return _err("INTERNAL", "empty TTS text", status=400)
    if len(text) > 2000:
        return _err(
            "INTERNAL",
            f"TTS text too long ({len(text)} chars); limit 2000",
            status=400,
        )

    logger.info(f"TTS request: lang={req.lang} chars={len(text)}")

    try:
        cache_key = hashlib.sha256(f"{req.lang}::{text}".encode("utf-8")).hexdigest()[:12]
        cache_dir = Path("./_work/captures") / cache_key
        cache_dir.mkdir(parents=True, exist_ok=True)
        raw_wav = cache_dir / "raw.wav"
        out_wav = cache_dir / "audio.wav"

        if not out_wav.exists():
            try:
                synthesize(text, raw_wav)
            except Exception as e:
                logger.exception("Piper synthesize failed")
                return _err(
                    "TTS_FAILED",
                    f"{type(e).__name__}: {e}",
                    retryable=True,
                    status=500,
                )
            try:
                normalize_audio(raw_wav, out_wav)
            except Exception as e:
                logger.exception("Normalize TTS audio failed")
                return _err(
                    "INTERNAL",
                    f"normalize: {type(e).__name__}: {e}",
                    status=500,
                )
            raw_wav.unlink(missing_ok=True)

        try:
            duration_ms = int(get_duration_s(out_wav) * 1000)
        except Exception:
            duration_ms = 0

        return TtsResponse(audio_path=str(out_wav), duration_ms=duration_ms)
    except Exception as e:
        # Catchall so we never return a bare 500 to the Rust client.
        logger.exception("TTS endpoint top-level failure")
        return _err(
            "INTERNAL",
            f"unexpected {type(e).__name__}: {e}",
            status=500,
        )


@app.post("/voice/transcribe")
def voice_transcribe(req: VoiceTranscribeRequest):
    """Voice module: transcribe a standalone recording. Used by the Voice
    studio's filler-word detector, pacing analyzer, and minimal-pair drill.
    Unlike /score this has no reference text — the transcript itself + its
    word-level timestamps + the audio's total duration are all the caller
    needs (filler counts, WPM, etc are computed in the frontend).

    Normalizes WebM/M4A → WAV first since Whisper works best on PCM."""
    from .pipeline.ingest import ensure_wav, get_duration_s
    from .pipeline.transcribe import transcribe

    audio = Path(req.audio_path)
    if not audio.exists():
        return _err("INTERNAL", f"User audio not found: {audio}", status=400)

    try:
        audio = ensure_wav(audio)
    except Exception as e:
        logger.exception("Normalize voice audio failed")
        return _err(
            "INTERNAL", f"Couldn't normalize voice audio: {e}", status=500,
        )

    try:
        segments = transcribe(audio, model_name=req.model_name or "small.en")
    except Exception as e:
        logger.exception("Voice transcribe failed")
        return _err(
            "TRANSCRIPTION_FAILED", str(e)[:200], retryable=True, status=500,
        )

    try:
        duration_s = get_duration_s(audio)
    except Exception as e:
        # Non-fatal — we can still return the transcript even if duration
        # detection fails. Just zero it.
        logger.warning(f"get_duration_s failed: {e}")
        duration_s = 0.0

    return VoiceTranscribeResponse(
        segments=segments,
        duration_ms=int(duration_s * 1000),
    )


@app.post("/speak/judge")
async def speak_judge(req: SpeakJudgeRequest):
    """Speak module: send a scenario + the user's transcribed reply (and
    optional history of prior go-deeper turns) to whichever LLM the user
    selected, return a structured critique. Provider config travels with
    the request (Rust reads SQLite settings before sending).

    LLM-side errors (Ollama down, missing model, bad API key) come back
    as structured ApiError envelopes so the UI can show a real message
    instead of a generic 500."""
    from .speak.judge import run_judge
    from .speak.providers import LlmError, build_provider

    try:
        provider = build_provider(req.provider, req.model, req.api_key)
    except LlmError as e:
        return _err(e.code, e.message, e.retryable, status=400)

    try:
        critique_dict = await run_judge(
            provider,
            scenario=req.scenario,
            user_transcript=req.user_transcript,
            history=[t.model_dump() for t in req.history],
        )
    except LlmError as e:
        # Provider-side failures with a known message; surface verbatim.
        status = 502 if e.retryable else 500
        return _err(e.code, e.message, e.retryable, status=status)
    except Exception as e:
        logger.exception("speak/judge failed")
        return _err("INTERNAL", f"judge failed: {type(e).__name__}: {e}", status=500)

    return SpeakJudgeResponse(critique=SpeakCritique(**critique_dict))


@app.get("/speak/scenarios")
def speak_scenarios():
    """Speak module: return the curated scenario corpus. The frontend
    uses this to populate the picker. Stable order; new scenarios are
    appended in corpus.py (their ids are durable references)."""
    from .speak.corpus import list_scenarios
    return SpeakScenariosResponse(
        scenarios=[SpeakScenario(**s) for s in list_scenarios()],
    )


def run():
    """Entry point for `python -m sidecar.server` and the PyInstaller binary."""
    import uvicorn
    port = _find_free_port()
    app.state.port = port
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    run()
