import httpx

from app.core.config import Settings
from app.providers.base import GenerationProvider
from app.providers.embeddings import EmbeddingProvider, GeminiEmbeddings, OpenAICompatEmbeddings
from app.providers.gemini import GeminiProvider
from app.providers.openai_compat import OpenAICompatProvider


def build_provider(settings: Settings, transport: httpx.BaseTransport | None = None
                   ) -> tuple[GenerationProvider | None, str | None]:
    """Return (provider, config_error). A misconfiguration never stops the app; it runs retrieval-only."""
    choice = settings.ai_provider
    if choice == "none":
        return None, None
    timeout = settings.ai_timeout_seconds
    if choice == "gemini":
        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        if not key:
            return None, "PAPERTRAIL_AI_PROVIDER=gemini but PAPERTRAIL_GEMINI_API_KEY is not set. Running in retrieval-only mode."
        return GeminiProvider(key, settings.gemini_model, settings.gemini_base_url, timeout, transport, settings.ai_max_retries), None
    key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else ""
    if not key or not settings.openai_model:
        return None, "PAPERTRAIL_AI_PROVIDER=openai_compat needs PAPERTRAIL_OPENAI_API_KEY and PAPERTRAIL_OPENAI_MODEL. Running in retrieval-only mode."
    return OpenAICompatProvider(key, settings.openai_model, settings.openai_base_url, timeout, transport, settings.ai_max_retries), None


def build_embedder(settings: Settings, transport: httpx.BaseTransport | None = None
                   ) -> tuple[EmbeddingProvider | None, str | None]:
    """Return (embedder, config_error). Embeddings are optional; misconfiguration means keyword-only search."""
    choice = settings.embedding_provider
    if choice == "none":
        return None, None
    timeout = settings.ai_timeout_seconds
    if choice == "gemini":
        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        if not key:
            return None, "PAPERTRAIL_EMBEDDING_PROVIDER=gemini but PAPERTRAIL_GEMINI_API_KEY is not set. Using keyword search only."
        return GeminiEmbeddings(key, settings.embedding_model, settings.gemini_base_url,
                                settings.embedding_dimensions, timeout, transport, settings.ai_max_retries), None
    key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else ""
    if not key or not settings.openai_embedding_model:
        return None, "PAPERTRAIL_EMBEDDING_PROVIDER=openai_compat needs PAPERTRAIL_OPENAI_API_KEY and PAPERTRAIL_OPENAI_EMBEDDING_MODEL. Using keyword search only."
    return OpenAICompatEmbeddings(key, settings.openai_embedding_model, settings.openai_base_url, timeout, transport, settings.ai_max_retries), None
