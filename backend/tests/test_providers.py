import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.providers.gemini import GeminiProvider
from app.providers.openai_compat import OpenAICompatProvider

KEY = "AIzaSy-SUPER-SECRET-KEY-123"


def gemini(handler, key=KEY):
    return GeminiProvider(key, "gemini-test", "https://example.test/v1beta", 5, httpx.MockTransport(handler))


def reply(status=200, body=None):
    return lambda request: httpx.Response(status, json=body if body is not None else {})


OK_BODY = {"candidates": [{"content": {"parts": [{"text": "Hello [1]"}], "role": "model"}, "finishReason": "STOP"}]}


def test_gemini_request_matches_documented_contract():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["headers"], seen["body"] = str(request.url), request.headers, json.loads(request.content)
        return httpx.Response(200, json=OK_BODY)

    assert gemini(handler).generate("SYS", "USER", 321) == "Hello [1]"
    assert seen["url"] == "https://example.test/v1beta/models/gemini-test:generateContent"
    assert seen["headers"]["x-goog-api-key"] == KEY
    assert KEY not in seen["url"] and KEY not in json.dumps(seen["body"])
    assert seen["body"]["system_instruction"]["parts"][0]["text"] == "SYS"
    assert seen["body"]["contents"][0]["parts"][0]["text"] == "USER"
    assert seen["body"]["generationConfig"] == {"maxOutputTokens": 321}  # no temperature/top_p/top_k


@pytest.mark.parametrize("status,body,code", [
    (400, {"error": {"message": "API key not valid. Please pass a valid API key."}}, "provider_auth"),
    (403, {"error": {"message": "denied"}}, "provider_auth"),
    (404, {"error": {"message": "not found"}}, "provider_model_not_found"),
    (429, {"error": {"message": "RESOURCE_EXHAUSTED"}}, "provider_quota"),
    (503, {"error": {"message": "overloaded"}}, "provider_unavailable"),
    (400, {"error": {"message": "bad field"}}, "provider_bad_request"),
])
def test_gemini_http_errors_map_to_friendly_codes(status, body, code):
    with pytest.raises(ProviderError) as err:
        gemini(reply(status, body)).generate("s", "u", 10)
    assert err.value.code == code and KEY not in err.value.message


@pytest.mark.parametrize("body,code", [
    ({}, "provider_bad_response"),
    ({"candidates": []}, "provider_bad_response"),
    ({"candidates": [{"content": {"parts": []}, "finishReason": "MAX_TOKENS"}]}, "provider_bad_response"),
    ({"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]}, "provider_blocked"),
    ({"promptFeedback": {"blockReason": "OTHER"}}, "provider_blocked"),
])
def test_gemini_malformed_or_blocked_responses(body, code):
    with pytest.raises(ProviderError) as err:
        gemini(reply(200, body)).generate("s", "u", 10)
    assert err.value.code == code


def test_gemini_ignores_thought_parts_and_non_json_bodies():
    body = {"candidates": [{"content": {"parts": [{"text": "secret reasoning", "thought": True}, {"text": "Answer"}]}}]}
    assert gemini(reply(200, body)).generate("s", "u", 10) == "Answer"
    with pytest.raises(ProviderError) as err:
        gemini(lambda r: httpx.Response(200, text="<html>oops</html>")).generate("s", "u", 10)
    assert err.value.code == "provider_bad_response"


def test_timeouts_and_network_failures_are_provider_errors():
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    def down(request):
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(ProviderError) as t:
        gemini(slow).generate("s", "u", 10)
    assert t.value.code == "provider_timeout"
    with pytest.raises(ProviderError) as n:
        gemini(down).generate("s", "u", 10)
    assert n.value.code == "provider_unavailable" and "internet" in n.value.message


def test_error_message_scrubs_the_key_even_if_the_provider_echoes_it():
    body = {"error": {"message": f"weird failure for key {KEY}"}}
    with pytest.raises(ProviderError) as err:
        gemini(reply(400, body)).generate("s", "u", 10)
    assert KEY not in err.value.message


def compat(handler):
    return OpenAICompatProvider("sk-test-123", "some/model:free", "https://router.test/api/v1/", 5, httpx.MockTransport(handler))


def test_openai_compat_request_and_response():
    seen = {}

    def handler(request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hi [1]"}}]})

    assert compat(handler).generate("SYS", "USER", 99) == "Hi [1]"
    assert seen["url"] == "https://router.test/api/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test-123"
    assert seen["body"]["model"] == "some/model:free" and seen["body"]["max_tokens"] == 99
    assert [m["role"] for m in seen["body"]["messages"]] == ["system", "user"]


@pytest.mark.parametrize("status,code", [(401, "provider_auth"), (404, "provider_model_not_found"),
                                         (402, "provider_quota"), (429, "provider_quota"), (502, "provider_unavailable")])
def test_openai_compat_error_mapping(status, code):
    with pytest.raises(ProviderError) as err:
        compat(reply(status, {"error": {"message": "x"}})).generate("s", "u", 10)
    assert err.value.code == code


def test_openai_compat_bad_shapes():
    for body in ({}, {"choices": []}, {"choices": [{"message": {"content": ""}}]}, {"choices": [{"message": {"content": None}}]}):
        with pytest.raises(ProviderError) as err:
            compat(reply(200, body)).generate("s", "u", 10)
        assert err.value.code == "provider_bad_response"


def test_factory_defaults_and_misconfiguration_never_crash():
    assert build_provider(Settings()) == (None, None)
    provider, err = build_provider(Settings(ai_provider="gemini"))
    assert provider is None and "GEMINI_API_KEY" in err
    provider, err = build_provider(Settings(ai_provider="openai_compat", openai_api_key="k"))
    assert provider is None and "OPENAI_MODEL" in err
    provider, err = build_provider(Settings(ai_provider="gemini", gemini_api_key="k"))
    assert provider.name == "gemini" and err is None
    # a key present but provider "none" must stay retrieval-only
    assert build_provider(Settings(ai_provider="none", gemini_api_key="k"))[0] is None


def test_app_starts_retrieval_only_when_key_missing(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, ai_provider="gemini"))) as c:
        health = c.get("/api/v1/health").json()
        assert health["ai_mode"] == "retrieval_only" and "GEMINI_API_KEY" in health["ai_config_error"]
        test = c.post("/api/v1/provider/test").json()
        assert test["ok"] is False and test["configured"] is False


def test_secrets_never_appear_in_api_responses_or_logs(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    settings = Settings(data_dir=tmp_path, ai_provider="gemini", gemini_api_key=KEY)
    assert KEY not in repr(settings) and KEY not in str(settings.model_dump())
    app = create_app(settings)
    app.state.provider = gemini(reply(403, {"error": {"message": f"nope {KEY}"}}))
    with TestClient(app) as c:
        texts = [c.get("/api/v1/health").text, c.get("/api/v1/settings").text, c.post("/api/v1/provider/test").text]
        assert c.get("/api/v1/settings").json()["ai_configured"] is True
    assert all(KEY not in t for t in texts)
    assert KEY not in caplog.text
