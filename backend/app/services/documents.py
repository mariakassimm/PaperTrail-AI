import hashlib
import logging
import os
import re
import uuid
from pathlib import Path

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import Chunk, Collection, Document
from app.providers.base import ProviderError
from app.providers.embeddings import EmbeddingProvider
from app.rag.chunking import chunk_pages
from app.rag.embedding_store import embed_document
from app.rag.extraction import extract_pages, validate_pdf_bytes

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_filename(raw: str | None) -> str:
    """Display-only name. Stored files always use generated names, never this value."""
    name = os.path.basename((raw or "").replace("\\", "/"))
    name = _CONTROL.sub("", name).strip()[:200]
    return name or "document.pdf"


def stored_path(settings: Settings, doc: Document) -> Path:
    return settings.upload_dir / doc.stored_name


logger = logging.getLogger("papertrail.documents")


def ingest_upload(session: Session, settings: Settings, raw_filename: str | None, data: bytes,
                  embedder: EmbeddingProvider | None = None) -> Document:
    if not data:
        raise AppError("empty_file", "The uploaded file is empty.", 400)
    if len(data) > settings.max_upload_bytes:
        raise AppError("file_too_large", f"File exceeds the {settings.max_upload_mb} MB limit.", 413)
    validate_pdf_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    existing = session.scalar(select(Document).where(Document.sha256 == digest))
    if existing:
        raise AppError(
            "duplicate_document",
            f"This file was already uploaded as '{existing.title}' (id {existing.id}).",
            409,
        )
    filename = clean_filename(raw_filename)
    doc = Document(
        title=Path(filename).stem or filename,
        filename=filename,
        stored_name=f"{uuid.uuid4().hex}.pdf",
        sha256=digest,
        size_bytes=len(data),
        status="queued",
    )
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    stored_path(settings, doc).write_bytes(data)
    session.add(doc)
    session.commit()
    return process_document(session, settings, doc, embedder)


def process_document(session: Session, settings: Settings, doc: Document,
                     embedder: EmbeddingProvider | None = None) -> Document:
    """Extract, chunk and index a stored PDF. Failures are recorded on the document."""
    doc.status, doc.status_message = "processing", ""
    session.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    session.commit()
    try:
        pages = extract_pages(str(stored_path(settings, doc)))
        doc.page_count = len(pages)
        text_pages = [p for p in pages if p.text]
        if not text_pages:
            raise AppError(
                "no_extractable_text",
                "No extractable text found. The PDF may be scanned images; OCR is not supported.",
                422,
            )
        chunks = chunk_pages(text_pages, settings.chunk_size, settings.chunk_overlap)
        session.add_all(
            Chunk(document_id=doc.id, page_number=c.page_number, chunk_index=c.chunk_index,
                  text=c.text, content_hash=c.content_hash)
            for c in chunks
        )
        empty = len(pages) - len(text_pages)
        if empty:
            doc.status = "partially_extracted"
            doc.status_message = f"{empty} of {len(pages)} pages had no extractable text."
        else:
            doc.status = "indexed"
    except AppError as exc:
        doc.status, doc.status_message = "failed", exc.message
    except Exception:
        doc.status, doc.status_message = "failed", "Unexpected error while processing this PDF."
    session.commit()
    if embedder is not None and settings.auto_embed and doc.status in ("indexed", "partially_extracted"):
        try:
            embed_document(session, embedder, doc.id, settings.embedding_batch_size)
        except Exception as exc:  # noqa: BLE001 - embedding is optional; keyword indexing already succeeded
            reason = exc.message if isinstance(exc, ProviderError) else "Unexpected error."
            logger.warning("Embedding failed for document %s: %s", doc.id, getattr(exc, "code", "error"))
            doc.status_message = f"{doc.status_message} Semantic index unavailable: {reason} Keyword search still works.".strip()
            session.commit()
    return doc


def get_document(session: Session, document_id: int) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise AppError("document_not_found", "Document not found.", 404)
    return doc


def list_documents(
    session: Session, *, q: str | None, status: str | None, collection_id: int | None,
    sort: str, page: int, page_size: int,
) -> tuple[list[Document], int]:
    stmt = select(Document)
    if q:
        like = f"%{q}%"
        in_text = select(Chunk.document_id).where(Chunk.text.ilike(like))
        stmt = stmt.where(or_(Document.title.ilike(like), Document.filename.ilike(like),
                              Document.id.in_(in_text)))
    if status:
        stmt = stmt.where(Document.status == status)
    if collection_id is not None:
        stmt = stmt.where(Document.collection_id == collection_id)
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {"newest": Document.created_at.desc(), "oldest": Document.created_at.asc(),
             "title": Document.title.asc(), "size": Document.size_bytes.desc()}[sort]
    rows = session.scalars(stmt.order_by(order, Document.id).offset((page - 1) * page_size).limit(page_size)).all()
    return list(rows), total


def update_document(session: Session, doc: Document, title: str | None,
                    collection_id: int | None, clear_collection: bool) -> Document:
    if title is not None:
        doc.title = title.strip()[:300] or doc.title
    if clear_collection:
        doc.collection_id = None
    elif collection_id is not None:
        if not session.get(Collection, collection_id):
            raise AppError("collection_not_found", "Collection not found.", 404)
        doc.collection_id = collection_id
    session.commit()
    return doc


def delete_document(session: Session, settings: Settings, doc: Document) -> None:
    path = stored_path(settings, doc)
    session.delete(doc)  # chunks removed via cascade
    session.commit()
    path.unlink(missing_ok=True)
