"""Ingest pipeline: source_uri -> normalized 16k mono WAV.

URL path uses yt-dlp + ffmpeg. File path uses ffmpeg directly. Duration
cap (eng A5A) is enforced before any heavy work. Resampling to 16kHz mono
happens server-side per eng A1A."""
from __future__ import annotations
import subprocess
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from loguru import logger


TARGET_SR = 16000
MAX_DURATION_S = 900  # 15 min hard cap (eng A5A)


class IngestError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)


def is_valid_url(s: str) -> bool:
    try:
        p = urlparse(s)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False


def get_duration_s(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise IngestError("INTERNAL", f"ffprobe failed: {result.stderr.strip()[:200]}")
    try:
        return float(result.stdout.strip())
    except ValueError:
        raise IngestError("INTERNAL", "ffprobe returned non-numeric duration")


def ensure_wav(audio_path: Path) -> Path:
    """If `audio_path` already ends in .wav, return it unchanged. Otherwise
    convert to a sibling `.wav` (cached when the source hasn't changed) and
    return its path.

    Why: parselmouth (Praat) reads only native audio formats — WAV, FLAC,
    AIFF. MediaRecorder produces WebM/Opus; Voice Recorder produces M4A.
    Both fail Praat's reader. faster-whisper happens to read everything via
    ffmpeg internally, but the score module also calls parselmouth, so we
    normalize once at the boundary."""
    if audio_path.suffix.lower() == ".wav":
        return audio_path
    out = audio_path.with_suffix(".wav")
    src_mtime = audio_path.stat().st_mtime
    if not out.exists() or out.stat().st_mtime < src_mtime:
        normalize_audio(audio_path, out)
    return out


def normalize_audio(input_path: Path, output_path: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(input_path),
        "-ar", str(TARGET_SR), "-ac", "1",
        "-acodec", "pcm_s16le",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise IngestError(
            "INTERNAL",
            f"ffmpeg normalize failed: {result.stderr.strip()[:300]}",
        )


def probe_url(url: str) -> dict:
    """Probe a URL for metadata (duration, title) without downloading.
    Used by the trim dialog so the UI can show the total duration before
    asking the user to pick a 15-minute window."""
    if not is_valid_url(url):
        raise IngestError("INVALID_URL", f"Not a valid URL: {url}")

    import yt_dlp
    probe_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise _classify_yt_error(e)

    return {
        "duration_s": float(info.get("duration") or 0),
        "title": info.get("title") or url,
    }


def ingest_url(
    url: str,
    output_dir: Path,
    max_duration_s: int = MAX_DURATION_S,
    trim_start_s: Optional[float] = None,
    trim_end_s: Optional[float] = None,
) -> Path:
    """Download audio, normalize to 16k mono. Returns output WAV path.

    If `trim_start_s`/`trim_end_s` are provided, the duration cap is enforced
    against the trimmed window (not the source clip), and yt-dlp is told to
    download only that range via `download_ranges`. Used by the trim-dialog
    flow after the first ingest attempt failed with CLIP_TOO_LONG."""
    if not is_valid_url(url):
        raise IngestError("INVALID_URL", f"Not a valid URL: {url}")

    import yt_dlp

    output_dir.mkdir(parents=True, exist_ok=True)
    raw_template = str(output_dir / "raw.%(ext)s")

    # Probe first so we can reject over-cap clips before downloading.
    probe_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise _classify_yt_error(e)

    duration = info.get("duration") or 0
    trimming = trim_start_s is not None and trim_end_s is not None

    if trimming:
        if trim_end_s <= trim_start_s:
            raise IngestError("INVALID_URL", "Trim end must be after start.")
        trim_len = trim_end_s - trim_start_s
        if trim_len > max_duration_s:
            raise IngestError(
                "CLIP_TOO_LONG",
                f"Trim window is {int(trim_len)}s, max is {max_duration_s}s.",
            )
        if duration and trim_end_s > duration:
            raise IngestError(
                "INVALID_URL",
                f"Trim end {int(trim_end_s)}s exceeds clip duration {int(duration)}s.",
            )
    else:
        if duration and duration > max_duration_s:
            raise IngestError(
                "CLIP_TOO_LONG",
                f"Clip is {int(duration)}s, max is {max_duration_s}s. Trim before ingesting.",
            )

    download_opts = {
        "format": "bestaudio/best",
        "outtmpl": raw_template,
        "quiet": True,
        "no_warnings": True,
    }
    if trimming:
        # yt-dlp accepts a list of [start, end] sections via this hook.
        download_opts["download_ranges"] = (
            lambda _info, _ydl: [{"start_time": trim_start_s, "end_time": trim_end_s}]
        )
        download_opts["force_keyframes_at_cuts"] = True

    try:
        with yt_dlp.YoutubeDL(download_opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as e:
        raise _classify_yt_error(e)

    raw_files = list(output_dir.glob("raw.*"))
    if not raw_files:
        raise IngestError("DOWNLOAD_FAILED", "yt-dlp produced no output file", retryable=True)
    raw = raw_files[0]

    output_path = output_dir / "audio.wav"
    normalize_audio(raw, output_path)
    raw.unlink(missing_ok=True)
    if trimming:
        logger.info(
            f"Ingested URL [{trim_start_s:.1f}-{trim_end_s:.1f}] -> {output_path}"
        )
    else:
        logger.info(f"Ingested URL -> {output_path} ({duration:.0f}s)")
    return output_path


def _classify_yt_error(e: Exception) -> IngestError:
    msg = str(e)
    low = msg.lower()
    if "404" in msg or "not found" in low:
        return IngestError("DOWNLOAD_FAILED", "URL returned 404. Try a different URL.")
    if "sign in" in low or "age" in low and "restrict" in low:
        return IngestError("DOWNLOAD_FAILED", "URL requires sign-in or age verification.")
    if "geographic" in low or "region" in low:
        return IngestError("DOWNLOAD_FAILED", "URL is geo-restricted in your region.")
    return IngestError("DOWNLOAD_FAILED", f"Download failed: {msg[:200]}", retryable=True)


def ingest_file(file_path: Path, output_dir: Path, max_duration_s: int = MAX_DURATION_S) -> Path:
    """Take a local file, normalize to 16k mono. Returns output WAV path."""
    if not file_path.exists():
        raise IngestError("INVALID_URL", f"File not found: {file_path}")

    duration = get_duration_s(file_path)
    if duration > max_duration_s:
        raise IngestError(
            "CLIP_TOO_LONG",
            f"Clip is {int(duration)}s, max is {max_duration_s}s. Trim before ingesting.",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "audio.wav"
    normalize_audio(file_path, output_path)
    logger.info(f"Ingested file {file_path} -> {output_path} ({duration:.0f}s)")
    return output_path
