"""Lexical (keyword) retrieval with BM25. This is NOT semantic search."""
import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document
from app.providers.base import ProviderError
from app.providers.embeddings import EmbeddingProvider
from app.rag.embedding_store import load_vectors, normalise

STOPWORDS = frozenset(
    ["a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "s", "so", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "where", "which", "who", "whom", "why", "will", "with", "would", "you", "your", "about", "tell"]
)
_TOKEN = re.compile(r"[a-z0-9]+")
SEARCHABLE_STATUSES = ("indexed", "partially_extracted")


def _stem(token: str) -> str:
    # Deliberately tiny plural stemmer; keeps behaviour easy to reason about.
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    return [_stem(t) for t in _TOKEN.findall(text.lower()) if t not in STOPWORDS and len(t) > 1]


@dataclass(frozen=True)
class ScoredChunk:
    chunk: Chunk
    document: Document
    score: float
    coverage: float  # fraction of distinct query terms present in the chunk
    cosine: float | None = None
    matched_by: str = "keyword"  # keyword | meaning | both


def load_scope(
    session: Session, collection_id: int | None, document_ids: list[int] | None
) -> list[tuple[Chunk, Document]]:
    """Only chunks from searchable documents inside the requested scope are ever returned."""
    stmt = (
        select(Chunk, Document)
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.status.in_(SEARCHABLE_STATUSES))
    )
    if collection_id is not None:
        stmt = stmt.where(Document.collection_id == collection_id)
    if document_ids:
        stmt = stmt.where(Document.id.in_(document_ids))
    return [(c, d) for c, d in session.execute(stmt).all()]


def bm25_rank(
    corpus: list[tuple[Chunk, Document]],
    query: str,
    top_k: int,
    min_coverage: float,
    k1: float = 1.5,
    b: float = 0.75,
    context: str | None = None,
) -> list[ScoredChunk]:
    query_terms = sorted(set(tokenize(query)))
    # Earlier-turn terms help ranking (weight 0.5) but never count towards the coverage/evidence test.
    context_terms = sorted(set(tokenize(context or "")) - set(query_terms))
    if not query_terms or not corpus:
        return []
    doc_tokens = [tokenize(chunk.text) for chunk, _ in corpus]
    n_docs = len(corpus)
    avg_len = sum(len(t) for t in doc_tokens) / n_docs or 1.0
    doc_freq = Counter(term for tokens in doc_tokens for term in set(tokens))
    scored: list[ScoredChunk] = []
    for (chunk, document), tokens in zip(corpus, doc_tokens):
        freqs = Counter(tokens)
        present = [t for t in query_terms if freqs[t] > 0]
        coverage = len(present) / len(query_terms)
        if coverage < min_coverage or not present:
            continue
        score = 0.0
        weighted = [(t, 1.0) for t in present] + [(t, 0.5) for t in context_terms if freqs[t] > 0]
        for term, weight in weighted:
            idf = math.log(1 + (n_docs - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5))
            tf = freqs[term]
            score += weight * idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len(tokens) / avg_len))
        scored.append(ScoredChunk(chunk, document, score, coverage))
    scored.sort(key=lambda s: (-s.score, s.chunk.id))
    return scored[:top_k]


def retrieve(
    session: Session,
    query: str,
    *,
    top_k: int,
    min_coverage: float,
    collection_id: int | None = None,
    document_ids: list[int] | None = None,
) -> list[ScoredChunk]:
    corpus = load_scope(session, collection_id, document_ids)
    return bm25_rank(corpus, query, top_k, min_coverage)


RRF_K = 60  # standard reciprocal-rank-fusion constant


@dataclass
class RetrievalOutcome:
    results: list[ScoredChunk]
    mode_used: str  # keyword | hybrid
    notice: str | None = None
    semantic_error: str | None = field(default=None, repr=False)


def semantic_rank(session: Session, corpus: list[tuple[Chunk, Document]], query_vector: list[float],
                  signature: str, limit: int, min_cosine: float) -> tuple[list[tuple[Chunk, Document, float]], int]:
    """Cosine ranking over chunks that have vectors. Returns (hits, number_of_chunks_with_vectors)."""
    by_id = {c.id: (c, d) for c, d in corpus}
    ids, matrix = load_vectors(session, list(by_id), signature)
    if not ids:
        return [], 0
    q = normalise(query_vector)
    if q.shape[0] != matrix.shape[1]:  # vectors from a different-size space: never compare
        return [], 0
    sims = matrix @ q
    order = np.argsort(-sims)[:limit]
    hits = [(*by_id[ids[i]], float(sims[i])) for i in order if sims[i] >= min_cosine]
    return hits, len(ids)


def retrieve_hybrid(
    session: Session, query: str, *, top_k: int, min_coverage: float,
    collection_id: int | None = None, document_ids: list[int] | None = None,
    context_query: str | None = None, embedder: EmbeddingProvider | None = None,
    mode: str = "keyword", min_cosine: float = 0.62,
) -> RetrievalOutcome:
    """Keyword (BM25) retrieval, optionally fused with embedding similarity via reciprocal rank fusion.

    A passage counts as evidence if it passes the keyword coverage test OR the cosine threshold.
    Any semantic failure degrades to keyword search with an explanatory notice; it never raises.
    """
    corpus = load_scope(session, collection_id, document_ids)
    pool = max(top_k * 4, 20)
    keyword = bm25_rank(corpus, query, pool, min_coverage, context=context_query)
    if mode != "hybrid":
        return RetrievalOutcome(keyword[:top_k], "keyword")
    if embedder is None:
        return RetrievalOutcome(keyword[:top_k], "keyword", "Semantic search is not configured, so keyword search was used.")
    try:
        text = f"{context_query} {query}" if context_query else query
        qvec = embedder.embed([text], "query")[0]
    except ProviderError as exc:
        return RetrievalOutcome(keyword[:top_k], "keyword", f"{exc.message} Keyword search was used instead.")
    semantic, embedded = semantic_rank(session, corpus, qvec, embedder.signature, pool, min_cosine)

    fused: dict[int, dict] = {}
    for rank, item in enumerate(keyword, start=1):
        fused[item.chunk.id] = {"item": item, "rrf": 1 / (RRF_K + rank), "cos": None, "kw": True}
    for rank, (chunk, doc, cos) in enumerate(semantic, start=1):
        entry = fused.setdefault(chunk.id, {"item": ScoredChunk(chunk, doc, 0.0, 0.0), "rrf": 0.0, "cos": None, "kw": False})
        entry["rrf"] += 1 / (RRF_K + rank)
        entry["cos"] = cos
    ranked = sorted(fused.values(), key=lambda e: (-e["rrf"], e["item"].chunk.id))[:top_k]
    results = [ScoredChunk(e["item"].chunk, e["item"].document, round(e["rrf"], 5), e["item"].coverage, e["cos"],
                           "both" if e["kw"] and e["cos"] is not None else "keyword" if e["kw"] else "meaning")
               for e in ranked]
    notice = None
    if embedded == 0 and corpus:
        notice = "These documents have no semantic index yet, so keyword search was used. Use 'Embed now' in My Documents."
    elif embedded < len(corpus):
        notice = f"The semantic index covers {embedded} of {len(corpus)} passages; the rest were matched by keyword only."
    return RetrievalOutcome(results, "hybrid" if embedded else "keyword", notice)
