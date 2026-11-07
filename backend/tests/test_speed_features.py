import pytest
from fastapi.testclient import TestClient

from app.core.cache import AnswerCache
from app.core.config import Settings
from app.core.ratelimit import SlidingWindowLimiter
from app.main import create_app
from app.providers.base import ProviderError
from tests.conftest import make_pdf, upload
from tests.test_ai_answering import FakeProvider

PUMP = ["The submersible pump runs at night and uses forty watts of electricity."]
OTHER = ["A different pump manual says the pump needs oil every month."]
Q = {"question": "pump"}


def ask(client, defer=False, **extra):
    return client.post("/api/v1/ask", json={**Q, "defer_ai": defer, **extra}).json()


def generate(client, message_id):
    return client.post(f"/api/v1/messages/{message_id}/generate")


@pytest.fixture
def ai(client):
    upload(client, make_pdf(PUMP), "pump.pdf")
    provider = FakeProvider("The pump uses forty watts [1].")
    client.app.state.provider = provider
    client.provider = provider
    return client


# ---------------- cache ----------------
def test_an_identical_question_is_answered_from_memory_without_calling_the_ai(ai):
    first, second = ask(ai), ask(ai)
    assert len(ai.provider.calls) == 1
    assert first["cached"] is False and second["cached"] is True
    assert second["answer"] == first["answer"] and second["citations"] == first["citations"]
    assert "no AI quota was used" in second["notice"] and second["mode"] == "ai_generated"


def test_a_different_question_or_different_evidence_is_never_served_from_memory(ai):
    ask(ai)
    ai.post("/api/v1/ask", json={"question": "pump electricity"})
    assert len(ai.provider.calls) == 2  # a different question makes a different prompt
    docs = ai.get("/api/v1/documents").json()["items"]
    ai.delete(f"/api/v1/documents/{docs[0]['id']}")
    upload(ai, make_pdf(OTHER), "other.pdf")
    ask(ai)
    assert len(ai.provider.calls) == 3  # same words, new document: the cached answer must not be reused


def test_the_cache_can_be_turned_off(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, answer_cache_size=0))) as c:
        upload(c, make_pdf(PUMP), "pump.pdf")
        c.app.state.provider = provider = FakeProvider("Fine [1].")
        ask(c), ask(c)
        assert len(provider.calls) == 2


def test_failures_and_uncited_output_are_never_cached(ai):
    ai.app.state.provider = bad = FakeProvider(error=ProviderError("provider_quota", "Quota reached."))
    assert ask(ai)["mode"] == "retrieval_only"
    ai.app.state.provider = uncited = FakeProvider("Invented claim with no citation.")
    assert ask(ai)["mode"] == "retrieval_only"
    ai.app.state.provider = good = FakeProvider("Real answer [1].")
    first = ask(ai)
    assert first["mode"] == "ai_generated" and first["cached"] is False
    assert len(bad.calls) == len(uncited.calls) == len(good.calls) == 1  # each was really asked, nothing stale was served


def test_a_remembered_answer_works_even_when_the_local_rate_limit_is_used_up(ai):
    ai.app.state.limiter = SlidingWindowLimiter(1)
    assert ask(ai)["mode"] == "ai_generated"  # uses the single allowed call
    again = ask(ai)
    assert again["mode"] == "ai_generated" and again["cached"] is True and len(ai.provider.calls) == 1
    other = ai.post("/api/v1/ask", json={"question": "pump electricity"}).json()
    assert other["mode"] == "retrieval_only" and "limit reached" in other["notice"]  # a new call is still limited


def test_cache_unit_behaviour_is_least_recently_used_and_model_specific():
    cache = AnswerCache(2)
    a, b, c = (cache.key("sys", p, "m1", 100) for p in ("a", "b", "c"))
    cache.put(a, "A"), cache.put(b, "B")
    cache.get(a)  # touching a makes b the oldest
    cache.put(c, "C")
    assert cache.get(a) == "A" and cache.get(b) is None and cache.get(c) == "C" and len(cache) == 2
    assert cache.key("sys", "a", "m1", 100) != cache.key("sys", "a", "m2", 100) != cache.key("sys", "a", "m1", 200)
    assert AnswerCache(0).get("x") is None


# ---------------- evidence first, answer second ----------------
def test_deferred_ask_returns_the_passages_at_once_without_calling_the_ai(ai):
    r = ask(ai, defer=True)
    assert r["ai_pending"] is True and r["mode"] == "retrieval_only" and r["provider"] is None
    assert r["citations"] and r["message_id"] and ai.provider.calls == []
    msg = ai.get(f"/api/v1/conversations/{r['conversation_id']}").json()["messages"][1]
    assert msg["id"] == r["message_id"] and msg["meta"]["ai_pending"] is True  # survives a page reload


def test_generate_writes_the_ai_answer_and_updates_the_stored_message(ai):
    r = ask(ai, defer=True)
    g = generate(ai, r["message_id"]).json()
    assert g["ai_pending"] is False and g["mode"] == "ai_generated" and g["answer"] == "The pump uses forty watts [1]."
    assert g["provider"] == "fake (m1)" and g["citations"][0]["page_number"] == 1 and len(ai.provider.calls) == 1
    stored = ai.get(f"/api/v1/conversations/{r['conversation_id']}").json()["messages"][1]
    assert stored["content"] == g["answer"] and stored["meta"]["ai_pending"] is False and stored["meta"]["provider"] == "fake (m1)"


