"""Split page text into overlapping, word-aligned chunks that never cross page boundaries."""
import hashlib
from dataclasses import dataclass

from app.rag.extraction import ExtractedPage


@dataclass(frozen=True)
class TextChunk:
    page_number: int
    chunk_index: int
    text: str
    content_hash: str


def split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if not 0 <= overlap < chunk_size:
        raise ValueError("overlap must be >= 0 and smaller than chunk_size")
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(words):
        end, length = start, 0
        while end < len(words) and (length + len(words[end]) + 1 <= chunk_size or end == start):
            length += len(words[end]) + 1
            end += 1
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        # Step back far enough to carry ~`overlap` characters into the next chunk.
        back, carried = end, 0
        while back > start + 1 and carried + len(words[back - 1]) + 1 <= overlap:
            back -= 1
            carried += len(words[back]) + 1
        start = back if back > start else end
    return chunks


def chunk_pages(pages: list[ExtractedPage], chunk_size: int, overlap: int) -> list[TextChunk]:
    result: list[TextChunk] = []
    for page in pages:
        for piece in split_text(page.text, chunk_size, overlap):
            digest = hashlib.sha256(piece.encode("utf-8")).hexdigest()
            result.append(TextChunk(page.number, len(result), piece, digest))
    return result
