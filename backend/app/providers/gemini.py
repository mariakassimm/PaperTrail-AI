"""Google Gemini API adapter (generativelanguage.googleapis.com, generateContent).

Contract checked against Google's official docs ("Text generation", updated 2026-10-19):
POST {base}/models/{model}:generateContent, header `x-goog-api-key`, body with `system_instruction`,
`contents[].parts[].text` and `generationConfig.maxOutputTokens`; reply text at
`candidates[0].content.parts[].text`. temperature/top_p/top_k are deliberately NOT sent: Google
documents that Gemini 3.6+ ignores them and will reject them in future.
"""
import time

import httpx

from app.providers.base import GenerationProvider, ProviderError, error_text, post_json


def gemini_http_error(status: int, body: dict, key: str, model: str) -> ProviderError:
    detail = error_text(body, key)
    if status in (401, 403) or (status == 400 and "api key" in detail.lower()):
        return ProviderError("provider_auth", "Gemini rejected the API key. Check PAPERTRAIL_GEMINI_API_KEY and that the key is active.")
    if status == 404:
        return ProviderError("provider_model_not_found", f"Gemini model '{model}' was not found. Check the model name against Google's docs.")
    if status == 429:
        return ProviderError("provider_quota", "Gemini free-tier quota or rate limit reached. Wait a minute, or check your limits in Google AI Studio.")
    if status >= 500:
        return ProviderError("provider_unavailable", "Gemini is temporarily unavailable. Try again shortly.")
    return ProviderError("provider_bad_request", f"Gemini rejected the request ({status}): {detail or 'no details'}")


class GeminiProvider(GenerationProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float,
                 transport: httpx.BaseTransport | None = None, retries: int = 0) -> None:
        self._key, self.model, self._base = api_key, model, base_url.rstrip("/")
        self._timeout, self._transport = timeout, transport
        self._retries, self._sleep = retries, time.sleep  # _sleep is replaceable in tests

    def generate(self, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }
        status, body = post_json(f"{self._base}/models/{self.model}:generateContent",
                                 {"x-goog-api-key": self._key, "Content-Type": "application/json"},
                                 payload, self._timeout, self._transport, self._key,
                                 retries=self._retries, sleep=self._sleep)
        if status >= 400:
            raise self._http_error(status, body)
        return self._extract_text(body)

    def _http_error(self, status: int, body: dict) -> ProviderError:
        return gemini_http_error(status, body, self._key, self.model)

    def _extract_text(self, body: dict) -> str:
        block = (body.get("promptFeedback") or {}).get("blockReason")
        if block:
            raise ProviderError("provider_blocked", f"Gemini blocked this request ({block}).")
        candidates = body.get("candidates") or []
        if not candidates or not isinstance(candidates[0], dict):
            raise ProviderError("provider_bad_response", "Gemini returned no answer.")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        if text.strip():
            return text
        reason = candidates[0].get("finishReason", "")
        if reason == "MAX_TOKENS":
            raise ProviderError("provider_bad_response", "Gemini ran out of output tokens before answering. Increase PAPERTRAIL_AI_MAX_OUTPUT_TOKENS.")
        if reason in ("SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST"):
            raise ProviderError("provider_blocked", f"Gemini withheld the answer ({reason}).")
        raise ProviderError("provider_bad_response", "Gemini returned an empty answer.")
