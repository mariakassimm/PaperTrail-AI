import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.models import Chunk, ChunkEmbedding
from app.db.session import create_session_factory
from app.main import create_app
from app.providers.base import ProviderError
from app.providers.embeddings import GeminiEmbeddings, OpenAICompatEmbeddings
from app.providers.factory import build_embedder
from app.rag import embedding_store
from app.rag.answering import answer_question
from app.rag.retrieval import retrieve_hybrid
from app.services.documents import delete_document, ingest_upload
from tests.conftest import make_pdf, upload
from tests.fakes import FakeEmbedder

KEY = "AIzaSy-SUPER-SECRET-KEY-123"
PRICE = ["The average cost was 140 US dollars per installation with a payback of 14 months."]
BREAD = ["Sourdough bread needs flour, water and salt, plus a mature starter."]


def gemini(handler, model="gemini-embedding-001", dims=768):
    return GeminiEmbeddings(KEY, model, "https://example.test/v1beta", dims, 5, httpx.MockTransport(handler))


# ---------------- provider adapters (mocked HTTP) ----------------
def test_gemini_embedding_request_matches_documented_contract():
    seen = {}

    def handler(request):
        seen.update(url=str(request.url), key=request.headers["x-goog-api-key"], body=json.loads(request.content))
        return httpx.Response(200, json={"embeddings": [{"values": [0.1, 0.2]}, {"values": [0.3, 0.4]}]})

    vectors = gemini(handler, dims=256).embed(["a", "b"], "document")
    assert vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert seen["url"] == "https://example.test/v1beta/models/gemini-embedding-001:batchEmbedContents"
    assert seen["key"] == KEY and KEY not in seen["url"] and KEY not in json.dumps(seen["body"])
    first = seen["body"]["requests"][0]
    assert first["model"] == "models/gemini-embedding-001" and first["content"] == {"parts": [{"text": "a"}]}
    assert first["taskType"] == "RETRIEVAL_DOCUMENT" and first["output_dimensionality"] == 256
    gemini(lambda r: (seen.update(body=json.loads(r.content)) or httpx.Response(200, json={"embeddings": [{"values": [1.0]}]})))\
        .embed(["q"], "query")
    assert seen["body"]["requests"][0]["taskType"] == "RETRIEVAL_QUERY"


def test_gemini_embedding_2_gets_no_task_type():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"embeddings": [{"values": [1.0]}]})

    gemini(handler, model="gemini-embedding-2").embed(["x"], "document")
    assert "taskType" not in seen["body"]["requests"][0]  # Google: task_type cannot be used with gemini-embedding-2


@pytest.mark.parametrize("status,code", [(403, "provider_auth"), (404, "provider_model_not_found"), (429, "provider_quota"), (503, "provider_unavailable")])
def test_embedding_http_errors_are_friendly_and_never_leak_the_key(status, code):
    with pytest.raises(ProviderError) as err:
        gemini(lambda r: httpx.Response(status, json={"error": {"message": f"x {KEY}"}})).embed(["a"], "query")
    assert err.value.code == code and KEY not in err.value.message


@pytest.mark.parametrize("body", [{}, {"embeddings": []}, {"embeddings": [{"values": []}]}, {"embeddings": [{"values": ["a"]}]},
                                  {"embeddings": [{"values": [1.0]}, {"values": [1.0, 2.0]}]}, {"embeddings": "nope"}])
def test_malformed_embedding_responses_are_rejected(body):
    with pytest.raises(ProviderError) as err:
        gemini(lambda r: httpx.Response(200, json=body)).embed(["a", "b"] if len(body.get("embeddings", [])) == 2 else ["a"], "query")
    assert err.value.code == "provider_bad_response"


def test_embedding_count_mismatch_is_rejected():
    with pytest.raises(ProviderError):
        gemini(lambda r: httpx.Response(200, json={"embeddings": [{"values": [1.0]}]})).embed(["a", "b"], "document")


