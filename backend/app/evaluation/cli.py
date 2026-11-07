"""Run the evaluation suite: python -m app.evaluation.cli --pdf PATH --dataset PATH [--json OUT]"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

from app.core.config import Settings
from app.db.session import create_session_factory
from app.evaluation.runner import run_dataset
from app.services.documents import ingest_upload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic retrieval-only evaluation")
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--json", type=Path, help="write full results to this file")
    parser.add_argument("--min-coverage", type=float, default=None)
    args = parser.parse_args(argv)

    with tempfile.TemporaryDirectory() as tmp:  # isolated; never touches your real library
        settings = Settings(data_dir=Path(tmp))
        session = create_session_factory(settings)()
        doc = ingest_upload(session, settings, args.pdf.name, args.pdf.read_bytes())
        if doc.status not in ("indexed", "partially_extracted"):
            print(f"Could not index {args.pdf}: {doc.status_message}", file=sys.stderr)
            return 2
        report = run_dataset(session, settings, args.dataset, min_coverage=args.min_coverage)
        session.close()

    for r in report["results"]:
        print(f"{'PASS' if r['passed'] else 'FAIL'}  {r['id']:<26} status={r['status']}")
    print(json.dumps(report["metrics"], indent=2))
    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0 if report["metrics"]["pass_rate"] == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
