"""Persist and query chunk embeddings (SQLite BLOBs + NumPy). Small enough for a 4 GB laptop:
1,000 chunks x 768 dims x 4 bytes is about 3 MB."""
import numpy as np
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import Chunk, ChunkEmbedding
from app.providers.embeddings import EmbeddingProvider

ID_BATCH = 5000  # keep IN (...) lists well under SQLite's variable limit


def normalise(vector: list[float]) -> np.ndarray:
    arr = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    return arr / norm if norm > 0 else arr


def embed_chunks(session: Session, embedder: EmbeddingProvider, chunks: list[Chunk], batch_size: int) -> int:
    """Embed `chunks` in small batches, committing after each so partial progress survives a failure."""
    done = 0
    for start in range(0, len(chunks), batch_size):
        batch = chunks[start:start + batch_size]
        vectors = embedder.embed([c.text for c in batch], "document")
        ids = [c.id for c in batch]
        session.execute(delete(ChunkEmbedding).where(ChunkEmbedding.chunk_id.in_(ids)))
        for chunk, vector in zip(batch, vectors):
            vec = normalise(vector)
            session.add(ChunkEmbedding(chunk_id=chunk.id, signature=embedder.signature, dim=len(vec), vector=vec.tobytes()))
        session.commit()
        done += len(batch)
    return done


def embed_document(session: Session, embedder: EmbeddingProvider, document_id: int, batch_size: int) -> int:
    """Embed only the chunks that lack a vector for the current model. Unchanged chunks are never re-embedded."""
    have = select(ChunkEmbedding.chunk_id).where(ChunkEmbedding.signature == embedder.signature)
    missing = list(session.scalars(select(Chunk).where(Chunk.document_id == document_id, Chunk.id.not_in(have))
                                   .order_by(Chunk.chunk_index)))
    return embed_chunks(session, embedder, missing, batch_size) if missing else 0


def coverage(session: Session, signature: str | None) -> dict[int, tuple[int, int]]:
    """{document_id: (embedded_chunks, total_chunks)} for the given vector space."""
    totals = dict(session.execute(select(Chunk.document_id, func.count()).group_by(Chunk.document_id)).all())
    embedded: dict[int, int] = {}
    if signature:
        rows = session.execute(
            select(Chunk.document_id, func.count()).join(ChunkEmbedding, ChunkEmbedding.chunk_id == Chunk.id)
            .where(ChunkEmbedding.signature == signature).group_by(Chunk.document_id)).all()
        embedded = dict(rows)
    return {doc_id: (embedded.get(doc_id, 0), total) for doc_id, total in totals.items()}


def load_vectors(session: Session, chunk_ids: list[int], signature: str) -> tuple[list[int], np.ndarray]:
    """Vectors for the given chunks in the given vector space. Returns (ids_with_vectors, matrix)."""
    ids: list[int] = []
    rows: list[np.ndarray] = []
    dim: int | None = None
    for start in range(0, len(chunk_ids), ID_BATCH):
        part = chunk_ids[start:start + ID_BATCH]
        for row in session.scalars(select(ChunkEmbedding).where(ChunkEmbedding.chunk_id.in_(part),
                                                                ChunkEmbedding.signature == signature)):
            vec = np.frombuffer(row.vector, dtype=np.float32)
            if dim is None:
                dim = row.dim
            if row.dim == dim and len(vec) == dim:
                ids.append(row.chunk_id)
                rows.append(vec)
    return ids, (np.vstack(rows) if rows else np.zeros((0, 0), dtype=np.float32))