def test_openai_compat_embeddings_orders_by_index():
    seen = {}

    def handler(request):
        seen.update(url=str(request.url), auth=request.headers["authorization"], body=json.loads(request.content))
        return httpx.Response(200, json={"data": [{"index": 1, "embedding": [2.0, 2.0]}, {"index": 0, "embedding": [1.0, 1.0]}]})

    provider = OpenAICompatEmbeddings("sk-1", "emb-model", "https://r.test/v1/", 5, httpx.MockTransport(handler))
    assert provider.embed(["a", "b"], "document") == [[1.0, 1.0], [2.0, 2.0]]
    assert seen["url"] == "https://r.test/v1/embeddings" and seen["body"] == {"model": "emb-model", "input": ["a", "b"]}
    assert provider.signature == "openai_compat:emb-model"


def test_embedder_factory_and_signature_changes_with_model_or_dimension():
    assert build_embedder(Settings()) == (None, None)
    assert "GEMINI_API_KEY" in build_embedder(Settings(embedding_provider="gemini"))[1]
    assert "EMBEDDING_MODEL" in build_embedder(Settings(embedding_provider="openai_compat", openai_api_key="k"))[1]
    a = build_embedder(Settings(embedding_provider="gemini", gemini_api_key="k"))[0]
    b = build_embedder(Settings(embedding_provider="gemini", gemini_api_key="k", embedding_dimensions=256))[0]
    assert a.signature != b.signature


# ---------------- store ----------------
@pytest.fixture
def env(tmp_path):
    settings = Settings(data_dir=tmp_path, retrieval_mode="hybrid", min_cosine=0.5)
    session = create_session_factory(settings)()
    yield session, settings
    session.close()


def index(env, pages, name, embedder=None):
    session, settings = env
    return ingest_upload(session, settings, name, make_pdf(pages), embedder)


def test_vectors_are_normalised_and_only_missing_chunks_are_embedded(env):
    session, settings = env
    emb = FakeEmbedder()
    doc = index(env, PRICE, "price.pdf", emb)
    row = session.query(ChunkEmbedding).one()
    import numpy as np
    assert abs(float(np.linalg.norm(np.frombuffer(row.vector, dtype=np.float32))) - 1.0) < 1e-5
    n_calls = len(emb.calls)
    assert embedding_store.embed_document(session, emb, doc.id, 32) == 0 and len(emb.calls) == n_calls  # no re-embedding
    other = FakeEmbedder(signature="fake:other:32")  # a different model re-embeds everything
    assert embedding_store.embed_document(session, other, doc.id, 32) == 1


