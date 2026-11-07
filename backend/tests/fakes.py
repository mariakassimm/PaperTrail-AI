"""Deterministic stand-ins for the embedding provider. Synonyms share an axis, so paraphrases are 'close'."""
import zlib

from app.providers.base import ProviderError
from app.providers.embeddings import EmbeddingProvider
from app.rag.retrieval import tokenize

CONCEPTS = {"price": 0, "cost": 0, "expensive": 0, "dollar": 0, "setup": 1, "installation": 1, "install": 1,
            "pump": 2, "motor": 2, "water": 3, "irrigation": 3, "sensor": 4, "moisture": 4,
            "bread": 5, "sourdough": 5, "flour": 5, "electricity": 6, "solar": 6, "panel": 6, "sunlight": 6}
DIM = 32


def vectorise(text: str) -> list[float]:
    vec = [0.0] * DIM
    for token in tokenize(text):
        axis = CONCEPTS.get(token, 8 + zlib.crc32(token.encode()) % (DIM - 8))
        vec[axis] += 1.0
    return vec


class FakeEmbedder(EmbeddingProvider):
    name, model = "fake", "concepts-v1"

    def __init__(self, fail_with: ProviderError | None = None, fail_documents: bool = False, signature: str = "fake:concepts-v1:32"):
        self.fail_with, self.fail_documents, self._signature = fail_with, fail_documents, signature
        self.calls: list[tuple[int, str]] = []

    @property
    def signature(self) -> str:
        return self._signature

    def embed(self, texts, kind):
        self.calls.append((len(texts), kind))
        if self.fail_with and (kind == "query" or self.fail_documents):
            raise self.fail_with
        return [vectorise(t) for t in texts]
