import json

import pymupdf
from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_cache,
    get_db,
    get_embedder,
    get_limiter,
    get_provider,
    get_settings,
    require_access,
)
from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import Chunk, Collection, Conversation, Document, EvalCase
from app.evaluation.runner import run_cases
from app.evaluation.service import DATASET, run_builtin
from app.providers.base import ProviderError
from app.rag import embedding_store
from app.rag.citations import build_citations, locate_span, validate_citations
from app.rag.retrieval import retrieve_hybrid
from app.schemas import api as s
from app.services import chat
from app.services import collections as col_svc
from app.services import documents as doc_svc
from app.services import runtime_settings as rt
from app.services.suggestions import suggest_questions

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_access)])
public_router = APIRouter(prefix="/api/v1")  # health only: lets the UI discover whether a token is needed
Db = Depends(get_db)
Cfg = Depends(get_settings)


@public_router.get("/health")
def health(request: Request, session: Session = Db, provider=Depends(get_provider)) -> dict:
    session.execute(select(1))
    effective = rt.apply_overrides(request.app.state.settings, session)
    embedder = request.app.state.embedder
    ai_on = provider is not None and effective.ai_enabled
    return {"status": "ok", "version": "0.4.0",
            "retrieval_mode": "hybrid (keyword + meaning)" if effective.retrieval_mode == "hybrid" and embedder else "keyword (BM25)",
            "ai_provider": provider.label if provider else None, "ai_enabled": effective.ai_enabled,
            "ai_mode": "generative" if ai_on else "retrieval_only",
            "ai_config_error": request.app.state.ai_config_error,
            "semantic": embedder is not None, "embedding_provider": embedder.label if embedder else None,
            "embedding_config_error": request.app.state.embedding_config_error,
            "auth_required": request.app.state.settings.access_token is not None}


@router.get("/auth/check")
def auth_check() -> dict:
    """Reaching this handler means the supplied token (if any is required) was accepted."""
    return {"ok": True}


@router.get("/stats")
def stats(session: Session = Db) -> dict:
    by_status = dict(session.execute(select(Document.status, func.count()).group_by(Document.status)).all())
    return {
        "documents": sum(by_status.values()), "documents_by_status": by_status,
        "collections": session.scalar(select(func.count()).select_from(Collection)) or 0,
        "conversations": session.scalar(select(func.count()).select_from(Conversation)) or 0,
        "chunks": session.scalar(select(func.count()).select_from(Chunk)) or 0,
    }


# ---- documents -------------------------------------------------------------
@router.post("/documents", response_model=s.DocumentOut, status_code=201)
async def upload_document(file: UploadFile = File(...), session: Session = Db, settings: Settings = Cfg,
                          embedder=Depends(get_embedder)):
    data = bytearray()
    while block := await file.read(1024 * 1024):
        data.extend(block)
        if len(data) > settings.max_upload_bytes:  # stop reading early
            raise AppError("file_too_large", f"File exceeds the {settings.max_upload_mb} MB limit.", 413)
    return doc_svc.ingest_upload(session, settings, file.filename, bytes(data), embedder)


@router.get("/documents", response_model=s.Page[s.DocumentOut])
def list_documents(q: str | None = Query(None, max_length=200), status: str | None = None,
                   collection_id: int | None = None,
                   sort: str = Query("newest", pattern="^(newest|oldest|title|size)$"),
                   page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                   session: Session = Db):
    items, total = doc_svc.list_documents(session, q=q, status=status, collection_id=collection_id,
                                          sort=sort, page=page, page_size=page_size)
    return s.Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/documents/{document_id}", response_model=s.DocumentOut)
def get_document(document_id: int, session: Session = Db):
    return doc_svc.get_document(session, document_id)


@router.patch("/documents/{document_id}", response_model=s.DocumentOut)
def patch_document(document_id: int, body: s.DocumentUpdate, session: Session = Db):
    doc = doc_svc.get_document(session, document_id)
    return doc_svc.update_document(session, doc, body.title, body.collection_id, body.clear_collection)


