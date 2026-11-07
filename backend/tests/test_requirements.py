"""Guards against 'works on my machine' packaging bugs: everything the app imports must be a runtime requirement."""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# import name -> distribution name, where they differ
ALIASES = {"fitz": "pymupdf", "pydantic_settings": "pydantic-settings", "multipart": "python-multipart"}


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def runtime_requirements() -> set[str]:
    names = set()
    for line in (ROOT / "requirements.txt").read_text().splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-"):
            names.add(_norm(re.split(r"[\[<>=!~ ]", line, maxsplit=1)[0]))
    return names


def third_party_imports() -> dict[str, str]:
    found: dict[str, str] = {}
    for path in (ROOT / "app").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            modules = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                      [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module else []
            for module in modules:
                top = module.split(".")[0]
                if top != "app" and top not in sys.stdlib_module_names:
                    found.setdefault(top, str(path.relative_to(ROOT)))
    return found


def test_every_third_party_import_in_the_app_is_a_runtime_requirement():
    required = runtime_requirements()
    missing = {mod: where for mod, where in third_party_imports().items()
               if _norm(ALIASES.get(mod, mod)) not in required}
    assert not missing, f"imported by the app but missing from requirements.txt: {missing}"


def test_the_httpx_regression_specifically():
    assert "httpx" in runtime_requirements()  # once missing: a production-only install could not even start


def test_dev_requirements_build_on_the_runtime_ones():
    assert "-r requirements.txt" in (ROOT / "requirements-dev.txt").read_text()
