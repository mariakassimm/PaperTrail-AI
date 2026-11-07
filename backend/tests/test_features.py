import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import make_pdf, upload
from tests.fakes import FakeEmbedder
from tests.test_ai_answering import FakeProvider

PUMP = ["The pump runs at night. The pump uses forty watts. The pump is submersible and the pump is cheap to service."]
LONG = ["Irrigation reduces water use. " * 120]


def put(client, **body):
    return client.put("/api/v1/settings", json=body)


# ---------------- editable settings ----------------
def test_settings_report_defaults_overrides_and_available_modes(client):
    body = client.get("/api/v1/settings").json()
    assert body["overridden"] == [] and body["defaults"]["top_k"] == 5 and body["retrieval_modes"] == ["keyword"]
    assert body["reindex_needed"] is False and body["ai_enabled"] is True


def test_saved_settings_change_behaviour_and_survive_a_restart(tmp_path):
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings)) as c:
        upload(c, make_pdf(["pump " * 5 + "filler " * 300, "pump station notes " * 3, "pump rooms " * 3]), "a.pdf")
        many = c.post("/api/v1/ask", json={"question": "pump"}).json()["citations"]
        assert len(many) >= 2
        out = put(c, top_k=1, min_term_coverage=1.0).json()
        assert out["top_k"] == 1 and out["overridden"] == ["min_term_coverage", "top_k"]
        assert len(c.post("/api/v1/ask", json={"question": "pump"}).json()["citations"]) == 1
    with TestClient(create_app(settings)) as c:  # restart: overrides come back from SQLite
        assert c.get("/api/v1/settings").json()["top_k"] == 1


@pytest.mark.parametrize("body", [{"top_k": 0}, {"top_k": 99}, {"top_k": 2.5}, {"top_k": "3"}, {"min_term_coverage": 1.5},
                                  {"min_cosine": -0.1}, {"chunk_size": 50}, {"chunk_size": 900, "chunk_overlap": 900},
                                  {"retrieval_mode": "semantic"}, {"ai_enabled": "yes"}, {"top_k": True}])
def test_invalid_settings_are_rejected_without_saving(client, body):
    assert put(client, **body).status_code == 422
    assert client.get("/api/v1/settings").json()["overridden"] == []


def test_overlap_is_checked_against_the_effective_chunk_size(client):
    assert put(client, chunk_size=300).status_code == 200
    r = put(client, chunk_overlap=400)  # only overlap sent; 400 >= the saved 300
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_settings"


def test_hybrid_mode_requires_an_embedding_provider(client):
    r = put(client, retrieval_mode="hybrid")
    assert r.status_code == 422 and r.json()["error"]["code"] == "embeddings_not_configured"
    assert client.get("/api/v1/settings").json()["retrieval_mode"] == "keyword (BM25)"


def test_hybrid_can_be_enabled_when_embeddings_exist(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, min_cosine=0.5))
    app.state.embedder = FakeEmbedder()
    with TestClient(app) as c:
        assert c.get("/api/v1/settings").json()["retrieval_modes"] == ["keyword", "hybrid"]
        assert put(c, retrieval_mode="hybrid").json()["retrieval_mode"].startswith("hybrid")
        upload(c, make_pdf(["The average cost was 140 US dollars per installation."]), "p.pdf")
        assert c.post("/api/v1/ask", json={"question": "What is the price of setup?"}).json()["retrieval"] == "hybrid"


def test_reset_restores_environment_defaults(client):
    put(client, top_k=2, ai_enabled=False)
    out = client.delete("/api/v1/settings").json()
    assert out["top_k"] == 5 and out["ai_enabled"] is True and out["overridden"] == []


