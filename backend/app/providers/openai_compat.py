"""Adapter for OpenAI-compatible `/chat/completions` APIs (OpenRouter, Groq, local servers, ...).

Request/response shape is the widely documented OpenAI chat format. Free quotas differ per service and
are NOT assumed here; see docs/providers.md.
"""
import time

import httpx

from app.providers.base import GenerationProvider, ProviderError, error_text, post_json


def openai_http_error(status: int, body: dict, key: str, model: str) -> ProviderError:
    detail = error_text(body, key)
    if status in (401, 403):
        return ProviderError("provider_auth", "The AI provider rejected the API key. Check PAPERTRAIL_OPENAI_API_KEY.")
    if status == 404:
        return ProviderError("provider_model_not_found", f"Model '{model}' or the endpoint was not found. Check the model name and PAPERTRAIL_OPENAI_BASE_URL.")
    if status in (402, 429):
        return ProviderError("provider_quota", "The AI provider's quota, credits or rate limit is exhausted. Wait, or switch to keyword search.")
    if status >= 500:
        return ProviderError("provider_unavailable", "The AI provider is temporarily unavailable. Try again shortly.")
    return ProviderError("provider_bad_request", f"The AI provider rejected the request ({status}): {detail or 'no details'}")


class OpenAICompatProvider(GenerationProvider):
    name = "openai_compat"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float,
                 transport: httpx.BaseTransport | None = None, retries: int = 0) -> None:
        self._key, self.model, self._base = api_key, model, base_url.rstrip("/")
        self._timeout, self._transport = timeout, transport
        self._retries, self._sleep = retries, time.sleep  # _sleep is replaceable in tests

    def generate(self, system: str, user: str, max_tokens: int) -> str:
        payload = {"model": self.model, "max_tokens": max_tokens,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        status, body = post_json(f"{self._base}/chat/completions",
                                 {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"},
                                 payload, self._timeout, self._transport, self._key,
                                 retries=self._retries, sleep=self._sleep)
        if status >= 400:
            raise self._http_error(status, body)
        try:
            text = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("provider_bad_response", "The AI provider returned an unexpected response format.") from exc
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("provider_bad_response", "The AI provider returned an empty answer.")
        return text

    def _http_error(self, status: int, body: dict) -> ProviderError:
        return openai_http_error(status, body, self._key, self.model)
