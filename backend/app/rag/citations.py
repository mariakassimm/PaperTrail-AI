"""Build citations from retrieved chunks and verify them against stored text."""
import re
from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from app.db.models import Chunk
from app.rag.retrieval import ScoredChunk, tokenize

EXCERPT_CHARS = 350


@dataclass(frozen=True)
class Citation:
    chunk_id: int
    document_id: int
    document_title: str
    filename: str
    page_number: int
    excerpt: str  # always an exact substring of the stored chunk
    score: float
    matched_by: str = "keyword"  # keyword | meaning | both

    def to_dict(self) -> dict:
        return asdict(self)


def make_excerpt(text: str, query: str, limit: int = EXCERPT_CHARS) -> str:
    """Exact substring of `text`, centred on the first query term that occurs in it."""
    if len(text) <= limit:
        return text
    lowered = text.lower()
    positions = [i for t in set(tokenize(query)) if (i := lowered.find(t)) >= 0]
    centre = min(positions) if positions else 0
    start = max(0, centre - limit // 4)
    end = min(len(text), start + limit)
    start = max(0, end - limit)
    # Snap to word boundaries without leaving the original string.
    if start > 0 and (gap := text.find(" ", start)) != -1 and gap < start + 40:
        start = gap + 1
    if end < len(text) and (gap := text.rfind(" ", start, end)) > start:
        end = gap
    return text[start:end]


def locate_span(page_text: str, chunk_text: str) -> tuple[int, int] | None:
    """Character span of `chunk_text` inside `page_text`, ignoring differences in whitespace.

    Chunks are contiguous runs of the page's words joined by single spaces, so we match word-for-word.
    """
    words = chunk_text.split()
    if not words:
        return None
    spans = [(m.start(), m.end(), m.group()) for m in re.finditer(r"\S+", page_text)]
    first, count = words[0], len(words)
    for i in range(len(spans) - count + 1):
        if spans[i][2] == first and [s[2] for s in spans[i:i + count]] == words:
            return spans[i][0], spans[i + count - 1][1]
    return None


def build_citations(results: list[ScoredChunk], query: str) -> list[Citation]:
    return [
        Citation(
            chunk_id=r.chunk.id,
            document_id=r.document.id,
            document_title=r.document.title,
            filename=r.document.filename,
            page_number=r.chunk.page_number,
            excerpt=make_excerpt(r.chunk.text, query),
            score=round(r.score, 5),
            matched_by=r.matched_by,
        )
        for r in results
    ]


def citation_is_valid(session: Session, citation: Citation | dict) -> bool:
    data = citation.to_dict() if isinstance(citation, Citation) else citation
    chunk = session.get(Chunk, data["chunk_id"])
    return bool(
        chunk
        and chunk.document_id == data["document_id"]
        and chunk.page_number == data["page_number"]
        and data["excerpt"]
        and data["excerpt"] in chunk.text
    )


def validate_citations(session: Session, citations: list[Citation]) -> list[Citation]:
    """Drop any citation that does not map to a real stored passage."""
    return [c for c in citations if citation_is_valid(session, c)]
