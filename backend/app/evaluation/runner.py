"""Deterministic retrieval-only evaluation. No network access or API key is needed.

Metric definitions (all objectively computable):
- retrieval_hit: an expected (filename, page) appears among the retrieved passages.
- citation_valid: every returned citation maps to a stored chunk and its excerpt is a substring of it.
- fact_coverage: share of expected facts found (case-insensitive) in the full text of cited chunks.
- abstention_correct: unanswerable -> insufficient_evidence; answerable -> answered.
A case passes only if all metrics that apply to it succeed.
"""
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Chunk
from app.rag.answering import ANSWERED, answer_question
from app.rag.citations import citation_is_valid


@dataclass
class CaseResult:
    id: str
    question: str
    answerable: bool
    status: str
    retrieved: list[dict] = field(default_factory=list)
    expected_facts: list[str] = field(default_factory=list)
    expected_pages: list[int] = field(default_factory=list)
    retrieval_hit: bool | None = None
    citation_valid: bool = True
    fact_coverage: float | None = None
    abstention_correct: bool = False
    passed: bool = False


def run_case(session: Session, settings: Settings, case: dict, **overrides) -> CaseResult:
    result = answer_question(session, settings, case["question"], **overrides)
    res = CaseResult(case["id"], case["question"], case["answerable"], result.status,
                     expected_facts=case.get("expected_facts") or [], expected_pages=case.get("expected_pages") or [])
    res.retrieved = [{"filename": c.filename, "page": c.page_number, "chunk_id": c.chunk_id}
                     for c in result.citations]
    res.citation_valid = all(citation_is_valid(session, c) for c in result.citations)
    res.abstention_correct = (result.status == ANSWERED) == case["answerable"]
    if case["answerable"]:
        name, pages = case.get("expected_filename"), case.get("expected_pages") or []
        if name and pages:
            expected = {(name.lower(), p) for p in pages}
            res.retrieval_hit = any((r["filename"].lower(), r["page"]) in expected for r in res.retrieved)
        elif name:
            res.retrieval_hit = any(r["filename"].lower() == name.lower() for r in res.retrieved)
        # no expected source given: retrieval_hit stays None (not applicable) and is not required to pass
        text = " ".join(session.get(Chunk, c.chunk_id).text.lower() for c in result.citations)
        facts = case.get("expected_facts") or []
        res.fact_coverage = sum(f.lower() in text for f in facts) / len(facts) if facts else 1.0
        res.passed = bool(res.retrieval_hit is not False and res.citation_valid and res.fact_coverage == 1.0
                          and res.abstention_correct)
    else:
        res.passed = res.abstention_correct and res.citation_valid
    return res


def aggregate(results: list[CaseResult]) -> dict:
    answerable = [r for r in results if r.answerable]
    unanswerable = [r for r in results if not r.answerable]

    def rate(items: list[bool]) -> float | None:
        return round(sum(items) / len(items), 3) if items else None

    return {
        "cases": len(results),
        "pass_rate": rate([r.passed for r in results]),
        "retrieval_hit_rate": rate([bool(r.retrieval_hit) for r in answerable]),
        "citation_validity_rate": rate([r.citation_valid for r in results]),
        "mean_fact_coverage": rate([r.fact_coverage or 0.0 for r in answerable]) if answerable else None,
        "abstention_accuracy": rate([r.abstention_correct for r in results]),
        "correct_abstention_rate": rate([r.abstention_correct for r in unanswerable]),
    }


def run_dataset(session: Session, settings: Settings, dataset_path: Path, **overrides) -> dict:
    cases = json.loads(dataset_path.read_text(encoding="utf-8"))["cases"]
    return run_cases(session, settings, cases, **overrides)


def run_cases(session: Session, settings: Settings, cases: list[dict], **overrides) -> dict:
    results = [run_case(session, settings, c, **overrides) for c in cases]
    return {"metrics": aggregate(results), "results": [asdict(r) for r in results]}