def test_embedding_is_batched(env):
    session, settings = env
    emb = FakeEmbedder()
    doc = index(env, ["word " * 400] * 3, "long.pdf")
    n = session.query(Chunk).filter_by(document_id=doc.id).count()
    assert n > 2 and embedding_store.embed_document(session, emb, doc.id, 2) == n
    assert all(size <= 2 for size, _ in emb.calls) and len(emb.calls) == -(-n // 2)


def test_deleting_a_document_removes_its_vectors_and_file(env):
    session, settings = env
    doc = index(env, PRICE, "price.pdf", FakeEmbedder())
    assert session.query(ChunkEmbedding).count() == 1
    delete_document(session, settings, doc)
    assert session.query(ChunkEmbedding).count() == 0 and list(settings.upload_dir.iterdir()) == []


# ---------------- hybrid retrieval ----------------
QUESTION = "What is the price of setup?"  # shares no words with PRICE


def test_semantic_search_finds_a_paraphrase_that_keyword_search_misses(env):
    session, settings = env
    emb = FakeEmbedder()
    index(env, PRICE, "price.pdf", emb)
    index(env, BREAD, "bread.pdf", emb)
    keyword = answer_question(session, settings, QUESTION, mode="keyword", embedder=emb)
    assert keyword.status == "insufficient_evidence"  # BM25 alone abstains: the honest limitation we are fixing
    hybrid = answer_question(session, settings, QUESTION, mode="hybrid", embedder=emb)
    assert hybrid.status == "answered" and hybrid.retrieval == "hybrid"
    assert [c.filename for c in hybrid.citations] == ["price.pdf"]  # the bread document is not dragged in
    assert hybrid.citations[0].matched_by == "meaning"


def test_passages_found_by_both_methods_are_labelled_and_rank_first(env):
    session, settings = env
    emb = FakeEmbedder()
    index(env, PRICE, "price.pdf", emb)
    out = retrieve_hybrid(session, "installation cost", top_k=5, min_coverage=0.5, embedder=emb, mode="hybrid", min_cosine=0.5)
    assert out.results[0].matched_by == "both" and out.mode_used == "hybrid"


def test_cosine_threshold_controls_what_counts_as_evidence(env):
    session, settings = env
    emb = FakeEmbedder()
    index(env, PRICE, "price.pdf", emb)
    strict = retrieve_hybrid(session, QUESTION, top_k=5, min_coverage=0.5, embedder=emb, mode="hybrid", min_cosine=0.95)
    assert strict.results == []
    assert retrieve_hybrid(session, QUESTION, top_k=5, min_coverage=0.5, embedder=emb, mode="hybrid", min_cosine=0.3).results


def test_semantic_search_respects_collection_scope(env):
    from app.db.models import Collection
    session, settings = env
    emb = FakeEmbedder()
    price = index(env, PRICE, "price.pdf", emb)
    index(env, BREAD, "bread.pdf", emb)
    col = Collection(name="C")
    session.add(col)
    session.commit()
    price.collection_id = col.id
    session.commit()
    other = Collection(name="Other")
    session.add(other)
    session.commit()
    assert retrieve_hybrid(session, QUESTION, top_k=5, min_coverage=0.5, collection_id=other.id, embedder=emb, mode="hybrid", min_cosine=0.3).results == []
    assert retrieve_hybrid(session, QUESTION, top_k=5, min_coverage=0.5, collection_id=col.id, embedder=emb, mode="hybrid", min_cosine=0.3).results


def test_query_time_provider_failure_degrades_to_keyword_with_a_notice(env):
    session, settings = env
    good = FakeEmbedder()
    index(env, PRICE, "price.pdf", good)
    broken = FakeEmbedder(fail_with=ProviderError("provider_quota", "Gemini free-tier quota or rate limit reached."))
    r = answer_question(session, settings, "installation cost", mode="hybrid", embedder=broken)
    assert r.status == "answered" and r.retrieval == "keyword"  # BM25 still answers; nothing crashed
    assert "quota" in r.notice and "Keyword search was used instead" in r.notice


def test_notices_for_missing_or_partial_semantic_index(env):
    session, settings = env
    index(env, PRICE, "price.pdf")  # indexed without an embedder
    emb = FakeEmbedder()
    r = answer_question(session, settings, "installation cost", mode="hybrid", embedder=emb)
    assert r.retrieval == "keyword" and "no semantic index" in r.notice
    index(env, BREAD, "bread.pdf", emb)  # now only some passages have vectors
    r = answer_question(session, settings, "installation cost", mode="hybrid", embedder=emb)
    assert r.retrieval == "hybrid" and "covers 1 of 2" in r.notice
    r = answer_question(session, settings, "installation cost", mode="hybrid", embedder=None)
    assert r.retrieval == "keyword" and "not configured" in r.notice


def test_vectors_from_another_model_are_never_compared(env):
    session, settings = env
    index(env, PRICE, "price.pdf", FakeEmbedder(signature="fake:old:32"))
    r = answer_question(session, settings, QUESTION, mode="hybrid", embedder=FakeEmbedder(signature="fake:new:32"))
    assert r.status == "insufficient_evidence"  # old vectors ignored instead of producing garbage similarity


def test_keyword_mode_never_calls_the_embedder(env):
    session, settings = env
    emb = FakeEmbedder()
    index(env, PRICE, "price.pdf", emb)
    emb.calls.clear()
    answer_question(session, settings, "installation cost", mode="keyword", embedder=emb)
    assert emb.calls == []


# ---------------- indexing-time behaviour ----------------
def test_embedding_failure_at_upload_keeps_the_document_searchable_by_keyword(env):
    session, settings = env
    broken = FakeEmbedder(fail_with=ProviderError("provider_quota", "Quota reached."), fail_documents=True)
    doc = index(env, PRICE, "price.pdf", broken)
    assert doc.status == "indexed" and "Semantic index unavailable: Quota reached." in doc.status_message
    assert answer_question(session, settings, "installation cost", mode="keyword").status == "answered"


def test_auto_embed_can_be_turned_off(tmp_path):
    settings = Settings(data_dir=tmp_path, auto_embed=False)
    session = create_session_factory(settings)()
    emb = FakeEmbedder()
    ingest_upload(session, settings, "p.pdf", make_pdf(PRICE), emb)
    assert emb.calls == [] and session.query(ChunkEmbedding).count() == 0


# ---------------- API ----------------
@pytest.fixture
def hybrid_client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, retrieval_mode="hybrid", min_cosine=0.5))
    app.state.embedder = FakeEmbedder()
    with TestClient(app) as c:
        yield c


