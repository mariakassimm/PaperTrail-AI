from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class DocumentOut(ORM):
    id: int
    title: str
    filename: str
    size_bytes: int
    page_count: int
    status: str
    status_message: str
    created_at: datetime
    collection_id: int | None


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    collection_id: int | None = None
    clear_collection: bool = False


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class CollectionOut(ORM):
    id: int
    name: str
    description: str
    created_at: datetime
    document_count: int = 0


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    collection_id: int | None = None
    document_ids: list[int] | None = None
    conversation_id: int | None = None
    # Return the passages immediately and write the AI answer in a second request (POST /messages/{id}/generate).
    defer_ai: bool = False


class CitationOut(BaseModel):
    chunk_id: int
    document_id: int
    document_title: str
    filename: str
    page_number: int
    excerpt: str
    score: float
    matched_by: str = "keyword"


class AskResponse(BaseModel):
    conversation_id: int
    status: str  # answered | insufficient_evidence
    mode: str  # retrieval_only | ai_generated
    answer: str
    citations: list[CitationOut]
    provider: str | None = None  # set only when an AI model wrote the answer
    notice: str | None = None
    retrieval: str = "keyword"  # what actually ran: keyword | hybrid
    message_id: int | None = None
    ai_pending: bool = False  # True: passages are ready, the AI answer is still to be requested
    cached: bool = False


class MessageOut(ORM):
    id: int
    role: str
    content: str
    meta: dict | None
    created_at: datetime


class ConversationOut(ORM):
    id: int
    title: str
    collection_id: int | None
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class SearchHit(BaseModel):
    citation: CitationOut
    coverage: float


class SearchResponse(BaseModel):
    search_type: str = "keyword"
    notice: str | None = None
    query: str
    title_matches: list[DocumentOut]
    passages: list[SearchHit]


class ChunkDetail(BaseModel):
    chunk_id: int
    document_id: int
    document_title: str
    filename: str
    page_number: int
    text: str
    page_text: str
    highlight_start: int | None = None  # where `text` sits inside `page_text`
    highlight_end: int | None = None


class EvaluationRequest(BaseModel):
    target: Literal["sample", "library"] = "sample"  # sample = built-in paper in an isolated copy
    min_coverage: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=20)
    min_cosine: float | None = Field(default=None, ge=0.0, le=1.0)
    mode: Literal["keyword", "hybrid"] | None = None


class EvalCaseIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    answerable: bool = True
    expected_facts: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=10)
    expected_filename: str | None = Field(default=None, max_length=300)
    expected_pages: list[Annotated[int, Field(ge=1, le=5000)]] = Field(default_factory=list, max_length=20)


class EvalCaseOut(ORM, EvalCaseIn):
    id: int


class SettingsOut(BaseModel):
    retrieval_mode: str
    ai_provider: str | None
    chunk_size: int
    chunk_overlap: int
    top_k: int
    min_term_coverage: float
    max_upload_mb: int
    ai_model: str | None = None
    ai_configured: bool = False
    ai_config_error: str | None = None
    ai_enabled: bool = True
    auto_embed: bool = True
    min_cosine: float = 0.62
    embedding_provider: str | None = None
    embedding_config_error: str | None = None
    retrieval_modes: list[str] = Field(default_factory=lambda: ["keyword"])
    defaults: dict = Field(default_factory=dict)
    overridden: list[str] = Field(default_factory=list)
    reindex_needed: bool = False


class ProviderTestOut(BaseModel):
    ok: bool
    configured: bool
    provider: str | None = None
    message: str
