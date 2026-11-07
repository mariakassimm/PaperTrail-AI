from pathlib import Path

import pytest

from app.core.config import Settings
from app.db.session import create_session_factory
from app.evaluation.runner import aggregate, run_dataset
from app.rag.retrieval import tokenize
from app.services.documents import ingest_upload

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def indexed(tmp_path):
    settings = Settings(data_dir=tmp_path)
    session = create_session_factory(settings)()
    pdf = ROOT / "sample_data" / "sample_paper.pdf"
    ingest_upload(session, settings, pdf.name, pdf.read_bytes())
    yield session, settings
    session.close()


def test_tokenize_removes_stopwords_and_plurals():
    assert tokenize("What are the Farms?") == ["farm"]
    assert tokenize("class glass") == ["class", "glass"]


def test_full_evaluation_dataset_passes(indexed):
    session, settings = indexed
    report = run_dataset(session, settings, ROOT / "evaluation" / "dataset.json")
    failed = [r["id"] for r in report["results"] if not r["passed"]]
    assert not failed, failed
    assert report["metrics"]["pass_rate"] == 1.0


def test_threshold_zero_exposes_false_positive_on_unanswerable(indexed):
    """Documents why min_term_coverage exists: with no threshold, off-topic questions get 'evidence'."""
    session, settings = indexed
    report = run_dataset(session, settings, ROOT / "evaluation" / "dataset.json", min_coverage=0.0)
    assert report["metrics"]["correct_abstention_rate"] < 1.0


def test_aggregate_metric_math():
    from app.evaluation.runner import CaseResult
    a = CaseResult("a", "q", True, "answered", retrieval_hit=True, fact_coverage=0.5, abstention_correct=True, passed=False)
    b = CaseResult("b", "q", False, "answered", abstention_correct=False, passed=False)
    c = CaseResult("c", "q", False, "insufficient_evidence", abstention_correct=True, passed=True)
    m = aggregate([a, b, c])
    assert m["pass_rate"] == 0.333 and m["mean_fact_coverage"] == 0.5
    assert m["correct_abstention_rate"] == 0.5 and m["abstention_accuracy"] == 0.667


def test_cli_runs_and_writes_json(tmp_path):
    from app.evaluation.cli import main
    out = tmp_path / "r.json"
    code = main(["--pdf", str(ROOT / "sample_data/sample_paper.pdf"),
                 "--dataset", str(ROOT / "evaluation/dataset.json"), "--json", str(out)])
    assert code == 0 and out.exists()