def test_changing_chunk_size_flags_a_reindex_which_applies_it(client):
    upload(client, make_pdf(LONG), "long.pdf")
    before = client.get("/api/v1/stats").json()["chunks"]
    assert put(client, chunk_size=300, chunk_overlap=30).json()["reindex_needed"] is True
    assert client.get("/api/v1/stats").json()["chunks"] == before  # nothing silently changes
    assert client.post("/api/v1/documents/reindex").json() == {"reindexed": 1, "failed": 0}
    after = client.get("/api/v1/stats").json()
    assert after["chunks"] > before
    assert client.get("/api/v1/settings").json()["reindex_needed"] is False


def test_changing_chunk_settings_with_an_empty_library_needs_no_reindex(client):
    assert put(client, chunk_size=300).json()["reindex_needed"] is False


def test_ai_can_be_switched_off_to_save_quota(client):
    upload(client, make_pdf(PUMP), "pump.pdf")
    provider = FakeProvider("Cited [1].")
    client.app.state.provider = provider
    put(client, ai_enabled=False)
    r = client.post("/api/v1/ask", json={"question": "pump"}).json()
    assert r["mode"] == "retrieval_only" and r["provider"] is None and provider.calls == []
    put(client, ai_enabled=True)
    assert client.post("/api/v1/ask", json={"question": "pump"}).json()["mode"] == "ai_generated"


def test_settings_writes_need_the_access_token(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, access_token="a-long-secret-token-1"))) as c:
        assert put(c, top_k=2).status_code == 401 and c.delete("/api/v1/settings").status_code == 401
        assert c.post("/api/v1/documents/reindex").status_code == 401 and c.get("/api/v1/suggestions").status_code == 401


# ---------------- suggested questions ----------------
def test_suggestions_come_from_the_documents_and_each_one_is_answerable(client):
    upload(client, make_pdf(["Irrigation scheduling uses tensiometers. Tensiometers measure soil tension precisely.",
                             "Fertilizer dosing depends on tensiometers readings and crop stage."]), "farm.pdf")
    body = client.get("/api/v1/suggestions").json()
    assert 1 <= len(body["items"]) <= 4 and "not from understanding" in body["note"]
    terms = [i["term"] for i in body["items"]]
    assert "tensiometers" in terms and len(set(terms)) == len(terms)
    for item in body["items"]:
        assert item["term"] in item["question"]
        assert client.post("/api/v1/ask", json={"question": item["question"]}).json()["status"] == "answered"


def test_suggestions_are_empty_for_an_empty_library_and_respect_collections(client):
    assert client.get("/api/v1/suggestions").json()["items"] == []
    doc = upload(client, make_pdf(["Turbines generate electricity from wind. Turbines need maintenance."]), "t.pdf").json()
    col = client.post("/api/v1/collections", json={"name": "Wind"}).json()
    other = client.post("/api/v1/collections", json={"name": "Other"}).json()
    client.patch(f"/api/v1/documents/{doc['id']}", json={"collection_id": col["id"]})
    assert client.get("/api/v1/suggestions", params={"collection_id": other["id"]}).json()["items"] == []
    assert client.get("/api/v1/suggestions", params={"collection_id": col["id"]}).json()["items"]


# ---------------- evaluation cases ----------------
def case(**over):
    base = {"question": "How much does installation cost?", "answerable": True, "expected_facts": ["140"],
            "expected_filename": "price.pdf", "expected_pages": [1]}
    return {**base, **over}


def test_eval_case_crud_and_validation(client):
    made = client.post("/api/v1/evaluation/cases", json=case())
    assert made.status_code == 201
    cid = made.json()["id"]
    listing = client.get("/api/v1/evaluation/cases").json()
    assert len(listing["builtin"]) == 7 and [c["id"] for c in listing["custom"]] == [cid]
    assert client.put(f"/api/v1/evaluation/cases/{cid}", json=case(question="Updated?")).json()["question"] == "Updated?"
    assert client.put("/api/v1/evaluation/cases/999", json=case()).status_code == 404
    for bad in (case(question=""), case(answerable=False), case(expected_pages=[0]), case(expected_filename=None),
                case(expected_facts=["x"] * 11)):
        assert client.post("/api/v1/evaluation/cases", json=bad).status_code == 422
    assert client.delete(f"/api/v1/evaluation/cases/{cid}").status_code == 204
    assert client.delete(f"/api/v1/evaluation/cases/{cid}").status_code == 404


