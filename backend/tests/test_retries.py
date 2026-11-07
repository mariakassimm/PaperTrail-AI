import httpx
import pytest

from app.core.config import Settings
from app.providers.base import MAX_RETRY_WAIT, ProviderError
from app.providers.embeddings import GeminiEmbeddings
from app.providers.factory import build_embedder, build_provider
from app.providers.gemini import GeminiProvider

OK = {"candidates": [{"content": {"parts": [{"text": "Fine [1]"}]}}]}


def sequence(*responses):
    """A transport that returns the given responses (or raises exceptions) in order, counting calls."""
    calls = {"n": 0}

    def handler(request):
        item = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        if isinstance(item, Exception):
            raise item
        status, body, headers = (item + ({},))[:3] if isinstance(item, tuple) else (item, {}, {})
        return httpx.Response(status, json=body, headers=headers)

    return httpx.MockTransport(handler), calls


def provider(transport, retries=1):
    p = GeminiProvider("key-123", "m", "https://example.test/v1beta", 5, transport, retries)
    p.slept = []
    p._sleep = p.slept.append  # record waits instead of really sleeping
    return p


def test_a_momentary_overload_is_retried_once_and_then_succeeds():
    transport, calls = sequence((503, {"error": {"message": "overloaded"}}), (200, OK))
    p = provider(transport)
    assert p.generate("s", "u", 10) == "Fine [1]"
    assert calls["n"] == 2 and len(p.slept) == 1 and 0.5 <= p.slept[0] <= MAX_RETRY_WAIT


@pytest.mark.parametrize("status", [502, 503, 504])
def test_all_transient_gateway_errors_are_retried(status):
    transport, calls = sequence((status, {}), (200, OK))
    assert provider(transport).generate("s", "u", 10) == "Fine [1]" and calls["n"] == 2


def test_it_gives_up_after_the_allowed_retries_with_a_clear_error():
    transport, calls = sequence((503, {}), (503, {}), (200, OK))
    with pytest.raises(ProviderError) as err:
        provider(transport, retries=1).generate("s", "u", 10)
    assert err.value.code == "provider_unavailable" and calls["n"] == 2  # exactly one retry, never a loop


def test_retries_can_be_switched_off():
    transport, calls = sequence((503, {}), (200, OK))
    with pytest.raises(ProviderError):
        provider(transport, retries=0).generate("s", "u", 10)
    assert calls["n"] == 1


def test_a_dropped_connection_is_retried_once():
    transport, calls = sequence(httpx.ConnectError("reset"), (200, OK))
    assert provider(transport).generate("s", "u", 10) == "Fine [1]" and calls["n"] == 2
    transport, calls = sequence(httpx.ConnectError("down"), httpx.ConnectError("down"), (200, OK))
    with pytest.raises(ProviderError) as err:
        provider(transport).generate("s", "u", 10)
    assert err.value.code == "provider_unavailable" and calls["n"] == 2


def test_timeouts_are_never_retried_because_the_wait_already_happened():
    transport, calls = sequence(httpx.ReadTimeout("slow"), (200, OK))
    p = provider(transport, retries=3)
    with pytest.raises(ProviderError) as err:
        p.generate("s", "u", 10)
    assert err.value.code == "provider_timeout" and calls["n"] == 1 and p.slept == []


def test_quota_errors_are_retried_only_when_google_says_the_wait_is_short():
    transport, calls = sequence((429, {}, {"Retry-After": "2"}), (200, OK))
    p = provider(transport)
    assert p.generate("s", "u", 10) == "Fine [1]" and p.slept == [2.0]
    for headers in ({}, {"Retry-After": "60"}, {"Retry-After": "soon"}):
        transport, calls = sequence((429, {"error": {"message": "RESOURCE_EXHAUSTED"}}, headers), (200, OK))
        with pytest.raises(ProviderError) as err:
            provider(transport).generate("s", "u", 10)
        assert err.value.code == "provider_quota" and calls["n"] == 1  # a long or unknown wait: don't burn more quota


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_client_errors_are_never_retried(status):
    transport, calls = sequence((status, {"error": {"message": "nope"}}), (200, OK))
    with pytest.raises(ProviderError):
        provider(transport, retries=3).generate("s", "u", 10)
    assert calls["n"] == 1


def test_embeddings_share_the_same_retry_behaviour():
    transport, calls = sequence((503, {}), (200, {"embeddings": [{"values": [1.0, 2.0]}]}))
    emb = GeminiEmbeddings("key-123", "gemini-embedding-001", "https://example.test/v1beta", 256, 5, transport, 1)
    emb._sleep = lambda s: None
    assert emb.embed(["a"], "query") == [[1.0, 2.0]] and calls["n"] == 2


def test_settings_control_retries_and_the_factory_passes_them_on():
    assert Settings().ai_max_retries == 1
    p, _ = build_provider(Settings(ai_provider="gemini", gemini_api_key="k", ai_max_retries=3))
    assert p._retries == 3
    e, _ = build_embedder(Settings(embedding_provider="gemini", gemini_api_key="k", ai_max_retries=0))
    assert e._retries == 0
    with pytest.raises(ValueError):
        Settings(ai_max_retries=9)
