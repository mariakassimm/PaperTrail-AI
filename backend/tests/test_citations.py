import dataclasses

import pytest

from app.core.config import Settings
from app.db.models import Chunk
from app.db.session import create_session_factory
from app.rag.citations import (
    build_citations,
    citation_is_valid,
    make_excerpt,
    validate_citations,
)
from app.rag.retrieval import retrieve
from app.services.documents import ingest_upload
from tests.conftest import SOLAR, make_pdf


@pytest.fixture
def session_and_citation(tmp_path):
    settings = Settings(data_dir=tmp_path)
    session = create_session_factory(settings)()
    ingest_upload(session, settings, "s.pdf", make_pdf(SOLAR))
    results = retrieve(session, "water consumption", top_k=3, min_coverage=0.5)
    citation = build_citations(results, "water consumption")[0]
    yield session, citation
    session.close()


def test_real_citation_is_valid(session_and_citation):
    session, c = session_and_citation
    assert citation_is_valid(session, c)
    assert session.get(Chunk, c.chunk_id).text.count(c.excerpt) >= 1


@pytest.mark.parametrize("change", [
    {"excerpt": "this sentence was invented by a model"},
    {"excerpt": ""},
    {"page_number": 99},
    {"document_id": 12345},
    {"chunk_id": 987654},
])
def test_tampered_citation_is_rejected(session_and_citation, change):
    session, c = session_and_citation
    bad = dataclasses.replace(c, **change)
    assert not citation_is_valid(session, bad)
    assert validate_citations(session, [bad, c]) == [c]


def test_excerpt_is_exact_substring_and_bounded():
    text = ("filler " * 100) + "the critical sentence about turbines " + ("tail " * 100)
    excerpt = make_excerpt(text, "turbines")
    assert excerpt in text and "turbine" in excerpt and len(excerpt) <= 350
    assert make_excerpt("short text", "x") == "short text"


def test_locate_span_ignores_whitespace_differences_and_finds_the_right_repeat():
    from app.rag.citations import locate_span
    page = "Intro line\nthe pump runs\nat night. The pump runs\nat night. End"
    start, end = locate_span(page, "The pump runs at night. End")
    assert page[start:end].split() == "The pump runs at night. End".split() and start > page.index("night.")
    assert locate_span(page, "pump runs at night.") == (page.index("pump"), page.index("night.") + len("night."))
    assert locate_span(page, "not on this page") is None and locate_span(page, "   ") is None


def test_chunk_endpoint_returns_exact_highlight_span_across_line_breaks(client):
    from tests.conftest import make_pdf, upload
    long_page = ("Field trials covered many farms across two seasons and recorded weather every day. "
                 "Irrigation reduced water consumption by thirty eight percent in these trials, "
                 "while tomato yields rose and the pump drew only forty watts from the panel.")
    upload(client, make_pdf([long_page]), "s.pdf")
    cid = client.post("/api/v1/ask", json={"question": "water consumption"}).json()["citations"][0]["chunk_id"]
    d = client.get(f"/api/v1/chunks/{cid}").json()
    assert "\n" in d["page_text"]  # the PDF really wraps lines, which is what used to break matching
    assert d["highlight_start"] is not None
    assert " ".join(d["page_text"][d["highlight_start"]:d["highlight_end"]].split()) == d["text"]
