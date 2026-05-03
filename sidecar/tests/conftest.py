"""Synthetic audio fixtures, generated with ffmpeg on first run.

Fixtures are NOT committed to git (see .gitignore). They live under
tests/fixtures/ and are regenerated as needed."""
from __future__ import annotations
import subprocess
from pathlib import Path

import pytest


FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True, capture_output=True)


def _make_silent_clip(out: Path, duration: float) -> None:
    _ffmpeg([
        "-f", "lavfi", "-i", f"anullsrc=r=16000:cl=mono",
        "-t", str(duration), "-acodec", "pcm_s16le", str(out),
    ])


def _make_tone_clip(out: Path, duration: float, frequency: int = 440) -> None:
    _ffmpeg([
        "-f", "lavfi",
        "-i", f"sine=frequency={frequency}:sample_rate=16000:duration={duration}",
        "-ac", "1", "-acodec", "pcm_s16le", str(out),
    ])


def _make_swept_tone(out: Path, duration: float, freq_start: int = 200, freq_end: int = 600) -> None:
    """Frequency-swept sine — gives a non-constant pitch contour for correlation tests."""
    _ffmpeg([
        "-f", "lavfi",
        "-i",
        f"sine=frequency={freq_start}:sample_rate=16000:duration={duration},"
        f"asetpts=PTS-STARTPTS,"
        f"afade=t=in:d=0.1,afade=t=out:st={duration - 0.1}:d=0.1",
        "-ac", "1", "-acodec", "pcm_s16le", str(out),
    ])


@pytest.fixture(scope="session")
def fixture_dir() -> Path:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    return FIXTURE_DIR


@pytest.fixture(scope="session")
def silent_5s(fixture_dir: Path) -> Path:
    p = fixture_dir / "silent_5s.wav"
    if not p.exists():
        _make_silent_clip(p, 5)
    return p


@pytest.fixture(scope="session")
def short_3s(fixture_dir: Path) -> Path:
    p = fixture_dir / "short_3s.wav"
    if not p.exists():
        _make_tone_clip(p, 3, 440)
    return p


@pytest.fixture(scope="session")
def over_cap_clip(fixture_dir: Path) -> Path:
    """16-min silent clip — exceeds the 15-min cap from eng A5A.
    Slow to generate the first time (~5s)."""
    p = fixture_dir / "over_cap_16min.wav"
    if not p.exists():
        _make_silent_clip(p, 16 * 60 + 5)
    return p


@pytest.fixture(scope="session")
def tone_5s(fixture_dir: Path) -> Path:
    p = fixture_dir / "tone_5s.wav"
    if not p.exists():
        _make_tone_clip(p, 5, 440)
    return p


@pytest.fixture(scope="session")
def tone_5s_lower(fixture_dir: Path) -> Path:
    p = fixture_dir / "tone_5s_lower.wav"
    if not p.exists():
        _make_tone_clip(p, 5, 220)
    return p


@pytest.fixture(scope="session")
def speech_sample(fixture_dir: Path) -> Path:
    """Real human speech from LibriSpeech (via librosa). silero-vad is trained
    on speech and rejects pure tones, so cadence + end-to-end score tests need
    actual speech to exercise the VAD-trim path. Cached after first download
    (~700KB).

    Skipped if no network — happens in sandboxed CI environments. Local dev
    machines with internet access will download once and cache."""
    p = fixture_dir / "speech_libri1.wav"
    if not p.exists():
        try:
            import librosa
            import soundfile as sf
            src = librosa.example("libri1")
            y, _ = librosa.load(src, sr=16000, mono=True)
            sf.write(str(p), y, 16000)
        except Exception as e:
            pytest.skip(f"Cannot fetch LibriSpeech sample (offline?): {e}")
    return p
