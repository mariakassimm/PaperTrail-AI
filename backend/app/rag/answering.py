"""Answer orchestration: retrieve -> (optionally) generate -> validate -> fall back honestly."""
import logging
from dataclasses import dataclass, field, replace

from sqlalchemy.orm import Session

from app.core.cache import AnswerCache
from app.core.config import Settings
from app.core.ratelimit import SlidingWindowLimiter
from app.providers.base import GenerationProvider, ProviderError
from app.providers.embeddings import EmbeddingProvider
from app.rag.citations import Citation, build_citations, citation_is_valid
from app.rag.prompting import (
    INSUFFICIENT_TOKEN,
    SYSTEM_PROMPT,
    Passage,
    build_user_prompt,
    parse_cited_answer,
)
from app.rag.retrieval import retrieve_hybrid, tokenize

logger = logging.getLogger("papertrail.answering")

RETRIEVAL_ONLY_MODE = "retrieval_only"
AI_MODE = "ai_generated"
ANSWERED = "answered"
INSUFFICIENT = "insufficient_evidence"
FOLLOW_UP_MAX_TERMS = 4  # questions with this few content words may be follow-ups that need earlier context

RETRIEVAL_ONLY_NOTE = (
    "Retrieval-only mode: no AI model wrote this response. These are the passages from your "
    "documents that best match your question."
)
INSUFFICIENT_NOTE = (
    "I could not find passages in the selected documents that match this question, so I can't "
    "answer it from your material. Try rephrasing, or check that the right documents or "
    "collection are selected."
)
PENDING_NOTE = "These are the passages that best match your question."
CACHED_NOTE = "This answer was remembered from an identical earlier request, so no AI quota was used."
AI_NOTICE = (
    "Written by an AI model using only the passages cited below. Citations show where the wording "
    "came from; they do not guarantee it is correct, so check the sources."
)


@dataclass
class AnswerResult:
    status: str
    mode: str
    answer: str
    citations: list[Citation] = field(default_factory=list)
    provider: str | None = None  # set only when an AI model actually wrote `answer`
    notice: str | None = None
    retrieval: str = "keyword"  # what actually ran: keyword | hybrid
    ai_pending: bool = False  # passages are ready; the AI answer is still to be written (second request)
    cached: bool = False


def _join(*notes: str | None) -> str | None:
    text = " ".join(n for n in notes if n)
    return text or None


def follow_up_context(question: str, history: list[tuple[str, str]] | None) -> str | None:
    """The previous user question, if this one looks like a short follow-up."""
    if not history or len(set(tokenize(question))) > FOLLOW_UP_MAX_TERMS:
        return None
    previous = [content for role, content in history if role == "user"]
    return previous[-1] if previous else None


def generate_answer(
    settings: Settings, question: str, passages: list[Passage], citations: list[Citation],
    history: list[tuple[str, str]] | None, provider: GenerationProvider, limiter: SlidingWindowLimiter | None,
    cache: AnswerCache | None, *, retrieval: str, base_notice: str | None,
) -> AnswerResult:
    """Turn retrieved passages into a validated, cited AI answer, or fall back to the plain passages.

    Used by both the one-step /ask and the second step of the two-phase flow, so they cannot drift apart.
    """
    fallback = AnswerResult(ANSWERED, RETRIEVAL_ONLY_MODE, RETRIEVAL_ONLY_NOTE, citations, notice=base_notice, retrieval=retrieval)
    prompt, included = build_user_prompt(question, passages, settings.ai_context_chars, history)
    key = cache.key(SYSTEM_PROMPT, prompt, provider.label, settings.ai_max_output_tokens) if cache is not None else None
    raw = cache.get(key) if cache is not None and key else None
    cached = raw is not None
    if raw is None:
        if limiter is not None and not limiter.allow():
            return replace(fallback, notice=_join(base_notice, f"AI request limit reached ({settings.ai_requests_per_minute} per minute, to protect your free quota). Showing matching passages instead."))
        try:
            raw = provider.generate(SYSTEM_PROMPT, prompt, settings.ai_max_output_tokens)
        except ProviderError as exc:
            logger.warning("AI provider failed: %s", exc.code)  # code only; never request bodies or keys
            return replace(fallback, notice=_join(base_notice, f"{exc.message} Showing matching passages instead."))

    reuse = CACHED_NOTE if cached else None
    if raw.strip().startswith(INSUFFICIENT_TOKEN):
        if cache is not None and key and not cached:
            cache.put(key, raw)
        return AnswerResult(INSUFFICIENT, AI_MODE, INSUFFICIENT_NOTE, provider=provider.label,
                            notice=_join(base_notice, reuse), retrieval=retrieval, cached=cached)
    text, cited_numbers = parse_cited_answer(raw, included)
    if not text or not cited_numbers:  # never cache or show uncited text
        return replace(fallback, notice=_join(base_notice, "The AI response did not cite any of the retrieved passages, so it was discarded. Showing matching passages instead."))
    if cache is not None and key and not cached:
        cache.put(key, raw)
    return AnswerResult(ANSWERED, AI_MODE, text, [citations[n - 1] for n in cited_numbers], provider=provider.label,
                        notice=_join(base_notice, AI_NOTICE, reuse), retrieval=retrieval, cached=cached)


