"""Judge orchestration: build the prompt, call the LLM, parse the
structured critique. Provider-agnostic — providers.py handles the wire
shape per vendor."""
from __future__ import annotations
import json
import re

from loguru import logger

from .providers import LlmError, LlmProvider


SYSTEM_PROMPT = """You are an English fluency coach reviewing a single
spoken reply to a practice scenario. Be concise, specific, and respectful.
The reply was transcribed by speech-to-text — assume occasional
mistranscriptions and judge meaning, not spelling.

Always respond with a single JSON object, no surrounding text or code
fences. Use exactly this shape:

{
  "score_overall": <integer 0-100>,
  "feedback": "<one or two sentences>",
  "strengths": ["<short bullet>", "<short bullet>"],
  "improvements": ["<short bullet>", "<short bullet>"],
  "follow_up_question": "<one short question that deepens the conversation>"
}

The score reflects fluency, clarity, and how well the reply addresses the
scenario — not pronunciation (other modules cover that). Strengths and
improvements lists hold 1-3 items each. Keep follow_up_question under 20
words.
"""


def build_messages(
    scenario: str,
    user_transcript: str,
    history: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    """Produce the message list for the provider. History is the prior
    turns from a go-deeper sequence: alternating user/assistant pairs from
    earlier in the same scenario. The current user turn is appended last."""
    out: list[dict[str, str]] = []
    out.append({
        "role": "user",
        "content": (
            f"Scenario:\n{scenario.strip()}\n\n"
            f"Reply this turn (transcribed): \"{user_transcript.strip()}\""
        ),
    })
    if history:
        # Insert prior context BEFORE the current turn so the model sees
        # the conversation in chronological order.
        out = list(history) + out
    return out


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def parse_critique(raw: str) -> dict:
    """LLMs sometimes wrap JSON in code fences or add prose around it.
    Strip both and parse. Raises LlmError on unrecoverable garbage."""
    text = raw.strip()
    # Strip ``` fences if present.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    # Find the outermost {...} block as a fallback.
    if not text.startswith("{"):
        m = _JSON_BLOCK_RE.search(text)
        if not m:
            raise LlmError("INTERNAL", f"LLM reply not JSON: {raw[:200]}")
        text = m.group(0)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise LlmError("INTERNAL", f"LLM JSON malformed ({e}): {text[:200]}") from e

    # Validate shape; coerce types defensively. The user sees the score
    # as an int, the bullets as strings — don't ship floats / nested
    # objects to the UI.
    return {
        "score_overall": _clamp_int(data.get("score_overall"), 0, 100, default=50),
        "feedback": _coerce_str(data.get("feedback"), default=""),
        "strengths": _coerce_str_list(data.get("strengths")),
        "improvements": _coerce_str_list(data.get("improvements")),
        "follow_up_question": _coerce_str(data.get("follow_up_question"), default=""),
    }


async def run_judge(
    provider: LlmProvider,
    scenario: str,
    user_transcript: str,
    history: list[dict[str, str]] | None = None,
) -> dict:
    messages = build_messages(scenario, user_transcript, history)
    logger.info(
        f"speak/judge: sending to provider, "
        f"scenario_len={len(scenario)} reply_len={len(user_transcript)} "
        f"history_turns={len(history) if history else 0}"
    )
    raw = await provider.complete(SYSTEM_PROMPT, messages)
    logger.info(f"speak/judge: got reply ({len(raw)} chars)")
    return parse_critique(raw)


def _clamp_int(v, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _coerce_str(v, default: str = "") -> str:
    if v is None:
        return default
    return str(v).strip()


def _coerce_str_list(v) -> list[str]:
    if not isinstance(v, list):
        return []
    return [str(x).strip() for x in v if x is not None and str(x).strip()]


__all__ = ["SYSTEM_PROMPT", "build_messages", "parse_critique", "run_judge"]
