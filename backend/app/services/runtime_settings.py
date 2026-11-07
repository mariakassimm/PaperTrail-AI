"""Settings editable from the UI, stored in SQLite as overrides on top of the environment defaults.

Only non-secret tuning values are editable. API keys, provider choice, upload limits and the access token stay
in environment variables on purpose: the browser must never be able to read or change secrets.
"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import AppSetting

REINDEX_FLAG = "_reindex_needed"
EDITABLE = ("retrieval_mode", "top_k", "min_term_coverage", "min_cosine", "chunk_size", "chunk_overlap", "ai_enabled", "auto_embed")


class SettingsPatch(BaseModel):
    model_config = {"extra": "forbid"}  # unknown or secret-looking keys are rejected, not ignored
    retrieval_mode: Literal["keyword", "hybrid"] | None = None
    top_k: int | None = Field(default=None, ge=1, le=20, strict=True)
    min_term_coverage: float | None = Field(default=None, ge=0.0, le=1.0, strict=True)
    min_cosine: float | None = Field(default=None, ge=0.0, le=1.0, strict=True)
    chunk_size: int | None = Field(default=None, ge=200, le=4000, strict=True)
    chunk_overlap: int | None = Field(default=None, ge=0, le=1000, strict=True)
    ai_enabled: bool | None = Field(default=None, strict=True)
    auto_embed: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def _overlap_smaller(self) -> "SettingsPatch":
        if self.chunk_size is not None and self.chunk_overlap is not None and self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        return self


def stored_overrides(session: Session) -> dict:
    rows = session.query(AppSetting).filter(AppSetting.key.in_(EDITABLE)).all()
    return {r.key: r.value.get("v") for r in rows}


def apply_overrides(base: Settings, session: Session) -> Settings:
    overrides = stored_overrides(session)
    return base.model_copy(update=overrides) if overrides else base


def reindex_needed(session: Session) -> bool:
    row = session.get(AppSetting, REINDEX_FLAG)
    return bool(row and row.value.get("v"))


def _set(session: Session, key: str, value: object) -> None:
    row = session.get(AppSetting, key)
    if row:
        row.value = {"v": value}
    else:
        session.add(AppSetting(key=key, value={"v": value}))


def update_settings(session: Session, base: Settings, patch: SettingsPatch, has_embedder: bool, has_documents: bool) -> Settings:
    changes = patch.model_dump(exclude_none=True)
    if changes.get("retrieval_mode") == "hybrid" and not has_embedder:
        raise AppError("embeddings_not_configured",
                       "Hybrid search needs an embedding provider. Configure one in backend/.env first (see Settings).", 422)
    before = apply_overrides(base, session)
    after = before.model_copy(update=changes)
    if after.chunk_overlap >= after.chunk_size:
        raise AppError("invalid_settings", "Chunk overlap must be smaller than chunk size.", 422)
    for key, value in changes.items():
        _set(session, key, value)
    if has_documents and (after.chunk_size, after.chunk_overlap) != (before.chunk_size, before.chunk_overlap):
        _set(session, REINDEX_FLAG, True)
    session.commit()
    return after


def reset_settings(session: Session, base: Settings, has_documents: bool) -> None:
    """Drop all overrides. If that changes the chunking that existing documents were indexed with, flag a reindex."""
    before = apply_overrides(base, session)
    session.query(AppSetting).delete()
    if has_documents and (base.chunk_size, base.chunk_overlap) != (before.chunk_size, before.chunk_overlap):
        _set(session, REINDEX_FLAG, True)
    session.commit()


def clear_reindex_flag(session: Session) -> None:
    _set(session, REINDEX_FLAG, False)
    session.commit()