def answer_question(
    session: Session,
    settings: Settings,
    question: str,
    *,
    collection_id: int | None = None,
    document_ids: list[int] | None = None,
    top_k: int | None = None,
    min_coverage: float | None = None,
    min_cosine: float | None = None,
    mode: str | None = None,
    provider: GenerationProvider | None = None,
    embedder: EmbeddingProvider | None = None,
    limiter: SlidingWindowLimiter | None = None,
    history: list[tuple[str, str]] | None = None,
    cache: AnswerCache | None = None,
    defer_ai: bool = False,
) -> AnswerResult:
    if not settings.ai_enabled:
        provider = None
    context = follow_up_context(question, history)
    # A question with no content words at all ("why?") borrows the previous question's words.
    query = question if tokenize(question) or not context else context
    outcome = retrieve_hybrid(
        session, query, top_k=top_k or settings.top_k,
        min_coverage=settings.min_term_coverage if min_coverage is None else min_coverage,
        collection_id=collection_id, document_ids=document_ids,
        context_query=context if query == question else None,
        embedder=embedder, mode=mode or settings.retrieval_mode,
        min_cosine=settings.min_cosine if min_cosine is None else min_cosine,
    )
    citations = build_citations(outcome.results, query)
    pairs = [(r, c) for r, c in zip(outcome.results, citations) if citation_is_valid(session, c)]
    used = outcome.mode_used
    if not pairs:  # nothing to ground an answer on: don't spend provider quota
        return AnswerResult(INSUFFICIENT, RETRIEVAL_ONLY_MODE, INSUFFICIENT_NOTE, notice=outcome.notice, retrieval=used)

    cites = [c for _, c in pairs]
    if provider is None:
        return AnswerResult(ANSWERED, RETRIEVAL_ONLY_MODE, RETRIEVAL_ONLY_NOTE, cites, notice=outcome.notice, retrieval=used)
    passages = [Passage(r.document.title, r.chunk.page_number, r.chunk.text) for r, _ in pairs]
    if defer_ai:
        # Evidence first: return the passages now and let a second request write the answer. If this exact
        # answer is already cached it is instant, so there is nothing to wait for and we answer in one step.
        prompt, _ = build_user_prompt(question, passages, settings.ai_context_chars, history)
        key = cache.key(SYSTEM_PROMPT, prompt, provider.label, settings.ai_max_output_tokens) if cache is not None else None
        if not (cache is not None and key and cache.get(key) is not None):
            return AnswerResult(ANSWERED, RETRIEVAL_ONLY_MODE, PENDING_NOTE, cites, notice=outcome.notice,
                                retrieval=used, ai_pending=True)
    return generate_answer(settings, question, passages, cites, history, provider, limiter, cache,
                           retrieval=used, base_notice=outcome.notice)
