import re
from pathlib import Path

import pytest
import yaml

from app.core.config import Settings

ROOT = Path(__file__).resolve().parents[2]
# Field names copied from Render's published Blueprint JSON schema (render.com/schema/render.yaml.json).
SERVICE_KEYS = {"type", "name", "runtime", "plan", "buildCommand", "startCommand", "healthCheckPath",
                "envVars", "routes", "staticPublishPath"}
ENV_KEYS = {"key", "value", "sync", "generateValue"}
ROUTE_KEYS = {"type", "source", "destination"}


@pytest.fixture(scope="module")
def blueprint():
    return yaml.safe_load((ROOT / "render.yaml").read_text())


def by_name(blueprint, name):
    return next(s for s in blueprint["services"] if s["name"] == name)


def test_blueprint_only_uses_fields_from_renders_schema(blueprint):
    for service in blueprint["services"]:
        assert set(service) <= SERVICE_KEYS
        assert all(set(env) <= ENV_KEYS for env in service.get("envVars", []))
        assert all(set(route) <= ROUTE_KEYS for route in service.get("routes", []))


def test_api_service_is_free_python_with_a_pinned_full_version_and_health_check(blueprint):
    api = by_name(blueprint, "papertrail-api")
    env = {e["key"]: e for e in api["envVars"]}
    assert api["runtime"] == "python" and api["plan"] == "free"
    assert re.fullmatch(r"3\.\d+\.\d+", env["PYTHON_VERSION"]["value"])  # Render requires a fully qualified version
    assert "--factory" in api["startCommand"] and "$PORT" in api["startCommand"] and "0.0.0.0" in api["startCommand"]
    assert api["healthCheckPath"] == "/api/v1/health"
    assert (ROOT / "backend" / "requirements.txt").exists()


def test_production_defaults_are_safe(blueprint):
    env = {e["key"]: e for e in by_name(blueprint, "papertrail-api")["envVars"]}
    assert env["PAPERTRAIL_ACCESS_TOKEN"].get("generateValue") is True  # never ships an open public API
    assert env["PAPERTRAIL_ENABLE_DOCS"]["value"] == "false"
    assert env["PAPERTRAIL_AI_PROVIDER"]["value"] == "none"  # no key needed to deploy
    for secret in ("PAPERTRAIL_GEMINI_API_KEY", "PAPERTRAIL_CORS_ORIGINS"):
        assert env[secret].get("sync") is False and "value" not in env[secret]  # entered in the dashboard, not the repo


def test_every_env_var_in_the_blueprint_is_a_real_setting(blueprint):
    known = {f"PAPERTRAIL_{name.upper()}" for name in Settings.model_fields}
    for e in by_name(blueprint, "papertrail-api")["envVars"]:
        assert e["key"] == "PYTHON_VERSION" or e["key"] in known, e["key"]


def test_static_site_is_an_spa_with_a_rewrite_and_build_time_api_url(blueprint):
    web = by_name(blueprint, "papertrail-web")
    assert web["runtime"] == "static" and web["staticPublishPath"] == "frontend/dist"
    assert {"type": "rewrite", "source": "/*", "destination": "/index.html"} in web["routes"]
    assert [e["key"] for e in web["envVars"]] == ["VITE_API_BASE"]
    assert "npm ci" in web["buildCommand"] and (ROOT / "frontend" / "package-lock.json").exists()


def test_cors_origins_accept_the_json_form_used_in_the_dashboard(monkeypatch):
    monkeypatch.setenv("PAPERTRAIL_CORS_ORIGINS", '["https://papertrail-web.onrender.com"]')
    assert Settings().cors_origins == ["https://papertrail-web.onrender.com"]


def test_no_real_secrets_or_local_urls_are_committed():
    text = (ROOT / "render.yaml").read_text()
    assert not re.search(r"AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}", text)
    assert "localhost" not in text and "127.0.0.1" not in text
    assert not (ROOT / "backend" / ".env").exists() and "!.env.example" in (ROOT / ".gitignore").read_text()


def test_env_example_works_untouched_and_turns_on_gemini_when_uncommented(tmp_path):
    """The shipped template must be valid as-is (no key, retrieval-only) and the documented 3 lines must work."""
    text = (ROOT / ".env.example").read_text()
    untouched = tmp_path / "a.env"
    untouched.write_text(text)
    plain = Settings(_env_file=untouched)
    assert plain.ai_provider == "none" and plain.gemini_api_key is None and plain.embedding_provider == "none"

    enabled = tmp_path / "b.env"
    for name in ("PAPERTRAIL_AI_PROVIDER=gemini", "PAPERTRAIL_GEMINI_API_KEY=", "PAPERTRAIL_GEMINI_MODEL="):
        assert f"# {name}" in text  # the three lines the instructions tell people to uncomment
    enabled.write_text(text.replace("# PAPERTRAIL_AI_PROVIDER", "PAPERTRAIL_AI_PROVIDER")
                       .replace("# PAPERTRAIL_GEMINI_API_KEY", "PAPERTRAIL_GEMINI_API_KEY")
                       .replace("# PAPERTRAIL_GEMINI_MODEL", "PAPERTRAIL_GEMINI_MODEL")
                       .replace("PASTE_YOUR_KEY_HERE", "AIzaFakeKeyForTest123"))
    on = Settings(_env_file=enabled)
    assert on.ai_provider == "gemini" and on.gemini_api_key.get_secret_value() == "AIzaFakeKeyForTest123"


def test_every_variable_named_in_env_example_is_a_real_setting():
    import re
    known = {f"PAPERTRAIL_{n.upper()}" for n in Settings.model_fields}
    named = set(re.findall(r"^#?\s*(PAPERTRAIL_[A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), flags=re.M))
    assert named and named <= known, named - known
