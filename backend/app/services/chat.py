from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import AnswerCache
from app.core.config import Settings
from app.core.errors import AppError
from app.core.ratelimit import SlidingWindowLimiter
from app.db.models import Chunk, Collection, Conversation, Message
from app.providers.base import GenerationProvider
from app.providers.embeddings import EmbeddingProvider
from app.rag.answering import (
    ANSWERED,
    INSUFFICIENT,
    INSUFFICIENT_NOTE,
    RETRIEVAL_ONLY_MODE,
    RETRIEVAL_ONLY_NOTE,
    AnswerResult,
    answer_question,
    generate_answer,
)
from app.rag.citations import Citation, citation_is_valid
from app.rag.prompting import Passage

HISTORY_MESSAGES = 4  # earlier messages shown to the AI so it can resolve "it" / "that"


def get_conversation(session: Session, conversation_id: int) -> Conversation:
    conv = session.get(Conversation, conversation_id)
    if not conv:
        raise AppError("conversation_not_found", "Conversation not found.", 404)
    return conv


def _meta(result: AnswerResult) -> dict:
    return {"status": result.status, "mode": result.mode, "provider": result.provider, "notice": result.notice,
            "retrieval": result.retrieval, "ai_pending": result.ai_pending, "cached": result.cached,
            "citations": [c.to_dict() for c in result.citations]}


def result_from_message(msg: Message) -> AnswerResult:
    meta = msg.meta or {}
    return AnswerResult(meta.get("status", ANSWERED), meta.get("mode", RETRIEVAL_ONLY_MODE), msg.content,
                        [Citation(**c) for c in meta.get("citations", [])], meta.get("provider"), meta.get("notice"),
                        meta.get("retrieval", "keyword"), bool(meta.get("ai_pending")), bool(meta.get("cached")))


def ask(session: Session, settings: Settings, question: str, collection_id: int | None,
        document_ids: list[int] | None, conversation_id: int | None,
        provider: GenerationProvider | None = None,
        limiter: SlidingWindowLimiter | None = None,
        embedder: EmbeddingProvider | None = None,
        cache: AnswerCache | None = None,
        defer_ai: bool = False) -> tuple[Conversation, AnswerResult, Message]:
    question = question.strip()
    if not question:
        raise AppError("empty_question", "Please enter a question.", 422)
    if len(question) > settings.max_question_chars:
        raise AppError("question_too_long",
                       f"Questions are limited to {settings.max_question_chars} characters.", 422)
    if collection_id is not None and not session.get(Collection, collection_id):
        raise AppError("collection_not_found", "Collection not found.", 404)
    conv = get_conversation(session, conversation_id) if conversation_id else None
    if conv is None:
        conv = Conversation(title=question[:80], collection_id=collection_id)
        session.add(conv)
        session.flush()
    history = [(m.role, m.content) for m in conv.messages[-HISTORY_MESSAGES:]] if conv.id and conv.messages else None
    result = answer_question(session, settings, question, history=history, embedder=embedder,
                             collection_id=collection_id, document_ids=document_ids,
                             provider=provider, limiter=limiter, cache=cache, defer_ai=defer_ai)
    session.add(Message(conversation_id=conv.id, role="user", content=question))
    reply = Message(conversation_id=conv.id, role="assistant", content=result.answer, meta=_meta(result))
    session.add(reply)
    session.commit()
    return conv, result, reply


def generate_for_message(session: Session, settings: Settings, message_id: int, provider: GenerationProvider | None,
                         limiter: SlidingWindowLimiter | None, cache: AnswerCache | None,
                         in_progress: set[int]) -> tuple[AnswerResult, Message]:
    """Second step of the two-phase flow: write the AI answer for passages that were already shown.

    It reuses the passages stored with the message (it never re-retrieves), so the answer is about exactly the
    evidence the user is looking at. Calling it again once the answer exists just returns that answer.
    """
    msg = session.get(Message, message_id)
    if msg is None:
        raise AppError("message_not_found", "Message not found.", 404)
    if msg.role != "assistant":
        raise AppError("not_an_answer", "Only an assistant message can have an AI answer written.", 409)
    if not (msg.meta or {}).get("ai_pending"):
        return result_from_message(msg), msg
    if message_id in in_progress:
        raise AppError("already_generating", "This answer is already being written. Please wait a moment.", 409)

    in_progress.add(message_id)
    try:
        messages = list(msg.conversation.messages)
        position = next(i for i, m in enumerate(messages) if m.id == msg.id)
        if position == 0 or messages[position - 1].role != "user":
            raise AppError("question_missing", "The question for this answer could not be found.", 409)
        question = messages[position - 1].content
        history = [(m.role, m.content) for m in messages[max(0, position - 1 - HISTORY_MESSAGES):position - 1]] or None
        stored = [Citation(**c) for c in (msg.meta or {}).get("citations", [])]
        valid = [c for c in stored if citation_is_valid(session, c)]
        base_notice = (msg.meta or {}).get("notice")
        retrieval = (msg.meta or {}).get("retrieval", "keyword")

        if not valid:
            result = AnswerResult(INSUFFICIENT, RETRIEVAL_ONLY_MODE, INSUFFICIENT_NOTE, [], retrieval=retrieval,
                                  notice="The source documents changed or were deleted before the AI answer could be written. Ask the question again.")
        elif provider is None or not settings.ai_enabled:
            result = AnswerResult(ANSWERED, RETRIEVAL_ONLY_MODE, RETRIEVAL_ONLY_NOTE, valid, retrieval=retrieval,
                                  notice="The AI is not available right now, so these are the matching passages.")
        else:
            chunks = {c.chunk_id: session.get(Chunk, c.chunk_id) for c in valid}
            passages = [Passage(chunks[c.chunk_id].document.title, chunks[c.chunk_id].page_number, chunks[c.chunk_id].text) for c in valid]
            result = generate_answer(settings, question, passages, valid, history, provider, limiter, cache,
                                     retrieval=retrieval, base_notice=base_notice)
        msg.content = result.answer
        msg.meta = _meta(result)  # a new dict, so the JSON column change is detected
        session.commit()
        return result, msg
    finally:
        in_progress.discard(message_id)


def list_conversations(session: Session) -> list[Conversation]:
    return list(session.scalars(select(Conversation).order_by(Conversation.id.desc())))