def test_generating_twice_does_not_call_the_ai_twice(ai):
    mid = ask(ai, defer=True)["message_id"]
    first, second = generate(ai, mid).json(), generate(ai, mid).json()
    assert len(ai.provider.calls) == 1 and second["answer"] == first["answer"] and second["ai_pending"] is False


def test_two_step_and_one_step_give_the_same_answer(ai):
    one_step = ask(ai)
    ai.app.state.answer_cache = AnswerCache(0)  # prove parity by computing, not by cache
    two_step = generate(ai, ask(ai, defer=True)["message_id"]).json()
    assert (two_step["answer"], two_step["citations"], two_step["mode"]) == (one_step["answer"], one_step["citations"], one_step["mode"])


def test_a_cached_answer_skips_the_waiting_step_entirely(ai):
    ask(ai)  # fills the cache
    r = ask(ai, defer=True)
    assert r["ai_pending"] is False and r["mode"] == "ai_generated" and r["cached"] is True and len(ai.provider.calls) == 1


def test_deferral_is_ignored_when_there_is_nothing_to_wait_for(ai, tmp_path):
    none = ask(ai, defer=True, collection_id=None, question="volcano eruption")  # no evidence
    assert none["status"] == "insufficient_evidence" and none["ai_pending"] is False and ai.provider.calls == []
    ai.put("/api/v1/settings", json={"ai_enabled": False})
    off = ask(ai, defer=True)
    assert off["ai_pending"] is False and off["mode"] == "retrieval_only"
    ai.delete("/api/v1/settings")
    ai.app.state.provider = None
    assert ask(ai, defer=True)["ai_pending"] is False  # no provider configured: plain passages, nothing pending


def test_a_provider_failure_in_the_second_step_keeps_the_passages_and_explains(ai):
    mid = ask(ai, defer=True)["message_id"]
    ai.app.state.provider = FakeProvider(error=ProviderError("provider_timeout", "The AI provider did not respond within 30 seconds."))
    g = generate(ai, mid)
    assert g.status_code == 200
    body = g.json()
    assert body["ai_pending"] is False and body["mode"] == "retrieval_only" and body["provider"] is None
    assert body["citations"] and "did not respond within 30 seconds" in body["notice"] and "Showing matching passages" in body["notice"]


def test_the_second_step_uses_the_passages_the_user_already_saw_not_a_fresh_search(ai):
    mid = ask(ai, defer=True)["message_id"]
    upload(ai, make_pdf(["pump pump pump pump pump brand new evidence that would now rank first"]), "new.pdf")
    generate(ai, mid)
    prompt = ai.provider.calls[0][1]
    assert "forty watts" in prompt and "brand new evidence" not in prompt


def test_if_the_source_vanishes_between_steps_nothing_is_invented(ai):
    r = ask(ai, defer=True)
    ai.delete(f"/api/v1/documents/{ai.get('/api/v1/documents').json()['items'][0]['id']}")
    g = generate(ai, r["message_id"]).json()
    assert g["status"] == "insufficient_evidence" and g["citations"] == [] and "deleted" in g["notice"] and ai.provider.calls == []


def test_a_followup_in_the_second_step_still_sees_the_earlier_turns(ai):
    first = ask(ai)
    r = ai.post("/api/v1/ask", json={"question": "and its electricity?", "conversation_id": first["conversation_id"], "defer_ai": True}).json()
    generate(ai, r["message_id"])
    assert "<conversation>" in ai.provider.calls[-1][1] and "User: pump" in ai.provider.calls[-1][1]


def test_generate_rejects_bad_targets_and_concurrent_duplicates(ai):
    assert generate(ai, 9999).status_code == 404
    r = ask(ai, defer=True)
    conv = ai.get(f"/api/v1/conversations/{r['conversation_id']}").json()
    user_id = conv["messages"][0]["id"]
    bad = generate(ai, user_id)
    assert bad.status_code == 409 and bad.json()["error"]["code"] == "not_an_answer"
    ai.app.state.generating.add(r["message_id"])  # simulate a request already in flight
    busy = generate(ai, r["message_id"])
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "already_generating" and ai.provider.calls == []
    ai.app.state.generating.clear()
    assert generate(ai, r["message_id"]).status_code == 200 and not ai.app.state.generating  # guard is always released


def test_generate_on_a_plain_passages_message_does_nothing(client):
    upload(client, make_pdf(PUMP), "pump.pdf")
    r = ask(client)  # no provider yet: a plain passages message, nothing pending
    assert r["ai_pending"] is False and r["mode"] == "retrieval_only"
    client.app.state.provider = provider = FakeProvider("Never used [1].")
    g = generate(client, r["message_id"]).json()
    assert g["answer"] == r["answer"] and g["mode"] == "retrieval_only"
    assert provider.calls == []


def test_an_empty_cache_still_counts_as_a_cache():
    assert bool(AnswerCache(5)) is True  # regression: len()==0 once made `if cache:` skip caching forever


def test_generate_requires_the_access_token(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, access_token="a-long-secret-token-1"))) as c:
        assert c.post("/api/v1/messages/1/generate").status_code == 401
