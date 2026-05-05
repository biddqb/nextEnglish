"""Tests for the Speak module: corpus shape, judge prompt building,
and the JSON parser's tolerance for code fences and prose wrapping
that LLMs sometimes add around their structured output."""
from __future__ import annotations
import pytest

from sidecar.speak.corpus import list_scenarios
from sidecar.speak.judge import build_messages, parse_critique
from sidecar.speak.providers import (
    DEFAULTS,
    AnthropicProvider,
    LlmError,
    OllamaProvider,
    OpenAiProvider,
    build_provider,
)


# ─────────────────── corpus ───────────────────


class TestCorpus:
    def test_returns_at_least_thirty(self):
        scenarios = list_scenarios()
        assert len(scenarios) >= 30

    def test_ids_are_unique(self):
        ids = [s["id"] for s in list_scenarios()]
        assert len(set(ids)) == len(ids)

    def test_every_entry_has_required_fields(self):
        for s in list_scenarios():
            assert s["id"] and isinstance(s["id"], str)
            assert s["category"] and isinstance(s["category"], str)
            assert s["title"] and isinstance(s["title"], str)
            assert s["prompt"] and isinstance(s["prompt"], str)

    def test_covers_eight_categories(self):
        cats = {s["category"] for s in list_scenarios()}
        # Hardcoded — if a category is renamed in corpus.py the tests
        # should fail loudly so the picker doesn't silently lose a tab.
        assert cats == {
            "code_review",
            "debugging",
            "demo_pitch",
            "interview",
            "customer",
            "architecture",
            "standup",
            "mentoring",
        }


# ─────────────────── build_messages ───────────────────


class TestBuildMessages:
    def test_first_turn_has_no_history(self):
        msgs = build_messages(
            scenario="Pitch your feature in 30s.",
            user_transcript="We shipped X for Y because Z.",
            history=None,
        )
        assert len(msgs) == 1
        assert msgs[0]["role"] == "user"
        assert "Pitch your feature in 30s." in msgs[0]["content"]
        assert "We shipped X for Y because Z." in msgs[0]["content"]

    def test_history_prepended_in_order(self):
        history = [
            {"role": "user", "content": "I shipped feature X."},
            {"role": "assistant", "content": "What was the user problem?"},
        ]
        msgs = build_messages(
            scenario="What was the user problem?",
            user_transcript="Users couldn't reset their password.",
            history=history,
        )
        assert len(msgs) == 3
        assert msgs[0] == history[0]
        assert msgs[1] == history[1]
        assert msgs[2]["role"] == "user"
        assert "Users couldn't reset their password." in msgs[2]["content"]

    def test_strips_whitespace_around_inputs(self):
        msgs = build_messages(
            scenario="   pitch this   ",
            user_transcript="   it solves x   ",
            history=None,
        )
        # The exact content ends up trimmed inside the template.
        assert "pitch this" in msgs[0]["content"]
        assert "it solves x" in msgs[0]["content"]


# ─────────────────── parse_critique ───────────────────


VALID_PAYLOAD = (
    '{"score_overall": 75, "feedback": "Solid attempt.", '
    '"strengths": ["clear structure"], "improvements": ["use a concrete example"], '
    '"follow_up_question": "What metric would prove it worked?"}'
)


class TestParseCritique:
    def test_plain_json(self):
        out = parse_critique(VALID_PAYLOAD)
        assert out["score_overall"] == 75
        assert out["feedback"] == "Solid attempt."
        assert out["strengths"] == ["clear structure"]
        assert out["improvements"] == ["use a concrete example"]
        assert out["follow_up_question"] == "What metric would prove it worked?"

    def test_strips_code_fences(self):
        wrapped = f"```json\n{VALID_PAYLOAD}\n```"
        out = parse_critique(wrapped)
        assert out["score_overall"] == 75

    def test_extracts_from_prose_wrapping(self):
        wrapped = f"Here is the critique:\n{VALID_PAYLOAD}\nLet me know if you'd like more detail."
        out = parse_critique(wrapped)
        assert out["score_overall"] == 75

    def test_clamps_score_in_range(self):
        out = parse_critique(
            '{"score_overall": 150, "feedback": "x", "strengths": [], '
            '"improvements": [], "follow_up_question": ""}'
        )
        assert out["score_overall"] == 100

        out = parse_critique(
            '{"score_overall": -50, "feedback": "x", "strengths": [], '
            '"improvements": [], "follow_up_question": ""}'
        )
        assert out["score_overall"] == 0

    def test_handles_string_score_when_model_messes_up(self):
        out = parse_critique(
            '{"score_overall": "70", "feedback": "x", "strengths": [], '
            '"improvements": [], "follow_up_question": ""}'
        )
        assert out["score_overall"] == 70

    def test_defaults_score_to_50_when_missing(self):
        out = parse_critique(
            '{"feedback": "x", "strengths": [], "improvements": [], '
            '"follow_up_question": ""}'
        )
        assert out["score_overall"] == 50

    def test_drops_non_string_bullets(self):
        out = parse_critique(
            '{"score_overall": 50, "feedback": "x", '
            '"strengths": ["good", null, ""], "improvements": [], '
            '"follow_up_question": ""}'
        )
        assert out["strengths"] == ["good"]

    def test_missing_lists_become_empty(self):
        out = parse_critique(
            '{"score_overall": 50, "feedback": "x", "follow_up_question": ""}'
        )
        assert out["strengths"] == []
        assert out["improvements"] == []

    def test_garbage_raises(self):
        with pytest.raises(LlmError):
            parse_critique("totally not json at all here")

    def test_malformed_json_raises(self):
        with pytest.raises(LlmError):
            parse_critique("{not really: json,")


# ─────────────────── build_provider ───────────────────


class TestBuildProvider:
    def test_default_to_ollama(self):
        p = build_provider("", None, None)
        assert isinstance(p, OllamaProvider)
        assert p.model == DEFAULTS["ollama"]

    def test_ollama_with_model(self):
        p = build_provider("ollama", "qwen2.5:14b", None)
        assert isinstance(p, OllamaProvider)
        assert p.model == "qwen2.5:14b"

    def test_anthropic_requires_api_key(self):
        with pytest.raises(LlmError):
            build_provider("anthropic", None, "")
        with pytest.raises(LlmError):
            build_provider("anthropic", None, None)

    def test_anthropic_with_key_and_default_model(self):
        p = build_provider("anthropic", None, "sk-ant-fake")
        assert isinstance(p, AnthropicProvider)
        assert p.model == DEFAULTS["anthropic"]
        assert p.api_key == "sk-ant-fake"

    def test_openai_requires_api_key(self):
        with pytest.raises(LlmError):
            build_provider("openai", None, None)

    def test_openai_with_key(self):
        p = build_provider("openai", "gpt-4o", "sk-fake")
        assert isinstance(p, OpenAiProvider)
        assert p.model == "gpt-4o"

    def test_unknown_provider_raises(self):
        with pytest.raises(LlmError):
            build_provider("groq", None, None)

    def test_provider_name_is_case_insensitive(self):
        p = build_provider("OLLAMA", None, None)
        assert isinstance(p, OllamaProvider)
