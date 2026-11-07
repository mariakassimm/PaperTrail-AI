from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Collection, Document


def get_collection(session: Session, collection_id: int) -> Collection:
    col = session.get(Collection, collection_id)
    if not col:
        raise AppError("collection_not_found", "Collection not found.", 404)
    return col


def document_counts(session: Session) -> dict[int, int]:
    rows = session.execute(
        select(Document.collection_id, func.count()).where(Document.collection_id.is_not(None))
        .group_by(Document.collection_id)
    ).all()
    return {cid: n for cid, n in rows}


def save_collection(session: Session, col: Collection) -> Collection:
    try:
        session.add(col)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AppError("duplicate_collection", "A collection with this name already exists.", 409) from exc
    return col


def delete_collection(session: Session, col: Collection) -> None:
    """Documents are kept and become unassigned (collection_id = NULL)."""
    session.query(Document).filter(Document.collection_id == col.id).update({"collection_id": None})
    session.delete(col)
    session.commit()
