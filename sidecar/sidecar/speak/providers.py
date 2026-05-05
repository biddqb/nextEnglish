"""LLM provider abstraction. One Protocol, three concrete clients.

We use raw httpx for all three providers instead of the official SDKs so
the sidecar stays light (no anthropic/openai packages bloating the venv
when most users will only run Ollama). The HTTP shapes are stable enough
that this is fine.

Each provider takes a system message + a list of messages (one or more
turns) and returns the assistant's reply as plain text. JSON parsing of
the structured critique happens one layer up in judge.py.
"""
from __future__ import annotations
from typing import Protocol

import httpx
from loguru import logger


# Default per-provider models. Settings can override on a per-request basis.
DEFAULTS = {
    "ollama": "llama3.1:8b",
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
}

# httpx timeouts. LLM responses can be slow on local Ollama with a cold
# model load. Generous on read; short on connect to fail fast if the
# endpoint isn't there at all.
_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=30.0)


class LlmError(Exception):
    """Provider-side failure with a user-readable message. The /speak/judge
    endpoint catches this and returns a structured ApiError envelope."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class LlmProvider(Protocol):
    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
    ) -> str: ...


class OllamaProvider:
    """Local Ollama daemon. Default base URL is the Ollama default
    (http://localhost:11434). No API key required."""

    def __init__(self, model: str | None = None, base_url: str = "http://localhost:11434"):
        self.model = model or DEFAULTS["ollama"]
        self.base_url = base_url.rstrip("/")

    async def complete(self, system: str, messages: list[dict[str, str]]) -> str:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": False,
            # Lower temperature for the structured-JSON critique path.
            # Higher temperature would make the model improvise the schema.
            "options": {"temperature": 0.3},
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(f"{self.base_url}/api/chat", json=body)
        except httpx.ConnectError as e:
            raise LlmError(
                "INTERNAL",
                f"Couldn't reach Ollama at {self.base_url}. Is it running? "
                f"Try `ollama serve` or `brew services start ollama`. ({e})",
                retryable=True,
            ) from e
        except httpx.HTTPError as e:
            raise LlmError("INTERNAL", f"Ollama HTTP error: {e}", retryable=True) from e

        if resp.status_code == 404:
            raise LlmError(
                "INTERNAL",
                f"Ollama doesn't have model '{self.model}'. "
                f"Run `ollama pull {self.model}` and try again.",
            )
        if resp.status_code >= 400:
            raise LlmError(
                "INTERNAL",
                f"Ollama {resp.status_code}: {resp.text[:200]}",
                retryable=resp.status_code >= 500,
            )

        data = resp.json()
        try:
            return data["message"]["content"]
        except (KeyError, TypeError) as e:
            raise LlmError("INTERNAL", f"Ollama response malformed: {data}") from e


class AnthropicProvider:
    """Anthropic Messages API. Uses the public REST shape directly."""

    def __init__(self, api_key: str, model: str | None = None):
        if not api_key:
            raise LlmError("INTERNAL", "Anthropic API key is empty. Set it in Settings.")
        self.api_key = api_key
        self.model = model or DEFAULTS["anthropic"]

    async def complete(self, system: str, messages: list[dict[str, str]]) -> str:
        body = {
            "model": self.model,
            "max_tokens": 1024,
            "system": system,
            "messages": messages,
            "temperature": 0.3,
        }
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=body,
                )
        except httpx.HTTPError as e:
            raise LlmError("INTERNAL", f"Anthropic HTTP error: {e}", retryable=True) from e

        if resp.status_code == 401:
            raise LlmError("INTERNAL", "Anthropic rejected the API key (401).")
        if resp.status_code >= 400:
            raise LlmError(
                "INTERNAL",
                f"Anthropic {resp.status_code}: {resp.text[:200]}",
                retryable=resp.status_code >= 500,
            )

        data = resp.json()
        try:
            return data["content"][0]["text"]
        except (KeyError, IndexError, TypeError) as e:
            raise LlmError("INTERNAL", f"Anthropic response malformed: {data}") from e


class OpenAiProvider:
    """OpenAI Chat Completions API."""

    def __init__(self, api_key: str, model: str | None = None):
        if not api_key:
            raise LlmError("INTERNAL", "OpenAI API key is empty. Set it in Settings.")
        self.api_key = api_key
        self.model = model or DEFAULTS["openai"]

    async def complete(self, system: str, messages: list[dict[str, str]]) -> str:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=body,
                )
        except httpx.HTTPError as e:
            raise LlmError("INTERNAL", f"OpenAI HTTP error: {e}", retryable=True) from e

        if resp.status_code == 401:
            raise LlmError("INTERNAL", "OpenAI rejected the API key (401).")
        if resp.status_code >= 400:
            raise LlmError(
                "INTERNAL",
                f"OpenAI {resp.status_code}: {resp.text[:200]}",
                retryable=resp.status_code >= 500,
            )

        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise LlmError("INTERNAL", f"OpenAI response malformed: {data}") from e


def build_provider(
    kind: str,
    model: str | None,
    api_key: str | None,
) -> LlmProvider:
    """Resolve a provider name + config into a concrete client.
    Unknown kinds raise LlmError so the endpoint surfaces a structured error."""
    kind_norm = (kind or "ollama").strip().lower()
    if kind_norm == "ollama":
        return OllamaProvider(model=model)
    if kind_norm == "anthropic":
        return AnthropicProvider(api_key=api_key or "", model=model)
    if kind_norm == "openai":
        return OpenAiProvider(api_key=api_key or "", model=model)
    raise LlmError(
        "INTERNAL",
        f"Unknown LLM provider '{kind}'. Use ollama / anthropic / openai.",
    )


__all__ = [
    "DEFAULTS",
    "LlmError",
    "LlmProvider",
    "OllamaProvider",
    "AnthropicProvider",
    "OpenAiProvider",
    "build_provider",
]