@router.post("/documents/{document_id}/retry", response_model=s.DocumentOut)
def retry_document(document_id: int, session: Session = Db, settings: Settings = Cfg, embedder=Depends(get_embedder)):
    doc = doc_svc.get_document(session, document_id)
    if not doc_svc.stored_path(settings, doc).exists():
        raise AppError("source_file_missing", "The stored file is missing; please upload it again.", 410)
    return doc_svc.process_document(session, settings, doc, embedder)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: int, session: Session = Db, settings: Settings = Cfg):
    doc_svc.delete_document(session, settings, doc_svc.get_document(session, document_id))
    return Response(status_code=204)


@router.get("/documents/{document_id}/preview")
def preview_document(document_id: int, limit: int = Query(3000, ge=100, le=20000),
                     session: Session = Db):
    doc = doc_svc.get_document(session, document_id)
    chunks = session.scalars(select(Chunk).where(Chunk.document_id == doc.id)
                             .order_by(Chunk.chunk_index).limit(50)).all()
    text = "\n\n".join(f"[page {c.page_number}] {c.text}" for c in chunks)
    return {"document_id": doc.id, "preview": text[:limit], "truncated": len(text) > limit}


@router.get("/chunks/{chunk_id}", response_model=s.ChunkDetail)
def get_chunk(chunk_id: int, session: Session = Db, settings: Settings = Cfg):
    """Evidence viewer: the cited chunk plus the full text of its page for context."""
    chunk = session.get(Chunk, chunk_id)
    if not chunk:
        raise AppError("chunk_not_found", "This source passage no longer exists (was the document deleted?).", 404)
    doc = chunk.document
    page_text = chunk.text
    path = doc_svc.stored_path(settings, doc)
    if path.exists():
        try:
            with pymupdf.open(path) as pdf:
                from app.rag.extraction import normalize
                page_text = normalize(pdf[chunk.page_number - 1].get_text("text")) or chunk.text
        except Exception:
            page_text = chunk.text
    span = locate_span(page_text, chunk.text)
    return s.ChunkDetail(chunk_id=chunk.id, document_id=doc.id, document_title=doc.title,
                         filename=doc.filename, page_number=chunk.page_number, text=chunk.text,
                         page_text=page_text, highlight_start=span[0] if span else None,
                         highlight_end=span[1] if span else None)


# ---- collections -----------------------------------------------------------
def _col_out(col: Collection, counts: dict[int, int]) -> s.CollectionOut:
    out = s.CollectionOut.model_validate(col)
    out.document_count = counts.get(col.id, 0)
    return out


@router.post("/collections", response_model=s.CollectionOut, status_code=201)
def create_collection(body: s.CollectionIn, session: Session = Db):
    col = col_svc.save_collection(session, Collection(name=body.name.strip(), description=body.description))
    return _col_out(col, {})


@router.get("/collections", response_model=list[s.CollectionOut])
def list_collections(session: Session = Db):
    counts = col_svc.document_counts(session)
    return [_col_out(c, counts) for c in session.scalars(select(Collection).order_by(Collection.name))]


@router.put("/collections/{collection_id}", response_model=s.CollectionOut)
def update_collection(collection_id: int, body: s.CollectionIn, session: Session = Db):
    col = col_svc.get_collection(session, collection_id)
    col.name, col.description = body.name.strip(), body.description
    col_svc.save_collection(session, col)
    return _col_out(col, col_svc.document_counts(session))


