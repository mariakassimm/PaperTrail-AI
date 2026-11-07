import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Document
from app.evaluation.service import SAMPLE_PDF
from app.providers.embeddings import EmbeddingProvider
from app.services.documents import ingest_upload

logger = logging.getLogger("papertrail.seed")


def seed_sample_if_empty(session: Session, settings: Settings, embedder: EmbeddingProvider | None = None) -> bool:
    """Load the fictional sample paper into an empty library. Returns True if it was added.

    Useful on hosts with an ephemeral disk, where the library is empty after every restart.
    """
    if (session.scalar(select(func.count()).select_from(Document)) or 0) > 0:
        return False
    if not SAMPLE_PDF.exists():
        logger.warning("seed_sample is on but %s does not exist", SAMPLE_PDF.name)
        return False
    ingest_upload(session, settings, SAMPLE_PDF.name, SAMPLE_PDF.read_bytes(), embedder)
    return True
