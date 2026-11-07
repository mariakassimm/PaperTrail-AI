"""PDF validation and per-page text extraction (PyMuPDF). No OCR is performed."""
import re
from dataclasses import dataclass

import pymupdf  # PyMuPDF

from app.core.errors import AppError

PDF_MAGIC = b"%PDF-"
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class ExtractedPage:
    number: int  # 1-based
    text: str


def validate_pdf_bytes(data: bytes) -> None:
    if not data.startswith(PDF_MAGIC):
        raise AppError("invalid_pdf", "The file is not a valid PDF (missing PDF header).", 415)


def normalize(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\x00", "")
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANKS.sub("\n\n", text).strip()


def extract_pages(path: str) -> list[ExtractedPage]:
    """Return one ExtractedPage per PDF page (text may be empty for image-only pages)."""
    try:
        doc = pymupdf.open(path)
    except Exception as exc:  # PyMuPDF raises several types for corrupt files
        raise AppError("corrupt_pdf", "The PDF is corrupted and could not be opened.", 422) from exc
    with doc:
        if doc.needs_pass:
            raise AppError("encrypted_pdf", "The PDF is password-protected and cannot be read.", 422)
        pages: list[ExtractedPage] = []
        for index in range(doc.page_count):
            try:
                text = normalize(doc[index].get_text("text"))
            except Exception:
                text = ""
            pages.append(ExtractedPage(number=index + 1, text=text))
        return pages
