import pymupdf
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.rag.chunking import chunk_pages, split_text
from app.rag.extraction import (
    ExtractedPage,
    extract_pages,
    normalize,
    validate_pdf_bytes,
)
from tests.conftest import make_pdf


def test_split_text_respects_size_and_overlap():
    text = " ".join(f"word{i}" for i in range(200))
    chunks = split_text(text, chunk_size=100, overlap=30)
    assert len(chunks) > 3
    assert all(len(c) <= 100 for c in chunks)
    for a, b in zip(chunks, chunks[1:]):
        assert set(a.split()[-2:]) & set(b.split()), "adjacent chunks should share overlap words"
    assert " ".join(chunks[0].split()[:1]) == "word0"
    assert chunks[-1].endswith("word199")


def test_split_text_rejects_bad_parameters():
    with pytest.raises(ValueError):
        split_text("a b c", 100, 100)
    with pytest.raises(ValueError):
        split_text("a b c", 0, 0)


def test_split_text_handles_oversized_word_and_empty():
    assert split_text("   ", 100, 10) == []
    assert split_text("x" * 500, 100, 10) == ["x" * 500]


def test_chunks_never_cross_pages_and_keep_metadata():
    pages = [ExtractedPage(1, "alpha beta gamma " * 30), ExtractedPage(2, "delta epsilon " * 30)]
    chunks = chunk_pages(pages, 120, 20)
    assert {c.page_number for c in chunks} == {1, 2}
    assert all(("delta" in c.text) == (c.page_number == 2) for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert all(len(c.content_hash) == 64 for c in chunks)


def test_normalize_cleans_whitespace():
    assert normalize("a \t b\x00\n\n\n\n c  ") == "a b\n\nc"


def test_validate_pdf_bytes_rejects_non_pdf():
    with pytest.raises(AppError) as err:
        validate_pdf_bytes(b"MZ not a pdf")
    assert err.value.code == "invalid_pdf"


def test_extract_pages_preserves_page_boundaries(tmp_path):
    path = tmp_path / "x.pdf"
    path.write_bytes(make_pdf(["first page text", "second page text"]))
    pages = extract_pages(str(path))
    assert [p.number for p in pages] == [1, 2]
    assert "first" in pages[0].text and "second" in pages[1].text


def test_extract_pages_corrupt_and_encrypted(tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.4\nthis is garbage")
    with pytest.raises(AppError) as err:
        extract_pages(str(bad))
    assert err.value.code == "corrupt_pdf"

    doc = pymupdf.open()
    doc.new_page().insert_text((50, 50), "secret")
    enc = tmp_path / "enc.pdf"
    doc.save(str(enc), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    with pytest.raises(AppError) as err:
        extract_pages(str(enc))
    assert err.value.code == "encrypted_pdf"


def test_settings_validation():
    with pytest.raises(ValueError):
        Settings(min_term_coverage=1.5)
    with pytest.raises(ValueError):
        Settings(top_k=0)
