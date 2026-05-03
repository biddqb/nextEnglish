"""Offline TTS via Piper. The whole app is offline-first per
memory/project_offline_first.md, so we deliberately avoid cloud TTS
endpoints. Piper runs entirely on-device using ONNX voices.

First call downloads a default voice (~63MB) from HuggingFace's
`rhasspy/piper-voices` repo into `~/.cache/nextenglish/piper/`. After that
the network is never touched. Subsequent calls reuse the cached PiperVoice
instance (lazy module-level cache, eng review P1A pattern)."""
from __future__ import annotations
import urllib.request
import wave
from pathlib import Path
from typing import Optional

from loguru import logger


# Default voice. amy-medium is a popular en_US neural voice with good
# clarity for shadowing reference. Switching the default later is a
# settings concern.
VOICE_NAME = "en_US-amy-medium"
VOICE_BASE_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main"
    "/en/en_US/amy/medium"
)

_voice = None


def _voice_dir() -> Path:
    return Path.home() / ".cache" / "nextenglish" / "piper"


def _download_voice() -> tuple[Path, Path]:
    """Ensure the ONNX model + JSON config are present. Returns their paths.
    Idempotent: skips the download if files already exist on disk."""
    voice_dir = _voice_dir()
    voice_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = voice_dir / f"{VOICE_NAME}.onnx"
    json_path = voice_dir / f"{VOICE_NAME}.onnx.json"

    for filename, dest in [
        (f"{VOICE_NAME}.onnx", onnx_path),
        (f"{VOICE_NAME}.onnx.json", json_path),
    ]:
        if dest.exists():
            continue
        url = f"{VOICE_BASE_URL}/{filename}"
        logger.info(f"Downloading Piper voice file: {url}")
        # urllib raises URLError if offline. The caller surfaces this as a
        # TTS_FAILED error. After the first successful download the app
        # truly never touches the network for TTS.
        urllib.request.urlretrieve(url, dest)
        logger.info(f"Saved {dest} ({dest.stat().st_size} bytes)")

    return onnx_path, json_path


def _get_voice():
    """Lazy-load and cache the PiperVoice. The first call also pays the
    voice download (~63MB) if it hasn't happened yet."""
    global _voice
    if _voice is None:
        from piper import PiperVoice
        onnx_path, _json_path = _download_voice()
        logger.info(f"Loading Piper voice: {onnx_path}")
        _voice = PiperVoice.load(str(onnx_path))
    return _voice


def synthesize(text: str, out_path: Path, ref_sample_rate: Optional[int] = 16000) -> None:
    """Render `text` to a WAV at `out_path`. Piper voices have their own
    native sample rate (amy-medium = 22050Hz); we let Piper write its
    native rate first, then downstream `normalize_audio` resamples to
    16k mono so the file matches the rest of the app's audio
    expectations.

    `ref_sample_rate` is informational only — actual normalization happens
    in the caller via the existing ingest pipeline helper, keeping a
    single ffmpeg-based normalize path."""
    text = text.strip()
    if not text:
        raise ValueError("synthesize: empty text")

    voice = _get_voice()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    logger.info(f"Piper synthesized {len(text)} chars -> {out_path}")
