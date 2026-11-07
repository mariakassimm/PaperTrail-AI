import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.seed import seed_sample_if_empty
from tests.conftest import SOLAR, make_pdf

TOKEN = "correct-horse-battery-staple-1"


@pytest.fixture
def secured(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, access_token=TOKEN))) as c:
        yield c


def auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def test_health_is_public_and_reports_auth_required(secured):
    body = secured.get("/api/v1/health").json()
    assert body["status"] == "ok" and body["auth_required"] is True


@pytest.mark.parametrize("method,path", [("get", "/api/v1/stats"), ("get", "/api/v1/documents"), ("get", "/api/v1/collections"),
                                         ("get", "/api/v1/settings"), ("post", "/api/v1/ask"), ("post", "/api/v1/evaluation/run"),
                                         ("post", "/api/v1/provider/test"), ("get", "/api/v1/chunks/1"), ("get", "/api/v1/auth/check")])
def test_every_protected_endpoint_rejects_missing_and_wrong_tokens(secured, method, path):
    for headers in ({}, auth("wrong-token-wrong-token"), {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}):
        r = getattr(secured, method)(path, headers=headers)
        assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
        assert TOKEN not in r.text


def test_upload_and_ask_work_with_the_token_and_not_without(secured):
    files = {"file": ("a.pdf", make_pdf(SOLAR), "application/pdf")}
    assert secured.post("/api/v1/documents", files=files).status_code == 401
    assert secured.get("/api/v1/documents").status_code == 401
    assert secured.post("/api/v1/documents", files=files, headers=auth()).status_code == 201
    ok = secured.post("/api/v1/ask", json={"question": "solar electricity"}, headers=auth())
    assert ok.status_code == 200 and ok.json()["status"] == "answered"
    assert secured.get("/api/v1/auth/check", headers=auth()).json() == {"ok": True}


def test_repeated_wrong_tokens_are_throttled(secured):
    codes = [secured.get("/api/v1/stats", headers=auth("nope-nope-nope-nope")).status_code for _ in range(25)]
    assert codes[0] == 401 and 429 in codes
    assert secured.get("/api/v1/stats", headers=auth()).status_code == 200  # the right token is never throttled


def test_no_token_configured_means_open_local_mode(client):
    assert client.get("/api/v1/health").json()["auth_required"] is False
    assert client.get("/api/v1/stats").status_code == 200


def test_token_is_never_exposed_and_must_be_long_enough(secured):
    for path in ("/api/v1/health", "/api/v1/settings"):
        assert TOKEN not in secured.get(path, headers=auth()).text
    assert TOKEN not in repr(secured.app.state.settings)
    with pytest.raises(ValueError):
        Settings(access_token="short")


def test_docs_can_be_disabled_for_production(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, enable_docs=False))) as c:
        assert c.get("/docs").status_code == 404 and c.get("/openapi.json").status_code == 404
    with TestClient(create_app(Settings(data_dir=tmp_path / "b"))) as c:
        assert c.get("/docs").status_code == 200


def test_seed_sample_loads_once_and_only_into_an_empty_library(tmp_path):
    settings = Settings(data_dir=tmp_path, seed_sample=True)
    with TestClient(create_app(settings)) as c:
        docs = c.get("/api/v1/documents").json()
        assert docs["total"] == 1 and docs["items"][0]["status"] == "indexed"
    with TestClient(create_app(settings)) as c:  # "restart" with the persisted library
        assert c.get("/api/v1/documents").json()["total"] == 1
    other = Settings(data_dir=tmp_path / "other", seed_sample=True)
    session = create_app(other).state.session_factory()
    assert seed_sample_if_empty(session, other) is False  # already seeded at startup
    session.close()


def test_seed_is_off_by_default(client):
    assert client.get("/api/v1/documents").json()["total"] == 0
