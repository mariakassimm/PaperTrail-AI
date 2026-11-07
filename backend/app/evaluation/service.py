"""Run the built-in evaluation in an isolated temporary library (never touches the user's data)."""
import tempfile
from pathlib import Path

from app.core.config import Settings
from app.core.errors import AppError
from app.db.session import create_session_factory
from app.evaluation.runner import run_dataset
from app.services.documents import ingest_upload

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_PDF = REPO_ROOT / "sample_data" / "sample_paper.pdf"
DATASET = REPO_ROOT / "evaluation" / "dataset.json"


def run_builtin(settings: Settings, min_coverage: float | None, top_k: int | None) -> dict:
    if not SAMPLE_PDF.exists() or not DATASET.exists():
        raise AppError("evaluation_files_missing",
                       "The sample PDF or evaluation dataset is missing from this installation.", 500)
    with tempfile.TemporaryDirectory() as tmp:
        isolated = settings.model_copy(update={"data_dir": Path(tmp)})
        session = create_session_factory(isolated)()
        try:
            ingest_upload(session, isolated, SAMPLE_PDF.name, SAMPLE_PDF.read_bytes())
            report = run_dataset(session, isolated, DATASET, min_coverage=min_coverage, top_k=top_k)
        finally:
            session.close()
            session.get_bind().dispose()
    report["settings"] = {"min_coverage": settings.min_term_coverage if min_coverage is None else min_coverage,
                          "top_k": top_k or settings.top_k}
    return report
