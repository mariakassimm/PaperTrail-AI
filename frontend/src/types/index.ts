export type DocStatus = "queued" | "processing" | "indexed" | "partially_extracted" | "failed";
export interface Doc { id: number; title: string; filename: string; size_bytes: number; page_count: number;
  status: DocStatus; status_message: string; created_at: string; collection_id: number | null }
export interface Paged<T> { items: T[]; total: number; page: number; page_size: number }
export interface Collection { id: number; name: string; description: string; created_at: string; document_count: number }
export interface Citation { chunk_id: number; document_id: number; document_title: string; filename: string;
  page_number: number; excerpt: string; score: number; matched_by?: "keyword" | "meaning" | "both" | string }
export interface AskResponse { conversation_id: number; status: "answered" | "insufficient_evidence";
  mode: "retrieval_only" | "ai_generated" | string; answer: string; citations: Citation[];
  provider?: string | null; notice?: string | null; retrieval?: string;
  message_id?: number | null; ai_pending?: boolean; cached?: boolean }
export interface Message { id: number; role: "user" | "assistant"; content: string; created_at: string;
  meta: { status?: string; mode?: string; citations?: Citation[]; provider?: string | null; notice?: string | null;
    ai_pending?: boolean; cached?: boolean } | null }
export interface Conversation { id: number; title: string; collection_id: number | null; created_at: string }
export interface ConversationDetail extends Conversation { messages: Message[] }
export interface SearchResponse { search_type: string; notice?: string | null; query: string; title_matches: Doc[];
  passages: { citation: Citation; coverage: number }[] }
export interface ChunkDetail { chunk_id: number; document_id: number; document_title: string; filename: string;
  page_number: number; text: string; page_text: string;
  highlight_start?: number | null; highlight_end?: number | null }
export interface Stats { documents: number; documents_by_status: Record<string, number>; collections: number;
  conversations: number; chunks: number }
export interface Health { status: string; retrieval_mode: string; ai_provider: string | null; ai_mode: string; ai_config_error?: string | null; auth_required?: boolean;
  ai_enabled?: boolean; semantic?: boolean; embedding_provider?: string | null; embedding_config_error?: string | null }
export interface AppSettings { retrieval_mode: string; ai_provider: string | null; chunk_size: number;
  chunk_overlap: number; top_k: number; min_term_coverage: number; max_upload_mb: number;
  ai_model?: string | null; ai_configured?: boolean; ai_config_error?: string | null;
  ai_enabled?: boolean; auto_embed?: boolean; min_cosine?: number; embedding_provider?: string | null;
  embedding_config_error?: string | null; retrieval_modes?: string[]; defaults?: Record<string, unknown>;
  overridden?: string[]; reindex_needed?: boolean }
export type SettingsPatch = Partial<{ retrieval_mode: "keyword" | "hybrid"; top_k: number; min_term_coverage: number;
  min_cosine: number; chunk_size: number; chunk_overlap: number; ai_enabled: boolean; auto_embed: boolean }>
export interface Suggestion { term: string; question: string }
export interface EmbeddingStatus { enabled: boolean; provider: string | null; config_error: string | null;
  documents: Record<string, { embedded: number; total: number }> }
export interface EvalCaseDef { id: number; question: string; answerable: boolean; expected_facts: string[];
  expected_filename: string | null; expected_pages: number[] }
export type EvalCaseInput = Omit<EvalCaseDef, "id">
export interface EvalOptions { target?: "sample" | "library"; min_coverage?: number; top_k?: number; min_cosine?: number; mode?: "keyword" | "hybrid" }
export interface ProviderTest { ok: boolean; configured: boolean; provider: string | null; message: string }
export interface EvalCase { id: string; question: string; answerable: boolean; status: string;
  retrieved: { filename: string; page: number; chunk_id: number }[]; expected_facts: string[];
  expected_pages: number[]; retrieval_hit: boolean | null; citation_valid: boolean;
  fact_coverage: number | null; abstention_correct: boolean; passed: boolean }
export interface EvalMetrics { cases: number; pass_rate: number | null; retrieval_hit_rate: number | null;
  citation_validity_rate: number | null; mean_fact_coverage: number | null;
  abstention_accuracy: number | null; correct_abstention_rate: number | null }
export interface EvalReport { metrics: EvalMetrics; results: EvalCase[];
  settings: { min_coverage: number; top_k: number; mode?: string; min_cosine?: number; target?: string } }
