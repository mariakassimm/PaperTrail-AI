"""Embedding providers (semantic search). Optional: the app works without any of this.

Gemini contract checked against Google's "Embeddings" docs: POST {base}/models/{model}:batchEmbedContents,
header `x-goog-api-key`, body {"requests": [{"model": "models/<model>", "content": {"parts": [{"text": ...}]},
"taskType": ..., "output_dimensionality": N}]}; reply {"embeddings": [{"values": [...]}]}. `gemini-embedding-2`
does not accept task types, so taskType is only sent for gemini-embedding-001.
"""
import time
from abc import ABC, abstractmethod
from typing import Literal

import httpx

from app.providers.base import ProviderError, post_json
from app.providers.gemini import gemini_http_error
from app.providers.openai_compat import openai_http_error

Kind = Literal["document", "query"]


class EmbeddingProvider(ABC):
    name: str
    model: str

    @property
    @abstractmethod
    def signature(self) -> str:
        """Identifies the vector space. Vectors with a different signature are never compared."""

    @property
    def label(self) -> str:
        return f"{self.name} ({self.model})"

    @abstractmethod
    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]: ...


def _validate(vectors: object, expected: int) -> list[list[float]]:
    ok = (isinstance(vectors, list) and len(vectors) == expected and all(
        isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v) for v in vectors))
    if not ok or len({len(v) for v in vectors}) != 1:
        raise ProviderError("provider_bad_response", "The embedding provider returned an unexpected response format.")
    return vectors  # type: ignore[return-value]


class GeminiEmbeddings(EmbeddingProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, base_url: str, dimensions: int, timeout: float,
                 transport: httpx.BaseTransport | None = None, retries: int = 0) -> None:
        self._key, self.model, self._base, self._dims = api_key, model, base_url.rstrip("/"), dimensions
        self._timeout, self._transport = timeout, transport
        self._retries, self._sleep = retries, time.sleep  # _sleep is replaceable in tests

    @property
    def signature(self) -> str:
        return f"gemini:{self.model}:{self._dims}"

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        task = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}[kind]
        requests = []
        for text in texts:
            item: dict = {"model": f"models/{self.model}", "content": {"parts": [{"text": text}]},
                          "output_dimensionality": self._dims}
            if self.model.startswith("gemini-embedding-001"):
                item["taskType"] = task
            requests.append(item)
        status, body = post_json(f"{self._base}/models/{self.model}:batchEmbedContents",
                                 {"x-goog-api-key": self._key, "Content-Type": "application/json"},
                                 {"requests": requests}, self._timeout, self._transport, self._key,
                                 retries=self._retries, sleep=self._sleep)
        if status >= 400:
            raise gemini_http_error(status, body, self._key, self.model)
        embeddings = body.get("embeddings")
        values = [e.get("values") if isinstance(e, dict) else None for e in embeddings] if isinstance(embeddings, list) else None
        return _validate(values, len(texts))


class OpenAICompatEmbeddings(EmbeddingProvider):
    name = "openai_compat"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float,
                 transport: httpx.BaseTransport | None = None, retries: int = 0) -> None:
        self._key, self.model, self._base = api_key, model, base_url.rstrip("/")
        self._timeout, self._transport = timeout, transport
        self._retries, self._sleep = retries, time.sleep  # _sleep is replaceable in tests

    @property
    def signature(self) -> str:
        return f"openai_compat:{self.model}"

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        status, body = post_json(f"{self._base}/embeddings",
                                 {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"},
                                 {"model": self.model, "input": texts}, self._timeout, self._transport, self._key,
                                 retries=self._retries, sleep=self._sleep)
        if status >= 400:
            raise openai_http_error(status, body, self._key, self.model)
        data = body.get("data")
        if isinstance(data, list) and all(isinstance(d, dict) for d in data):
            data = sorted(data, key=lambda d: d.get("index", 0))
            return _validate([d.get("embedding") for d in data], len(texts))
        raise ProviderError("provider_bad_response", "The embedding provider returned an unexpected response format.")
