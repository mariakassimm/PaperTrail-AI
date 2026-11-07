"""Centralised configuration. All values can be overridden with PAPERTRAIL_* env vars."""
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PAPERTRAIL_", env_file=".env", extra="ignore")

    data_dir: Path = Path("./data")
    cors_origins: list[str] = ["http://localhost:5173"]
    max_upload_mb: int = Field(default=20, ge=1, le=200)
    chunk_size: int = Field(default=900, ge=200, le=4000)  # characters
    chunk_overlap: int = Field(default=150, ge=0, le=1000)  # characters
    top_k: int = Field(default=5, ge=1, le=20)
    # Fraction of distinct query terms a passage must contain to count as evidence.
    min_term_coverage: float = Field(default=0.5, ge=0.0, le=1.0)
    max_question_chars: int = 1000

    # --- Deployment ---
    # Shared secret required as `Authorization: Bearer <token>` on every API call except /health.
    # NOT multi-user authentication: one secret, one workspace. Set it whenever the backend is public.
    access_token: SecretStr | None = Field(default=None, min_length=16)
    enable_docs: bool = True  # set false in production to hide /docs and /openapi.json
    seed_sample: bool = False  # load sample_data/sample_paper.pdf at startup if the library is empty

    # --- Retrieval behaviour (runtime-editable from Settings; these are the defaults) ---
    retrieval_mode: Literal["keyword", "hybrid"] = "keyword"  # "hybrid" needs an embedding provider
    # Minimum cosine similarity for a passage to count as semantic evidence. An UNTUNED starting point:
    # calibrate it with the Evaluation Lab on your own documents.
    min_cosine: float = Field(default=0.62, ge=0.0, le=1.0)
    ai_enabled: bool = True  # False = never call the generation provider (saves quota)
    auto_embed: bool = True  # embed new uploads automatically when an embedding provider is configured

    # --- Optional embeddings (semantic search). Default "none" = keyword search only. ---
    embedding_provider: Literal["none", "gemini", "openai_compat"] = "none"
    embedding_model: str = "gemini-embedding-001"  # Gemini; reuses PAPERTRAIL_GEMINI_API_KEY
    openai_embedding_model: str = ""  # OpenAI-compatible /embeddings; reuses OPENAI key and base URL
    embedding_dimensions: int = Field(default=768, ge=128, le=3072)  # Gemini output_dimensionality
    embedding_batch_size: int = Field(default=32, ge=1, le=100)

    # --- Optional AI answer generation. Default "none" = retrieval-only, no key needed. ---
    ai_provider: Literal["none", "gemini", "openai_compat"] = "none"
    gemini_api_key: SecretStr | None = None
    # Model names change often; check Google's docs and override via PAPERTRAIL_GEMINI_MODEL.
    gemini_model: str = "gemini-3.8-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # Any OpenAI-compatible /chat/completions API (OpenRouter by default). Model must be chosen by you.
    openai_base_url: str = "https://openrouter.ai/api/v1"
    openai_api_key: SecretStr | None = None
    openai_model: str = ""
    ai_timeout_seconds: float = Field(default=30.0, ge=1.0, le=120.0)
    ai_max_output_tokens: int = Field(default=1024, ge=64, le=4000)
    ai_context_chars: int = Field(default=6000, ge=500, le=30000)  # passage text sent to the provider
    ai_requests_per_minute: int = Field(default=10, ge=1, le=120)  # local guard to protect free quotas
    # One automatic retry for temporary failures only (502/503/504, dropped connections, or a short Retry-After).
    ai_max_retries: int = Field(default=1, ge=0, le=3)
    answer_cache_size: int = Field(default=128, ge=0, le=5000)  # remembered AI answers; 0 turns the cache off

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{(self.data_dir / 'papertrail.db').resolve()}"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024
