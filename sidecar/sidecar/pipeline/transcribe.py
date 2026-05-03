"""Word-level transcription via faster-whisper.

v1 uses faster-whisper alone with built-in `word_timestamps=True` (~150ms accuracy).
v1.1 upgrade path: add WhisperX with wav2vec2 forced alignment (~30ms accuracy)
when mispronunciation flagging needs to be tighter. v1's score-card UX renders
flagged words as a hairline underline (no color) per the design review (3A),
so coarser word boundaries don't read as "the app is wrong"."""
from __future__ import annotations
from pathlib import Path
from typing import Optional

from loguru import logger

from .models import Segment, WordTimestamp


_model: Optional[object] = None
_loaded_name: Optional[str] = None


def _load_model(model_name: str = "small.en"):
    """Lazy-loaded module-level cache. Per eng review P1A — first call pays
    the import + model-load cost, subsequent calls are instant."""
    global _model, _loaded_name
    if _model is None or _loaded_name != model_name:
        from faster_whisper import WhisperModel
        logger.info(f"Loading faster-whisper model: {model_name}")
        _model = WhisperModel(model_name, device="cpu", compute_type="int8")
        _loaded_name = model_name
    return _model


def transcribe(audio_path: Path, model_name: str = "small.en") -> list[Segment]:
    """Transcribe audio. Returns sentence-level segments with word-level timestamps."""
    model = _load_model(model_name)
    segments_iter, _info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )

    out: list[Segment] = []
    for seg in segments_iter:
        words: list[WordTimestamp] = []
        if seg.words:
            for w in seg.words:
                words.append(WordTimestamp(
                    word=w.word.strip(),
                    start=float(w.start),
                    end=float(w.end),
                    score=float(w.probability) if w.probability is not None else 1.0,
                ))
        out.append(Segment(
            start_ms=int(seg.start * 1000),
            end_ms=int(seg.end * 1000),
            text=seg.text.strip(),
            words=words,
        ))
    return out
