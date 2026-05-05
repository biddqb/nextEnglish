"""Speak module: LLM-judged conversational practice.

Pieces:
  - providers.py: Ollama / Anthropic / OpenAI clients behind a common
    Protocol. Picked per-request so the user can swap providers in
    Settings without restarting.
  - judge.py: orchestrates the judge call (build prompt, call provider,
    parse structured JSON critique).
  - corpus.py: curated scenarios (lands in step 9.4).

Per the design, single-turn with optional go-deeper follow-up. The
sidecar is provider-agnostic: it doesn't read settings, the Rust core
passes whichever provider config is currently selected.
"""
