import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import public_router, router
from app.core.cache import AnswerCache
from app.core.config import Settings
from app.core.errors import AppError
from app.core.ratelimit import SlidingWindowLimiter
from app.db.session import create_session_factory
from app.providers.factory import build_embedder, build_provider
from app.services.seed import seed_sample_if_empty

logger = logging.getLogger("papertrail")


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="PaperTrail AI", version="0.3.0",
                  docs_url="/docs" if settings.enable_docs else None,
                  redoc_url=None, openapi_url="/openapi.json" if settings.enable_docs else None)
    app.state.settings = settings
    app.state.session_factory = create_session_factory(settings)
    app.state.provider, app.state.ai_config_error = build_provider(settings)
    app.state.embedder, app.state.embedding_config_error = build_embedder(settings)
    app.state.limiter = SlidingWindowLimiter(settings.ai_requests_per_minute)
    app.state.auth_failures = SlidingWindowLimiter(20)
    app.state.answer_cache = AnswerCache(settings.answer_cache_size)
    app.state.generating = set()  # message ids whose AI answer is being written right now
    if settings.seed_sample:
        with app.state.session_factory() as session:
            seed_sample_if_empty(session, settings, app.state.embedder)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _error(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = ", ".join(".".join(str(p) for p in e["loc"][1:]) or "body" for e in exc.errors())
        return _error(422, "validation_error", f"Invalid request: check {fields}.")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error")  # traceback stays in server logs only
        return _error(500, "internal_error", "Something went wrong on the server. Please try again.")

    app.include_router(public_router)
    app.include_router(router)
    return app


