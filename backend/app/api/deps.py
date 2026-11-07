import hmac
from collections.abc import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.services.runtime_settings import apply_overrides


def get_db(request: Request) -> Iterator[Session]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def get_settings(request: Request, session: Session = Depends(get_db)) -> Settings:
    """Environment settings merged with the overrides saved from the Settings page."""
    return apply_overrides(request.app.state.settings, session)


def get_provider(request: Request):
    return request.app.state.provider


def get_cache(request: Request):
    return request.app.state.answer_cache


def get_embedder(request: Request):
    return request.app.state.embedder


def get_limiter(request: Request):
    return request.app.state.limiter


def require_access(request: Request) -> None:
    """Enforce the optional shared access token. A no-op when PAPERTRAIL_ACCESS_TOKEN is unset."""
    expected = request.app.state.settings.access_token
    if expected is None:
        return
    header = request.headers.get("authorization", "")
    supplied = header[7:] if header.lower().startswith("bearer ") else ""
    if hmac.compare_digest(supplied.encode(), expected.get_secret_value().encode()):
        return
    if not request.app.state.auth_failures.allow():  # throttle guessing
        raise AppError("too_many_attempts", "Too many failed attempts. Wait a minute and try again.", 429)
    raise AppError("unauthorized", "A valid access token is required.", 401)