def test_api_hybrid_flow_status_ask_search_and_embed_now(hybrid_client):
    c = hybrid_client
    health = c.get("/api/v1/health").json()
    assert health["semantic"] is True and health["embedding_provider"] == "fake (concepts-v1)"
    doc = upload(c, make_pdf(PRICE), "price.pdf").json()
    status = c.get("/api/v1/embeddings/status").json()
    assert status["enabled"] and status["documents"][str(doc["id"])] == {"embedded": 1, "total": 1}
    r = c.post("/api/v1/ask", json={"question": QUESTION}).json()
    assert r["status"] == "answered" and r["retrieval"] == "hybrid" and r["citations"][0]["matched_by"] == "meaning"
    s = c.get("/api/v1/search", params={"q": QUESTION}).json()
    assert s["search_type"].startswith("hybrid") and s["passages"]
    assert c.post(f"/api/v1/documents/{doc['id']}/embed").json() == {"added": 0, "embedded": 1, "total": 1}
    assert c.post("/api/v1/embeddings/test").json()["ok"] is True


def test_api_embedding_endpoints_without_a_provider(client):
    assert client.get("/api/v1/health").json()["semantic"] is False
    assert client.get("/api/v1/embeddings/status").json()["enabled"] is False
    assert client.post("/api/v1/embeddings/test").json()["configured"] is False
    doc = upload(client, make_pdf(PRICE), "p.pdf").json()
    r = client.post(f"/api/v1/documents/{doc['id']}/embed")
    assert r.status_code == 409 and r.json()["error"]["code"] == "embeddings_not_configured"
    r = client.post("/api/v1/ask", json={"question": "installation cost"}).json()
    assert r["retrieval"] == "keyword"


def test_api_embed_now_reports_provider_failures_as_502_without_secrets(hybrid_client):
    c = hybrid_client
    c.app.state.embedder = FakeEmbedder(fail_with=ProviderError("provider_auth", "Gemini rejected the API key."), fail_documents=True)
    doc = upload(c, make_pdf(PRICE), "p.pdf").json()
    assert "Semantic index unavailable" in doc["status_message"]
    r = c.post(f"/api/v1/documents/{doc['id']}/embed")
    assert r.status_code == 502 and r.json()["error"]["code"] == "provider_auth"
    assert c.post("/api/v1/embeddings/test").json()["ok"] is False