@router.delete("/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, session: Session = Db):
    col_svc.delete_collection(session, col_svc.get_collection(session, collection_id))
    return Response(status_code=204)


# ---- chat & search ---------------------------------------------------------
def _ask_response(conv_id: int, msg, result) -> s.AskResponse:
    return s.AskResponse(conversation_id=conv_id, status=result.status, mode=result.mode, answer=result.answer,
                         citations=[c.to_dict() for c in result.citations], provider=result.provider,
                         notice=result.notice, retrieval=result.retrieval, message_id=msg.id,
                         ai_pending=result.ai_pending, cached=result.cached)


@router.post("/ask", response_model=s.AskResponse)
def ask(body: s.AskRequest, session: Session = Db, settings: Settings = Cfg, provider=Depends(get_provider),
        limiter=Depends(get_limiter), embedder=Depends(get_embedder), cache=Depends(get_cache)):
    conv, result, msg = chat.ask(session, settings, body.question, body.collection_id, body.document_ids,
                                 body.conversation_id, provider, limiter, embedder, cache, body.defer_ai)
    return _ask_response(conv.id, msg, result)


@router.post("/messages/{message_id}/generate", response_model=s.AskResponse)
def generate_message_answer(message_id: int, request: Request, session: Session = Db, settings: Settings = Cfg,
                            provider=Depends(get_provider), limiter=Depends(get_limiter), cache=Depends(get_cache)):
    """Write the AI answer for passages already returned by /ask with defer_ai. Safe to call again."""
    result, msg = chat.generate_for_message(session, settings, message_id, provider, limiter, cache,
                                            request.app.state.generating)
    return _ask_response(msg.conversation_id, msg, result)


@router.get("/conversations", response_model=list[s.ConversationOut])
def list_conversations(session: Session = Db):
    return chat.list_conversations(session)


@router.get("/conversations/{conversation_id}", response_model=s.ConversationDetail)
def get_conversation(conversation_id: int, session: Session = Db):
    return chat.get_conversation(session, conversation_id)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: int, session: Session = Db):
    session.delete(chat.get_conversation(session, conversation_id))
    session.commit()
    return Response(status_code=204)


@router.get("/search", response_model=s.SearchResponse)
def search(q: str = Query(..., min_length=1, max_length=200), collection_id: int | None = None,
           session: Session = Db, settings: Settings = Cfg, embedder=Depends(get_embedder)):
    like = f"%{q}%"
    stmt = select(Document).where(Document.title.ilike(like) | Document.filename.ilike(like))
    if collection_id is not None:
        stmt = stmt.where(Document.collection_id == collection_id)
    outcome = retrieve_hybrid(session, q, top_k=10, min_coverage=0.0, collection_id=collection_id, embedder=embedder,
                              mode=settings.retrieval_mode, min_cosine=settings.min_cosine)
    results = outcome.results
    cites = validate_citations(session, build_citations(results, q))
    hits = [s.SearchHit(citation=c.to_dict(), coverage=round(r.coverage, 3)) for c, r in zip(cites, results)]
    return s.SearchResponse(query=q, search_type="hybrid (keyword + meaning)" if outcome.mode_used == "hybrid" else "keyword",
                            notice=outcome.notice, title_matches=list(session.scalars(stmt.limit(10))), passages=hits)


# ---- settings & evaluation -------------------------------------------------
def _settings_out(request: Request, session: Session, effective: Settings, provider, embedder) -> s.SettingsOut:
    base: Settings = request.app.state.settings
    defaults = {k: getattr(base, k) for k in rt.EDITABLE}
    overrides = rt.stored_overrides(session)
    return s.SettingsOut(
        retrieval_mode="hybrid (keyword + meaning)" if effective.retrieval_mode == "hybrid" and embedder else "keyword (BM25)",
        ai_provider=provider.name if provider else None, ai_model=provider.model if provider else None,
        ai_configured=provider is not None, ai_config_error=request.app.state.ai_config_error,
        ai_enabled=effective.ai_enabled, auto_embed=effective.auto_embed, min_cosine=effective.min_cosine,
        embedding_provider=embedder.label if embedder else None, embedding_config_error=request.app.state.embedding_config_error,
        retrieval_modes=["keyword", "hybrid"] if embedder else ["keyword"],
        chunk_size=effective.chunk_size, chunk_overlap=effective.chunk_overlap, top_k=effective.top_k,
        min_term_coverage=effective.min_term_coverage, max_upload_mb=effective.max_upload_mb,
        defaults=defaults, overridden=sorted(overrides), reindex_needed=rt.reindex_needed(session))


@router.get("/settings", response_model=s.SettingsOut)
def get_app_settings(request: Request, session: Session = Db, settings: Settings = Cfg,
                     provider=Depends(get_provider), embedder=Depends(get_embedder)):
    """Effective configuration. API keys are never included, only whether a provider is configured."""
    return _settings_out(request, session, settings, provider, embedder)


