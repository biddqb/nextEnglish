"""Smoke-test CLI for the nextenglish sidecar.

The point of this CLI is to validate that the full ingest -> transcribe ->
score pipeline works on the owner's machine BEFORE any UI exists. Per the
eng review: "the score doesn't rank your recordings sensibly? no Tauri
polish will save the product. Calibrate the score formula against your
own ear before you scale features around it."

Usage:
    python -m sidecar.cli ingest <URL-or-path>
    python -m sidecar.cli extract <audio> <segment-index>
    python -m sidecar.cli score <full-audio> <user-audio> --segment-index N
    python -m sidecar.cli serve   (run the HTTP server; used by Tauri)"""
from __future__ import annotations
import json
import subprocess
from pathlib import Path

import typer

from .log import init_logging


def _slice_audio(input_path: Path, output_path: Path, start_s: float, end_s: float) -> None:
    """ffmpeg-slice [start_s, end_s] from input_path to output_path as 16k mono WAV.
    Used to extract single-segment reference audio for scoring (otherwise DTW
    would compare a short attempt against the full multi-minute clip)."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(input_path),
            "-ss", f"{start_s:.3f}",
            "-to", f"{end_s:.3f}",
            "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
            str(output_path),
        ],
        check=True, capture_output=True,
    )


app = typer.Typer(help="nextenglish sidecar smoke-test CLI", no_args_is_help=True)


@app.command()
def ingest(
    source: str = typer.Argument(..., help="URL (https://...) or local audio file path"),
    out_dir: Path = typer.Option(Path("./_work/cli"), help="Where to write outputs"),
    max_duration_s: int = typer.Option(900, help="Max clip duration in seconds (default 15 min)"),
):
    """Download (if URL) or copy, normalize to 16k mono, and transcribe."""
    init_logging()
    from .pipeline.ingest import ingest_url, ingest_file, is_valid_url, IngestError
    from .pipeline.transcribe import transcribe

    out_dir.mkdir(parents=True, exist_ok=True)
    typer.echo(f"Ingesting from: {source}")

    try:
        if is_valid_url(source):
            audio_path = ingest_url(source, out_dir, max_duration_s)
        else:
            audio_path = ingest_file(Path(source), out_dir, max_duration_s)
    except IngestError as e:
        typer.secho(f"INGEST FAILED [{e.code}] {e.message}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    typer.echo(f"Audio normalized: {audio_path}")
    typer.echo("Transcribing... (first run downloads small.en, ~500MB)")

    segments = transcribe(audio_path)
    if not segments:
        typer.secho("No speech detected.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    typer.echo(f"\n=== {len(segments)} segments ===\n")
    for i, seg in enumerate(segments):
        typer.echo(f"  [{i}] {seg.start_ms/1000:6.2f}s - {seg.end_ms/1000:6.2f}s  {seg.text}")

    transcript_path = out_dir / "transcript.json"
    transcript_path.write_text(
        json.dumps([s.model_dump() for s in segments], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    typer.echo(f"\nTranscript: {transcript_path}")
    typer.secho(
        f"\nNext: extract a segment to listen to, record yourself, then score:\n"
        f"  python -m sidecar.cli extract \"{audio_path}\" 0\n"
        f"  python -m sidecar.cli score \"{audio_path}\" <your-recording.wav> --segment-index 0",
        fg=typer.colors.GREEN,
    )


@app.command()
def extract(
    audio: Path = typer.Argument(..., help="Full clip audio (audio.wav from `ingest`)"),
    segment_index: int = typer.Argument(..., help="Which segment to extract (0-indexed)"),
    transcript: Path = typer.Option(None, help="Transcript JSON (defaults to audio's sibling)"),
    output_dir: Path = typer.Option(None, help="Where to write segment WAV (defaults to audio's parent / 'segments')"),
):
    """Extract a single segment to its own WAV file. Useful for listening to
    the reference before recording your shadow attempt."""
    init_logging()
    from .pipeline.models import Segment

    if transcript is None:
        transcript = audio.parent / "transcript.json"
    if not transcript.exists():
        typer.secho(f"Transcript not found: {transcript}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    segments_data = json.loads(transcript.read_text(encoding="utf-8"))
    if not 0 <= segment_index < len(segments_data):
        typer.secho(
            f"segment_index {segment_index} out of range (have {len(segments_data)} segments)",
            fg=typer.colors.RED, err=True,
        )
        raise typer.Exit(1)

    if output_dir is None:
        output_dir = audio.parent / "segments"
    output_dir.mkdir(parents=True, exist_ok=True)

    seg = Segment(**segments_data[segment_index])
    output_path = output_dir / f"seg_{segment_index:03d}.wav"
    _slice_audio(audio, output_path, seg.start_ms / 1000, seg.end_ms / 1000)

    typer.echo(f"Segment {segment_index}:")
    typer.echo(f"  Text:     {seg.text}")
    typer.echo(f"  Duration: {(seg.end_ms - seg.start_ms)/1000:.2f}s")
    typer.echo(f"  File:     {output_path}")
    typer.secho(
        f"\nPlay it in any audio player. When ready, record yourself "
        f"and run:\n  python -m sidecar.cli score \"{audio}\" <your-recording.wav> "
        f"--segment-index {segment_index}",
        fg=typer.colors.GREEN,
    )


@app.command()
def score(
    ref_audio: Path = typer.Argument(..., help="Reference audio (16k mono WAV from `ingest`)"),
    user_audio: Path = typer.Argument(..., help="Your attempt audio (any format ffmpeg reads)"),
    transcript: Path = typer.Option(None, help="Transcript JSON (defaults to ref_audio's sibling)"),
    segment_index: int = typer.Option(0, help="Which segment to score against (0-indexed)"),
):
    """Score a user attempt against a reference segment."""
    init_logging()
    from .pipeline.score import score_attempt
    from .pipeline.transcribe import transcribe
    from .pipeline.models import Segment
    from .pipeline.ingest import normalize_audio

    if not ref_audio.exists():
        typer.secho(f"Reference audio not found: {ref_audio}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    if not user_audio.exists():
        typer.secho(f"User audio not found: {user_audio}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    if transcript is None:
        transcript = ref_audio.parent / "transcript.json"
    if not transcript.exists():
        typer.secho(f"Transcript not found: {transcript}. Run `ingest` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    segments_data = json.loads(transcript.read_text(encoding="utf-8"))
    if segment_index >= len(segments_data):
        typer.secho(
            f"segment_index {segment_index} out of range (have {len(segments_data)} segments)",
            fg=typer.colors.RED, err=True,
        )
        raise typer.Exit(1)

    seg = Segment(**segments_data[segment_index])
    typer.echo(f"\nReference segment [{segment_index}]:")
    typer.echo(f"  Text:     {seg.text}")
    typer.echo(f"  Duration: {(seg.end_ms - seg.start_ms)/1000:.2f}s")

    # Slice the reference audio down to just this segment. Without this,
    # cadence DTW would try to align a 9s attempt against the full 7-min
    # clip and emit nonsense scores.
    seg_dir = ref_audio.parent / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    seg_audio = seg_dir / f"seg_{segment_index:03d}.wav"
    if not seg_audio.exists():
        _slice_audio(ref_audio, seg_audio, seg.start_ms / 1000, seg.end_ms / 1000)
    typer.echo(f"  Slice:    {seg_audio}")

    # Normalize user audio to 16k mono WAV. Parselmouth (Praat) reads native
    # audio formats only — WAV, FLAC, AIFF — but Voice Recorder produces M4A.
    # Normalizing is also the right move for VAD and DTW (consistent sample
    # rate). Mirrors what `ingest` does for reference audio.
    attempts_dir = ref_audio.parent / "user_attempts"
    attempts_dir.mkdir(parents=True, exist_ok=True)
    user_audio_norm = attempts_dir / f"{user_audio.stem}.wav"
    needs_renorm = (
        not user_audio_norm.exists()
        or user_audio_norm.stat().st_mtime < user_audio.stat().st_mtime
    )
    if needs_renorm:
        typer.echo(f"\nNormalizing your attempt to 16k mono WAV...")
        normalize_audio(user_audio, user_audio_norm)
    typer.echo(f"  Normalized: {user_audio_norm}")

    typer.echo("\nTranscribing your attempt...")
    user_segs = transcribe(user_audio_norm)
    user_text = " ".join(s.text for s in user_segs).strip() or "(silence)"
    typer.echo(f"  You said: {user_text}")

    typer.echo("\nComputing score (DTW + pitch)...")
    result = score_attempt(seg_audio, seg.text, user_audio_norm, user_text)

    box = "+----------------------------------+"
    pitch_str = f"{result.pitch_corr:+.2f}" if result.pitch_corr is not None else "—"
    typer.echo(f"\n  {box}")
    typer.echo(f"  |       OVERALL: {result.overall:>3}/100         |")
    typer.echo(f"  +----------------------------------+")
    typer.echo(f"  |  Words   {result.word_accuracy*100:5.1f}%                  |")
    typer.echo(f"  |  Cadence {result.cadence*100:5.1f}%                  |")
    typer.echo(f"  |  Pitch   {pitch_str:>5}                  |")
    typer.echo(f"  {box}\n")

    missed = [f.word for f in result.word_flags if not f.matched]
    if missed:
        typer.echo(f"Words not heard: {', '.join(missed)}")
    else:
        typer.secho("All reference words heard.", fg=typer.colors.GREEN)


@app.command()
def serve():
    """Run the HTTP server (used by the Tauri shell in production)."""
    from .server import run
    run()


if __name__ == "__main__":
    app()
