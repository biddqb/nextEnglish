"""Ingest tests, focused on the 15-min cap regression (eng A5A).

The cap test is REGRESSION-PROOF per the eng review's iron rule. If A5A's
behavior breaks, this test catches it before the user pastes a 2-hour
podcast and waits 30 minutes for nothing."""
from __future__ import annotations
from pathlib import Path

import pytest

from sidecar.pipeline.ingest import (
    ingest_file, is_valid_url, IngestError, MAX_DURATION_S,
)


class TestUrlValidation:
    def test_valid_https(self):
        assert is_valid_url("https://youtube.com/watch?v=abc")

    def test_valid_http(self):
        assert is_valid_url("http://example.com/audio.mp3")

    def test_invalid_no_scheme(self):
        assert not is_valid_url("youtube.com/watch?v=abc")

    def test_invalid_local_path(self):
        assert not is_valid_url("/Users/me/audio.mp3")

    def test_invalid_empty(self):
        assert not is_valid_url("")


class TestFileIngest:
    def test_short_file_succeeds(self, short_3s: Path, tmp_path: Path):
        out = ingest_file(short_3s, tmp_path)
        assert out.exists()
        assert out.suffix == ".wav"

    def test_missing_file_raises(self, tmp_path: Path):
        with pytest.raises(IngestError) as exc:
            ingest_file(tmp_path / "nonexistent.wav", tmp_path)
        assert exc.value.code == "INVALID_URL"


class TestDurationCapRegression:
    """Eng A5A iron rule: 15-min cap. Violation must produce CLIP_TOO_LONG."""

    def test_over_cap_clip_rejected(self, over_cap_clip: Path, tmp_path: Path):
        with pytest.raises(IngestError) as exc:
            ingest_file(over_cap_clip, tmp_path)
        assert exc.value.code == "CLIP_TOO_LONG"
        assert "900" in exc.value.message or "15" in exc.value.message

    def test_at_cap_clip_passes(self, short_3s: Path, tmp_path: Path):
        out = ingest_file(short_3s, tmp_path, max_duration_s=MAX_DURATION_S)
        assert out.exists()

    def test_custom_cap(self, short_3s: Path, tmp_path: Path):
        with pytest.raises(IngestError) as exc:
            ingest_file(short_3s, tmp_path, max_duration_s=1)
        assert exc.value.code == "CLIP_TOO_LONG"