@router.put("/settings", response_model=s.SettingsOut)
def put_app_settings(body: rt.SettingsPatch, request: Request, session: Session = Db,
                     provider=Depends(get_provider), embedder=Depends(get_embedder)):
    """Save non-secret tuning values. Keys, providers and limits stay in environment variables."""
    has_docs = bool(session.scalar(select(func.count()).select_from(Document)))
    effective = rt.update_settings(session, request.app.state.settings, body, embedder is not None, has_docs)
    return _settings_out(request, session, effective, provider, embedder)


@router.delete("/settings", response_model=s.SettingsOut)
def reset_app_settings(request: Request, session: Session = Db, provider=Depends(get_provider), embedder=Depends(get_embedder)):
    has_docs = bool(session.scalar(select(func.count()).select_from(Document)))
    rt.reset_settings(session, request.app.state.settings, has_docs)
    return _settings_out(request, session, request.app.state.settings, provider, embedder)


@router.post("/documents/reindex")
def reindex_all(session: Session = Db, settings: Settings = Cfg, embedder=Depends(get_embedder)) -> dict:
    """Re-extract and re-chunk every document with the current chunk settings (and re-embed if configured)."""
    done = failed = 0
    for doc in session.scalars(select(Document).order_by(Document.id)).all():
        if not doc_svc.stored_path(settings, doc).exists():
            failed += 1
            continue
        result = doc_svc.process_document(session, settings, doc, embedder)
        failed += result.status == "failed"
        done += result.status != "failed"
    rt.clear_reindex_flag(session)
    return {"reindexed": done, "failed": failed}


@router.get("/suggestions")
def suggestions(collection_id: int | None = None, session: Session = Db) -> dict:
    items = suggest_questions(session, collection_id)
    return {"items": items, "note": "Suggested from distinctive words in your documents, not from understanding them."}


def _case_dict(c: EvalCase) -> dict:
    return {"id": f"case-{c.id}", "question": c.question, "answerable": c.answerable, "expected_facts": c.expected_facts or [],
            "expected_filename": c.expected_filename, "expected_pages": c.expected_pages or []}


@router.get("/evaluation/cases")
def list_eval_cases(session: Session = Db) -> dict:
    builtin = json.loads(DATASET.read_text(encoding="utf-8"))["cases"] if DATASET.exists() else []
    custom = session.scalars(select(EvalCase).order_by(EvalCase.id)).all()
    return {"builtin": builtin, "custom": [s.EvalCaseOut.model_validate(c) for c in custom]}


def _check_case(body: s.EvalCaseIn) -> None:
    if not body.answerable and (body.expected_facts or body.expected_pages or body.expected_filename):
        raise AppError("invalid_case", "A case that should be refused cannot have expected facts or sources.", 422)
    if body.expected_pages and not body.expected_filename:
        raise AppError("invalid_case", "Expected pages need an expected file name.", 422)


@router.post("/evaluation/cases", response_model=s.EvalCaseOut, status_code=201)
def create_eval_case(body: s.EvalCaseIn, session: Session = Db):
    _check_case(body)
    case = EvalCase(**body.model_dump())
    session.add(case)
    session.commit()
    return case


@router.put("/evaluation/cases/{case_id}", response_model=s.EvalCaseOut)
def update_eval_case(case_id: int, body: s.EvalCaseIn, session: Session = Db):
    _check_case(body)
    case = session.get(EvalCase, case_id)
    if not case:
        raise AppError("case_not_found", "Evaluation case not found.", 404)
    for key, value in body.model_dump().items():
        setattr(case, key, value)
    session.commit()
    return case


@router.delete("/evaluation/cases/{case_id}", status_code=204)
def delete_eval_case(case_id: int, session: Session = Db):
    case = session.get(EvalCase, case_id)
    if not case:
        raise AppError("case_not_found", "Evaluation case not found.", 404)
    session.delete(case)
    session.commit()
    return Response(status_code=204)