def test_library_evaluation_needs_cases_and_runs_against_the_users_documents(client):
    r = client.post("/api/v1/evaluation/run", json={"target": "library"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_cases"
    upload(client, make_pdf(["The average cost was 140 US dollars per installation."]), "price.pdf")
    client.post("/api/v1/evaluation/cases", json=case())
    client.post("/api/v1/evaluation/cases", json=case(question="Who won the football world cup?", answerable=False,
                                                       expected_facts=[], expected_filename=None, expected_pages=[]))
    report = client.post("/api/v1/evaluation/run", json={"target": "library"}).json()
    assert report["metrics"]["pass_rate"] == 1.0 and report["settings"]["target"] == "library"
    assert [r["passed"] for r in report["results"]] == [True, True]
    before = client.get("/api/v1/stats").json()
    client.post("/api/v1/evaluation/run", json={"target": "library"})
    assert client.get("/api/v1/stats").json() == before  # evaluation never writes conversations or documents


def test_a_case_without_an_expected_source_is_checked_on_facts_alone(client):
    upload(client, make_pdf(["The average cost was 140 US dollars per installation."]), "price.pdf")
    client.post("/api/v1/evaluation/cases", json=case(expected_filename=None, expected_pages=[]))
    client.post("/api/v1/evaluation/cases", json=case(expected_facts=["999"], expected_filename=None, expected_pages=[]))
    results = client.post("/api/v1/evaluation/run", json={"target": "library"}).json()["results"]
    assert [r["retrieval_hit"] for r in results] == [None, None] and [r["passed"] for r in results] == [True, False]


def test_evaluation_shows_hybrid_beating_keyword_on_a_paraphrase(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, min_cosine=0.5))
    app.state.embedder = FakeEmbedder()
    with TestClient(app) as c:
        upload(c, make_pdf(["The average cost was 140 US dollars per installation."]), "price.pdf")
        c.post("/api/v1/evaluation/cases", json=case(question="What is the price of setup?"))
        keyword = c.post("/api/v1/evaluation/run", json={"target": "library", "mode": "keyword"}).json()
        hybrid = c.post("/api/v1/evaluation/run", json={"target": "library", "mode": "hybrid"}).json()
        assert keyword["metrics"]["retrieval_hit_rate"] == 0.0 and hybrid["metrics"]["retrieval_hit_rate"] == 1.0
        assert hybrid["settings"]["mode"] == "hybrid"
        strict = c.post("/api/v1/evaluation/run", json={"target": "library", "mode": "hybrid", "min_cosine": 0.99}).json()
        assert strict["metrics"]["retrieval_hit_rate"] == 0.0  # the cosine threshold is evaluable, not a magic number
        refused = c.post("/api/v1/evaluation/run", json={"target": "sample", "mode": "hybrid"})
        assert refused.status_code == 422


def test_resetting_chunk_settings_after_a_reindex_flags_another_reindex(client):
    upload(client, make_pdf(LONG), "long.pdf")
    put(client, chunk_size=300, chunk_overlap=30)
    client.post("/api/v1/documents/reindex")
    assert client.get("/api/v1/settings").json()["reindex_needed"] is False
    out = client.delete("/api/v1/settings").json()  # back to 900/150, but documents are chunked at 300
    assert out["chunk_size"] == 900 and out["reindex_needed"] is True
    client.post("/api/v1/documents/reindex")
    assert client.get("/api/v1/settings").json()["reindex_needed"] is False


def test_resetting_unrelated_settings_does_not_demand_a_reindex(client):
    upload(client, make_pdf(LONG), "long.pdf")
    put(client, top_k=3)
    assert client.delete("/api/v1/settings").json()["reindex_needed"] is False
