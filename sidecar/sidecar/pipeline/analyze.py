"""Audio analysis: pitch (parselmouth/Praat), RMS energy (librosa), VAD (silero-vad).

Implements the eng review fixes:
  A7 — silero-vad trim before DTW (avoids leading/trailing silence skewing cadence)
  A8 — z-normalize f0 contours before pitch correlation (different speakers' pitch
       ranges otherwise produce mathematically valid but pedagogically meaningless
       correlation values)"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

import numpy as np

_vad_model = None


def _load_vad_model():
    global _vad_model
    if _vad_model is None:
        from silero_vad import load_silero_vad
        _vad_model = load_silero_vad()
    return _vad_model


def load_audio(path: Path, target_sr: int = 16000) -> tuple[np.ndarray, int]:
    """Load mono float32 at target_sr."""
    import librosa
    y, sr = librosa.load(str(path), sr=target_sr, mono=True)
    return y, sr


def trim_silence(y: np.ndarray, sr: int = 16000) -> Optional[np.ndarray]:
    """A7: Trim leading + trailing silence using silero-vad. Mid-clip silence
    is preserved (important for measuring how the speaker uses pauses).

    Returns None if no speech is detected at all — the caller must handle
    this (e.g. cadence_score returns 0.0). Returning the silent original
    would let DTW emit nonsense similarity scores against floor noise."""
    from silero_vad import get_speech_timestamps
    import torch

    model = _load_vad_model()
    audio_tensor = torch.from_numpy(y).float()

    speech_ts = get_speech_timestamps(
        audio_tensor, model, sampling_rate=sr, return_seconds=False,
    )
    if not speech_ts:
        return None

    start = speech_ts[0]["start"]
    end = speech_ts[-1]["end"]
    return y[start:end]


def extract_rms(y: np.ndarray, hop_length: int = 160) -> np.ndarray:
    """RMS energy at 10ms hops (16k sr / 160 = 100Hz frame rate)."""
    import librosa
    return librosa.feature.rms(y=y, frame_length=hop_length * 4, hop_length=hop_length)[0]


def extract_pitch(audio_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Returns (f0_hz, voiced_mask). Unvoiced frames have f0=0."""
    import parselmouth
    snd = parselmouth.Sound(str(audio_path))
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=600)
    f0 = pitch.selected_array["frequency"]
    voiced_mask = f0 > 0
    return np.asarray(f0, dtype=np.float64), np.asarray(voiced_mask, dtype=bool)


def z_normalize_voiced(f0: np.ndarray, voiced_mask: np.ndarray) -> Optional[np.ndarray]:
    """A8: Z-normalize on voiced frames only. Returns None if too few voiced
    frames or zero variance (constant pitch — happens for pure tones, whispers)."""
    voiced = f0[voiced_mask]
    if len(voiced) < 10:
        return None
    mean = float(voiced.mean())
    std = float(voiced.std())
    if std == 0:
        return None
    out = np.zeros_like(f0)
    out[voiced_mask] = (voiced - mean) / std
    return out