@router.post("/evaluation/run")
def run_evaluation(body: s.EvaluationRequest, session: Session = Db, settings: Settings = Cfg, embedder=Depends(get_embedder)):
    if body.target == "sample":
        if body.mode == "hybrid":
            raise AppError("invalid_evaluation", "The built-in sample has no semantic index. Evaluate 'My library' to test hybrid search.", 422)
        return run_builtin(settings, body.min_coverage, body.top_k)
    cases = [_case_dict(c) for c in session.scalars(select(EvalCase).order_by(EvalCase.id))]
    if not cases:
        raise AppError("no_cases", "Add at least one evaluation case for your library first.", 422)
    mode = body.mode or settings.retrieval_mode
    min_cosine = settings.min_cosine if body.min_cosine is None else body.min_cosine
    report = run_cases(session, settings, cases, min_coverage=body.min_coverage, top_k=body.top_k,
                       mode=mode, min_cosine=min_cosine, embedder=embedder if mode == "hybrid" else None)
    report["settings"] = {"min_coverage": settings.min_term_coverage if body.min_coverage is None else body.min_coverage,
                          "top_k": body.top_k or settings.top_k, "mode": mode, "min_cosine": min_cosine,
                          "target": "library"}
    return report


@router.post("/provider/test", response_model=s.ProviderTestOut)
def test_provider(request: Request, provider=Depends(get_provider), limiter=Depends(get_limiter)):
    """Make one tiny provider call so the user can confirm their key works. Always returns 200."""
    if provider is None:
        msg = request.app.state.ai_config_error or "No AI provider is configured; running in retrieval-only mode."
        return s.ProviderTestOut(ok=False, configured=False, message=msg)
    if not limiter.allow():
        return s.ProviderTestOut(ok=False, configured=True, provider=provider.label,
                                 message="Local AI request limit reached. Wait a minute and try again.")
    try:
        reply = provider.generate("Reply with the single word OK.", "Say OK.", 64)
    except ProviderError as exc:
        return s.ProviderTestOut(ok=False, configured=True, provider=provider.label, message=exc.message)
    return s.ProviderTestOut(ok=True, configured=True, provider=provider.label,
                             message=f"Connected. The provider replied ({len(reply.strip())} characters).")




# ---- embeddings (semantic index) ------------------------------------------
@router.get("/embeddings/status")
def embeddings_status(request: Request, session: Session = Db, embedder=Depends(get_embedder)) -> dict:
    cov = embedding_store.coverage(session, embedder.signature if embedder else None)
    return {"enabled": embedder is not None, "provider": embedder.label if embedder else None,
            "config_error": request.app.state.embedding_config_error,
            "documents": {str(k): {"embedded": e, "total": t} for k, (e, t) in cov.items()}}


@router.post("/documents/{document_id}/embed")
def embed_document_now(document_id: int, session: Session = Db, settings: Settings = Cfg,
                       embedder=Depends(get_embedder), limiter=Depends(get_limiter)) -> dict:
    doc = doc_svc.get_document(session, document_id)
    if embedder is None:
        raise AppError("embeddings_not_configured", "No embedding provider is configured. See Settings.", 409)
    if not limiter.allow():
        raise AppError("local_rate_limit", "Local AI request limit reached. Wait a minute and try again.", 429)
    try:
        added = embedding_store.embed_document(session, embedder, doc.id, settings.embedding_batch_size)
    except ProviderError as exc:
        raise AppError(exc.code, exc.message, 502) from exc
    embedded, total = embedding_store.coverage(session, embedder.signature).get(doc.id, (0, 0))
    return {"added": added, "embedded": embedded, "total": total}


@router.post("/embeddings/test", response_model=s.ProviderTestOut)
def test_embeddings(request: Request, embedder=Depends(get_embedder), limiter=Depends(get_limiter)):
    if embedder is None:
        msg = request.app.state.embedding_config_error or "No embedding provider is configured; using keyword search only."
        return s.ProviderTestOut(ok=False, configured=False, message=msg)
    if not limiter.allow():
        return s.ProviderTestOut(ok=False, configured=True, provider=embedder.label,
                                 message="Local AI request limit reached. Wait a minute and try again.")
    try:
        vector = embedder.embed(["connection test"], "query")[0]
    except ProviderError as exc:
        return s.ProviderTestOut(ok=False, configured=True, provider=embedder.label, message=exc.message)
    return s.ProviderTestOut(ok=True, configured=True, provider=embedder.label,
                             message=f"Connected. Received a {len(vector)}-dimensional vector.")
