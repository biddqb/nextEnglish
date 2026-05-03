"""Score an attempt against a reference clip — the highest-leverage file in v1.

Per the eng review: "If the score doesn't rank your recordings sensibly, no
amount of Tauri polish will save the product. Calibrate the score formula
against your own ear before you scale features around it."

Score components (overall = weighted sum, mapped 0-100):
  0.5 * word_accuracy   — word-level Levenshtein-like (presence-based for v1)
  0.4 * cadence         — DTW similarity over RMS energy contours, after VAD trim (A7)
  0.1 * pitch_corr      — Pearson correlation of z-normalized f0 contours (A8);
                          drops to 0 contribution if too few voiced frames

The mispronunciation flag set is "reference words NOT heard in the attempt".
The design renders these as a hairline underline (no color) per design 3A —
informational, not punitive."""
from __future__ import annotations
import re
import string
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from .analyze import (
    load_audio, trim_silence, extract_rms,
    extract_pitch, z_normalize_voiced,
)
from .models import WordFlag


# Calibration history (track changes here so you can revert if a tune goes wrong):
#   v0: 0.50 / 0.40 / 0.10 — initial guess. Felt generous in first session: a
#       monotone but word-accurate attempt scored 85, which under-rewarded the
#       prosody match that IS the point of shadowing.
#   v1: 0.40 / 0.35 / 0.25 — current. Pitch becomes a real component. Same
#       monotone attempt now scores ~71. Excellent (95/95/0.85) → 92.
W_WORD = 0.40
W_CADENCE = 0.35
W_PITCH = 0.25
MIN_VOICED_FRAMES_FOR_PITCH = 30
MIN_TRIMMED_S = 0.3


@dataclass
class ScoreResult:
    overall: int
    word_accuracy: float
    cadence: float
    pitch_corr: Optional[float]
    word_flags: list[WordFlag]
    user_transcript: str


def _normalize_word(w: str) -> str:
    return w.lower().strip().translate(str.maketrans("", "", string.punctuation))


def tokenize(text: str) -> list[str]:
    return [t for t in (_normalize_word(w) for w in re.findall(r"\S+", text)) if t]


def word_accuracy(ref_text: str, user_text: str) -> tuple[float, list[WordFlag]]:
    """For each reference word: did the user say it (case- and punctuation-
    insensitive, presence-based)? v1.1 upgrade path: replace with edit-distance
    over the word sequences for ordering-aware scoring."""
    ref_words = tokenize(ref_text)
    if not ref_words:
        return 0.0, []
    user_set = set(tokenize(user_text))
    flags = [WordFlag(word=w, matched=(w in user_set)) for w in ref_words]
    matched = sum(1 for f in flags if f.matched)
    return matched / len(ref_words), flags


def cadence_score(ref_audio_path: Path, user_audio_path: Path) -> float:
    """DTW similarity over RMS energy contours, with VAD trim per A7."""
    import librosa

    ref_y, sr = load_audio(ref_audio_path)
    user_y, _ = load_audio(user_audio_path)

    ref_y = trim_silence(ref_y, sr)
    user_y = trim_silence(user_y, sr)

    # Either clip had no detectable speech — cadence is meaningless.
    if ref_y is None or user_y is None:
        return 0.0
    if len(ref_y) < sr * MIN_TRIMMED_S or len(user_y) < sr * MIN_TRIMMED_S:
        return 0.0

    ref_rms = extract_rms(ref_y)
    user_rms = extract_rms(user_y)

    def _norm(x: np.ndarray) -> np.ndarray:
        rng = x.max() - x.min()
        return (x - x.min()) / rng if rng > 0 else np.zeros_like(x)

    ref_n = _norm(ref_rms)
    user_n = _norm(user_rms)

    D, _ = librosa.sequence.dtw(X=ref_n[None, :], Y=user_n[None, :], metric="euclidean")
    cost = float(D[-1, -1]) / max(len(ref_n), len(user_n))
    similarity = max(0.0, 1.0 - cost)
    return float(min(1.0, similarity))


def pitch_correlation(ref_audio_path: Path, user_audio_path: Path) -> Optional[float]:
    """A8 fix: z-normalize each f0 contour on voiced frames before correlation.
    Returns None if either clip has too few voiced frames or zero pitch variance."""
    ref_f0, ref_voiced = extract_pitch(ref_audio_path)
    user_f0, user_voiced = extract_pitch(user_audio_path)

    if int(ref_voiced.sum()) < MIN_VOICED_FRAMES_FOR_PITCH:
        return None
    if int(user_voiced.sum()) < MIN_VOICED_FRAMES_FOR_PITCH:
        return None

    ref_z = z_normalize_voiced(ref_f0, ref_voiced)
    user_z = z_normalize_voiced(user_f0, user_voiced)
    if ref_z is None or user_z is None:
        return None

    common_len = min(len(ref_z), len(user_z))
    if common_len < MIN_VOICED_FRAMES_FOR_PITCH:
        return None

    ref_resampled = np.interp(
        np.linspace(0, len(ref_z) - 1, common_len),
        np.arange(len(ref_z)),
        ref_z,
    )
    user_resampled = np.interp(
        np.linspace(0, len(user_z) - 1, common_len),
        np.arange(len(user_z)),
        user_z,
    )
    if ref_resampled.std() == 0 or user_resampled.std() == 0:
        return None

    corr = float(np.corrcoef(ref_resampled, user_resampled)[0, 1])
    return None if np.isnan(corr) else corr


def score_attempt(
    ref_audio_path: Path,
    ref_text: str,
    user_audio_path: Path,
    user_transcript: str,
) -> ScoreResult:
    """Compose the three components into a 0-100 overall score."""
    word_acc, flags = word_accuracy(ref_text, user_transcript)
    cad = cadence_score(ref_audio_path, user_audio_path)
    pitch = pitch_correlation(ref_audio_path, user_audio_path)

    pitch_term = pitch if pitch is not None else 0.0
    raw = W_WORD * word_acc + W_CADENCE * cad + W_PITCH * pitch_term
    overall = max(0, min(100, int(round(raw * 100))))

    return ScoreResult(
        overall=overall,
        word_accuracy=word_acc,
        cadence=cad,
        pitch_corr=pitch,
        word_flags=flags,
        user_transcript=user_transcript,
    )
