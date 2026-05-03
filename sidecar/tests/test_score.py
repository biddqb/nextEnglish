"""Tests for the score module — the highest-leverage tests in v1.

The golden-fixture ranking test is intentionally skipped until the owner
records labeled attempts. Once those exist in tests/fixtures/golden_set/
along with labels.json, this becomes the regression test that catches
weight-tuning mistakes."""
from __future__ import annotations
from pathlib import Path

import pytest

from sidecar.pipeline.score import (
    word_accuracy, cadence_score, pitch_correlation, score_attempt,
    tokenize, _normalize_word,
)
from sidecar.pipeline.models import WordFlag


class TestWordTokenization:
    def test_normalize_strips_punctuation(self):
        assert _normalize_word("Hello,") == "hello"
        assert _normalize_word("don't") == "dont"
        assert _normalize_word("CONSENSUS") == "consensus"

    def test_tokenize_empty(self):
        assert tokenize("") == []
        assert tokenize("   ") == []

    def test_tokenize_basic(self):
        assert tokenize("Let's reach a consensus.") == ["lets", "reach", "a", "consensus"]


class TestWordAccuracy:
    def test_perfect_match(self):
        acc, flags = word_accuracy("let's reach a consensus", "let's reach a consensus")
        assert acc == 1.0
        assert all(f.matched for f in flags)

    def test_all_missed(self):
        acc, flags = word_accuracy("the quick brown fox", "completely unrelated text")
        assert acc == 0.0
        assert not any(f.matched for f in flags)

    def test_partial(self):
        acc, _ = word_accuracy("let's reach a consensus", "let's reach")
        assert acc == pytest.approx(0.5)

    def test_case_and_punctuation_insensitive(self):
        acc, _ = word_accuracy("Let's reach a CONSENSUS!", "lets, REACH a consensus")
        assert acc == 1.0

    def test_empty_ref(self):
        acc, flags = word_accuracy("", "anything")
        assert acc == 0.0
        assert flags == []

    def test_flags_correct(self):
        acc, flags = word_accuracy("alpha bravo charlie", "alpha charlie")
        assert acc == pytest.approx(2 / 3)
        assert flags[0] == WordFlag(word="alpha", matched=True)
        assert flags[1] == WordFlag(word="bravo", matched=False)
        assert flags[2] == WordFlag(word="charlie", matched=True)


class TestCadenceScore:
    def test_identical_audio_high_score(self, speech_sample: Path):
        """Identical real speech → cadence ~ 1.0. Silero-vad is trained on
        speech and ignores pure tones, so we need a real speech fixture here."""
        score = cadence_score(speech_sample, speech_sample)
        assert score > 0.9

    def test_silent_attempt_returns_zero(self, speech_sample: Path, silent_5s: Path):
        """User said nothing → cadence is meaningless → return 0 explicitly
        (not a wandering DTW score over floor noise)."""
        score = cadence_score(speech_sample, silent_5s)
        assert score == 0.0

    def test_silent_reference_returns_zero(self, silent_5s: Path, speech_sample: Path):
        """Symmetric: if the reference itself has no speech, cadence is 0."""
        score = cadence_score(silent_5s, speech_sample)
        assert score == 0.0


class TestPitchCorrelation:
    def test_identical_pitch_high_correlation(self, tone_5s: Path):
        """Identical audio — parselmouth's f0 tracking has small numerical jitter
        even on a pure tone, so the contour has non-zero std; correlation should
        come out essentially 1.0 because the jitter pattern is identical."""
        corr = pitch_correlation(tone_5s, tone_5s)
        assert corr is not None
        assert corr > 0.95

    def test_a8_different_pitch_low_correlation(self, tone_5s: Path, tone_5s_lower: Path):
        """A8 verification: 440Hz vs 220Hz, both nominally constant. Without z-norm,
        a naive correlation could be misled by the absolute pitch difference. After
        z-normalization on voiced frames, the inputs become unrelated jitter
        patterns and correlation lands near zero — which is the correct answer."""
        corr = pitch_correlation(tone_5s, tone_5s_lower)
        assert corr is not None
        assert abs(corr) < 0.5  # near zero; not artificially high

    def test_silence_returns_none(self, silent_5s: Path, tone_5s: Path):
        """Silence has no voiced frames at all — function returns None to signal
        'pitch is not measurable here', and score_attempt drops the pitch term
        from the weighted sum rather than emitting garbage."""
        corr = pitch_correlation(silent_5s, tone_5s)
        assert corr is None


class TestScoreFormula:
    def test_score_bounds_perfect(self, speech_sample: Path):
        """Identical real-speech clip + identical transcript → max score.
        word_accuracy=1.0, cadence~1.0, pitch_corr~1.0. raw = 1.0 → ~100."""
        result = score_attempt(speech_sample, "test text", speech_sample, "test text")
        assert 95 <= result.overall <= 100

    def test_score_garbage(self, speech_sample: Path, silent_5s: Path):
        """Wrong transcript + silent attempt → near-zero score."""
        result = score_attempt(speech_sample, "important reference text", silent_5s, "")
        assert 0 <= result.overall <= 20

    def test_score_always_in_range(self, speech_sample: Path, silent_5s: Path, tone_5s: Path):
        """Score is always 0-100 regardless of weird inputs (pure tones,
        silence, mismatched audio types)."""
        combos = [
            (speech_sample, speech_sample),
            (speech_sample, silent_5s),
            (silent_5s, silent_5s),
            (tone_5s, speech_sample),
            (tone_5s, silent_5s),
        ]
        for ref, user in combos:
            result = score_attempt(ref, "ref", user, "user")
            assert 0 <= result.overall <= 100

    def test_pitch_none_doesnt_crash(self, silent_5s: Path):
        result = score_attempt(silent_5s, "ref", silent_5s, "ref")
        assert result.pitch_corr is None
        assert result.overall is not None


class TestGoldenFixtureRanking:
    """The most important test in the suite, deferred until real recordings exist.

    To activate: drop labeled WAVs into tests/fixtures/golden_set/ along with a
    labels.json mapping {filename: expected_rank} where 0=best, 4=worst. This
    test then asserts score_attempt preserves that ranking. When you tweak the
    W_WORD/W_CADENCE/W_PITCH weights in score.py, this test catches regressions."""

    @pytest.mark.skip(reason="Awaiting real golden-set recordings from owner")
    def test_golden_set_ranks_correctly(self):
        pass
